import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPlan,
  buildMiseConfig,
  detect,
  EXAMPLES,
  GROUPS,
  parseProfiles,
  plan,
  prefixCodeowners,
  pruneCodeowners,
  rewriteFragmentNames,
  splitTomlTables,
} from "../skills/repo-standards/scripts/repo-standards.mjs";

const SCRIPT = fileURLToPath(new URL("../skills/repo-standards/scripts/repo-standards.mjs", import.meta.url));
const temps = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-standards-test-"));
  temps.push(dir);
  return dir;
};
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

function write(root, rel, content, mode) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

const CATALOG_CONFIG = `# header
min_version = "2026.9.16"

[settings]
lockfile = true

[tools]
gitleaks = "8.30.1"
syft = "1.55.0"

[tasks.secrets]
run = "gitleaks dir ."

[tasks.sbom]
run = "syft scan"

[tasks._dispatch]
run = """
[ -f Cargo.toml ] && echo rust
[tasks.fake]
"""

[tasks.fmt]
run = [{ task = "_dispatch", args = ["fmt"] }]

[tasks."standards:check"]
depends = ["secrets", "hygiene"]
`;

// A small catalog with the real layout: manifest, shared, Mise, and two
// profiles whose files exercise examples, optional groups and CODEOWNERS.
function makeCatalog() {
  const c = tmp();
  write(c, "standards.manifest.toml", `[profiles.ts]
name = "TypeScript"
template = "TS"
task_prefix = "ts"
task_fragment = "20-ts.toml"
mirror = ["x"]

[profiles.rust]
name = "Rust"
template = "Rust"
task_prefix = "rust"
task_fragment = "20-rust.toml"

[profiles.csharp]
template = "C#"
task_prefix = "csharp"
task_fragment = "20-csharp.toml"
`);
  for (const f of [".gitattributes", ".gitleaks.toml"]) write(c, `shared/${f}`, `${f}\n`);
  write(c, "shared/.gitignore", ".stryker-tmp/\n");
  write(c, "shared/AGENTS.md", "# Agent Guide\n");
  write(c, "Mise/config.toml", CATALOG_CONFIG);
  write(c, "Mise/tasks/hygiene", "#!/usr/bin/env python3\n", 0o755);
  write(c, "Mise/conf.d/20-ts.toml", `[tasks."ts:lint"]\nrun = "bun run lint"\n\n[tasks."ts:mutants"]\nrun = "bun scripts/run-stryker.mjs full"\n\n[tasks."ts:standards:check"]\ndepends = ["ts:mutants"]\n`);
  write(c, "Mise/conf.d/20-rust.toml", `[tasks."rust:lint"]\nrun = "cargo clippy"\n`);
  write(c, "Mise/conf.d/20-csharp.toml", `[tasks."csharp:lint"]\nrun = "dotnet build"\n`);
  write(c, "TS/README.md", "catalog docs\n");
  write(c, "TS/AGENTS.md", "## TypeScript\n");
  write(c, "TS/.oxlintrc.json", "{}\n");
  write(c, "TS/package.json", "{}\n");
  write(c, "TS/bunfig.toml", "[install]\n");
  write(c, "TS/bun.lock", "lock\n");
  write(c, "TS/src/main.ts", "example\n");
  write(c, "TS/stryker.config.mjs", "export default {}\n");
  write(c, "TS/scripts/run-stryker.mjs", "\n");
  write(c, "TS/.github/pull_request_template.md", "### How did you verify your code works?\n");
  write(c, "TS/.github/workflows/quality.yml", "key: ${{ hashFiles('.config/mise/conf.d/20-ts.toml') }}\n");
  write(c, "TS/.github/CODEOWNERS", "# The enforcement surface. Replace @OWNER with a real human owner. The leading\n* @OWNER\n/stryker.config.mjs @OWNER\n/bunfig.toml @OWNER\n/package.json @OWNER\n");
  write(c, "Rust/Cargo.toml", "[workspace]\n");
  write(c, "Rust/tests/lint_wall.rs", 'const TASK_FRAGMENT: &str = ".config/mise/conf.d/20-rust.toml";\n');
  write(c, "Rust/.github/CODEOWNERS", "* @OWNER\n");
  write(c, "C#/Directory.Build.props", "<Project />\n");
  write(c, "C#/.github/workflows/quality.yml", "csharp\n");
  return c;
}

