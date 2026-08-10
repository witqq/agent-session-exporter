import fs from 'fs';
import path from 'path';
import {
  VALID_SOURCES,
  exportSession,
  listProjects,
  sessionFromDirectFile,
  sessionsForProject,
} from './exporter.js';

function showHelp() {
  console.log(`
Agent Session Exporter

Export Claude Code and Codex sessions to Markdown.

USAGE:
  session-export [options]
  session-export <project-path> [session-id] [options]
  claude-export <project-path> [session-id] [options]

OPTIONS:
  --source <auto|claude|codex>  Session source (default: auto)
  -l, --list                    List projects or project sessions
  -s, --session <id>            Session ID (partial match)
  -o, --output <file>           Output file path (default: stdout)
  -h, --help                    Show this help

EXAMPLES:
  session-export --list
  session-export --source codex --list
  session-export ~/projects/my-app --list
  session-export ~/projects/my-app --source codex
  session-export ~/projects/my-app -s 46f22 -o session.md
  claude-export ~/projects/my-app --source claude
  session-export /path/to/rollout.jsonl -o session.md
`);
}

function optionValue(args, ...names) {
  const index = args.findIndex(arg => names.includes(arg));
  return index === -1 ? null : args[index + 1];
}

function positionalArgs(args) {
  const valueFlags = new Set(['--source', '-s', '--session', '-o', '--output']);
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) positionals.push(arg);
  }
  return positionals;
}

function formatSize(size) {
  return `${(size / 1024).toFixed(1)}KB`;
}

function printProjects(projects) {
  if (projects.length === 0) {
    console.log('No projects found');
    return;
  }
  for (const project of projects) {
    console.log(`\n[${project.source}] ${project.projectPath}`);
    console.log(`  Sessions: ${project.sessions.length}`);
    for (const session of project.sessions.slice(0, 3)) {
      console.log(`    - ${session.id.slice(0, 12)}... (${session.mtime.toISOString().slice(0, 10)}, ${formatSize(session.size)})`);
    }
  }
}

function printSessions(projectPath, sessions) {
  console.log(`\nProject: ${projectPath}`);
  console.log(`Sessions: ${sessions.length}\n`);
  for (const session of sessions) {
    const date = session.mtime.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  [${session.source}] ${session.id}  ${date}  ${formatSize(session.size)}`);
  }
}

async function writeExport(session, outputFile) {
  const markdown = await exportSession(session);
  if (outputFile) {
    fs.writeFileSync(outputFile, markdown);
    console.log(`Exported ${session.source} session to ${outputFile}`);
  } else {
    console.log(markdown);
  }
}

export async function runCli(args = process.argv.slice(2), options = {}) {
  if (args.includes('-h') || args.includes('--help')) {
    showHelp();
    return;
  }

  const source = optionValue(args, '--source') || 'auto';
  if (!VALID_SOURCES.has(source)) throw new Error(`Unsupported source: ${source}`);
  const isList = args.includes('-l') || args.includes('--list');
  const outputFile = optionValue(args, '-o', '--output');
  const explicitSession = optionValue(args, '-s', '--session');
  const positionals = positionalArgs(args);
  const directFile = positionals.find(value => value.endsWith('.jsonl'));

  if (directFile) {
    const session = await sessionFromDirectFile(directFile, source);
    await writeExport(session, outputFile);
    return;
  }

  const projectPath = positionals[0];
  const sessionFilter = explicitSession || positionals[1] || null;

  if (isList && !projectPath) {
    const projects = await listProjects({ ...options, source });
    printProjects(projects);
    return;
  }

  if (!projectPath) {
    showHelp();
    throw new Error('Project path is required');
  }

  const sessions = await sessionsForProject(projectPath, { ...options, source });
  if (isList) {
    printSessions(projectPath, sessions);
    return;
  }
  if (sessions.length === 0) throw new Error(`No sessions found for project: ${projectPath}`);

  const session = sessionFilter
    ? sessions.find(candidate => candidate.id.includes(sessionFilter) || path.basename(candidate.path).includes(sessionFilter))
    : sessions[0];
  if (!session) throw new Error(`No session matching: ${sessionFilter}`);
  await writeExport(session, outputFile);
}
