'use strict';

const FILE_MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMIT_RE = /\bgit\s+(commit|push)\b/;

function isMutating(toolName, toolInput) {
  if (FILE_MUTATING_TOOLS.has(toolName)) return true;
  if (toolName === 'Bash') return COMMIT_RE.test((toolInput && toolInput.command) || '');
  return false;
}

function evaluate(state, toolName, toolInput) {
  if (!state) return { decision: 'allow' };
  if (!isMutating(toolName, toolInput)) return { decision: 'allow' };

  if (state.pending && !state.active) {
    return {
      decision: 'deny',
      reason:
        'A wingman pair session is pending but not started. Run `/pair start <task>` to begin ' +
        'the TDD ping-pong session (the task you were about to work on is what to start on), or ' +
        '`/pair cancel` to drop the pairing. No edits or commits until then.'
    };
  }

  if (state.active && state.whose_turn === 'user') {
    return {
      decision: 'deny',
      reason:
        'It is the human\'s turn in the wingman pair session (cycle ' + state.cycle +
        ', ' + state.phase + ' phase). Wait for them to finish their turn. To take over, use ' +
        '`/pair swap`; to end the session, use `/pair stop`.'
    };
  }

  return { decision: 'allow' };
}

module.exports = { evaluate, isMutating };
