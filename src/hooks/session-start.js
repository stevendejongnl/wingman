#!/usr/bin/env node
'use strict';
const { read } = require('../lib/state');
const { formatReminder } = require('../lib/format-reminder');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    let cwd = process.cwd();
    if (input.trim()) {
      const data = JSON.parse(input);
      if (data.cwd) cwd = data.cwd;
    }
    const state = read(cwd);
    const message = formatReminder(state);
    if (message) process.stdout.write(message);
  } catch (e) {
    // silent fail - never block session start
  }
});
