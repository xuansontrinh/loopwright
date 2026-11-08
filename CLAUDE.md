# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`loopwright` (formerly `coding-agents-toolings`): an npm CLI (`npx loopwright init|update|uninstall`) that installs a Plan → Test → Build → Review → Done agent workflow (skills, subagents, enforcement hooks) into a git repo or the user's home. Claude Code is the primary, tested target; Codex support is work in progress. Zero runtime dependencies; Node >= 22.14, ESM, TypeScript.

## Commands

```bash
npm run build       # tsdown → dist/cli.js
npm run typecheck   # tsc --noEmit
npm test            # pretest builds first, then vitest run
npx vitest run test/cli.test.ts   # single file (run `npm run build` first)
npx vitest run -t "is idempotent" # single test by name
npm run dev -- init --dry-run     # build and run the CLI against the cwd
```

Unit tests import `src/` directly. E2E tests spawn `dist/cli.js` in temp git repos, and hook tests spawn `content/hooks/*.mjs`, so rebuild before running vitest directly or the e2e tests use stale output.

CI: `.github/workflows/ci.yml` runs typecheck and tests on every PR and push to `main`, on Node 22.14 (the `engines` floor) and 24.

Releases: `npm version patch` (produces the bare `0.1.x` commits and a `v*` tag); pushing the tag triggers `.github/workflows/publish.yml`, which builds, tests, publishes `loopwright` to npm via OIDC, and creates a GitHub release.

## Architecture

- `content/` — **the product.** Copied verbatim (with `{{LW_HOME}}` templating) at install time and shipped in the package `files`.
  - `skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md` — stage behavior lives here.
  - `agents/<role>.md` — single source per subagent role (Claude format); `src/generate/agents.ts` renders `.claude/agents/*.md` and `.codex/agents/*.toml` with models from config.
  - `hooks/*.mjs` — plain Node scripts runnable without a build (`guard-locked-tests`, `stop-gate`, `reinject-context`, plus `lib.mjs` and the `lw.mjs` state tool the skills call). They fail open, and exit 0 silently under `LOOPWRIGHT_HOOKS=off`. `lw.mjs start` creates `.loopwright/` when missing (global installs, fresh clones) from `hooks/default-config.json`, which a test pins equal to `DEFAULT_CONFIG` in `src/core/config.ts`.
  - `prompts/reviewer.md`, `schemas/verdict.json` — the reviewer procedure and verdict schema, also used for headless cross-model review.
- `src/cli.ts` — `node:util` `parseArgs` dispatch to `src/commands/{init,update,uninstall}.ts`.
- `src/core/` — `targets.ts` (repo vs global paths; `.loopwright/` lives in the main worktree), `config.ts` (`DEFAULT_CONFIG`), `manifest.ts` + `writer.ts` (hash manifest; all writes are idempotent and honor `dryRun`; user-edited files are kept).
- `src/install/` — `install.ts` orchestrates; `claude-settings.ts` merges hooks into JSON, `codex-config.ts` upserts the `# BEGIN/END loopwright` TOML block, `symlink.ts` handles `.claude/skills`, `migrate.ts` detects old coding-agents-toolings installs, `loopwright-dir.ts` scaffolds `.loopwright/`.

## Conventions

- Content phrase assertions live in `test/content.test.ts` (and `test/agents.test.ts`); update them together with wording changes in `content/`.
- Keep `README.md`, the `HELP` text in `src/cli.ts`, and the install summary in `src/commands/init.ts` in sync with CLI flags and workflow behavior.
- Relative imports in `src/` use `.js` extensions. Do not add runtime dependencies (dev dependencies only).
- Never write user-global config except in `--global` mode, and never delete settings files, `.loopwright/tasks/`, or `AGENTS.md`/`CLAUDE.md` content.
