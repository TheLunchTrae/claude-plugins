// Run: node --test tests/*.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, segments } from '../scripts/pr-workflow.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pr-workflow.mjs');
const SID = 'test-session-1';
const CWD = '/work/example';
const URL1 = 'https://github.com/lunchbox-labs/example/pull/12';
const URL2 = 'https://github.com/lunchbox-labs/example/pull/13';
let dataDir;

function run(args, stdin, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, PR_WORKFLOW_STATE_DIR: dataDir, PR_WORKFLOW_DISABLE: '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const hook = (mode, payload, env) => run([mode], typeof payload === 'string' ? payload : JSON.stringify(payload), env);
const stop = (extra = {}) => hook('stop', { session_id: SID, hook_event_name: 'Stop', stop_hook_active: false, ...extra });
const blocks = (extra) => {
  const r = stop(extra);
  return r.out !== '' && JSON.parse(r.out).decision === 'block';
};
const bash = (command, stdout = '', extra = {}) =>
  hook('post-tool-use', { session_id: SID, cwd: CWD, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '' }, ...extra });
const mark = (line) => bash(`echo "${line}"`, `${line}\n`);
const status = () => run(['status', SID]).out;
const stateOf = (url) => (status().split('\n').find((l) => l.includes(`\t${url}`)) || '').split('\t')[0];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prwf-'));
});

// ---- basics ----------------------------------------------------------------

test('stop allows when nothing is tracked', () => {
  const r = stop();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('gh pr create records a draft and stop blocks with the marker instructions', () => {
  bash('git push -u origin feat && gh pr create --draft --fill', `Creating pull request...\n${URL1}\n`);
  assert.equal(stateOf(URL1), 'draft');
  const out = JSON.parse(stop().out);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes(URL1));
  assert.ok(out.reason.includes('echo "pr-workflow: waiting <pr-url>'));
});

test('stop_hook_active always allows (no loops)', () => {
  bash('gh pr create --draft', URL1);
  assert.equal(stop({ stop_hook_active: true }).out, '');
});

test('reviewing and approved block; waiting, ready, closed allow', () => {
  bash('gh pr create --draft', URL1);
  for (const s of ['reviewing', 'approved']) {
    mark(`pr-workflow: ${s} ${URL1}`);
    assert.equal(stateOf(URL1), s);
    assert.ok(blocks());
  }
  mark(`pr-workflow: waiting ${URL1} user to pick an option`);
  assert.equal(stop().out, '');
  assert.match(status(), /waiting\t.*\tuser to pick an option/);
  for (const s of ['ready', 'closed']) {
    mark(`pr-workflow: ${s} ${URL1}`);
    assert.equal(stop().out, '');
  }
});

test('marker gets a confirmation in context; waiting without a reason is refused', () => {
  bash('gh pr create --draft', URL1);
  let r = mark(`pr-workflow: reviewing ${URL1}`);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /recorded .* as reviewing/);
  r = mark(`pr-workflow: waiting ${URL1}`);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /waiting needs a reason/);
  assert.equal(stateOf(URL1), 'reviewing');
});

test('marker only counts when the command itself prints it', () => {
  bash('gh pr create --draft', URL1);
  bash('cat notes.txt', `pr-workflow: ready ${URL1}\n`);
  assert.equal(stateOf(URL1), 'draft');
});

// ---- review finding 1: failed command after create -------------------------

test('PR created by a command that later fails is still tracked', () => {
  hook('post-tool-use-failure', {
    session_id: SID, cwd: CWD, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash',
    tool_input: { command: 'gh pr create --draft --fill && gh pr edit --add-label nope' },
    error: `Exit code 1\n${URL1}\ncould not add label: 'nope' not found`,
  });
  assert.equal(stateOf(URL1), 'draft');
});

test('failed gh pr ready changes nothing', () => {
  bash('gh pr create --draft', URL1);
  hook('post-tool-use-failure', { session_id: SID, cwd: CWD, tool_name: 'Bash', tool_input: { command: `gh pr ready ${URL1}` }, error: 'HTTP 403' });
  assert.equal(stateOf(URL1), 'draft');
});

// ---- review finding 2: waiting expires --------------------------------------

