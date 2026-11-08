#!/usr/bin/env node
// Applies the KrishRVH/standards catalog to a repository with Trae's changes.
// No dependencies; Node 18 or later.
//
//   repo-standards.mjs detect [repo]
//   repo-standards.mjs apply --catalog <dir> [--repo <dir>] --profile <name>[=<dir>]...
//                            [--package-manager <pm>] [--owner <@handle>]
//                            [--platforms <list>] [--with <group>]... [--without <group>]...
//                            [--dry-run] [--json]
//
// `apply` never overwrites a file. Anything that already exists, in the repo or
// from an earlier profile in the same run, is reported for a hand merge, and
// the version to merge in is written to a scratch directory outside the repo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_PLATFORMS = ["linux-x64", "macos-arm64", "windows-x64"];
export const PACKAGE_MANAGERS = ["bun", "pnpm", "npm", "yarn"];
const AGGREGATES = ["fmt", "fmt:check", "lint", "test", "standards", "standards:check"];
const AGGREGATE_DESCRIPTIONS = {
  fmt: "Format the project",
  "fmt:check": "Check formatting",
  lint: "Lint and analyze",
  test: "Run the tests",
  standards: "Run standards workflows and available autofixes",
  "standards:check": "Run the standards CI gate",
};
// Profiles whose catalog tasks run through Bun.
const BUN_PROFILES = new Set(["ts", "markdown"]);

// Optional parts of a profile. `on` is the default; Trae's repos drop the TS
// and C# mutation setups, Effect, and the secondary ESLint and Prettier
// workflow, and keep Rust's mutation gate. `tasks` names the fragment tasks
// that belong to the group, and `residue` matches lines in copied files that
// still refer to it, so both are reported when the group is left out.
export const GROUPS = {
  ts: {
    effect: {
      on: false,
      files: ["docs/effect/", "effect-diagnostics/", "scripts/check-effect-diagnostics.mjs"],
      tasks: [/^ts:effect:/],
      residue: [/\bEffect\b/, /effect-diagnostics/, /@effect\//, /docs\/effect/],
    },
    mutation: {
      on: false,
      files: [
        ".prettierignore",
        "stryker.config.mjs",
        "scripts/run-stryker.mjs",
        "scripts/check-stryker-cache.mjs",
        "scripts/check-stryker-report.mjs",
        "scripts/stryker-report-contract.mjs",
      ],
      tasks: [/^ts:mutants/, /^ts:preflight$/],
      residue: [/stryker/i, /\breports\//],
    },
    "eslint-prettier": {
      on: false,
      files: ["eslint.config.mjs", "prettier.config.mjs"],
      tasks: [/:secondary/],
      residue: [/eslint\.config/, /prettier\.config/, /:secondary/],
    },
    "type-tests": {
      on: false,
      files: ["type-tests/", "scripts/check-type-tests.mjs"],
      tasks: [/^ts:type-tests:/],
      residue: [/type-tests/],
    },
  },
  csharp: {
    mutation: { on: false, files: ["stryker-config.json"], tasks: [/^csharp:mutants/], residue: [/stryker/i] },
    application: { on: true, files: ["APPLICATION.md"], tasks: [] },
  },
  rust: {
    mutation: {
      on: true,
      files: ["scripts/mutants-lock.sh", "scripts/verify-mutants.sh", "tests/mutation_report_policy.rs"],
      tasks: [/^rust:mutants/],
      // rust:policy self-tests the mutation scripts and tests/allow_policy.rs
      // checks the mutation tasks, so both are reported when the group is off.
      residue: [/mutants-lock|verify-mutants|mutation_report_policy|rust:mutants|cargo-mutants/],
    },
  },
  python: {
    mutation: {
      on: true,
      files: ["scripts/check-mutation-score.py", "scripts/run-mutation-transaction.py"],
      tasks: [/^py:mutants/, /^py:mutation/],
      residue: [/mutmut|check-mutation-score|run-mutation-transaction|py:mutants|py:mutation/],
    },
  },
};

// Template files that only demonstrate the profile. Never copied.
export const EXAMPLES = {
  ts: ["bun.lock", "src/", "tests/"],
  markdown: ["content/example.mdx", "docs/example.md"],
  shell: ["scripts/project-name.sh", "tests/project-name.bats"],
};

// Catalog docs and merge fragments, handled separately from copied files.
const NOT_COPIED = ["README.md", "AGENTS.md", ".github/pull_request_template.md"];

const SHARED_WHOLE = [".gitignore", ".gitattributes", ".gitleaks.toml"];

// Other places mise reads project config from. When the repo uses one, the
// aggregate tasks are merged there instead of into a second config file.
const OTHER_MISE_CONFIGS = ["mise.toml", ".mise.toml", ".config/mise.toml", ".mise/config.toml", "mise/config.toml"];

// Files GitHub reads in place of one this run writes.
const ALIASES = {
  ".github/CODEOWNERS": ["CODEOWNERS", "docs/CODEOWNERS"],
  ".github/pull_request_template.md": [
    ".github/PULL_REQUEST_TEMPLATE.md", ".github/PULL_REQUEST_TEMPLATE/", "PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md", "docs/pull_request_template.md", "docs/PULL_REQUEST_TEMPLATE.md",
  ],
};

const PR_TEMPLATE = `### What does this PR do?

<!-- This body becomes the permanent squash-commit message. Keep it true. -->
`;

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "dist", "build", "out", "bin", "obj",
  ".venv", "venv", "vendor", ".next", ".turbo", "coverage", ".scratch", "artifacts",
]);

