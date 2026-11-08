---
name: repo-standards
description: Sets up formatting, linting, tests and CI gates in a repository from the KrishRVH/standards catalog, with plain fragment names, explicit aggregate tasks and the owner's layout for README, AGENTS.md and docs. Load when asked to set up standards or linting, bootstrap a new repo, or bring an existing repo up to these standards.
---

# Repo standards

The baseline is the [KrishRVH/standards](https://github.com/KrishRVH/standards) catalog. It is a catalog, not a package: copy only the parts the repo uses, then review every copied line against the repo. This skill adds the owner's changes on top. Where the catalog and this skill differ, this skill wins.

Repository settings, rulesets and branch protection are out of scope. Leave them alone, and don't tell the user to configure them as part of this work.

The helper script needs Node 18 or later and no dependencies. Set it once per shell:

```sh
rs="${CLAUDE_SKILL_DIR}/scripts/repo-standards.mjs"
```

## 1. Look at the repo

```sh
node "$rs" detect .
```

- Profiles with a marker file (`Cargo.toml`, `package.json`, `go.mod`, `pyproject.toml`, `Package.swift`, Gradle Kotlin files, `.sln`/`.slnx`/`.csproj`) apply. A profile found only in a subdirectory, such as C# in `desktop/`, is applied there as `--profile csharp=desktop`.
- `shell` and `markdown` come back as candidates. Add Shell when the repo owns real scripts. Add Markdown when docs or content are part of what the repo ships, not for a README and a few pages.
- **Package manager.** The TypeScript and Markdown profiles need one. Use the one the repo already uses (`packageManagers` in the output). If there is none, or more than one, ask the user. Never default to Bun or pnpm.
- An empty repo has no markers: ask what it will hold before choosing profiles.

## 2. Copy the catalog

Clone the catalog outside the repo and note its commit for the report:

```sh
catalog="$(mktemp -d)/standards"
git clone --depth 1 https://github.com/KrishRVH/standards "$catalog"
git -C "$catalog" rev-parse --short HEAD
```

Read its README's "Adoption Model" and the README of each profile you apply. Then run a dry run, check it, and apply:

```sh
node "$rs" apply --catalog "$catalog" --profile ts --profile rust \
  --package-manager pnpm --owner @handle --dry-run
```

- `--owner`: the GitHub user who owns the repo. If the repo belongs to an organization, ask which user or team owns review.
- `--platforms`: the machines that run the tools, for `lockfile_platforms`. The default is `linux-x64,macos-arm64,windows-x64` (CI plus the owner's Windows and Mac). Add `macos-x64` when CI runs Intel macOS.
- `--with <profile:group>` adds a part that is off by default; `--without` drops one that is on. Off by default: `ts:effect`, `ts:mutation`, `ts:eslint-prettier`, `ts:type-tests`, `csharp:mutation`. Turn on `ts:effect` when the repo depends on `effect`.

The script never overwrites. It writes the shared files, the hygiene task, the profile files, plain-named fragments (`rust.toml`, never `20-rust.toml`, with references inside copied files rewritten), a `.config/mise/config.toml` whose aggregate tasks name the profiles directly, `CLAUDE.md` and the PR template. It leaves out the catalog's example sources, Dagger, `syft` and the `sbom` task. Its report lists what you must finish by hand.

## 3. Finish by hand

Work through every item in the script's report, then [the finishing reference](references/finishing.md): merges, `AGENTS.md`, left-out groups, the package manager, mixed roots, platforms, placeholders and license, existing code, and lockfiles. Follow [the layout reference](references/layout.md) for `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` and `docs/`.

Remove guidance, tasks and config for ecosystems and groups the repo doesn't have, in every copied file. The finished files describe this repo, not the catalog.

## 4. Verify and hand off

```sh
mise install
mise run standards
mise run standards:check
```

Commit `.config/mise/mise.lock` and the package-manager lockfiles. If mise, a toolchain or the network isn't available, say which gates didn't run; don't call the setup verified.

Open the PR the way the repo's PR rules say (the `pr-workflow` plugin when installed). The report names the catalog commit, the profiles and their directories, the groups left out, the gates run and their results, and anything waiting on the user's choice.
