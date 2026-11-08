---
name: loopwright-plan
description: Use to start a loopwright task from a goal or an imported spec. Scouts the repo, builds an assumption ledger, asks the user about high-impact assumptions one at a time, confirms tier and checks, then writes the task file. Nothing is built in this stage.
---
# loopwright plan

Plan runs in this main thread. You state assumptions; the user decides. Do not edit code in this stage, and nothing is built until the user confirms the plan.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` prints the `.loopwright` directory (`<lw>` below). `null` → tell the user to run `npx loopwright init` and stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. If it prints a task, one is already active in this worktree: tell the user and offer `/loopwright-flow` (resume) or `/loopwright-done`; do not start a second. "no active task" → continue.
4. Read `<lw>/config.json` for `maxFixRounds` (missing file or key → 3).
5. `git status --porcelain` not empty → uncommitted changes will be part of the reviewed diff. Ask the user whether to commit/stash them first or include them; record the answer as a decision once the task file exists.

## 1. Input

- A goal in the user's words, or a path to an imported spec/plan (e.g. from superpowers).
- Imported spec: read it fully. Do not interview from scratch; run the assumption pass over it. What the spec states explicitly becomes a decision tagged `batch-confirmed` once the user confirms the batch; what it leaves implicit goes in the ledger.

## 2. Scout

Before writing any assumption, spawn the `loopwright-scout` subagent and wait for its result. Give it only the goal text or the spec path.
Never ask the user a question the repo can answer. If the scout report leaves a repo fact open, look it up yourself or spawn the `loopwright-scout` subagent and wait for its result again with that one question.

## 3. Assumption ledger

List every assumption you would otherwise make silently, one line each: `A<n> [high|low] <assumption> — <evidence: scout path:line, or "none">`.
- **high-impact**: a wrong guess changes public behavior, an interface or name others use, a data/file format, scope, architecture, the test runner, or forces more than a small rework. When unsure, tag high.
- **low-impact**: everything else (internal naming, file placement following an existing pattern, minor edge-case choices).
- Cover: scope in/out, behavior and edge cases, interfaces and paths, error handling, compatibility, how it is tested (no test runner in the repo → high-impact), docs to update.

Show the user the whole ledger in one compact message, then create the task file (see Task file) with status `active` and stage `plan`, and run `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md` (path relative to `<lw>`). Copy `baseCommit`, `worktree` and `branch` from its output into the header. Put every unresolved ledger line under `## Open questions` with `— pending`; move each to Decisions or Assumptions as it is resolved, so a resumed session knows what is still open. Starting early lets the hooks restore this task after compaction; it builds nothing.

## 4. High-impact questions, one at a time

For each high-impact item, most impactful first: ask ONE question, wait for the answer, write it to the task file immediately, then ask the next.
- Claude Code: use `AskUserQuestion` with 2–4 options, your recommendation first and marked "(recommended)".
- Codex: numbered plain-text options, recommendation first. The first time, add: "Tip: `/plan` mode offers structured prompts."
Record the answer as `D<n> [asked] <decision> — rejected: <option, why>`. An answer that raises a new high-impact question goes into the ledger and is asked the same way.

## 5. Low-impact batch

Send all low-impact items in ONE numbered message: "Reply ok, or override by number." Do not ask them one by one.
Write the result immediately: accepted → `[batch-confirmed]`, changed by the user → `[overridden]` with the user's version. Choices about what to build go under Decisions; facts about the repo or environment go under Assumptions.

## 6. Proposal

In one message, propose and explain each in one line:
- **tier**: `small` (one area, few files, low risk; no acceptance-test stage, the implementer writes tests for every AC), `standard` (default; tests first, then build), `large` (several separable parts; split into ordered slices, each run Test → Build → Review, then one whole-branch review).
- **two-pass** review on/off: on when the implementer's claims matter beyond what tests show (performance, migrations, concurrency, external APIs); otherwise off.
- **fix-round cap**: default `maxFixRounds` from config; may be lower for small tasks.
- **check commands**: exact lint / typecheck / test commands from the scout report.
- **acceptance criteria** `AC<n>`: observable behavior, each with the module path and export the test will use (the tester stops without one), and the planned test file. Large tier: slices `S<n>` with their ACs.
The user confirms or edits each item; write the outcome to the header and sections immediately.

## 7. Confirm

Show the task file path and a short summary (tier, decisions count, ACs). Ask for explicit confirmation. Until the user confirms, keep editing the plan; never start Test or Build.
On confirmation: if `git rev-parse HEAD` differs from the recorded base commit, rerun `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md --force` and update the header. Then the next stage is `/loopwright-test` (standard, large) or `/loopwright-build` (small); under `/loopwright-flow`, return to the flow.

## Task file

Path: `<lw>/tasks/<YYYY-MM-DD>-<readable-title>.md` — today's date and a short title from the goal. Keep meaningful casing (`2026-11-08-add-CLAUDE-to-project.md`); spaces become `-`; replace only filesystem-unsafe characters (`/ \ : * ? " < > |`). If the name exists, append `-2`, `-3`, … before `.md`.
One line per entry; target ≤ ~150 lines. Template:

```markdown
# <title>

status: active
stage: plan
tier: <small|standard|large>
two-pass: <on|off>
fix-round cap: <n>
checks: `<lint>` · `<typecheck>` · `<test>`
worktree: <path> (branch <branch>)
base commit: <sha>

## Goal
<one paragraph: what and why>

## Decisions
- D1 [asked] <decision> — rejected: <option, why>
- D2 [batch-confirmed] <decision>
- D3 [overridden] <user's version> (was: <your assumption>)

## Assumptions
- A1 [confirmed] <fact about repo or environment> — <evidence>

## Acceptance criteria
- AC1 <observable behavior> — interface: <module path, export> — test: <file>

## Slices
- S1 [todo] <slice> — AC1, AC2

## Review log

## Open questions
- <question> — <who answers, when>
```

Omit `## Slices` unless the tier is large. Keep `## Goal` and the `- D<n>` line shape: the context-reinjection hook reads them.