// ---------------------------------------------------------------- utilities

function walk(root, { maxDepth = Infinity } = {}) {
  const out = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (depth < maxDepth) visit(full, depth + 1);
      } else if (e.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  visit(root, 0);
  return out.sort();
}

function matchesAny(rel, patterns) {
  return patterns.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
}

// Finds rel under root ignoring case, as GitHub, Windows and macOS do. A
// trailing slash means a directory with something in it. Returns the path as
// it is on disk, or null.
function findCaseless(root, rel) {
  const dir = rel.endsWith("/");
  let at = root;
  const found = [];
  for (const part of rel.replace(/\/$/, "").split("/")) {
    let entries;
    try {
      entries = fs.readdirSync(at);
    } catch {
      return null;
    }
    const hit = entries.find((e) => e.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    found.push(hit);
    at = path.join(at, hit);
  }
  let stat;
  try {
    stat = fs.statSync(at);
  } catch {
    return null; // a dangling symlink
  }
  if (dir ? !stat.isDirectory() || fs.readdirSync(at).length === 0 : !stat.isFile()) return null;
  return found.join("/") + (dir ? "/" : "");
}

// Converts a workspace glob (apps/*, packages/**) to a regex for directories.
function globRe(glob) {
  const body = glob
    .replace(/\/+$/, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}

// The workspace member globs of a JavaScript root: package.json workspaces
// (npm, Yarn, Bun) and pnpm-workspace.yaml packages.
function workspaceGlobs(dir) {
  const globs = [];
  const pkg = readJson(path.join(dir, "package.json"));
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  if (Array.isArray(ws)) globs.push(...ws.filter((g) => typeof g === "string"));
  try {
    const yaml = fs.readFileSync(path.join(dir, "pnpm-workspace.yaml"), "utf8");
    let inPackages = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (/^\S/.test(line)) inPackages = false;
      else if (inPackages) {
        const m = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/);
        if (m) globs.push(m[1]);
      }
    }
  } catch {
    // no pnpm workspace
  }
  return globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/^\.\//, ""));
}

export function plainFragmentName(name) {
  return name.replace(/^\d+-/, "");
}

// Rewrites references to numbered fragment names, such as 20-rust.toml in the
// Rust policy tests, to the plain names this setup uses.
export function rewriteFragmentNames(text) {
  return text.replace(/\b\d{2}-([a-z]+)\.toml\b/g, "$1.toml");
}

// Drops CODEOWNERS entries for files this run left out, such as
// /stryker.config.mjs when the TS mutation setup is off, and the catalog's
// note to replace @OWNER once an owner is filled in.
export function pruneCodeowners(text, excluded, owner) {
  const globToRe = (glob) =>
    new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
  const lines = text.split("\n").filter((line) => {
    const pattern = line.trim().split(/\s+/)[0];
    if (!pattern || pattern.startsWith("#") || pattern === "*") return true;
    const rel = pattern.replace(/^\//, "");
    const re = globToRe(rel.replace(/\/$/, ""));
    return !excluded.some((ex) => {
      const target = ex.replace(/\/$/, "");
      return re.test(target) || (ex.endsWith("/") && rel.startsWith(ex)) || rel.startsWith(`${target}/`);
    });
  });
  let out = lines.join("\n");
  if (owner) out = out.replace(/Replace @(?!OWNER\b)\S+ with a real human owner\.\s*/, "");
  return out;
}

// For a profile copied into a subdirectory, points its CODEOWNERS patterns at
// that directory. Paths under .github/ and .config/ stay at the root, where
// those files are written; the catch-all and unanchored names stay as they are.
const ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".gitignore", ".gitattributes", ".gitleaks.toml"];
export function prefixCodeowners(text, dir) {
  if (dir === ".") return text;
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\/)(\S+)(.*)$/);
      if (!m || /^\.(github|config)\//.test(m[2]) || ROOT_FILES.includes(m[2])) return line;
      return `/${dir}/${m[2]}${m[3]}`;
    })
    .join("\n");
}

function isText(buf) {
  return !buf.subarray(0, 8000).includes(0);
}

