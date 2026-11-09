# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`loopwright`: an npm CLI (`npx loopwright init|update|uninstall`) that installs a Plan → Test → Build → Review → Done agent workflow (skills, subagents, enforcement hooks) into a git repo or the user's home. Claude Code is the primary, tested target; Codex support is work in progress. Zero runtime dependencies; Node >= 22.14, ESM, TypeScript.

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

CI: `.github/workflows/ci.yml` runs typecheck and tests on every PR and push to `main`, on Node 22.14 (the `engines` floor), 24, and 26. `.github/dependabot.yml` opens weekly, cooldown-delayed update PRs for npm and GitHub Actions. Pin actions to commit SHAs with a `# vX.Y.Z` comment, and keep `npm ci --ignore-scripts`. Details: README.md → "Dependencies and supply chain".

Releases: `main` is PR-only; a release is a merged PR bumping `package.json` `version` (`npm version patch --no-git-tag-version`). After `ci.yml` passes on a push to `main`, `.github/workflows/publish.yml` (`workflow_run`) runs for that commit and, for a version with no GitHub release yet, runs `npm stage publish` via OIDC (skipped if already live on npm) and creates the `vX.Y.Z` tag and GitHub release. A maintainer then approves the staged version on npmjs.com with 2FA. Details: README.md → "Releasing (maintainers)".

## Architecture

- `content/` — **the product.** Copied verbatim (with `{{LW_HOME}}` templating) at install time and shipped in the package `files`.
  - `skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md` — stage behavior lives here.
  - `agents/<role>.md` — single source per subagent role (Claude format); `src/generate/agents.ts` renders `.claude/agents/*.md` and `.codex/agents/*.toml` with models from config.
  - `hooks/*.mjs` — plain Node scripts runnable without a build (`guard-locked-tests`, `stop-gate`, `reinject-context`, plus `lib.mjs` and the `lw.mjs` state tool the skills call). They fail open, and exit 0 silently under `LOOPWRIGHT_HOOKS=off`. `lw.mjs start` creates `.loopwright/` when missing (global installs, fresh clones) from `hooks/default-config.json`, which a test pins equal to `DEFAULT_CONFIG` in `src/core/config.ts`.
  - `prompts/reviewer.md`, `schemas/verdict.json` — the reviewer procedure and verdict schema, also used for headless cross-model review.
- `src/cli.ts` — `node:util` `parseArgs` dispatch to `src/commands/{init,update,uninstall}.ts`.
- `src/core/` — `targets.ts` (repo vs global paths; `.loopwright/` lives in the main worktree), `config.ts` (`DEFAULT_CONFIG`), `manifest.ts` + `writer.ts` (hash manifest; all writes are idempotent and honor `dryRun`; user-edited files are kept).
- `src/install/` — `install.ts` orchestrates; `claude-settings.ts` merges hooks into JSON, `codex-config.ts` upserts the `# BEGIN/END loopwright` TOML block, `symlink.ts` handles `.claude/skills`, `loopwright-dir.ts` scaffolds `.loopwright/`.

## Conventions

- Content phrase assertions live in `test/content.test.ts` (and `test/agents.test.ts`); update them together with wording changes in `content/`.
- Keep `README.md`, the `HELP` text in `src/cli.ts`, and the install summary in `src/commands/init.ts` in sync with CLI flags and workflow behavior.
- Relative imports in `src/` use `.js` extensions. Do not add runtime dependencies (dev dependencies only).
- Never write user-global config except in `--global` mode, and never delete settings files, `.loopwright/tasks/`, or `AGENTS.md`/`CLAUDE.md` content.
- Junie CLI hooks run with `cwd=~/.junie`: find the repo from the payload's `project_path`; edits arrive as `apply_patch` with `tool_input.patch`; hooks in a project's `.junie/config.json` only run when passed with `--config-location` (or from `~/.junie/config.json` with `--global`).
- Unstable or opt-in features go in the `--experimental` registry (`src/core/experimental.ts`), never as their own CLI flag; `all` expands to explicit names at invocation so future experiments are not enabled silently.
