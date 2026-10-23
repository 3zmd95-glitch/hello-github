// A completion event queues the existing Codex chat; it never starts a second reviewer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const canonical = (value) => path.resolve(value).replaceAll('\\', '/').toLowerCase();

function eligible(event, config) {
  if (!config.enabled || event.hook_event_name !== 'Stop' || event.agent_id) return null;
  if (event.session_id !== config.claudeSessionId) return null;
  if (!config.allowedCwds.some((cwd) => canonical(cwd) === canonical(event.cwd || '.'))) return null;
  if ((event.background_tasks || []).length || (event.session_crons || []).length) return null;
  const message = String(event.last_assistant_message || '').trimEnd();
  const finalLine = message.split(/\r?\n/).at(-1);
  if (!/^\[CODEX_REVIEW_READY:[a-zA-Z0-9._-]{1,80}\]$/.test(finalLine)) return null;
  // A marker discussed inside an example is not a completion signal.
  if ((message.match(/^\s*(?:```|~~~)/gm) || []).length % 2) return null;
  const matches = [...message.matchAll(/^\[CODEX_REVIEW_READY:([a-zA-Z0-9._-]{1,80})\]\s*$/gm)];
  return matches.length === 1 ? matches[0][1] : null;
}

function queue(config, message) {
  const result = spawnSync(config.codexPath, ['queue', '--thread', config.threadId, '--message', message], {
    cwd: config.repoRoot, encoding: 'utf8', timeout: 15000, windowsHide: true,
    shell: false, maxBuffer: 65536,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/Queued message ([0-9a-f-]+) for thread ([0-9a-f-]+)/i);
  if (!result.error && result.status === 0 && match?.[2] === config.threadId) {
    return { status: 'queued', queueId: match[1] };
  }
  // An ambiguous outcome must not be resent automatically.
  return { status: result.error?.code === 'ENOENT' ? 'failed' : 'unknown',
    error: result.error?.message || output.trim().slice(0, 1500) || `exit ${result.status}` };
}

function handleStop(event, config, dispatch = queue) {
  const packetId = eligible(event, config);
  if (!packetId) return { status: 'skipped' };
  const taskPath = path.join(config.repoRoot, 'planning/collaboration/current-task.md');
  const task = fs.readFileSync(taskPath, 'utf8');
  if (!/^Implementation owner:\s*none\.?\s*$/mi.test(task)) return { status: 'not-frozen' };
  fs.mkdirSync(config.stateDir, { recursive: true });
  const receiptPath = path.join(config.stateDir, `${packetId}.json`);
  const lockPath = path.join(config.stateDir, `${packetId}.lock`);
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'in-flight' }; throw error; }
  try {
    if (fs.existsSync(receiptPath)) return { status: 'already-recorded', receiptPath };
    const receipt = { packetId, claudeSessionId: event.session_id, threadId: config.threadId,
      taskSha256: sha256(task), createdAt: new Date().toISOString(), status: 'dispatching' };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    const probe = packetId.startsWith('probe-');
    const message = probe
      ? `Claude completion-trigger test ${packetId}. This is a user-authorized transport check, not a code-review request. Read ${receiptPath} and record receivedAt in that receipt to confirm this chat received it. Do not audit code, run tests, message Claude or launch another task. Keep the user response minimal.`
      : `Claude Training Page finished frozen review packet ${packetId}. The user authorized immediate completion-triggered review in this existing chat. Read ${taskPath} and planning/collaboration/codex-review.md in ${config.repoRoot}. Handoff SHA256: ${receipt.taskSha256}. Record receivedAt in ${receiptPath}. Check current ownership and fingerprints before reviewing; if the handoff changed or work resumed, record that instead of reviewing moving code. Review only new code/evidence, use focused checks, distinguish live Chrome from mocked tests, and return the outcome plus the next bounded authorized task to Training Page. Record delivery once. No duplicate reviewers, product edits, paid usage, push, merge or deployment. This event replaces timer polling.`;
    let outcome;
    try { outcome = dispatch(config, message); }
    catch (error) { outcome = { status: 'unknown', error: error.message }; }
    Object.assign(receipt, outcome);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    return { ...outcome, receiptPath };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) {
  try {
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const input = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Stop event exceeds 1 MiB');
    const result = handleStop(JSON.parse(input), config);
    if (['unknown', 'failed'].includes(result.status)) {
      process.stdout.write(JSON.stringify({ systemMessage: `Discover review trigger ${result.status}; see ${result.receiptPath}. No automatic resend or approval is implied.` }));
    }
  } catch (error) {
    process.stderr.write(`Discover review trigger: ${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { eligible, handleStop, sha256 };