// ---------------------------------------------------------------- catalog

// Catalog files that must stay executable. Windows file systems don't record
// the mode, so this reads git's index of the clone and falls back to a list.
const KNOWN_EXECUTABLES = ["Mise/tasks/hygiene", "Shell/scripts/shell-standards.sh"];
export function catalogExecutables(catalog) {
  const found = new Set(KNOWN_EXECUTABLES);
  try {
    const index = execFileSync("git", ["-C", catalog, "ls-files", "-s"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of index.split("\n")) {
      const m = line.match(/^100755 \S+ \d+\t(.+)$/);
      if (m) found.add(m[1]);
    }
  } catch {
    // not a git clone; the list and the file system have to do
  }
  return found;
}

// Reads profile metadata from the catalog's standards.manifest.toml, so a
// renamed template or fragment there is picked up instead of guessed.
export function readManifest(catalog) {
  const file = path.join(catalog, "standards.manifest.toml");
  if (!fs.existsSync(file)) {
    throw new Error(`${catalog} is not the standards catalog: standards.manifest.toml is missing`);
  }
  const profiles = {};
  let current = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const header = line.match(/^\[profiles\.([a-z]+)\]\s*$/);
    if (header) {
      current = profiles[header[1]] = { key: header[1] };
      continue;
    }
    if (/^\[/.test(line)) {
      current = null;
      continue;
    }
    const kv = current && line.match(/^(template|task_prefix|task_fragment|name)\s*=\s*"([^"]*)"/);
    if (kv) current[kv[1]] = kv[2];
  }
  for (const p of Object.values(profiles)) {
    for (const k of ["template", "task_prefix", "task_fragment"]) {
      if (!p[k]) throw new Error(`standards.manifest.toml: profile ${p.key} has no ${k}`);
    }
  }
  return profiles;
}

