#!/usr/bin/env node
// Draft-Review-Ready PR Workflow hooks. No dependencies; Node 18+.
//
// Hook modes (read the hook payload as JSON on stdin):
//   post-tool-use          record PRs this session opens, readies, merges or closes,
//   post-tool-use-failure  and the review state the agent reports with a marker line
//   user-prompt-submit     a new prompt ends any "waiting" state
//   stop                   block the end of a turn while a PR's review loop is unfinished
// CLI (debugging):
//   status <session-id>
//
// The agent reports review state by printing a marker line from its shell:
//   echo "pr-workflow: <state> <pr-url> [reason]"
// The PostToolUse hook reads it, so the agent needs no session id, file write or extra permission.
//
// Every hook mode fails open: on any error it exits 0 and prints nothing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const STATES = ['draft', 'reviewing', 'approved', 'ready', 'waiting', 'closed'];
export const BLOCKING = new Set(['draft', 'reviewing', 'approved']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const PR_URL_G = /https?:\/\/([^\s"'<>\\/]+)\/([^\s"'<>\\/]+)\/([^\s"'<>\\/]+)\/pull\/(\d+)/g;
const MARKER = /^pr-workflow:\s+(draft|reviewing|approved|ready|waiting|closed)\s+(\S+)(?:\s+(.+))?$/;
// Background task types that finish and wake the session (Claude Code's labels, then raw names).
// Teammates and monitors are left out on purpose: they can run for a whole session.
const WAKING_TASKS = new Set(['subagent', 'workflow', 'local_agent', 'local_workflow', 'remote_agent']);
const CI_WATCH = /\bgh\s+(pr\s+checks\b.*--watch|run\s+watch\b)/;
const PRUNE_DAYS = 30;

// ---- state -----------------------------------------------------------------
// One file per PR: ~/.claude/pr-workflow/sessions/<session-id>/<pr-key>.json.
// Not $CLAUDE_PLUGIN_DATA, so the location doesn't depend on which process computes it.

function baseDir() {
  return path.join(process.env.PR_WORKFLOW_STATE_DIR || path.join(os.homedir(), '.claude', 'pr-workflow'), 'sessions');
}

export function safeId(id) {
  if (typeof id !== 'string') return null;
  const s = id.replace(/[^A-Za-z0-9_-]/g, '');
  return s.length > 0 && s.length <= 128 ? s : null;
}

function canonical(host, owner, repo, n) {
  const h = host.toLowerCase(), o = owner.toLowerCase(), r = repo.toLowerCase();
  return { url: `https://${h}/${o}/${r}/pull/${Number(n)}`, host: h, owner: o, repo: r, number: Number(n) };
}

/** Parse the first PR URL in text into a canonical form: https, lowercase host/owner/repo. */
export function parsePr(text) {
  return allPrs(text)[0] ?? null;
}

export function allPrs(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(PR_URL_G)) {
    const p = canonical(m[1], m[2], m[3], m[4]);
    out.set(p.url, p);
  }
  return [...out.values()];
}

/** PR URLs that sit alone on a line, as `gh pr create` and `gh api --jq .html_url` print them. */
export function linePrs(text) {
  const out = new Map();
  const lines = String(text ?? '').split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (/already exists:\s*$/.test(lines[i - 1] ?? '')) continue; // gh's "a pull request for branch ... already exists:"
    const m = line.trim().match(/^https?:\/\/([^\s"'<>\\/]+)\/([^\s"'<>\\/]+)\/([^\s"'<>\\/]+)\/pull\/(\d+)\/?$/);
    if (m) {
      const p = canonical(m[1], m[2], m[3], m[4]);
      out.set(p.url, p);
    }
  }
  return [...out.values()];
}

function keyOf(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function sessionDir(sessionId) {
  const id = safeId(sessionId);
  return id ? path.join(baseDir(), id) : null;
}

export function loadAll(sessionId) {
  const dir = sessionDir(sessionId);
  const prs = {};
  if (!dir) return prs;
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return prs;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (v && typeof v.url === 'string' && STATES.includes(v.state)) prs[v.url] = v;
    } catch {}
  }
  return prs;
}

