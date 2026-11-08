#!/usr/bin/env node
// Applies the KrishRVH/standards catalog to a repository with Trae's changes.
// No dependencies; Node 18 or later.
//
//   repo-standards.mjs detect [repo]
//   repo-standards.mjs apply --catalog <dir> [--repo <dir>] --profile <name>[=<dir>]...
//                            [--package-manager <pm>] [--owner <@handle>]
//                            [--platforms <list>] [--with <group>]... [--without <group>]...
//                            [--dry-run]
//
// `apply` never overwrites a file. Anything that already exists, in the repo or
// from an earlier profile in the same run, is reported for a hand merge.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
    },
  },
  python: {
    mutation: {
      on: true,
      files: ["scripts/check-mutation-score.py", "scripts/run-mutation-transaction.py"],
      tasks: [/^py:mutants/, /^py:mutation/],
    },
  },
};

// Template files that only demonstrate the profile. Never copied.
const EXAMPLES = {
  ts: ["bun.lock", "src/", "tests/"],
  markdown: ["content/example.mdx", "docs/example.md"],
  shell: ["scripts/project-name.sh", "tests/project-name.bats"],
};

// Catalog docs and merge fragments, handled separately from copied files.
const NOT_COPIED = ["README.md", "AGENTS.md", ".github/pull_request_template.md"];

const SHARED_WHOLE = [".gitignore", ".gitattributes", ".gitleaks.toml"];

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

function isText(buf) {
  return !buf.subarray(0, 8000).includes(0);
}

