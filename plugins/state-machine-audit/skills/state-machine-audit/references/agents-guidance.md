# AGENTS.md guidance template

Add this as a `## State machines` section in `AGENTS.md`, or update the existing one. Adapt the bracketed parts to the repo: its doc path, its languages' state types, its test layers and its issue labels. Keep it short; the doc carries the detail.

If the repo links shared org guidance that already says this, keep only the first paragraph and the repo-specific lines, and link the shared doc.

```markdown
## State machines

[State machines](<doc path>) maps the state that no type names in <areas>: <three or four of the main machines>. Implicit state includes flags, nullable or optional fields, caches, timers, tasks, files on disk, and the order of asynchronous work.

- Before changing code that keeps state across calls, callbacks, timers, threads or reloads, find the machine it belongs to on that page, or add it as a new section. Update its states, transitions, diagram and failure states in the same change.
- Test every transition the change adds or alters at the narrowest interface that drives it, such as <the pure transition function, a view model over a fake client, the owner thread's event handler>. Cover the failure, cancel and retry paths, not only the expected one. A transition that depends on overlapping work, such as a save queued behind a sync or a command pressed while a load runs, needs a test that holds that work open. A new or changed stale-event guard needs a test that it drops an event carrying an old ID.
- When fields can hold a combination that names no state on the page, prefer one type that names the states, such as <a Rust enum with data, a TypeScript discriminated union, a C# record hierarchy, a Swift enum with associated values>, over another flag.
- A reachable state the code doesn't handle, such as a dead end, lost work, a race, or a resource never released, gets a `<bug label>` issue (or an issue draft for the user, if agents here don't file issues themselves) with how to reach it and the code that allows it, and a failure note linking it in that machine's section. Fix it in the current change only when that's the change's purpose. A change that fixes one starts with a failing test, removes the note, and updates the section.
```
