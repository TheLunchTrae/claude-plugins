# Failure checklist

Run every question against every machine. A "yes" is a candidate, not a finding: Step 4 confirms it.

## Stuck states

- Can a state be entered that nothing ever leaves short of a restart? Look for a flag set before an `await` or a call that can throw, and cleared only on success.
- Does a cache keep a failure (a rejected promise, an error result) for the rest of the process?
- Does a page, dialog or mode have a way back for every way in? Can the user reach a screen with no control that leaves it?
- Does a retry exist, and does it ever run? A retry that waits for an event which may never come (an idle session, a focus change, the next sample) is a stuck state.
- Does a watcher, poll or reader detect that its source stopped producing, or does it wait forever on stale values?

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
- Does a fallback hide that the thing they asked for didn't happen (a rerouted request, a skipped item, a default used instead)?

## Severity

Use the repo's priority labels if it has them, mapped like this:

| Severity | When |
| --- | --- |
| **High** | Data or work is lost, the wrong action runs, a security boundary is crossed, or the user is stuck with no way out inside the product. |
| **Medium** | The feature stops working until a restart, reload or manual step, or is degraded for a whole session; the user can recover but has to know how. |
| **Low** | Rare timing, easy recovery, cosmetic or misleading state, or a leak with no visible effect in normal use. |

Raise one level when it's common in normal use; lower one when it needs an unusual setup. Say which you applied.
