# loopwright

A Plan → Test → Build → Review → Done workflow for AI coding agents, installed into your repo as skills, subagents and hooks.

Agents tend to bake silent assumptions into a plan, write tests to fit their own code, grade their own work, and forget agreed decisions after compaction. loopwright counters this with an **assumption ledger** (every assumption is stated; high-impact ones are asked one at a time), **isolated contexts** (a tester that never sees the implementation, a reviewer that starts blind), **enforced gates** (hooks block edits to locked tests and block finishing without a passing review), and **no document sprawl** (one short task file per task, kept locally; durable lessons go to your existing `AGENTS.md` only with your approval).

## Support

| Feature | Claude Code | Codex |
|---|---|---|
| Skills install | Supported, tested | WIP: installed, not tested end-to-end |
| Subagents (scout, tester, implementer, reviewer) | Supported, tested | WIP: installed, not tested end-to-end |
| Hook enforcement (locked-test guard, stop gate, context reinjection) | Supported, tested | WIP: installed, not tested end-to-end |
| Structured questions | `AskUserQuestion` | Plain-text fallback (numbered options) |
| Cross-model review (as the reviewer) | Supported, tested | WIP: untested |
| Global install | Supported, tested | WIP: installed, not tested end-to-end |

**Codex support is work in progress.** Its behavior was derived from Codex source and CLI help; no real Codex session has been run against loopwright yet. Expect rough edges.

## Install

```bash
npx loopwright init            # into the current git repo (commit the result to share it)
npx loopwright init --global   # into your user directories instead
npx loopwright update          # refresh installed files to this version
npx loopwright uninstall       # remove installed files
```

Requires Node >= 22.14. Repo mode needs a git repository; `--global` does not.

| Flag | Effect |
|---|---|
| `--global` | Install into your home directory instead of the repo. Shows the planned changes and asks before touching user config. |
| `--no-hook` | Skip hook wiring. Skills still work but nothing is enforced. |
| `--no-symlink` | Do not create the `.claude/skills` symlink. |
| `--dry-run` | Show what would change without writing. |
| `--force` | Overwrite conflicts and skip confirmation prompts. |
| `-v`, `--version` / `-h`, `--help` | Print version / help. |

### What gets written

Repo install:

- `.agents/skills/loopwright-{flow,plan,test,build,review,done}/SKILL.md`, and `.claude/skills` as a symlink to `../.agents/skills` (existing directories or other symlinks are prompted about unless `--force`)
- `.claude/agents/loopwright-<role>.md` and `.codex/agents/loopwright-<role>.toml` for `scout`, `tester`, `implementer`, `reviewer`
- `.agents/loopwright/` with `hooks/`, `prompts/reviewer.md`, `schemas/verdict.json`
- hook wiring (unless `--no-hook`): entries in `.claude/settings.json`, and a `# BEGIN loopwright` ... `# END loopwright` block in `.codex/config.toml`
- `.loopwright/` (in the main worktree) with its own `.gitignore` (`*`), `config.json`, `manifest.json`, `tasks/`, `state/`

In a repo without `.loopwright/` (a global install, or a fresh clone, since `.loopwright/` ignores itself), the first task start creates it: `.gitignore`, `tasks/`, `state/` and a `config.json` seeded from `~/.config/loopwright/config.json` if that exists, else the defaults.

Global install writes the equivalents to `~/.agents/skills`, `~/.claude/skills` (copies, not a symlink), `~/.claude/agents`, `~/.codex/agents`, `~/.claude/settings.json`, `~/.codex/config.toml`, and `~/.config/loopwright/` (hooks, prompts, schemas, `manifest.json`). It does not create `~/.config/loopwright/config.json`; that file is optional (see Configuration).

## The loop

