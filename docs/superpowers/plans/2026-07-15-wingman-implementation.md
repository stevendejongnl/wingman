# Wingman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `wingman` Claude Code plugin — a sticky TDD ping-pong pairing partner with red/green/refactor discipline, alternating roles, watcher-driven turn detection, a nudge-only timer, advisory subagents, and 3 commits per cycle.

**Architecture:** A small set of pure Node lib functions (state store, test-stack detection, reminder formatting) exercised through thin CLI wrappers and two Claude Code hooks (`SessionStart`, `UserPromptSubmit`) for session stickiness, plus a `pair` skill that carries the actual conversational orchestration (asking questions, launching the watcher, scheduling nudges, committing).

**Tech Stack:** Node.js (CommonJS, `node:test` + `node:assert/strict` for tests — no test framework dependency), Claude Code plugin hooks, Claude Code skills.

## Global Constraints

- Node >=18, CommonJS modules (`"type": "commonjs"` in package.json).
- Tests use only `node:test` / `node:assert/strict` — no jest/mocha/vitest dependency for this repo's own tests.
- Session state file lives at `<project-cwd>/.claude/pair-session.json` — inside whatever project is being paired on, never inside the wingman plugin repo itself.
- All hook scripts must silent-fail on any error (malformed stdin, missing state, etc.) — never throw in a way that blocks `SessionStart` or `UserPromptSubmit`.
- Commit scheme: 3 commits per cycle — `test: cycle N red (author)`, `impl: cycle N green (author)`, `refactor: cycle N (author)`. The refactor commit is only created if refactor changes were actually made.
- Timer is nudge-only — it must never force a role swap, auto-commit, or any other side effect beyond posting a reminder.
- Ping-pong role derivation is proposed by Claude at the start of each cycle but always confirmed with the user before continuing — never silently assumed.
- Consulting subagents (e.g. `Explore`, `cavecrew-investigator`, a reviewer agent) are advisory only during either person's turn — they never edit files, author commits, or advance turn state.
- This repo (`~/workspace/personal/apps/wingman`) is a new standalone git repo, to be pushed to a **private** GitHub repository.

---

### Task 1: Repo & plugin scaffold

**Files:**
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: the plugin manifest referencing `${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.js` and `${CLAUDE_PLUGIN_ROOT}/src/hooks/prompt-submit.js` — later tasks must create files at exactly those paths.
- Produces: `npm test` script that later tasks' tests must satisfy.

This is pure scaffolding — no logic to test.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wingman",
  "version": "0.1.0",
  "private": true,
  "description": "TDD ping-pong pairing plugin for Claude Code",
  "type": "commonjs",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "wingman",
  "description": "TDD ping-pong pairing partner — sticky pair-programming sessions with red/green/refactor discipline.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.js\"",
            "timeout": 5,
            "statusMessage": "Checking wingman pair session..."
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/hooks/prompt-submit.js\"",
            "timeout": 5,
            "statusMessage": "Tracking wingman pair session..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Commit**

```bash
git add package.json .claude-plugin/plugin.json .gitignore
git commit -m "chore: scaffold wingman plugin"
```

---

### Task 2: State store library + CLI

**Files:**
- Create: `src/lib/state.js`
- Create: `bin/pair-state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 5, 6, 7):
  - `state.statePath(cwd) => string`
  - `state.read(cwd) => object | null`
  - `state.init(cwd, { task, timerSeconds, whoseTurn, watchCommand }) => object`
  - `state.write(cwd, patch) => object` (throws `Error` containing `"No pair session state found"` if `init` was never called)
  - `state.stop(cwd) => object`
  - CLI: `node bin/pair-state.js <read|init|write|stop> <cwd> [json]` — prints the resulting state (or `null` for `read` on a missing file) as JSON on stdout; on error, prints the message to stderr and exits 1.

- [ ] **Step 1: Write the failing tests**

Create `test/state.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-state-'));
}

const CLI = path.join(__dirname, '..', 'bin', 'pair-state.js');

test('read returns null when no state file exists', () => {
  const cwd = tmpDir();
  assert.equal(state.read(cwd), null);
});

test('init writes initial state and read returns it', () => {
  const cwd = tmpDir();
  const s = state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  assert.equal(s.active, true);
  assert.equal(s.cycle, 1);
  assert.equal(s.phase, 'red');
  assert.equal(s.whose_turn, 'user');
  assert.deepEqual(s.history, []);
  assert.deepEqual(state.read(cwd), s);
});

