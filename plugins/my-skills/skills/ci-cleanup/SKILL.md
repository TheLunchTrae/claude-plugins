---
name: ci-cleanup
description: Checklist of common CI pitfalls to find and fix in a repo's pipelines (GitHub Actions, GitLab CI and similar), such as job ordering that skips native dependencies, cloning more than a job needs, superseded runs left running, polling for work that should follow a completion event or webhook, and flaky tests (hardcoded sleeps, shared test data, external services). Use when asked to audit, clean up, speed up or de-flake CI, review a workflow or pipeline file, or decide whether a test can be made a required check.
---

# CI cleanup

Go through the repo's CI configuration and its tests against each section below. For every problem, note the file and line, what goes wrong, and the fix. Fix what the user asked you to fix; list the rest.

Start by reading every pipeline file (`.github/workflows/*.yml`, `.gitlab-ci.yml` and its includes, or the repo's equivalent), any scripts they call, and which checks are required on the default branch, if you can see that.

Two rules hold throughout:

- Never make CI pass by weakening it. Don't delete a failing test, drop a required check or add blind retries to hide a failure. A flaky test is quarantined (section 5), not removed.
- Never cancel or reorder deploy, release or publish jobs to save time. The speed fixes below are for checks.

## 1. Use native job dependencies

Jobs that must run in order say so with the CI system's own dependencies, not with workarounds.

- Look for: a job that sleeps or loops waiting for another job; a step that polls the CI API (`gh run list`, `gh run watch`, the pipelines API) for another job's status; the same build repeated in several jobs because they can't share output; one long job that does unrelated work in sequence.
- Fix with: `needs:` between jobs (GitHub Actions and GitLab), artifacts or caches to pass build output from the job that makes it to the jobs that use it, and `if:` / `rules:` on the dependent job for conditions. Across workflows, use the CI system's trigger (`workflow_run` or `workflow_call` in GitHub Actions, `trigger:` for downstream pipelines in GitLab). Let independent jobs run in parallel.

## 2. Clone only what you need

Every job's checkout costs time. Fetch the least history and the fewest files the job uses.

- Look for: full history fetched without a reason (`fetch-depth: 0`, a large `GIT_DEPTH`); submodules or Git LFS files fetched by jobs that don't use them; a checkout in jobs that only use artifacts, call an API or post a comment; whole-repo checkouts for a job that reads one folder.
- Fix with: a shallow clone (`fetch-depth: 1` is the `actions/checkout` default; `GIT_DEPTH` in GitLab). Keep full history only for jobs that read it (tags for versioning, changelogs, diffs against the base branch), and say why in a comment. Turn off `submodules` and `lfs` where unused. Skip the checkout entirely where the job doesn't need the source (`GIT_STRATEGY: none` in GitLab, no checkout step in GitHub Actions). Use `sparse-checkout` for jobs that need only part of the tree.

## 3. Cancel superseded runs

When a new commit lands on a branch, the checks still running for the old commit are wasted.

- Look for: workflows or pipelines with no concurrency or auto-cancel setting, so every push to a PR runs to the end.
- Fix with: in GitHub Actions, a `concurrency` group per workflow and ref with `cancel-in-progress` on for pull requests, for example `group: ${{ github.workflow }}-${{ github.ref }}` and `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. In GitLab, `interruptible: true` on check jobs and `workflow: auto_cancel: on_new_commit: interruptible`. Leave deploy, release and publish jobs uncancellable; queue them in their own concurrency group instead.

## 4. Use completion events or webhooks for work outside CI

When something outside CI has to happen after a run (a deploy, a release, a notification, another system picking up a result), the run's completion should trigger it.

- Look for: a CI job that stays alive, sleeping or polling, until an outside system finishes; an outside service or script that polls the CI API on a timer to learn whether a run finished; a job that polls an outside system's status when that system offers a callback.
- Fix with: the CI system's completion events (`workflow_run` with `types: [completed]`, `check_suite` or `deployment_status` in GitHub Actions; pipeline and job webhooks or downstream triggers in GitLab) or a repository webhook, so the outside work starts when the run ends. Where an outside system offers a webhook or callback, use it instead of a polling job.

## 5. Quarantine flaky tests

A test that sometimes fails for reasons unrelated to the change teaches everyone to ignore red CI.

- Quarantine it, don't delete it: move it to a non-blocking job, or mark it skipped with the runner's own skip or tag mechanism, with a link to an issue that tracks the fix. Keep running it where it can't block merges, so the fix can be checked.
- Before a test becomes part of a required check, prove it isn't flaky:
  - **Run it repeatedly**: many times in a row, using the runner's repeat option (`go test -count=N`) or a shell loop. One pass proves little.
  - **Run it alongside other tests**: in the full suite, in parallel and in random order (`go test -shuffle=on`, PHPUnit `--order-by=random`, Jest `--randomize`, Vitest `--sequence.shuffle`), not only on its own. A test that passes alone and fails in the suite depends on order or shared state.
  - **Verify shared test data**: fixtures, database rows, files, temp directories, ports, environment variables and global or static state that tests share. Each test sets up and cleans up what it uses, or gets its own copy.
  - **Look for hardcoded sleeps**: a fixed `sleep` or timeout waiting for something to be ready. Wait for the condition itself (poll with a deadline, await the event) or use fake timers.
  - **Look for external services and dependencies**: network calls, third-party APIs, real clocks and time zones, randomness without a seed, and unpinned tool or dependency versions. Replace them with fakes or a local container, pin versions, and seed randomness.

## Reporting

Group findings by the sections above, most costly first. For each: file and line, what goes wrong, the fix, and whether the fix changes which checks gate a merge. List each quarantined test with its tracking issue.
