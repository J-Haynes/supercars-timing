---
name: learn
description: Teaching the owner the code they ship, so they can explain it in an interview. Use when building or changing a feature, and when the owner asks to understand, be quizzed on, or practise explaining part of the repo.
---

# Learn: the owner can explain what ships

The owner builds this project with Claude Code and lists it on their CV. In Oct 2026 they found they could describe
it at a high level but not defend the details an interviewer asks about ("how does the decoder work?", "what happens
when the socket stalls?"). So every feature is also a **lesson**: afterwards the owner can explain, in their own
words and without opening the code, what changed and why.

`docs/LEARNING.md` is the log of what they can and can't explain yet. Read it before you start; update it at the end.

## Building a feature (every feature, by default)

1. **Brief.** Before writing code, explain the plan in 3-5 plain sentences and name the files you'll touch. Name the
   1-3 concepts the feature rests on that `docs/LEARNING.md` doesn't list under "Can explain". Ask one **prediction**
   question ("what do you think the map does when a car misses a timing point?") and wait for the answer.
2. **Build, and hand over one piece.** The repo runs Claude Code's Learning output style (`.claude/settings.json`).
   Leave the owner one small piece that exercises the concept (a condition, a calculation, a test case), not
   boilerplate. Review what they write as a senior engineer would, then finish the feature.
3. **Teach-back.** Once it works, ask the owner to explain the change back: what changed, why, and what would break
   without it. One question at a time; wait for each answer. Correct gaps against the code with a `file:line`, then
   ask again in a different form.
4. **Interview check.** Ask three questions an interviewer would ask about this change, each harder than the last.
   Grade each answer *solid*, *shaky* or *not yet*, naming the one thing missing.
5. **Log.** Update `docs/LEARNING.md`: move concepts between sections, dated, with a one-line note in the owner's words.
   It goes in the same commit as the feature.

Done when the owner has answered the teach-back and interview questions (or said "skip"), and `docs/LEARNING.md` is
in the commit.

**Fast path:** for race-weekend hotfixes, or when the owner says "just build it", go straight to the fix and add the
concept to "Not yet" in `docs/LEARNING.md`, so it comes back in a study session.

## Study session (the owner asks to understand something)

One technique per session is enough. Ask first and wait, then explain: an answer the owner works out sticks, an
explanation they only read does not. Ground every explanation in a `file:line`, and when an answer is wrong, say so
plainly and show where.

- **Trace one real input.** Take one frame from `data/recordings/*.jsonl` and follow it: `NatsoftClient` ->
  `NatsoftDecoder` -> `TimingState` -> snapshot -> SignalR -> the tower. The owner says what each step does before you
  confirm it.
- **Decode by hand.** "Frame encoding" in `docs/PROTOCOL.md` fits on paper: XOR each character with the previous
  decoded one (seed `0x7F`), codes 22-31 expand to XML fragments. Give the owner the first 10 characters of a real
  frame to decode.
- **Break it on purpose.** The owner predicts which test in `tests/SupercarsTiming.Natsoft.Tests/` fails when you
  change one line (the XOR seed, a timeout), you run `dotnet test`, compare, then revert with `git checkout`.
- **Incidents as stories.** `docs/PROTOCOL.md` records real production incidents: the page token Natsoft started
  requiring at the Gold Coast (Practice 1 missed) and the socket that stalled when the USB ethernet dropped
  (25 Oct 2026). The owner tells each one as an interview story: symptom, how it was found, cause, fix, what stops it
  happening again.
- **Own-words explainer.** The owner writes a short explanation of a component; you check every claim against the
  code and mark what's wrong or missing.
- **Grill.** Keep asking follow-ups until the owner can't answer, then list what to study next. The `grilling` skill
  does this when it's installed.