1. **Plan** (main thread): a read-only scout investigates the repo; you get an assumption ledger. High-impact assumptions are asked one at a time, low-impact ones in a single batch to skim and override. The agent proposes tier, two-pass review, fix-round cap and check commands (lint/typecheck/test), and you confirm. Each answer is written to the task file immediately. You can import an existing spec or plan as input.
2. **Test**: a tester subagent writes acceptance tests from the confirmed criteria, confirms they fail for the right reason, and locks them by file hash. It sees no implementation.
3. **Build**: an implementer subagent makes the locked tests pass and adds its own unit tests. Comments explain why, briefly, never what.
4. **Review**: a reviewer subagent runs the checks, re-hashes the locked tests (a mismatch fails the review), and does a blind pass over the diff against your decisions, criteria, standards and codebase patterns. Only proven, high-impact findings are reported: confirmed ones block; unconfirmed but evidenced ones go to you as *undecided*; the rest are dropped (count logged). The verdict is bound to a fingerprint of the working tree, so any later change makes it stale. Optional second pass checks the implementer's claims.
5. **Done** (main thread): proposes `AGENTS.md` / `docs/agents/` additions and prunes (each approved individually), and drafts a commit/PR message with the decisions and rejected options. It does not commit.

Tiers:

- **small**: Plan, Build, Review (blind pass only by default).
- **standard**: Plan, Test, Build, Review.
- **large**: Plan splits work into slices; each slice runs Test, Build, Review; then one whole-branch review.

A failed review returns to Build for up to the fix-round cap (default 3), then stops and hands the open findings to you.

## Commands

| Claude Code | Codex | Does |
|---|---|---|
| `/loopwright-flow` | `$loopwright-flow` | Run or resume the whole loop, stopping wherever you must decide |
| `/loopwright-plan` | `$loopwright-plan` | Plan stage |
| `/loopwright-test` | `$loopwright-test` | Test stage |
| `/loopwright-build` | `$loopwright-build` | Build stage |
| `/loopwright-review` | `$loopwright-review` | Review stage |
| `/loopwright-done` | `$loopwright-done` | Done stage |

Task files live in `.loopwright/tasks/<date>-<title>.md`: goal, decisions (tagged asked / batch-confirmed / overridden), assumptions, acceptance criteria, review log, open questions.

## Configuration

`.loopwright/config.json` is created with these defaults (by `init`, or by the first task start) and never overwritten. `init`/`update` render the model settings into the generated agent files, so re-run `update` after editing.

Global installs read `~/.config/loopwright/config.json` if you create it (it is optional and not written by `init --global`): its model settings go into the global agent files, and it seeds the `config.json` of each repo's new `.loopwright/`.

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

- `maxFixRounds`: default fix-round cap; Plan may propose a lower one per task.
- `crossModelReview`: `"off"`, `"codex"` or `"claude"`. When set, the review also runs the same reviewer prompt headlessly through the other CLI (`codex exec` or `claude -p`) and both verdicts must pass. A missing or failing CLI is skipped with a note in the review log; it never blocks.
- `docsDir`: where Done puts longer standards docs linked from `AGENTS.md`.
- `models`: per tool and role; tool-native aliases or full IDs, or `inherit` (the session model). Codex also accepts `models.codex.effort.<role>`. Editing generated agent files directly counts as a user modification and is kept on update.
- Plan runs in your main thread, so it uses your session's model. Start the session on the model you want for planning.

## Enforcement and its limits

Three hooks (plain Node scripts, no dependencies) are wired by default:

- **Locked-test guard** (PreToolUse): during Build, blocks edit tools on locked test files.
- **Stop gate** (Stop): in Build or Review, blocks finishing unless a passing verdict matches the current working-tree fingerprint. It blocks at most 3 times per stage, then lets the stop through with a warning, so it cannot deadlock a session. It stands down while the agent is waiting for your decision.
- **Context reinjection** (SessionStart after compaction): re-prints goal, stage, decisions and next step from the task file.

Limits, stated plainly:

- Shell edits (`sed -i`, redirects) are not intercepted. The review re-hashes locked tests and fails on any mismatch; that is the real backstop.
- State fields such as `awaitingUser` and the history log are tamper-evident, not tamper-proof. A determined agent can write them; the aim is to catch drift, not adversaries.
- Hooks fail open: if a hook crashes or state is unreadable it warns and allows, so a loopwright bug never bricks your session. Review checks remain authoritative.
- With `--no-hook`, none of this is enforced.
- Setting `LOOPWRIGHT_HOOKS=off` in a session's environment turns every loopwright hook into a silent no-op. The cross-model review sets it on the headless `claude -p` / `codex exec` reviewer so that session is not gated.

### Codex trust step (WIP)

Codex requires you to trust the project and approve hooks. After `init`, open Codex in the repo and approve the loopwright hooks via `/hooks`. Until approved, hooks do not run. This path is untested end-to-end.

## Worktrees

