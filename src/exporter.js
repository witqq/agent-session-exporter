import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

export const VALID_SOURCES = new Set(['auto', 'claude', 'codex']);

export function resolveStores(options = {}) {
  const home = options.home || os.homedir();
  return {
    claudeProjectDirs: options.claudeProjectDirs || [
      path.join(home, '.claude', 'projects'),
      path.join(home, '.claude-sec', 'projects'),
    ],
    codexRoots: options.codexRoots || [
      path.join(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions'),
      path.join(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex'), 'archived_sessions'),
    ],
  };
}

export async function parseJsonl(sessionPath) {
  const records = [];
  const stream = fs.createReadStream(sessionPath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A partially written final line must not make an otherwise valid session unusable.
    }
  }

  return records;
}

async function readMetadata(sessionPath, source) {
  const stream = fs.createReadStream(sessionPath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let inspected = 0;
  let discoveredId = null;

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      inspected += 1;

      if (source === 'codex' && record.type === 'session_meta') {
        return {
          id: record.payload?.id || record.payload?.session_id,
          projectPath: record.payload?.cwd,
          timestamp: record.payload?.timestamp || record.timestamp,
        };
      }

      if (source === 'claude') {
        discoveredId = record.sessionId || discoveredId;
        if (record.cwd) {
          return {
            id: discoveredId,
            projectPath: record.cwd,
            timestamp: record.timestamp,
          };
        }
      }

      if (inspected >= 50) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return discoveredId ? { id: discoveredId } : {};
}

function walkJsonlFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(fullPath);
    }
  }

  return result;
}

function sessionFromFile(source, sessionPath, metadata = {}) {
  const stat = fs.statSync(sessionPath);
  const filename = path.basename(sessionPath, '.jsonl');
  const codexId = filename.match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/i)?.[1];
  return {
    source,
    id: metadata.id || codexId || filename,
    path: sessionPath,
    projectPath: metadata.projectPath || null,
    size: stat.size,
    mtime: stat.mtime,
    timestamp: metadata.timestamp || null,
  };
}

async function discoverClaudeSessions(stores) {
  const sessions = [];
  for (const projectsDir of stores.claudeProjectDirs) {
    if (!fs.existsSync(projectsDir)) continue;
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(projectsDir, entry.name);
      for (const filename of fs.readdirSync(projectDir)) {
        if (!filename.endsWith('.jsonl') || filename.startsWith('agent-')) continue;
        const sessionPath = path.join(projectDir, filename);
        const metadata = await readMetadata(sessionPath, 'claude');
        if (!metadata.projectPath) {
          metadata.projectPath = entry.name.replace(/-/g, '/').replace(/^\//, '');
        }
        sessions.push(sessionFromFile('claude', sessionPath, metadata));
      }
    }
  }
  return sessions;
}

async function discoverCodexSessions(stores) {
  const sessions = [];
  for (const root of stores.codexRoots) {
    for (const sessionPath of walkJsonlFiles(root)) {
      const metadata = await readMetadata(sessionPath, 'codex');
      if (!metadata.projectPath) continue;
      sessions.push(sessionFromFile('codex', sessionPath, metadata));
    }
  }
  return sessions;
}

function deduplicateSessions(sessions) {
  const byId = new Map();
  for (const session of sessions) {
    const key = `${session.source}:${session.id}`;
    const existing = byId.get(key);
    if (!existing || session.mtime > existing.mtime) byId.set(key, session);
  }
  return [...byId.values()].sort((a, b) => b.mtime - a.mtime);
}

export async function discoverSessions(options = {}) {
  const source = options.source || 'auto';
  if (!VALID_SOURCES.has(source)) throw new Error(`Unsupported source: ${source}`);
  const stores = resolveStores(options);
  const sessions = [];

  if (source === 'auto' || source === 'claude') {
    sessions.push(...await discoverClaudeSessions(stores));
  }
  if (source === 'auto' || source === 'codex') {
    sessions.push(...await discoverCodexSessions(stores));
  }

  return deduplicateSessions(sessions);
}

