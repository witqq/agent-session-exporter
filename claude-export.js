#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SEC_DIR = path.join(os.homedir(), '.claude-sec');

// Multiple project directories to search
const PROJECT_DIRS = [
  path.join(CLAUDE_DIR, 'projects'),
  path.join(CLAUDE_SEC_DIR, 'projects')
];

function showHelp() {
  console.log(`
Claude Session Exporter

Export Claude Code sessions to Markdown format

USAGE:
  claude-export [options]
  claude-export <project-path> [session-id] [-o output.md]

OPTIONS:
  -l, --list              List all projects or sessions
  -s, --session <id>      Session ID (partial match, e.g. "46f22")
  -o, --output <file>     Output file path (default: stdout)
  -h, --help              Show this help

EXAMPLES:
  # List all projects
  claude-export --list

  # List sessions for project by path
  claude-export ~/projects/my-app --list

  # Export last session from project
  claude-export ~/projects/my-app

  # Export specific session by ID
  claude-export ~/projects/my-app -s 46f22

  # Export to file
  claude-export ~/projects/my-app -s 46f22 -o session.md

  # Direct session file export
  claude-export ~/.claude/projects/.../session.jsonl -o out.md
`);
}

function getProjects() {
  const allProjects = [];

  for (const projectsDir of PROJECT_DIRS) {
    if (!fs.existsSync(projectsDir)) {
      continue;
    }

    const projects = fs.readdirSync(projectsDir)
      .filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory())
      .map(name => ({
        name,
        path: path.join(projectsDir, name),
        displayName: name.replace(/-/g, '/').replace(/^\//, ''),
        sourceDir: projectsDir
      }));

    allProjects.push(...projects);
  }

  return allProjects;
}

