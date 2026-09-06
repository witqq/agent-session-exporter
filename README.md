# Agent Session Exporter

CLI utility for exporting Claude Code and Codex session transcripts to readable Markdown.

[![npm](https://img.shields.io/npm/v/agent-session-exporter.svg)](https://www.npmjs.com/package/agent-session-exporter)
[![CI](https://github.com/witqq/agent-session-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/witqq/agent-session-exporter/actions/workflows/ci.yml)

It discovers:

- Claude Code sessions under `~/.claude/projects/` and `~/.claude-sec/projects/`;
- Codex sessions under `~/.codex/sessions/` and `~/.codex/archived_sessions/`.

Both sources use the same project, session selection, listing, direct-file export, and output interface. Routine tool calls and private reasoning records are omitted; user/assistant messages, context summaries, system events, and interactive questions/answers are retained.

## Install

Install the CLI from npm:

```bash
npm install --global agent-session-exporter
session-export --help
```

You can also run it without a global installation:

```bash
npx --yes agent-session-exporter --list
```

For local development, clone and link the checkout:

```bash
git clone https://github.com/witqq/agent-session-exporter.git
cd agent-session-exporter
npm link
```

Node.js 24.20.0 or newer is required. Development, CI and release checks use npm 12.0.2. The project uses ES modules and has no runtime dependencies.

`npm link` exposes the universal `session-export` command.

## Agent skill

The repository includes the cross-agent [`restore-context`](skills/restore-context/SKILL.md) skill for
Claude Code and Codex. Install it with a compatible skill manager:

```bash
npx skills add witqq/agent-session-exporter --skill restore-context
```

The skill runs the matching published CLI through `npx`, keeps transcript exports outside the project, and
requires explicit authorization before an exported transcript may be committed, uploaded, or published.

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

```

### Options

| Flag | Description |
|------|-------------|
| `--source <auto\|claude\|codex>` | Source filter; defaults to `auto` |
| `-l`, `--list` | List all projects, or sessions for a project |
| `-s`, `--session <id>` | Session ID; partial matches work |
| `-o`, `--output <file>` | Output file; defaults to stdout |
| `-v`, `--version` | Show the installed package version |
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
npm run check:workflows
npm run pack:check
npm run verify
```

`pack:check` verifies the complete npm tarball inventory, installs that tarball into an isolated temporary
prefix, and runs the installed `session-export` executable.

Maintainers publish releases through npm Trusted Publishing. See
[`docs/RELEASE.md`](docs/RELEASE.md) for the immutable-asset release process. GitHub Actions publishes the
single accepted GitHub Release tarball without checking out source, installing dependencies, or rebuilding it.

Tests use temporary Claude and Codex stores and do not read or modify real sessions.

## License

ISC