All worktrees of a repo share one `.loopwright/` in the main worktree (found via `git rev-parse --git-common-dir`); machine state is kept per worktree under `.loopwright/state/`. Task files therefore survive removing a linked worktree. Note that `git worktree remove` refuses to remove a worktree that contains untracked, non-ignored files; `.loopwright/` ignores itself so it does not trigger that, but your own stray files can.

## Update and uninstall

- `update` re-applies the current version using the manifest. A file you edited is kept (with a warning), not overwritten. It reuses the `--no-hook`/`--no-symlink` choices recorded at `init` unless you pass them again. Files a newer version no longer ships stay tracked in the manifest (not deleted), so `uninstall` still removes them.
- `uninstall` removes only manifest files whose content still matches what was installed, plus loopwright's own hook entries and Codex block (from the manifest's records and always from the target's `.claude/settings.json` and `.codex/config.toml`). Modified files are kept. `.claude/settings.json` and `.codex/config.toml` are never deleted, only cleaned of loopwright entries. `.loopwright/tasks/` and config are never touched.
- Both accept `--global`, `--dry-run` and `--force` (`--force` skips confirmation prompts; for `update` it also overwrites files you edited).

## What loopwright never touches

- `AGENTS.md` and `CLAUDE.md`: `init` never edits them. The Done stage may propose edits, applied only with your approval (if `CLAUDE.md` lacks `@AGENTS.md` it proposes the import rather than duplicating content).
- Your `.gitignore`: `.loopwright/` ignores itself.
- Your commits: the agent drafts messages but does not commit.
- Anything under `.loopwright/tasks/` on update or uninstall.

## Releasing (maintainers)

`main` only accepts pull requests, so **a release is a merged PR that bumps the `version` in `package.json`**. Releases use npm **staged publishing**: CI can stage a version but cannot make it installable, so every release needs your 2FA approval.

When CI (`ci.yml`) passes for a push to `main`, `.github/workflows/publish.yml` runs for that exact commit. If its version has no GitHub release yet, it:

1. Builds and runs `npm stage publish` with trusted publishing (OIDC; no npm token in the repo). A version already live on npm is not staged again.
2. Creates the `vX.Y.Z` tag on that commit and a GitHub release with generated notes.

CI failures, pushes that don't change the version, and the `0.0.0` placeholder release nothing. A failed run leaves no tag; fix the cause, then re-run it from the Actions tab ("Run workflow" on `main`, which first checks that CI passed for `main`'s head).

**To release a new version:**

```bash
git switch main && git pull
git switch -c release-x.y.z
npm version patch --no-git-tag-version   # or minor / major; edits package.json + package-lock.json only
git commit -am "release x.y.z"
git push -u origin HEAD
gh pr create --fill                       # merge it once CI is green
```

Then **approve the staged version**: on npmjs.com → `loopwright` → **Staged Packages** → **Approve** (or `npm stage list loopwright` and `npm stage approve <id>`, npm ≥ 11.15). It becomes installable and `latest` only after approval. Check with `npm view loopwright versions dist-tags`.

**One-time setup:**

1. Trusted publishing can only be configured for a package that already exists, so the first version (0.1.0) is published by hand (`npm publish --access public`; `prepublishOnly` builds `dist/`).
2. On npmjs.com → `loopwright` → Settings → Trusted publishing → GitHub Actions: repository `xuansontrinh/loopwright`, workflow `publish.yml`, with **Allow `npm publish`** and **Allow `npm dist-tag`** left unchecked (stage-only).
3. Publishing access: "Require two-factor authentication and disallow tokens".

**Dependencies and supply chain:**

- Dependabot (`.github/dependabot.yml`) checks npm and GitHub Actions weekly, only proposes releases at least 7 days old (14 for majors), and groups minor/patch bumps into one PR per ecosystem. Security updates are not delayed. Review and merge these PRs by hand; don't auto-merge them.
- Actions are pinned to commit SHAs (the version is in a trailing comment, which Dependabot keeps current); pin any new action the same way.
- `npm ci --ignore-scripts`: no dependency needs install scripts. If one ever does, allow it explicitly rather than dropping the flag.
- `dependency-review.yml` fails PRs that add a dependency with a known moderate-or-worse vulnerability; `scorecard.yml` runs OpenSSF Scorecard weekly (results under Security → Code scanning).

## License

MIT
