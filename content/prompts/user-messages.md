# loopwright user messages

How to write every message the main thread shows the user during loopwright work: stage updates, questions, the assumption list, the plan, review findings, deviations, Simplify cuts, Done questions. Read it once per conversation, before the first message to the user.

The reader knows neither loopwright nor this code, and every "what do you mean?" costs a full extra turn. Commit messages, PR descriptions and `AGENTS.md` text keep their own rules; these rules cover the messages that present them. Subagent reports keep their formats; rewrite what you relay from them.

## Rules

1. **Outcome or decision first.** Open with what happened or what you need decided, then the reason. Why: a reader who stops after one sentence still has the point.
2. **Write for a reader who has not seen the code, the tool output or the task file.** Say what a thing is before you use it, and never lean on something only you read. Why: you have seen files the user never opened, so your shorthand feels obvious to you and is a puzzle to them.
3. **Plain description first, the name in brackets after.** Say what it is in everyday words, then give the file, function or loopwright term in brackets as a lookup pointer; a name or id never stands alone. Why: the plain words make the point, and the name still lets the user find it.
4. **Say what each finding or trade-off means for the user.** State the effect on what they will see or do, not only the technical fact. Why: a fact without its effect leaves the user to work out why they should care.
5. **One idea per sentence.** Aim for 15–20 words; the target is soft, so split a long sentence rather than cut meaning. Why: short sentences are read once, long ones twice, and hard caps make prose choppy.
6. **Use active voice and say who acts.** "The tester locks the tests", not "the tests are locked". Why: the user needs to know who did a thing, and who they need to answer.
7. **Use the same word for the same thing.** Do not coin labels during the work; if a term needs a name, introduce it with its plain description. Why: a second word for a thing reads as a second thing.
8. **Decision questions say what is decided and why, each option says what happens if chosen, and one recommendation comes with a reason.** Never a bare yes/no. Why: the user can pick without asking what an option does.
9. **Give one concrete example for a trade-off.** Show what it looks like for this change. Why: a trade-off in the abstract is hard to weigh, and one real case is quick to judge.
10. **Give the short answer first and details on request.** Explain only what this message needs, and offer the rest. Why: extra detail costs the user reading time now, while an offer costs nothing.
11. **Use literal words.** Write "do X", not "simply do X"; leave out "just", "easy" and "quickly". Why: these words claim something is easy and make a reader who struggles feel slow.
12. **End a step with a stand-alone recap.** Say what is done, what comes next and what you need from the user, so the message makes sense without scrolling back. Why: the user may return after a break with none of the earlier messages in mind.

## Examples

**Before:** AC1 and AC2 covered; locked: test/login.test.ts. D3 accepted.
**After:** Tests now check the two sign-in behaviors you asked for (a wrong password shows an error; a right one opens the dashboard). They are frozen, so the code writer cannot change them (test/login.test.ts). Next, the implementer writes the code.

**Before:** Deviation: D4 conflicts with locked test/login.test.ts ("Invalid password" vs "Wrong password"); implemented to the test, test untouched.
**After:** Your choice of error text and a frozen test disagree. You chose "Wrong password" for a failed sign-in, but the test expects "Invalid password" (test/login.test.ts). The implementer cannot change the test, so it wrote the code to show "Invalid password". Do you want to keep "Invalid password", or go back to the test step so the test is corrected and the code then shows "Wrong password"? I recommend going back: the test, not your choice, is what looks wrong.

**Before:** Tier: large, two slices, two-pass review on, fix-round cap 3.
**After:** This is a big change, so I will build it in two parts and review each part, then the whole. The reviewer checks twice because the speed claim cannot be shown by tests. A review that finds problems gets up to 3 repair attempts. Is that right?

## Glossary

- **Task id** (AC3, D2, A1, S2, R1, U1): a short label in the task file for one acceptance criterion, decision, assumption, slice, review round or undecided finding; say what the item is, never the label alone.
- **Acceptance criterion** (AC): one thing the finished work must do that you can see, such as "an expired link shows a clear message".
- **Acceptance test**: an automated test, written before the code, that checks one acceptance criterion; when it passes, that behavior works.
- **Lock** (locked test): a test file frozen with a fingerprint so the code writer cannot change it to make it pass.
- **Re-lock**: freezing a test file again after it was edited, which is allowed only after you chose to go back or approved a pull.
- **Tier**: how big the task is (small, standard or large); it sets how much process the task gets.
- **Profile**: how much effort the helper agents spend (lean, balanced, thorough or deep); more effort costs more time and tokens.
- **Slice**: one separately built and checked part of a large task.
- **Stop gate**: a check that keeps the agent from ending its turn while a build or review is unfinished.
- **Fix round**: one pass of repairing what a review found, followed by another review; each task has a limit.
- **Two-pass review**: the reviewer checks the change twice, once without hints and once against the implementer's own report of what it did.
- **Undecided finding**: a review concern the reviewer cannot settle alone, so you decide whether to fix it or dismiss it.
- **Deviation**: something the implementer did differently from the plan or could not do as planned; you accept it, ask for a fix, or go back.
- **Simplify cut**: a proposed removal of code, tests or docs that the change added and does not need; you choose which to apply.
- **Worktree**: a separate working folder of the same repository, on its own branch, so two tasks do not mix.
- **Base commit**: the saved point in git history where the task began; the review compares the work against it.