test('write merges a patch into existing state, leaving other fields untouched', () => {
  const cwd = tmpDir();
  state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  const updated = state.write(cwd, { phase: 'green', whose_turn: 'claude' });
  assert.equal(updated.phase, 'green');
  assert.equal(updated.whose_turn, 'claude');
  assert.equal(updated.task, 'add login');
});

test('write throws if init was never called', () => {
  const cwd = tmpDir();
  assert.throws(() => state.write(cwd, { phase: 'green' }), /No pair session state found/);
});

test('stop sets active to false and preserves history', () => {
  const cwd = tmpDir();
  state.init(cwd, {
    task: 'add login',
    timerSeconds: 1200,
    whoseTurn: 'user',
    watchCommand: 'npm test -- --watch'
  });
  state.write(cwd, { history: [{ cycle: 1, phase: 'red', author: 'user' }] });
  const stopped = state.stop(cwd);
  assert.equal(stopped.active, false);
  assert.equal(stopped.history.length, 1);
});

test('CLI init/read/write/stop round-trip', () => {
  const cwd = tmpDir();
  const initOut = execFileSync(process.execPath, [CLI, 'init', cwd, JSON.stringify({
    task: 't', timerSeconds: 60, whoseTurn: 'user', watchCommand: 'npm test'
  })], { encoding: 'utf8' });
  const initState = JSON.parse(initOut);
  assert.equal(initState.active, true);

  const readOut = execFileSync(process.execPath, [CLI, 'read', cwd], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(readOut), initState);

  const writeOut = execFileSync(process.execPath, [CLI, 'write', cwd, JSON.stringify({ phase: 'green' })], { encoding: 'utf8' });
  assert.equal(JSON.parse(writeOut).phase, 'green');

  const stopOut = execFileSync(process.execPath, [CLI, 'stop', cwd], { encoding: 'utf8' });
  assert.equal(JSON.parse(stopOut).active, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/state.test.js`
Expected: FAIL — `Cannot find module '../src/lib/state'` (and `bin/pair-state.js` missing).

- [ ] **Step 3: Write `src/lib/state.js`**

```js
'use strict';
const fs = require('fs');
const path = require('path');

function statePath(cwd) {
  return path.join(cwd, '.claude', 'pair-session.json');
}

function read(cwd) {
  const p = statePath(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function atomicWrite(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function init(cwd, { task, timerSeconds, whoseTurn, watchCommand }) {
  const s = {
    active: true,
    task,
    cycle: 1,
    phase: 'red',
    whose_turn: whoseTurn,
    turn_started_at: new Date().toISOString(),
    timer_seconds: timerSeconds,
    watch_command: watchCommand,
    history: []
  };
  atomicWrite(statePath(cwd), s);
  return s;
}

function write(cwd, patch) {
  const current = read(cwd);
  if (!current) {
    throw new Error('No pair session state found at ' + statePath(cwd) + ' — call init() first.');
  }
  const next = Object.assign({}, current, patch);
  atomicWrite(statePath(cwd), next);
  return next;
}

function stop(cwd) {
  return write(cwd, { active: false });
}

module.exports = { statePath, read, init, write, stop };
```

- [ ] **Step 4: Write `bin/pair-state.js`**

```js
#!/usr/bin/env node
'use strict';
// wingman — CLI wrapper around src/lib/state.js, used by the pair skill's Bash steps.
const state = require('../src/lib/state');

const [, , cmd, cwd, jsonArg] = process.argv;

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

if (!cmd || !cwd) {
  fail('usage: pair-state.js <read|init|write|stop> <cwd> [json]');
}

try {
  let result;
  if (cmd === 'read') {
    result = state.read(cwd);
  } else if (cmd === 'init') {
    result = state.init(cwd, JSON.parse(jsonArg));
  } else if (cmd === 'write') {
    result = state.write(cwd, JSON.parse(jsonArg));
  } else if (cmd === 'stop') {
    result = state.stop(cwd);
  } else {
    fail('unknown command: ' + cmd);
    return;
  }
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  fail(e.message);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/state.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/state.js bin/pair-state.js test/state.test.js
git commit -m "feat: add pair session state store + CLI"
```

---

### Task 3: Test-command detection library + CLI

**Files:**
- Create: `src/lib/detect-test-command.js`
- Create: `bin/pair-detect.js`
- Test: `test/detect-test-command.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Task 7):
  - `detect(cwd) => { stack: 'node'|'rust'|'python'|'unknown', testCmd: string|null, watchCmd: string|null }`
  - CLI: `node bin/pair-detect.js <cwd>` — prints the detection result as JSON on stdout.

- [ ] **Step 1: Write the failing tests**

Create `test/detect-test-command.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { detect } = require('../src/lib/detect-test-command');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-detect-'));
}

const CLI = path.join(__dirname, '..', 'bin', 'pair-detect.js');

test('detects vitest watch command from package.json', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^1.0.0' }
  }));
  const result = detect(cwd);
  assert.equal(result.stack, 'node');
  assert.equal(result.testCmd, 'npm test');
  assert.equal(result.watchCmd, 'npx vitest');
});

test('detects jest watch command from package.json', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'jest' },
    devDependencies: { jest: '^29.0.0' }
  }));
  const result = detect(cwd);
  assert.equal(result.watchCmd, 'npx jest --watch');
});

test('node project with no known watch tool returns null watchCmd', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' }
  }));
  const result = detect(cwd);
  assert.equal(result.stack, 'node');
  assert.equal(result.testCmd, 'npm test');
  assert.equal(result.watchCmd, null);
});

test('detects rust from Cargo.toml', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Cargo.toml'), '[package]\nname = "x"\n');
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' });
});

test('detects python from Makefile', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Makefile'), 'test:\n\tpytest\n');
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'python', testCmd: 'make test', watchCmd: 'ptw' });
});

test('returns unknown stack for an empty directory', () => {
  const cwd = tmpDir();
  const result = detect(cwd);
  assert.deepEqual(result, { stack: 'unknown', testCmd: null, watchCmd: null });
});

test('CLI prints detection result as JSON', () => {
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, 'Cargo.toml'), '[package]\nname = "x"\n');
  const out = execFileSync(process.execPath, [CLI, cwd], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/detect-test-command.test.js`
Expected: FAIL — `Cannot find module '../src/lib/detect-test-command'`

- [ ] **Step 3: Write `src/lib/detect-test-command.js`**

```js
'use strict';
const fs = require('fs');
const path = require('path');

function detect(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      pkg = {};
    }
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const testCmd = pkg.scripts && pkg.scripts.test ? 'npm test' : null;
    let watchCmd = null;
    if (deps.vitest) {
      watchCmd = 'npx vitest';
    } else if (deps.jest) {
      watchCmd = 'npx jest --watch';
    }
    return { stack: 'node', testCmd, watchCmd };
  }

  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' };
  }

  const hasMakefile = fs.existsSync(path.join(cwd, 'Makefile'));
  const hasPyproject = fs.existsSync(path.join(cwd, 'pyproject.toml'));
  if (hasMakefile || hasPyproject) {
    const testCmd = hasMakefile ? 'make test' : 'pytest';
    return { stack: 'python', testCmd, watchCmd: 'ptw' };
  }

  return { stack: 'unknown', testCmd: null, watchCmd: null };
}

module.exports = { detect };
```

- [ ] **Step 4: Write `bin/pair-detect.js`**

```js
#!/usr/bin/env node
'use strict';
const { detect } = require('../src/lib/detect-test-command');
const cwd = process.argv[2] || process.cwd();
process.stdout.write(JSON.stringify(detect(cwd)));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/detect-test-command.test.js`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/detect-test-command.js bin/pair-detect.js test/detect-test-command.test.js
git commit -m "feat: add test-stack detection library + CLI"
```

---

### Task 4: Reminder formatter

**Files:**
- Create: `src/lib/format-reminder.js`
- Test: `test/format-reminder.test.js`

**Interfaces:**
- Consumes: state objects shaped like Task 2's `state.init`/`state.read` output (`active`, `task`, `cycle`, `phase`, `whose_turn`).
- Produces (used by Tasks 5, 6): `formatReminder(state) => string` — `''` when `state` is `null` or `state.active` is falsy.

- [ ] **Step 1: Write the failing tests**

Create `test/format-reminder.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReminder } = require('../src/lib/format-reminder');

test('returns empty string for null state', () => {
  assert.equal(formatReminder(null), '');
});

test('returns empty string for inactive state', () => {
  assert.equal(formatReminder({ active: false }), '');
});

test('includes task, cycle, phase and whose_turn for an active state', () => {
  const msg = formatReminder({
    active: true,
    task: 'add login',
    cycle: 3,
    phase: 'green',
    whose_turn: 'claude'
  });
  assert.match(msg, /add login/);
  assert.match(msg, /cycle 3/);
  assert.match(msg, /phase green/);
  assert.match(msg, /claude's turn/);
  assert.match(msg, /Only \/pair stop/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/format-reminder.test.js`
Expected: FAIL — `Cannot find module '../src/lib/format-reminder'`

- [ ] **Step 3: Write `src/lib/format-reminder.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/format-reminder.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-reminder.js test/format-reminder.test.js
git commit -m "feat: add pair session reminder formatter"
```

---

### Task 5: SessionStart hook

**Files:**
- Create: `src/hooks/session-start.js`
- Test: `test/session-start-hook.test.js`

**Interfaces:**
- Consumes: `state.read(cwd)` from Task 2, `formatReminder(state)` from Task 4.
- Produces: a script invocable as `node src/hooks/session-start.js`, reading optional JSON `{ cwd }` on stdin, writing plain-text reminder (or nothing) to stdout. Referenced by `.claude-plugin/plugin.json`'s `SessionStart` hook from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `test/session-start-hook.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'session-start.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-hook-'));
}

test('prints reminder when an active session exists', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 'add login', timerSeconds: 60, whoseTurn: 'user', watchCommand: 'npm test' });
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: 'utf8'
  });
  assert.match(out, /WINGMAN PAIR SESSION ACTIVE/);
  assert.match(out, /add login/);
});

test('prints nothing when no session state exists', () => {
  const cwd = tmpDir();
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: 'utf8'
  });
  assert.equal(out, '');
});

