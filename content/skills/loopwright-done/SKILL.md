---
name: loopwright-done
description: Use after a loopwright task passes review, to propose AGENTS.md knowledge updates, draft the commit message and PR description, and close the task without committing.
---
# loopwright done

Done runs in this main thread; do not spawn the subagents here. You propose; the user approves each change. You do not commit.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and the next step reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop). Read `docsDir` from `node "{{LW_HOME}}/hooks/lw.mjs" config` (the main checkout's config; default `docs/agents`).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task`, `verdict`. Then `node "{{LW_HOME}}/hooks/lw.mjs" fingerprint`.
   - No `verdict.pass: true`, or its `fingerprint` differs from the current one → the code changed since review or never passed: run `/loopwright-review` first. Continue only if the user explicitly says so, and note it in the review log.
4. `node "{{LW_HOME}}/hooks/lw.mjs" stage done`, and set `stage: done` in the task file header.

## 1. Knowledge (AGENTS.md)

From the task file (decisions, overrides, review log) and what this task taught you, find durable cross-task knowledge: conventions, "we don't do X here", gotchas a future task would hit. Not task history, not what the code or README already says. A fact already stated in the repo docs or the contract (spec, schema, config) is not added: link instead of restating.
- Write concepts, not file paths; one line per entry.
- An entry that needs more than ~3 lines goes to `docs/agents/<topic>.md` (the configured `docsDir`), plus one line in AGENTS.md: "Read `docs/agents/<topic>.md` when <situation>."
- Prune: AGENTS.md or docs entries this task showed to be stale or wrong → propose an edit or removal.
- No AGENTS.md → propose creating one with the first entry.
Propose each change individually, with the exact text, and wait for approval (Claude: `AskUserQuestion`; Codex: numbered text). Apply only approved changes. Nothing worth adding → say so.

If `CLAUDE.md` exists and has no line `@AGENTS.md`, propose adding that import line instead of copying content into CLAUDE.md. Never duplicate AGENTS.md content elsewhere.

## 2. Parked follow-ups

`grep -l "^found while: <this task path>" <lw>/tasks/*.md` lists the stubs parked while this task ran (`status: proposed` ones are still open). For each, draft issue text (title, what and why, `path:line` evidence from its `## Evidence`) and show it to the user. It is shown only: never file it, and write no task paths or ids into it. A stub with `blocks: <this task path>` that is still `proposed` → ask one question: clear the flag (the stub no longer blocks) or note it in the PR.

In a linked worktree, its `status: proposed` stubs are deleted along with the worktree. List them and offer one question: move them to the main checkout with `node "{{LW_HOME}}/hooks/lw.mjs" carry` (it copies each into the main checkout's `tasks/` and marks the source `status: moved`; it fails in the main checkout, where the stubs already are). Run it only on yes; a stub the user keeps here is lost when the worktree is removed, so say so.

## 3. Commit message and PR description

Never write task ids (AC, D, S shorthands) into tests, code, comments, commit messages or PR drafts. Describe decisions in words.

Draft both and show them to the user:
- Commit: imperative subject ≤ 72 chars; body says why, the key decisions, and the rejected options with the reason.
- PR: summary of intent; decisions and rejected options; notable assumptions the reviewer should know; how it was verified (check commands, acceptance tests, review rounds from the log). Do not list the diff file by file. Run `node "{{LW_HOME}}/hooks/lw.mjs" check-locks`; when `relockedAfterReopen` is non-empty, add a section listing each locked test changed after a reopen with its reason.
  - A `## Follow-ups` section for every kind of task, listing the parked stubs by title and any follow-ups in the task file (still no task paths or ids).
  - Fix tasks (`kind: fix`): the PR also states the root cause in one line (from `## Root cause`), the repro test name(s) with "failed before, passes after", and the follow-ups from `## Follow-ups`.

## 4. Close

1. Set `status: done` in the task file header.
2. `node "{{LW_HOME}}/hooks/lw.mjs" done` (removes this worktree's machine state; the task file stays).
3. Tell the user the work is ready to commit, including any approved AGENTS.md/docs changes.

Do not commit, push, or create the PR. Never delete the task file.
