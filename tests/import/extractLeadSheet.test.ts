import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMidiFile } from '../../src/import/midiFile.ts';
import { extractLeadSheet } from '../../src/import/extractLeadSheet.ts';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser.ts';
import { pipelineMusicxmlToArrangedMusicxml } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts';

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }

const PPQ = 480;
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const vlq = (v: number) => {
  const out = [v & 0x7f];
  for (v >>>= 7; v > 0; v >>>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const trk = (b: number[]) => [0x4d, 0x54, 0x72, 0x6b, ...u32(b.length + 4), ...b, 0, 0xff, 0x2f, 0];
const smf = (bodies: number[][]) =>
  new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(bodies.length), ...u16(PPQ), ...bodies.flatMap(trk)]);
function notesTrack(specs: Array<{ at: number; dur: number; midi: number }>, prefix: number[] = []): number[] {
  const evs: Array<{ tick: number; d: number[] }> = [];
  for (const s of specs) {
    evs.push({ tick: s.at, d: [0x90, s.midi, 100] });
    evs.push({ tick: s.at + s.dur, d: [0x80, s.midi, 0] });
  }
  evs.sort((a, b) => a.tick - b.tick);
  const out = [...prefix];
  let t = 0;
  for (const e of evs) { out.push(...vlq(e.tick - t), ...e.d); t = e.tick; }
  return out;
}
const timeSig = [0, 0xff, 0x58, 4, 4, 2, 24, 8];
const keySig = (f: number) => [0, 0xff, 0x59, 2, f & 0xff, 0];

/** A tune over block chords: melody on top, triad beneath, bass below. */
function tuneOverChords(tune: number[], roots: number[]): number[] {
  const specs: Array<{ at: number; dur: number; midi: number }> = [];
  tune.forEach((m, i) => specs.push({ at: i * PPQ, dur: PPQ, midi: m }));
  roots.forEach((r, bar) => {
    for (const offset of [0, 4, 7]) specs.push({ at: bar * 4 * PPQ, dur: 4 * PPQ, midi: r + 12 + offset });
    specs.push({ at: bar * 4 * PPQ, dur: 4 * PPQ, midi: r });
  });
  return notesTrack(specs, [...timeSig, ...keySig(2)]);
}

test('the melody comes out monophonic', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  const bars: any[] = ls.score.parts[0]!.measures as any;
  assert.equal(ls.score.parts.length, 1);
  assert.equal(ls.score.parts[0]!.name, 'Melody');
  for (const m of bars) {
    const perOnset = new Map<number, number>();
    for (const e of m.events) perOnset.set(e.t, (perOnset.get(e.t) ?? 0) + 1);
    for (const [t, n] of perOnset) assert.equal(n, 1, `bar ${m.number} beat ${t} has ${n} notes`);
  }
});

test('the melody is the tune, not the bass under it', () => {
  const tune = [74, 76, 78, 76, 74, 71, 69, 71];
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(tune, [38, 45])])));
  const midis = (ls.score.parts[0]!.measures as any[]).flatMap(m => m.events.map((e: any) => e.midi));
  assert.ok(midis.every(m => m >= 60), `no melody note may come from the bass: ${midis.filter(m => m < 60)}`);
  assert.ok(midis.includes(78), 'the top of the tune is present');
});

test('one note per attack point, and nothing overlaps', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  for (const m of (ls.score.parts[0]!.measures as any[])) {
    const s = [...m.events].sort((a: any, b: any) => a.t - b.t);
    for (let i = 1; i < s.length; i++)
      assert.ok(s[i]!.t >= s[i - 1]!.t + s[i - 1]!.dur - 1e-9, `overlap in bar ${m.number}`);
    for (const e of s) assert.ok(e.dur > 0, 'no zero-length melody note');
  }
});

test('an accompaniment with no tune in it is declined, not invented', () => {
  // A wide broken-chord figure leaping around the keyboard: the top line of this
  // is not a melody, and saying so is more useful than handing over nonsense.
  const specs: Array<{ at: number; dur: number; midi: number }> = [];
  const shape = [36, 72, 43, 79, 40, 76, 47, 83];
  for (let bar = 0; bar < 4; bar++)
    shape.forEach((m, i) => specs.push({ at: bar * 4 * PPQ + i * (PPQ / 2), dur: PPQ / 2, midi: m }));
  const ls = extractLeadSheet(parseMidiFile(smf([notesTrack(specs, [...timeSig])])));
  assert.equal(ls.confidence.hasMelody, false);
  assert.match(ls.confidence.reason, /accompaniment|does not look like a melody/i);
  assert.match(ls.warnings.join(' '), /accompaniment|does not look like a melody/i);
});

