# wingman — TDD ping-pong pairing plugin

Date: 2026-07-15

## Overview

`wingman` is a Claude Code plugin that turns a session into a real pair-programming
partner for strict red/green/refactor TDD. Roles (test-writer / implementer)
alternate ping-pong style each cycle. The session is sticky: once started, it
stays active across turns until explicitly stopped or the Claude Code session
ends — it does not silently drift back to normal assistant behavior. A
background test watcher detects when a human turn is done (no typed "done"
needed), an optional per-turn timer nudges if a turn runs long, and Claude may
call in read-only subagents as advisory "colleagues" during either person's
turn. Every red/green/refactor step lands as its own commit.

## Architecture

Modeled on the existing `caveman`/`ponytail` plugins already installed for this
user: a `plugin.json` registers `SessionStart` and `UserPromptSubmit` hooks
that read/write a small JSON state file and inject a persistent reminder into
context. `wingman` follows the same shape, plus a background test-watch
process and scheduled timer wakeups.

```
wingman/
  .claude-plugin/plugin.json      # hook registration
  commands/pair.md                 # /pair slash command (start/status/swap/stop)
  src/hooks/
    wingman-session-start.js       # SessionStart: inject state if active
    wingman-prompt-submit.js       # UserPromptSubmit: re-inject reminder
  src/lib/
    state.js                       # read/write .claude/pair-session.json
    test-command.js                # detect test command per CLAUDE.md tech stack
  docs/superpowers/specs/           # this file
```

## Components

### 1. State file

Per-project file: `.claude/pair-session.json` (gitignored — local session
state, not shared history):

```json
{
  "active": true,
  "task": "short description of what's being built",
  "cycle": 4,
  "phase": "red | green | refactor",
  "whose_turn": "claude | user",
  "turn_started_at": "<ISO timestamp, stamped at turn start>",
  "timer_seconds": 1200,
  "watch_command": "pytest-watch",
  "history": [
    {"cycle": 1, "phase": "red", "author": "claude", "commit": "<sha>"}
  ]
}
```

### 2. `/pair start <task>`

- Detects the project's test command from the tech-stack table in CLAUDE.md
  (pytest/`make test`, `npm test`, `cargo test`, `npm run test:pw`, etc.) and
  maps it to a watch-mode equivalent (`pytest-watch`, `npm test -- --watch`,
  `cargo watch -x test`, `vitest`). If no watch-mode tool is available, asks
  the user how to proceed rather than guessing.
- Asks: default turn timer length, and who writes cycle 1's test.
- Launches the watch command in the background (`Bash` with
  `run_in_background`).
- Writes the initial state file.

### 3. Sticky mode (hooks)

- `SessionStart`: if `.claude/pair-session.json` exists and `active: true`,
  inject a context reminder: current cycle, phase, whose turn, task.
- `UserPromptSubmit`: re-inject the same reminder every turn, so mid-session
  compaction or a long unrelated tangent never causes Claude to quietly treat
  the pairing session as over.
- The only ways out: `/pair stop` (sets `active: false` and kills the
  watcher), or ending the Claude Code session entirely. Free discussion
  in-between or after cycles is always allowed — the reminder does not block
  conversation, it only prevents Claude from silently exiting the pairing
  structure.

### 4. Turn engine

- Ping-pong derivation: whoever wrote cycle N's test implements cycle N and
  writes cycle N+1's test; the other person implements cycle N+1's test and
  writes cycle N+2's — i.e., roles swap every cycle.
- At the start of each cycle, Claude states the derived next assignment and
  asks for confirmation rather than silently assuming (per your preference)
  — a one-line yes/override check, not a full requirements dialogue.

### 5. Auto turn-detection

- Claude attaches `Monitor` to the background watcher process started in
  step 2.
- A red→green transition, or a new failing test appearing, in the watcher
  output is the signal that the human's turn is complete — no typed keyword
  required.
- When it's Claude's own turn, Claude writes the test/impl directly and then
  advances the state file itself.

### 6. Timer (nudge-only)

- When `whose_turn` becomes `"user"`, Claude calls `ScheduleWakeup` for
  `timer_seconds`.
- If the wakeup fires before the watcher reports green, Claude posts a single
  nudge ("still going? just checking in") and re-arms once more. No forced
  swap, no auto-commit, no penalty — purely a pace check, since forcing
  anything would step on how the human actually works.

### 7. Consulting agents

- During either person's turn, Claude may spawn read-only helper agents
  (`Explore`, `cavecrew-investigator`, a reviewer-style agent) for
  suggestions or code navigation — framed as consulting a colleague, not as a
  second driver.
- These agents never edit files, author commits, or advance the turn state.
  They only return information/suggestions into the conversation.

### 8. Commits

- Three commits per cycle, each created only for the phase that actually
  produced a change:
  - `test: cycle N red (author)` — the failing test.
  - `impl: cycle N green (author)` — the minimal change that makes it pass.
  - `refactor: cycle N (author)` — only if refactor changes were made; if the
    refactor step is a no-op, no commit is created for it.
- `author` is whichever of `claude`/`user` wrote that phase, taken from the
  state file's `whose_turn` at the time.

## Data flow (one full cycle)

1. State: `phase: red`, `whose_turn: X`. X writes a failing test in their own
   editor (or Claude writes it, if X is Claude).
2. Watcher reports the new test failing → confirms red. Commit `test: cycle N
   red (X)`.
3. State flips to `phase: green`, `whose_turn` flips to the other person —
   in ping-pong TDD, whoever wrote the failing test hands implementation
   duty to their partner.
4. Watcher reports green → commit `impl: cycle N green (other)`.
5. Either person may refactor. If changes are made and tests stay green,
   commit `refactor: cycle N (whoever changed it)`.
6. Cycle increments. Claude proposes the next test-writer (the person who
   just implemented, per ping-pong) and confirms before continuing.

## Error handling

- **No watch-mode tool available for the stack**: ask the user how to detect
  turn completion instead of guessing or silently falling back to a typed
  keyword.
- **Watcher process dies**: Claude notices via `Monitor` closing/erroring,
  reports it, and asks whether to restart the watcher or fall back to manual
  "done" signaling for the rest of the session.
- **Uncommitted, unexpected changes found when a phase completes**: follow
  standard git safety — `git status`/`git diff` before staging, never force
  anything.
- **Ambiguous red/green signal** (e.g., watcher output doesn't clearly show a
  single transition): Claude asks rather than guessing which test flipped.

## Testing

- Since this plugin's own logic is hook scripts + state management (not a
  product with a runtime UI), verification is:
  - Unit-style checks on `state.js` read/write and `test-command.js`
    detection logic (plain assert-based checks, per lazy-but-covered
    practice — no test framework scaffolding beyond what the hook scripts
    already need).
  - A manual dry run of `/pair start` on a small real task in one project
    from each stack (Python/pytest, Node/npm) to confirm: watcher launches,
    hook reminder persists across a `/clear`-equivalent, timer nudge fires,
    commits land with the right messages.

## Out of scope (for this first version)

- Automatic swapping/forcing when the timer expires (nudge only, per your
  answer).
- Multi-person (>2 participant) pairing rotations.
- IDE-side plugins/extensions — this is CLI/Claude-Code-only.