// Splits TOML into the text before the first table and one chunk per table,
// ignoring header-like lines inside multi-line strings.
export function splitTomlTables(text) {
  const lines = text.split("\n");
  const chunks = [{ header: null, lines: [] }];
  let open = null; // the delimiter of the multi-line string we're inside
  for (const line of lines) {
    const header = !open && line.match(/^(\[\[?[^\]]+\]\]?)\s*(#.*)?$/);
    if (header) {
      chunks.push({ header: header[1], lines: [line] });
    } else {
      chunks[chunks.length - 1].lines.push(line);
    }
    for (const m of line.matchAll(/"""|'''/g)) {
      if (!open) open = m[0];
      else if (m[0] === open) open = null;
    }
  }
  return chunks;
}

function tableName(header) {
  return header.replace(/^\[+|\]+$/g, "").trim().replace(/^tasks\./, "task:").replace(/["']/g, "");
}

// Builds .config/mise/config.toml from the catalog's: no syft or sbom task, no
// marker dispatcher, aggregate tasks that name the repo's profiles directly,
// and lockfile platforms for the machines the repo is used on.
export function buildMiseConfig(catalogConfig, prefixes, platforms) {
  const dropped = new Set(["task:sbom", "task:_dispatch", ...AGGREGATES.map((a) => `task:${a}`)]);
  const kept = [];
  const unknown = [];
  for (const chunk of splitTomlTables(catalogConfig)) {
    if (chunk.header === null) {
      kept.push(chunk.lines.join("\n").replace(/\n+$/, ""));
      continue;
    }
    const name = tableName(chunk.header);
    if (dropped.has(name)) continue;
    let body = chunk.lines.filter((l) => !/^syft\s*=/.test(l));
    if (name === "settings") {
      body = body.filter((l) => !/^lockfile_platforms\s*=/.test(l));
      const at = body.findIndex((l) => /^lockfile\s*=/.test(l));
      const line = `lockfile_platforms = [${platforms.map((p) => `"${p}"`).join(", ")}]`;
      body.splice(at === -1 ? 1 : at + 1, 0, line);
    }
    if (!["settings", "tools", "task:secrets"].includes(name)) unknown.push(chunk.header);
    kept.push(body.join("\n").replace(/\n+$/, ""));
  }
  // Profiles run one after another, as the catalog's dispatcher runs them:
  // mixed-language repos share files and formatters. The gate scans for
  // secrets and runs hygiene first, before tests write probe files.
  const tasks = AGGREGATES.map((agg) => {
    const steps = prefixes.map((p) => `{ task = "${p}:${agg}" }`).join(", ");
    const key = agg.includes(":") ? `"${agg}"` : agg;
    const lines = [`[tasks.${key}]`, `description = "${AGGREGATE_DESCRIPTIONS[agg]}"`];
    if (agg === "standards:check") lines.push('depends = ["secrets", "hygiene"]');
    lines.push(`run = [${steps}]`);
    return lines.join("\n");
  });
  return { text: [...kept, ...tasks].join("\n\n") + "\n", unknown };
}

// ---------------------------------------------------------------- detect

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function detectPackageManager(dir) {
  const found = new Set();
  const pkg = readJson(path.join(dir, "package.json"));
  const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
  if (declared && PACKAGE_MANAGERS.includes(declared)) found.add(declared);
  const locks = { "bun.lock": "bun", "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" };
  for (const [file, pm] of Object.entries(locks)) {
    if (fs.existsSync(path.join(dir, file))) found.add(pm);
  }
  if (found.size === 1) return { packageManager: [...found][0], ambiguous: false };
  return { packageManager: null, ambiguous: found.size > 1, candidates: [...found] };
}

function gitOwner(repo) {
  try {
    const url = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function detect(repo) {
  const files = walk(repo, { maxDepth: 4 });
  const dirsWith = (test) => [...new Set(files.filter(test).map((f) => path.posix.dirname(f)))];
  const base = (f) => path.posix.basename(f);
  const profiles = {};
  const add = (key, dirs, evidence) => {
    if (dirs.length) profiles[key] = { dirs, evidence };
  };

  const under = (f, d) => d === "." || f.startsWith(`${d}/`);
  const inside = (d, o) => o !== d && (o === "." || d.startsWith(`${o}/`));

  // A JavaScript root is a package.json with a tsconfig.json, or with sources
  // of its own (not ones that belong to a deeper package.json).
  const pkgDirs = dirsWith((f) => base(f) === "package.json");
  const owner = (f) =>
    pkgDirs.filter((d) => under(f, d)).sort((a, b) => b.length - a.length)[0];
  const sourceOwners = new Set(files.filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.config\./.test(base(f))).map(owner));
  const jsRoots = pkgDirs.filter((d) => fs.existsSync(path.join(repo, d, "tsconfig.json")) || sourceOwners.has(d));
  // Workspace members belong to their workspace root; other nested roots,
  // such as a separate app in a subdirectory, stay separate.
  const members = (d) => workspaceGlobs(path.join(repo, d)).map((g) => globRe(d === "." ? g : `${d}/${g}`));
  const tsDirs = jsRoots.filter((d) => !jsRoots.some((o) => inside(d, o) && members(o).some((re) => re.test(d))));
  add("ts", tsDirs, "package.json with a tsconfig.json or its own TypeScript or JavaScript sources");
  add("rust", dirsWith((f) => base(f) === "Cargo.toml"), "Cargo.toml");
  add("go", dirsWith((f) => base(f) === "go.mod"), "go.mod");
  add("python", dirsWith((f) => ["pyproject.toml", "setup.py", "requirements.txt"].includes(base(f))), "pyproject.toml, setup.py or requirements.txt");
  add("swift", dirsWith((f) => base(f) === "Package.swift"), "Package.swift");
  add("kotlin", dirsWith((f) => ["build.gradle.kts", "settings.gradle.kts"].includes(base(f))), "Gradle Kotlin build files");
  add("csharp", dirsWith((f) => /\.(sln|slnx|csproj)$/.test(f)), ".sln, .slnx or .csproj");
  const shell = files.filter((f) => /\.(sh|bash|bats)$/.test(f));
  if (shell.length) profiles.shell = { dirs: ["."], evidence: `${shell.length} shell file(s)`, candidate: true };
  const md = files.filter((f) => /\.mdx?$/.test(f));
  if (md.length) profiles.markdown = { dirs: ["."], evidence: `${md.length} Markdown/MDX file(s)`, candidate: true };
  // Cargo, Go, Python, Swift and Gradle roots own the directories below them.
  for (const [key, p] of Object.entries(profiles)) {
    if (key !== "ts") p.dirs = p.dirs.filter((d) => !p.dirs.some((o) => inside(d, o)));
  }
  // Several projects without a solution are one C# root at their common parent.
  if (profiles.csharp?.dirs.length > 1) {
    const parts = profiles.csharp.dirs.map((d) => d.split("/"));
    const common = [];
    for (let i = 0; parts.every((p) => p[i] !== undefined && p[i] === parts[0][i]); i++) common.push(parts[0][i]);
    profiles.csharp.dirs = [common.join("/") || "."];
  }

  // A root with no lockfile of its own uses the nearest one above it.
  const packageManagers = {};
  for (const d of tsDirs) {
    let pm = detectPackageManager(path.join(repo, d));
    for (let up = d; !pm.packageManager && !pm.ambiguous && up !== "."; ) {
      up = path.posix.dirname(up);
      const above = detectPackageManager(path.join(repo, up));
      if (above.packageManager || above.ambiguous) pm = { ...above, inheritedFrom: up };
    }
    packageManagers[d] = pm;
  }

  const watched = [
    ".config/mise/config.toml", ...OTHER_MISE_CONFIGS, "AGENTS.md", "CLAUDE.md", "README.md",
    "CONTEXT.md", ".gitignore", ".gitattributes", ".gitleaks.toml", ".github/CODEOWNERS",
    ".github/pull_request_template.md", ...Object.values(ALIASES).flat(), "docs/",
  ];
  const existing = [...new Set(watched.map((w) => findCaseless(repo, w)).filter(Boolean))];
  const fragments = walk(path.join(repo, ".config/mise/conf.d")).map((f) => `.config/mise/conf.d/${f}`);
  existing.push(...fragments);
  const workflows = files.filter((f) => f.startsWith(".github/workflows/"));

  return {
    repo: path.resolve(repo),
    empty: files.length === 0,
    profiles,
    packageManagers,
    existing,
    workflows,
    githubOwner: gitOwner(repo),
  };
}

// ---------------------------------------------------------------- apply

export function parseProfiles(values) {
  return values.map((v) => {
    const [name, dir = "."] = v.split("=");
    const clean = path.posix.normalize(dir.replace(/\\/g, "/")).replace(/\/$/, "");
    if (clean === ".." || clean.startsWith("../") || path.posix.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
      throw new Error(`--profile ${v}: the directory must be inside the repo`);
    }
    return { name, dir: clean || "." };
  });
}

function resolveGroups(profile, withGroups, withoutGroups) {
  const groups = GROUPS[profile] || {};
  const result = {};
  for (const [g, def] of Object.entries(groups)) {
    const id = `${profile}:${g}`;
    result[g] = withGroups.includes(id) ? true : withoutGroups.includes(id) ? false : def.on;
  }
  return result;
}

export function plan(opts) {
  const { catalog, repo, profiles, packageManager = null, owner = null } = opts;
  const platforms = opts.platforms?.length ? opts.platforms : DEFAULT_PLATFORMS;
  const withGroups = opts.with || [];
  const withoutGroups = opts.without || [];
  const manifest = readManifest(catalog);

  const known = new Set(Object.keys(GROUPS).flatMap((p) => Object.keys(GROUPS[p]).map((g) => `${p}:${g}`)));
  for (const g of [...withGroups, ...withoutGroups]) {
    if (!known.has(g)) throw new Error(`unknown group ${g}; known groups: ${[...known].join(", ")}`);
  }
  if (!profiles.length) throw new Error("name at least one --profile");
  const seen = new Set();
  for (const p of profiles) {
    if (!manifest[p.name]) {
      throw new Error(`unknown profile ${p.name}; the catalog has: ${Object.keys(manifest).join(", ")}`);
    }
    if (seen.has(p.name)) throw new Error(`--profile ${p.name} is named twice`);
    seen.add(p.name);
  }
  const needsPm = profiles.some((p) => BUN_PROFILES.has(p.name));
  if (needsPm && !packageManager) {
    throw new Error(
      "the TypeScript and Markdown profiles need --package-manager. Use the one the repo already uses; for a new repo, ask the user.",
    );
  }
  if (packageManager && !PACKAGE_MANAGERS.includes(packageManager)) {
    throw new Error(`--package-manager must be one of ${PACKAGE_MANAGERS.join(", ")}`);
  }

  const ops = []; // { kind: copy|write, dest, src?, content?, mode? }
  // { dest, src?, content?, mode?, reason }: content is what to merge in,
  // already transformed like a written file.
  const conflicts = [];
  const notes = [];
  const claimed = new Set();
  const execs = catalogExecutables(catalog);
  // Why dest can't be written, or null.
  const blocked = (rel) => {
    if (claimed.has(rel)) return "copied earlier in this run";
    // lstat, so a dangling symlink counts too: the write would fail on it.
    try {
      fs.lstatSync(path.join(repo, rel));
      return "already in the repo";
    } catch {
      // not there
    }
    const alias = (ALIASES[rel] || []).map((a) => findCaseless(repo, a)).find(Boolean);
    if (alias) return `the repo already has ${alias}, which GitHub uses instead`;
    const caseless = findCaseless(repo, rel);
    if (caseless) return `the repo already has ${caseless}`;
    return null;
  };

  const transform = (text) => {
    const out = rewriteFragmentNames(text);
    return owner ? out.replace(/@OWNER\b/g, owner) : out;
  };
  const addCopy = (srcAbs, dest, extra = (t) => t, why = null) => {
    const buf = fs.readFileSync(srcAbs);
    const fsMode = fs.statSync(srcAbs).mode & 0o777;
    const executable = execs.has(path.relative(catalog, srcAbs).split(path.sep).join("/")) || (fsMode & 0o111) !== 0;
    const mode = executable ? 0o755 : fsMode & 0o666 || 0o644;
    const op = isText(buf) ? { kind: "write", dest, content: extra(transform(buf.toString("utf8"))), mode, src: srcAbs } : { kind: "copy", dest, src: srcAbs, mode };
    const reason = why || blocked(dest);
    if (reason) {
      conflicts.push({ ...op, reason });
      return;
    }
    claimed.add(dest);
    ops.push(op);
  };
  const addWrite = (dest, content, hint, why = null) => {
    const reason = why || blocked(dest);
    if (reason) {
      conflicts.push({ dest, content, mode: 0o644, reason: `${reason}; ${hint}` });
      return;
    }
    claimed.add(dest);
    ops.push({ kind: "write", dest, content, mode: 0o644 });
  };

  // The repo's own mise config files, to find tasks a fragment would redefine.
  const repoMise = [
    ".config/mise/config.toml",
    ...OTHER_MISE_CONFIGS,
    ...walk(path.join(repo, ".config/mise/conf.d")).map((f) => `.config/mise/conf.d/${f}`),
  ].filter((f) => f.endsWith(".toml") && fs.existsSync(path.join(repo, f)));
  const definesPrefix = (file, prefix) =>
    splitTomlTables(fs.readFileSync(path.join(repo, file), "utf8")).some((c) => c.header && tableName(c.header).startsWith(`task:${prefix}:`));

  // Shared baseline.
  for (const f of SHARED_WHOLE) {
    addCopy(path.join(catalog, "shared", f), f);
  }
  addCopy(path.join(catalog, "shared", "AGENTS.md"), "AGENTS.md");
  addWrite("CLAUDE.md", "@AGENTS.md\n", "it should contain only @AGENTS.md");
  addWrite(".github/pull_request_template.md", PR_TEMPLATE, "Trae's template is the heading and the squash note only");
  addCopy(path.join(catalog, "Mise", "tasks", "hygiene"), ".config/mise/tasks/hygiene");

  const prefixes = profiles.map((p) => manifest[p.name].task_prefix);
  const { text: miseConfig, unknown } = buildMiseConfig(
    fs.readFileSync(path.join(catalog, "Mise", "config.toml"), "utf8"),
    prefixes,
    platforms,
  );
  const otherConfig = OTHER_MISE_CONFIGS.find((f) => fs.existsSync(path.join(repo, f)));
  addWrite(
    ".config/mise/config.toml",
    miseConfig,
    "merge the settings, tools and aggregate tasks into it by hand",
    otherConfig ? `the repo's mise config is ${otherConfig}, and a second config file would split it` : null,
  );
  for (const h of unknown) notes.push(`The catalog's Mise/config.toml has ${h}, which this plugin doesn't know; it was kept, so check it applies.`);

  const fragments = [];
  const agentFragments = [];
  const profileDocs = [];
  const dropped = [];
  for (const p of profiles) {
    const meta = manifest[p.name];
    const templateDir = path.join(catalog, meta.template);
    const groups = resolveGroups(p.name, withGroups, withoutGroups);
    const off = Object.entries(groups).filter(([, on]) => !on).map(([g]) => g);
    const leftOut = off.flatMap((g) => GROUPS[p.name][g].files);
    if (BUN_PROFILES.has(p.name) && packageManager !== "bun") leftOut.push("bunfig.toml");
    const excluded = [...(EXAMPLES[p.name] || []), ...leftOut];

    for (const rel of walk(templateDir)) {
      if (NOT_COPIED.includes(rel) || matchesAny(rel, excluded)) continue;
      const dest = rel.startsWith(".github/") || p.dir === "." ? rel : `${p.dir}/${rel}`;
      const extra =
        rel === ".github/CODEOWNERS" ? (t) => prefixCodeowners(pruneCodeowners(t, leftOut, owner), p.dir) : undefined;
      addCopy(path.join(templateDir, rel), dest, extra);
    }
    if (fs.existsSync(path.join(templateDir, "AGENTS.md"))) agentFragments.push(`${meta.template}/AGENTS.md`);
    if (fs.existsSync(path.join(templateDir, "README.md"))) profileDocs.push(`${meta.template}/README.md`);

    const fragmentName = plainFragmentName(meta.task_fragment);
    const fragmentDest = `.config/mise/conf.d/${fragmentName}`;
    // mise loads every conf.d file, so a numbered copy of the same fragment or
    // any file that already defines the profile's tasks would clash with it.
    const clash = repoMise.find(
      (f) => f !== fragmentDest && (plainFragmentName(path.posix.basename(f)) === fragmentName || definesPrefix(f, meta.task_prefix)),
    );
    addCopy(
      path.join(catalog, "Mise", "conf.d", meta.task_fragment),
      fragmentDest,
      undefined,
      clash
        ? `the repo's ${clash} ${definesPrefix(clash, meta.task_prefix) ? `already defines ${meta.task_prefix}:* tasks` : "is the same fragment under another name"}; merge into one file named ${fragmentName}`
        : null,
    );
    fragments.push(fragmentDest);
    const fragmentText = fs.readFileSync(path.join(catalog, "Mise", "conf.d", meta.task_fragment), "utf8");
    for (const g of off) {
      const tasks = splitTomlTables(fragmentText)
        .filter((c) => c.header?.startsWith("[tasks."))
        .map((c) => tableName(c.header).slice("task:".length))
        .filter((t) => GROUPS[p.name][g].tasks.some((re) => re.test(t)));
      dropped.push({ group: `${p.name}:${g}`, fragment: fragmentDest, tasks, residue: GROUPS[p.name][g].residue || [] });
    }
    if (p.dir !== ".") {
      notes.push(`${fragmentDest}: the ${meta.task_prefix}:* tasks must run in ${p.dir}; add dir = "{{config_root}}/${p.dir}" to each.`);
      notes.push(
        `${meta.template} files copied into ${p.dir} still assume the profile is at the repo root: fix paths in .github/workflows (hashFiles, working directories) and in any test that reads repo files, such as Rust's tests reading .config/mise from CARGO_MANIFEST_DIR. CODEOWNERS patterns for its files were prefixed with /${p.dir}/.`,
      );
    }
    if (BUN_PROFILES.has(p.name) && packageManager !== "bun") {
      notes.push(`${fragmentDest} and the scripts in ${meta.template}/package.json use Bun; rewrite them for ${packageManager} and drop the bun tool pin (see the finishing reference).`);
    }
  }
  if (!owner) notes.push("CODEOWNERS still says @OWNER; pass --owner or replace it by hand.");
  // A repo can run a profile under its own prefix, such as ui:* for its
  // TypeScript app, which no prefix check can see.
  const clashing = new Set(conflicts.map((c) => c.reason.match(/the repo's (\S+) /)?.[1]).filter(Boolean));
  const others = repoMise.filter((f) => f.startsWith(".config/mise/conf.d/") && !fragments.includes(f) && !clashing.has(f));
  if (others.length) {
    notes.push(`The repo already has ${others.join(", ")}. If one runs a profile applied here under another prefix, merge the new fragment into it instead of keeping both.`);
  }

  // Lines in copied files, and in files waiting for a merge, that still refer
  // to a left-out group.
  for (const d of dropped) {
    d.mentions = [];
    if (!d.residue.length) continue;
    for (const op of [...ops, ...conflicts]) {
      // The shared ignore files stay whole, as the catalog says.
      if (typeof op.content !== "string" || SHARED_WHOLE.includes(op.dest) || op.dest === ".config/mise/config.toml") continue;
      const hits = op.content.split("\n").filter((l) => d.residue.some((re) => re.test(l))).length;
      if (hits) d.mentions.push(`${op.dest}${ops.includes(op) ? "" : " (to merge)"} (${hits})`);
    }
  }

  // Git on Windows doesn't record these modes from the file system.
  const executables = ops.filter((o) => o.mode & 0o111).map((o) => o.dest);

  return { ops, conflicts, notes, fragments, agentFragments, profileDocs, dropped, prefixes, platforms, executables };
}

// Writes every planned file, never over an existing one. If a write fails, the
// files written so far are removed, so a rerun starts from the same state.
// The versions to merge go to mergeDir, outside the repo.
export function applyPlan(repo, result, mergeDir = null) {
  const written = [];
  const createdDirs = [];
  try {
    for (const op of result.ops) {
      const dest = path.join(repo, op.dest);
      const made = fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (made) createdDirs.push(made);
      if (op.kind === "copy") fs.copyFileSync(op.src, dest, fs.constants.COPYFILE_EXCL);
      else fs.writeFileSync(dest, op.content, { flag: "wx" });
      written.push(dest);
      if (op.mode) fs.chmodSync(dest, op.mode);
    }
  } catch (err) {
    for (const f of written.reverse()) fs.rmSync(f, { force: true });
    // mkdirSync returns the first directory it created; remove those it made.
    for (const d of createdDirs.reverse()) fs.rmSync(d, { recursive: true, force: true });
    throw err;
  }
  if (!result.conflicts.length) return;
  const dir = mergeDir || fs.mkdtempSync(path.join(os.tmpdir(), "repo-standards-merge-"));
  const seen = new Map();
  for (const c of result.conflicts) {
    // Two profiles can offer the same file; number the later ones.
    const n = (seen.get(c.dest) || 0) + 1;
    seen.set(c.dest, n);
    const file = path.join(dir, n === 1 ? c.dest : `${c.dest}.${n}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof c.content === "string") fs.writeFileSync(file, c.content);
    else fs.copyFileSync(c.src, file);
    if (c.mode) fs.chmodSync(file, c.mode);
    c.merge = file;
  }
  result.mergeDir = dir;
}

// ---------------------------------------------------------------- report

export function formatReport(result, catalog, dryRun) {
  const rel = (p) => path.relative(catalog, p).split(path.sep).join("/");
  const lines = [];
  lines.push(dryRun ? "Would write:" : "Wrote:");
  for (const op of result.ops) lines.push(`  ${op.dest}`);
  if (result.conflicts.length) {
    lines.push(
      "",
      dryRun
        ? "Merge by hand (not overwritten). A real run writes the version to merge in, already renamed, filled and pruned, to a scratch directory:"
        : `Merge by hand (not overwritten). The version to merge in, already renamed, filled and pruned, is in ${result.mergeDir}:`,
    );
    for (const c of result.conflicts) {
      const from = c.merge ? path.relative(result.mergeDir, c.merge).split(path.sep).join("/") : c.src ? rel(c.src) : "generated";
      const origin = c.src ? ` from ${rel(c.src)}` : "";
      lines.push(`  ${c.dest} <- ${from}${origin} (${c.reason})`);
    }
  }
  if (result.executables.length) {
    lines.push("", "Keep these executable. Git on Windows doesn't see file modes, so there run git add --chmod=+x on them:");
    for (const f of result.executables) lines.push(`  ${f}`);
  }
  if (result.agentFragments.length) {
    lines.push("", "Merge these AGENTS.md fragments into AGENTS.md:");
    for (const f of result.agentFragments) lines.push(`  ${f}`);
  }
  if (result.profileDocs.length) {
    lines.push("", "Read these and move what the repo needs, such as gate limits and recovery steps, into docs/developer/; fix the fragments' links to them:");
    for (const f of result.profileDocs) lines.push(`  ${f}`);
  }
  const withTasks = result.dropped.filter((d) => d.tasks.length);
  const withMentions = result.dropped.filter((d) => d.mentions?.length);
  if (result.dropped.length) {
    lines.push("", "Left out (pass --with <group> to include):");
    for (const d of result.dropped) lines.push(`  ${d.group}`);
  }
  if (withTasks.length) {
    lines.push("", "Remove these tasks and every depends on them, then rewire <prefix>:standards:check:");
    for (const d of withTasks) lines.push(`  ${d.fragment}: ${d.tasks.join(", ")}`);
  }
  if (withMentions.length) {
    lines.push("", "Copied files that still mention a left-out group (lines); remove or reword them:");
    for (const d of withMentions) lines.push(`  ${d.group}: ${d.mentions.join(", ")}`);
  }
  if (result.notes.length) {
    lines.push("", "Also:");
    for (const n of result.notes) lines.push(`  ${n}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- cli

const FLAGS = new Set(["dry-run", "json"]);
const OPTIONS = new Set(["catalog", "repo", "profile", "package-manager", "owner", "platforms", "with", "without", "merge-dir"]);

function parseArgs(argv) {
  const args = { _: [], profile: [], with: [], without: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (FLAGS.has(key)) {
      if (eq !== -1) throw new Error(`--${key} takes no value`);
      args[key] = true;
      continue;
    }
    if (!OPTIONS.has(key)) throw new Error(`unknown option --${key}`);
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith("--"))) throw new Error(`--${key} needs a value`);
    if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = value;
  }
  return args;
}

export function main(argv) {
  const args = parseArgs(argv);
  const [command, positional] = args._;
  if (command === "detect") {
    console.log(JSON.stringify(detect(positional || args.repo || "."), null, 2));
    return 0;
  }
  if (command === "apply") {
    if (!args.catalog) throw new Error("--catalog <dir> is required (a clone of KrishRVH/standards)");
    const repo = path.resolve(args.repo || ".");
    const catalog = path.resolve(args.catalog);
    const result = plan({
      catalog,
      repo,
      profiles: parseProfiles(args.profile),
      packageManager: args["package-manager"] || null,
      owner: args.owner ? (args.owner.startsWith("@") ? args.owner : `@${args.owner}`) : null,
      platforms: args.platforms ? args.platforms.split(",").map((s) => s.trim()).filter(Boolean) : null,
      with: args.with,
      without: args.without,
    });
    if (!args["dry-run"]) applyPlan(repo, result, args["merge-dir"] ? path.resolve(args["merge-dir"]) : null);
    if (args.json) {
      const dropped = result.dropped.map(({ residue, ...d }) => d);
      const conflicts = result.conflicts.map(({ dest, reason, merge }) => ({ dest, reason, merge }));
      console.log(JSON.stringify({ ...result, dropped, conflicts, ops: result.ops.map((o) => o.dest) }, null, 2));
    } else console.log(formatReport(result, catalog, args["dry-run"]));
    return 0;
  }
  console.error("usage: repo-standards.mjs detect [repo] | apply --catalog <dir> --profile <name>[=<dir>] ...");
  return 2;
}

// Run as a script, also through a symlink or a differently cased path.
const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const same = (a, b) => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
};
if (invoked && same(invoked, self)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`repo-standards: ${err.message}`);
    process.exitCode = 1;
  }
}
