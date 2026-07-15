'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'pre-tool-use.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-pre-'));
}

function run(payload) {
  return execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8'
  });
}

test('denies an edit while a pair intent is pending', () => {
  const cwd = tmpDir();
  state.markPending(cwd);
  const out = run({ cwd, tool_name: 'Edit', tool_input: { file_path: 'a.js' } });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /pair start/);
});

test('emits nothing when there is no session', () => {
  const cwd = tmpDir();
  assert.equal(run({ cwd, tool_name: 'Edit', tool_input: { file_path: 'a.js' } }), '');
});

test('denies a write on the human turn of an active session', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 't', timerSeconds: 60, whoseTurn: 'user', watchCommand: 'npm test' });
  const out = run({ cwd, tool_name: 'Write', tool_input: { file_path: 'a.js' } });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('emits nothing on Claude turn of an active session', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 't', timerSeconds: 60, whoseTurn: 'claude', watchCommand: 'npm test' });
  assert.equal(run({ cwd, tool_name: 'Edit', tool_input: { file_path: 'a.js' } }), '');
});

test('silently allows on malformed stdin', () => {
  const out = execFileSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(out, '');
});
