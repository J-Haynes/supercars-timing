---
name: steward
description: How pull requests work in this repo, from branch to merge - branches, commit messages, checks to run before pushing, PR descriptions and screenshots, CI, review comments, and merging (Rebase and merge, only when the owner says). Use when creating, pushing to, fixing CI on, answering reviews on, or merging a pull request, and before any git push.
---

# Steward: pull requests in supercars-timing

The owner (J-Haynes) is a junior developer and reviews every PR on GitHub. They decided in Oct 2026 that feature
work goes through PRs so CI runs before anything reaches `main`. `CLAUDE.md` "How we work" is the source of these
rules. If the two ever disagree, follow `CLAUDE.md` and fix this file in the same PR.

## Branches and commits

- Never commit to `main`. Use one branch per feature or fix (a cloud session's assigned `claude/...` branch counts).
- **One commit per feature or fix.** PRs are merged with Rebase and merge, so every commit lands on `main` as it is.
  Keep each commit whole: it builds and its tests pass. Don't add "fix typo" or "address review" commits to a feature
  that hasn't merged yet. On a branch you created, fold review fixes into the commit they belong to (`git commit
  --fixup` + `git rebase -i --autosquash` locally, or reset and recommit), then `git push --force-with-lease`.
  Never rewrite someone else's branch.
- **Commit message:** a subject in the style `Area: what changed` (e.g. `Map: a grip under the map to change its
  height`), then a body in plain prose that says **what changed, why, and how it was checked**, with real numbers
  (laps, metres, seconds, which recording). Look at `git log` for the tone. End with the trailer lines the session's
  attribution settings give (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, plus `Claude-Session: ...` in a
  cloud session). Never put a model name anywhere else.
- Update `CLAUDE.md` (and `docs/PROTOCOL.md` or `docs/PLANNING.md` when relevant) **in the same commit** as the
  change it describes.
- Never commit recordings (`data/recordings/`), `.har` files or the built `wwwroot/`. They're git-ignored. Don't force them.

## Before every push

Run what CI runs (`.github/workflows/ci.yml`), plus the tests CI can't run:

```bash
dotnet build --configuration Release
dotnet test --configuration Release --no-build     # RecordingRegressionTests skip without recordings
cd src/web && npm run build                          # strict tsc (no unused locals) + vite
```

- `RecordingRegressionTests` only run where `data/recordings/` exists: the home server (both checkouts) and the
  owner's laptop (daily backup copy). CI and cloud sessions
  skip them (6 skipped is normal). If the change touches protocol, state, replay or session code, say in the PR
  that the owner should run `dotnet test` locally before merging.
- Cloud sessions get .NET 10 and the npm packages from `.claude/hooks/session-start.sh`. If `dotnet` is missing,
  the hook didn't run: run it by hand (`CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh`).
- UI changes: look at the page (desktop and 390 px) as `CLAUDE.md` "Verifying changes" describes. Firefox and
  geckodriver are only on the laptop. If you couldn't look, say so in the PR instead of claiming it was checked.
- Read your own diff once more as a reviewer would before pushing. One validated push beats three speculative ones.

## Opening the PR

- Base is `main`, unless the PR builds on another open PR (see "Stacked PRs").
- Title: the commit subject (or a summary if there are several commits).
- Body: **What changed**, **Why**, **How it was checked** (commands run and their results, recordings or replays
  used, what you looked at). Also list anything the owner must do (run `dotnet test` locally, restart the service
  for C# changes, rebuild a track). End with the attribution lines from the session settings.
- **Screenshots for UI changes:** push them to the orphan branch `pr-assets` as `<branch>/<name>.png`, never on
  `main` or the feature branch, and link them as
  `https://github.com/J-Haynes/supercars-timing/raw/pr-assets/<branch>/<name>.png`. The repo is public:
  screenshots that show real timing data are the owner's call, so ask first or use a rebuilt/replayed session.
- Don't open a PR unless the owner asked for one, or the task clearly ends in one.

## CI and reviews

- Red CI on your PR is your work: reproduce locally, fix, run the checks above, push. Never skip or disable a test.
- Keep fixes small and within the PR's scope. If you find an unrelated problem, mention it; don't widen the PR.
- Review comments from the owner: small asks (renames, a test, a local refactor) → do them and push. Larger or
  design-level asks → reply with a proposal and wait. Explain non-obvious changes in plain terms: the owner is
  learning React, C# and SQL, and clear reasoning is part of the deliverable.
- Be proactive about anything that makes the PR **mergeable** (CI, conflicts, review nits). Ask before anything
  that changes **what the PR does**.

## Merging and after

- **Merge only when the owner says so**, and only with **Rebase and merge** (`gh pr merge --rebase`, or merge
  method `rebase` with the GitHub tools). Never squash (it would collapse one-commit-per-feature) and never use a
  merge commit.
- After merging, deploy on the home server's **live checkout** (`ssh jack@homeserver`, `cd ~/Dev/supercars-timing`,
  always on `main`; CLAUDE.md "Where it runs"): `git pull`, then:
  - frontend only: `cd src/web && npm run build` (the running service serves the new `wwwroot`; viewers refresh);
  - C# changes: `dotnet build src/SupercarsTiming.Server -c Release`, then **ask the owner** before
    `systemctl --user restart supercars-timing`, especially during a session (restart takes about 5 s, warm start keeps state).
  A cloud session can't deploy: tell the owner which of these to run.
- **Stacked PRs:** rebasing rewrites hashes, so once the base PR merges, move the stacked branch onto the new main:
  `git fetch origin && git rebase --onto origin/main <old base branch> <branch>`, then `git push --force-with-lease`
  and retarget the PR to `main`. (PR #2 once merged into its old base, `remote-access`, instead of `main`. Retarget
  before merging.)

## Race-weekend exception

Race-weekend hotfixes and one-liners skip the PR: fast-forward `main` in a development checkout, push, then pull and
deploy in the live checkout (never edit the live checkout directly). The bar
doesn't drop: the checks above still run. On a session day, ask before anything that needs a server restart.