test('a real tune is accepted, with its measurements reported', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  assert.equal(ls.confidence.hasMelody, true);
  assert.ok(ls.confidence.range <= 26, 'a singable range');
  assert.ok(ls.confidence.stepwise >= 0.3, 'mostly stepwise');
  assert.equal(ls.confidence.bigLeaps, 0);
});

test('a short release gap is absorbed into the note, a real rest is kept', () => {
  // A performance lifts each finger slightly early. Printing every one of those as
  // a short rest is what makes a transcription unreadable — but a genuine silence
  // is phrasing and must survive.
  const specs = [
    // Released early enough that quantization does not already absorb it: a
    // sixteenth of silence before the next attack, which prints as a rest.
    { at: 0, dur: PPQ - 180, midi: 74 },
    { at: PPQ, dur: PPQ - 180, midi: 76 },
    { at: 2 * PPQ, dur: PPQ - 180, midi: 78 },
    { at: 3 * PPQ, dur: PPQ - 180, midi: 76 },
    { at: 6 * PPQ, dur: PPQ, midi: 74 }          // after a two-beat silence
  ];
  for (const bar of [0, 1]) {
    for (const offset of [0, 4, 7]) specs.push({ at: bar * 4 * PPQ, dur: 4 * PPQ, midi: 50 + offset });
  }
  const f = parseMidiFile(smf([notesTrack(specs, [...timeSig, ...keySig(2)])]));

  const tight = extractLeadSheet(f, { closeGaps: 0 });
  const eased = extractLeadSheet(f, { closeGaps: 0.5 });
  const rests = (x: string) => (x.match(/<note>\s*<rest\s*\/?>/g) ?? []).length;
  assert.ok(rests(eased.musicxml) < rests(tight.musicxml),
    `closing gaps must remove rests (${rests(tight.musicxml)} -> ${rests(eased.musicxml)})`);

  const notesOf = (ls: any) => (ls.score.parts[0].measures as any[]).flatMap(m => m.events);
  assert.equal(notesOf(eased).length, notesOf(tight).length, 'no note may be swallowed');

  // The two-beat silence is phrasing: it must still be there.
  assert.ok(rests(eased.musicxml) > 0, 'a real rest survives');
  const first: any = notesOf(eased)[0];
  assert.equal(first.dur, 1, 'the early release is rounded up to a full beat');
});

test('legato groups are slurred, and the slurs are balanced and sane', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  assert.ok(ls.slurs > 0, 'a flowing melody gets slurs');
  const starts = (ls.musicxml.match(/<slur type="start"/g) ?? []).length;
  const stops = (ls.musicxml.match(/<slur type="stop"/g) ?? []).length;
  assert.equal(starts, stops, 'every slur that opens must close');
  assert.equal(starts, ls.slurs);

  // No slur may span a single note, and none may run away across the piece.
  const line: any[] = [];
  (ls.score.parts[0]!.measures as any[]).forEach((m, i) => m.events.forEach((e: any) => line.push({ ...e, bar: i })));
  let open: any = null;
  for (const e of line) {
    if (e.slurStart) { assert.equal(open, null, 'slurs must not nest'); open = e; }
    if (e.slurStop) {
      assert.ok(open, 'a slur closed without opening');
      assert.ok(e.bar - open.bar <= 2, `a slur ran ${e.bar - open.bar + 1} bars`);
      open = null;
    }
  }
  assert.equal(open, null, 'a slur was left open at the end');
});

test('slurs can be turned off', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])), { slurs: false });
  assert.equal(ls.slurs, 0);
  assert.equal((ls.musicxml.match(/<slur /g) ?? []).length, 0);
});

test('the arrangers carry the slurs through', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: ls.musicxml, chords: ls.chords as any,
    settings: { ensemble: 'piano_with_melody', textureMode: 'homophony_melody_accompaniment' }
  });
  assert.ok(r?.musicxml);
  const starts = (r.musicxml.match(/<slur type="start"/g) ?? []).length;
  const stops = (r.musicxml.match(/<slur type="stop"/g) ?? []).length;
  assert.ok(starts > 0, 'slurs survive into the arrangement');
  assert.equal(starts, stops);
});

