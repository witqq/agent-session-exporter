import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const evidenceRoot = path.join(repositoryRoot, 'test-results', 'package');
fs.mkdirSync(evidenceRoot, { recursive: true });
const candidateRoot = fs.mkdtempSync(path.join(evidenceRoot, 'candidate-'));
const expectedFiles = [
  'LICENSE',
  'README.md',
  'docs/RELEASE.md',
  'package.json',
  'session-export.js',
  'skills/restore-context/SKILL.md',
  'skills/restore-context/agents/openai.yaml',
  'src/cli.js',
  'src/exporter.js',
];

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

const packOutput = runNpm(
  ['pack', '--json', '--ignore-scripts', '--pack-destination', candidateRoot],
  { cwd: repositoryRoot, encoding: 'utf8' },
);
const parsedPackOutput = JSON.parse(packOutput);
const packResults = Array.isArray(parsedPackOutput)
  ? parsedPackOutput
  : Object.values(parsedPackOutput);
assert.equal(packResults.length, 1, 'npm pack must return exactly one package');
const [packResult] = packResults;
assert.equal(packResult.name, manifest.name);
assert.equal(packResult.version, manifest.version);
assert.equal(packResult.filename, `agent-session-exporter-${manifest.version}.tgz`);
assert.deepEqual(
  packResult.files.map(file => file.path).sort(),
  expectedFiles,
  'npm tarball contains an unexpected file inventory',
);

const executable = packResult.files.find(file => file.path === 'session-export.js');
assert.ok(executable, 'npm tarball does not contain the CLI entry point');
assert.equal(executable.mode & 0o111, 0o111, 'CLI entry point is not executable');

const tarballPath = path.join(candidateRoot, packResult.filename);
const tarballBytes = fs.readFileSync(tarballPath);
const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
const tarInventory = execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/u)
  .filter(entry => entry && !entry.endsWith('/'))
  .map(entry => entry.replace(/^package\//u, ''))
  .sort();
assert.deepEqual(tarInventory, expectedFiles, 'tar and npm inventories must match');

const extractedRoot = path.join(candidateRoot, 'extracted');
fs.mkdirSync(extractedRoot);
execFileSync('tar', ['-xf', tarballPath, '-C', extractedRoot]);
for (const file of expectedFiles) {
  const extracted = path.join(extractedRoot, 'package', file);
  const stat = fs.lstatSync(extracted);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${file} must be a regular file`);
  assertPublishSafe(fs.readFileSync(extracted), file);
}

const packedManifest = JSON.parse(
  fs.readFileSync(path.join(extractedRoot, 'package', 'package.json'), 'utf8'),
);
assert.equal(packedManifest.name, 'agent-session-exporter');
assert.equal(packedManifest.version, manifest.version);
assert.equal(packedManifest.engines?.node, '>=24.20.0');
assert.equal(packedManifest.repository?.url, 'git+https://github.com/witqq/agent-session-exporter.git');
assert.equal(packedManifest.bin?.['session-export'], './session-export.js');
assert.equal(packedManifest.publishConfig?.access, 'public');
assert.deepEqual(packedManifest.dependencies, undefined, 'published CLI retains no runtime dependencies');

const skill = fs.readFileSync(
  path.join(extractedRoot, 'package', 'skills', 'restore-context', 'SKILL.md'),
  'utf8',
);
assert.match(skill, new RegExp(`version: '${escapeRegex(manifest.version)}'`));
assert.match(skill, /Requires Node\.js 24\.20\.0 or newer/u);
const pinnedCommands = [...skill.matchAll(/agent-session-exporter@(\d+\.\d+\.\d+)/gu)]
  .map(match => match[1]);
assert.ok(pinnedCommands.length >= 2, 'restore-context skill must pin its CLI commands');
assert.ok(pinnedCommands.every(version => version === manifest.version), 'skill commands match package version');

const installPrefix = path.join(candidateRoot, 'install');
runNpm(
  ['install', '--global', '--ignore-scripts', '--prefix', installPrefix, tarballPath],
  { cwd: candidateRoot, stdio: 'pipe' },
);
const executablePath = process.platform === 'win32'
  ? path.join(installPrefix, 'session-export.cmd')
  : path.join(installPrefix, 'bin', 'session-export');
const installedVersion = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(installedVersion, manifest.version);
const help = execFileSync(executablePath, ['--help'], { encoding: 'utf8' });
assert.match(help, /Export Claude Code and Codex sessions to Markdown/);

const evidence = {
  package: { name: packedManifest.name, version: packedManifest.version, node: packedManifest.engines.node },
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim() !== '',
  tarball: { path: tarballPath, filename: packResult.filename, sha256, size: tarballBytes.length },
  inventory: expectedFiles,
  installedCli: { version: installedVersion, help: true },
  skill: { name: 'restore-context', version: manifest.version, pinnedCommands: pinnedCommands.length },
};
const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`;
fs.writeFileSync(path.join(candidateRoot, 'candidate-evidence.json'), evidenceJson);
fs.writeFileSync(path.join(evidenceRoot, 'candidate-evidence.json'), evidenceJson);
console.log(JSON.stringify({ candidate: tarballPath, sha256, version: manifest.version, files: expectedFiles.length }));

function assertPublishSafe(bytes, file) {
  assert.ok(!bytes.includes(0), `${file} must not contain NUL bytes`);
  const text = bytes.toString('utf8');
  for (const pattern of [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /(?:^|\n)\s*(?:NPM_TOKEN|NODE_AUTH_TOKEN|_authToken)\s*[:=]/u,
    /\b(?:ghp|github_pat|npm)_[A-Za-z0-9_-]{20,}\b/u,
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\//u,
    /(?:^|\/)moira-ws(?:\/|$)/u,
    /(?:^|\/)agent_temp_files_local(?:\/|$)/u,
  ]) {
    assert.doesNotMatch(text, pattern, `${file} contains private or credential-shaped data`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
