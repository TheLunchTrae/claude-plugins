# state-machine-audit

A Claude Code plugin that audits a codebase for implicit state machines (state that no type names, spread over flags, status fields, optional values, caches, async work, timers, UI flows and files) and the failure states they can reach.

Install:

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install state-machine-audit@thelunchtrae
```

Then ask for it in plain words ("audit this repo for state machines and failure states") or run the skill with `/state-machine-audit:state-machine-audit`.

## What it does

1. Finds every implicit state machine and maps its owner, states, transitions and stale-event guards.
2. Checks each one for stuck states, missing error, cancel, timeout and retry paths, lost work, races, impossible combinations, leaks and silent failures.
3. Confirms each candidate by a test or a full code trace, and has a separate `state-machine-verifier` agent try to refute it. Anything it can't confirm is listed apart, with what would settle it.
4. Writes a state machines doc (one section per machine, Mermaid diagrams or transition tables, failure notes) and a `## State machines` section in `AGENTS.md` that keeps later changes, tests and the doc in step.
5. Writes one issue draft per confirmed failure, with severity, steps, permalinks at the audited commit, impact and a fix direction, plus a `report.md`. Drafts go outside the repo.

It changes only the doc and `AGENTS.md` in your working tree. It files issues, commits, or opens fix PRs only when you ask; fix PRs follow the `pr-workflow` plugin when it's installed.

On a repo that already has a state machines doc, it re-audits: fixes drift between the doc and the code, and looks for machines and failures the doc misses.

Language-agnostic. The search hints cover TypeScript and JavaScript, Rust, C#, Swift, PHP, Go and Python.

## What's in it

- `skills/state-machine-audit/SKILL.md`: the audit, step by step.
- `skills/state-machine-audit/references/`: where to look for machines, the failure checklist and severity scale, and templates for the doc, the `AGENTS.md` section and the issue drafts.
- `agents/state-machine-verifier.md`: the agent that tries to refute each finding.
