# claude-exporter

CLI utility for exporting [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions to Markdown.

It reads the session transcripts Claude Code stores under `~/.claude/projects/`
(and `~/.claude-sec/projects/`) and renders them as readable Markdown — user and
assistant messages with timestamps, compact summaries, system events, and
`AskUserQuestion` prompts with their answer options.

## Install

```bash
git clone https://github.com/witqq/claude-exporter.git
cd claude-exporter
npm link        # exposes the `claude-export` command globally
```

Requires Node.js (uses ES modules, no external dependencies).

## Usage

```bash
# List all projects that have sessions
claude-export --list

# List sessions for a project (by its working-directory path)
claude-export ~/projects/my-app --list

# Export the latest session of a project to stdout
claude-export ~/projects/my-app

# Export a specific session by id (partial match works)
claude-export ~/projects/my-app -s 46f22

# Export to a file
claude-export ~/projects/my-app -s 46f22 -o session.md

# Export a session file directly
claude-export ~/.claude/projects/-Users-me-projects-my-app/<id>.jsonl -o out.md
```

### Options

| Flag | Description |
|------|-------------|
| `-l`, `--list` | List all projects, or sessions of a given project |
| `-s`, `--session <id>` | Session id (partial match, e.g. `46f22`) |
| `-o`, `--output <file>` | Output file (default: stdout) |
| `-h`, `--help` | Show help |

## How project paths map to session folders

Claude Code stores sessions in a folder named after the project's absolute path,
replacing both `/` and `.` with `-`:

```
/Users/me/projects/my-app  ->  -Users-me-projects-my-app
/Users/me/.config          ->  -Users-me--config   (hidden dir: . -> -)
```

`claude-export` resolves this automatically, so you can pass the real project
path and it finds the matching session folder.

## What gets exported

- Compact summaries from previous context windows
- User / assistant messages with timestamps
- System events (compact, clear)
- `AskUserQuestion` questions, their answer options, and the chosen answer

Routine tool calls (file reads, shell commands, etc.) are intentionally omitted
to keep exports focused and readable.

## License

ISC