test('a new user prompt ends waiting', () => {
  bash('gh pr create --draft', URL1);
  mark(`pr-workflow: waiting ${URL1} user to choose`);
  assert.equal(stop().out, '');
  hook('user-prompt-submit', { session_id: SID, hook_event_name: 'UserPromptSubmit', prompt: 'option A' });
  assert.equal(stateOf(URL1), 'reviewing');
  assert.ok(blocks());
});

// ---- review finding 3: only waking background tasks allow -------------------

test('waking background tasks allow stopping; others do not', () => {
  bash('gh pr create --draft', URL1);
  for (const t of [{ type: 'subagent' }, { type: 'workflow' }, { type: 'cloud session' }, { type: 'shell', command: 'gh pr checks 12 --watch' }]) {
    assert.equal(stop({ background_tasks: [{ id: 'x', status: 'running', ...t }] }).out, '', JSON.stringify(t));
  }
  for (const t of [{ type: 'shell', command: 'pnpm dev' }, { type: 'dream' }, { type: 'auto-mode scan' }, { type: 'teammate' }, { type: 'monitor' }]) {
    assert.ok(blocks({ background_tasks: [{ id: 'x', status: 'running', ...t }] }), JSON.stringify(t));
  }
  assert.ok(blocks({ background_tasks: [] }));
});

test('a one-shot wakeup allows stopping; a recurring cron does not', () => {
  bash('gh pr create --draft', URL1);
  assert.equal(stop({ session_crons: [{ id: 'c', schedule: '5 7 8 11 *', recurring: false, prompt: 'check CI' }] }).out, '');
  assert.ok(blocks({ session_crons: [{ id: 'c', schedule: '*/30 * * * *', recurring: true, prompt: 'loop' }] }));
});

// ---- review finding 5: no guessing refs --------------------------------------

test('gh pr ready by URL, number, -R, or bare (same cwd) marks ready; --undo goes back', () => {
  bash('gh pr create --draft', URL1);
  bash(`gh pr ready ${URL1}`);
  assert.equal(stateOf(URL1), 'ready');
  bash('gh pr ready 12 --undo');
  assert.equal(stateOf(URL1), 'reviewing');
  bash('gh pr ready');
  assert.equal(stateOf(URL1), 'ready');
  bash('gh pr ready -R Lunchbox-Labs/Example "#12" --undo');
  assert.equal(stateOf(URL1), 'reviewing');
});

test('unresolvable refs are ignored, not guessed', () => {
  bash('gh pr create --draft', URL1);
  for (const cmd of ['gh pr ready feature-branch', 'gh pr ready "$PR_URL"', 'gh pr close 99', 'gh pr ready -R other/repo 12', 'gh pr close --comment "superseded by 14" feature']) {
    bash(cmd);
    assert.equal(stateOf(URL1), 'draft', cmd);
  }
  bash('gh pr ready', '', { cwd: '/work/other' });
  assert.equal(stateOf(URL1), 'draft', 'bare ready from another directory');
});

test('quoted flag values do not become the ref', () => {
  bash('gh pr create --draft', URL1);
  bash('gh pr close --comment "superseded by 14" 12');
  assert.equal(stateOf(URL1), 'closed');
});

test('bare gh pr ready is ignored when two PRs are open in the same directory', () => {
  bash('gh pr create --draft', URL1);
  bash('gh pr create --draft', URL2);
  bash('gh pr ready');
  assert.doesNotMatch(status(), /^ready/m);
});

test('two PRs created in one command are both tracked', () => {
  bash('gh pr create --draft -B main && git checkout b2 && gh pr create --draft', `${URL1}\n${URL2}\n`);
  assert.equal(stateOf(URL1), 'draft');
  assert.equal(stateOf(URL2), 'draft');
});

// ---- review finding 6: MCP picks html_url for the right repo ------------------

test('GitHub MCP create takes html_url, not a PR linked in the body', () => {
  const pr = { body: 'Stacked on https://github.com/lunchbox-labs/example/pull/4', url: 'https://api.github.com/repos/lunchbox-labs/example/pulls/5', html_url: 'https://github.com/lunchbox-labs/example/pull/5' };
  hook('post-tool-use', {
    session_id: SID, cwd: CWD, tool_name: 'mcp__github__create_pull_request',
    tool_input: { owner: 'lunchbox-labs', repo: 'example', draft: true },
    tool_response: [{ type: 'text', text: JSON.stringify(pr) }],
  });
  assert.match(status(), /^draft\thttps:\/\/github.com\/lunchbox-labs\/example\/pull\/5$/m);
  assert.doesNotMatch(status(), /pull\/4/);
  hook('post-tool-use', { session_id: SID, tool_name: 'mcp__github__update_pull_request', tool_input: { owner: 'lunchbox-labs', repo: 'example', pullNumber: 5, draft: false }, tool_response: 'ok' });
  assert.equal(stateOf('https://github.com/lunchbox-labs/example/pull/5'), 'ready');
});