const run = (repo, opts) => {
  const result = plan({ catalog: opts.catalog, repo, ...opts });
  applyPlan(repo, result, tmp());
  return result;
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const has = (root, rel) => fs.existsSync(path.join(root, rel));

test("fragment names lose their number prefix, in names and in references", () => {
  assert.equal(rewriteFragmentNames("read .config/mise/conf.d/20-rust.toml and 10-dagger.toml"), "read .config/mise/conf.d/rust.toml and dagger.toml");
  assert.equal(rewriteFragmentNames("version 2026-10.toml stays"), "version 2026-10.toml stays");
});

test("mise config drops syft, sbom and the dispatcher and names the profiles", () => {
  const { text, unknown } = buildMiseConfig(CATALOG_CONFIG, ["ts", "rust"], ["linux-x64", "windows-x64"]);
  assert.doesNotMatch(text, /syft|sbom|_dispatch|\[tasks\.fake\]/);
  assert.match(text, /lockfile = true\nlockfile_platforms = \["linux-x64", "windows-x64"\]/);
  // Profiles run in order, after secrets and hygiene, as the catalog runs them.
  assert.match(text, /\[tasks\.fmt\]\ndescription = "Format the project"\nrun = \[\{ task = "ts:fmt" \}, \{ task = "rust:fmt" \}\]/);
  assert.match(text, /\[tasks\."standards:check"\]\ndescription = "Run the standards CI gate"\ndepends = \["secrets", "hygiene"\]\nrun = \[\{ task = "ts:standards:check" \}, \{ task = "rust:standards:check" \}\]/);
  assert.doesNotMatch(text, /depends = \[[^\]]*:fmt/);
  assert.match(text, /gitleaks = "8\.30\.1"/);
  assert.match(text, /^# header\nmin_version/);
  assert.deepEqual(unknown, []);
});

test("an unknown table in the catalog config is kept and reported", () => {
  const { text, unknown } = buildMiseConfig(`${CATALOG_CONFIG}\n[env]\nFOO = "1"\n`, ["rust"], ["linux-x64"]);
  assert.match(text, /\[env\]\nFOO = "1"/);
  assert.deepEqual(unknown, ["[env]"]);
});

test("apply writes the baseline with Trae's files and plain names", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  run(repo, { catalog, profiles: parseProfiles(["ts", "rust"]), packageManager: "bun", owner: "@trae" });
  assert.equal(read(repo, "CLAUDE.md"), "@AGENTS.md\n");
  assert.match(read(repo, ".github/pull_request_template.md"), /^### What does this PR do\?\n/);
  assert.doesNotMatch(read(repo, ".github/pull_request_template.md"), /verify/);
  assert.ok(has(repo, ".config/mise/conf.d/ts.toml"));
  assert.ok(has(repo, ".config/mise/conf.d/rust.toml"));
  assert.ok(!fs.readdirSync(path.join(repo, ".config/mise/conf.d")).some((f) => /^\d/.test(f)));
  assert.match(read(repo, "tests/lint_wall.rs"), /conf\.d\/rust\.toml/);
  assert.match(read(repo, ".github/workflows/quality.yml"), /conf\.d\/ts\.toml/);
  assert.equal(fs.statSync(path.join(repo, ".config/mise/tasks/hygiene")).mode & 0o111, 0o111);
  assert.ok(has(repo, "bunfig.toml"));
  for (const f of ["README.md", "src/main.ts", "bun.lock"]) assert.ok(!has(repo, f), f);
});

test("apply never overwrites and reports every collision", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  write(repo, ".gitignore", "mine\n");
  write(repo, "package.json", '{"name":"mine"}\n');
  write(repo, ".config/mise/config.toml", "# mine\n");
  const result = run(repo, { catalog, profiles: parseProfiles(["ts", "rust"]), packageManager: "bun" });
  assert.equal(read(repo, ".gitignore"), "mine\n");
  assert.equal(read(repo, "package.json"), '{"name":"mine"}\n');
  assert.equal(read(repo, ".config/mise/config.toml"), "# mine\n");
  const dests = result.conflicts.map((c) => c.dest);
  for (const d of [".gitignore", "package.json", ".config/mise/config.toml", ".github/CODEOWNERS"]) assert.ok(dests.includes(d), d);
  // Rust's CODEOWNERS collides with TS's from the same run, not the repo.
  assert.equal(result.conflicts.find((c) => c.src?.endsWith(path.join("Rust", ".github", "CODEOWNERS"))).reason, "copied earlier in this run");
  // A second run changes nothing.
  const again = run(repo, { catalog, profiles: parseProfiles(["ts", "rust"]), packageManager: "bun" });
  assert.equal(again.ops.length, 0);
});

test("left-out groups skip their files, CODEOWNERS lines and report their tasks", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  const result = run(repo, { catalog, profiles: parseProfiles(["ts"]), packageManager: "pnpm", owner: "@trae" });
  assert.ok(!has(repo, "stryker.config.mjs"));
  assert.ok(!has(repo, "scripts/run-stryker.mjs"));
  assert.ok(!has(repo, "bunfig.toml"));
  const owners = read(repo, ".github/CODEOWNERS");
  assert.doesNotMatch(owners, /stryker|bunfig|@OWNER|Replace/);
  assert.match(owners, /\* @trae\n\/package\.json @trae/);
  const mutation = result.dropped.find((d) => d.group === "ts:mutation");
  assert.deepEqual(mutation.tasks, ["ts:mutants"]);
  // The fragment's lines still name the group; the shared .gitignore is kept whole.
  assert.deepEqual(mutation.mentions, [".config/mise/conf.d/ts.toml (1)"]);
  assert.deepEqual(result.profileDocs, ["TS/README.md"]);
  assert.ok(result.notes.some((n) => /use Bun; rewrite them for pnpm/.test(n)));
});

