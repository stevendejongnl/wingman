'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'prompt-submit.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-hook-'));
}

test('emits hookSpecificOutput reminder when a session is active', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 'add login', timerSeconds: 60, whoseTurn: 'claude', watchCommand: 'npm test' });
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, prompt: 'anything' }),
    encoding: 'utf8'
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /add login/);
});

test('emits nothing when no session is active', () => {
  const cwd = tmpDir();
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, prompt: 'anything' }),
    encoding: 'utf8'
  });
  assert.equal(out, '');
});

test('silently fails on malformed stdin', () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: 'not json',
    encoding: 'utf8'
  });
  assert.equal(out, '');
});
