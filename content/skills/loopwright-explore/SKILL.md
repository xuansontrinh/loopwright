---
name: loopwright-explore
description: Use to understand an unfamiliar codebase, or one folder of it. Produces a newcomer walkthrough where every claim and diagram edge cites path:line and a blind checker has tried to disprove each one.
---
# loopwright explore

Writes a walkthrough of a codebase (or one folder, `/loopwright-explore services/billing`) for someone new to it. Exploration is staged: map, a confirmed outline, one read-only scout per component, a draft, a blind claim check, questions for the team. Exploring is not a stage of the Plan → Done loop and changes no task.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>`. `null` inside a git repo → no task has started here yet; `lw.mjs explore` creates `.loopwright/`, so continue. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. A task in `build` or `review` is active → run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "exploring the codebase"` before the first question and `node "{{LW_HOME}}/hooks/lw.mjs" resume` after the last, so the stop gate does not push you past the gates. "no active task" is normal. Remember whether the stage is `test`, `build` or `review` (see Finish).
4. `node "{{LW_HOME}}/hooks/lw.mjs" explore "<scope>"` (no scope → `.`) → `{dir, resume, commit, head, present}`; `dir` is relative to `<lw>`. An unknown path is an error: tell the user. Call it `<run>`.
5. `resume` true and `commit` differs from `head` → tell the user and ask one question, recommending to continue (the header then names both commits) or start over (`explore "<scope>" --new`).
6. Continue at the first stage whose file is missing from `present`. After any interruption or context compaction, start again from this Setup: the files on disk are the truth, not the conversation.

## Stages

Spawn each scout on Claude Code with `effort` = the output of `node "{{LW_HOME}}/hooks/lw.mjs" effort scout`; if the spawn rejects `effort`, spawn without it. Scouts only report; this main thread writes every file. Save each report verbatim.

1. Map: spawn the `loopwright-scout` subagent with the scope and "Explore tasks: map". Save its report to `<run>/map.md`.
2. Outline gate: show the user, recommendation first, the scope; the component list (merge, split, rename or drop; target 4 to 8, more → propose grouping or narrowing the scope); and 1 to 3 key flows with a recommended pick (those touching the most components), one may be an error path. One question per decision (Claude: `AskUserQuestion`; Codex and Junie: numbered text, then end the turn). Never a silent default. Save the confirmed outline (scope, components with folders and one-line jobs, key flows) to `<run>/outline.md`.
3. Components: spawn one read-only `loopwright-scout` subagent per component, in parallel, each with "Explore tasks: component", its component and the confirmed flows. Save each report to `<run>/components/<component-slug>.md` as it arrives. On resume spawn only components without a report.
4. Draft: write `<run>/walkthrough.md` from `outline.md` and the saved reports, not from memory of the conversation. Also write `<run>/claims.md`: every factual statement and diagram edge, one per line, `C<n> | claim | path:line`. A statement with no citation is cut or moved to "Questions for the team".
5. Check: spawn a fresh `loopwright-scout` subagent with "Explore tasks: check" and only the claim list, never the document or your reasoning (split a long list across several scouts by component). Save results to `<run>/check.md`. Then: fix `refuted` claims with the checker's evidence (cited, not re-checked); remove `unconfirmed` claims from prose or keep them only under "Questions for the team"; remove `unconfirmed` diagram edges or draw them dashed labeled `unconfirmed`; put the counts in the header. One check round.
6. Questions gate: show "Questions for the team" in one message. The user may answer any; mark answers `(per <user>, not verified in code)`, kept apart from code-backed claims. Then set `status: done` in `<run>/run.md`.

## Finish

Tell the user the walkthrough path and the check counts. Offer, never do by default, to copy it into the repo at a path the user names (e.g. `docs/architecture.md`); the copy rewrites nothing else and commits nothing. If Setup found a task in `test`, `build` or `review`, do not offer the copy: it would join that task's diff. Say to copy it once the task is closed, or from another worktree, and give the source path.

## The walkthrough

For a developer new to the codebase. Sections in this order; one with nothing to say is omitted, not filled.

1. Header: title, scope, commit explored, date, check counts.
2. What this is: one plain paragraph: who uses it, what goes in, what comes out. No code names yet.
3. Words you will meet: glossary, each term defined once, plain words first, then where it lives. Diagrams use these names.
4. The system and its surroundings: context diagram (the system as one box, its users, outside systems).
5. The big pieces: component diagram, then a codemap table: component, folder, what it does, "look here for…". Folder scope: outside code appears only as boundary nodes, cited at the in-scope side, not counted toward the 4 to 8.
6. How a request moves through it: per key flow a Mermaid sequence or flowchart, then numbered steps each with `path:line`.
7. Components: per component job, key files, entry points, depends on, used by, data it owns, gotchas.
8. How things are done everywhere: errors, logging, config, auth, concurrency as present, and the rules the code keeps, including absences, each cited.
9. Running it locally: commands from manifests, CI or docs, each marked with its source and "not run".
10. A tour of the code: 5 to 10 ordered stops, each a file with `path:line`, what to notice, and where it leads next.
11. Questions for the team: what the code could not answer.
12. Evidence: the claim table (claim, citation, check result).

Writing rules:
- Second person, plain words, short sentences. Define a term before using it and keep one word for it.
- Big picture before detail; no reference tables before "The big pieces".
- Diagrams are Mermaid. Each has a title naming its level and scope, a legend for what arrows mean, one zoom level, and at most about 8 boxes (more → split). Context diagram before component diagram.
- Every edge is numbered, labeled with a verb, and has a table row under the diagram: number, meaning, `path:line`. No edge without a row.
- Prose names modules, files and types; `path:line` goes in edge tables, flow steps, tour stops and Evidence, all tied to the header commit.
- No claim without a citation in Evidence.

## Rules

- Never edit code or any file outside `<lw>`; the one exception is the copy the user asks for.
- Run no repo commands (no build, test, install or scripts). Read-only git is fine. Commands in the walkthrough are taken from files and not run.
- Never change the active task, its state or its tests.
- Do not write task ids into the walkthrough.