// ---- review finding 7: canonical keys, no silent new entries -----------------

test('URL case differences map to the same PR; untracked markers are refused', () => {
  bash('gh pr create --draft', URL1);
  const r = mark('pr-workflow: ready https://github.com/Lunchbox-Labs/Example/pull/12');
  assert.equal(stateOf(URL1), 'ready');
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /recorded/);
  const r2 = mark('pr-workflow: approved https://github.com/lunchbox-labs/exmaple/pull/12');
  assert.match(JSON.parse(r2.out).hookSpecificOutput.additionalContext, /isn't tracked/);
  assert.equal(status().trim().split('\n').length, 1);
});

test('a PR the hook missed can be tracked explicitly as draft or reviewing', () => {
  mark(`pr-workflow: reviewing ${URL2}`);
  assert.equal(stateOf(URL2), 'reviewing');
  assert.ok(blocks());
});

// ---- cloud-session routes (GraphQL blocked) ----------------------------------

test('gh api create and ccr ready routes are tracked', () => {
  bash('gh api repos/lunchbox-labs/example/pulls -f title=x -f head=b -f base=main -F draft=true', JSON.stringify({ number: 12, html_url: URL1, body: 'see https://github.com/lunchbox-labs/example/pull/3' }));
  assert.equal(stateOf(URL1), 'draft');
  assert.equal(status().trim().split('\n').length, 1);
  let r = bash('gh api -X POST repos/lunchbox-labs/example/pulls/12/ccr/ready_for_review', '{}');
  assert.equal(stateOf(URL1), 'ready');
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /without a recorded reviewer approval/);
  bash('gh api -X POST repos/lunchbox-labs/example/pulls/12/ccr/convert_to_draft', '{}');
  assert.equal(stateOf(URL1), 'reviewing');
  mark(`pr-workflow: approved ${URL1}`);
  r = bash('gh api -X POST repos/lunchbox-labs/example/pulls/12/ccr/ready_for_review', '{}');
  assert.equal(stateOf(URL1), 'ready');
  assert.equal(r.out, '');
});

test('gh api GET of pulls does not record anything', () => {
  bash('gh api repos/lunchbox-labs/example/pulls', JSON.stringify([{ html_url: URL1 }]));
  assert.equal(status().trim(), 'no tracked PRs');
});

// ---- misc ------------------------------------------------------------------

test('PowerShell gh calls are tracked like Bash', () => {
  hook('post-tool-use', { session_id: SID, cwd: CWD, tool_name: 'PowerShell', tool_input: { command: 'gh pr create --draft --fill' }, tool_response: { stdout: `${URL1}\r\n` } });
  assert.equal(stateOf(URL1), 'draft');
});

test('failed gh pr create (no URL) and unrelated commands record nothing', () => {
  bash('gh pr create --draft', 'pull request create failed: GraphQL: something');
  bash('echo gh pr list', URL1);
  bash('git log', URL1);
  assert.equal(status().trim(), 'no tracked PRs');
});

test('PRs are scoped to their session', () => {
  bash('gh pr create --draft', URL1);
  assert.equal(hook('stop', { session_id: 'other-session', stop_hook_active: false }).out, '');
});

test('malformed or empty input fails open', () => {
  for (const mode of ['stop', 'post-tool-use', 'post-tool-use-failure', 'user-prompt-submit']) {
    for (const payload of ['', 'not json', '[]', 'null', '{"session_id": {"x":1}}', '42', '{"session_id":"a","tool_name":"Bash","tool_input":null}']) {
      const r = hook(mode, payload);
      assert.equal(r.code, 0, `${mode} ${payload}`);
      assert.equal(r.out, '', `${mode} ${payload}`);
    }
  }
});

test('corrupt state files are skipped', () => {
  bash('gh pr create --draft', URL1);
  fs.writeFileSync(path.join(dataDir, 'sessions', SID, 'junk.json'), '{oops');
  assert.ok(blocks());
});

