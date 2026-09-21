import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDivisi, staffingNote, collapseToSinglePlayer } from '../../src/arrange/divisi';

const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1, ...extra,
});
const part = (id: string, name: string, events: any[]) => ({
  part_id: id, name, instrument: 'violin', staves: 1,
  measures: [{ number: 1, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events }],
});
const voicesOf = (p: any) => p.measures[0].events.map((e: any) => `${e.midi}v${e.voice}${e.chord ? 'c' : ''}`);

// ── Dividing a section ──────────────────────────────────────────────────────

test('a line and the figure running over it become two voices, not one lost', () => {
  // Bar 112 of the reference: a four-beat chord tone with sixteenths above it.
  // One voice cannot hold both, and the export used to keep the held note.
  const p = part('P_V1', 'Violin I', [
    note(0, 4, 76),
    ...[0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((t) => note(t, 0.5, 74)),
  ]);
  const depth = applyDivisi([p]);
  assert.equal(depth.get('P_V1'), 2, 'two desks');
  const held = p.measures[0].events.find((e: any) => e.dur === 4);
  const figure = p.measures[0].events.filter((e: any) => e.dur === 0.5);
  assert.equal(held.voice, 1, 'the held note keeps the lower voice');
  assert(figure.every((e: any) => e.voice === 2), 'the figure gets its own voice');
  assert.equal(p.measures[0].events.length, 8, 'nothing dropped');
});

test('a chord stays one voice — same rhythm is a stack, not two lines', () => {
  const p = part('P_V2', 'Violin II', [note(0, 4, 60), note(0, 4, 64), note(0, 4, 67)]);
  assert.equal(applyDivisi([p]).get('P_V2'), 1);
  assert.deepEqual(voicesOf(p), ['60v1', '64v1c', '67v1c'], 'lowest first, the rest as chord additions');
});

test('notes that never overlap stay in one voice', () => {
  const p = part('P_VA', 'Viola', [note(0, 1, 60), note(1, 1, 62), note(2, 2, 64)]);
  assert.equal(applyDivisi([p]).get('P_VA'), 1);
  assert(p.measures[0].events.every((e: any) => e.voice === 1));
});

test('a third overlapping layer opens a third voice', () => {
  const p = part('P_V1', 'Violin I', [note(0, 4, 72), note(0, 2, 76), note(1, 1, 79)]);
  assert.equal(applyDivisi([p]).get('P_V1'), 3);
  assert.equal(new Set(p.measures[0].events.map((e: any) => e.voice)).size, 3);
});

test('the longest note at an onset claims the voice it will keep holding', () => {
  const p = part('P_V1', 'Violin I', [note(0, 1, 72), note(0, 4, 60), note(1, 1, 74)]);
  applyDivisi([p]);
  const held = p.measures[0].events.find((e: any) => e.midi === 60);
  const short = p.measures[0].events.find((e: any) => e.midi === 72);
  assert.notEqual(held.voice, short.voice, 'they sound together, so they are separate lines');
  assert.equal(p.measures[0].events.find((e: any) => e.midi === 74).voice, short.voice,
    'the later short note reuses the freed voice rather than opening a third');
});

test('the staffing line names only the sections that actually divide', () => {
  const a = part('P_V1', 'Violin I', [note(0, 4, 76), note(1, 1, 74)]);
  const b = part('P_VC', 'Cello', [note(0, 2, 48), note(2, 2, 50)]);
  const depth = applyDivisi([a, b]);
  const line = staffingNote([a, b], depth);
  assert.match(line, /2 Violin I/);
  assert(!/Cello/.test(line), 'an undivided section is not mentioned');
  assert.match(line, /not multiple stops/, 'a reader must not read the stack as a double stop');
});

test('no section dividing means no staffing line at all', () => {
  const p = part('P_VC', 'Cello', [note(0, 2, 48), note(2, 2, 50)]);
  assert.equal(staffingNote([p], applyDivisi([p])), '');
});

// ── Reducing a section back to one player ───────────────────────────────────

test('one player gets one line, however the stack was written', () => {
  // Three ways of writing a stack — an explicit chord, a second voice, and
  // bare simultaneous notes, which is what the choral path emits. A single
  // player can hold none of them.
  const p = part('P_FL', 'Flute', [
    note(0, 4, 60), note(0, 4, 64, { chord: true }),
    note(0, 4, 67, { voice: 2 }),
    note(0, 4, 72),
  ]);
  const dropped = collapseToSinglePlayer([p]);
  assert.equal(p.measures[0].events.length, 1);
  assert.equal(p.measures[0].events[0].midi, 72, 'an upper player keeps the top');
  assert.equal(dropped, 3);
});

test('a bottom voice keeps the bottom of the stack', () => {
  const p = part('P_BN', 'Bassoon', [note(0, 4, 48), note(0, 4, 55), note(0, 4, 60)]);
  collapseToSinglePlayer([p], () => 'bottom');
  assert.equal(p.measures[0].events[0].midi, 48);
});

test('what survives the reduction cannot still overlap', () => {
  const p = part('P_FL', 'Flute', [note(0, 4, 76), note(1, 1, 74), note(2, 1, 72)]);
  collapseToSinglePlayer([p]);
  const ns = p.measures[0].events.slice().sort((a: any, b: any) => a.t - b.t);
  for (let i = 0; i < ns.length - 1; i++)
    assert(Number(ns[i].t) + Number(ns[i].dur) <= Number(ns[i + 1].t) + 1e-9,
      `a note at ${ns[i].t} still overruns ${ns[i + 1].t}`);
});

test('a part that was already one line is left alone', () => {
  const p = part('P_FL', 'Flute', [note(0, 1, 60), note(1, 1, 62), note(2, 2, 64)]);
  assert.equal(collapseToSinglePlayer([p]), 0);
  assert.deepEqual(p.measures[0].events.map((e: any) => e.midi), [60, 62, 64]);
});

test('rests and other events survive the reduction', () => {
  const p = part('P_FL', 'Flute', [
    { id: 'r', t: 0, dur: 1, type: 'rest', voice: 1, staff: 1 },
    note(1, 1, 60), note(1, 1, 64),
  ]);
  collapseToSinglePlayer([p]);
  assert.equal(p.measures[0].events.filter((e: any) => e.type === 'rest').length, 1);
  assert.equal(p.measures[0].events.filter((e: any) => e.type === 'note').length, 1);
});
