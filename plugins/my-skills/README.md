# Trae's Skills

I keep my own general-purpose skills in this Claude Code plugin, so they come with me to any session that has this marketplace. Skills that belong to one job live in that job's plugin instead; this one is for everything else. It has no hooks, agents or MCP servers, so installing it adds only the skills.

Install:

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install my-skills@thelunchtrae
```

Each skill runs when a request matches its description, or by name as `/my-skills:<skill-name>`.

## Adding a skill

1. Make a folder under `skills/` named for the skill, in kebab-case: `skills/<skill-name>/`.
2. Add `SKILL.md` to it, with frontmatter and then the instructions:

   ```markdown
   ---
   name: <skill-name>
   description: What the skill does, and when to use it.
   ---

   # <Skill name>

   The instructions Claude follows when the skill runs.
   ```

   `name` matches the folder name. Claude reads `description` to decide when to load the skill, so name the situations it's for.
3. Put any files the skill needs (references, templates, scripts) in the same folder, and point to them from `SKILL.md` by relative path, or with `${CLAUDE_SKILL_DIR}` in a command.
4. Bump `version` in `.claude-plugin/plugin.json`. Installed copies only pick up changes when the version changes.
5. List it under What's in it below.
6. Check it with `claude plugin validate plugins/my-skills` from the repo root.

## What's in it

- `skills/ci-cleanup/SKILL.md`: a checklist of common CI pitfalls (job dependencies, clone size, superseded runs, completion events instead of polling, and flaky tests) to find and fix when cleaning up or de-flaking CI.
- `skills/pr-merge-hygiene/SKILL.md`: keeping PRs mergeable under squash merging (no stacking, rebasing and retargeting stacked PRs, conflict checks before "ready" and after other merges, version bumps in the same PR).
- `skills/dependency-alerts/SKILL.md`: fixing vulnerable dependency alerts by updating rather than overriding, and leaving dev-only alerts for me to dismiss.
- `skills/visual-deliverables/SKILL.md`: mock-ups, screenshots and videos for visual changes, shared in chat (mp4, never webm), never committed or pushed to a branch just for them.
- `skills/native-ui-conventions/SKILL.md`: following each platform's UI conventions, starting with per-platform casing (Title Case on macOS, sentence case on Windows).
