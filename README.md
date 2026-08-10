# Agent Session Exporter

CLI utility for exporting Claude Code and Codex session transcripts to readable Markdown.

It discovers:

- Claude Code sessions under `~/.claude/projects/` and `~/.claude-sec/projects/`;
- Codex sessions under `~/.codex/sessions/` and `~/.codex/archived_sessions/`.

Both sources use the same project, session selection, listing, direct-file export, and output interface. Routine tool calls and private reasoning records are omitted; user/assistant messages, context summaries, system events, and interactive questions/answers are retained.

## Install

```bash
git clone https://github.com/witqq/claude-exporter.git
cd claude-exporter
npm link
```

Node.js 20 or newer is recommended. The project uses ES modules and has no runtime dependencies.

`npm link` exposes two commands:

- `session-export` — universal command;
- `claude-export` — backward-compatible alias with the same options.

## Usage

```bash
# List projects from both sources
session-export --list

# Limit discovery to one source
session-export --source codex --list
session-export --source claude --list

# List all Claude and Codex sessions for a project
session-export ~/projects/my-app --list

# Export the newest session across both sources
session-export ~/projects/my-app

# Export the newest Codex session only
session-export ~/projects/my-app --source codex

# Select a session by partial ID and write a file
session-export ~/projects/my-app --session 46f22 --output session.md

# Positional session IDs remain supported
session-export ~/projects/my-app 46f22 -o session.md

# Auto-detect a direct Claude or Codex JSONL file
session-export /path/to/session.jsonl -o session.md

# Existing scripts can keep using the legacy command
claude-export ~/projects/my-app --source claude
```

### Options

| Flag | Description |
|------|-------------|
| `--source <auto\|claude\|codex>` | Source filter; defaults to `auto` |
| `-l`, `--list` | List all projects, or sessions for a project |
| `-s`, `--session <id>` | Session ID; partial matches work |
| `-o`, `--output <file>` | Output file; defaults to stdout |
| `-h`, `--help` | Show help |

## Discovery behavior

Claude Code encodes a project's absolute path in its session directory name. The exporter reads session metadata to recover the original `cwd`, while retaining the historical encoded-path fallback.

Codex stores rollouts by date rather than by project. The exporter recursively scans active and archived rollout directories, reads `session_meta.cwd`, groups sessions by the real project path, and deduplicates active/archived copies by source and session ID.

Set `CODEX_HOME` when Codex state is stored outside `~/.codex`.

## Exported content

- Claude compact summaries and Codex compaction records when present;
- user and assistant messages with timestamps and model names;
- Claude `AskUserQuestion` and Codex `request_user_input` prompts and answers;
- relevant system events such as aborted Codex turns.

The exporter intentionally omits routine tool calls, tool outputs, developer/system prompts, and encrypted/private reasoning records.

## Development

```bash
npm test
```

Tests use temporary Claude and Codex stores and do not read or modify real sessions.

## License

ISC
