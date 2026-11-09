# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repo.

## What this is

`loopwright`: npm CLI (`npx loopwright init|update|uninstall`). Installs a Plan → Test → Build → Review → Done agent workflow (skills, subagents, enforcement hooks) into a git repo or user home. Claude Code is the primary, tested target; Codex is WIP. Zero runtime deps; Node >= 22.14, ESM, TypeScript.

## Commands

```bash
npm run build       # tsdown → dist/cli.js
npm run typecheck   # tsc --noEmit
npm test            # pretest builds first, then vitest run
npx vitest run test/cli.test.ts   # single file (build first)
npx vitest run -t "is idempotent" # single test by name
npm run dev -- init --dry-run     # build and run CLI on cwd
```

Unit tests import `src/`. E2E tests spawn `dist/cli.js` in temp git repos; hook tests spawn `content/hooks/*.mjs`. Rebuild before running vitest directly, or e2e uses stale output.

CI: `.github/workflows/ci.yml` runs typecheck + tests on every PR and push to `main`, on Node 22.14 (`engines` floor), 24, 26. `.github/dependabot.yml` opens weekly, cooldown-delayed PRs for npm and Actions. Pin actions to commit SHAs with a `# vX.Y.Z` comment; keep `npm ci --ignore-scripts`. Dependabot PRs are reviewed and merged by hand, never auto-merged.

Releases: `main` is PR-only. Release = merged PR bumping `package.json` `version` (`npm version patch --no-git-tag-version`). After `ci.yml` passes on `main`, `.github/workflows/publish.yml` (`workflow_run`) runs for a version with no GitHub release: `npm stage publish` via OIDC (skipped if already on npm), then creates the `vX.Y.Z` tag and GitHub release. A maintainer approves the staged version on npmjs.com with 2FA. See docs/releasing.md.

## Architecture

- `content/` — **the product.** Copied verbatim (`{{LW_HOME}}` templated) at install; shipped in package `files`.
  - `skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md` — stage behavior.
  - `agents/<role>.md` — one Claude-format source per role; `src/generate/agents.ts` renders `.claude/agents/*.md` and `.codex/agents/*.toml` with models from config.
  - `hooks/*.mjs` — plain Node, no build: `guard-locked-tests`, `stop-gate`, `reinject-context`, `lib.mjs`, and `lw.mjs` (state tool the skills call). Fail open; exit 0 silently under `LOOPWRIGHT_HOOKS=off`. `lw.mjs start` creates a missing `.loopwright/` (global installs, fresh clones) from `hooks/default-config.json`; a test pins it equal to `DEFAULT_CONFIG` in `src/core/config.ts`.
  - `prompts/reviewer.md`, `schemas/verdict.json` — reviewer procedure and verdict schema; also used for headless cross-agent review.
- `src/cli.ts` — `node:util` `parseArgs` dispatch to `src/commands/{init,update,uninstall}.ts`.
- `src/core/` — `targets.ts` (repo vs global paths; `.loopwright/` lives in main worktree), `config.ts` (`DEFAULT_CONFIG`), `manifest.ts` + `writer.ts` (hash manifest; writes idempotent, honor `dryRun`, keep user-edited files).
- `src/install/` — `install.ts` orchestrates; `claude-settings.ts` merges hooks into JSON; `codex-config.ts` upserts the `# BEGIN/END loopwright` TOML block; `symlink.ts` handles `.claude/skills`; `loopwright-dir.ts` scaffolds `.loopwright/`.

## Conventions

- Content phrase assertions live in `test/content.test.ts` and `test/agents.test.ts`. Change them with any `content/` wording change.
- Docs (`README.md`, `docs/*.md`): follow `docs/writing-documentation-guidelines.md` and re-read it before any docs change. Essentials: README is a landing page (what/why, then a short tested quick start, then links); reference detail lives in `docs/`; never mix tutorial, how-to, reference and explanation in one section; every command must work as written; keep maintainer material out of the user path. Test phrase assertions read `README.md` + `docs/configuration.md`; move assertions with the text.
- Keep `README.md`, `HELP` in `src/cli.ts`, and the install summary in `src/commands/init.ts` in sync with CLI flags and workflow behavior.
- Relative imports in `src/` use `.js` extensions. No runtime deps (dev only).
- Write user-global config only in `--global` mode. Never delete settings files, `.loopwright/tasks/`, or `AGENTS.md`/`CLAUDE.md` content.
- Junie CLI hooks run with `cwd=~/.junie`: find the repo via payload `project_path`. Edits arrive as `apply_patch` with `tool_input.patch`. Project `.junie/config.json` hooks run only with `--config-location` (or from `~/.junie/config.json` with `--global`).
- Unstable or opt-in features go in the `--experimental` registry (`src/core/experimental.ts`), never their own CLI flag. `all` expands to explicit names at invocation, so new experiments are not enabled silently.
- Effort comes only from named profiles (`src/core/profiles.ts`, mirrored in `content/hooks/lib.mjs`; a test pins them equal); `config.json` has no per-role effort keys. Claude spawns pass `effort` from `lw.mjs effort <role>` (a spawn `effort` beats the agent file's, tested on Claude Code 2.1.321); Junie and Codex get it only at `init`/`update`.
- `AGENTS.md` is a symlink to `CLAUDE.md`: edit `CLAUDE.md` only. `sed -i` or bulk replace on `AGENTS.md` turns the link into a regular file; exclude it or use `--follow-symlinks`.
