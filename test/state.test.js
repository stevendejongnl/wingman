'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-state-'));
}

const CLI = path.join(__dirname, '..', 'bin', 'pair-state.js');

test('read returns null when no state file exists', () => {
  const cwd = tmpDir();
  assert.equal(state.read(cwd), null);
});

test('init writes initial state and read returns it', () => {
  const cwd = tmpDir();
  const s = state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  assert.equal(s.active, true);
  assert.equal(s.cycle, 1);
  assert.equal(s.phase, 'red');
  assert.equal(s.whose_turn, 'user');
  assert.deepEqual(s.history, []);
  assert.deepEqual(state.read(cwd), s);
});

test('write merges a patch into existing state, leaving other fields untouched', () => {
  const cwd = tmpDir();
  state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  const updated = state.write(cwd, { phase: 'green', whose_turn: 'claude' });
  assert.equal(updated.phase, 'green');
  assert.equal(updated.whose_turn, 'claude');
  assert.equal(updated.task, 'add login');
});

test('write throws if init was never called', () => {
  const cwd = tmpDir();
  assert.throws(() => state.write(cwd, { phase: 'green' }), /No pair session state found/);
});

test('stop sets active to false and preserves history', () => {
  const cwd = tmpDir();
  state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  state.write(cwd, { history: [{ cycle: 1, phase: 'red', author: 'user' }] });
  const stopped = state.stop(cwd);
  assert.equal(stopped.active, false);
  assert.equal(stopped.history.length, 1);
});

test('CLI init/read/write/stop round-trip', () => {
  const cwd = tmpDir();
  const initOut = execFileSync(process.execPath, [CLI, 'init', cwd, JSON.stringify({
    task: 't', timerSeconds: 60, whoseTurn: 'user', watchCommand: 'npm test'
  })], { encoding: 'utf8' });
  const initState = JSON.parse(initOut);
  assert.equal(initState.active, true);

  const readOut = execFileSync(process.execPath, [CLI, 'read', cwd], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(readOut), initState);

  const writeOut = execFileSync(process.execPath, [CLI, 'write', cwd, JSON.stringify({ phase: 'green' })], { encoding: 'utf8' });
  assert.equal(JSON.parse(writeOut).phase, 'green');

  const stopOut = execFileSync(process.execPath, [CLI, 'stop', cwd], { encoding: 'utf8' });
  assert.equal(JSON.parse(stopOut).active, false);
});
