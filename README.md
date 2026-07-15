# wingman

A Claude Code plugin that turns a session into a real TDD pairing partner:
strict red/green/refactor discipline, roles alternating ping-pong style every
cycle, and a sticky session that stays active until you explicitly end it.

## What it does

- Roles swap every cycle: whoever wrote a cycle's test hands the
  implementation to their partner, who then writes the next cycle's test.
- A background test watcher detects when your turn is done - no typed
  "done" needed.
- An optional per-turn timer posts a nudge if a turn runs long. It never
  forces a swap or a commit - it's a pace check, not an enforcer.
- Free discussion is always allowed, in between or after any cycle. The
  session only ends via `/pair stop` or a new Claude Code session - it will
  not silently drift back to normal assistant behavior mid-conversation.
- Every phase that produces a change lands as its own commit: `test: cycle N
  red (author)`, `impl: cycle N green (author)`, `refactor: cycle N (author)`
  (refactor commit only if something actually changed).
- During either person's turn, Claude may consult read-only subagents
  (a code explorer, a reviewer) for suggestions - they never edit files,
  commit, or take over the turn.

## Install

Install as a Claude Code plugin from this repo's GitHub marketplace:

```
/plugin marketplace add stevendejongnl/wingman
/plugin install wingman@wingman
```

The plugin registers two hooks (`SessionStart`, `UserPromptSubmit`) that make
the pair session sticky, and a `pair` skill that drives the actual workflow.

For local development, install from a checkout path instead:
`/plugin install /path/to/wingman`.

## Requirements

- Node.js >= 18 (the plugin's own hooks/CLIs run under Node).
- A project with a test command wingman can detect: Node (`package.json`),
  Rust (`Cargo.toml`), or Python (`Makefile` with a `test` target, or
  `pyproject.toml`). If none of these match, `/pair start` will ask how to
  detect turn completion instead of guessing.

## Usage

```
/pair start <task description>
```

Detects your project's test/watch command, asks for a turn timer length and
who writes the first test, launches the watcher in the background, and
starts cycle 1.

```
/pair status
```

Shows the current task, cycle, phase, whose turn it is, and how many
commits have landed so far.

```
/pair swap
```

Manually overrides whose turn it is for the current phase.

```
/pair stop
```

Ends the session: stops the watcher, marks the session inactive. This is
the only way to end a session short of starting a new Claude Code session.

## How it's built

- `src/lib/state.js` - reads/writes the session state file
  (`.claude/pair-session.json` in whatever project you're pairing on, never
  inside this plugin's own repo).
- `src/lib/detect-test-command.js` - detects the project's stack and
  test/watch commands.
- `src/lib/format-reminder.js` - formats the sticky-session reminder text.
- `bin/pair-state.js`, `bin/pair-detect.js` - CLI wrappers around the above,
  used by the `pair` skill's Bash steps so state is never hand-edited.
- `src/hooks/session-start.js`, `src/hooks/prompt-submit.js` - the two hooks
  that keep the session sticky across turns.
- `skills/pair/SKILL.md` - the actual orchestration: the cycle loop, turn
  confirmation, timer, consulting agents, commit scheme, and failure
  handling.

Design spec and implementation plan are under `docs/superpowers/`.

## Tests

```
npm test
```

Runs the full suite with Node's built-in test runner (`node --test`) - no
external test framework dependency.
