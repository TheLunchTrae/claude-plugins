---
name: state-machine-audit
description: Audit a codebase for implicit state machines (flags, status fields, nullable or optional fields, caches, async and thread lifecycles, timers, UI flows, files on disk) and their failure states. Maps each machine, writes a state machines doc and AGENTS.md guidance, and drafts one issue per confirmed failure. Use when asked to audit state machines, failure states, stuck or lost states, or races, or to document how a system's state moves.
---

# State machine audit

An implicit state machine is state that no type names: a few fields, flags, optional values, maps, timers, tasks or files, plus the code that changes them. The audit finds each one, writes down its states and transitions, and looks for the states a user or the system can reach and not get out of cleanly.

It produces three things:

1. **A state machines doc** in the repo, mapping every machine.
2. **Agent guidance** in `AGENTS.md`, so later changes keep the doc and tests in step.
3. **One issue draft per confirmed failure**, with severity, plus a separate list of unconfirmed cases.

Work in the user's working tree. Write the doc and the guidance there; never commit, push, file issues or open PRs unless the user asks. Issue drafts, notes and the report go outside the repo (see Step 6). Brief every subagent you start as read-only: no edits to tracked files, commits, pushes or issues, notes written only to the audit folder.

The audit is language-agnostic. Read the code as it is: the language's own idioms decide what a state looks like (a Rust `Option`, a C# nullable, a Swift optional and a TypeScript `undefined` are the same signal).

## Step 0: Scope and what exists

