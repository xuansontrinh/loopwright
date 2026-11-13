---
name: loopwright-test
description: Use after a standard or large loopwright task, or any fix, is planned and confirmed, to have a separate tester write and lock the acceptance tests before any implementation exists.
---
# loopwright test

The tester writes acceptance tests from the confirmed ACs and locks them. This thread only dispatches and verifies; do not write or edit tests or code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and the next step reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task` (path relative to `<lw>`). "no active task" → stop and point the user to `/loopwright-plan` or `/loopwright-flow`.
4. Read the task file header.
   - `tier: small` and `kind` feature (or no `kind`) → there is no Test stage; say so and go to `/loopwright-build`. `kind: fix` at tier small → Test runs: a fix is never built without a locked repro test.
   - Header not `plan: confirmed` (or no ACs, or ACs without an interface) → stop; point the user to `/loopwright-plan`.
   - Reopened task (`status` `history` has a `reopen` event after the last `stage build` event; that event's `reason` says why) → the scope is the ACs the reason and the task file's added or changed ACs name, in whichever slices hold them (a `[tested]` or `[passed]` slice included), not the first `[todo]` slice. Existing locked tests for those ACs may be edited and re-locked.
   - `tier: large`, not reopened → the current slice is the first `S<n> [todo]` line; test only its ACs.

## Steps

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage test`, and set `stage: test` in the task file header.
2. Now spawn the `loopwright-tester` subagent and wait for its result. Give it only the absolute task file path (`<lw>/<task>`) and, for large tier, "Write tests only for slice S<n>: AC…". Reopened: "Reopened task: the reason is … Write or edit tests only for AC…; existing locked tests for them may be edited and re-locked." No chat history, no implementation hints. On Claude Code pass `effort` = the output of `node "{{LW_HOME}}/hooks/lw.mjs" effort tester` on the spawn; if the spawn rejects `effort`, fall back to spawning without it (the agent file's effort applies).
   Fix tasks: also say the task is a fix whose `## Bug report` it must read, and name any existing test the scout or the user found already failing with the reported symptom.
3. Verify the report:
   - `node "{{LW_HOME}}/hooks/lw.mjs" status` → `lockedTests` must contain every test file and fixture the report lists. A reported file missing from the locks → run `node "{{LW_HOME}}/hooks/lw.mjs" lock <file>` yourself.
   - Every in-scope AC has a test, and each failure excerpt shows the expected reason (missing behavior, missing module/export at the named path), not a syntax or setup error. Reopened: an edited or re-locked test for behavior Build already implemented may pass; the report must say so, and a pass is accepted only when the test checks the changed contract. Otherwise spawn the `loopwright-tester` subagent and wait for its result again, naming the problem.
   - Read the new test files. Comments or doc blocks that restate a test name or an acceptance criterion break the standards: spawn the `loopwright-tester` subagent and wait for its result again, naming the files, before Build; it may edit and re-lock its own tests for this.
   - Fix tasks: compare each repro failure excerpt with the `observed` line in `## Bug report`. A different error type or message, or a different wrong output, is a mismatch (the test does not match the reported symptom): send the tester back with the mismatch described, via the same spawn rule. A `[regression]` test is expected to pass; one that fails is a `Needs` item.
   - Fix tasks, no repro (the tester locked no `[repro]` test and `Needs` says it could not reproduce): run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "no repro for the reported bug"`, show the tester's `Needs` (what it tried, what happened, what evidence is missing), then ask one question, recommendation first. After the answer run `node "{{LW_HOME}}/hooks/lw.mjs" resume`, then `node "{{LW_HOME}}/hooks/lw.mjs" stage test`, so a `reopen` by a subagent you spawn next does not directly follow the `resume`.
     - (a) Provide the missing evidence: add it to `## Bug report`, dispatch the tester again.
     - (b) Find the faulty unit: spawn the `loopwright-scout` subagent and wait for its result, asking it to investigate the internals and name a suspect unit and why. The user confirms or corrects the unit. Then add a `[repro]` criterion at that unit's interface to the task file (`[asked]` decision) and dispatch the tester again.
     - (c) Stop the task: set `status: stopped` in the task file header and run `node "{{LW_HOME}}/hooks/lw.mjs" done` (the task file stays).
     If (a) and (b) both fail, the task stops the same way, with what was tried recorded in the task file and an honest next step for the user (for example a normal `/loopwright-flow` task to add logging around the suspected code). No repro, no fix: there is no option to continue without a repro, and Build never starts.
   - `Uncovered` or `Needs` not empty → show those items to the user, one at a time. The answer may change an AC or a decision: write it to the task file (`[asked]`), then dispatch the tester again.
4. Write the test file next to each AC line (`— test: <file>`). Large tier: change the slice (reopened: every slice in scope) to `S<n> [tested]`.
5. Tell the user in a few lines: test files, ACs covered, locked paths. Then the next stage is `/loopwright-build`.

## Rules

- Never write task ids (AC, D, S shorthands) into tests, code, comments, commit messages or PR drafts.
- Lock only in this stage, and only the tests for this stage's scope (the task, or the current slice). Never re-lock an existing locked test, except after a reopen (the user chose to go back), where the tester may edit and re-lock the tests in the reopened scope, or when this stage's verification re-dispatches the tester before Build. Outside a reopen, if one is wrong, tell the user and let them decide.
- Do not read the implementation to judge the tests; the ACs are the contract.
