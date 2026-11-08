# loopwright — design

Date: 2026-11-08 · Status: draft for review · Replaces: `coding-agents-toolings` (npm package already removed)

## 1. Intent

**Problem.** The current spec skills (`spec-create/update/complete/handoff`) generate multi-file specs that people skim and then execute blindly; `ide-mcp` duplicates what plain MCP setup provides; brainstorming/planning is better served by existing tools (e.g. superpowers).

**What the user wants prevented most:**
- *Lost thread* — within one task (across compaction/sessions), across tasks (lessons, "we don't do X here"), and drift between agreed intent and what the agent builds.
- *Quality drift* — code that works but that you are not proud to merge.

**Audience.** Public OSS users of Claude Code and Codex CLI.

**Success criteria.**
1. Every assumption the agent makes before coding is stated; high-impact ones are asked, low-impact ones are batch-confirmed.
2. Agreed decisions survive compaction and are what subagents read — never the main thread's memory of them.
3. Implementation is judged by a separate context against: mechanical checks, agreed decisions, written standards, and codebase patterns.
4. For standard and large tiers, acceptance tests are written before code, by a context that never saw the implementation, and the implementer cannot change them unnoticed.
5. No new document type duplicates git history, code, README or PR text. Nothing is deleted without the user's say.
6. One install works for both Claude Code and Codex.

**Market position (from research, 2026-11-08).** Spec/planning tools are crowded (Spec Kit, OpenSpec, BMAD, Kiro, Task Master, GSD, superpowers, Compound Engineering). Recurring unmet needs: spec bloat nobody reads, ceremony that doesn't scale down, assumptions baked in during planning, self-review and tests-written-to-pass, no drift check between agreed decisions and code. loopwright is **standalone but interop-friendly**: a lean loop built around an assumption ledger, isolated test/review contexts and enforced gates; it can import a spec from another planner.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Package/CLI name `loopwright`; GitHub repo renamed to match. Clean break from `coding-agents-toolings`. |
| D2 | Standalone; may import an external spec/plan file (e.g. superpowers) as input to the Plan stage, then runs only the assumption-ledger pass over it. No runtime coupling to other plugins. |
| D3 | Planning uses an **assumption ledger**: investigate repo first, list every assumption tagged high/low impact; high → one question at a time; low → one batch to skim-confirm or override. |
| D4 | Durable cross-task knowledge goes into the repo's existing **AGENTS.md**; if an entry grows verbose it moves to `docs/agents/<topic>.md`, linked from AGENTS.md with a "read this when…" cue. Every addition is user-approved. Concepts, not file paths. If `CLAUDE.md` exists without `@AGENTS.md`, Done proposes adding that import instead of duplicating content; `init` never edits either file. |
| D5 | Task working state is local (gitignored), human-readable, one file per task, never auto-deleted. |
| D6 | Acceptance tests are written first by a separate tester subagent and locked; the implementer writes its own unit tests. |
| D7 | Reviewer is a fresh same-tool subagent by default; cross-vendor review (other CLI, headless) is opt-in. |
| D8 | Review is blind first (no implementer report). An optional second pass checks the implementer's claims; whether to run it is proposed per task. |
| D9 | Tier (small/standard/large), two-pass on/off and fix-round cap are proposed by the agent during Plan and confirmed by the user. |
| D10 | Gates are enforced by hooks, **installed by default**; `--no-hook` opts out (skills still work, unenforced). |
| D11 | Distribution: npm CLI, repo-local by default; `--global` installs into user dirs. No marketplace plugin yet. |
| D12 | Entry points: `/loopwright-flow` (whole loop) and `/loopwright-plan|test|build|review|done` (stages), equally documented. Codex invokes with `$` prefix. |
| D13 | Done stage proposes AGENTS.md/docs edits and drafts commit/PR text carrying the "why". The agent does not commit. |
| D14 | Code-comment standard: comments explain *why*, briefly, each rationale stated in exactly one place; no restating *what* the code does. Implementer instruction **and** reviewer check. |
| D15 | One shared `.loopwright/` in the main worktree for all worktrees of a repo. |
| D16 | Tech stack: TypeScript/ESM bundled with tsdown (zero runtime deps), `tsc --noEmit`, `node:util` `parseArgs`, `readline` prompts, plain content files, marker-block TOML edits, hash manifest, vitest, Node `>=22.14`. |
| D17 | Old skills (`spec-*`, `ide-mcp`) and the ide-mcp hook are removed from the package; `init` detects old installs and asks before removing them. `agent-specs/` is untouched. |
| D18 | Subagent models are configurable per role and per tool in `config.json`; Plan runs in the main thread and uses the session's model. |
| D19 | Review reports only proven, high-impact findings: confirmed ones block; unconfirmed-but-evidenced ones go to the user as *undecided*; everything else is dropped (count logged). Procedure in §5. |

