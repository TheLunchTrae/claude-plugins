# Issue draft template

One draft per confirmed failure. Write for the person who'll fix it: what goes wrong, how to get there, where the code allows it, and which way a fix could go. Don't write the fix.

- **Title**: the symptom in plain words, as a user or caller sees it, not the mechanism. "A snippet saved while the project loads is dropped until restart", not "Race in startupSnippets cache".
- **Severity**: from the failure checklist. Put it in the draft's front matter so filing can map it to the repo's labels. If you couldn't read the repo's labels, leave `labels` empty and say so in the report.
- **Links**: permalinks to the audited commit so they survive moves, in the host's format: GitHub `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>`, GitLab `https://<host>/<group>/<project>/-/blob/<sha>/<path>#L<a>-<b>`. Name the symbol too, so the link still helps if it breaks.
- **Steps**: numbered, each with the code that makes it happen. For a race, say which order of events triggers it.
- Note what you could not check (platform behaviour, timing) in the draft; if that's the whole case, it's unconfirmed and doesn't get a draft.

```markdown
---
title: <symptom>
severity: <high | medium | low>
severity_reason: <the rule from the checklist, and any raise or lower>
labels: [<only labels the repo has, such as bug and its priority label>]
machine: <machine name in the doc>
confirmed_by: <how it was reproduced (test, script or full code trace), then the check (verifier could not refute | self-checked)>
premises: <any behaviour the draft relies on that the repo asserts but you couldn't run, or none>
---

## What goes wrong

<One or two sentences: the state the user or system ends up in and why it's wrong.>

## How it happens

1. <Step, with `Symbol` in `path` ([link](permalink))>
2. <Step>
3. <The state it ends in, and why nothing leaves it.>

## Impact

<Who hits it, how often, what they lose or can't do, and how they get out today (restart, manual step, nothing).>

## Fix direction

<The shape of a fix in a sentence or two, and the regression test that would fail today.>

Found in the state machine audit (see `<doc path>`).
```
