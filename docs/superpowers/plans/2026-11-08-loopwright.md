# loopwright Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `coding-agents-toolings` spec skills with `loopwright`: an npm CLI that installs a Plan → Test → Build → Review → Done agent workflow (skills, subagents, hooks, state tool) for Claude Code and Codex, repo-local or `--global`.

**Architecture:** Product content (skills, agent sources, hooks, reviewer prompt, verdict schema) lives as plain files under `content/` and is copied at install time with `{{LW_HOME}}` substitution. A TypeScript CLI (`init`/`update`/`uninstall`) resolves install targets, writes files through a manifest-aware writer, renders Claude agents and generates Codex agent TOML from one source, and merges hook wiring into each tool's config. Runtime enforcement is zero-dependency `.mjs` hooks plus `lw.mjs`, a small state tool the skills call to lock tests, compute fingerprints and record verdicts.

**Tech Stack:** TypeScript (ESM) bundled by tsdown, `tsc --noEmit` type check, `node:util` `parseArgs`, `node:readline`, vitest, smol-toml (dev only), Node ≥ 22.14.

**Spec:** `docs/superpowers/specs/2026-11-08-loopwright-design.md`

## Global Constraints

- Package name and bin: `loopwright`. Node `engines`: `>=22.14`. Zero runtime `dependencies` in `package.json`.
- Skill names: `loopwright-flow`, `loopwright-plan`, `loopwright-test`, `loopwright-build`, `loopwright-review`, `loopwright-done` (lowercase/digits/hyphens; must equal the folder name).
- Agent roles: `scout`, `tester`, `implementer`, `reviewer`; installed names `loopwright-<role>`.
- Repo paths: skills `.agents/skills/`, symlink `.claude/skills → ../.agents/skills`, agents `.claude/agents/loopwright-<role>.md` and `.codex/agents/loopwright-<role>.toml`, runtime home `.agents/loopwright/` (`hooks/`, `prompts/`, `schemas/`).
- Global paths: `~/.agents/skills`, `~/.claude/skills` (copies, no symlink), `~/.claude/agents`, `~/.codex/agents`, runtime home `~/.config/loopwright/`, manifest `~/.config/loopwright/manifest.json`, config `~/.config/loopwright/config.json`.
- State dir `.loopwright/` in the **main worktree** (via `git rev-parse --path-format=absolute --git-common-dir`; parent of a `.git` common dir; bare repo → current worktree top-level). Contains `.gitignore` = `*\n`, `config.json`, `manifest.json` (repo mode), `state/<worktree-id>.json`, `tasks/`.
- Default config: `{"maxFixRounds":3,"crossModelReview":"off","docsDir":"docs/agents","models":{"claude":{"scout":"opus","tester":"sonnet","implementer":"sonnet","reviewer":"opus"},"codex":{"scout":"inherit","tester":"inherit","implementer":"inherit","reviewer":"inherit"},"crossModelReviewer":{"claude":"opus","codex":"inherit"}}}`. Written only if absent; never overwritten.
- Hooks fail **open** (exit 0 + stderr warning) on internal errors; no-op when no active task. Stop-gate blocks at most 3 times per stage.
- Never delete user files without confirmation; never touch `.loopwright/tasks/`; `init` never edits AGENTS.md/CLAUDE.md.
- Codex/Claude constants marked **[SPIKE]** below were provisional until Task 1 recorded results (now resolved; see Spike results at end).

## Review Focus

1. A user's existing `.claude/settings.json` hooks on the same events (Stop, PreToolUse, SessionStart) must survive init, update and uninstall untouched → Task 6 test `preserves foreign hooks on merge and remove`.
2. Repo or home paths containing spaces must produce working hook commands → Task 6 test `quotes hook commands with spaces`, Task 7 e2e repo created under a dir with a space.
3. Hooks run from a subdirectory, from a secondary worktree, or outside any git repo (global install) must resolve the right `.loopwright/` or no-op fast → Task 9 tests `resolves main worktree from secondary worktree`, `no-op outside git`.
4. Re-running `init`/`update` after the user edited an installed skill must keep the edit unless confirmed/`--force` → Task 8 test `keeps user-edited files on update`.
5. Corrupt or missing `state/*.json` must never block the agent → Task 10 test `stop-gate fails open on corrupt state`.

---

## Prerequisites (user)

- [x] Codex CLI installed (codex-cli 0.167.0). **No Codex account**: never run model turns; verify Codex facts only via offline CLI introspection and upstream source/docs.
- [x] `gh` installed (2.46.0). [ ] `gh auth login` (needed for Task 16).

### Task 1: Spike — verify platform facts (spec §9)

Throwaway investigation; output is a filled **Spike results** section appended to this plan, plus edits to any **[SPIKE]** constant in later tasks. Codex methods are limited to offline introspection (`codex features list`, `codex doctor`, `codex debug prompt-input`, `--help`) and reading upstream `openai/codex` source/docs at the tag matching `codex --version`. Each result is labelled `verified (cli)`, `verified (source)`, or `docs only`.

Already observed (codex-cli 0.167.0, `codex features list`): `hooks` stable, default true; `default_mode_request_user_input` under development, default false (→ item 3 answered: Plan-mode only by default).

