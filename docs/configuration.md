# Configuration

`.loopwright/config.json` is created with these defaults (by `init`, or by the first task start) and never overwritten. `init`/`update` render the model settings into the generated agent files, so re-run `update` after editing.

Global installs read `~/.config/loopwright/config.json` if you create it (it is optional and not written by `init --global`): its model settings go into the global agent files, and it seeds the `config.json` of each repo's new `.loopwright/`.

```json
{
  "maxFixRounds": 3,
  "crossAgentReview": "off",
  "docsDir": "docs/agents",
  "models": {
    "claude": { "scout": "opus", "tester": "sonnet", "implementer": "sonnet", "reviewer": "opus" },
    "codex":  { "scout": "inherit", "tester": "inherit", "implementer": "inherit", "reviewer": "inherit" },
    "junie":  { "scout": "opus", "tester": "sonnet", "implementer": "sonnet", "reviewer": "gpt" },
    "crossAgentReviewer": { "claude": "opus", "codex": "inherit" }
  }
}
```

- `maxFixRounds`: default fix-round cap; Plan may propose a lower one per task.
- `crossAgentReview`: `"off"`, `"codex"` or `"claude"`. When set, the review also runs the same reviewer prompt headlessly through the other CLI (`codex exec` or `claude -p`) and both verdicts must pass. A missing or failing CLI is skipped with a note in the review log; it never blocks.
- `docsDir`: where Done puts longer standards docs linked from `AGENTS.md`.
- `models`: per tool and role; tool-native aliases or full IDs, or `inherit` (the session model). Effort is not configured here: it comes only from the profile (see below). Old `models.<tool>.effort` and `models.crossAgentReviewer.effort` keys are ignored, with no validation and no error. Editing generated agent files directly counts as a user modification and is kept on update.

## Effort profiles

Efforts per role (scout / tester / implementer / reviewer); profiles never change models:

| Profile | Efforts | Use for |
| --- | --- | --- |
| `lean` | low / low / low / medium | trivial or mechanical changes |
| `balanced` | medium / medium / medium / high | most tasks (default) |
| `thorough` | high / high / high / xhigh | cross-module or risky work |
| `deep` | xhigh / xhigh / xhigh / xhigh | major refactors, complex redesigns |

Rationale: implementation tolerates lower effort when acceptance tests pin the behavior, while review is the last gate, so the reviewer sits one step above the others. `deep` ties at `xhigh` because `max` is no better than `xhigh` in practice. On Claude Code, Plan recommends a profile per task, you confirm it, and it is written as `profile:` in the task file; each subagent spawn passes that `effort` (falling back to the agent file's effort if the spawn rejects it), and the headless cross-agent reviewer follows the profile's reviewer effort. `npx loopwright init|update --profile <name>` sets the install-time default (recorded in the manifest, reused by `update`, used by Plan's fallback and the only setting Junie gets); there is no `profile` config key, `--profile` never writes `config.json`. Changing the profile needs `npx loopwright update --profile <name>`. Codex follows profiles at install time like Junie (`model_reasoning_effort` in `.codex/agents/*.toml`; still WIP and untested). Codex has no per-spawn effort, so the agent file wins, and the effort must be supported by the Codex model.

Caveat: profiles control subagents only. Your main-thread effort (Plan, and the orchestration of every stage) is whatever you set for the session, for example with `/effort`.

- Plan runs in your main thread, so it uses your session's model. Start the session on the model you want for planning.

## Experimental features

`init` and `update` take `--experimental <name>[,name]` (or `all`, which expands to the current names and records them). Features are unstable and may change or break. `update` keeps the recorded list; `--experimental ''` turns all off and removes their config blocks.

- `junie-hooks`: writes the loopwright hooks into Junie's `config.json` (`.junie/config.json` in repo mode, `~/.junie/config.json` with `--global`). Junie hooks are Early Access, and Junie ignores project-level hooks unless started with `--config-location`, for example `junie --config-location .junie`. The guard recognizes Junie's `apply_patch` edits only; hooks fail open.
