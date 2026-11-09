# Enforcement and its limits

Three hooks (plain Node scripts, no dependencies) are wired by default:

- **Locked-test guard** (PreToolUse): during Build, blocks edit tools on locked test files.
- **Stop gate** (Stop): in Build or Review, blocks finishing unless a passing verdict matches the current working-tree fingerprint. It blocks at most 3 times per stage, then lets the stop through with a warning, so it cannot deadlock a session. It stands down while the agent is waiting for your decision.
- **Context reinjection** (SessionStart after compaction): re-prints goal, stage, decisions and next step from the task file.

Limits, stated plainly:

- Shell edits (`sed -i`, redirects) are not intercepted. The review re-hashes locked tests and fails on any mismatch; that is the real backstop.
- State fields such as `awaitingUser` and the history log are tamper-evident, not tamper-proof. A determined agent can write them; the aim is to catch drift, not adversaries.
- Hooks fail open: if a hook crashes or state is unreadable it warns and allows, so a loopwright bug never bricks your session. Review checks remain authoritative.
- With `--no-hook`, none of this is enforced.
- Setting `LOOPWRIGHT_HOOKS=off` in a session's environment turns every loopwright hook into a silent no-op. The cross-agent review sets it on the headless `claude -p` / `codex exec` reviewer so that session is not gated.

## Codex trust step (WIP)

Codex requires you to trust the project and approve hooks. After `init`, open Codex in the repo and approve the loopwright hooks via `/hooks`. Until approved, hooks do not run. This path is untested end-to-end.
