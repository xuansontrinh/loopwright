# Dogfood checklist

Agent behavior is not covered by automated tests. Run this by hand before a release, in a scratch git repo with a working test runner. Re-run `npx loopwright init` (or `npm run dev -- init`) first, and confirm hooks are wired (`grep -l "loopwright/hooks/" .claude/settings.json`).

## Claude Code

Run one sample task per tier with `/loopwright-flow`.

| Tier | Sample task |
|---|---|
| small | Rename a helper function and update its callers |
| standard | Add a small utility with clear input/output rules (for example a slug generator with edge cases) |
| large | Add a feature spanning two or three separable modules (for example a CLI flag plus config plus output formatting) |

For each run, check:

- [ ] Plan lists assumptions, tagged high or low impact
- [ ] High-impact questions are asked one at a time (structured, via `AskUserQuestion`); low-impact ones arrive in one batch
- [ ] The task file in `.loopwright/tasks/` is updated immediately after each answer
- [ ] Tier, two-pass and fix-round cap are proposed and need your confirmation before any test or code is written
- [ ] Standard/large, and every fix: acceptance tests are written first, fail for the right reason, and are locked (`node .agents/loopwright/hooks/lw.mjs status` lists them)
- [ ] During Build, editing a locked test file through the agent's edit tools is blocked by the guard
- [ ] Ending a turn in Build/Review without a passing verdict is blocked by the stop gate (and lets go after 3 blocks, with a warning)
- [ ] Review output matches `content/schemas/verdict.json`; only proven findings appear; undecided findings are put to you
- [ ] Tamper with a locked test via shell (`sed -i`): Review fails on the hash mismatch
- [ ] Large: each slice runs Test, Build, Review, then a whole-branch review runs
- [ ] `/compact` mid-task: goal, stage, decisions and next step are reinjected (a fix task also restores `kind: fix` and the root cause line)
- [ ] Done proposes `AGENTS.md`/`docs/agents/` edits (each needs approval) and drafts a commit message, and does not commit
- [ ] Optional: set `crossAgentReview` to `codex`; both verdicts are reported, and a missing CLI is skipped with a log note

### Fix path

Run `/loopwright-fix` once on a real bug in the scratch repo, with a description that includes the observed and expected behavior and steps to reproduce. The generic checks above also apply to this run. Also check:

- [ ] Plan asks once for any missing evidence, and shows the root-cause hypothesis for you to confirm or correct
- [ ] A small fix still runs Test: the repro test is written by the tester, fails with the reported error or wrong output (not merely fails), and is locked before any code changes
- [ ] The reported symptom and the repro failure excerpt are compared; a different error or wrong output sends the tester back
- [ ] Build starts its report with `Root cause: <file:line>`, and the fix changes that code rather than catching the error or special-casing the repro input
- [ ] No-repro gate: on a bug the tester cannot reproduce, you are offered more evidence or a faulty-unit search, and Build never starts without a locked repro test
- [ ] Sibling gate: if Review finds the same defect pattern elsewhere, you are asked once at the final pass (after the whole-branch review for large) to include the siblings or list them as follow-ups; "include" reopens Plan with one repro criterion per sibling
- [ ] The PR draft states the root cause in one line, names the repro test(s) with "failed before, passes after", and lists the follow-ups

### Park path

- [ ] During a task, `/loopwright-park` restates the finding, asks one blocking question (recommending no), and writes a `status: proposed` stub; the task's state and diff are unchanged and the stub is listed under its `## Follow-ups`
- [ ] `/loopwright-flow` after Done lists the stub; starting it fills the same file in place

### Explore path

- [ ] `/loopwright-explore services/x` writes a run folder under `.loopwright/explore/`, stops at the outline gate, then runs one scout per component; the repo outside `.loopwright/` is unchanged
- [ ] Stopping midway and running `lw.mjs explore services/x` again resumes the same folder; `--new` abandons it and starts another

## Codex (WIP)

Codex support is work in progress; only install and discovery checks are listed. No end-to-end run has been done.

- [ ] `npx loopwright init` completes in a scratch repo
- [ ] `.codex/agents/loopwright-{scout,tester,implementer,reviewer}.toml` exist
- [ ] `.codex/config.toml` contains the `# BEGIN loopwright` block
- [ ] `codex features list` shows `hooks` enabled
- [ ] `$loopwright-flow` is discovered in Codex; hooks appear in `/hooks` for approval