test('prints nothing and does not throw on empty stdin', () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: '',
    encoding: 'utf8'
  });
  assert.equal(out, '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/session-start-hook.test.js`
Expected: FAIL — `session-start.js` does not exist.

- [ ] **Step 3: Write `src/hooks/session-start.js`**

```js
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
    // silent fail — never block session start
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/session-start-hook.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-start.js test/session-start-hook.test.js
git commit -m "feat: add wingman SessionStart hook"
```

---

### Task 6: UserPromptSubmit hook

**Files:**
- Create: `src/hooks/prompt-submit.js`
- Test: `test/prompt-submit-hook.test.js`

**Interfaces:**
- Consumes: `state.read(cwd)` from Task 2, `formatReminder(state)` from Task 4.
- Produces: a script invocable as `node src/hooks/prompt-submit.js`, reading JSON `{ cwd, prompt }` on stdin, writing `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` to stdout when a session is active, nothing otherwise. Referenced by `.claude-plugin/plugin.json`'s `UserPromptSubmit` hook from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `test/prompt-submit-hook.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('../src/lib/state');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'prompt-submit.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-hook-'));
}

test('emits hookSpecificOutput reminder when a session is active', () => {
  const cwd = tmpDir();
  state.init(cwd, { task: 'add login', timerSeconds: 60, whoseTurn: 'claude', watchCommand: 'npm test' });
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, prompt: 'anything' }),
    encoding: 'utf8'
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /add login/);
});

