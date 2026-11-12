# Releasing (maintainers)

A release is a merged PR that bumps `version` in `package.json`. Once CI passes on `main`, `publish.yml` stages the version on npm and creates the `vX.Y.Z` tag and GitHub release.

```bash
git switch main && git pull
git switch -c release-x.y.z
npm version patch --no-git-tag-version   # or minor / major; edits package.json + package-lock.json only
git commit -am "release x.y.z"
git push -u origin HEAD
gh pr create --fill                       # merge it once CI is green
```

Then approve the staged version with 2FA: on npmjs.com → `loopwright` → **Staged Packages** → **Approve** (or `npm stage list loopwright` and `npm stage approve <id>`, npm ≥ 11.15). Check with `npm view loopwright versions dist-tags`.

`publish.yml` fails if a remote `vX.Y.Z` tag already exists on a different commit than the one being released; delete that tag and re-run.

If the publish run fails, fix the cause and re-run it from the Actions tab ("Run workflow" on `main`).

## Formatting bot setup

`format.yml` pushes a `style: run prettier` commit to same-repo PR branches (not Dependabot's) when `npm run format` changes files. It needs a repo secret `FORMAT_PUSH_TOKEN`: a fine-grained personal access token limited to this repository with **Contents: Read and write**. A push made with the built-in `GITHUB_TOKEN` would not trigger CI, which is why a PAT is used. Without the secret the job only prints a warning, and `ci.yml` still fails on `format:check`.