test('unwritable state dir fails open in hooks', () => {
  const file = path.join(dataDir, 'blocker');
  fs.writeFileSync(file, '');
  const r = hook('post-tool-use', { session_id: SID, tool_name: 'Bash', tool_input: { command: 'gh pr create' }, tool_response: { stdout: URL1 } }, { PR_WORKFLOW_STATE_DIR: file });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(hook('stop', { session_id: SID }, { PR_WORKFLOW_STATE_DIR: file }).out, '');
});

test('session id is sanitized (no path traversal)', () => {
  hook('post-tool-use', { session_id: '../../evil', tool_name: 'Bash', tool_input: { command: 'gh pr create' }, tool_response: { stdout: URL1 } });
  assert.ok(fs.existsSync(path.join(dataDir, 'sessions', 'evil')));
  assert.ok(!fs.existsSync(path.join(dataDir, '..', 'evil')));
});

test('PR_WORKFLOW_DISABLE=1 allows stopping', () => {
  bash('gh pr create --draft', URL1);
  assert.ok(blocks());
  assert.equal(hook('stop', { session_id: SID }, { PR_WORKFLOW_DISABLE: '1' }).out, '');
});

test('segments splits on operators but not inside quotes', () => {
  assert.deepEqual(segments('a "b && c" && d \'e; f\'; g|h'), [['a', 'b && c'], ['d', 'e; f'], ['g'], ['h']]);
  assert.equal(classify({ tool_name: 'Bash', tool_input: { command: 'echo "gh pr ready 12"' }, tool_response: { stdout: '' } }).length, 0);
});

// ---- re-review findings ------------------------------------------------------

test('gh inside $(...) or backticks is detected, and gh pr new too', () => {
  bash('PR=$(gh pr create --draft --fill) && echo "$PR"', `${URL1}\n${URL1}\n`);
  assert.equal(stateOf(URL1), 'draft');
  bash('X=`gh pr new --draft`', `${URL2}\n`);
  assert.equal(stateOf(URL2), 'draft');
});

test('gh api create with --jq, and after a later failure', () => {
  bash('gh api repos/lunchbox-labs/example/pulls -f title=x -f head=b -f base=main -F draft=true --jq .html_url', `${URL1}\n`);
  assert.equal(stateOf(URL1), 'draft');
  hook('post-tool-use-failure', {
    session_id: SID, cwd: CWD, tool_name: 'Bash',
    tool_input: { command: 'gh api repos/lunchbox-labs/example/pulls -f title=y -f head=c -f base=main && false' },
    error: `Exit code 1\n${JSON.stringify({ number: 13, html_url: URL2, body: 'see https://github.com/lunchbox-labs/example/pull/3' })}`,
  });
  assert.equal(stateOf(URL2), 'draft');
  assert.doesNotMatch(status(), /pull\/3\b/);
});

test('MCP create accepts the minimal {id, url} response', () => {
  hook('post-tool-use', {
    session_id: SID, cwd: CWD, tool_name: 'mcp__github__create_pull_request',
    tool_input: { owner: 'lunchbox-labs', repo: 'example' },
    tool_response: [{ type: 'text', text: JSON.stringify({ id: '123', url: URL1 }) }],
  });
  assert.equal(stateOf(URL1), 'draft');
});

test('gh pr create only takes URLs alone on a line (not ones in a viewed body)', () => {
  bash('gh pr create --draft --fill && gh pr view', `${URL1}\ntitle:\tx\n--\nStacked on https://github.com/lunchbox-labs/example/pull/4\n`);
  assert.equal(stateOf(URL1), 'draft');
  assert.doesNotMatch(status(), /pull\/4\b/);
});

test('opening a PR confirms tracking in context', () => {
  const r = bash('gh pr create --draft', `${URL1}\n`);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /tracking .*pull\/12 as draft/);
  assert.equal(bash('gh pr create --draft', `${URL1}\n`).out, '', 'no repeat for an already tracked PR');
});

test('an existing PR reported by a failed gh pr create is not tracked', () => {
  hook('post-tool-use-failure', {
    session_id: SID, cwd: CWD, tool_name: 'Bash', tool_input: { command: 'gh pr create --draft --fill' },
    error: `Exit code 1\na pull request for branch "feat" into branch "main" already exists:\n${URL1}\n`,
  });
  assert.equal(status().trim(), 'no tracked PRs');
});
