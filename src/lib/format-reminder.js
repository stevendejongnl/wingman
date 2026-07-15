'use strict';

function formatReminder(state) {
  if (!state) return '';

  if (!state.active && state.pending) {
    return 'WINGMAN PAIR INTENT PENDING - you invoked /pair but no session is started. ' +
      'Do NOT write code, edit files, or commit yet. Your only next step is to run ' +
      '/pair start <task> to begin the TDD ping-pong session (a task the user just ' +
      'described is what to start ON, not something to build solo), or /pair cancel to ' +
      'drop the pairing.';
  }

  if (!state.active) return '';

  return 'WINGMAN PAIR SESSION ACTIVE - task: ' + state.task +
    ' | cycle ' + state.cycle +
    ' | phase ' + state.phase +
    ' | ' + state.whose_turn + '\'s turn. ' +
    'Only /pair stop or a new Claude Code session ends this. Free discussion between ' +
    'cycles is fine, but do NOT write tests, implementation, or commits outside the current ' +
    'red/green/refactor turn, and never silently drop the pairing structure to just build the task.';
}

module.exports = { formatReminder };
