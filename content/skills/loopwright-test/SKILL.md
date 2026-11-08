---
name: loopwright-test
description: Use after a standard or large loopwright task is planned and confirmed, to have a separate tester write and lock the acceptance tests before any implementation exists.
---
# loopwright test

The tester writes acceptance tests from the confirmed ACs and locks them. This thread only dispatches and verifies; do not write or edit tests or code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and the next step reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task` (path relative to `<lw>`). "no active task" → stop and point the user to `/loopwright-plan` or `/loopwright-flow`.
4. Read the task file header.
   - `tier: small` → there is no Test stage; say so and go to `/loopwright-build`.
   - Header not `plan: confirmed` (or no ACs, or ACs without an interface) → stop; point the user to `/loopwright-plan`.
   - `tier: large` → the current slice is the first `S<n> [todo]` line; test only its ACs.

## Steps

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage test`, and set `stage: test` in the task file header.
2. Now spawn the `loopwright-tester` subagent and wait for its result. Give it only the absolute task file path (`<lw>/<task>`) and, for large tier, "Write tests only for slice S<n>: AC…". No chat history, no implementation hints.
3. Verify the report:
   - `node "{{LW_HOME}}/hooks/lw.mjs" status` → `lockedTests` must contain every test file and fixture the report lists. A reported file missing from the locks → run `node "{{LW_HOME}}/hooks/lw.mjs" lock <file>` yourself.
   - Every in-scope AC has a test, and each failure excerpt shows the expected reason (missing behavior, missing module/export at the named path), not a syntax or setup error. Otherwise spawn the `loopwright-tester` subagent and wait for its result again, naming the problem.
   - `Uncovered` or `Needs` not empty → show those items to the user, one at a time. The answer may change an AC or a decision: write it to the task file (`[asked]`), then dispatch the tester again.
4. Write the test file next to each AC line (`— test: <file>`). Large tier: change the slice to `S<n> [tested]`.
5. Tell the user in a few lines: test files, ACs covered, locked paths. Then the next stage is `/loopwright-build`.

## Rules

- Lock only in this stage, and only the tests for this stage's scope (the task, or the current slice). Never re-lock an existing locked test; if one is wrong, tell the user and let them decide.
- Do not read the implementation to judge the tests; the ACs are the contract.
