'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReminder } = require('../src/lib/format-reminder');

test('returns empty string for null state', () => {
  assert.equal(formatReminder(null), '');
});

test('returns empty string for inactive state', () => {
  assert.equal(formatReminder({ active: false }), '');
});

test('nudges to start or cancel when a pair intent is pending', () => {
  const msg = formatReminder({ active: false, pending: true });
  assert.match(msg, /\/pair start/);
  assert.match(msg, /\/pair cancel/);
  assert.match(msg, /pending/i);
});

test('active reminder forbids solo work outside the turn structure', () => {
  const msg = formatReminder({ active: true, task: 't', cycle: 1, phase: 'red', whose_turn: 'user' });
  assert.match(msg, /do not|don't/i);
});

test('includes task, cycle, phase and whose_turn for an active state', () => {
  const msg = formatReminder({
    active: true,
    task: 'add login',
    cycle: 3,
    phase: 'green',
    whose_turn: 'claude'
  });
  assert.match(msg, /add login/);
  assert.match(msg, /cycle 3/);
  assert.match(msg, /phase green/);
  assert.match(msg, /claude's turn/);
  assert.match(msg, /Only \/pair stop/);
});