test("--with turns a group on", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  const result = run(repo, { catalog, profiles: parseProfiles(["ts"]), packageManager: "bun", with: ["ts:mutation"] });
  assert.ok(has(repo, "stryker.config.mjs"));
  assert.ok(!result.dropped.some((d) => d.group === "ts:mutation"));
  assert.ok(result.notes.some((n) => /@OWNER/.test(n)));
});

test("a profile in a subdirectory keeps .github at the root", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  const result = run(repo, { catalog, profiles: parseProfiles(["csharp=desktop/"]) });
  assert.ok(has(repo, "desktop/Directory.Build.props"));
  assert.ok(has(repo, ".github/workflows/quality.yml"));
  assert.ok(!has(repo, "desktop/.github"));
  assert.ok(result.notes.some((n) => n.includes('dir = "{{config_root}}/desktop"')));
});

test("bad input fails before anything is written", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  assert.throws(() => plan({ catalog, repo, profiles: parseProfiles(["ts"]) }), /ask the user/);
  assert.throws(() => plan({ catalog, repo, profiles: parseProfiles(["kotlin"]) }), /unknown profile kotlin/);
  assert.throws(() => plan({ catalog, repo, profiles: parseProfiles(["rust"]), with: ["rust:nope"] }), /unknown group/);
  assert.throws(() => plan({ catalog, repo, profiles: parseProfiles(["rust", "rust"]) }), /named twice/);
  assert.throws(() => parseProfiles(["rust=../x"]), /inside the repo/);
  assert.throws(() => plan({ catalog: repo, repo, profiles: parseProfiles(["rust"]) }), /not the standards catalog/);
  assert.deepEqual(fs.readdirSync(repo), []);
});

test("CODEOWNERS pruning matches globs and directories", () => {
  const text = "* @a\neslint.config.* @a\n/type-tests/tsconfig.json @a\n/scripts/ @a\n# eslint.config.* stays in comments\n";
  const out = pruneCodeowners(text, ["eslint.config.mjs", "type-tests/"], "@a");
  assert.equal(out, "* @a\n/scripts/ @a\n# eslint.config.* stays in comments\n");
});

