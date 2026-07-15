'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { detect } = require('../src/lib/detect-test-command');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-detect-'));
}

const CLI = path.join(__dirname, '..', 'bin', 'pair-detect.js');

test('detects vitest watch command from package.json', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^1.0.0' }
  }));
  const result = detect(cwd);
  assert.equal(result.stack, 'node');
  assert.equal(result.testCmd, 'npm test');
  assert.equal(result.watchCmd, 'npx vitest');
});

test('detects jest watch command from package.json', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'jest' },
    devDependencies: { jest: '^29.0.0' }
  }));
  const result = detect(cwd);
  assert.equal(result.watchCmd, 'npx jest --watch');
});

test('node project with no known watch tool returns null watchCmd', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' }
  }));
  const result = detect(cwd);
  assert.equal(result.stack, 'node');
  assert.equal(result.testCmd, 'npm test');
  assert.equal(result.watchCmd, null);
});

test('detects rust from Cargo.toml', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Cargo.toml'), '[package]\nname = "x"\n');
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' });
});

test('detects python from Makefile', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Makefile'), 'test:\n\tpytest\n');
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'python', testCmd: 'make test', watchCmd: 'ptw' });
});

test('does not throw when package.json parses to a non-object primitive', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), 'null');
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'node', testCmd: null, watchCmd: null });
});

test('returns unknown stack for an empty directory', () => {
  const cwd = tmpDir();
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'unknown', testCmd: null, watchCmd: null });
});

test('CLI prints detection result as JSON', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Cargo.toml'), '[package]\nname = "x"\n');
  const out = execFileSync(process.execPath, [CLI, cwd], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' });
});
