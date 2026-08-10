import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import {
  detectSource,
  discoverSessions,
  exportSession,
  sessionFromDirectFile,
  sessionsForProject,
} from '../src/exporter.js';

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-export-test-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return { root, home, project, codexHome: path.join(home, '.codex') };
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

function makeClaudeSession(workspace) {
  const encoded = path.resolve(workspace.project).replace(/[/.]/g, '-');
  const file = path.join(workspace.home, '.claude', 'projects', encoded, 'claude-session.jsonl');
  writeJsonl(file, [
    { type: 'mode', sessionId: 'claude-session' },
    {
      type: 'user',
      sessionId: 'claude-session',
      cwd: workspace.project,
      timestamp: '2026-08-10T10:00:00.000Z',
      message: { role: 'user', content: 'Claude question' },
    },
    {
      type: 'assistant',
      sessionId: 'claude-session',
      cwd: workspace.project,
      timestamp: '2026-08-10T10:00:01.000Z',
      message: {
        role: 'assistant',
        model: 'claude-test',
        content: [
          { type: 'text', text: 'Claude answer' },
          {
            type: 'tool_use',
            name: 'AskUserQuestion',
            input: {
              questions: [{
                header: 'Choice',
                question: 'Continue?',
                options: [{ label: 'Yes', description: 'Proceed' }],
              }],
            },
          },
        ],
      },
    },
    { type: 'summary', summary: 'Claude compact summary' },
  ]);
  return file;
}

function makeCodexSession(workspace) {
  const file = path.join(
    workspace.codexHome,
    'sessions',
    '2026',
    '08',
    '10',
    'rollout-2026-08-10T10-00-00-codex-session.jsonl',
  );
  writeJsonl(file, [
    {
      type: 'session_meta',
      timestamp: '2026-08-10T10:00:00.000Z',
      payload: { id: 'codex-session', cwd: workspace.project, timestamp: '2026-08-10T10:00:00.000Z' },
    },
    { type: 'turn_context', payload: { model: 'gpt-test' } },
    {
      type: 'response_item',
      timestamp: '2026-08-10T10:00:01.000Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex question' }] },
    },
    {
      type: 'response_item',
      timestamp: '2026-08-10T10:00:02.000Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex answer' }] },
    },
    {
      type: 'response_item',
      timestamp: '2026-08-10T10:00:03.000Z',
      payload: {
        type: 'function_call',
        name: 'request_user_input',
        call_id: 'call-1',
        arguments: JSON.stringify({
          questions: [{
            header: 'Direction',
            id: 'direction',
            question: 'Which way?',
            options: [{ label: 'Forward', description: 'Continue forward' }],
          }],
        }),
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-08-10T10:00:04.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: JSON.stringify({ answers: { direction: { answers: ['Forward'] } } }),
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-08-10T10:00:05.000Z',
      payload: { type: 'function_call', name: 'exec', call_id: 'call-2', arguments: '{}' },
    },
  ]);
  return file;
}

test('discovers Claude and Codex sessions for the same project', async t => {
  const workspace = createWorkspace();
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  makeClaudeSession(workspace);
  makeCodexSession(workspace);

  const options = { home: workspace.home, codexHome: workspace.codexHome, source: 'auto' };
  const sessions = await sessionsForProject(workspace.project, options);

  assert.deepEqual(new Set(sessions.map(session => session.source)), new Set(['claude', 'codex']));
  assert.equal((await discoverSessions(options)).length, 2);
});

test('renders Claude questions and summaries while omitting routine tools', async t => {
  const workspace = createWorkspace();
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  const file = makeClaudeSession(workspace);
  const session = await sessionFromDirectFile(file);
  const markdown = await exportSession(session);

  assert.equal(await detectSource(file), 'claude');
  assert.match(markdown, /# Claude Code Session Export/);
  assert.match(markdown, /Claude compact summary/);
  assert.match(markdown, /Claude answer/);
  assert.match(markdown, /AskUserQuestion/);
  assert.match(markdown, /Continue\?/);
});

test('renders Codex messages and request_user_input answers', async t => {
  const workspace = createWorkspace();
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  const file = makeCodexSession(workspace);
  const session = await sessionFromDirectFile(file);
  const markdown = await exportSession(session);

  assert.equal(await detectSource(file), 'codex');
  assert.match(markdown, /# Codex Session Export/);
  assert.match(markdown, /Assistant \(gpt-test\)/);
  assert.match(markdown, /request_user_input/);
  assert.match(markdown, /direction:\*\* Forward/);
  assert.doesNotMatch(markdown, /call-2/);
});

test('CLI exports a Codex project session through the universal interface', async t => {
  const workspace = createWorkspace();
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  makeCodexSession(workspace);
  const output = path.join(workspace.root, 'export.md');

  await runCli(
    [workspace.project, '--source', 'codex', '--output', output],
    { home: workspace.home, codexHome: workspace.codexHome },
  );

  assert.match(fs.readFileSync(output, 'utf8'), /Codex question/);
});
