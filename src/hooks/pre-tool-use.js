#!/usr/bin/env node
'use strict';
const { read } = require('../lib/state');
const { evaluate } = require('../lib/guard');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    const state = read(cwd);
    const result = evaluate(state, data.tool_name, data.tool_input);
    if (result.decision === 'deny') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason
        }
      }));
    }
  } catch (e) {
    // silent fail - never block a tool call on a hook error
  }
});