export async function listProjects(options = {}) {
  const sessions = await discoverSessions(options);
  const projects = new Map();

  for (const session of sessions) {
    const projectPath = session.projectPath || '(unknown project)';
    const key = `${session.source}:${projectPath}`;
    const project = projects.get(key) || {
      source: session.source,
      projectPath,
      sessions: [],
    };
    project.sessions.push(session);
    projects.set(key, project);
  }

  return [...projects.values()]
    .map(project => ({
      ...project,
      sessions: project.sessions.sort((a, b) => b.mtime - a.mtime),
    }))
    .sort((a, b) => a.projectPath.localeCompare(b.projectPath) || a.source.localeCompare(b.source));
}

export async function sessionsForProject(projectPath, options = {}) {
  const normalized = path.resolve(projectPath);
  const sessions = await discoverSessions(options);
  return sessions.filter(session => {
    if (!session.projectPath) return false;
    return path.resolve(session.projectPath) === normalized;
  });
}

export async function detectSource(sessionPath) {
  const stream = fs.createReadStream(sessionPath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (['session_meta', 'response_item', 'turn_context', 'event_msg', 'world_state'].includes(record.type)) {
        return 'codex';
      }
      return 'claude';
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  throw new Error(`Cannot detect session source: ${sessionPath}`);
}

function textFromBlocks(content, textTypes) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block && textTypes.has(block.type) && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n');
}

function formatQuestions(input, label) {
  if (!input || !Array.isArray(input.questions)) return '';
  const parts = [`**❓ ${label}:**`];
  for (const question of input.questions) {
    if (question.header) parts.push(`\n**${question.header}**`);
    if (question.question) parts.push(`_${question.question}_`);
    if (Array.isArray(question.options)) {
      for (const option of question.options) {
        const description = option.description ? ` — ${option.description}` : '';
        parts.push(`- **${option.label}**${description}`);
      }
    }
  }
  return parts.join('\n');
}

function toolResultText(block) {
  if (typeof block.content === 'string') return block.content;
  return textFromBlocks(block.content, new Set(['text']));
}

