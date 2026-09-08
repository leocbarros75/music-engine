import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { inspectPhrases, defaultPhrasePlan, validatePhrasePlan, applyPhrasePlan } from '../../src/ai/phrasePlan';
import { proposePhrasePlan } from '../../src/ai/proposePhrasePlan';
import { generateArrangement } from '../../src/app/generateArrangement';
import { snapshotPartXml, compareSnapshots } from '../../src/preservation/sourcePreservation';
import { exportMidi } from '../../src/score/midi';
import { buildPerformance } from '../../src/score/performance';
import { server } from '../../src/server';
const xml = readFileSync(new URL('../preservation/fixtures/holy-holy-holy.musicxml', import.meta.url), 'utf8');
const settings = { ensemble: 'string_ensemble', preserveSource: true, style: 'worship' };
const context = inspectPhrases(xml, settings);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('inspection reports actual score notes, chords, meter and complete ordered phrase coverage', () => {
  assert.equal(context.bars.length, 16);
  assert.equal(context.bars.flatMap(b => b.melody).filter(n => n.midi !== null).length, 45);
  assert.equal(context.bars.reduce((n, b) => n + b.chords.length, 0), 33);
  assert.equal(context.bars[0].key.fifths, 2);
  assert.deepEqual(context.bars[0].meter, { beats: 4, beat_type: 4 });
  let next = 1;
  for (const p of context.phrases) { assert.equal(p.startBar, next); assert(p.endBar >= p.startBar); next = p.endBar + 1; }
  assert.equal(next, 17);
  assert.equal(validatePhrasePlan(defaultPhrasePlan(context), context).version, 1);
});
test('no preservation opt-out or unsupported ensemble can enter phrase collaboration', () => {
  assert.throws(() => inspectPhrases(xml, { ...settings, preserveSource: false }), /requires/);
  assert.throws(() => inspectPhrases(xml, { ...settings, ensemble: 'piano' }), /requires/);
});
for (const [name, change] of Object.entries({
  'extra notes': (p: any) => p.notes = [],
  'source melody edit': (p: any) => p.phrases[0].activeParts.push('violin1'),
  'missing cello': (p: any) => p.phrases[0].activeParts = ['viola'],
  'duplicate parts': (p: any) => p.phrases[0].activeParts.push('cello'),
  'loud unsupported dynamic': (p: any) => p.phrases[0].dynamic = 'fff',
  'missing phrase': (p: any) => p.phrases.pop(),
  'overlap': (p: any) => p.phrases[0].endBar++,
  'wrong version': (p: any) => p.version = 2,
  'stale source': (p: any) => p.sourceFingerprint = 'old',
  'oversized reason': (p: any) => p.phrases[0].reason = 'x'.repeat(501)
})) test(`invalid proposal rejected: ${name}`, () => {
  const plan = defaultPhrasePlan(context); change(plan); assert.throws(() => validatePhrasePlan(plan, context));
});
test('changed score or settings invalidates a previously reviewed plan', () => {
  const plan = defaultPhrasePlan(context);
  assert.throws(() => validatePhrasePlan(plan, inspectPhrases(xml.replace('Holy', 'Changed'), settings)), /stale/);
  assert.throws(() => validatePhrasePlan(plan, inspectPhrases(xml, { ...settings, style: 'classical' })), /stale/);
});
test('AI receives the inspected context and returns a validated proposal without applying it', async () => {
  const plan = defaultPhrasePlan(context); plan.phrases[0].dynamic = 'p'; plan.phrases[0].activeParts = ['cello'];
  const proposed = await proposePhrasePlan(context, 'A gentle opening', async (system, input) => {
    assert(system.includes('untrusted')); const data = JSON.parse(input);
    assert.equal(data.context.sourceFingerprint, context.sourceFingerprint);
    assert.equal(data.context.bars.length, 16); return JSON.stringify(plan);
  });
  assert.deepEqual(proposed, plan);
  assert.equal(defaultPhrasePlan(context).phrases[0].dynamic, 'mp');
});
test('malformed and hostile AI responses fail without changing the score', async () => {
  await assert.rejects(proposePhrasePlan(context, 'soft', async () => 'not JSON'), /invalid JSON/);
  await assert.rejects(proposePhrasePlan(context, 'soft', async () => JSON.stringify({ ...defaultPhrasePlan(context), preserveSource: false })), /unsupported fields/);
  await assert.rejects(proposePhrasePlan(context, '', async () => { throw Error('must not call'); }), /musical brief/);
});
test('planned entrances change accompaniment while all source notes/chords/notation and MIDI parity survive', () => {
  const plan = defaultPhrasePlan(context);
  plan.phrases[0].activeParts = ['cello']; plan.phrases[0].dynamic = 'p';
  plan.phrases.at(-1)!.dynamic = 'mf';
  const before = copy(plan);
  const result = generateArrangement({ musicxml: xml, settings, phrasePlan: plan });
  assert(result.ok, !result.ok ? result.error : '');
  assert.equal(result.meta.phraseCollaboration?.status, 'applied');
  assert.equal(result.meta.preservation?.status, 'verified');
  assert.equal(result.meta.performance?.status, 'ready');
  assert.deepEqual(compareSnapshots(snapshotPartXml(xml, 'P1'), snapshotPartXml(result.musicxml, result.meta.preservation!.targetPartId!)), []);
  const model: any = result.scoreModel;
  for (const name of ['Violin II', 'Viola', 'Double Bass']) {
    const part = model.parts.find((p: any) => p.name === name); assert(part);
    for (let i = 0; i < plan.phrases[0].endBar; i++) assert(part.measures[i].events.every((e: any) => e.type === 'rest'));
  }
  const celloIndex = model.parts.findIndex((p: any) => p.name === 'Cello');
  const performance = buildPerformance(model);
  assert(performance.notes.some(n => n.partIdx === celloIndex && n.velocity === 49));
  assert.deepEqual(Buffer.from(result.midiBase64!, 'base64'), Buffer.from(exportMidi(model)));
  assert.deepEqual(plan, before);
});
test('generation rejects a stale plan instead of silently falling back to ordinary arranging', () => {
  const result = generateArrangement({ musicxml: xml, settings: { ...settings, style: 'classical' }, phrasePlan: defaultPhrasePlan(context) });
  assert.equal(result.ok, false);
  assert.match((result as any).error, /stale/);
});
test('muting a bar removes disconnected ties without changing the protected source', () => {
  const note = (start: boolean, stop: boolean) => ({ id: 'n', type: 'note', t: 0, dur: 4, pitch: { step: 'C', octave: 4 }, voice: 1, staff: 1, tieStart: start, tieStop: stop });
  const measures = [note(true, false), note(true, true), note(false, true)].map((e, i) => ({ number: i + 1, attributes: { time: { beats: 4, beat_type: 4 } }, events: [e] }));
  const score: any = { meta: { ensemble: 'string_ensemble' }, global: { divisions: 1 }, parts: [
    { part_id: 'source', name: 'Violin I', measures: copy(measures) }, { part_id: 'inner', name: 'Viola', measures: copy(measures) } ] };
  const source = copy(score.parts[0]);
  applyPhrasePlan(score, { version: 1, sourceFingerprint: 'test', phrases: [1,2,3].map(i => ({ id: `p${i}`, startBar: i, endBar: i, dynamic: 'mp', activeParts: i === 2 ? ['cello'] : ['cello', 'viola'], reason: '' })) }, 'source');
  assert.deepEqual(score.parts[0], source);
  assert.equal(score.parts[1].measures[0].events[0].tieStart, false);
  assert.equal(score.parts[1].measures[1].events[0].type, 'rest');
  assert.equal(score.parts[1].measures[2].events[0].tieStop, false);
});
test('phrase inspection HTTP endpoint works offline and validates imported plans', async () => {
  async function request(phrasePlan?: any) {
    return new Promise<any>((resolve, reject) => {
      const req: any = new PassThrough(); Object.assign(req, { url: '/phrase_context', method: 'POST', headers: {}, socket: { remoteAddress: 'phrase-tests' } });
      let status = 0; const res: any = { writeHead: (n: number) => status = n, end: (s: string) => { try { resolve({ status, ...JSON.parse(s) }); } catch (e) { reject(e); } } };
      server.emit('request', req, res); req.end(JSON.stringify({ musicxml: xml, settings, phrasePlan }));
    });
  }
  const inspected = await request(); assert.equal(inspected.status, 200); assert.equal(inspected.aiUsed, false);
  const bad = await request({ ...inspected.plan, sourceFingerprint: 'wrong' }); assert.equal(bad.status, 400);
  const valid = await request(inspected.plan); assert.equal(valid.status, 200);
});