## 3. Workflow

### Stages

| Stage | Runs in | Does |
|---|---|---|
| **Plan** | main thread (questions require it); repo investigation delegated to the read-only **scout** subagent | Input: goal text or imported spec. Scout report → assumption ledger → high-impact questions (one at a time) → low-impact batch → proposes tier, two-pass, fix-round cap, check commands (lint/typecheck/test) → user confirms. Each answer is written to the task file immediately. |
| **Test** | **tester** subagent | Writes acceptance tests from the confirmed acceptance criteria using the repo's existing runner (if none exists, Plan must have asked). Runs them, confirms they fail for the right reason, records file hashes → locked. Sees no implementation. |
| **Build** | **implementer** subagent | Reads decisions from the task file. Makes locked tests pass, adds its own unit tests, follows D14 and AGENTS.md/docs standards. Returns a short report. |
| **Review** | **reviewer** subagent (+ other CLI if opted in) | Runs check commands; verifies locked-test hashes (mismatch = automatic fail); blind pass per the review procedure (§5); optional second pass verifying the implementer's report claims. Writes a verdict bound to the working-tree fingerprint. Blocking findings → Build, up to the fix-round cap, then escalate; undecided findings → user. |
| **Done** | main thread | Proposes AGENTS.md/`docs/agents/` additions and prunes stale entries it noticed (each change approved individually); drafts commit message / PR text with decisions and rejected options; sets task `status: done`. |

### Tiers

- **small** — Plan (short) → Build → Review (blind only by default).
- **standard** — Plan → Test → Build → Review.
- **large** — Plan also splits work into slices; each slice runs Test → Build → Review; then a final whole-branch review.

### Codex differences

- Skills instruct explicitly: "spawn the `loopwright-<role>` subagent and wait" (Codex does not delegate unprompted).
- Questions are numbered plain text, one at a time, with a hint that `/plan` mode offers structured prompts. Claude uses `AskUserQuestion`.
- Subagent tool restriction is instruction-only in Codex; the review-stage hash check is the backstop.

## 4. State and files

### Location

`.loopwright/` lives in the **main worktree**, located from any worktree via `git rev-parse --git-common-dir` (its parent dir). Bare repo with no main worktree → fall back to `.loopwright/` in the current worktree. The folder contains its own `.gitignore` (`*`), so the user's `.gitignore` is never edited.

```
.loopwright/
  .gitignore                   # "*"
  config.json                  # user settings
  manifest.json                # repo-install manifest (see §6)
  state/<worktree-id>.json     # machine state per worktree
  tasks/<YYYY-MM-DD>-<title>.md
```

`<title>` is a short, human-readable title derived from the goal, keeping meaningful casing (e.g. `2026-11-08-add-CLAUDE-to-project.md`); only filesystem-unsafe characters are replaced. Collisions get a `-2` suffix.

### config.json

```json
{
  "maxFixRounds": 3,
  "crossModelReview": "off",
  "docsDir": "docs/agents",
  "models": {
    "claude": { "scout": "opus", "tester": "sonnet", "implementer": "sonnet", "reviewer": "opus" },
    "codex":  { "scout": "inherit", "tester": "inherit", "implementer": "inherit", "reviewer": "inherit" },
    "crossModelReviewer": { "claude": "opus", "codex": "inherit" }
  }
}
```
- `crossModelReview`: `"off" | "codex" | "claude"`. Tier proposals may suggest a lower per-task fix-round cap.
- `models`: values are tool-native aliases or full IDs, or `inherit` (session model). Aliases are preferred so defaults don't age. `init`/`update` render them into the generated agent files; `config.json` is the single place to change them (editing generated agent files directly is flagged as a user modification by the manifest). Codex roles may also set `model_reasoning_effort`.
- Plan runs in the main thread, so its model is whatever the session uses; README advises starting the session on the model you want for planning.

### Task file (human-facing, target ≤ ~150 lines, one-line entries)

