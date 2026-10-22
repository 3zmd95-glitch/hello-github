const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eligible, handleStop } = require('./notify-codex.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-trigger-test-'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('discover-trigger-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'planning/collaboration'), { recursive: true });
  fs.writeFileSync(path.join(root, 'planning/collaboration/current-task.md'), 'Implementation owner: none.\nFrozen packet.');
  const config = { enabled: true, repoRoot: root, stateDir: path.join(root, 'receipts'),
    allowedCwds: [root], claudeSessionId: 'training-session', threadId: 'existing-chat' };
  const event = { hook_event_name: 'Stop', session_id: config.claudeSessionId, cwd: root,
    last_assistant_message: 'Ready.\n[CODEX_REVIEW_READY:packet-6]', background_tasks: [] };
  return { root, config, event };
}

test('only the authorized main session and exact completion marker can trigger', (t) => {
  const { config, event } = fixture(t);
  assert.equal(eligible(event, config), 'packet-6');
  for (const changes of [{ session_id: 'other' }, { agent_id: 'child' }, { cwd: os.tmpdir() },
    { hook_event_name: 'SubagentStop' }, { last_assistant_message: 'still implementing' },
    { last_assistant_message: '[CODEX_REVIEW_READY:../../elsewhere]' },
    { last_assistant_message: '[CODEX_REVIEW_READY:packet-6]\nStill working.' },
    { last_assistant_message: 'Example:\n```\n[CODEX_REVIEW_READY:packet-6]\n```' },
    { last_assistant_message: 'Example:\n```\n[CODEX_REVIEW_READY:packet-6]' },
    { last_assistant_message: '[CODEX_REVIEW_READY:a]\n[CODEX_REVIEW_READY:b]' }]) {
    assert.equal(eligible({ ...event, ...changes }, config), null);
  }
  assert.equal(eligible(event, { ...config, enabled: false }), null);
});

test('background work or implementation ownership prevents a premature review', (t) => {
  const { root, config, event } = fixture(t);
  assert.equal(eligible({ ...event, background_tasks: [{ status: 'running' }] }, config), null);
  assert.equal(eligible({ ...event, session_crons: [{ id: 'active' }] }, config), null);
  fs.writeFileSync(path.join(root, 'planning/collaboration/current-task.md'), 'Implementation owner: Opus.');
  assert.equal(handleStop(event, config, () => assert.fail('must not send')).status, 'not-frozen');
});

test('queues exactly once, hashes the evidence, and does not transmit arbitrary response text', (t) => {
  const { config, event } = fixture(t);
  let calls = 0;
  const dispatch = (_, message) => {
    calls++;
    assert.match(message, /packet-6/);
    assert.match(message, /Handoff SHA256: [a-f0-9]{64}/);
    assert.doesNotMatch(message, /Ready\./);
    return { status: 'queued', queueId: 'test-id' };
  };
  const first = handleStop(event, config, dispatch);
  assert.equal(first.status, 'queued');
  assert.equal(handleStop(event, config, dispatch).status, 'already-recorded');
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(first.receiptPath)).queueId, 'test-id');
});

test('a concurrent stop cannot dispatch the same packet twice', (t) => {
  const { config, event } = fixture(t);
  handleStop(event, config, () => {
    assert.equal(handleStop(event, config, () => assert.fail('duplicate')).status, 'in-flight');
    return { status: 'queued', queueId: 'one' };
  });
});

test('uncertain delivery is recorded and never silently retried', (t) => {
  const { config, event } = fixture(t);
  const result = handleStop(event, config, () => { throw new Error('timeout'); });
  assert.equal(result.status, 'unknown');
  assert.equal(handleStop(event, config, () => assert.fail('duplicate')).status, 'already-recorded');
});

test('probe asks for a receipt without starting another review', (t) => {
  const { config, event } = fixture(t);
  handleStop({ ...event, last_assistant_message: '[CODEX_REVIEW_READY:probe-test]' }, config, (_, message) => {
    assert.match(message, /not a code-review request/);
    assert.doesNotMatch(message, /Review only new code/);
    return { status: 'queued', queueId: 'probe' };
  });
});
