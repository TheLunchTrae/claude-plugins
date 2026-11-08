# claude-plugins

My Claude Code plugins, published as a plugin marketplace named `thelunchtrae`.

## Install

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install draft-review-ready@thelunchtrae
/plugin install state-machine-audit@thelunchtrae
/plugin install repo-standards@thelunchtrae
/plugin install my-skills@thelunchtrae
```

Plugins update when their `version` in `plugin.json` changes. Turn on auto-update for this marketplace in `/plugin`, or run `/plugin marketplace update thelunchtrae`.

`pr-workflow` is now `draft-review-ready`. If you installed it under the old name, see [Renamed from pr-workflow](plugins/draft-review-ready/README.md#renamed-from-pr-workflow).

## Plugins

- [Draft-Review-Ready PR Workflow](plugins/draft-review-ready) (`draft-review-ready`): draft-first pull requests with an independent reviewer loop, and a Stop hook that keeps sessions from ending a turn mid-review.
- [State Machine Audit](plugins/state-machine-audit) (`state-machine-audit`): finds implicit state machines and their failure states, writes a state machines doc and agent guidance, and drafts one issue per confirmed failure.
- [Repo Standards](plugins/repo-standards) (`repo-standards`): sets up formatting, linting, tests and CI gates in a repo from the KrishRVH/standards catalog.
- [Trae's Skills](plugins/my-skills) (`my-skills`): my general-purpose skills, so they come with me to any session. See its README for how to add one.
