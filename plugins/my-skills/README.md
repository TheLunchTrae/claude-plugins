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
5. Check it with `claude plugin validate plugins/my-skills` from the repo root.

## What's in it

- `skills/`: one folder per skill. It's empty for now.
