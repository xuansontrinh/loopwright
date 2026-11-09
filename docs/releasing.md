# Releasing (maintainers)

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
