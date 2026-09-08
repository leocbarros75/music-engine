import assert from 'node:assert/strict';
import { runJobs } from '../run-tests.mjs';
const messages: string[] = [];
const log = (value: string) => messages.push(value);
assert.equal(runJobs([{ name: 'success', args: ['-e', 'process.exit(0)'] }], { log }), 0);
assert.equal(runJobs([
  { name: 'intentional failure', args: ['-e', 'throw Error("sentinel failure")'] },
  { name: 'after failure', args: ['-e', 'process.exit(0)'] }
], { log }), 1);
assert(messages.some(m => m.includes('sentinel failure')));
assert(messages.includes('PASS after failure'), 'A failure must not hide later suites');
assert.equal(runJobs([{ name: 'timeout', args: ['-e', 'setInterval(() => {}, 1000)'] }], { log, timeout: 200 }), 1);
assert(messages.some(m => m.includes('ETIMEDOUT')));
console.log('Runner checks passed: success, failure details, continuation, timeout.');

import { test } from 'node:test';
import { checkHarmonyResponse } from '../harmony/httpSmoke.mjs';
test('HTTP smoke checks reject HTTP errors, invalid JSON, engine failures and empty analysis', async () => {
  await assert.rejects(checkHarmonyResponse(new Response('unavailable', { status: 503 }), 'beat'), /503/);
  await assert.rejects(checkHarmonyResponse(new Response('<html>error</html>'), 'beat'), /JSON/);
  await assert.rejects(checkHarmonyResponse(Response.json({ ok: false }), 'beat'), /ok:true/);
  await assert.rejects(checkHarmonyResponse(Response.json({ ok: true, beats: [] }), 'beat'), /no analysis/);
  await assert.rejects(checkHarmonyResponse(Response.json({ ok: true, beats: [{}] }), 'measure'), /no analysis/);
  assert.equal((await checkHarmonyResponse(Response.json({ ok: true, beats: [{}] }), 'beat')).ok, true);
  assert.equal((await checkHarmonyResponse(Response.json({ ok: true, measures: [{}] }), 'measure')).ok, true);
});
