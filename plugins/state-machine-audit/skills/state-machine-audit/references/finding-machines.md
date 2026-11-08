# Finding implicit state machines

Search wide first, then read each hit's owner to see whether it changes over time. A field set once at construction and never changed isn't a machine.

## Signals

| Signal | What to look for | Usually a machine when |
| --- | --- | --- |
| Status fields | `status`, `state`, `phase`, `mode`, `stage`, `step`, `kind` fields and enums | it's assigned in more than one place |
| Lifecycle flags | `is*`, `has*`, `*ing`, `started`, `done`, `dirty`, `pending`, `ready`, `closed`, `disposed`, `firstRun` | it's flipped after construction, or two flags change together |
| Optionals | nullable, optional or `undefined` fields that are set and later cleared: a handle, the current session, a pending promise, a timer ID | the null and set cases take different code paths |
| Caches | maps, memoized promises, singletons, module-level state | an entry can fail, go stale, or outlive what it describes |
| Async work | promises, tasks, futures, threads, goroutines, child processes, subscriptions, retries and backoff | it can be cancelled, fail, overlap another run, or finish after its owner moved on |
| Timers | timeouts, intervals, debounces, polling, scheduled jobs | it's armed and disarmed, or its callback reads state that may have changed |
| UI flows | routes, pages, dialogs, sheets, wizards, forms with unsaved edits, navigation stacks, loading and error views | the user can leave, go back, or retry |
| Persisted state | files, temp files, lock files, keychain, kv or settings entries, database rows with a status column | it's written in steps, read by another process, or survives a crash |
| Messages | channels, queues, events between threads, processes or windows | a message can arrive after the state it was about is gone |
| Host lifecycles | app launch, background and foreground, sign-out or shutdown, reload, permission changes, network loss | the code assumes it runs to completion |

## Search patterns

Adapt to the language. These are starting points for `rg`, not a complete list.

```sh
# one file type covering the common languages; add yours. Pass the path (.) so rg never reads stdin.
T=(--type-add 'src:*.{ts,tsx,js,mjs,cjs,rs,cs,swift,kt,go,py,php,java,rb}' -t src)

# status-like fields and enums
rg -n "${T[@]}" . -e '\b(status|state|phase|mode|stage|step)\b\s*[:=]' \
  -e 'enum\s+\w*(State|Status|Phase|Mode|Stage)\b'

# lifecycle flags assigned after construction
rg -n "${T[@]}" . -e '\b(is|has)[A-Z]\w*\s*=\s*(true|false)\b' \
  -e '\b\w+(ing|ed|Pending|Ready|Dirty)\s*=\s*(true|false)\b'

# timers, cancellation and retries
rg -n "${T[@]}" . -e 'setTimeout|setInterval|clearTimeout|AbortController|AbortSignal|CancellationToken|Task\.Delay|DispatchQueue|Timer\(|tokio::time|recv_timeout|time\.After|retry|backoff'

# memoized promises and caches
rg -n "${T[@]}" . -e 'new (Weak)?Map\(|Dictionary<|HashMap<|lru|memo|cache' \
  -e '\.(get|set)\(\w+,\s*\w*[Pp]romise'
```

By language, also look at:

- **TypeScript and JavaScript**: module-level `let`, closures captured by plugin or hook factories, promise chains without `.catch`, `finally` that resets a flag, React `useState` pairs, reducers, effects with cleanups.
- **Rust**: `Option` fields on long-lived structs, `loop`/`select!` in owner threads, channel receivers, `Drop` impls, `Arc<Mutex<...>>` state.
- **C# and .NET**: view model properties with `INotifyPropertyChanged`, `CancellationTokenSource` fields, `async void`, `SemaphoreSlim` and other exclusive sections, `IDisposable`.
- **Swift**: `@State`/`@Published` pairs, `Task` handles, `scenePhase`, delegate callbacks, `ActivityKit`, `CLLocationManager`, permission statuses.
- **PHP**: entity status columns, workflow or queue job states, session data, cron-driven transitions, retries in consumers.
- **Go**: goroutines with `select`, `context.Context` cancellation, `sync.Once`, struct fields guarded by mutexes.
- **Python**: `asyncio` tasks, `threading` events, class attributes changed in callbacks, generators held across calls.

## Grouping

- Fields that change in the same functions belong to one machine.
- A per-item machine (per application, per file, per request) is one section with the item named, not one section per item.
- A state that lives across two components (a view model and the service it calls, a client and a server) is one machine with its owner named for the side that decides.
- Stateless helpers that only branch within one call aren't machines, but list them briefly in the doc if they decide a machine's outcome (see the doc template's "No lasting state" section).