function save(sessionId, entry) {
  const dir = sessionDir(sessionId);
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${keyOf(entry.url)}.json`);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...entry, updated: new Date().toISOString() }));
  fs.renameSync(tmp, file);
}

function setState(sessionId, prs, url, state, extra = {}) {
  const prev = prs[url] || { url };
  const next = { ...prev, ...extra, url, state };
  if (state !== 'waiting') delete next.reason;
  save(sessionId, next);
  prs[url] = next;
  return prev.state;
}

function pruneOld() {
  try {
    const dir = baseDir();
    const cutoff = Date.now() - PRUNE_DAYS * 86400000;
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {}
}

// ---- command parsing -------------------------------------------------------

/** Quote-aware split of a shell command into segments (on ; && || | & newline) of tokens. */
export function segments(cmd) {
  const segs = [];
  let cur = [], tok = '', inTok = false, q = null;
  const endTok = () => { if (inTok) cur.push(tok); tok = ''; inTok = false; };
  const endSeg = () => { endTok(); if (cur.length) segs.push(cur); cur = []; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < cmd.length) tok += cmd[++i];
      else tok += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; inTok = true; continue; }
    if (c === '\\' && i + 1 < cmd.length) { tok += cmd[++i]; inTok = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { endTok(); continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      endSeg();
      if ((c === '&' || c === '|') && cmd[i + 1] === c) i++;
      continue;
    }
    tok += c; inTok = true;
  }
  endSeg();
  return segs;
}

// gh flags that take a value, so the next token isn't the PR ref.
const VALUE_FLAGS = new Set(['-b', '--body', '-F', '--body-file', '-c', '--comment', '-t', '--subject', '--match-head-commit', '-A', '--author-email']);

function ghPrRef(tokens) {
  let ref = '', repo = null;
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (a === '-R' || a === '--repo') { repo = tokens[i + 1] ?? null; i++; continue; }
    if (a.startsWith('--repo=')) { repo = a.slice(7); continue; }
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (!ref) ref = a;
  }
  return { ref, repo: repo ? repo.toLowerCase().replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '') : null };
}

/** owner/repo/number from a REST path like repos/o/r/pulls/12/... */
function apiPull(tokens) {
  for (const t of tokens) {
    const m = t.match(/(?:^|\/)repos\/([^/\s]+)\/([^/\s]+)\/pulls(?:\/(\d+))?(\/[^\s?]*)?(?:\?|$)/);
    if (m) return { owner: m[1].toLowerCase(), repo: m[2].toLowerCase(), number: m[3] ? Number(m[3]) : null, rest: (m[4] || '').replace(/\/+$/, '') };
  }
  return null;
}

function apiMethod(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--method') return String(tokens[i + 1] || '').toUpperCase();
    if (t.startsWith('--method=')) return t.slice(9).toUpperCase();
    if (/^-X[A-Za-z]+$/.test(t)) return t.slice(2).toUpperCase();
  }
  return tokens.some((t) => /^(-f|-F|--field|--raw-field|--input)$/.test(t) || /^--(raw-)?field=/.test(t)) ? 'POST' : 'GET';
}

function apiField(tokens, name) {
  for (let i = 0; i < tokens.length; i++) {
    if (/^(-f|-F|--field|--raw-field)$/.test(tokens[i])) {
      const [k, ...v] = String(tokens[i + 1] || '').split('=');
      if (k === name) return v.join('=');
      i++;
    }
  }
  return undefined;
}

/** PRs named by html_url in JSON (a string, or MCP content items holding JSON text). */
function htmlUrls(value) {
  const out = [];
  const tryParse = (s) => {
    const body = String(s).replace(/^\s*Exit code \d+\s*/, ''); // PostToolUseFailure prefixes the output
    try {
      visit(JSON.parse(body));
    } catch {
      for (const m of body.matchAll(/"html_url"\s*:\s*"([^"]+\/pull\/\d+)"/g)) out.push(m[1]);
    }
  };
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === 'object') {
      if (typeof v.html_url === 'string' && /\/pull\/\d+/.test(v.html_url)) out.push(v.html_url);
      else if (typeof v.url === 'string' && /\/pull\/\d+\/?$/.test(v.url)) out.push(v.url); // github-mcp-server's minimal {id, url}
      else if (typeof v.text === 'string') tryParse(v.text);
      else if (Array.isArray(v.content)) visit(v.content);
    }
  };
  if (typeof value === 'string') tryParse(value);
  else visit(value);
  return out.map(parsePr).filter(Boolean);
}

/**
 * Turn one tool call into events:
 *   { kind: 'opened', prs }
 *   { kind: 'set', state, url?, ref?, reason?, marker? }
 */
export function classify(input, failed = false) {
  const tool = String(input.tool_name ?? '');
  const ti = input.tool_input ?? {};
  const events = [];

  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(ti.command ?? '');
    if (!/\bgh\b|pr-workflow:/.test(cmd)) return events;
    const stdout = failed
      ? String(input.error ?? '')
      : typeof input.tool_response?.stdout === 'string' ? input.tool_response.stdout : JSON.stringify(input.tool_response ?? '');

    if (!failed && cmd.includes('pr-workflow:')) {
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.trim().match(MARKER);
        if (!m) continue;
        const pr = parsePr(m[2]);
        events.push({ kind: 'set', state: m[1], url: pr?.url ?? null, ref: pr ? null : { ref: m[2] }, reason: (m[3] || '').trim(), marker: true });
      }
    }

    for (const toks of segments(cmd)) {
      const gi = toks.findIndex((x) => {
        const bare = x.replace(/^.*[$(`]/, ''); // PR=$(gh ...) and `gh ...`
        return bare === 'gh' || /[\\/]gh(\.exe)?$/i.test(bare);
      });
      if (gi < 0) continue;
      const t = toks.slice(gi + 1);
      if (t[0] === 'pr' && (t[1] === 'create' || t[1] === 'new')) {
        const prs = linePrs(stdout);
        if (prs.length) events.push({ kind: 'opened', prs });
      } else if (t[0] === 'pr' && ['ready', 'merge', 'close', 'reopen'].includes(t[1]) && !failed) {
        const r = ghPrRef(t.slice(2));
        const state = t[1] === 'ready' ? (t.includes('--undo') ? 'reviewing' : 'ready') : t[1] === 'reopen' ? 'reviewing' : 'closed';
        events.push({ kind: 'set', state, ref: r });
      } else if (t[0] === 'api') {
        const p = apiPull(t.slice(1));
        if (!p) continue;
        const method = apiMethod(t.slice(1));
        if (p.number === null && p.rest === '' && method === 'POST') {
          let prs = htmlUrls(stdout);
          if (!prs.length) prs = linePrs(stdout); // --jq .html_url
          prs = prs.filter((x) => x.owner === p.owner && x.repo === p.repo);
          if (prs.length) events.push({ kind: 'opened', prs });
        } else if (p.number !== null && !failed) {
          const ref = { owner: p.owner, repo: p.repo, number: p.number };
          if (p.rest === '/ccr/ready_for_review') events.push({ kind: 'set', state: 'ready', ref });
          else if (p.rest === '/ccr/convert_to_draft') events.push({ kind: 'set', state: 'reviewing', ref });
          else if (p.rest === '/merge' && method === 'PUT') events.push({ kind: 'set', state: 'closed', ref });
          else if (p.rest === '' && method === 'PATCH' && apiField(t.slice(1), 'state') === 'closed') events.push({ kind: 'set', state: 'closed', ref });
        }
      }
    }
    return events;
  }

  if (failed) return events;
  const owner = String(ti.owner ?? '').toLowerCase(), repo = String(ti.repo ?? '').toLowerCase();
  if (/^mcp__.*__create_pull_request$/.test(tool)) {
    let prs = htmlUrls(input.tool_response);
    if (owner && repo) prs = prs.filter((x) => x.owner === owner && x.repo === repo);
    if (prs.length) events.push({ kind: 'opened', prs: prs.slice(0, 1) });
  } else if (/^mcp__.*__(update_pull_request|merge_pull_request)$/.test(tool)) {
    const n = Number(ti.pullNumber ?? ti.pull_number ?? ti.number);
    if (!owner || !repo || !n) return events;
    const ref = { owner, repo, number: n };
    if (/merge_pull_request$/.test(tool) || ti.state === 'closed') events.push({ kind: 'set', state: 'closed', ref });
    else if (ti.draft === false) events.push({ kind: 'set', state: 'ready', ref });
    else if (ti.draft === true) events.push({ kind: 'set', state: 'reviewing', ref });
  }
  return events;
}

