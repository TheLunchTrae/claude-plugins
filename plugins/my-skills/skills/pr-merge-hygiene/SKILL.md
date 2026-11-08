---
name: pr-merge-hygiene
description: Rules for keeping pull requests mergeable in squash-merge repos - avoiding stacked PRs, rebasing and retargeting stacked ones onto the default branch, checking for conflicts before calling a PR ready and after other merges, and shipping version bumps in the same PR. Use when opening, stacking, rebasing or handing over a PR, or after a PR merges while others are open.
---

# PR merge hygiene

These rules assume the repo squash-merges. Check the repo's merge settings first (`gh api repos/{owner}/{repo} --jq '{allow_squash_merge,allow_merge_commit,allow_rebase_merge}'`). Keep whatever merge method the repo uses; never switch it to make a stack easier.

## 1. Avoid stacking

- Branch each PR from the current default branch, not from another open PR, whenever the work can stand alone.
- Why: squash-merging the base PR puts its changes on the default branch as one new commit. The next PR in the stack still targets the old base branch and still carries the base's original commits, so it merges into the wrong branch or shows those commits again and conflicts.
- Stack only when a PR truly can't be built without another unmerged one, and say in each PR which one it sits on.

## 2. If PRs are stacked

Before the owner merges each PR in the stack, after the one below it has merged:

1. Fetch the default branch and rebase the PR's branch onto it, dropping the base's original commits (`git rebase --onto origin/<default> <old-base-branch> <branch>`).
2. Retarget the PR to the default branch (`gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f base=<default>`).
3. Resolve conflicts, rerun the checks, and confirm the PR's diff now shows only its own changes.

## 3. Check against the default branch before "ready"

- Before calling any PR ready, fetch the current default branch and confirm the PR merges cleanly (`mergeable_state` is `clean`, or a local trial merge has no conflicts) and its checks pass on the latest head.
- After any PR merges, re-check every other open PR the same way. Fix conflicts by rebasing onto the default branch, or by merging it in when branch rules block force-pushes. Tell the owner which PRs changed.

## 4. Make publishable PRs release-ready

- When a PR makes something publishable (a package, plugin, app or action), bump its version in the same PR, including the first release. Don't leave a placeholder version (`0.0.0`) or split the bump into a follow-up PR.
- Follow the repo's versioning scheme; if a PR changes what installed copies get, bump the version so they update.
