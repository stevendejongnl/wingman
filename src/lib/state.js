'use strict';
const fs = require('fs');
const path = require('path');

function statePath(cwd) {
  return path.join(cwd, '.claude', 'pair-session.json');
}

function read(cwd) {
  const p = statePath(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function atomicWrite(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function markPending(cwd) {
  const s = {
    active: false,
    pending: true,
    invoked_at: new Date().toISOString()
  };
  atomicWrite(statePath(cwd), s);
  return s;
}

function init(cwd, { task, timerSeconds, whoseTurn, watchCommand }) {
  const s = {
    active: true,
    pending: false,
    task,
    cycle: 1,
    phase: 'red',
    whose_turn: whoseTurn,
    turn_started_at: new Date().toISOString(),
    timer_seconds: timerSeconds,
    watch_command: watchCommand,
    history: []
  };
  atomicWrite(statePath(cwd), s);
  return s;
}

function write(cwd, patch) {
  const current = read(cwd);
  if (!current) {
    throw new Error('No pair session state found at ' + statePath(cwd) + ' - call init() first.');
  }
  const next = Object.assign({}, current, patch);
  atomicWrite(statePath(cwd), next);
  return next;
}

function stop(cwd) {
  return write(cwd, { active: false, pending: false });
}

function cancel(cwd) {
  const current = read(cwd);
  if (current && current.active) {
    throw new Error('Cannot cancel: a pair session is active. Use stop instead.');
  }
  const p = statePath(cwd);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return null;
}

module.exports = { statePath, read, markPending, init, write, stop, cancel };
