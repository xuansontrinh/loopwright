# Installation reference

Flags, written files, update and uninstall. For the short version see the [README](../README.md#quick-start).

```bash
npx loopwright init            # into the current git repo (commit the result to share it)
npx loopwright init --global   # into your user directories instead
npx loopwright update          # refresh installed files to this version
npx loopwright uninstall       # remove installed files
```

Requires Node >= 22.14. Repo mode needs a git repository; `--global` does not.

## Flags

| Flag | Effect |
|---|---|
| `--global` | Install into your home directory instead of the repo. Shows the planned changes and asks before touching user config. |
| `--no-hook` | Skip hook wiring. Skills still work but nothing is enforced. |
| `--no-symlink` | Do not create the `.claude/skills` symlink. |
| `--dry-run` | Show what would change without writing. |
| `--force` | Overwrite conflicts and skip confirmation prompts. |
| `-v`, `--version` / `-h`, `--help` | Print version / help. |

## What gets written

Repo install:

- `.agents/skills/loopwright-{flow,fix,park,explore,plan,test,build,review,done}/SKILL.md`, and `.claude/skills` as a symlink to `../.agents/skills` (existing directories or other symlinks are prompted about unless `--force`)
- `.claude/agents/loopwright-<role>.md` and `.codex/agents/loopwright-<role>.toml`, and `.junie/agents/loopwright-<role>.md` for `scout`, `tester`, `implementer`, `reviewer`
- `.agents/loopwright/` with `hooks/`, `prompts/reviewer.md`, `schemas/verdict.json`
- hook wiring (unless `--no-hook`): entries in `.claude/settings.json`, and a `# BEGIN loopwright` ... `# END loopwright` block in `.codex/config.toml`
- `.loopwright/` in the main worktree with its own `.gitignore` (`*`), `config.json`, `manifest.json`, `tasks/`, `state/`

If `.claude/skills/` already holds files, `init` asks whether to merge them into `.agents/skills/` (`--force` merges). A merge never overwrites or deletes a skill whose content differs between the two folders: `init` keeps `.claude/skills/` as a directory, skips the symlink and names the differing skills. Keep one version of each, then run `npx loopwright init` again.

On Windows, creating the symlink needs Developer Mode or an administrator terminal. Without either, `init` warns, leaves `.claude/skills/` as it was, and still installs hooks and the manifest. Run `npx loopwright update` once symlinks work.

In a repo without `.loopwright/` (a global install, or a fresh clone, since `.loopwright/` ignores itself), the first task start creates it: `.gitignore`, `tasks/`, `state/` and a `config.json` seeded from `~/.config/loopwright/config.json` if that exists, else the defaults.

Global install writes the equivalents to `~/.agents/skills`, `~/.claude/skills` (copies, not a symlink), `~/.claude/agents`, `~/.codex/agents`, `~/.junie/agents`, `~/.claude/settings.json`, `~/.codex/config.toml`, and `~/.config/loopwright/` (hooks, prompts, schemas, `manifest.json`). It does not create `~/.config/loopwright/config.json`; that file is optional (see Configuration).

## Update and uninstall

- `update` re-applies the current version using the manifest. A file you edited is kept (with a warning), not overwritten. It reuses the `--no-hook`/`--no-symlink` choices recorded at `init` unless you pass them again. Files a newer version no longer ships stay tracked in the manifest (not deleted), so `uninstall` still removes them.
- `uninstall` removes only manifest files whose content still matches what was installed, plus loopwright's own hook entries and Codex block (from the manifest's records and always from the target's `.claude/settings.json` and `.codex/config.toml`). Modified files are kept. `.claude/settings.json` and `.codex/config.toml` are never deleted, only cleaned of loopwright entries. `.loopwright/tasks/` and config are never touched.
- Both accept `--global`, `--dry-run` and `--force` (`--force` skips confirmation prompts; for `update` it also overwrites files you edited).

## What loopwright never touches

- `AGENTS.md` and `CLAUDE.md`: `init` never edits them. The Done stage may propose edits, applied only with your approval (if `CLAUDE.md` lacks `@AGENTS.md` it proposes the import rather than duplicating content).
- Your `.gitignore`: `.loopwright/` ignores itself.
- Your commits: the agent drafts messages but does not commit.
- Anything under `.loopwright/tasks/` on update or uninstall.

## Worktrees

Each worktree keeps its own tasks and state in its own `.loopwright/` (`tasks/` and `state/`, created on the first `lw.mjs` write there), so one task can run per worktree, each in its own session. `config.json` and `manifest.json` exist once, in the main checkout; hooks and skills in a linked worktree read them from there (`lw.mjs config`). Deleting a worktree deletes its tasks, so run `lw.mjs carry` first to move its parked stubs to the main checkout (the Done stage offers it). See [Workflow](workflow.md#running-tasks-in-parallel-worktrees) for how a session hands a new goal to a new worktree.

Tasks written before this layout sit in the main checkout and name their worktree in the header. `lw.mjs tasks` lists them as older layout (or worktree gone); `lw.mjs adopt <task>` in that worktree copies the task and its state in, and marks the original `status: moved`. Nothing moves or is deleted automatically.

A new worktree has no repo-mode install unless the files are committed: `lw.mjs worktree` flags that, and the skill prints `npx loopwright update` to run in the new folder. `git worktree remove` refuses to remove a worktree that contains untracked, non-ignored files; `.loopwright/` ignores itself so it does not trigger that, but your own stray files can.
