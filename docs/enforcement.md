# Enforcement and its limits

Five hooks (plain Node scripts, no dependencies) are wired by default on Claude Code, three elsewhere:

- **Locked-test guard** (PreToolUse): during Build, blocks edit tools on locked test files.
- **Stop gate** (Stop): in Build or Review, blocks finishing unless a passing verdict matches the current working-tree fingerprint. It blocks at most 3 times per stage, then lets the stop through with a warning, so it cannot deadlock a session. It stands down while the agent is waiting for your decision.
- **Context reinjection** (SessionStart after compaction): re-prints goal, stage, decisions and next step from the task file.
- **Compaction instructions** (PreCompact, Claude Code only): while a task is active, tells compaction to keep the task file path, the stage, any open question, unresolved review findings and decisions not yet in the task file, and to re-read the task file afterwards.
- **Question check** (PreToolUse on `AskUserQuestion`, Claude Code only): while a task is active, sends a question back for a rewrite when it names a task id or a loopwright-only phrase with no plain description before it. See [Plain words in messages to you](#plain-words-in-messages-to-you).

Each verdict also records the reviewed code as a git object in the repo's object store, so the next review round can see what changed. Nothing in your working tree, index or branches changes, and if git has cleaned the object up, the next round is a full review.

## Plain words in messages to you

Every skill tells the agent to read one shared rules file, `prompts/user-messages.md` in the installed loopwright directory, once per conversation and before its first message to you. After compaction, context reinjection and the compaction instructions point the agent back to it. This part works on Claude Code, Codex and Junie.

On Claude Code only, the question check adds a hook on `AskUserQuestion`. While a task is active it reads each question, header, and option label and description. It sends the question back to the agent, before you see it, when the text holds one of these with no plain description before it:

- a task id that the active task file defines, such as `AC3`, `D2`, `A1`, `S2`, `R1` or `U1`; `S3` in a question about Amazon S3 passes unless the task has a slice S3
- a loopwright-only phrase: stop gate, re-lock, fix round, two-pass, acceptance criteria

Text in brackets, parentheses or backticks is not checked, so the label may follow the plain description. The denial quotes the text and names the rules file, and the agent asks again. After 2 denials in a row the next attempt goes through, so a question is never stuck. The check allows silently when no task is active, under `LOOPWRIGHT_HOOKS=off`, on unreadable input, and for any other tool.

Limits:

- Only questions are checked, and only for those labels. Words with an everyday meaning that loopwright also uses (tier, slice, lock, profile) and every other message (stage updates, findings, reports) rely on the rules file alone.

## Code standards

The shared standards file (`prompts/standards.md`) is enforced by prompts and review, not by a hook. Before Build, the Test stage reads the new test files; comments or doc blocks that restate a test name or an acceptance criterion send the tester back to edit and re-lock its tests. In Review, a violation of a named standards rule that the reviewer proves (the smaller version, both locations of a duplicated fact, the mechanism that was bypassed, or the hunk) is high impact and blocks the pass; one without proof is dropped.

## Going back after Build began

`lw.mjs reopen <plan|test> "<reason>"` sends the task back to Plan or Test. Skills run it only after you choose to go back (a deviation, an undecided review finding, or a fix you raise at Done before Close). It is refused before Build began, for any other target, or without a reason, and the reason is recorded in the status history.

In stage test the tester may edit and re-lock tests. `check-locks` reports those re-locks as `relockedAfterReopen` (path and reason), which the reviewer treats as information and the PR draft lists. A reopen counts only when the three history events ending with it are `await-user`, `resume`, `reopen`, strictly in a row (the pair the skills run around your answer, then the reopen). Any event between them, such as the `stage build` the skills run before re-spawning the implementer, means it does not count. A re-lock after Build without a counted reopen, including one after a bare `reopen` an agent ran on its own, stays in `lockedAfterBuild` and the reviewer raises it as a finding. Back in Build, the guard blocks locked-test edits again.

`lw.mjs accept-locks --reason "<text>" [--restart] [<path>...]` takes a flagged re-lock or forced restart out of `lockedAfterBuild` and `forcedRestartAfterBuild` and lists it under `accepted` with its reason, as information for the reviewer. Review runs it when a decision in the task file covers the item, and when you dismiss a re-lock or restart finding, so it is not raised again and not asked again. A new re-lock of the same file is raised again, and so is a later forced restart. A locked test edited without a re-lock stays in `changed` and blocks; it cannot be accepted. A faked acceptance is not detected: the reason is whatever the caller wrote.

When an approved pull changes a locked test, `brief` lists it under `pulledLocks`: the file no longer matches its lock and a commit on the upstream branch changed it. It is recorded when the task's base commit moves to the pulled commits, and when the base is kept after a pull. The task goes back to the tester for those files only, who checks each still tests its acceptance criteria, edits only what the pull broke, and re-locks it; the re-lock is accepted under the pull decision, so it is not reported as blocking. A locked test edited by hand, or only in the task's own or local-only commits, is never listed there and stays in `changed`.

`lw.mjs park` (the `/loopwright-park` command) writes a task stub and a follow-up line only; it never changes worktree state or the history, so locks and the stop gate are unaffected.

`lw.mjs explore` (the `/loopwright-explore` command) writes only a run folder under `.loopwright/explore/`; it never touches worktree state or the history, so locks and the stop gate are unaffected.

`lw.mjs start` refuses a task file whose `worktree:` header names another worktree, and the skills send such a task to its start command. This safety net has a gap: `lw.mjs` sees only the folder it runs in, not the session's folder. An agent that `cd`s into another worktree and runs `lw.mjs` there passes the check, because the header then names the worktree it runs in; so does a session that stayed in the old worktree and starts a fresh task there. Start the new session with the printed `cd` command.

Limits, stated plainly:

- Shell edits (`sed -i`, redirects) are not intercepted. The review re-hashes locked tests and fails on any mismatch; that is the real backstop.
- The reopen rule checks only the order of those three events, not who ran them or why: an agent that runs `await-user`, `resume` and `reopen` in a row itself is not stopped. The implementer is told never to run `reopen`, `lock` or `stage`, and any other reopen is flagged, but nothing prevents the faked triple.
- State fields such as `awaitingUser` and the history log are tamper-evident, not tamper-proof. A determined agent can write them; the aim is to catch drift, not adversaries.
- Hooks fail open: if a hook crashes or state is unreadable it warns and allows, so a loopwright bug never bricks your session. Review checks remain authoritative.
- With `--no-hook`, none of this is enforced.
- Setting `LOOPWRIGHT_HOOKS=off` in a session's environment turns every loopwright hook into a silent no-op. The cross-agent review sets it on the headless `claude -p` / `codex exec` reviewer so that session is not gated.

## Codex trust step (WIP)

Codex requires you to trust the project and approve hooks. After `init`, open Codex in the repo and approve the loopwright hooks via `/hooks`. Until approved, hooks do not run. This path is untested end-to-end.