test("detect finds profiles, nested roots and the package manager", () => {
  const repo = tmp();
  write(repo, "package.json", '{"packageManager":"pnpm@9.0.0"}');
  write(repo, "pnpm-lock.yaml", "");
  write(repo, "tsconfig.json", "{}");
  write(repo, "src/index.ts", "");
  write(repo, "desktop/App.csproj", "");
  write(repo, "crates/a/Cargo.toml", "");
  write(repo, "crates/b/Cargo.toml", "");
  write(repo, "Cargo.toml", "");
  write(repo, "node_modules/x/Cargo.toml", "");
  write(repo, "scripts/build.sh", "");
  write(repo, "docs/a.md", "");
  const d = detect(repo);
  assert.deepEqual(d.profiles.ts.dirs, ["."]);
  assert.deepEqual(d.profiles.csharp.dirs, ["desktop"]);
  assert.deepEqual(d.profiles.rust.dirs, ["."]);
  assert.equal(d.profiles.shell.candidate, true);
  assert.equal(d.profiles.markdown.candidate, true);
  assert.equal(d.packageManagers["."].packageManager, "pnpm");
  assert.deepEqual(d.existing, ["docs/"]);
});

test("detect reports an ambiguous or missing package manager", () => {
  const repo = tmp();
  write(repo, "package.json", "{}");
  write(repo, "index.js", "");
  assert.equal(detect(repo).packageManagers["."].packageManager, null);
  write(repo, "yarn.lock", "");
  write(repo, "package-lock.json", "");
  const pm = detect(repo).packageManagers["."];
  assert.equal(pm.packageManager, null);
  assert.equal(pm.ambiguous, true);
  assert.deepEqual(pm.candidates.sort(), ["npm", "yarn"]);
});

// Runs against a real clone of KrishRVH/standards when STANDARDS_CATALOG
// points at one, so catalog layout changes show up here.
test("the real catalog applies cleanly", { skip: !process.env.STANDARDS_CATALOG }, () => {
  const catalog = process.env.STANDARDS_CATALOG;
  const repo = tmp();
  const names = ["ts", "rust", "python", "go", "shell", "markdown", "csharp", "kotlin", "swift"];
  for (const name of names) {
    const r = tmp();
    run(r, { catalog, profiles: parseProfiles([name]), packageManager: "bun", owner: "@trae" });
    assert.ok(has(r, `.config/mise/conf.d/${name}.toml`), name);
  }
  // Every path the plugin names must still exist, or a catalog rename would
  // quietly copy a left-out file back in.
  const templates = { ts: "TS", rust: "Rust", python: "Python", csharp: "C#", markdown: "Markdown", shell: "Shell" };
  for (const [profile, groups] of Object.entries(GROUPS)) {
    for (const [group, def] of Object.entries(groups)) {
      for (const f of def.files) assert.ok(has(catalog, `${templates[profile]}/${f}`), `${profile}:${group} ${f}`);
    }
  }
  for (const [profile, files] of Object.entries(EXAMPLES)) {
    for (const f of files) assert.ok(has(catalog, `${templates[profile]}/${f}`), `${profile} example ${f}`);
  }
  const result = run(repo, { catalog, profiles: parseProfiles(["ts", "rust"]), packageManager: "bun", owner: "@trae" });
  assert.ok(result.executables.includes(".config/mise/tasks/hygiene"));
  const config = read(repo, ".config/mise/config.toml");
  assert.doesNotMatch(config, /syft|sbom|_dispatch/);
  assert.deepEqual(result.notes, []);
  const all = fs.readdirSync(repo, { recursive: true }).map(String);
  for (const f of all) {
    if (fs.statSync(path.join(repo, f)).isFile()) {
      assert.doesNotMatch(read(repo, f), /\b20-(ts|rust)\.toml\b/, f);
    }
  }
});