function projectPathToClaudePaths(projectPath) {
  const normalized = path.resolve(projectPath);

  // Check if the path is already a Claude project directory (inside .claude or .claude-sec)
  for (const projectsDir of PROJECT_DIRS) {
    if (normalized.startsWith(projectsDir) && fs.existsSync(normalized)) {
      // Direct path to project folder in .claude or .claude-sec
      return [normalized];
    }
  }

  // Claude Code encodes the project path by replacing both '/' and '.' with '-'.
  // e.g. /Users/me/projects/my-app -> -Users-me-projects-my-app
  //      /Users/me/.config        -> -Users-me--config (hidden dir: . -> -)
  // Try the dot-encoded name first, then a legacy '/'-only encoding as fallback.
  const candidateNames = [
    normalized.replace(/[/.]/g, '-'),
    normalized.replace(/\//g, '-'),
  ];

  // Find all existing directories for this project
  const paths = [];
  for (const projectsDir of PROJECT_DIRS) {
    for (const claudeName of candidateNames) {
      const candidatePath = path.join(projectsDir, claudeName);
      if (fs.existsSync(candidatePath) && !paths.includes(candidatePath)) {
        paths.push(candidatePath);
      }
    }
  }

  return paths;
}

function getSessions(projectPath) {
  return fs.readdirSync(projectPath)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
    .map(f => {
      const fullPath = path.join(projectPath, f);
      const stat = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stat.size,
        mtime: stat.mtime
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function listProjects(filter) {
  const projects = getProjects();
  const filtered = filter
    ? projects.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    : projects;

  if (filtered.length === 0) {
    console.log('No projects found');
    return;
  }

  for (const project of filtered) {
    const sessions = getSessions(project.path);
    console.log(`\n${project.displayName}`);
    console.log(`  Sessions: ${sessions.length}`);

    if (sessions.length > 0) {
      const recent = sessions.slice(0, 3);
      for (const s of recent) {
        const date = s.mtime.toISOString().split('T')[0];
        const size = (s.size / 1024).toFixed(1) + 'KB';
        console.log(`    - ${s.name.slice(0, 8)}... (${date}, ${size})`);
      }
    }
  }
}

async function parseSession(sessionPath) {
  const messages = [];

  const fileStream = fs.createReadStream(sessionPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      messages.push(msg);
    } catch (e) {
      // Skip invalid lines
    }
  }

  return messages;
}

// Render an AskUserQuestion tool_use: the question(s) and their answer options.
// These capture user-facing decisions, so they belong in the exported context
// (unlike routine tool calls, which are intentionally omitted to keep exports lean).
function formatAskUserQuestion(input) {
  if (!input || !Array.isArray(input.questions)) return '';
  const parts = ['**❓ AskUserQuestion:**'];
  for (const q of input.questions) {
    if (q.question) parts.push(`\n_${q.question}_`);
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const desc = opt.description ? ` — ${opt.description}` : '';
        parts.push(`- **${opt.label}**${desc}`);
      }
    }
  }
  return parts.join('\n');
}

// Normalize tool_result content (string or array of text blocks) to a string.
function toolResultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

const ASK_ANSWER_PREFIX = 'Your questions have been answered:';

function extractContent(message) {
  if (!message) return '';

  // Handle string content
  if (typeof message.content === 'string') {
    return message.content;
  }

  // Handle array content (assistant and user messages)
  if (Array.isArray(message.content)) {
    return message.content
      .map(c => {
        if (c.type === 'text') return c.text;
        // Show questions Claude asked the user, with their answer options.
        if (c.type === 'tool_use' && c.name === 'AskUserQuestion') {
          return formatAskUserQuestion(c.input);
        }
        // Show the user's answer to an AskUserQuestion prompt.
        if (c.type === 'tool_result') {
          const text = toolResultText(c);
          if (text.startsWith(ASK_ANSWER_PREFIX)) {
            const answer = text
              .slice(ASK_ANSWER_PREFIX.length)
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

  return '';
}

function formatMessage(msg) {
  const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';

  switch (msg.type) {
    case 'summary':
      return `> **Summary:** ${msg.summary}\n`;

    case 'user': {
      const content = extractContent(msg.message);
      // Skip empty user messages
      if (!content.trim()) return '';
      return `## User\n_${timestamp}_\n\n${content}\n`;
    }

    case 'assistant': {
      const content = extractContent(msg.message);
      // Skip empty assistant messages (tool-only calls)
      if (!content.trim()) return '';
      const model = msg.message?.model || 'unknown';
      return `## Assistant (${model})\n_${timestamp}_\n\n${content}\n`;
    }

    case 'system': {
      const content = msg.content || msg.subtype || 'system event';
      return `> **System:** ${content}\n`;
    }

    default:
      return '';
  }
}

function exportToMarkdown(messages, sessionPath) {
  const sessionName = path.basename(sessionPath, '.jsonl');
  const lines = [];

  // Header
  lines.push(`# Claude Session Export`);
  lines.push(`**Session ID:** ${sessionName}`);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push('');

  // Summaries first
  const summaries = messages.filter(m => m.type === 'summary');
  if (summaries.length > 0) {
    lines.push('## Previous Context (Summaries)');
    lines.push('');
    for (const s of summaries) {
      lines.push(`- ${s.summary}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Messages
  const conversation = messages.filter(m => m.type !== 'summary');
  for (const msg of conversation) {
    const formatted = formatMessage(msg);
    if (formatted) {
      lines.push(formatted);
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const isList = args.includes('-l') || args.includes('--list');
  const sessionIdx = args.findIndex(a => a === '-s' || a === '--session');
  const sessionFilter = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  const outputIdx = args.findIndex(a => a === '-o' || a === '--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  // Find project path argument (not a flag, not a flag value)
  const flagValues = new Set();
  if (sessionIdx !== -1) flagValues.add(args[sessionIdx + 1]);
  if (outputIdx !== -1) flagValues.add(args[outputIdx + 1]);

  const projectPath = args.find(a =>
    !a.startsWith('-') &&
    !flagValues.has(a) &&
    !a.endsWith('.jsonl')
  );

  // Direct jsonl file export
  const directFile = args.find(a => a.endsWith('.jsonl'));
  if (directFile) {
    if (!fs.existsSync(directFile)) {
      console.error(`File not found: ${directFile}`);
      process.exit(1);
    }
    const messages = await parseSession(directFile);
    const md = exportToMarkdown(messages, directFile);

    if (outputFile) {
      fs.writeFileSync(outputFile, md);
      console.log(`Exported to ${outputFile}`);
    } else {
      console.log(md);
    }
    return;
  }

  // List all projects
  if (isList && !projectPath) {
    listProjects(null);
    return;
  }

  // Need project path for other operations
  if (!projectPath) {
    showHelp();
    process.exit(1);
  }

  // Convert project path to Claude sessions paths (may be multiple dirs)
  const claudePaths = projectPathToClaudePaths(projectPath);

  if (claudePaths.length === 0) {
    const normalized = path.resolve(projectPath);
    const claudeName = normalized.replace(/[/.]/g, '-');
    console.error(`No sessions found for project: ${projectPath}`);
    console.error(`Searched in:`);
    PROJECT_DIRS.forEach(d => console.error(`  ${path.join(d, claudeName)}`));
    process.exit(1);
  }

  // Collect sessions from all directories
  const sessions = claudePaths.flatMap(cp => getSessions(cp)).sort((a, b) => b.mtime - a.mtime);

  // List sessions for project
  if (isList) {
    console.log(`\nProject: ${projectPath}`);
    console.log(`Sessions: ${sessions.length}\n`);
    for (const s of sessions) {
      const date = s.mtime.toISOString().replace('T', ' ').slice(0, 19);
      const size = (s.size / 1024).toFixed(1) + 'KB';
      const id = s.name.replace('.jsonl', '');
      console.log(`  ${id}  ${date}  ${size}`);
    }
    return;
  }

  if (sessions.length === 0) {
    console.error(`No sessions in project: ${projectPath}`);
    process.exit(1);
  }

  // Find session by filter or use latest
  let session;
  if (sessionFilter) {
    session = sessions.find(s => s.name.includes(sessionFilter));
    if (!session) {
      console.error(`No session matching: ${sessionFilter}`);
      console.error('Available sessions:');
      sessions.slice(0, 5).forEach(s => console.error(`  ${s.name.slice(0, 8)}...`));
      process.exit(1);
    }
  } else {
    session = sessions[0]; // Latest
  }

  const messages = await parseSession(session.path);
  const md = exportToMarkdown(messages, session.path);

  if (outputFile) {
    fs.writeFileSync(outputFile, md);
    console.log(`Exported to ${outputFile}`);
  } else {
    console.log(md);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
