'use strict';

function formatReminder(state) {
  if (!state || !state.active) return '';
  return 'WINGMAN PAIR SESSION ACTIVE — task: ' + state.task +
    ' | cycle ' + state.cycle +
    ' | phase ' + state.phase +
    ' | ' + state.whose_turn + '\'s turn. ' +
    'Only /pair stop or a new Claude Code session ends this — free discussion ' +
    'in between or after cycles is fine, just don\'t silently drop the pairing structure.';
}

module.exports = { formatReminder };
