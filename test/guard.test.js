'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/lib/guard');

test('allows anything when there is no state', () => {
  assert.equal(evaluate(null, 'Edit', { file_path: 'a.js' }).decision, 'allow');
});

test('allows anything when the session is stopped (inactive, not pending)', () => {
  assert.equal(evaluate({ active: false, pending: false }, 'Write', {}).decision, 'allow');
});

test('denies edits while a pair intent is pending', () => {
  const r = evaluate({ active: false, pending: true }, 'Edit', { file_path: 'a.js' });
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /pair start/);
});

test('denies writes while pending', () => {
  assert.equal(evaluate({ active: false, pending: true }, 'Write', {}).decision, 'deny');
});

test('denies git commit via Bash while pending', () => {
  const r = evaluate({ active: false, pending: true }, 'Bash', { command: 'git commit -m "x"' });
  assert.equal(r.decision, 'deny');
});

test('allows running tests via Bash while pending', () => {
  assert.equal(evaluate({ active: false, pending: true }, 'Bash', { command: 'npm test' }).decision, 'allow');
});

test('allows reads while pending', () => {
  assert.equal(evaluate({ active: false, pending: true }, 'Read', { file_path: 'a.js' }).decision, 'allow');
});

test('denies Claude edits when it is the human turn in an active session', () => {
  const s = { active: true, pending: false, whose_turn: 'user', cycle: 2, phase: 'green' };
  const r = evaluate(s, 'Edit', { file_path: 'a.js' });
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /human's turn/);
});

test('allows Claude edits when it is Claude turn in an active session', () => {
  const s = { active: true, pending: false, whose_turn: 'claude', cycle: 1, phase: 'red' };
  assert.equal(evaluate(s, 'Edit', { file_path: 'a.js' }).decision, 'allow');
});

test('denies git commit on the human turn', () => {
  const s = { active: true, pending: false, whose_turn: 'user', cycle: 1, phase: 'red' };
  assert.equal(evaluate(s, 'Bash', { command: 'git commit -m "x"' }).decision, 'deny');
});

test('allows tests on the human turn (watcher needs them)', () => {
  const s = { active: true, pending: false, whose_turn: 'user', cycle: 1, phase: 'red' };
  assert.equal(evaluate(s, 'Bash', { command: 'npx vitest' }).decision, 'allow');
});
