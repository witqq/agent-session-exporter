import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-session-exporter-pack-'));
const expectedFiles = [
  'LICENSE',
  'README.md',
  'docs/RELEASE.md',
  'package.json',
  'session-export.js',
  'src/cli.js',
  'src/exporter.js',
];

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

try {
  const packOutput = runNpm(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  const [packResult] = JSON.parse(packOutput);
  assert.ok(packResult, 'npm pack did not return package metadata');
  assert.equal(packResult.name, manifest.name);
  assert.equal(packResult.version, manifest.version);
  assert.deepEqual(
    packResult.files.map(file => file.path).sort(),
    expectedFiles,
    'npm tarball contains an unexpected file inventory',
  );

  const executable = packResult.files.find(file => file.path === 'session-export.js');
  assert.ok(executable, 'npm tarball does not contain the CLI entry point');
  assert.equal(executable.mode & 0o111, 0o111, 'CLI entry point is not executable');

  const tarballPath = path.join(temporaryRoot, packResult.filename);
  const installPrefix = path.join(temporaryRoot, 'install');
  runNpm(
    ['install', '--global', '--ignore-scripts', '--prefix', installPrefix, tarballPath],
    { cwd: temporaryRoot, stdio: 'pipe' },
  );

  const executablePath = process.platform === 'win32'
    ? path.join(installPrefix, 'session-export.cmd')
    : path.join(installPrefix, 'bin', 'session-export');
  const installedVersion = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(installedVersion, manifest.version);

  const help = execFileSync(executablePath, ['--help'], { encoding: 'utf8' });
  assert.match(help, /Export Claude Code and Codex sessions to Markdown/);

  console.log(
    `Verified ${packResult.filename}: ${packResult.entryCount} files, ${packResult.size} bytes, installed CLI ${installedVersion}`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