test("a numbered fragment or another file with the profile's tasks is a merge, not a second fragment", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  write(repo, ".config/mise/conf.d/20-ts.toml", '[tasks."ts:lint"]\nrun = "mine"\n');
  write(repo, "mise.toml", '[tasks."rust:test"]\nrun = "cargo test"\n');
  write(repo, ".config/mise/conf.d/30-csharp.toml", "[env]\n");
  const result = run(repo, { catalog, profiles: parseProfiles(["ts", "rust", "csharp"]), packageManager: "bun" });
  assert.ok(!has(repo, ".config/mise/conf.d/ts.toml"));
  assert.ok(!has(repo, ".config/mise/conf.d/csharp.toml"));
  assert.ok(!has(repo, ".config/mise/conf.d/rust.toml"));
  assert.ok(!has(repo, ".config/mise/config.toml"));
  const reason = (dest) => result.conflicts.find((c) => c.dest === dest).reason;
  assert.match(reason(".config/mise/conf.d/ts.toml"), /20-ts\.toml already defines ts:\* tasks/);
  assert.match(reason(".config/mise/conf.d/rust.toml"), /mise\.toml already defines rust:\* tasks/);
  assert.match(reason(".config/mise/config.toml"), /the repo's mise config is mise\.toml/);
  assert.match(reason(".config/mise/conf.d/csharp.toml"), /30-csharp\.toml is the same fragment under another name/);
  // The generated config is kept for the merge, aggregates and all.
  const config = result.conflicts.find((c) => c.dest === ".config/mise/config.toml");
  assert.match(fs.readFileSync(config.merge, "utf8"), /\{ task = "ts:standards:check" \}, \{ task = "rust:standards:check" \}/);
  // The waiting TS fragment still has the left-out mutation task in it.
  assert.ok(result.dropped.find((d) => d.group === "ts:mutation").mentions.includes(".config/mise/conf.d/ts.toml (to merge) (1)"));
});

test("files waiting for a merge are transformed and scanned like written ones", () => {
  const catalog = makeCatalog();
  write(catalog, "Rust/.github/CODEOWNERS", "* @OWNER\n/stryker.config.mjs @OWNER\n/.config/mise/conf.d/20-rust.toml @OWNER\n");
  const repo = tmp();
  // Rust first, so TS's CODEOWNERS is the one that waits for a merge.
  const result = run(repo, { catalog, profiles: parseProfiles(["rust", "ts"]), packageManager: "bun", owner: "@trae" });
  const ts = result.conflicts.find((c) => c.dest === ".github/CODEOWNERS");
  assert.match(ts.reason, /copied earlier in this run/);
  const merge = fs.readFileSync(ts.merge, "utf8");
  assert.doesNotMatch(merge, /@OWNER|stryker|Replace/);
  assert.match(merge, /\/package\.json @trae/);
  assert.match(read(repo, ".github/CODEOWNERS"), /conf\.d\/rust\.toml @trae/);
  // The Rust copy was written first and keeps a line for a left-out TS file.
  const mutation = result.dropped.find((d) => d.group === "ts:mutation");
  assert.ok(mutation.mentions.includes(".github/CODEOWNERS (1)"), mutation.mentions.join());
});

test("other existing fragments are named, since they may run a profile under another prefix", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  write(repo, ".config/mise/conf.d/setup-ui.toml", '[tasks."ui:lint"]\nrun = "oxlint"\n');
  const result = run(repo, { catalog, profiles: parseProfiles(["ts"]), packageManager: "bun" });
  assert.ok(result.notes.some((n) => n.includes(".config/mise/conf.d/setup-ui.toml") && /another prefix/.test(n)));
});

test("GitHub's other CODEOWNERS and template locations count as existing", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  write(repo, "docs/CODEOWNERS", "* @me\n");
  write(repo, ".github/PULL_REQUEST_TEMPLATE.md", "mine\n");
  const result = run(repo, { catalog, profiles: parseProfiles(["rust"]) });
  assert.ok(!has(repo, ".github/CODEOWNERS"));
  assert.match(result.conflicts.find((c) => c.dest === ".github/CODEOWNERS").reason, /docs\/CODEOWNERS/);
  assert.match(result.conflicts.find((c) => c.dest === ".github/pull_request_template.md").reason, /PULL_REQUEST_TEMPLATE\.md/);
  assert.deepEqual(fs.readdirSync(path.join(repo, ".github")), ["PULL_REQUEST_TEMPLATE.md"]);
});

