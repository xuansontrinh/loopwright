# Workflow in detail

The full flow behind `/loopwright-flow`. The [README](../README.md#how-it-works) has the short version. Each stage's `SKILL.md` in `content/skills/` is the authority; this page describes it.

Legend: rounded boxes are steps, diamonds are decisions, hexagons are points where loopwright stops and waits for you. "Main thread" means your session; subagents run in their own isolated context.

## Large tier: slices

Plan splits a large task into ordered slices. Each slice runs Test, Build and Review. When the last slice passes, one review covers the whole branch.

```mermaid
flowchart TD
    plan(["Plan: slices S1..Sn with their ACs, confirmed"]) --> test["Test slice Sk<br/>tester writes and locks tests"]
    test --> build["Build slice Sk<br/>implementer"]
    build --> review{"Review slice Sk<br/>passes?"}
    review -- "blocking findings,<br/>rounds left" --> build
    review -- "cap reached" --> user{{"You decide:<br/>raise cap, fix by hand, accept"}}
    review -- "pass: mark Sk passed" --> more{"More slices?"}
    more -- "yes" --> test
    more -- "no" --> whole{"Whole-branch review<br/>against the base commit"}
    whole -- "blocking findings,<br/>rounds left" --> fix["Build fix round<br/>no new tests"]
    fix --> whole
    whole -- "cap reached" --> user
    whole -- "pass" --> done(["Done"])
```

## Fixing a bug

`/loopwright-fix` runs the same stages with `kind: fix` in the task file. The differences:

- **Plan**: the scout reads your bug report, log or issue first. You are asked once for missing evidence (error text, steps, expected behavior) and confirm a root-cause hypothesis.
- **Test never skips**, at any tier. The tester writes a `[repro]` test for the correct behavior and locks it only after it fails for the reported reason, not for an unrelated one. A `[regression]` test covers behavior that must keep working and passes already.
- **No repro stops the task.** If the tester cannot reproduce the bug, you choose: add evidence, say which unit is at fault (a new `[repro]` criterion is recorded), or stop. There is no option to continue without a locked repro test; stopping marks the task `stopped`.
- **Build** names the root cause first and fixes it; suppressing the symptom (catching the error, special-casing the input) is not a fix.
- **Review** checks that the fix addresses the root cause and lists sibling code with the same flaw. After a pass you decide whether to include the siblings. Yes goes back to Plan and Test for their repro tests; no records them under `## Follow-ups` in the task file.
- **Done** puts the root cause, the repro test failing before and passing after, and the follow-ups in the PR draft.

## Parking work you find along the way

`/loopwright-park` captures work you notice while doing one task so the task does not grow. It restates the finding for you to edit, asks whether it blocks the current task (the recommendation is no), and writes a stub in `tasks/` with `status: proposed`. The current task's scope, tests and diff do not change; the stub is listed under its `## Follow-ups`. A blocking stub is best run first in a new worktree (see [Running tasks in parallel worktrees](#running-tasks-in-parallel-worktrees)).

Later, `/loopwright-flow` or `/loopwright-plan` without a goal lists the proposed stubs: start one (it goes through normal Plan in a fresh context), drop it, or begin a new task. Done lists the stubs found during a task, drafts issue text for each (shown, never filed) and adds a Follow-ups section to the PR draft.

## Running tasks in parallel worktrees

One task runs per git worktree, each in its own session, so a new goal does not wait on an unrelated task. Each worktree holds its own tasks in `.loopwright/` (see [Installation](installation.md#worktrees)).

When you give `/loopwright-flow`, `/loopwright-plan` or `/loopwright-fix` a new goal, the skill runs `lw.mjs tasks`, a read-only listing of the open tasks and parked stubs in every worktree:

- A task that looks related to the goal: you are asked whether to continue it. If it is in another worktree, nothing starts here; you get the command to continue it there. Which tasks are related is the agent's judgment, and it asks when unsure.
- Only unrelated tasks, and this worktree has no task: the goal starts here.
- This worktree is occupied (it has a task, Plan stage included): the skill says what occupies it and suggests a new worktree. It never offers to close or shelve an unrelated task. On yes it runs `lw.mjs worktree "<title>"`, which creates the sibling folder `../<repo-folder>-<slug>` on a new branch `<slug>` from `origin/HEAD` (else `main` or `master`, else `HEAD`; `--base <ref>` overrides), writes a `status: proposed` stub with your goal there, and prints the command to start a session in it:

```bash
cd ../my-repo-add-export && claude "/loopwright-flow"      # Claude Code
cd ../my-repo-add-export && codex '$loopwright-flow'       # Codex
cd ../my-repo-add-export                                   # Junie: start Junie, then run /loopwright-flow
```

`/loopwright-fix` adds `--kind fix`, so the stub keeps `kind: fix` and the new session still locks a repro test first (the default is `feature`). The new session lists the stub and plans from it in a fresh context. If the new worktree lacks the repo-mode install, the skill says so and prints `npx loopwright update` first. A stub from any worktree can start in a new worktree with `lw.mjs worktree "<title>" --stub <file>`; the original is marked `status: moved` and never deleted. Codex may ask for one sandbox approval to create the worktree (unverified; Codex support is WIP).

When Done closes a task in a linked worktree, it offers `lw.mjs carry`, which copies the worktree's proposed stubs to the main checkout's `tasks/` and marks the sources `status: moved`, so they outlive the worktree.

## Understanding an unfamiliar codebase

`/loopwright-explore [folder]` writes a walkthrough of a codebase, or of one folder of it, for someone new to it. It changes no code and runs no commands from the repository. Nothing outside `.loopwright/` is written unless you ask to copy the walkthrough in.

1. A scout maps the scope. If the working tree has uncommitted changes, you are asked whether to commit or stash first or go on; going on is recorded in the walkthrough header. You confirm the outline: the components (4 to 8 is readable) and one to three key flows to trace.
2. One read-only scout per component reports what it does, what it depends on, and where, with `path:line`.
3. The main thread writes the walkthrough and a list of claims, each with its `path:line`.
4. An answer pass: a scout gets only the open questions and looks for answers in the docs, `CLAUDE.md`, tests and git history. Answers become claims, defects go under "Possible problems found", and the rest stay under "Questions only the team can answer".
5. A fresh scout gets only the claim list and tries to disprove each claim. Refuted claims are fixed; `narrower` claims (true, but narrower than written) are narrowed or get the caveat folded in; unconfirmed ones are removed or moved to "Questions only the team can answer", and unconfirmed diagram edges are removed or drawn dashed.
6. You see both lists but are asked only about "Questions only the team can answer" and may answer any; your answers are marked as not verified in code.

The walkthrough goes under `.loopwright/explore/<date>-<scope>/walkthrough.md`, which is gitignored. It opens with what the system is, defines its words, then shows a context diagram and a component diagram before any detail. Runs resume from the files in that folder after an interruption; `lw.mjs explore "<folder>" --new` abandons an unfinished run and starts another. Copy the walkthrough into the repo yourself when you judge it good enough. That offer is withheld while a task is in `test`, `build` or `review`, so the copy does not join that task's diff.

## Plan, step by step

Plan runs in your main thread. Nothing is built until you confirm.

```mermaid
flowchart TD
    in(["Goal, or an imported spec"]) --> scout["Scout subagent<br/>read-only repo map: files, conventions, checks, risks"]
    scout --> ledger["Assumption ledger<br/>every assumption tagged high or low impact,<br/>task file created with plan: draft"]
    ledger --> hi{{"Each high-impact assumption<br/>asked one at a time"}}
    hi -- "answer written to task file" --> more{"More high-impact<br/>items?"}
    more -- "yes, or a new one<br/>raised by an answer" --> hi
    more -- "no" --> lo{{"Low-impact batch<br/>reply ok, or override by number"}}
    lo --> prop{{"Proposal: tier, profile, two-pass review,<br/>fix-round cap, check commands, acceptance criteria"}}
    prop -- "you edit" --> prop
    prop --> conf{{"Final confirmation"}}
    conf -- "not yet" --> prop
    conf -- "confirmed: plan: confirmed" --> next(["Test (standard, large, any fix)<br/>or Build (small) for a feature"])
```

## Review, step by step

Review is a separate context that judges the change. This thread only dispatches reviewers, merges their verdicts and records the result.

The tester, implementer and reviewer all read one shared standards file, `prompts/standards.md` in the installed loopwright directory: named code rules with a reason each, such as using an existing mechanism before adding branches and keeping one home per fact. Your repo's own docs on architecture and conventions win over it on any conflict.

```mermaid
flowchart TD
    start(["Review round n"]) --> blind["Blind pass: reviewer sees task file and diff only.<br/>Runs checks, re-hashes locked tests"]
    blind --> two{"two-pass on?"}
    two -- "yes" --> second["Second pass: reviewer verifies the<br/>implementer's claims"]
    two -- "no" --> cross
    second --> cross{"crossAgentReview set?"}
    cross -- "yes" --> xa["Headless review by the other CLI.<br/>A missing or failing CLI is skipped, never blocks"]
    cross -- "no" --> merge
    xa --> merge["Merge verdicts: union of blocking,<br/>union of undecided, sum of dropped"]
    merge --> b{"Blocking<br/>findings?"}
    b -- "yes" --> cap{"Fix rounds used<br/>= cap?"}
    cap -- "no" --> fail["Record verdict fail"] --> build(["Build fix round<br/>then Review round n+1"])
    cap -- "yes" --> stop{{"Stop: you decide what to do<br/>with the open findings"}}
    b -- "no" --> u{"Undecided<br/>findings?"}
    u -- "yes" --> ask{{"Each one asked: fix or dismiss"}}
    ask -- "any fix" --> cap
    ask -- "all dismissed" --> pass
    u -- "no" --> pass["Record verdict pass<br/>bound to the working-tree fingerprint"]
    pass --> after(["Done, or the next slice if large"])
```

A verdict goes stale when the code changes afterwards, so Done re-checks the fingerprint and sends you back to Review if it differs.

## Where loopwright stops and waits for you

- Each high-impact question, the low-impact batch, the tier and settings proposal, and the final plan confirmation.
- Tester `Uncovered` or `Needs` items, and implementer `Deviations`.
- Each undecided review finding, and the fix-round cap being reached.
- New upstream commits found before Plan and Build (Build asks only when they touch the task's files or feature).
- Each `AGENTS.md` or docs change, and the commit message and PR draft.

It never answers a gate itself, never treats silence as approval, and never commits.

## What the hooks do along the way

- **Locked-test guard**: during Build, edit tools cannot touch locked test files.
- **Stop gate**: in Build and Review, the agent cannot finish its turn without a passing verdict that matches the current working tree, except while it waits for one of your decisions.
- **Context reinjection**: after context compaction, the task's goal, stage, decisions and next step are printed again, plus the kind and root cause line for a fix.

Details and limits: [Enforcement](enforcement.md).