- Header: status (`active|done`), stage, tier, two-pass, fix-round cap, check commands, worktree + branch, base commit.
- Goal (one paragraph).
- Decisions `D1…` — each tagged `asked` / `batch-confirmed` / `overridden`.
- Assumptions `A1…` — confirmed or overridden.
- Acceptance criteria `AC1…` — each mapped to its test(s).
- Slices (large tier only).
- Review log — one line per round: verdict + key findings.
- Open questions.

### state/<worktree-id>.json (machine-only)

Active task path, stage, locked tests `[{path, sha256}]`, latest verdict `{pass, fingerprint, round}`, stop-gate block count. Per-worktree files avoid concurrent writes between sessions.

**Fingerprint** = hash of `git diff <base-commit>` plus contents of untracked, non-ignored files in the task's worktree. Any code change after a pass makes the verdict stale.

## 5. Enforcement and wiring

### Hooks (shared `.mjs`, zero deps, no-op when no loopwright task is active)

| Hook | Event | Behavior |
|---|---|---|
| `guard-locked-tests` | PreToolUse | During Build, blocks edit tools on locked paths (Claude `Edit`/`Write`/`MultiEdit`; Codex `apply_patch`). Shell edits are not reliably detectable — Review re-hashes as backstop. |
| `stop-gate` | Stop | If stage is Build/Review and no passing verdict matches the current fingerprint → block with reason. Blocks at most 3 times per stage, then allows stop with a visible warning (deadlock guard; cap is fixed in v1, not a config option). |
| `reinject-context` | Claude `SessionStart` (matcher `compact`); Codex `PostCompact` | Prints goal, stage, decisions and next step from the active task file. |

Wiring: Claude → `.claude/settings.json` (merged, deduped by script path). Codex → `.codex/config.toml` marker block (`# BEGIN/END loopwright`) or `.codex/hooks.json`, whichever the spike in §9 confirms is current. `init` prints the Codex trust/approval step (`/hooks`); skills warn if hooks appear inactive.

### Subagents

Single source per role (`scout`, `tester`, `implementer`, `reviewer`) in Claude format under `content/agents/`. Build emits `.claude/agents/loopwright-<role>.md` and generates `.codex/agents/loopwright-<role>.toml`, with per-target overrides for model/tools. Claude restrictions: scout and reviewer have no edit tools (reviewer keeps shell to run checks).

### Review procedure (reviewer prompt, `content/prompts/reviewer.md`)

1. **Scope** — diff vs task base commit, locked tests, task file.
2. **Intent** — goal, decisions, acceptance criteria (blind pass: no implementer report).
3. **Inspect** changed files and nearby code to understand call paths.
4. **List candidate blocking issues silently** — bugs, regressions, security vulnerabilities, architecturally bad decisions, non-simplified code paths (a much simpler path does the same), missing tests; plus decision/AC violations, scope creep, D14 violations, deviations from standards docs and codebase patterns. Lint/format-level nits are excluded (mechanical checks own them).
5. **Investigate each** — self-verify first (re-read code, run a repro or test). Assign impact and confidence (high/mid/low).
6. **Report**
   - **Blocking**: high impact + high confidence, confirmed → sent to Build.
   - **Undecided**: high impact, could not be confirmed, **but backed by proof** (file:line, reputable SDK source or official docs link, decision/AC id) → presented to the user, who decides fix or dismiss.
   - Everything else (no proof, or below high impact) is dropped; only the count is logged.
7. **Verdict passes** when there are no blocking findings and every undecided finding is resolved by the user.

Every reported finding carries: location, the violated expectation, the proof, impact, confidence.

### Cross-model review (opt-in)

Same reviewer prompt file, executed via `codex exec --sandbox read-only --output-schema <schema>` or `claude -p --output-format json --json-schema <schema>`. Both verdicts must pass. Missing CLI → step skipped, noted in the review log.

## 6. Installer

### Commands

```
npx loopwright init      [--global] [--no-hook] [--no-symlink] [--dry-run] [--force]
npx loopwright update    [--global] [--dry-run]
npx loopwright uninstall [--global] [--dry-run]
```

**Repo install** writes (intended to be committed, so teams share the workflow):
- `.agents/skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md` + `.claude/skills → ../.agents/skills` symlink (existing conflict handling retained).
- `.claude/agents/loopwright-*.md`, `.codex/agents/loopwright-*.toml`.
- `.agents/loopwright/hooks/*.mjs` (one copy, referenced by both tools).
- Hook wiring (unless `--no-hook`).
- `.loopwright/` with `.gitignore`, default `config.json`, `manifest.json`.