test("a subdirectory profile's CODEOWNERS points at its directory", () => {
  const text = "* @a\n/Directory.Build.props @a\n/AGENTS.md @a\n/.github/workflows/ @a\n/.config/mise/conf.d/csharp.toml @a\nCargo.toml @a\n";
  assert.equal(
    prefixCodeowners(text, "desktop"),
    "* @a\n/desktop/Directory.Build.props @a\n/AGENTS.md @a\n/.github/workflows/ @a\n/.config/mise/conf.d/csharp.toml @a\nCargo.toml @a\n",
  );
  assert.equal(prefixCodeowners(text, "."), text);
});

test("left-out Rust mutation is reported where the policy task and tests use it", () => {
  const catalog = makeCatalog();
  write(catalog, "Rust/scripts/mutants-lock.sh", "#!/bin/sh\n", 0o755);
  write(catalog, "Rust/tests/allow_policy.rs", 'task_definition(&tasks, "rust:mutants")\n');
  write(catalog, "Mise/conf.d/20-rust.toml", '[tasks."rust:policy"]\nrun = "sh scripts/mutants-lock.sh --self-test"\n\n[tasks."rust:mutants"]\nrun = "cargo mutants"\n');
  const repo = tmp();
  const result = run(repo, { catalog, profiles: parseProfiles(["rust"]), without: ["rust:mutation"] });
  assert.ok(!has(repo, "scripts/mutants-lock.sh"));
  const d = result.dropped.find((x) => x.group === "rust:mutation");
  assert.deepEqual(d.tasks, ["rust:mutants"]);
  assert.deepEqual(d.mentions.sort(), [".config/mise/conf.d/rust.toml (2)", "tests/allow_policy.rs (1)"]);
});

test("a failed apply removes what it wrote", () => {
  const catalog = makeCatalog();
  const repo = tmp();
  const result = plan({ catalog, repo, profiles: parseProfiles(["rust"]) });
  // Something appears between the plan and the write.
  write(repo, result.ops[result.ops.length - 1].dest, "late\n");
  assert.throws(() => applyPlan(repo, result, tmp()), /EEXIST/);
  // Only the late file and its directories are left, not the directories the
  // failed run created.
  const late = result.ops[result.ops.length - 1].dest.split("/");
  const expected = late.map((_, i) => late.slice(0, i + 1).join(path.sep));
  assert.deepEqual(fs.readdirSync(repo, { recursive: true }).map(String).sort(), expected.sort());
});

test("detect keeps a separate nested app and folds workspace members into their root", () => {
  const repo = tmp();
  // A root with only tooling, and a real app under apps/setup.
  write(repo, "package.json", "{}");
  write(repo, "eslint.config.mjs", "");
  write(repo, "apps/setup/package.json", "{}");
  write(repo, "apps/setup/pnpm-lock.yaml", "");
  write(repo, "apps/setup/tsconfig.json", "{}");
  write(repo, "apps/setup/src/a.ts", "");
  assert.deepEqual(detect(repo).profiles.ts.dirs, ["apps/setup"]);
  assert.equal(detect(repo).packageManagers["apps/setup"].packageManager, "pnpm");

  const ws = tmp();
  write(ws, "package.json", '{"workspaces":["packages/*"]}');
  write(ws, "bun.lock", "");
  write(ws, "tsconfig.json", "{}");
  write(ws, "packages/a/package.json", "{}");
  write(ws, "packages/a/src/a.ts", "");
  write(ws, "tools/x/package.json", "{}");
  write(ws, "tools/x/index.js", "");
  const d = detect(ws);
  assert.deepEqual(d.profiles.ts.dirs.sort(), [".", "tools/x"]);
  // tools/x has no lockfile, so it uses the root's.
  assert.equal(d.packageManagers["tools/x"].packageManager, "bun");
  assert.equal(d.packageManagers["tools/x"].inheritedFrom, ".");
});

