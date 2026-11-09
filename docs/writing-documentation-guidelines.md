# Writing documentation guidelines

How to write loopwright's user-facing docs (`README.md`, `docs/*.md`). Read this before changing any of them. `CLAUDE.md` links here.

The reader is a developer who wants to *use* loopwright's skills in their own repo. They skim, they are mid-task, and they leave if the first screen does not answer "what is this, and how do I try it?". Maintainer material (releasing, supply chain) is not for them and must not sit in their way.

## Principles

1. **Lead with value, then action.** One sentence that says what it is and what the reader gets, then the install command. Put the quick start before any background.
2. **One page, one job.** The README is a landing page: pitch, quick start, a short map of the workflow, and links. Reference detail lives in `docs/`. If a README section grows past roughly a screen, move it to `docs/` and leave a one-line link.
3. **Separate the four kinds of docs** ([Diátaxis](https://diataxis.fr)). Do not mix them in one section:
   - *Tutorial / quick start*: learning by doing one small success path.
   - *How-to*: steps to reach a specific goal.
   - *Reference*: flags, config keys, files; complete, dry, scannable.
   - *Explanation*: why it works this way; the limits.

   The common failure is explanation or edge cases leaking into the quick start.
4. **Progressive disclosure.** Order by how many readers need it: install and first run, daily commands, configuration, internals, maintainers.
5. **Show, then tell.** Give a copy-pasteable command or a short example of the output before the prose that explains it.
6. **Every command must work as written.** Test it in a clean temp repo. State prerequisites (Node version, git repo) before the command, not after it fails.
7. **Be honest about status and limits.** Mark WIP and experimental features at the point of use (a Support table is fine), and state limits plainly. Never promise what is untested.

## Structure of the README

In this order; drop nothing from the first four:

1. Title and a one-sentence description.
2. Why (3 to 4 bullets of the problems it solves, not a paragraph of features).
3. Quick start: requirements, 2 to 4 commands, and what the reader will see or do next.
4. How it works: the loop in one short list or diagram, with the commands that drive it.
5. Support / compatibility table.
6. Where to go next: links to `docs/` pages, one line each saying what is in it.
7. Contributing / releasing pointers, then license.

## Writing style

- Second person, active voice, present tense: "Run `npx loopwright init`", not "The init command may be run".
- Short sentences, one idea each. Cut filler ("simply", "just", "please note").
- Descriptive headings that name the task or the thing ("Install into your repo"), so the table of contents or a skim works as navigation.
- Prefer lists and tables to paragraphs for options, flags and steps. Prefer a paragraph to a list when explaining a reason.
- Define a term once, at first use, and use the same word everywhere (for example *task file*, *locked tests*, *tier*).
- Use relative links between docs. Link to the one canonical place instead of repeating content; duplicated facts drift.
- Code blocks always carry a language tag (`bash`, `json`). Inline code for commands, flags, paths and keys.
- Badges and screenshots only when they carry information; never decorative.
- No emoji headings, no marketing adjectives.

## Keeping docs correct

- Update docs in the same change as the behavior (see the sync rule in `CLAUDE.md`: `README.md`, `HELP` in `src/cli.ts`, install summary in `src/commands/init.ts`).
- Phrase assertions in `test/*.test.ts` read `README.md` and `docs/configuration.md`. When you move text between files, move or update the assertion too.
- Do not leave stale statements: delete or fix rather than add a "note: this changed".
- Before finishing a docs change, check: does the first screen of the README answer what / why / how to try? Do all relative links resolve? Does each command run?

## Sources

- [Diátaxis framework](https://diataxis.fr): the four documentation types.
- Common README guidance (lead with value, short tested quick start, predictable section order, link out for depth), consolidated from several community guides such as [Art of README](https://github.com/hackergrrl/art-of-readme).
