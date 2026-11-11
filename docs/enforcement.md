# Enforcement and its limits

Three hooks (plain Node scripts, no dependencies) are wired by default:

- **Locked-test guard** (PreToolUse): during Build, blocks edit tools on locked test files.
- **Stop gate** (Stop): in Build or Review, blocks finishing unless a passing verdict matches the current working-tree fingerprint. It blocks at most 3 times per stage, then lets the stop through with a warning, so it cannot deadlock a session. It stands down while the agent is waiting for your decision.
- **Context reinjection** (SessionStart after compaction): re-prints goal, stage, decisions and next step from the task file.

## Going back after Build began

`lw.mjs reopen <plan|test> "<reason>"` sends the task back to Plan or Test. Skills run it only after you choose to go back (a deviation, an undecided review finding). It is refused before Build began, for any other target, or without a reason, and the reason is recorded in the status history.

In stage test the tester may edit and re-lock tests. `check-locks` reports those re-locks as `relockedAfterReopen` (path and reason), which the reviewer treats as information and the PR draft lists. A reopen counts only when the three history events ending with it are `await-user`, `resume`, `reopen`, strictly in a row (the pair the skills run around your answer, then the reopen). Any event between them, such as the `stage build` the skills run before re-spawning the implementer, means it does not count. A re-lock after Build without a counted reopen, including one after a bare `reopen` an agent ran on its own, stays in `lockedAfterBuild` and the reviewer raises it as a finding. Back in Build, the guard blocks locked-test edits again.

Limits, stated plainly:

- Shell edits (`sed -i`, redirects) are not intercepted. The review re-hashes locked tests and fails on any mismatch; that is the real backstop.
- The reopen rule checks only the order of those three events, not who ran them or why: an agent that runs `await-user`, `resume` and `reopen` in a row itself is not stopped. The implementer is told never to run `reopen`, `lock` or `stage`, and any other reopen is flagged, but nothing prevents the faked triple.
- State fields such as `awaitingUser` and the history log are tamper-evident, not tamper-proof. A determined agent can write them; the aim is to catch drift, not adversaries.
- Hooks fail open: if a hook crashes or state is unreadable it warns and allows, so a loopwright bug never bricks your session. Review checks remain authoritative.
- With `--no-hook`, none of this is enforced.
- Setting `LOOPWRIGHT_HOOKS=off` in a session's environment turns every loopwright hook into a silent no-op. The cross-agent review sets it on the headless `claude -p` / `codex exec` reviewer so that session is not gated.

## Codex trust step (WIP)

Codex requires you to trust the project and approve hooks. After `init`, open Codex in the repo and approve the loopwright hooks via `/hooks`. Until approved, hooks do not run. This path is untested end-to-end.