**Global install** writes the equivalent into `~/.agents/skills`, `~/.claude/skills`, `~/.claude/agents`, `~/.codex/agents`, `~/.config/loopwright/hooks/`, merges wiring into user Claude/Codex config, and keeps its manifest at `~/.config/loopwright/manifest.json`. It shows the planned changes and asks before touching user config (unless `--force`).

**Manifest** records every file written (path, sha256) and every config entry/block added. `update` re-applies the current version; a file whose hash differs from the manifest is user-edited → kept and the user is asked. `uninstall` removes only unmodified manifest files and loopwright config entries; it never touches `.loopwright/tasks/`.

**Migration** (D17): `init` detects old artifacts — `spec-create|update|complete|handoff`, `ide-mcp` skill dirs, `ide-mcp-context.mjs` hooks, the `coding-agents-toolings ide-mcp` marker block in `.codex/config.toml`, matching `.claude/settings.json` entries — lists them and removes only on confirmation.

### Source layout

```
content/
  skills/loopwright-*/SKILL.md
  agents/<role>.md            # single source; Codex TOML generated
  hooks/*.mjs
  prompts/reviewer.md          # shared with headless cross-model review
  schemas/verdict.json
src/
  cli.ts                       # parseArgs dispatch
  commands/{init,update,uninstall}.ts
  install/{targets,manifest,claude-settings,codex-config,symlink,conflict,migrate}.ts
  generate/codex-agent.ts
```

Content files are copied at install time and located via `new URL('../content', import.meta.url)`; `content/` is included in the package `files`.

### Release

1. Rename GitHub repo to `loopwright`; update `package.json` (name, bin, repository), README, workflow.
2. **User step:** publish placeholder `loopwright@0.0.0` manually (2FA), configure npm trusted publisher for the repo workflow (requires the package to exist; config expires if unused for 48h).
3. Tag `v0.1.0` → CI publishes via OIDC; user then disables token publishing.

## 7. Error handling

- Not a git repo → `init` exits with a clear message (repo mode); `--global` does not require one.
- Hook failure (exception, unreadable state) → hooks fail **open** with a stderr warning, so a loopwright bug never bricks the user's session; Review's hash/fingerprint checks remain the authoritative gate.
- Corrupt `state/*.json` → treated as no active task; skills offer to rebuild state from the task file.
- Malformed user `settings.json` → abort that step with the parse error; never overwrite.
- Cross-model CLI missing, unauthenticated or erroring → skip with a review-log note; never blocks.
- Fix-round cap reached → stop, present open findings, user decides.

## 8. Testing

- **e2e (vitest)** against temp git repos spawning the built CLI: `init`/`update`/`uninstall`, `--global` with `HOME` pointed at a temp dir, idempotence, `--dry-run` writes nothing, user-edited file protection, migration detection and confirmed removal, `.claude/skills` conflict states.
- **Hooks**: Claude- and Codex-shaped stdin fixtures → block/allow, deadlock cap, fail-open behavior, common-dir resolution from a real `git worktree add`.
- **Codex agent generation**: golden files + `smol-toml` parse (dev dependency only).
- **Content lint**: each SKILL.md has spec-valid `name` (lowercase/digits/hyphens, matches dir) and `description`.
- **Not automated**: whether agents follow the skills. v1 ships a manual dogfood checklist: one task per tier, in both Claude Code and Codex.

## 9. To verify early (spikes in the plan)

Facts from research that are unconfirmed or version-sensitive; each must be checked before the dependent work:
1. Codex hook config location/format (`.codex/hooks.json` vs `[hooks]` in `config.toml`) and the `PostCompact` event's ability to inject context.
2. Codex `PreToolUse` tool name/payload for file edits (`apply_patch`) and block response shape.
3. Codex `request_user_input` availability outside Plan mode (affects only the question UX hint).
4. Claude `Stop` hook loop semantics (`stop_hook_active`) — informs the deadlock guard.
5. Whether `git worktree remove` deletes ignored files (motivates D15; design holds either way).

## 10. Out of scope (v1)

`doctor` command; worktree isolation for subagents; parallel slices across worktrees; Claude/Codex marketplace plugins (and with them `/loopwright:<stage>` colon names); automated skill-behavior evals.
