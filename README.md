# claude-plugins

My Claude Code plugins, published as a plugin marketplace named `thelunchtrae`.

## Install

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install pr-workflow@thelunchtrae
/plugin install repo-standards@thelunchtrae
```

Plugins update when their `version` in `plugin.json` changes. Turn on auto-update for this marketplace in `/plugin`, or run `/plugin marketplace update thelunchtrae`.

## Plugins

- [pr-workflow](plugins/pr-workflow): draft-first pull requests with an independent reviewer loop, and a Stop hook that keeps sessions from ending a turn mid-review.
- [state-machine-audit](plugins/state-machine-audit): finds implicit state machines and their failure states, writes a state machines doc and agent guidance, and drafts one issue per confirmed failure.
- [repo-standards](plugins/repo-standards): sets up formatting, linting, tests and CI gates in a repo from the KrishRVH/standards catalog.
