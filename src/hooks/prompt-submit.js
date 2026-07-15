#!/usr/bin/env node
'use strict';
const { read } = require('../lib/state');
const { formatReminder } = require('../lib/format-reminder');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    const state = read(cwd);
    const message = formatReminder(state);
    if (message) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: message
        }
      }));
    }
  } catch (e) {
    // silent fail
  }
});
