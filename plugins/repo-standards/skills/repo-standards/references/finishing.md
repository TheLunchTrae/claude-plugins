# Finishing by hand

The script does the copying. Most of the work is here. Go through every item the script's report lists, then this page.

## Merges

- A "merge by hand" file keeps the repo's own content and gains the catalog's. The catalog files named in that list are unchanged, so rename numbered fragment references (`20-rust.toml` to `rust.toml`) and fill `@OWNER` as you merge.
- `.gitignore`: the catalog's file whole, then a `# <Project> (project)` section for the repo's own entries. Leave the section out when the catalog's file already covers them all.
- `CODEOWNERS`: one file. `* @owner` first, then every profile's enforcement paths.
- `.github/workflows/quality.yml`: one workflow with a single `quality` job that installs every profile's toolchain and runs `mise run standards:check`. Keep actions pinned by SHA. Use the longest `timeout-minutes` of the merged workflows.
- `Cargo.toml`, `package.json`, `pyproject.toml`: keep the repo's metadata and dependencies, and add the catalog's lint, profile and tooling sections. Refresh the lockfile afterwards (`rust:lock`, `ts:lock`), because the `--locked` and frozen tasks fail until it matches.

## AGENTS.md

- Start from the copied `shared/AGENTS.md`. Add one `## <Language>` section per profile after `## Commands`, from that profile's `AGENTS.md` fragment.
- Cut fragment paragraphs that repeat a shared section, such as their own review and handoff notes.
- The fragments link to their profile's `README.md`, which isn't copied. Move what the repo needs from it (gate limits, recovery steps such as a stale mutation lock) into a `docs/developer/` page and point the links there.
- Then follow [the layout reference](layout.md) for the Project and Platform sections, `README.md`, `CLAUDE.md`, `CONTEXT.md` and `docs/`.

## Left-out groups

- Delete the reported tasks and every `depends` on them. Make `<prefix>:standards:check` depend on the checks that remain, with tests last, as in:

  ```toml
  [tasks."ts:standards:check"]
  depends = ["ts:lint", "ts:type", "ts:fmt:check", "ts:audit", "ts:knip"]
  run = [{ task = "ts:test" }]
  ```

- Remove or reword every line the report lists as still mentioning a group: ignore patterns, cache steps, CODEOWNERS comments, guidance and lint messages. With `ts:effect` off, the TS fragment's guidance and the Effect wording in `.oxlintrc.json` and `scripts/eslint-local-rules.mjs` go too.
- Remove a package script or dev dependency only when nothing left uses it. Check `scripts/` and `.oxlintrc.json` `jsPlugins` first: `typescript-eslint` (imported by `scripts/check-directives.mjs`) and `eslint-plugin-regexp` (an Oxlint JS plugin) stay without the ESLint workflow.
- Without `eslint.config.mjs`, knip sees nothing using `scripts/eslint-local-rules.mjs`, because it doesn't read Oxlint's `jsPlugins`. Add it to knip's `entry`.

## Package manager

The catalog's TypeScript and Markdown profiles run on Bun. For any other package manager:

- Rewrite the fragment's tasks and the package scripts: install with the frozen-lockfile flag, check for the right lockfile, and use its audit command.
- Replace the `bun` tool pin with `node` and the package manager, pinned exactly. Set `packageManager` in `package.json` to the same version.
- Keep the repo's test runner if it has one. For a new repo, use `node:test` unless the user names one.
- In `tsconfig.json`, replace `types: ["bun"]` with `node`, use `NodeNext` module resolution for code that runs on Node, and drop the Effect plugin block when Effect is off.
- Carry over what `bunfig.toml` enforced: exact versions and a minimum release age. For pnpm that is `savePrefix: ''` and `minimumReleaseAge` (in minutes) in `pnpm-workspace.yaml`. For npm and Yarn, use the closest setting they have, and tell the user what has no equivalent.

## Mixed roots

When two profiles share the repo root, such as TypeScript and Rust:

- Oxfmt also formats TOML. The aggregate tasks run profiles in order, so `standards` stays deterministic; keep it that way.
- Add the other ecosystem's build output (`target/`, `mutants.out/`) to the ignore lists of the TS scripts that scan the tree, such as `scripts/check-directives.mjs`.
- Limit what `cargo package` ships with `include` in `Cargo.toml`.
- Both profiles expect `tests/`. Keep Rust's integration tests there and put TS tests next to their sources or under the package's own directory.

## Platforms

- The owner develops on Windows. Document the Git Bash setup in `AGENTS.md`, as the layout reference says. With it, inline tasks need no `run_windows`. Add one only for a task the repo says works from `cmd` or PowerShell.
- The Rust mutation lanes need Linux (`setsid`); say in the Platform section that they run in CI.

## Placeholders and license

- Replace `project-name`, `project_name` and the catalog's other neutral names with the repo's own, and drop comments that point at the catalog's README.
- Package license fields must match the repo's `LICENSE`. If the repo has none, ask the user which license to use; `cargo-deny` and packaging fail without one.

## Existing code

- Run `mise run standards` for the autofixes. Fix what remains, or suppress it at the smallest site with a stated reason. Never disable a rule broadly to get green. If what remains is large, tell the user the count and ask before landing it.
- An audit advisory with no released fix needs the user's choice: an override, or an ignore with its reason. Prefer an update whenever one exists.

## Lockfiles and CI

- Commit `.config/mise/mise.lock` and the package-manager lockfiles. CI sets `MISE_LOCKED=1`, so it fails until `mise.lock` exists.
- If mise isn't available, say so: the user has to run `mise install` and `mise lock` and commit `mise.lock` before CI can pass.
