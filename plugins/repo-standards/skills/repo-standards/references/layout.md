# Docs layout

The owner's repos split docs by reader. Use the same shape unless the repo already has a different one the owner chose.

## README.md

Minimal. It says what the project is and points elsewhere:

1. A heading and one short paragraph on what the project does.
2. **Use it:** how to get it (install command, release link or the main command), then a link to the user guide.
3. **Develop it:** a link to the developer guide and to `AGENTS.md`.
4. **License:** one line naming the license, linked to `LICENSE`.

Keep setup steps, architecture and tool lists out of it. They go in `docs/developer/` and `AGENTS.md`.

## AGENTS.md and CLAUDE.md

- `AGENTS.md` starts from the catalog's `shared/AGENTS.md` with the profile fragments merged in.
- Open it with one sentence on what the project is, before "Read `CONTEXT.md` first".
- Add a `## Project` section after the opening that says: `README.md` stays minimal and agent context goes in this file; docs live in `docs/`, in two sets for two readers (`docs/user/` with no implementation detail, `docs/developer/` for how it works and why); a change that affects both updates both. List the key pages as links.
- Add a `## Platform` section when the repo is built or used on Windows. mise runs inline tasks with `cmd` there, so it says to run mise from Git Bash and set `windows_default_inline_shell_args = "sh -c -o errexit"` under `[settings]` in the global mise config, which project config can't set. A task that must work under `cmd` gets a `run_windows` instead.
- `CLAUDE.md` holds only `@AGENTS.md`.

## CONTEXT.md

The domain vocabulary, as a bullet list of bold terms with one or two sentences each. Create it only when the project has real domain terms; an empty glossary is noise.

## docs/

- `docs/user/README.md`: the user guide's index. How to install and use it, in the user's terms. No source paths, internal names or design rationale.
- `docs/developer/README.md`: the developer guide's index and the repository layout. Pages for architecture and design decisions, local development, and releasing as the project needs them.

For a new repo, create the two index pages with what is true now and nothing speculative. For an existing repo, move setup and architecture prose out of the README into these pages rather than duplicating it.