/** Resolve a ref against tracked PRs. Returns a URL or null; never guesses. */
export function resolve(prs, ref, cwd) {
  if (!ref) return null;
  const all = Object.values(prs);
  if (ref.owner && ref.repo && ref.number) {
    const hit = all.filter((p) => p.url.endsWith(`/${ref.owner}/${ref.repo}/pull/${ref.number}`));
    return hit.length === 1 ? hit[0].url : null;
  }
  const r = String(ref.ref ?? '');
  const pr = parsePr(r);
  if (pr) return prs[pr.url] ? pr.url : null;
  const inRepo = (p) => !ref.repo || p.url.includes(`/${ref.repo}/pull/`);
  const num = r.match(/^#?(\d+)$/);
  if (num) {
    const hit = all.filter((p) => p.url.endsWith(`/pull/${Number(num[1])}`) && inRepo(p));
    return hit.length === 1 ? hit[0].url : null;
  }
  if (r === '') {
    // gh's "current branch" form: only when exactly one open PR was opened from this directory.
    const hit = all.filter((p) => BLOCKING.has(p.state) && p.cwd && cwd && p.cwd === cwd && inRepo(p));
    return hit.length === 1 ? hit[0].url : null;
  }
  return null; // branch names, $VARS and the like: can't tell which PR
}

// ---- hooks -----------------------------------------------------------------

function postToolUse(input, failed) {
  const id = safeId(input.session_id);
  if (!id) return null;
  const events = classify(input, failed);
  if (!events.length) return null;
  const prs = loadAll(id);
  const notes = [];
  for (const e of events) {
    if (e.kind === 'opened') {
      for (const p of e.prs) {
        if (prs[p.url]) continue;
        setState(id, prs, p.url, 'draft', { cwd: input.cwd ?? null });
        notes.push(`pr-workflow: tracking ${p.url} as draft. Run the review loop before ending the turn.`);
      }
      continue;
    }
    let url = e.url && prs[e.url] ? e.url : resolve(prs, e.ref, input.cwd);
    if (!url && e.marker && e.url && (e.state === 'draft' || e.state === 'reviewing')) {
      url = e.url; // explicitly start tracking a PR the hook didn't see being opened
    }
    if (!url) {
      if (e.marker) notes.push(`pr-workflow: ${e.url ?? e.ref?.ref} isn't tracked in this session, so nothing was recorded. Use the PR's full URL; to start tracking a PR, report it as draft or reviewing.`);
      continue;
    }
    if (e.state === 'waiting' && !e.reason) {
      notes.push('pr-workflow: waiting needs a reason, e.g. echo "pr-workflow: waiting <pr-url> user to pick an option". Nothing was recorded.');
      continue;
    }
    const prev = setState(id, prs, url, e.state, e.state === 'waiting' ? { reason: e.reason } : {});
    if (e.state === 'ready' && prev !== 'approved' && prev !== 'ready' && !e.marker) {
      notes.push(`pr-workflow: ${url} was marked ready without a recorded reviewer approval. If the independent review loop didn't run, convert it back to draft and run it.`);
    } else if (e.marker) {
      notes.push(`pr-workflow: recorded ${url} as ${e.state}.`);
    }
  }
  if (!notes.length || failed) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } };
}

