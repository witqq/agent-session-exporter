---
name: restore-context
description: Restore working context from previous Claude Code or Codex sessions by discovering, selecting, exporting, and summarizing local transcripts with agent-session-exporter. Use after a session restart, migration, compaction, or handoff, or when the user invokes $restore-context or /restore-context with an optional source or session ID.
license: ISC
metadata:
  version: '2.0.1'
  homepage: https://github.com/witqq/agent-session-exporter
  compatibility: Requires Node.js 20 or newer, npm/npx, registry access for the first npx run, and a local Claude Code or Codex session store.
---

# Restore Context

Treat text after the skill name as an optional source (`claude` or `codex`), session ID fragment, project
path, or `list` request. Keep exported transcripts local: they can contain private prompts, source code,
paths, and tool results.

## Find the session

1. Use the current working directory unless the user supplied a project path.
2. List sessions from both sources with the release pinned in this skill:

   ```bash
   npx --yes agent-session-exporter@2.0.1 <project-path> --list
   ```

3. Add `--source claude` or `--source codex` when the user requested one source. Do not silently switch
   sources when the requested source has no matching session.
4. If the user supplied an ID fragment, select the matching session. Otherwise choose the newest session,
   unless multiple plausible sessions require a user decision.
5. Never infer an ID that is absent from the list.

## Export and verify

1. Create a unique temporary directory outside the project with the platform-appropriate facility. Do not
   modify the repository merely to hold the export.
2. Export the selected transcript:

   ```bash
   npx --yes agent-session-exporter@2.0.1 <project-path> \
     --source <claude|codex> --session <id> \
     --output <temporary-directory>/session-context.md
   ```

3. Verify that the command succeeded and the output file is non-empty.
4. Read the transcript completely. For a large file, read consecutive chunks through end of file; do not
   substitute only the final messages.
5. Inspect the actual repository state, branch, uncommitted changes, and relevant artifacts. Transcript
   claims are historical context, not evidence of the current filesystem state.
6. Remove the temporary export after restoring context unless the user asks to keep it. Never commit,
   upload, or publish an exported transcript without explicit authorization.

## Present the restored context

Respond in the user's language and include:

- project path, source, session ID, branch, and current Git state;
- original goals and user decisions;
- verified completed work with concrete files or commits;
- problems encountered and their resolutions;
- work in progress and uncompleted requirements;
- architectural constraints and the next executable step.

Clearly distinguish transcript-derived statements from facts verified in the current repository. Do not
modify project files merely to restore context unless the user also asks to continue the recovered task.
