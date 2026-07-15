---
name: pair
description: Start, run, and manage a TDD ping-pong pairing session with Claude - strict red/green/refactor discipline, alternating test/impl roles, sticky until /pair stop. Use when the user says "/pair", "let's pair on X", "start a pairing session", or similar.
allowed-tools: Bash, Monitor, ScheduleWakeup, AskUserQuestion, Read, Edit, Write, Grep, Glob, Agent, TaskStop
---

# Pair (wingman)

A TDD ping-pong pairing session: roles alternate every red/green/refactor
cycle, a background test watcher detects when a human turn is done, an
optional timer nudges if a turn runs long, and every phase that produces a
change lands as its own commit.

## The one rule (read first)

The moment `/pair` is invoked you are in a pairing context, and the whole
point of this skill is that you do **not** silently go build things solo.

- Do NOT write or edit code, run mutating commands, or commit **until a
  session is actually started** (`/pair start`) or the user explicitly
  declines pairing (`/pair cancel`).
- If the user invokes `/pair` and then, in the same or next message,
  describes a task ("continue with X", "let's fix Y"), that task is what to
  **start the session ON** - it is NOT permission to implement it directly.
  Run `/pair start <that task>`.
- Another skill or command running in between (e.g. `/handoff`) does not
  cancel this. Reading a handoff is fine; acting on it solo is not.

A `PreToolUse` hook enforces this: while an intent is pending or it is the
human's turn, edits and commits are blocked. If a tool call is denied with a
wingman message, that is the guard - follow it, do not try to route around
it.

All state lives at `.claude/pair-session.json` in the *current project*
(not the wingman plugin repo). Read/write it only through the CLI wrappers
below - never hand-edit the JSON - so writes stay atomic and consistent:

- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" read <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" pending <cwd>` - record a not-yet-started intent
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" init <cwd> '<json>'` - start a session (clears pending)
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" write <cwd> '<json patch>'`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" stop <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" cancel <cwd>` - drop a pending intent (only when not active)
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-detect.js" <cwd>` - detect test/watch command

## `/pair` (no subcommand)

The user wants to pair but hasn't scoped a task yet.

1. Run `pair-state.js pending <cwd>` to record the intent. From now the
   guard blocks solo edits/commits until you start or cancel.
2. Ask what to pair on (one short question). When the user answers with a
   task - even via another command like `/handoff` - treat it as the
   argument to `/pair start` and go to that section. Do not implement it
   yourself.
3. If the user says they don't want to pair after all, run
   `pair-state.js cancel <cwd>` and continue normally.

## `/pair start <task description>`

1. Run `pair-detect.js` on the current directory. If `watchCmd` is `null`,
   tell the user no watch-mode tool was found for this stack and ask how
   they want turn-completion detected instead of guessing.
2. Ask (one question): default turn timer length in minutes (a nudge only,
   never forced), and who writes cycle 1's test - the user or Claude.
   Multiply the user's answer (in minutes) by 60 to get seconds - this is
   the `timerSeconds` value used below; never pass the raw minutes value.
3. Launch the watch command in the background with `Bash`
   (`run_in_background: true`). The Bash tool call returns a task ID for
   this background process - capture it, you'll need it in `/pair stop`.
4. Call `pair-state.js init` with `{task, timerSeconds, whoseTurn, watchCommand}`,
   where `timerSeconds` is the minutes-times-60 value from step 2. Then, in
   a separate `pair-state.js write` call, persist the detected `testCmd`
   (from step 1) and the background task ID (from step 3):
   `pair-state.js write <cwd> '{"test_cmd": "<testCmd>", "watch_task_id": "<id>"}'`.
5. Announce the session is active, state the cycle 1 assignment, and proceed
   to the cycle loop below.

## Cycle loop

Each cycle has three phases. At the *start* of each cycle, state the derived
ping-pong assignment (whoever just implemented writes the next test; their
partner implements it) and ask the user to confirm or override before
continuing - never assume silently.

After every commit in any phase below, update `history` using a
read-modify-write pattern - `write()` does a shallow patch, so passing
`{"history": [...]}` replaces the whole array rather than appending. Never
batch this at cycle end:

1. Run `git rev-parse HEAD` to get the commit SHA that was just created.
2. Run `pair-state.js read <cwd>` to get the current state, including its
   `history` array.
3. Build the new array in memory: the current array plus one new entry
   `{"cycle": N, "phase": "<red|green|refactor>", "author": "<user|claude>",
   "commit": "<sha>"}`.
4. Fold that full new array into the same `pair-state.js write` call that
   already advances `phase`/`whose_turn`/`cycle` for this step - don't add
   an extra write() round-trip just for history.

**Red phase** (`phase: "red"`):
- If it's Claude's turn to write the test: write a small failing test,
  then run the persisted `test_cmd` (from state, via `Bash`) once to
  confirm it fails, then continue to the next step.
- If it's the user's turn: attach `Monitor` to the background watcher.
  Wait - do not poll or nag - until the watcher output shows a new failing
  test. That is the signal the turn is done.
- Once red is confirmed, commit: `git commit -m "test: cycle N red (author)"`
  where `author` is whoever just wrote it.
- Follow the history read-modify-write pattern above, then call
  `pair-state.js write` with `{"phase": "green", "whose_turn": "<other
  person>", "history": [...]}` - implementation duty passes to the partner
  in ping-pong TDD.
- If it's now the user's turn, call `ScheduleWakeup` for the configured
  timer. If it fires before green is seen, post a single nudge ("still
  going? just checking in") and re-arm once; never force anything.

**Green phase** (`phase: "green"`):
- Same pattern as red: either Claude writes the minimal implementation and
  runs the persisted `test_cmd` (via `Bash`) once to confirm it passes, or
  `Monitor` watches for the watcher to report the suite green.
- Commit: `git commit -m "impl: cycle N green (author)"`.
- Follow the history read-modify-write pattern above, then call
  `pair-state.js write` with `{"phase": "refactor", "history": [...]}`.

**Refactor phase** (`phase: "refactor"`):
- Either person may refactor, or skip it. Ask if unclear.
- If changes were made and the watcher still reports green, commit:
  `git commit -m "refactor: cycle N (author)"`. If no changes were made,
  skip the commit entirely (and skip the history update below too - there
  is no new commit to record).
- Follow the history read-modify-write pattern above, then call
  `pair-state.js write` with `{"cycle": N+1, "phase": "red", "history":
  [...]}`.
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

Read state to get the persisted `watch_task_id` (captured in `/pair start`
step 3), then call `TaskStop` with that task ID to actually terminate the
background watcher. Then run `pair-state.js stop <cwd>` and confirm the
session has ended. This is the only in-conversation way out - do not treat
any other phrase as ending the session.

## `/pair cancel`

Drop a *pending* intent (from a bare `/pair`) without ever starting a
session: run `pair-state.js cancel <cwd>` and confirm normal (non-paired)
work can resume. If a session is already active, `cancel` refuses - use
`/pair stop` instead.
