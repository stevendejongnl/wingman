---
name: pair
description: Start, run, and manage a TDD ping-pong pairing session with Claude - strict red/green/refactor discipline, alternating test/impl roles, sticky until /pair stop. Use when the user says "/pair", "let's pair on X", "start a pairing session", or similar.
allowed-tools: Bash, Monitor, ScheduleWakeup, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Pair (wingman)

A TDD ping-pong pairing session: roles alternate every red/green/refactor
cycle, a background test watcher detects when a human turn is done, an
optional timer nudges if a turn runs long, and every phase that produces a
change lands as its own commit.

All state lives at `.claude/pair-session.json` in the *current project*
(not the wingman plugin repo). Read/write it only through the CLI wrappers
below - never hand-edit the JSON - so writes stay atomic and consistent:

- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" read <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" init <cwd> '<json>'`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" write <cwd> '<json patch>'`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" stop <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-detect.js" <cwd>` - detect test/watch command

## `/pair start <task description>`

1. Run `pair-detect.js` on the current directory. If `watchCmd` is `null`,
   tell the user no watch-mode tool was found for this stack and ask how
   they want turn-completion detected instead of guessing.
2. Ask (one question): default turn timer length in minutes (a nudge only,
   never forced), and who writes cycle 1's test - the user or Claude.
3. Launch the watch command in the background with `Bash`
   (`run_in_background: true`).
4. Call `pair-state.js init` with `{task, timerSeconds, whoseTurn, watchCommand}`.
5. Announce the session is active, state the cycle 1 assignment, and proceed
   to the cycle loop below.

## Cycle loop

Each cycle has three phases. At the *start* of each cycle, state the derived
ping-pong assignment (whoever just implemented writes the next test; their
partner implements it) and ask the user to confirm or override before
continuing - never assume silently.

**Red phase** (`phase: "red"`):
- If it's Claude's turn to write the test: write a small failing test,
  run it once to confirm it fails, then continue to the next step.
- If it's the user's turn: attach `Monitor` to the background watcher.
  Wait - do not poll or nag - until the watcher output shows a new failing
  test. That is the signal the turn is done.
- Once red is confirmed, commit: `git commit -m "test: cycle N red (author)"`
  where `author` is whoever just wrote it.
- Call `pair-state.js write` with `{"phase": "green", "whose_turn": "<other
  person>"}` - implementation duty passes to the partner in ping-pong TDD.
- If it's now the user's turn, call `ScheduleWakeup` for the configured
  timer. If it fires before green is seen, post a single nudge ("still
  going? just checking in") and re-arm once; never force anything.

**Green phase** (`phase: "green"`):
- Same pattern as red: either Claude writes the minimal implementation, or
  `Monitor` watches for the watcher to report the suite green.
- Commit: `git commit -m "impl: cycle N green (author)"`.
- Call `pair-state.js write` with `{"phase": "refactor"}`.

**Refactor phase** (`phase: "refactor"`):
- Either person may refactor, or skip it. Ask if unclear.
- If changes were made and the watcher still reports green, commit:
  `git commit -m "refactor: cycle N (author)"`. If no changes were made,
  skip the commit entirely.
- Call `pair-state.js write` with `{"cycle": N+1, "phase": "red"}` and
  append the cycle's entries to `history`.
- Move to the next cycle's assignment-confirmation step above.

## Consulting agents

During either person's turn, you may spawn read-only helper agents
(`Explore`, `cavecrew-investigator`, or a reviewer-style agent) for
suggestions or navigation - think of them as a colleague chiming in, not a
second driver. They must never edit files, commit, or call
`pair-state.js write` - advisory output only, folded back into the
conversation.

## Failure handling

- **No watch-mode tool for this stack** (`pair-detect.js` returns
  `watchCmd: null`): ask the user how to detect turn completion instead of
  guessing or silently falling back to a typed keyword.
- **Watcher process dies mid-session**: `Monitor` will show the process
  ending/erroring. Report this to the user and ask whether to restart the
  watcher or fall back to the user saying "done" for the rest of the
  session - don't restart silently.
- **Ambiguous red/green signal** (watcher output doesn't clearly show a
  single, unambiguous transition): ask which test/result it refers to
  rather than guessing.
- **Before any commit**: run `git status`/`git diff` first. If there are
  changes beyond what this phase's turn produced, surface them and ask
  before staging - never bundle unexpected changes into a phase commit.

## Discussion

Free-form discussion is always allowed, in between or after any cycle. It
does not pause or end the session - only `/pair stop` or a new Claude Code
session does that. If the conversation drifts, the `UserPromptSubmit` hook
reminder keeps the active cycle/phase/turn visible so you don't lose track.

## `/pair status`

Run `pair-state.js read <cwd>` and summarize: task, cycle, phase, whose
turn, and how many commits have landed so far (`history.length`).

## `/pair swap`

Manually override whose turn it is for the *current* phase only:
`pair-state.js write` with `{"whose_turn": "<other person>"}`. Confirm the
new assignment out loud.

## `/pair stop`

Run `pair-state.js stop <cwd>`, kill the background watcher process, and
confirm the session has ended. This is the only in-conversation way out -
do not treat any other phrase as ending the session.
