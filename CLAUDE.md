# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repo.

## What this is

`loopwright`: npm CLI (`npx loopwright init|update|uninstall`). Installs a Plan → Test → Build → Review → Done agent workflow (skills, subagents, enforcement hooks) into a git repo or user home. Claude Code is the primary, tested target; Codex is WIP. Zero runtime deps; Node >= 22.14, ESM, TypeScript.

## Commands

```bash
npm run build       # tsdown → dist/cli.js
npm run typecheck   # tsc --noEmit
npm run format:check # prettier --check; `npm run format` rewrites
npm test            # pretest builds first, then vitest run
npx vitest run test/cli.test.ts   # single file (build first)
npx vitest run -t "is idempotent" # single test by name
npm run dev -- init --dry-run     # build and run CLI on cwd
```

Unit tests import `src/`. E2E tests spawn `dist/cli.js` in temp git repos; hook tests spawn `content/hooks/*.mjs`. Rebuild before running vitest directly, or e2e uses stale output.

ESLint is dropped until typescript-eslint supports TypeScript 7 (typescript-eslint#10940; tracked in #20).

CI: `.github/workflows/ci.yml` runs typecheck + format:check + tests on every PR and push to `main`, on Node 22.14 (`engines` floor), 24, 26. `.github/dependabot.yml` opens weekly, cooldown-delayed PRs for npm and Actions. Pin actions to commit SHAs with a `# vX.Y.Z` comment; a test fails on any unpinned `uses:` in any workflow, including ones pasted from app templates. Resolve the SHA with `git ls-remote <repo> 'refs/tags/vX.Y.Z^{}'`: an annotated tag's own SHA is not the commit. Keep `npm ci --ignore-scripts`. Dependabot PRs are reviewed and merged by hand, never auto-merged.

`.github/workflows/format.yml` pushes a `npm run format` commit to same-repo, non-Dependabot PR branches using the `FORMAT_PUSH_TOKEN` secret (fine-grained PAT, this repo only, Contents read/write); without the secret it only warns. `ci.yml` still gates on `format:check`.

Releases: `main` is PR-only. Release = merged PR bumping `package.json` `version` (`npm version patch --no-git-tag-version`). After `ci.yml` passes on `main`, `.github/workflows/publish.yml` (`workflow_run`) runs for a version with no GitHub release: `npm stage publish` via OIDC (skipped if already on npm), then creates the `vX.Y.Z` tag and GitHub release. A maintainer approves the staged version on npmjs.com with 2FA. See docs/releasing.md.

## Architecture

- `content/` — **the product.** Copied verbatim (`{{LW_HOME}}` templated) at install; shipped in package `files`.
  - `skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md` — stage behavior.
  - `agents/<role>.md` — one Claude-format source per role; `src/generate/agents.ts` renders `.claude/agents/*.md` and `.codex/agents/*.toml` with models from config.
  - `hooks/*.mjs` — plain Node, no build: `guard-locked-tests`, `stop-gate`, `reinject-context`, `lib.mjs`, and `lw.mjs` (state tool the skills call). Fail open; exit 0 silently under `LOOPWRIGHT_HOOKS=off`. `lw.mjs start` creates a missing `.loopwright/` (global installs, fresh clones) from `hooks/default-config.json`; a test pins it equal to `DEFAULT_CONFIG` in `src/core/config.ts`.
  - `prompts/reviewer.md`, `schemas/verdict.json` — reviewer procedure and verdict schema; also used for headless cross-agent review.
- `src/cli.ts` — `node:util` `parseArgs` dispatch to `src/commands/{init,update,uninstall}.ts`.
- `src/core/` — `targets.ts` (repo vs global paths; each worktree has its own `.loopwright/` for tasks and state, `config.json` and `manifest.json` live in the main checkout's), `config.ts` (`DEFAULT_CONFIG`), `manifest.ts` + `writer.ts` (hash manifest; writes idempotent, honor `dryRun`, keep user-edited files).
- `src/install/` — `install.ts` orchestrates; `claude-settings.ts` merges hooks into JSON; `codex-config.ts` upserts the `# BEGIN/END loopwright` TOML block; `symlink.ts` handles `.claude/skills`; `loopwright-dir.ts` scaffolds `.loopwright/`.

## Conventions

- Content phrase assertions live in `test/content.test.ts` and `test/agents.test.ts`. Change them with any `content/` wording change.
- Rules shared by the tester, implementer and reviewer live once in `content/prompts/standards.md`; agent files and skills point to it and never copy a rule. Its test phrases live in `test/standards-content.test.ts`.
- Review keeps only high-impact findings, so `content/` wording that thins a spec's concrete rules can still pass: compare the wording with the spec before Done.
- A new skill in `content/skills/` must also be added to the `SKILLS` lists in `test/content.test.ts` and `test/init.test.ts`, the `loopwright-{…}` brace list in `docs/installation.md`, the README skills table, and be named by `loopwright-flow`; tests assert each. A user-facing skill outside the loop stages also gets its own `docs/workflow.md` section and a line in `docs/enforcement.md` and `docs/dogfood-checklist.md`, asserted in a `test/<skill>-docs.test.ts`.
- Error-path tests for an `lw.mjs` command must assert that command's own message, not only exit 1 and no writes: an unknown command also exits 1 without writing, so such a test passes before the command exists.
- Docs (`README.md`, `docs/*.md`): follow `docs/writing-documentation-guidelines.md` and re-read it before any docs change. Essentials: README is a landing page (what/why, then a short tested quick start, then links); reference detail lives in `docs/`; never mix tutorial, how-to, reference and explanation in one section; every command must work as written; keep maintainer material out of the user path. Test phrase assertions read `README.md` + `docs/configuration.md`; move assertions with the text.
- Task ids (AC, D, S and similar shorthands) live only in the task file. Never write them into tests, code, comments, commit messages or PR descriptions; name tests by behavior.
- Keep `README.md`, `HELP` in `src/cli.ts`, and the install summary in `src/commands/init.ts` in sync with CLI flags and workflow behavior.
- Code or tests that rely on facts from external documentation (tool labels, config keys, CLI flags, schema rules) carry a comment with the source URL next to the fact, e.g. `// https://junie.jetbrains.com/docs/junie-cli-subagents.html (Supported tool groups)`.
- When dogfooding loopwright here, acceptance tests go in new test files; never lock shared files like `test/content.test.ts` or `test/init.test.ts`: a lock covers the whole file and blocks later phrase-assertion edits.
- A loopwright task in this repo runs on the installed copy (global: `~/.config/loopwright`), not `content/`: new `lw.mjs` commands or skill changes reach tasks only after `npm run build` and `node dist/cli.js update --global` (or the repo-mode `update`).
- To run a loopwright task in a separate worktree, create it with `lw.mjs worktree`, then start a new session in the worktree (it prints the command); never work in it by path from another session, and never create or enter it with Claude Code's `EnterWorktree`. `lw.mjs`, the stop gate and context restore act on the session folder's `.loopwright/`, which holds that worktree's own tasks and state.
- A skill that can end turns while this worktree's task is in Build or Review, without working on that task, runs `lw.mjs await-user` once as its first step and never `resume`s itself; that task's own `stage`, `reopen` or `verdict` clears the wait. Await/resume around single questions leaves some turn blocked by the stop gate.
- Commands in skills and docs pass user text (goals, issue or log text) through a quoted heredoc (`<<'EOF'`), never inside double quotes, and quote skill mentions like `$loopwright-flow` with single quotes: double quotes run backticks and expand `$`.
- To put a repo-mode install into a linked worktree, run `update` there, not `init`: `init` rewrites the main checkout's manifest options (profile, hooks, experiments) with that run's flags.
- In hooks, check a piped stdin with `isatty(0)` from `node:tty`, not `process.stdin.isTTY`: touching `process.stdin` makes fd 0 non-blocking, so `readFileSync(0)` throws EAGAIN on a slow writer.
- Relative imports in `src/` use `.js` extensions. No runtime deps (dev only).
- Write user-global config only in `--global` mode. Never delete settings files, `.loopwright/tasks/`, or `AGENTS.md`/`CLAUDE.md` content.
- Junie CLI hooks run with `cwd=~/.junie`: find the repo via payload `project_path`. Edits arrive as `apply_patch` with `tool_input.patch`. Project `.junie/config.json` hooks run only with `--config-location` (or from `~/.junie/config.json` with `--global`).
- Unstable or opt-in features go in the `--experimental` registry (`src/core/experimental.ts`), never their own CLI flag. `all` expands to explicit names at invocation, so new experiments are not enabled silently.
- Effort comes only from named profiles (`src/core/profiles.ts`, mirrored in `content/hooks/lib.mjs`; a test pins them equal); `config.json` has no per-role effort keys. Claude spawns pass `effort` from `lw.mjs effort <role>` (a spawn `effort` beats the agent file's, tested on Claude Code 2.1.321); Junie and Codex get it only at `init`/`update`.
- `AGENTS.md` is a symlink to `CLAUDE.md`: edit `CLAUDE.md` only. `sed -i` or bulk replace on `AGENTS.md` turns the link into a regular file; exclude it or use `--follow-symlinks`.
- `npm run format:check` covers `test/`: run `npm run format` before `lw.mjs lock`, or a later format rewrites locked tests and breaks their hashes.
- On Windows git prints `C:/a/b` and Node uses `C:\a\b`: wrap git output in `path.resolve` before comparing or storing it. Temp dirs use 8.3 short names (`RUNNER~1`) while git returns long ones: resolve both sides of a path comparison with `realpathSync.native`.
- After `npm install --ignore-scripts`, `tsc` may be unlinked: run `npm rebuild typescript`.
