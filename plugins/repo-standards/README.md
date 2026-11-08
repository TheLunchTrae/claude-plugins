# Repo Standards

I use this Claude Code plugin to set up formatting, linting, tests and CI gates in a repository from the [KrishRVH/standards](https://github.com/KrishRVH/standards) catalog. It applies only the profiles the repo uses, with the changes I make to the catalog's defaults in my own repos.

Install:

```
/plugin marketplace add TheLunchTrae/claude-plugins
/plugin install repo-standards@thelunchtrae
```

Requires Node 18 or later and git. Verifying the result needs [mise](https://mise.jdx.dev) and each profile's toolchain.

## What's in it

- `skills/repo-standards/SKILL.md`: the procedure: detect the profiles, copy the catalog, finish the hand merges, verify with the mise gates and open the PR.
- `skills/repo-standards/references/finishing.md`: the hand work after the copy: merges, left-out groups, other package managers, mixed roots, Windows and lockfiles.
- `skills/repo-standards/references/layout.md`: the README, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` and `docs/` layout.
- `skills/repo-standards/scripts/repo-standards.mjs`: a dependency-free helper with two commands.

The catalog isn't copied into this plugin. The skill clones it when it runs, so a repo gets the current catalog.

## The helper

`detect [repo]` prints JSON: the profiles whose marker files it found and where, Shell and Markdown as candidates, each JavaScript root's package manager (or none, or several, or one inherited from a workspace root), the standards files and mise config the repo already has, and the GitHub owner from `origin`. Workspace members count as part of their root; a separate app in a subdirectory counts on its own.

`apply --catalog <dir> --profile <name>[=<dir>] ...` copies the catalog into the repo. It never overwrites a file. A file that exists, in the repo or from an earlier profile in the same run, is listed for a hand merge, and the version to merge in is written to a scratch directory outside the repo (or `--merge-dir`). So is a fragment when the repo already defines the profile's tasks in another mise file, and `config.toml` when the repo uses `mise.toml` or similar. If a write fails, the files it already wrote are removed. It differs from a plain copy of the catalog in these ways:

- Fragments keep plain names (`rust.toml`, not `20-rust.toml`), and references to the numbered names inside copied files are rewritten.
- `.config/mise/config.toml` has no `syft` pin, `sbom` task or marker dispatcher. The aggregate tasks run the chosen profiles by name, in order (the gate after `secrets` and `hygiene`), and `lockfile_platforms` lists `--platforms` (default `linux-x64,macos-arm64,windows-x64`).
- `CLAUDE.md` contains only `@AGENTS.md`, and the PR template is the "What does this PR do?" heading and the squash-commit note.
- The catalog's example sources, template lockfiles, Dagger and workstation scripts are left out.
- Optional parts are groups. Off by default: `ts:effect`, `ts:mutation`, `ts:eslint-prettier`, `ts:type-tests`, `csharp:mutation`. On by default: `rust:mutation`, `python:mutation`, `csharp:application`. Change them with `--with` and `--without`. A left-out group's files and `CODEOWNERS` lines are skipped; its tasks, and the lines in copied and to-merge files that still mention it, are listed for removal.
- The TypeScript and Markdown profiles need `--package-manager`. With anything but Bun, `bunfig.toml` is skipped and the Bun tasks are listed for rewriting.
- Each profile's README isn't copied; the report lists them so their operational notes can move into `docs/developer/`.
- A profile in a subdirectory gets its `CODEOWNERS` patterns prefixed with that directory, and the report lists the paths still to fix.
- The report lists the files that must stay executable, read from the catalog clone's git index, because Git on Windows doesn't record file modes.
- `--owner` fills `@OWNER` in `CODEOWNERS`. `--dry-run` prints the plan and writes nothing; `--json` prints it as JSON. Unknown options are an error.

## Tests

```sh
node --test tests/*.test.mjs
```

Set `STANDARDS_CATALOG` to a clone of the catalog to also run every profile against it.