test('silent bars get no chord', () => {
  // Two bars of music, then two of silence, then one more.
  const specs: Array<{ at: number; dur: number; midi: number }> = [];
  for (const bar of [0, 1, 4]) {
    for (const offset of [0, 4, 7]) specs.push({ at: bar * 4 * PPQ, dur: 4 * PPQ, midi: 62 + offset });
    specs.push({ at: bar * 4 * PPQ, dur: 4 * PPQ, midi: 38 });
  }
  const ls = extractLeadSheet(parseMidiFile(smf([notesTrack(specs, [...timeSig, ...keySig(2)])])));
  const sounding = new Set((ls.score.parts[0]!.measures as any[]).filter(m => m.events.length).map(m => Number(m.number)));
  for (const c of ls.chords)
    assert.ok(sounding.has(Number(c.measure)), `bar ${c.measure} is silent but was given the chord ${c.symbol}`);
  assert.ok(ls.chords.length > 0, 'the sounding bars still get chords');
});

test('the lead sheet drives the existing arrangers, melody intact', () => {
  const tune = [74, 76, 78, 76, 74, 71, 69, 71];
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(tune, [38, 45])])));
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: ls.musicxml,
    chords: ls.chords as any,
    settings: { ensemble: 'piano_with_melody', textureMode: 'homophony_melody_accompaniment' }
  });
  assert.ok(r?.musicxml, `the pipeline must accept a lead sheet: ${String(r?.error).slice(0, 120)}`);
  const out: any = parseMusicXMLToScoreModel(r.musicxml);
  const melody = out.parts.find((p: any) => /melody/i.test(p.name));
  assert.ok(melody, 'the arrangement keeps a melody part');
  // The bug this whole module exists to fix: the melody staff carrying the
  // entire polyphonic texture, bass notes and all.
  for (const m of melody.measures) {
    const perOnset = new Map<number, number>();
    for (const e of m.events) if (e.type === 'note') perOnset.set(e.t, (perOnset.get(e.t) ?? 0) + 1);
    for (const [, n] of perOnset) assert.equal(n, 1, 'the arranged melody stays monophonic');
  }
  assert.ok(out.parts.length >= 2, 'and an accompaniment was written under it');
});

test('every ensemble accepts a lead sheet built from MIDI', () => {
  const ls = extractLeadSheet(parseMidiFile(smf([tuneOverChords(
    [74, 76, 78, 76, 74, 71, 69, 71], [38, 45]
  )])));
  for (const ensemble of ['piano_with_melody', 'choral', 'orchestra']) {
    const r: any = pipelineMusicxmlToArrangedMusicxml({
      musicxml: ls.musicxml, chords: ls.chords as any,
      settings: { ensemble, textureMode: 'homophony_melody_accompaniment' }
    });
    assert.ok(r?.musicxml, `${ensemble} produced no output: ${String(r?.error).slice(0, 90)}`);
  }
});

// Real files, when supplied.
for (const [label, envVar] of [['Dorico piano export', 'MIDI_TEST_PATH'], ['second MIDI', 'MIDI_TEST_PATH_2']] as const) {
  const path = process.env[envVar];
  if (!path || !fs.existsSync(path)) continue;
  test(`extracts a usable lead sheet from a real ${label}`, () => {
    const ls = extractLeadSheet(parseMidiFile(new Uint8Array(fs.readFileSync(path))));
    assert.ok(ls.chords.length > 0, 'chords were inferred');
    for (const m of (ls.score.parts[0]!.measures as any[])) {
      const perOnset = new Map<number, number>();
      for (const e of m.events) perOnset.set(e.t, (perOnset.get(e.t) ?? 0) + 1);
      for (const [, n] of perOnset) assert.equal(n, 1, 'monophonic');
    }
    const r: any = pipelineMusicxmlToArrangedMusicxml({
      musicxml: ls.musicxml, chords: ls.chords as any,
      settings: { ensemble: 'piano_with_melody', textureMode: 'homophony_melody_accompaniment' }
    });
    assert.ok(r?.musicxml, `the arrangers must accept it: ${String(r?.error).slice(0, 120)}`);
  });
}

console.log(`\n${passed} assertions passed.`);
