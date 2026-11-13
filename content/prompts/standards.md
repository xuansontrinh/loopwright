# loopwright code standards

Shared by the tester, implementer and reviewer. The repo's own docs on architecture and conventions (`AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, `docs/` and similar) win over this file on any conflict.

## Rules

- **Existing mechanism first.** Use what the repo already has (config layering, per-environment settings, feature toggles, DI wiring, error types, validation) before adding anything, even when the new setting is the first of its kind. Differences between environments, deployments or tenants go in config; never branch on the environment name in code. Why: each new `if` on an environment is a second place to change when one is added.
- **Fewest clear lines.** Write the smallest version that is still readable. Why: every line is read, tested and maintained.
- **Respect the layers.** Keep code in the layer the repo docs (`AGENTS.md`, `ARCHITECTURE.md`, `docs/`) assign it; do not reach across them. Why: crossed layers make later changes spread.
- **No trivial wrappers or one-off helpers.** Call the underlying function. A helper with one call site exists only if it names a step the reader would otherwise have to decode. Why: an indirection that adds nothing hides where the work happens.
- **Delete what you replace.** Remove the code, tests and docs your change makes dead: no old path kept "just in case", no unused parameters, no unrequested compatibility shims. Why: dead code reads as live behavior.
- **Validate at the boundaries.** Check input where it enters (user, network, files), not again in every inner function; trust types inside. No guards for impossible states, no catch blocks that swallow errors, no fallbacks that hide bugs. Why: repeated checks disagree and bury the real one.
- **No speculative generality.** Build for the cases the task states, not ones that might come: no interface with one implementation, no option or parameter nobody asked for, no generic version of a one-off. A requested per-environment flag is not speculative. Why: unused options are code to maintain with no proof they fit.
- **One home per fact.** State each fact in one place and link to it elsewhere or say nothing. API behavior for callers goes in the contract (OpenAPI description, public API doc, docs page); why the code is shaped this way in a short comment at the one surprising spot; expected behavior in the test name; cross-task rules in `AGENTS.md`, never feature details. Why: copies drift apart.
- **Comments.** Comments explain why, briefly. State each rationale in exactly one place. Never restate what the code does. Why: a comment that repeats the code or another comment goes stale first.
- **No change-log comments.** Do not write "added", "changed from" or "now uses"; history lives in git. Why: the comment is wrong once the next change lands.
- **Leave existing docs alone.** Edit docs and comments you did not need to change only when your change makes them false. Why: unrelated rewrites bury the real diff.
- **The test name carries the behavior.** Name a test for what it checks and skip doc blocks or comments that restate the name or the criterion. Why: a restated criterion is a second copy to keep in sync.