test('emits nothing when no session is active', () => {
  const cwd = tmpDir();
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, prompt: 'anything' }),
    encoding: 'utf8'
  });
  assert.equal(out, '');
});

test('silently fails on malformed stdin', () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: 'not json',
    encoding: 'utf8'
  });
  assert.equal(out, '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/prompt-submit-hook.test.js`
Expected: FAIL — `prompt-submit.js` does not exist.

- [ ] **Step 3: Write `src/hooks/prompt-submit.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/prompt-submit-hook.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/prompt-submit.js test/prompt-submit-hook.test.js
git commit -m "feat: add wingman UserPromptSubmit hook"
```

---

### Task 7: `/pair` skill (session orchestration)

**Files:**
- Create: `skills/pair/SKILL.md`

**Interfaces:**
- Consumes: `bin/pair-state.js` (Task 2) and `bin/pair-detect.js` (Task 3) as CLI tools invoked via `Bash`, using `${CLAUDE_PLUGIN_ROOT}` to locate them.
- Produces: the `/pair` entry point end users invoke. No automated tests — this is a prompt document, verified by the manual dry run in Task 8.

Run the full test suite once before starting, to confirm nothing upstream is broken:

- [ ] **Step 1: Run full suite**

Run: `npm test`
Expected: PASS (all tests from Tasks 2–6)

- [ ] **Step 2: Write `skills/pair/SKILL.md`**

```markdown
---
name: pair
description: Start, run, and manage a TDD ping-pong pairing session with Claude — strict red/green/refactor discipline, alternating test/impl roles, sticky until /pair stop. Use when the user says "/pair", "let's pair on X", "start a pairing session", or similar.
allowed-tools: Bash, Monitor, ScheduleWakeup, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Pair (wingman)

A TDD ping-pong pairing session: roles alternate every red/green/refactor
cycle, a background test watcher detects when a human turn is done, an
optional timer nudges if a turn runs long, and every phase that produces a
change lands as its own commit.

All state lives at `.claude/pair-session.json` in the *current project*
(not the wingman plugin repo). Read/write it only through the CLI wrappers
below — never hand-edit the JSON — so writes stay atomic and consistent:

- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" read <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" init <cwd> '<json>'`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" write <cwd> '<json patch>'`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-state.js" stop <cwd>`
- `node "$CLAUDE_PLUGIN_ROOT/bin/pair-detect.js" <cwd>` — detect test/watch command

## `/pair start <task description>`

1. Run `pair-detect.js` on the current directory. If `watchCmd` is `null`,
   tell the user no watch-mode tool was found for this stack and ask how
   they want turn-completion detected instead of guessing.
2. Ask (one question): default turn timer length in minutes (a nudge only,
   never forced), and who writes cycle 1's test — the user or Claude.
3. Launch the watch command in the background with `Bash`
   (`run_in_background: true`).
4. Call `pair-state.js init` with `{task, timerSeconds, whoseTurn, watchCommand}`.
5. Announce the session is active, state the cycle 1 assignment, and proceed
   to the cycle loop below.

## Cycle loop

Each cycle has three phases. At the *start* of each cycle, state the derived
ping-pong assignment (whoever just implemented writes the next test; their
partner implements it) and ask the user to confirm or override before
continuing — never assume silently.

**Red phase** (`phase: "red"`):
- If it's Claude's turn to write the test: write a small failing test,
  run it once to confirm it fails, then continue to the next step.
- If it's the user's turn: attach `Monitor` to the background watcher.
  Wait — do not poll or nag — until the watcher output shows a new failing
  test. That is the signal the turn is done.
- Once red is confirmed, commit: `git commit -m "test: cycle N red (author)"`
  where `author` is whoever just wrote it.
- Call `pair-state.js write` with `{"phase": "green", "whose_turn": "<other
  person>"}` — implementation duty passes to the partner in ping-pong TDD.
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
suggestions or navigation — think of them as a colleague chiming in, not a
second driver. They must never edit files, commit, or call
`pair-state.js write` — advisory output only, folded back into the
conversation.

## Failure handling

- **No watch-mode tool for this stack** (`pair-detect.js` returns
  `watchCmd: null`): ask the user how to detect turn completion instead of
  guessing or silently falling back to a typed keyword.
- **Watcher process dies mid-session**: `Monitor` will show the process
  ending/erroring. Report this to the user and ask whether to restart the
  watcher or fall back to the user saying "done" for the rest of the
  session — don't restart silently.
- **Ambiguous red/green signal** (watcher output doesn't clearly show a
  single, unambiguous transition): ask which test/result it refers to
  rather than guessing.
- **Before any commit**: run `git status`/`git diff` first. If there are
  changes beyond what this phase's turn produced, surface them and ask
  before staging — never bundle unexpected changes into a phase commit.

## Discussion

Free-form discussion is always allowed, in between or after any cycle. It
does not pause or end the session — only `/pair stop` or a new Claude Code
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
confirm the session has ended. This is the only in-conversation way out —
do not treat any other phrase as ending the session.
```

- [ ] **Step 3: Commit**

```bash
git add skills/pair/SKILL.md
git commit -m "feat: add /pair skill for session orchestration"
```

---

### Task 8: Manual dry run & publish to a private GitHub repo

**Files:** none (verification + publishing only)

**Interfaces:** none — this task consumes the whole plugin as built by Tasks 1–7.

- [ ] **Step 1: Run the full test suite once more**

Run: `npm test`
Expected: PASS (all tests from Tasks 2–6)

- [ ] **Step 2: Manual dry run**

In a small real Node project (one with `package.json` and a test script),
run `/pair start "trivial example task"` and confirm: the watcher launches,
the `SessionStart`/`UserPromptSubmit` reminder appears and persists across
an unrelated message, a manual test edit is picked up by the watcher, and a
`test:` commit lands with the expected message format. Fix anything that
doesn't match this plan before proceeding.

- [ ] **Step 3: Create the private GitHub repository and push**

```bash
git remote -v
gh repo create wingman --private --source=. --remote=origin
git push -u origin main
```

Expected: `gh` reports the new private repository URL; `git push` succeeds.