- [ ] **Step 1: Codex hook config** — in a scratch repo, write a `Stop` hook once in `.codex/hooks.json` and once as `[hooks]` in `.codex/config.toml`; run `codex doctor` (and `codex debug prompt-input` with a `SessionStart` hook that prints a marker) to see which config is loaded/validated and whether hook output reaches the prompt. Confirm from source: config location precedence, whether `[features] hooks` must be set, the project-trust/approval requirement, and `PostCompact` output semantics.
- [ ] **Step 2: Codex PreToolUse for edits** — from source: the hook stdin payload schema, the tool name for file edits (expected `apply_patch`) and where patch paths appear, and the block response format (`{"decision":"block","reason":…}` vs exit code 2).
- [ ] **Step 3: Claude hooks** — with the local `claude` 2.1.x in a scratch repo (real runs OK): confirm PreToolUse deny via exit 2 + stderr for `Edit|Write|MultiEdit`; Stop block via exit 2 and `stop_hook_active` on the repeated Stop; `SessionStart` matcher `compact` stdout injection (doc-confirm if compaction can't be triggered cheaply).
- [ ] **Step 4: Worktree removal** — `git worktree add ../wt`, create an ignored file there, `git worktree remove ../wt`; record whether it succeeds and deletes the file.
- [ ] **Step 5: Record** — append `## Spike results` (one line per item: fact, evidence label, source link/command) to this plan; update **[SPIKE]** constants in Tasks 6, 9, 10; commit `docs: record loopwright spike results`. Anything left `docs only` for Codex is listed as a dogfood risk in Task 15.

### Task 2: Toolchain, CLI skeleton, remove old product

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `.npmignore` (delete if `files` suffices), `vitest.config.ts`
- Create: `tsdown.config.ts`, `src/cli.ts`, `test/helpers.ts`, `test/cli.test.ts`
- Delete: `src/index.ts`, `src/commands/init.ts`, `src/templates/*`, `src/installer/{write-skills,gitignore,codex-hooks,claude-settings}.ts`, `test/init.test.ts`
- Move: `src/installer/{link-claude,conflict}.ts` → `src/install/symlink.ts` (merge both; keep behavior), `test/link-claude.test.ts` → `test/symlink.test.ts`

**Interfaces:**
- Produces: `main(argv: string[]): Promise<number>` in `src/cli.ts`; `interface CommandOptions { mode: 'repo' | 'global'; cwd: string; home: string; dryRun: boolean; force: boolean; hook: boolean; symlink: boolean }` in `src/core/options.ts`; test helpers `createTempGitRepo(prefix?: string): string`, `runCli(cwd: string, args: string[], opts?: { home?: string; input?: string }): { stdout: string; stderr: string; exitCode: number }`, `readJson(path: string): any`.
- `runCli` spawns `node dist/cli.js` with `NO_COLOR=1` and `HOME` set to `opts.home ?? <fresh temp dir>` (tests must never touch the real home).

- [ ] **Step 1: Write failing tests** in `test/cli.test.ts`: `prints help` (`--help` → exit 0, stdout contains `loopwright init`, `update`, `uninstall`, `--global`, `--no-hook`, `--no-symlink`, `--dry-run`, `--force`); `prints version` (`--version` → stdout equals `package.json` version); `rejects unknown command` (`frobnicate` → exit 1, stderr contains `Unknown command`); `dist starts with shebang` (`dist/cli.js` first line `#!/usr/bin/env node`).
- [ ] **Step 2: Update tooling** — `package.json`: name `loopwright`, version `0.0.0`, bin `{"loopwright":"./dist/cli.js"}`, `files: ["dist/","content/"]`, engines `>=22.14`, scripts `build: tsdown`, `typecheck: tsc --noEmit`, `pretest: npm run build`, `test: vitest run`, `dev: npm run build && node dist/cli.js`; devDeps add `tsdown`, `smol-toml`; repository URL `https://github.com/xuansontrinh/loopwright.git`. `tsconfig.json`: `module`/`moduleResolution` `NodeNext`, `noEmit: true`, include `src` and `test`. `tsdown.config.ts`: entry `src/cli.ts`, format `esm`, platform `node`, target `node22`, output `dist/cli.js` (set `fixedExtension: false` or equivalent so the file is `.js`), shebang preserved. Delete `tsconfig.build.json`.
- [ ] **Step 3: Implement `src/cli.ts`** with `parseArgs` (`allowPositionals: true`, `strict: true`); commands dispatch to `runInit`/`runUpdate`/`runUninstall` stubs returning `0` (filled by Tasks 7–8); help text lists every flag above. Delete the old files listed.
- [ ] **Step 4: Run** `npm install && npm run typecheck && npm test` — Expected: all of `test/cli.test.ts` and `test/symlink.test.ts` PASS.
- [ ] **Step 5: Commit** `chore: switch to loopwright toolchain and CLI skeleton`.

### Task 3: Targets, content access, template rendering

**Files:**
- Create: `src/core/options.ts`, `src/core/targets.ts`, `src/core/content.ts`, `src/core/git.ts`, `test/targets.test.ts`

**Interfaces:**
- Consumes: `CommandOptions` (Task 2).
- Produces:
  - `interface Targets { mode; root: string; skillsDir: string; claudeSkillsDir: string; claudeSkillsMode: 'symlink' | 'copy' | 'none'; claudeAgentsDir: string; codexAgentsDir: string; lwHome: string; lwHomeRef: string; claudeSettingsPath: string; codexConfigPath: string; manifestPath: string; configPath: string; stateDir: string | null }` — `lwHomeRef` is the string substituted for `{{LW_HOME}}` (repo: `.agents/loopwright`; global: absolute `~/.config/loopwright`). `stateDir` = main-worktree `.loopwright` in repo mode, `null` in global mode.
  - `resolveTargets(opts: CommandOptions): Targets` (repo mode throws `NotAGitRepoError` outside git).
  - `mainWorktreeRoot(cwd: string): string` in `src/core/git.ts`.
  - `contentRoot(): string` (`new URL('../content/', import.meta.url)`), `listContent(subdir: string): string[]` (relative paths, sorted), `readContent(rel: string): string`, `renderTemplate(text: string, vars: Record<string,string>): string` (replaces `{{KEY}}`; throws on an unknown `{{…}}`).

- [ ] **Step 1: Failing tests**: `repo targets` (paths equal Global Constraints relative to the temp repo; `claudeSkillsMode` `symlink`, or `none` with `symlink:false`); `global targets` (paths under `opts.home`; `claudeSkillsMode` `copy`; `stateDir` null); `main worktree from secondary worktree` (create `git worktree add`, call from it → returns main root); `bare repo fallback`; `renderTemplate replaces and rejects unknown placeholders`; `repo mode outside git throws NotAGitRepoError`.
- [ ] **Step 2: Run** `npx vitest run test/targets.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the interfaces above. `mainWorktreeRoot`: `git rev-parse --path-format=absolute --git-common-dir`; if basename is `.git` return its parent, else `git rev-parse --show-toplevel`.
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** `feat: resolve install targets and content`.

### Task 4: Manifest-aware writer

**Files:**
- Create: `src/core/manifest.ts`, `src/core/writer.ts`, `test/writer.test.ts`
- Modify: `src/utils/fs.ts` (drop unused helpers after Task 2 deletions)

**Interfaces:**
- Produces:
  - `interface Manifest { version: 1; mode: 'repo' | 'global'; files: { path: string; sha256: string }[]; config: { file: string; kind: 'claude-hooks' | 'codex-block' }[] }` (paths relative to root in repo mode, absolute in global).
  - `readManifest(path: string): Manifest | null`, `writeManifest(path: string, m: Manifest): void`, `sha256(text: string): string`.
  - `class InstallWriter { constructor(opts: { manifest: Manifest | null; dryRun: boolean; force: boolean; confirm: (q: string) => Promise<boolean>; toKey: (abs: string) => string }); writeFile(abs: string, content: string): Promise<WriteOutcome>; recordConfig(entry: Manifest['config'][number]): void; result(): Manifest }`
  - `type WriteOutcome = 'created' | 'updated' | 'unchanged' | 'kept'`.
- Decision rule (`writeFile`): absent → create. Equal to `content` → unchanged. Current hash equals manifest hash → update. Otherwise (user-edited or unknown) → `force` ? update : `confirm("<path> was modified. Overwrite?")` (default No) → kept. Dry-run computes the outcome, writes nothing, never prompts (reports `kept` as "would ask").

- [ ] **Step 1: Failing tests**: `creates new file`; `unchanged when identical`; `updates file untouched since last install`; `keeps user-edited file when declined`; `overwrites user-edited file with force`; `dry run writes nothing and does not prompt`; `result() lists every written/unchanged/kept file with current hash`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: manifest-aware install writer`.

### Task 5: Agent sources and generators

**Files:**
- Create: `content/agents/{scout,tester,implementer,reviewer}.md` (frontmatter + **placeholder body** `TODO-BODY` — replaced in Task 12), `src/generate/agents.ts`, `src/core/config.ts`, `test/agents.test.ts`, `test/fixtures/agents/reviewer.claude.md`, `test/fixtures/agents/reviewer.codex.toml`

**Interfaces:**
- Produces:
  - `interface AgentSource { role: string; name: string; description: string; tools?: string; body: string }`; `parseAgentSource(role: string, md: string): AgentSource` — frontmatter is flat `key: value` lines between `---` fences; throws on missing `name`/`description`.
  - `renderClaudeAgent(src: AgentSource, model: string): string` — frontmatter `name`, `description`, `tools` (if set), `model` (omitted when `inherit`), then body.
  - `renderCodexAgent(src: AgentSource, model: string, effort?: string): string` — TOML keys `name`, `description`, `developer_instructions` (TOML multi-line literal `'''…'''`; if body contains `'''` use basic multi-line with escapes), `model` (omitted when `inherit`), `model_reasoning_effort` (if set). Tools dropped.
  - `interface LoopwrightConfig` matching the default config in Global Constraints; `DEFAULT_CONFIG`; `readConfig(path: string): LoopwrightConfig` (missing → default; partial → deep-merged with default; invalid JSON → throws with path).
- Source frontmatter values: `name: loopwright-<role>`; `tools` — scout `Read, Grep, Glob`; tester `Read, Grep, Glob, Edit, Write, Bash`; implementer `Read, Grep, Glob, Edit, Write, MultiEdit, Bash`; reviewer `Read, Grep, Glob, Bash`.

- [ ] **Step 1: Failing tests**: golden `renderClaudeAgent(reviewer, 'opus')` equals fixture; golden `renderCodexAgent(reviewer, 'inherit')` equals fixture and parses with `smol-toml` to `{name, description, developer_instructions}` with no `model`; `body containing ''' round-trips through smol-toml`; `readConfig merges partial config`; `parseAgentSource rejects missing description`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: single-source agent generation for Claude and Codex`.

### Task 6: Hook wiring merges

**Files:**
- Create: `src/install/claude-settings.ts`, `src/install/codex-config.ts`, `src/install/hook-wiring.ts`, `test/wiring.test.ts`

**Interfaces:**
- Produces:
  - `interface HookSpec { event: string; matcher?: string; script: string }` and `hookSpecs(tool: 'claude' | 'codex'): HookSpec[]`:
    - claude: `PreToolUse` matcher `Edit|Write|MultiEdit` → `guard-locked-tests.mjs`; `Stop` → `stop-gate.mjs`; `SessionStart` matcher `compact` → `reinject-context.mjs`.
    - codex (spike-confirmed): `PreToolUse` matcher `^apply_patch$` → `guard-locked-tests.mjs`; `Stop` → `stop-gate.mjs`; `SessionStart` matcher `compact` → `reinject-context.mjs` (was `PostCompact`: its stdout is ignored, so it cannot inject context; Codex re-fires `SessionStart` with source `compact` after compaction). TOML shape: `[[hooks.<Event>]]` (+ optional `matcher`) with `[[hooks.<Event>.hooks]]` entries `type = "command"`, `command = "…"`.
  - `hookCommand(tool, targets: Targets, script: string): string` — claude repo: `node "$CLAUDE_PROJECT_DIR/.agents/loopwright/hooks/<script>" --tool claude`; codex repo: `node "$(git rev-parse --show-toplevel)/.agents/loopwright/hooks/<script>" --tool codex`; global: `node "<abs lwHome>/hooks/<script>" --tool <tool>`.
  - `mergeClaudeHooks(settingsText: string, specs: HookSpec[], commandFor: (s: HookSpec) => string): string` and `removeClaudeHooks(settingsText: string, hint: string): string` — managed entries identified by command containing `loopwright/hooks/`; foreign groups untouched; empty arrays/objects created by us are removed on uninstall; parse errors throw with the file path (never overwrite).
  - `upsertCodexBlock(text: string, block: string): string`, `removeCodexBlock(text: string): string`, `ensureCodexFeature(text: string, flag: string): string` (flag confirmed: `hooks`, stable and default-on in 0.167.0; `codex_hooks` is a legacy alias — only write it when the flag is absent AND explicitly requested; `init` need not set it, but the helper stays for older builds), `renderCodexHookBlock(specs, commandFor): string` — markers `# BEGIN loopwright` / `# END loopwright`. (Spike: `.codex/config.toml` `[hooks]` and `.codex/hooks.json` both load and merge; Codex warns if one layer uses both, so keep `config.toml` only — `hooks.json` is NOT required; skip this fallback. Hooks also need per-hook trust via `/hooks` and a trusted project. If implementing `mergeCodexHooksJson`/`removeCodexHooksJson` with the Claude merge semantics instead and record `kind: 'codex-block'` → `'codex-hooks-json'`.)

- [ ] **Step 1: Failing tests**: `merges into empty settings`; `idempotent merge`; `preserves foreign hooks on merge and remove` (settings with a user `Stop` hook and a user `PreToolUse` hook → both present byte-equivalent after merge and after remove); `throws on invalid JSON without writing`; `codex block upsert replaces previous block and preserves user comments`; `ensureCodexFeature adds flag under existing [features]`; `rendered codex config parses with smol-toml`; `quotes hook commands with spaces` (global home `/tmp/a b/` → command contains `"/tmp/a b/.config/loopwright/hooks/stop-gate.mjs"`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Reuse the dedupe/merge approach from the deleted `claude-settings.ts` (git history) and the marker-block code from the deleted `codex-hooks.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: hook wiring for Claude settings and Codex config`.

### Task 7: `init` (repo + global) and `.loopwright/` scaffold

**Files:**
- Create: `src/commands/init.ts`, `src/install/install.ts`, `src/install/loopwright-dir.ts`, `test/init.test.ts`
- Modify: `src/cli.ts` (wire `runInit`)

**Interfaces:**
- Consumes: Tasks 3–6, `linkClaude` from `src/install/symlink.ts` (adapted to take `Targets`).
- Produces:
  - `runInit(opts: CommandOptions): Promise<number>`.
  - `installAll(targets: Targets, writer: InstallWriter, config: LoopwrightConfig, opts: CommandOptions): Promise<boolean>` (shared with `update`) — writes: each `content/skills/*/SKILL.md` rendered with `LW_HOME` into `skillsDir` (and copied into `claudeSkillsDir` when mode `copy`); symlink when mode `symlink`; agents rendered with `config.models.<tool>.<role>`; `content/hooks/*.mjs`, `content/prompts/*`, `content/schemas/*` into `lwHome`; wiring unless `opts.hook === false`; returns whether anything changed.
  - `scaffoldLoopwrightDir(stateDir: string, dryRun: boolean): void` — creates `.gitignore` (`*\n`), `config.json` (default, only if absent), `tasks/`, `state/`.
- Global mode: before writing, print the list of files and config files to be touched, then `confirm("Apply these changes to your user configuration?")` unless `--force`. Config read from `targets.configPath`.
- After repo install, print the Codex trust step: `Codex: trust this project and approve loopwright hooks via /hooks.`
- Final line `loopwright is already up to date.` when nothing changed.

- [ ] **Step 1: Failing e2e tests** (repo under a temp dir whose path contains a space): `installs all skills, agents, runtime files and wiring` (assert every Global Constraints repo path exists; each SKILL.md has no `{{`); `.claude/skills is a symlink to ../.agents/skills`; `--no-symlink skips the link`; `--no-hook writes no wiring`; `creates .loopwright with self-ignoring .gitignore and default config` (`git status --porcelain` shows no `.loopwright` entries); `does not overwrite existing config.json`; `agents use configured models` (pre-write config with `reviewer: "sonnet"` → `.claude/agents/loopwright-reviewer.md` contains `model: sonnet`); `is idempotent` (second run prints `already up to date`); `--dry-run writes nothing`; `fails outside a git repo with a clear message`; `aborts wiring on malformed settings.json and leaves it byte-identical` (exit 1, stderr names the file); `--global --force installs under HOME` (assert global paths; repo untouched); `--global without --force and declined input writes nothing` (`input: "n\n"`).
- [ ] **Step 2: Run** `npm test -- test/init.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: loopwright init for repo and global installs`.

### Task 8: `update` and `uninstall`

**Files:**
- Create: `src/commands/update.ts`, `src/commands/uninstall.ts`, `test/lifecycle.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `installAll`, `InstallWriter`, manifest, wiring removers.
- Produces: `runUpdate(opts): Promise<number>` (= `installAll` with the existing manifest; missing manifest → treat existing files as unknown); `runUninstall(opts): Promise<number>` — for each manifest file: hash matches → delete; else keep and warn `kept modified file <path>`; remove wiring via recorded config entries; remove the `.claude/skills` symlink only if it points to `../.agents/skills`; delete now-empty directories loopwright created; delete `manifest.json`; leave the rest of `.loopwright/` untouched.

- [ ] **Step 1: Failing e2e tests**: `update applies new content` (mutate an installed file's manifest hash to simulate an old version → update rewrites it); `keeps user-edited files on update` (edit a SKILL.md → `update` with `input: "n\n"` keeps it, `--force` overwrites); `uninstall removes only loopwright files` (pre-existing user skill dir and user Stop hook survive); `uninstall keeps modified files and tasks` (edited SKILL.md and `.loopwright/tasks/x.md` remain); `global uninstall cleans HOME`; `uninstall --dry-run deletes nothing`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: loopwright update and uninstall`.

### Task 9: Hook runtime library and `lw.mjs` state tool

**Files:**
- Create: `content/hooks/lib.mjs`, `content/hooks/lw.mjs`, `test/hooks/lw.test.ts`, `test/hooks/helpers.ts`

**Interfaces:**
- Produces (`lib.mjs`, no imports beyond `node:*`):
  - `loopwrightDir(cwd): string | null` (main-worktree `.loopwright` if it exists; `null` outside git or if absent), `worktreeId(cwd): string` (first 12 hex of sha256 of `git rev-parse --show-toplevel`), `readState(dir, id): State | null` (corrupt → `null` + stderr warning), `writeState(dir, id, state)` (write tmp + rename), `fingerprint(cwd, baseCommit): string`, `sha256File(path): string`, `readStdinJson(): Promise<object>`, `allow()`, `deny(tool: 'claude' | 'codex', event: string, reason: string)` (spike-confirmed: both tools use stderr reason + exit 2 for PreToolUse and Stop; Codex's `{"decision":"block"}` is deprecated for PreToolUse, and Codex exit 2 with empty stderr does NOT block, so the reason must be non-empty), `failOpen(err)` (stderr `loopwright hook error: …`, exit 0).
  - `State = { version: 1; task: string; stage: 'plan'|'test'|'build'|'review'|'done'; baseCommit: string; worktree: string; branch: string; lockedTests: { path: string; sha256: string }[]; verdict: { pass: boolean; fingerprint: string; round: number } | null; stopBlocks: number }`.
  - Fingerprint: sha256 over `git diff --binary <baseCommit>` stdout, then for each path from `git ls-files --others --exclude-standard -z` (sorted): `path + "\0" + bytes`.
- `lw.mjs` CLI (prints JSON on success, exit 1 + message on error): `dir`; `start <task-rel-path> [--base <sha>]` (base defaults to `HEAD`, stage `plan`); `stage <name>` (resets `stopBlocks`); `lock <paths…>`; `check-locks` (exit 1 listing changed/missing paths); `fingerprint`; `verdict <pass|fail> --round <n>`; `status`; `done` (stage `done`, active task cleared after recording).

- [ ] **Step 1: Failing tests** (spawn `node content/hooks/lw.mjs` in temp repos; helper scaffolds `.loopwright/`): `start creates state for worktree`; `resolves main worktree from secondary worktree` (state file lands in main `.loopwright/state/`, id differs per worktree); `lock then check-locks passes; edit then fails`; `fingerprint changes on tracked edit and on new untracked file, not on ignored file`; `verdict records current fingerprint`; `corrupt state reads as null`; `no-op outside git` (`dir` prints `null`, exit 0).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: hook runtime library and lw state tool`.

### Task 10: Enforcement hooks

**Files:**
- Create: `content/hooks/guard-locked-tests.mjs`, `content/hooks/stop-gate.mjs`, `content/hooks/reinject-context.mjs`, `test/hooks/enforcement.test.ts`, `test/fixtures/hooks/{claude,codex}-{pretooluse,stop,compact}.json`

**Interfaces:**
- Consumes: `lib.mjs`.
- Behavior:
  - `guard-locked-tests`: stage `build` and edited path (claude `tool_input.file_path`; codex: stdin `tool_name` is `apply_patch` and `tool_input` is `{"command": "<patch text>"}`; parse paths from lines `*** Add File: `, `*** Update File: `, `*** Delete File: `, `*** Move to: `; patch paths may be relative to `cwd`) resolves to a locked path → `deny(…, "loopwright: <path> is a locked acceptance test. Ask the user before changing it.")`; else allow.
  - `stop-gate`: stage `build` or `review` and (`verdict` null, not pass, or fingerprint ≠ current) → if `stopBlocks < 3`: increment, `deny(…, "loopwright: no passing review for the current code. Run /loopwright-review (or finish the fix loop) before stopping.")`; else allow with stderr `loopwright: stop-gate limit reached; review gate NOT satisfied.`.
  - `reinject-context`: active task → stdout ≤ 40 lines: goal, stage, decision lines (`- D…`), next step for the stage; else nothing.
  - Every hook: any thrown error → `failOpen`.

- [ ] **Step 1: Failing tests** (fixtures fed on stdin, both `--tool` values): `guard denies edit of locked test during build`; `guard allows edit of locked test outside build`; `guard allows non-locked path`; `stop-gate blocks without verdict and allows after pass verdict`; `stop-gate blocks when code changed after pass`; `stop-gate allows after 3 blocks with warning`; `stop-gate fails open on corrupt state`; `reinject prints goal, stage and decisions`; `hooks no-op without active task`; `each hook exits within 500 ms` (measure in test).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: locked-test guard, stop gate and context reinjection hooks`.

### Task 11: Legacy migration

**Files:**
- Create: `src/install/migrate.ts`, `test/migrate.test.ts`
- Modify: `src/commands/init.ts` (run before install)

**Interfaces:**
- Produces: `interface LegacyArtifact { description: string; apply: () => void }`; `detectLegacy(root: string): LegacyArtifact[]` covering: `.agents/skills/{spec-create,spec-update,spec-complete,spec-handoff,ide-mcp}/`, `.codex/hooks/ide-mcp-context.mjs`, `.claude/hooks/ide-mcp-context.mjs`, the `# BEGIN coding-agents-toolings ide-mcp`…`# END coding-agents-toolings ide-mcp` block in `.codex/config.toml`, `.claude/settings.json` hook entries whose command contains `ide-mcp-context.mjs`. Never lists `agent-specs/` or the `.gitignore` line.
- `init` lists detected artifacts and asks `Remove these legacy coding-agents-toolings files?` (default No; `--force` = yes; dry-run lists only).

- [ ] **Step 1: Failing tests**: `detects a full legacy install` (fixture created by writing the old files directly); `removes legacy on confirm and keeps agent-specs/`; `keeps legacy on decline`; `preserves user entries in settings.json and config.toml while removing legacy ones`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: detect and remove legacy coding-agents-toolings installs`.

### Task 12: Agent bodies, reviewer prompt, verdict schema

**Files:**
- Modify: `content/agents/{scout,tester,implementer,reviewer}.md` (replace `TODO-BODY`)
- Create: `content/prompts/reviewer.md`, `content/schemas/verdict.json`, `test/content.test.ts`
- Modify: `test/fixtures/agents/*` (regenerate goldens)

**Requirements (from spec §3, §5, D14, D19):**
- scout: read-only; investigate repo for the goal; report facts, conventions, test runner/check commands, risks; ≤ 60 lines; no recommendations on scope.
- tester: input = task file acceptance criteria only; write acceptance tests in the repo's runner; run them and confirm each fails for the expected reason; then run `node "{{LW_HOME}}/hooks/lw.mjs" lock <paths>`; never read or write implementation files beyond what's needed to import public interfaces.
- implementer: read task file decisions/ACs fresh; make locked tests pass without editing them; add unit tests; follow AGENTS.md and linked `docs/agents/` docs; comment rule verbatim: "Comments explain why, briefly. State each rationale in exactly one place. Never restate what the code does."; return report: changes, tests run, deviations.
- reviewer: follow `{{LW_HOME}}/prompts/reviewer.md`; never edit files.
- `prompts/reviewer.md`: the 7-step procedure from spec §5 verbatim in substance (scope, intent, inspect, list silently, investigate + impact/confidence, report Blocking/Undecided/dropped count, verdict rule); start by running `lw.mjs check-locks` (fail = blocking); output must match `schemas/verdict.json`.
- `schemas/verdict.json`: JSON Schema: `{ pass: boolean, blocking: Finding[], undecided: Finding[], droppedCount: integer }`, `Finding = { location: string, expectation: string, proof: string, impact: "high", confidence: "high"|"mid"|"low" }`, all required, `additionalProperties: false`.

- [ ] **Step 1: Failing tests** in `test/content.test.ts`: `no TODO-BODY remains`; `every agent parses`; `reviewer prompt contains "Blocking", "Undecided", "proof", "check-locks", "Don't report anything"`; `implementer contains the comment rule verbatim`; `tester references lw.mjs lock`; `verdict schema is valid JSON with required keys`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write the content**; regenerate golden fixtures from the new reviewer source.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: loopwright agent and reviewer content`.

### Task 13: Stage skills (plan, test, build, review, done) and flow

**Files:**
- Create: `content/skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md`
- Modify: `test/content.test.ts`

**Requirements (spec §3, §4, D2–D4, D8, D9, D12, D13, D18, D19):** each SKILL.md has frontmatter `name` (= folder) and a `description` stating when to use it; uses `{{LW_HOME}}` for every runtime path; tells Codex explicitly to "spawn the `loopwright-<role>` subagent and wait for its result"; reads/writes state only via `lw.mjs`.
- plan: optional imported spec path → assumption pass over it; dispatch scout; build the **Assumption ledger** (each item tagged high/low impact); high-impact → one question at a time (`AskUserQuestion` in Claude; numbered plain text in Codex, mention `/plan` mode); low-impact → one batch; propose tier (small/standard/large), two-pass, fix-round cap (default from `config.json` `maxFixRounds`), check commands; on confirm create `tasks/<YYYY-MM-DD>-<readable-title>.md` (keep meaningful casing, replace only filesystem-unsafe characters, append `-2`, `-3`… on collision; format from spec §4, ≤ ~150 lines, decisions tagged `asked`/`batch-confirmed`/`overridden`) and run `lw.mjs start`; write each answer to the task file immediately.
- test: standard/large only; dispatch tester; `lw.mjs stage test`; verify `lw.mjs status` shows locks.
- build: `lw.mjs stage build`; dispatch implementer with task-file path only (never paste chat history); large tier iterates slices.
- review: `lw.mjs stage review`; dispatch reviewer (blind: task file + diff, no implementer report); if two-pass, second dispatch with the implementer report to verify claims; if `crossModelReview` ≠ `off` and the CLI exists, run `codex exec --sandbox read-only --output-schema "{{LW_HOME}}/schemas/verdict.json"` or `claude -p --output-format json --json-schema …` with the reviewer prompt and configured `crossModelReviewer` model; merge (either fail → fail); missing CLI → note in review log; append one review-log line; blocking → back to build until `maxFixRounds`, then stop and show findings; undecided → ask the user; pass → `lw.mjs verdict pass --round <n>`; large tier: after the last slice passes, run one whole-branch review against the task base commit.
- done: propose AGENTS.md additions (verbose → `docs/agents/<topic>.md` + linked "read this when…" line), prune stale entries noticed, each change approved individually; if CLAUDE.md lacks `@AGENTS.md` propose adding it; draft commit message and PR description carrying decisions and rejected options; set task `status: done` and `lw.mjs done`; **do not commit**; never delete the task file.
- flow: run plan → (test) → build → review → done per confirmed tier; resume from `lw.mjs status` and the task file when re-invoked; stop at every approval gate; if `lw.mjs status` reports no state but an `active` task file exists, offer to rebuild state from it (`lw.mjs start` with the task's recorded base commit); warn if neither `.claude/settings.json` nor the Codex config contains `loopwright/hooks/` (gates unenforced).

- [ ] **Step 1: Failing tests**: `every skill name matches folder and is spec-valid` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`, ≤ 64 chars); `every skill has a description`; `no unknown placeholders` (`renderTemplate` with `LW_HOME` succeeds); per-skill phrases — flow: `rebuild state`, `loopwright/hooks/`; plan: `Assumption ledger`, `-2`, `high-impact`, `loopwright-scout`, `small`, `standard`, `large`, `two-pass`, `maxFixRounds`, `AskUserQuestion`, `/plan`; review: `Blocking`, `Undecided`, `crossModelReview`, `verdict pass`; done: `AGENTS.md`, `docs/agents`, `@AGENTS.md`, `do not commit`; flow: names all five stage skills; every skill: `spawn the`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write the skills.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: loopwright stage and flow skills`.

### Task 14: Docs

**Files:**
- Modify: `README.md` (rewrite), `CLAUDE.md`, `src/cli.ts` (help text if drifted)
- Create: `docs/dogfood-checklist.md`

- [ ] **Step 1:** README: what/why (one paragraph), install (repo, `--global`, flags), the loop and tiers, commands (`/loopwright-flow` and stage skills; Codex `$` prefix), configuration (`config.json` keys incl. models; Plan uses the session model), enforcement and Codex trust step, cross-model review, worktrees, update/uninstall, migration from coding-agents-toolings, what is never touched.
- [ ] **Step 2:** CLAUDE.md: new architecture (`content/` is the product; `src/` installer; hooks runnable without build), commands (`npm run typecheck`, tests import `src/` directly for units and spawn `dist/cli.js` for e2e), conventions (content phrase tests in `test/content.test.ts`; keep README/help in sync).
- [ ] **Step 3:** `docs/dogfood-checklist.md`: one sample task per tier × {Claude Code, Codex}; check items: assumptions surfaced, questions one at a time, task file updated after each answer, tests locked, guard blocks edit, stop-gate blocks without verdict, review output matches schema, compaction reinjects, done proposes edits and does not commit.
- [ ] **Step 4: Run** `npm test` — PASS (help test still green).
- [ ] **Step 5: Commit** `docs: loopwright README, CLAUDE.md and dogfood checklist`.

### Task 15: Dogfood (manual, with user)

- [ ] **Step 1:** `npm run build && node dist/cli.js init --force` in a scratch repo; run the checklist in Claude Code; record failures as issues/tasks.
- [ ] **Step 2:** Codex: no account available — run `init` in a scratch repo, then `codex doctor` and `codex debug prompt-input` to confirm skills, agents and hooks are discovered; full Codex dogfooding is deferred (dogfood risks from the spike: Codex hook trust via `/hooks`, project trust, `SessionStart:compact` injection, `apply_patch` payload shape, all `verified (source)` only, not run end to end) until someone with an account runs the checklist (README notes Codex support as lighter-tested).
- [ ] **Step 3:** Fix what the checklist exposes (each fix through the normal test-first cycle); commit per fix.

### Task 16: Rename and release

- [ ] **Step 1:** Rename the GitHub repo to `loopwright` (`gh repo rename loopwright` or GitHub settings — user if `gh` is unavailable); `git remote set-url origin https://github.com/xuansontrinh/loopwright.git`.
- [ ] **Step 2:** Confirm `.github/workflows/publish.yml` still matches (Node 24, `npm ci`, `npm run build`, `npm test`, `npm publish --access public`); no change expected.
- [ ] **Step 3 (user):** `npm publish --access public` of `loopwright@0.0.0` manually with 2FA; configure the npm trusted publisher for `xuansontrinh/loopwright` / `publish.yml` (expires if unused for 48 h).
- [ ] **Step 4:** Within 48 h: merge the branch, `npm version 0.1.0`, push the tag → CI publishes. User then disables token publishing.

## Spike results

Codex checked at `rust-v0.167.0` (`codex --version` = 0.167.0, source cloned to scratch, read only, never built). Claude Code 2.1.319.

1. Hook config location: `.codex/hooks.json` and `[hooks]` in `.codex/config.toml` are both loaded per config layer; if both are non-empty Codex warns and loads both. TOML uses `[[hooks.PreToolUse]]` + `[[hooks.PreToolUse.hooks]]`. Decision: use `config.toml` marker block only. `verified (source)`: `codex-rs/hooks/src/engine/discovery.rs` (`load_hooks_json`, `load_toml_hooks_from_layer`), `codex-rs/config/src/hooks_tests.rs`.
2. Feature flag: `hooks` is stable, default true (`codex_hooks` is a legacy alias); no `[features]` edit needed. `verified (cli)`: `codex features list`; `verified (source)`: `codex-rs/features/src/lib.rs`.
3. Trust: project-local hooks/config load only when the project is trusted; each hook also needs a persisted `trusted_hash` (`[hooks.state."<path>:<event>:<i>:<j>"]`, set via `/hooks`); untrusted/modified hooks are listed but NOT run. `--dangerously-bypass-hook-trust` exists for automation. `verified (source)`: `discovery.rs` (`hook_trust_status`, handler push condition), `config/src/loader/managed_project_discovery_tests.rs`; flag `verified (cli)`: `codex --help`.
4. `codex doctor` does not validate hooks (reports config "loaded" only) and `codex debug prompt-input` does not run SessionStart hooks (marker never appeared, with and without project trust). So hook load cannot be confirmed offline via CLI. `verified (cli)`.
5. `PostCompact` cannot inject context: stdout is ignored (`post_compact_ignores_plain_stdout`; output schema has no additionalContext). Codex queues `SessionStart` with source `compact` after compaction, and SessionStart supports `additionalContext`. Change: Codex reinject hook uses `SessionStart` matcher `compact`. `verified (source)`: `hooks/src/events/compact.rs`, `core/src/session/mod.rs` (`queue_pending_session_start_source(Compact)`), `hooks/schema/generated/session-start.command.output.schema.json`.
6. Codex PreToolUse edit payload: stdin has `tool_name: "apply_patch"` (matcher aliases `Write`/`Edit` also match), `tool_input: {"command": "<patch>"}`, plus `cwd`, `session_id`, `turn_id`, `tool_use_id`, `permission_mode`, `transcript_path`, `model`. Paths come from `*** Add/Update/Delete File:` and `*** Move to:` lines. `verified (source)`: `core/src/tools/handlers/apply_patch.rs`, `core/src/tools/hook_names.rs`, `apply-patch/src/parser.rs`, `hooks/schema/generated/pre-tool-use.command.input.schema.json`.
7. Codex block format: exit 2 with non-empty stderr blocks (PreToolUse and Stop; for Stop stderr becomes the continuation prompt; empty stderr does not block). JSON `{"decision":"block","reason":…}` also works but is deprecated for PreToolUse (preferred: `hookSpecificOutput.permissionDecision:"deny"`). Decision: `deny()` uses stderr + exit 2 for both tools. Codex Stop stdin includes `stop_hook_active`. `verified (source)`: `hooks/src/events/pre_tool_use.rs`, `stop.rs`, `stop.command.input.schema.json`.
8. `request_user_input` outside Plan mode: feature `default_mode_request_user_input` is under development, default false, so Plan-mode only by default. `verified (cli)`: `codex features list`.
9. Claude PreToolUse deny: exit 2 + stderr on `Edit|Write|MultiEdit` blocks the tool and the reason reaches the model (Write call blocked; model quoted "locked by spike"). `verified (cli)`: `claude -p --model haiku` in scratch repo with repo-local `.claude/settings.json`.
10. Claude Stop: exit 2 + stderr makes Claude continue (model replied with the stderr instruction); the repeated Stop arrives with `"stop_hook_active": true` (first Stop `false`). `verified (cli)`. Stop stdin also carries `last_assistant_message`.
11. Claude `SessionStart` matcher `compact`: after `claude -p -c "/compact"` the hook ran with `"source":"compact"` and its stdout marker was visible to the model. `verified (cli)`.
12. `git worktree remove`: succeeds and deletes ignored files when the tree is otherwise clean (exit 0, git 2.53.0); it FAILS ("contains modified or untracked files, use --force") if any non-ignored untracked or modified file exists, e.g. an untracked `.loopwright/`. `verified (cli)`. Implication: D15 holds; docs must not assume plain `remove` always succeeds.

Dogfood risks (Codex, source-only): items 3, 5, 6, 7 were never exercised end to end; no Codex account.
