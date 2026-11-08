# Failure checklist

Run every question against every machine. A "yes" is a candidate, not a finding: Step 4 confirms it.

Read the machine's tests first. A test that asserts a behaviour that looks like a failure is evidence that someone chose it, not proof: tests also pin bugs. Set the case aside as designed only when it's Medium or Low and the test or a comment gives the reason; a High case goes to Unconfirmed, quoting the test, so the user decides. A case whose test gives no reason stays a normal candidate. Either way, look next to it, since a deliberate behaviour often sits beside a real gap the test doesn't cover.

## Stuck states

- Can a state be entered that nothing ever leaves short of a restart? Look for a flag set before an `await` or a call that can throw, and cleared only on success.
- Does a cache keep a failure (a rejected promise, an error result) for the rest of the process?
- Does a page, dialog or mode have a way back for every way in? Can the user reach a screen with no control that leaves it?
- Does a retry exist, and does it ever run? A retry that waits for an event which may never come (an idle session, a focus change, the next sample) is a stuck state.
- Does a watcher, poll or reader detect that its source stopped producing, or does it wait forever on stale values?
- For every deferred action (a wanted reload, a queued save, a pending retry): list each event that triggers it, and ask what happens if the condition still isn't met when that event fires. If nothing tries again, it's stuck until an unrelated event happens to come. Being retried on some event isn't enough: check that the condition clearing (the terminal closing, the session finishing, the network returning) itself triggers the retry, rather than waiting for another unrelated event that may not come while the system sits idle.

## Missing exits

For each transition that touches the outside world (network, disk, host API, another process, the user), check for:

- **error**: what state does a failure leave behind, and is it the state before the attempt?
- **cancel**: can the user or the owner abandon it, and does cancelling release everything?
- **timeout**: can it hang, and what bounds it?
- **retry**: is the failure recoverable without a restart?
- **partial completion**: if it fails halfway (one of two writes, one of several items), is the rest consistent?

## Lost work

- Does any transition throw away unsaved edits, a queued write, or a result already in hand without asking or recording it?
- Does leaving, quitting, reloading or switching the source (folder, account, profile) drop pending changes?
- Can a later save overwrite a change that arrived in between (a sync, another process, another window)?
- Can two processes or copies of the app write the same state and overwrite each other?

## Races and ordering

- Can two runs of the same work overlap (double click, a command pressed while a load runs, a reload during a save)?
- Can two events arrive in either order, and do both orders end in the same state?
- Does a callback, message or timer act on state that changed since it was scheduled? Is there a guard (session ID, generation, checkpoint, abort signal), and does every path check it?
- Is there check-then-act across an `await`, a lock release, or a thread hop?
- Does work started for one owner (session, window, process, provider setup) get applied to another?

## Stale memory

- Is there state that is only ever added to (a set of seen IDs, a list of models used, a map of known items), in memory or on disk? What decision reads it, and does that decision go wrong once the thing it recorded is gone, renamed or changed by the user?
- Is state keyed too coarsely (per directory, per user, per app) when what it describes differs per something finer (per provider setup, per window, per account)? Then whoever writes last wins for everyone.
- Is a decision based on history ("this was ever set by X") where it should be based on the current source ("this is set by X now")?

## Impossible combinations

- Can the fields hold a combination that names no state (two flags both true, a status with a missing handle)? Is it reachable?
- Would one type that names the states (an enum with data, a discriminated union) make it unrepresentable?

## Leaks and outliving

- Are listeners, timers, subscriptions, windows, child processes, temp files and locks released on every exit, including errors and disposal?
- Does any state outlive its process or owner (a Live Activity after the app dies, a lock file after a crash, a restore journal never replayed)?
- Does host shutdown, sign-out or termination skip cleanup that matters?

## Unreachable and dead states

- Is there a state the code handles but nothing can reach? It often points at a missing transition elsewhere.
- Is there a branch for a status value nothing assigns?

## Silent failure

- Does the user, or a log, hear about every failure that changes what they'd do next?
- Is the feedback shown on every surface the machine runs under: each client, UI, CLI, headless or API mode, platform? Feedback that lives in one client's code is silence in the others.
- Does every entry point that reaches the same content get the same handling? A transform, check or warning applied on one path (a tool call) and not another (a slash command, a CLI flag, an API route) fails silently on the path without it.
- Does a fallback hide that the thing they asked for didn't happen (a rerouted request, a skipped item, a default used instead)?

## Broken promises

- Read the README and user docs for each machine. Does the code do what they say in every state, including after failure, reload and restart? A promise like "a model you set yourself is left alone" or "this happens once" is a transition to test.

## Severity

Use the repo's priority labels if it has them, mapped like this:

| Severity | When |
| --- | --- |
| **High** | Data or work is lost, the wrong action runs, a security boundary is crossed, or the user is stuck with no way out inside the product. |
| **Medium** | The feature stops working until a restart, reload or manual step, or is degraded for a whole session; the user can recover but has to know how. |
| **Low** | Easy recovery, cosmetic or misleading state, or a leak with no visible effect in normal use. |

Silent substitution (a different model, account, file or target than the user configured, without telling them) counts as the wrong action running; with a clear notice it's degraded.

A race whose window is tiny and that the code can't close (check-then-act over a host API with no atomic call) goes under Set aside, unless it would be High. The entry names the window and says why no mitigation is practical: re-checking after the act, a retry, a lock, or an idempotent write.

Raise one level when it's common in normal use; lower one when it needs an unusual setup or rare timing. Apply each adjustment once. Low is the floor; something below it goes under Set aside in the report. Record the level and any adjustment in the draft's `severity_reason`.
