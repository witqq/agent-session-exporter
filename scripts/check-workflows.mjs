import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDocument } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const setupNode = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const ciSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const publishSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish-npm.yml'), 'utf8');
const ci = parseWorkflow(ciSource, 'CI workflow');
const publish = parseWorkflow(publishSource, 'publication workflow');

assert.equal(ci.name, 'CI');
assert.ok(Object.hasOwn(ci.on, 'pull_request'));
assert.ok(Object.hasOwn(ci.on, 'push'));
assert.ok(Object.hasOwn(ci.on, 'workflow_dispatch'));
assert.deepEqual(ci.permissions, { contents: 'read' });
const verify = requireRecord(ci.jobs?.verify, 'CI verify job');
assert.equal(verify['runs-on'], 'ubuntu-24.04');
assertStepUses(verify, checkout);
assertStepUses(verify, setupNode);
assertNode24(verify);
for (const command of [
  'npm install --global npm@11.19.0',
  'npm ci --no-audit --no-fund',
  'npm run verify',
]) assertStepRun(verify, command);
assertPinnedActions(ci, 'CI workflow');

assert.equal(publish.name, 'Publish npm release asset');
assert.deepEqual(Object.keys(publish.on), ['workflow_dispatch']);
assert.deepEqual(Object.keys(publish.on.workflow_dispatch.inputs).sort(), ['sha256', 'tag']);
assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' });
assert.equal(publish.concurrency?.['cancel-in-progress'], false);
const publication = requireRecord(publish.jobs?.publish, 'publication job');
assert.equal(publication['runs-on'], 'ubuntu-24.04');
assertStepUses(publication, setupNode);
assertNode24(publication);
const runs = steps(publication).map(step => step.run).filter(Boolean).join('\n');
for (const required of [
  'npm install --global npm@11.19.1',
  'git/ref/tags/${tag}',
  'ref.object?.type !== "tag"',
  'comparison.merge_base_commit?.sha !== expectedBase',
  'releases/tags/${tag}',
  'release.assets.length !== 1',
  'asset.digest !== `sha256:${expectedDigest}`',
  'crypto.createHash("sha256")',
  'manifest.name !== "agent-session-exporter"',
  'manifest.bin?.["session-export"] !== "./session-export.js"',
  'npm publish --access public "${asset_url}"',
]) assert.ok(runs.includes(required), `publication must enforce ${required}`);
for (const forbidden of ['actions/checkout@', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'npm ci', 'npm test', 'npm pack']) {
  assert.ok(!publishSource.includes(forbidden), `publication must exclude ${forbidden}`);
}
assertPinnedActions(publish, 'publication workflow');
console.log('GitHub Actions release contracts are valid.');

function parseWorkflow(source, label) {
  const document = parseDocument(source);
  assert.equal(document.errors.length, 0, `${label} must be valid YAML`);
  return requireRecord(document.toJS(), label);
}

function requireRecord(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function steps(job) {
  assert.ok(Array.isArray(job.steps), 'job must contain steps');
  return job.steps.map(step => requireRecord(step, 'workflow step'));
}

function assertStepUses(job, expected) {
  assert.ok(steps(job).some(step => step.uses === expected), `workflow must use ${expected}`);
}

function assertStepRun(job, expected) {
  assert.ok(steps(job).some(step => step.run === expected), `workflow must run ${expected}`);
}

function assertNode24(job) {
  const setup = steps(job).find(step => step.uses === setupNode);
  assert.equal(setup?.with?.['node-version'], '24.20.0');
  assert.equal(setup?.with?.['package-manager-cache'], false);
}

function assertPinnedActions(workflow, label) {
  for (const job of Object.values(requireRecord(workflow.jobs, `${label} jobs`))) {
    for (const step of steps(requireRecord(job, `${label} job`))) {
      if (!step.uses) continue;
      assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
    }
  }
}