// ---------------------------------------------------------------- catalog

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
  let inString = false;
  for (const line of lines) {
    if (!inString && /^\[[^\]]+\]\s*$/.test(line)) {
      chunks.push({ header: line.trim(), lines: [line] });
    } else {
      chunks[chunks.length - 1].lines.push(line);
    }
    const quotes = (line.match(/"""|'''/g) || []).length;
    if (quotes % 2 === 1) inString = !inString;
  }
  return chunks;
}

function tableName(header) {
  return header.slice(1, -1).trim().replace(/^tasks\./, "task:").replace(/"/g, "");
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

  const pkgDirs = dirsWith((f) => base(f) === "package.json");
  const tsDirs = pkgDirs.filter(
    (d) =>
      fs.existsSync(path.join(repo, d, "tsconfig.json")) ||
      files.some((f) => (d === "." || f.startsWith(`${d}/`)) && /\.(c|m)?[jt]sx?$/.test(f)),
  );
  add("ts", tsDirs, "package.json with TypeScript or JavaScript sources");
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
  // Keep only the shallowest dir per profile unless nested roots are separate.
  for (const p of Object.values(profiles)) {
    p.dirs = p.dirs.filter((d) => !p.dirs.some((o) => o !== d && (o === "." || d.startsWith(`${o}/`))));
  }

  const packageManagers = {};
  for (const d of tsDirs) packageManagers[d] = detectPackageManager(path.join(repo, d));

  const watched = [
    ".config/mise/config.toml", "mise.toml", ".mise.toml", "AGENTS.md", "CLAUDE.md", "README.md",
    "CONTEXT.md", ".gitignore", ".gitattributes", ".gitleaks.toml", ".github/CODEOWNERS",
    ".github/pull_request_template.md", "docs/",
  ];
  const existing = watched.filter((w) =>
    w.endsWith("/") ? files.some((f) => f.startsWith(w)) : fs.existsSync(path.join(repo, w)),
  );
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
    if (clean.startsWith("..") || path.posix.isAbsolute(clean)) {
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
  const conflicts = []; // { dest, src?, reason }
  const notes = [];
  const claimed = new Set();
  const exists = (rel) => claimed.has(rel) || fs.existsSync(path.join(repo, rel));

  const transform = (text) => {
    const out = rewriteFragmentNames(text);
    return owner ? out.replace(/@OWNER\b/g, owner) : out;
  };
  const addCopy = (srcAbs, dest, extra = (t) => t) => {
    if (exists(dest)) {
      conflicts.push({ dest, src: srcAbs, reason: claimed.has(dest) ? "copied earlier in this run" : "already in the repo" });
      return;
    }
    claimed.add(dest);
    const buf = fs.readFileSync(srcAbs);
    const mode = fs.statSync(srcAbs).mode & 0o777;
    ops.push(isText(buf) ? { kind: "write", dest, content: extra(transform(buf.toString("utf8"))), mode, src: srcAbs } : { kind: "copy", dest, src: srcAbs, mode });
  };
  const addWrite = (dest, content, why) => {
    if (exists(dest)) {
      conflicts.push({ dest, reason: `already in the repo; ${why}` });
      return;
    }
    claimed.add(dest);
    ops.push({ kind: "write", dest, content, mode: 0o644 });
  };

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
  addWrite(".config/mise/config.toml", miseConfig, "merge the aggregate tasks for the new profiles into it by hand");
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
      const extra = rel === ".github/CODEOWNERS" ? (t) => pruneCodeowners(t, leftOut, owner) : undefined;
      addCopy(path.join(templateDir, rel), dest, extra);
    }
    if (fs.existsSync(path.join(templateDir, "AGENTS.md"))) agentFragments.push(`${meta.template}/AGENTS.md`);
    if (fs.existsSync(path.join(templateDir, "README.md"))) profileDocs.push(`${meta.template}/README.md`);

    const fragmentName = plainFragmentName(meta.task_fragment);
    const fragmentDest = `.config/mise/conf.d/${fragmentName}`;
    addCopy(path.join(catalog, "Mise", "conf.d", meta.task_fragment), fragmentDest);
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
    }
    if (BUN_PROFILES.has(p.name) && packageManager !== "bun") {
      notes.push(`${fragmentDest} and the scripts in ${meta.template}/package.json use Bun; rewrite them for ${packageManager} and drop the bun tool pin (see the finishing reference).`);
    }
  }
  if (!owner) notes.push("CODEOWNERS still says @OWNER; pass --owner or replace it by hand.");

  // Lines in copied files that still refer to a left-out group.
  for (const d of dropped) {
    d.mentions = [];
    if (!d.residue.length) continue;
    for (const op of ops) {
      // The shared ignore files stay whole, as the catalog says.
      if (op.kind !== "write" || SHARED_WHOLE.includes(op.dest) || op.dest === ".config/mise/config.toml") continue;
      const hits = op.content.split("\n").filter((l) => d.residue.some((re) => re.test(l))).length;
      if (hits) d.mentions.push(`${op.dest} (${hits})`);
    }
  }

  return { ops, conflicts, notes, fragments, agentFragments, profileDocs, dropped, prefixes, platforms };
}

export function applyPlan(repo, result) {
  for (const op of result.ops) {
    const dest = path.join(repo, op.dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (op.kind === "copy") fs.copyFileSync(op.src, dest, fs.constants.COPYFILE_EXCL);
    else fs.writeFileSync(dest, op.content, { flag: "wx" });
    if (op.mode) fs.chmodSync(dest, op.mode);
  }
}

// ---------------------------------------------------------------- report

export function formatReport(result, catalog, dryRun) {
  const rel = (p) => path.relative(catalog, p).split(path.sep).join("/");
  const lines = [];
  lines.push(dryRun ? "Would write:" : "Wrote:");
  for (const op of result.ops) lines.push(`  ${op.dest}`);
  if (result.conflicts.length) {
    lines.push("", "Merge by hand (not overwritten). The catalog files named here are unchanged, so rename numbered fragment references and fill @OWNER as you merge:");
    for (const c of result.conflicts) {
      lines.push(`  ${c.dest}${c.src ? ` <- ${rel(c.src)}` : ""} (${c.reason})`);
    }
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

function parseArgs(argv) {
  const args = { _: [], profile: [], with: [], without: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--json") args[a.slice(2).replace("-", "")] = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      if (Array.isArray(args[key])) args[key].push(value);
      else args[key] = value;
    } else args._.push(a);
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
    if (!args.dryrun) applyPlan(repo, result);
    if (args.json) {
      const dropped = result.dropped.map(({ residue, ...d }) => d);
      console.log(JSON.stringify({ ...result, dropped, ops: result.ops.map((o) => o.dest) }, null, 2));
    }
    else console.log(formatReport(result, catalog, args.dryrun));
    return 0;
  }
  console.error("usage: repo-standards.mjs detect [repo] | apply --catalog <dir> --profile <name>[=<dir>] ...");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`repo-standards: ${err.message}`);
    process.exitCode = 1;
  }
}