- Scope: audit the whole repo unless the user named a part. Don't stop to ask; say what you covered. For a monorepo too large to read in one pass, cover it by area with subagents (Step 1) rather than narrowing it.
- Look for an existing state machines doc (`docs/state-machines.md`, `docs/developer/state-machines.md`, a wiki folder page, an architecture doc with a states section) and an existing `AGENTS.md` (or `CLAUDE.md`) section. If one exists, this is a **re-audit**: check the doc against the code, fix drift, and look for machines and failures it misses. Keep its format.
- Look for linked shared conventions (an org `.github` repo's agent guidance). Follow them and link them; don't restate them.
- Look for a previous audit report (in the audit folder from Step 6, or wherever the user says) and read its Unconfirmed and Set aside sections, so you recheck rather than rediscover them.
- Read existing open issues so a draft never duplicates one, and note the repo's labels for later. With the GitHub CLI: `gh api 'repos/{owner}/{repo}/issues?state=open' --paginate --jq '.[] | select(.pull_request == null) | "\(.number) \(.title)"'` and `gh api repos/{owner}/{repo}/labels --paginate --jq '.[].name'` (REST, so they also work where GraphQL is blocked). On another host (GitLab and the like), use its CLI or API if you have it; otherwise skip these reads and say so in the report.
- Record the commit you audit (`git rev-parse HEAD`); issue drafts link code at that commit. Check that the tree is clean (`git status --porcelain`) and the commit is on the remote (`git branch -r --contains HEAD`). If not, tell the user, and say in the report that the links may not resolve or that lines may differ from the working tree.

## Step 1: Inventory the machines

Find every candidate. [references/finding-machines.md](references/finding-machines.md) lists the signals to search for and the search patterns by language. In short:

- Status, phase, mode or kind fields and enums, and booleans that change over time (`isLoading`, `started`, `dirty`, `pending`).
- Nullable or optional fields that are set and cleared (a handle, a current session, a pending promise).
- Caches and memoized promises, especially ones that keep a failure or never evict.
- Async lifecycles: tasks, promises, threads, subscriptions, timers, retries, watchers, child processes, and their cancellation.
- UI flows: pages, dialogs, wizards, forms with unsaved edits, navigation stacks.
- Persisted state: files, keychain or kv entries, databases, lock files, temp files, and anything that outlives the process.
- Messages between threads or processes, and the IDs or generations that guard against stale ones.

Group fields that change together into one machine. A machine is named for what it tracks ("Sign-in", "Capture slot", "Snippet capture cache"), and owned by a file and symbol.

For a large repo, split the inventory across parallel subagents by area, each returning machines with their owner, fields and transition sites. Merge duplicates yourself.

## Step 2: Map each machine

For each machine write down:

- **Owner**: file and symbol (no line numbers in the doc; they rot).
- **States**: the named states, including the ones the code only implies (a flag pair that can be `true/true` is a state even if nothing expects it).
- **Transitions**: each event that moves it (call, message, timer, callback, user action, process start or exit) and where it goes.
- **Start and end**: where it starts, and whether it ever ends (process exit, dispose, reload).
- **Guards**: what drops stale events (session IDs, generations, checkpoints, abort signals).
- **Lifetime**: what scope the state lives in (one call, one instance or reload, the process, files that outlive it) and who else shares it (other windows, clients or processes on the same directory or account).
- **Promises**: what the README, user docs and code comments tell users this behaviour does. A gap between the promise and the code is a failure in Step 3.

Trace transitions from the code, not from names or comments. Every claim cites the code that makes it true.

## Step 3: Look for failure states

Check every machine against every section of [references/failure-checklist.md](references/failure-checklist.md), one machine at a time, and write down the answer to each question, not only the ones that look promising, in `notes/<machine>.md` in the audit folder. Most real findings are in the places a quick read skips: a retry that waits on an event, a list that only grows, feedback that only one client shows. For more than a handful of machines, give each subagent a few machines, the checklist and the code, and merge their candidates. The main kinds:

- **Stuck**: a reachable state with no way out short of a restart (a cache that keeps a rejection, a flag never cleared on error, a page with no way back).
- **Missing exits**: no error, cancel, timeout or retry path where the outside world can fail or the user can leave.
- **Lost work**: a transition that drops unsaved edits, a pending write, or a result in hand (a refreshed token the store refused).
- **Races and ordering**: overlapping work, events arriving in either order, stale messages acting on a newer state, check-then-act across an await.
- **Impossible combinations**: field values that name no state but are reachable.
- **Leaks and outliving**: resources, listeners, windows, files or processes not released, or state that outlives its process or owner.
- **Unreachable or dead states**: a state the code handles that nothing can reach, which usually means a missing transition elsewhere.
- **Silent failure**: a failure the user never hears about, so they can't recover, including feedback that only some clients or surfaces show.
- **Stale memory**: state that only grows or is never cleared, which keeps deciding behaviour after the thing it recorded has gone.
- **Broken promises**: behaviour that contradicts what the README or docs tell users.

Write each candidate as: the machine, how to reach the state (numbered steps), the code at each step, what goes wrong, and who sees it.

## Step 4: Confirm or set aside

Each candidate is confirmed or unconfirmed, never guessed into an issue.

- **Confirmed**: reproduced by a test or script you ran (preferred, and kept out of the repo unless asked), or traced step by step through the code with every step cited, and an independent check didn't refute it.
- **Unconfirmed**: depends on host, platform or timing behaviour you couldn't check, on intent the code doesn't settle ("should a held rule fire after its cooldown?"), or on a step you couldn't trace.

Two rules keep real findings out of the unconfirmed pile:

- A premise the repo's own code, comments or docs assert (such as "a reload ends running terminals") counts as checked. Say in the draft that it rests on it.
- Hard to set up isn't unconfirmed. If a test can drive it through the code, such as calling the same functions in the order two processes, two windows or two overlapping requests would, it's confirmable: write that test. Two processes on one directory, two windows, or a second client are normal use, not edge cases.

Reproduction tests never become part of the repo. Prefer a script outside the repo that imports the repo's code by absolute path, run with the repo as the working directory so its dependencies and config resolve (this works with `node --test`, `cargo` examples run by path, `python -m pytest <path>` and the like). When the repo's runner only finds tests inside its own roots, as vitest and jest do, put an untracked file in its test folder named `sma-scratch-<machine>-<n>.test.<ext>`, unique per candidate, and delete it when you're done. Keep a copy of each repro in the audit folder so the verifier and the draft can cite it.

Have a fresh subagent try to refute each confirmed candidate before it becomes a draft: the plugin's agent `state-machine-audit:state-machine-verifier` (or, if it isn't available, a fresh general-purpose agent given that agent's instructions), handed the candidate, the code and any repro test you wrote, not your reasoning. Verifiers for different candidates can run in parallel. Then act on each verdict:

- `confirmed`: apply its corrections to steps, impact or severity, and draft it.
- `unconfirmed`: move it to Unconfirmed with the gap the verifier named.
- `refuted`: move it to Set aside with what prevents it. If you can't start a subagent at all, run the refutation yourself as a separate pass after all candidates are written, record it as `self-checked` in the draft, and say in the report that no independent check ran.

## Step 5: Write the doc and the guidance

- **Doc**: follow [references/doc-template.md](references/doc-template.md). Put it where the repo keeps developer docs (`docs/developer/`, `docs/`, or a wiki source folder), or keep the existing doc's place and format. One section per machine, with its owner, states, transitions (a Mermaid `stateDiagram-v2`, a State | Event | Next table, or both) and failure states. Only confirmed failures go in the doc; unconfirmed cases stay in the report. A failure state links its issue once one exists; until then it ends with exactly `Not tracked yet.` The doc describes behaviour; it doesn't hold bug reports.
- **Scope of the doc**: the repo's own doc rules apply to it (audience, where developer docs live, what stays out). CI and release workflows belong in it only when their state can strand a release or a user, such as a publish that half-completes; keep those sections short.
- **Guidance**: add or update the `## State machines` section of `AGENTS.md` from [references/agents-guidance.md](references/agents-guidance.md), adapted to the repo's languages and test setup. If neither `AGENTS.md` nor `CLAUDE.md` exists, create `AGENTS.md`. If the repo only has `CLAUDE.md`, put it there. If it has both and `CLAUDE.md` doesn't import `@AGENTS.md`, say in the report that Claude Code won't see the section and suggest the import. If shared org guidance already covers it, link that and keep only the repo-specific lines. If linked guidance can't be read, keep the full section and say so in the report.

Show the user the doc's machine list and the guidance diff when done.

## Step 6: Draft the issues

Write one draft per confirmed failure with [references/issue-template.md](references/issue-template.md): a title that names the symptom, how it happens, where in the code (permalinks at the audited commit), impact, severity, and a fix direction. Don't merge two failures into one draft because they share a machine; do merge one failure that shows up in two machines.

Put the drafts in the audit folder, outside the repo: a folder the user names, otherwise `~/.claude/state-machine-audit/<repo>/<date>/`, which lasts across sessions so a re-audit can read it. Write:

- `NN-<slug>.md` per draft, highest severity first.
- `report.md`: the audited commit, the machine list, the drafts by severity, an **Unconfirmed** section with each case, why it's unconfirmed, and what would settle it, and a **Set aside** section with candidates you dropped and why (refuted, or no harm), so a re-audit doesn't redo them. Note anything you couldn't check, such as labels or open issues without GitHub access.

Then report to the user: how many machines, the confirmed failures by severity with their titles, the unconfirmed count, and where the files are.

## Step 7: Only when the user asks

- **File the issues**: one per draft, its body without the front matter, with only labels the repo already has (map severity to its priority labels if it has them, and `bug` if it has it). Then replace each failure's `Not tracked yet.` in the doc with `Tracked in [#N](<issue URL>).`
- **Fix them**: one PR per issue, each starting with a failing test for the failure, following the repo's PR rules (the `pr-workflow` plugin if it's installed). A fix updates the doc's section and removes the failure note in the same PR.

## Re-audits and drift

On a repo that already has a doc, also report: machines in the code the doc misses, sections whose states or transitions no longer match, and failure notes whose issue is closed but which the doc still lists (or the reverse). Fix the doc's drift in the working tree; failures still follow Steps 4 and 6.
