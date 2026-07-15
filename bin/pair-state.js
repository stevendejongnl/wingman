#!/usr/bin/env node
'use strict';
// wingman - CLI wrapper around src/lib/state.js, used by the pair skill's Bash steps.
const state = require('../src/lib/state');

const [, , cmd, cwd, jsonArg] = process.argv;

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

if (!cmd || !cwd) {
  fail('usage: pair-state.js <read|init|write|stop> <cwd> [json]');
}

try {
  let result;
  if (cmd === 'read') {
    result = state.read(cwd);
  } else if (cmd === 'init') {
    result = state.init(cwd, JSON.parse(jsonArg));
  } else if (cmd === 'write') {
    result = state.write(cwd, JSON.parse(jsonArg));
  } else if (cmd === 'stop') {
    result = state.stop(cwd);
  } else {
    fail('unknown command: ' + cmd);
    return;
  }
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  fail(e.message);
}