function extractClaudeContent(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';

  const answerPrefix = 'Your questions have been answered:';
  return message.content
    .map(block => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
        return formatQuestions(block.input, 'AskUserQuestion');
      }
      if (block.type === 'tool_result') {
        const text = toolResultText(block);
        if (text.startsWith(answerPrefix)) {
          const answer = text
            .slice(answerPrefix.length)
            .replace(/\s*You can now continue with these answers in mind\.\s*$/, '')
            .trim();
          return `**✅ Ответ:** ${answer}`;
        }
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeClaude(records) {
  const items = [];
  for (const record of records) {
    if (record.type === 'summary' && record.summary) {
      items.push({ type: 'summary', content: record.summary, timestamp: record.timestamp });
      continue;
    }
    if (record.type === 'user' || record.type === 'assistant') {
      const content = extractClaudeContent(record.message);
      if (!content.trim()) continue;
      items.push({
        type: 'message',
        role: record.type,
        content,
        model: record.type === 'assistant' ? record.message?.model : null,
        timestamp: record.timestamp,
      });
      continue;
    }
    if (record.type === 'system') {
      items.push({
        type: 'system',
        content: record.content || record.subtype || 'system event',
        timestamp: record.timestamp,
      });
    }
  }
  return items;
}

function safeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatCodexAnswer(output) {
  if (typeof output !== 'string') return '';
  const parsed = safeJson(output);
  if (!parsed?.answers || typeof parsed.answers !== 'object') {
    return output.trim() ? `**✅ Ответ:** ${output.trim()}` : '';
  }

  const parts = ['**✅ Ответ:**'];
  for (const [id, value] of Object.entries(parsed.answers)) {
    const answers = Array.isArray(value?.answers) ? value.answers : [value];
    parts.push(`- **${id}:** ${answers.filter(Boolean).join(', ')}`);
  }
  return parts.join('\n');
}

function normalizeCodex(records) {
  const items = [];
  const requestCalls = new Set();
  let currentModel = null;

  for (const record of records) {
    if (record.type === 'turn_context') {
      currentModel = record.payload?.model || currentModel;
      continue;
    }
    if (record.type === 'response_item') {
      const payload = record.payload || {};
      if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
        const content = textFromBlocks(payload.content, new Set(['input_text', 'output_text', 'text']));
        if (!content.trim()) continue;
        items.push({
          type: 'message',
          role: payload.role,
          content,
          model: payload.role === 'assistant' ? currentModel : null,
          timestamp: record.timestamp,
        });
        continue;
      }
      if ((payload.type === 'function_call' || payload.type === 'custom_tool_call')
          && payload.name?.endsWith('request_user_input')) {
        const input = safeJson(payload.arguments ?? payload.input) || payload.arguments || payload.input;
        const content = formatQuestions(input, 'request_user_input');
        if (content) {
          requestCalls.add(payload.call_id);
          items.push({
            type: 'message',
            role: 'assistant',
            content,
            model: currentModel,
            timestamp: record.timestamp,
          });
        }
        continue;
      }
      if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')
          && requestCalls.has(payload.call_id)) {
        const content = formatCodexAnswer(
          typeof payload.output === 'string'
            ? payload.output
            : textFromBlocks(payload.output, new Set(['text', 'output_text'])),
        );
        if (content) {
          items.push({ type: 'message', role: 'user', content, timestamp: record.timestamp });
        }
        continue;
      }
      if (payload.type === 'compaction') {
        const content = payload.summary || payload.text || textFromBlocks(payload.content, new Set(['text']));
        if (content) items.push({ type: 'summary', content, timestamp: record.timestamp });
      }
      continue;
    }
    if (record.type === 'event_msg' && record.payload?.type === 'turn_aborted') {
      items.push({ type: 'system', content: 'Turn aborted', timestamp: record.timestamp });
    }
  }
  return items;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? String(timestamp) : parsed.toISOString();
}

export function renderMarkdown(items, session) {
  const sourceLabel = session.source === 'codex' ? 'Codex' : 'Claude Code';
  const lines = [
    `# ${sourceLabel} Session Export`,
    `**Source:** ${session.source}`,
    `**Session ID:** ${session.id}`,
  ];
  if (session.projectPath) lines.push(`**Project:** ${session.projectPath}`);
  lines.push(`**Exported:** ${new Date().toISOString()}`, '');

  const summaries = items.filter(item => item.type === 'summary');
  if (summaries.length > 0) {
    lines.push('## Previous Context (Summaries)', '');
    for (const summary of summaries) lines.push(`- ${summary.content}`);
    lines.push('', '---', '');
  }

  for (const item of items) {
    if (item.type === 'summary') continue;
    if (item.type === 'system') {
      lines.push(`> **System:** ${item.content}`, '', '---', '');
      continue;
    }
    const role = item.role === 'assistant' ? 'Assistant' : 'User';
    const model = item.role === 'assistant' && item.model ? ` (${item.model})` : '';
    lines.push(`## ${role}${model}`);
    const timestamp = formatTimestamp(item.timestamp);
    if (timestamp) lines.push(`_${timestamp}_`);
    lines.push('', item.content, '', '---', '');
  }

  return lines.join('\n');
}

export async function exportSession(session) {
  const records = await parseJsonl(session.path);
  const items = session.source === 'codex' ? normalizeCodex(records) : normalizeClaude(records);
  return renderMarkdown(items, session);
}

export async function sessionFromDirectFile(sessionPath, source = 'auto') {
  const resolved = path.resolve(sessionPath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${sessionPath}`);
  const detected = source === 'auto' ? await detectSource(resolved) : source;
  const metadata = await readMetadata(resolved, detected);
  return sessionFromFile(detected, resolved, metadata);
}