test("detect folds several C# projects without a solution into their parent", () => {
  const repo = tmp();
  write(repo, "desktop/App/App.csproj", "");
  write(repo, "desktop/Core/Core.csproj", "");
  assert.deepEqual(detect(repo).profiles.csharp.dirs, ["desktop"]);
});

test("detect reports existing numbered fragments and other mise configs", () => {
  const repo = tmp();
  write(repo, ".config/mise/conf.d/20-ts.toml", "");
  write(repo, ".mise.toml", "");
  const { existing } = detect(repo);
  assert.ok(existing.includes(".mise.toml"));
  assert.ok(existing.includes(".config/mise/conf.d/20-ts.toml"));
});

test("TOML splitting handles trailing comments, arrays of tables and mixed quotes", () => {
  const chunks = splitTomlTables(`a = 1\n[tasks.x] # note\nrun = """\n'''\n[not.a.table]\n"""\n[[array]]\nb = 2\n`);
  assert.deepEqual(chunks.map((c) => c.header), [null, "[tasks.x]", "[[array]]"]);
});

test("the CLI runs through a symlink and rejects unknown options", { skip: process.platform === "win32" }, () => {
  const catalog = makeCatalog();
  const repo = tmp();
  const link = path.join(tmp(), "rs.mjs");
  fs.symlinkSync(SCRIPT, link);
  const out = execFileSync(process.execPath, [link, "apply", `--catalog=${catalog}`, "--repo", repo, "--profile", "rust", "--dry-run"], { encoding: "utf8" });
  assert.match(out, /^Would write:/);
  assert.deepEqual(fs.readdirSync(repo), []);
  const bad = spawnSync(process.execPath, [SCRIPT, "apply", "--catalog", catalog, "--platform", "linux-x64"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option --platform/);
  assert.throws(() => parseProfiles(["rust=C:\\x"]), /inside the repo/);
});

test("executables come from the catalog's git index, which Windows file systems need", () => {
  const catalog = makeCatalog();
  write(catalog, "Rust/scripts/check.sh", "#!/bin/sh\n", 0o644);
  const git = (...a) => execFileSync("git", ["-C", catalog, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("update-index", "--chmod=+x", "Rust/scripts/check.sh");
  // As on Windows: the files on disk have no execute bit.
  fs.chmodSync(path.join(catalog, "Mise/tasks/hygiene"), 0o644);
  const repo = tmp();
  const result = run(repo, { catalog, profiles: parseProfiles(["rust"]) });
  assert.deepEqual(result.executables.sort(), [".config/mise/tasks/hygiene", "scripts/check.sh"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(repo, "scripts/check.sh")).mode & 0o111, 0o111);
  }
});

test("without a git index, the known executables are still listed", () => {
  const catalog = makeCatalog();
  fs.chmodSync(path.join(catalog, "Mise/tasks/hygiene"), 0o644);
  const result = plan({ catalog, repo: tmp(), profiles: parseProfiles(["rust"]) });
  assert.ok(result.executables.includes(".config/mise/tasks/hygiene"));
});

test("detect lists a file once, under its name on disk", () => {
  const repo = tmp();
  write(repo, ".github/PULL_REQUEST_TEMPLATE.md", "");
  const { existing } = detect(repo);
  assert.deepEqual(existing.filter((e) => /pull_request_template/i.test(e)), [".github/PULL_REQUEST_TEMPLATE.md"]);
});

test("a dangling symlink at a watched path doesn't stop detect or apply", { skip: process.platform === "win32" }, () => {
  const repo = tmp();
  fs.symlinkSync(path.join(repo, "missing"), path.join(repo, "CLAUDE.md"));
  assert.ok(!detect(repo).existing.includes("CLAUDE.md"));
  const result = plan({ catalog: makeCatalog(), repo, profiles: parseProfiles(["rust"]) });
  assert.ok(result.conflicts.some((c) => c.dest === "CLAUDE.md"));
});
