# pr-workflow

A Claude Code plugin for a strict pull request workflow: every PR opens as a draft, gets an independent reviewer agent with a fix and re-check loop, and is marked ready only after the reviewer approves. A Stop hook keeps the session from ending its turn while that loop is unfinished.

Install:

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install pr-workflow@thelunchtrae
```

Requires Node 18 or later on `PATH` (the hooks are one dependency-free Node script). Works on macOS, Linux and Windows (Git Bash or PowerShell).

## What's in it

- `skills/pr-workflow/SKILL.md`: the rules agents follow for issues, commits, PR descriptions, the review loop, stacked PRs, visual changes and links.
- `hooks/hooks.json` and `scripts/pr-workflow.mjs`: the hooks that track review state and block stopping.

## How the hook decides

**Tracking (PostToolUse and PostToolUseFailure).** PRs the session opens are recorded as `draft`:

- `gh pr create` (or `gh pr new`, also inside `$(...)`), `gh api repos/{owner}/{repo}/pulls` (POST), or a GitHub MCP `create_pull_request`. A shell command that fails after the PR was created still counts. After a successful command, the hook confirms each PR it starts tracking in the agent's context. Reporting a PR as `draft` that's already tracked is harmless.
- Changes are followed too: `gh pr ready` and the `.../ccr/ready_for_review` route set `ready`; `gh pr ready --undo`, `gh pr reopen` and `.../ccr/convert_to_draft` set `reviewing`; merge and close set `closed`. The MCP `update_pull_request` and `merge_pull_request` tools are handled the same way.
- A ref the hook can't pin to one tracked PR (a branch name, a `$VAR`, a number that matches two PRs) is ignored rather than guessed.

**Agent reports.** The agent reports the steps in between by printing a marker line: `echo "pr-workflow: <state> <pr-url> [reason]"`. The hook reads the line from the command's output, so the agent needs no session id, no file write and no extra permission. The hook confirms each marker in the agent's context, or says why it recorded nothing.

**Waiting.** `waiting` needs a reason and ends at the next user prompt (UserPromptSubmit), so it can't switch the hook off for the rest of a session.

**Stop.** The hook blocks the end of a turn while any PR this session opened is `draft`, `reviewing` or `approved`. It lets the turn end when:

- `stop_hook_active` is true (it already nudged once this turn, so it never loops),
- a background task that will finish and wake the session is running (subagent, workflow, cloud session, or a `gh pr checks --watch` or `gh run watch` shell); teammates and monitors don't count, because they can run all session,
- a one-shot wakeup is scheduled (any one-shot, so an unrelated reminder also lets the turn end),
- every tracked PR is `ready`, `waiting` or `closed`,
- `PR_WORKFLOW_DISABLE=1` is set,
- anything goes wrong (it fails open).

## State

One file per PR under `~/.claude/pr-workflow/sessions/<session-id>/` (override the folder with `PR_WORKFLOW_STATE_DIR`). Session folders older than 30 days are pruned. To see a session's state:

```sh
node scripts/pr-workflow.mjs status <session-id>
```

## Tests

```sh
node --test tests/*.test.mjs
```