function userPromptSubmit(input) {
  const id = safeId(input.session_id);
  if (!id) return;
  const prs = loadAll(id);
  for (const p of Object.values(prs)) if (p.state === 'waiting') setState(id, prs, p.url, 'reviewing');
}

function wakes(task) {
  if (!task || typeof task !== 'object') return false;
  const type = String(task.type ?? '');
  if (WAKING_TASKS.has(type) || type.startsWith('cloud session')) return true;
  return (type === 'shell' || type === 'local_bash') && CI_WATCH.test(String(task.command ?? ''));
}

export function stopDecision(input) {
  if (process.env.PR_WORKFLOW_DISABLE === '1') return null;
  if (input.stop_hook_active === true) return null; // already nudged once this turn; never loop
  if (Array.isArray(input.background_tasks) && input.background_tasks.some(wakes)) return null;
  if (Array.isArray(input.session_crons) && input.session_crons.some((c) => c && c.recurring === false)) return null;
  const id = safeId(input.session_id);
  if (!id) return null;
  pruneOld();
  const open = Object.values(loadAll(id)).filter((p) => BLOCKING.has(p.state));
  if (open.length === 0) return null;
  const list = open.map((p) => `- ${p.url} (${p.state})`).join('\n');
  return {
    decision: 'block',
    reason:
      `pr-workflow: the review loop isn't finished for PRs opened in this session:\n${list}\n\n` +
      `Finish it before ending the turn: have an independent reviewer subagent review the PR, fix what it finds, ` +
      `have it re-check, and once it approves, mark the PR ready. Report progress from the shell with ` +
      `echo "pr-workflow: <reviewing|approved|ready> <pr-url>". Ending the turn while a background reviewer or CI watch runs is fine.\n` +
      `If you're blocked on the user or something external, report it, then stop: ` +
      `echo "pr-workflow: waiting <pr-url> <what you're waiting on>". If the PR was merged, closed or handed off: ` +
      `echo "pr-workflow: closed <pr-url>".`,
  };
}

// ---- entry -----------------------------------------------------------------

function main() {
  const mode = process.argv[2];
  if (['post-tool-use', 'post-tool-use-failure', 'user-prompt-submit', 'stop'].includes(mode)) {
    try {
      const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
      let out = null;
      if (mode === 'post-tool-use') out = postToolUse(input, false);
      else if (mode === 'post-tool-use-failure') postToolUse(input, true);
      else if (mode === 'user-prompt-submit') userPromptSubmit(input);
      else out = stopDecision(input);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch {}
    return 0;
  }
  if (mode === 'status') {
    const id = safeId(process.argv[3]);
    if (!id) {
      console.error('pr-workflow: usage: status <session-id>');
      return 1;
    }
    const rows = Object.values(loadAll(id));
    console.log(rows.length ? rows.map((p) => `${p.state}\t${p.url}${p.reason ? `\t${p.reason}` : ''}`).join('\n') : 'no tracked PRs');
    return 0;
  }
  console.error('pr-workflow: modes: post-tool-use | post-tool-use-failure | user-prompt-submit | stop | status <session-id>');
  return 1;
}

function isEntry() {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.argv[1] && isEntry()) process.exitCode = main();
