'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'session-start.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-hook-'));
}

test('prints reminder when an active session exists', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 'add login', timerSeconds: 60, whoseTurn: 'user', watchCommand: 'npm test' });
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: 'utf8'
  });
  assert.match(out, /WINGMAN PAIR SESSION ACTIVE/);
  assert.match(out, /add login/);
});

test('prints nothing when no session state exists', () => {
  const cwd = tmpDir();
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: 'utf8'
  });
  assert.equal(out, '');
});

test('prints nothing and does not throw on empty stdin', () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: '',
    encoding: 'utf8'
  });
  assert.equal(out, '');
});
