---
name: pr-merge-hygiene
description: Rules for keeping pull requests mergeable in squash-merge repos, such as avoiding stacked PRs, rebasing and retargeting stacked ones onto the default branch, checking for conflicts before calling a PR ready and after other merges, and shipping version bumps in the same PR. Use when opening, stacking, rebasing or handing over a PR, or after a PR merges while others are open.
---

# PR merge hygiene

These rules assume the repo squash-merges. Check the repo's merge settings first (`gh api repos/{owner}/{repo} --jq '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,delete_branch_on_merge}'`). Keep whatever merge method the repo uses; never switch it to make a stack easier.

## 1. Avoid stacking

- Branch each PR from the current default branch, not from another open PR, whenever the work can stand alone.
- Why: squash-merging the base PR puts its changes on the default branch as one new commit. The next PR in the stack still carries the base's original commits, and still targets the base branch unless GitHub retargeted it, so it merges into the wrong branch or shows those commits again and conflicts.
- Stack only when a PR truly can't be built without another unmerged one, and say in each PR which one it sits on.

## 2. If PRs are stacked

Never delete a branch that open PRs still target, except through GitHub's own delete after merge (which retargets them). Deleting it any other way closes those PRs, and they can't be reopened. Retarget them first.

Before the user merges each PR in the stack, after the one below it has merged:

1. Fetch the default branch and rebase the PR's branch onto it, dropping the base's original commits. Use the base PR's last head commit as the upstream, since its branch may already be deleted: `git rebase --onto origin/<default> "$(gh api repos/{owner}/{repo}/pulls/<base-pr> --jq .head.sha)" <branch>`.
2. Push the rebased branch with `git push --force-with-lease`. If branch rules block force-pushes, merge the default branch into the PR's branch instead.
3. Check the PR's base (`gh api repos/{owner}/{repo}/pulls/<n> --jq .base.ref`). If it isn't the default branch yet, retarget it: `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f base=<default>`.
4. Resolve conflicts, rerun the checks, and confirm the PR's diff now shows only its own changes.

## 3. Check against the default branch before "ready"

- Before calling any PR ready, fetch the current default branch and confirm the PR merges cleanly and its checks pass on the latest head. From the API: `mergeable` is `true` and `mergeable_state` isn't `dirty` (or `behind`, where the branch must be up to date). `blocked` only means it waits on reviews or required checks. While `mergeable` is `null` or the state is `unknown`, GitHub is still computing it, so ask again shortly. A local trial merge (`git merge --no-commit --no-ff origin/<default>`) also works.
- After any PR merges, re-check every other open PR the same way. Fix conflicts by rebasing onto the default branch, or by merging it in when branch rules block force-pushes. Tell the user which PRs changed.

## 4. Make publishable PRs release-ready

- Follow the repo's versioning scheme. Where versions live in files, a PR that makes something publishable (a package, plugin, app or action) bumps its version in the same PR, including the first release. Don't leave a placeholder version such as `0.0.0` or split the bump into a follow-up PR.
- If a PR changes what installed copies get, bump the version so they update.
