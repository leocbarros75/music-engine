import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMidiFile } from '../../src/import/midiFile.ts';
import { transcribeMidiToScore } from '../../src/import/midiTranscribe.ts';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter.ts';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser.ts';

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
const trk = (body: number[]) => [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length + 4), ...body, 0, 0xff, 0x2f, 0];
const smf = (bodies: number[][]) =>
  new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(bodies.length), ...u16(PPQ), ...bodies.flatMap(trk)]);

/** Build one track from absolute-tick note specs. */
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
const timeSig = (beats: number, pow: number) => [0, 0xff, 0x58, 4, beats, pow, 24, 8];
const keySig = (fifths: number, minor = 0) => [0, 0xff, 0x59, 2, fifths & 0xff, minor];

test('a slightly early or late note is snapped to the grid', () => {
  const s = PPQ / 4; // one sixteenth
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: s }, { at: s - 9, dur: s }, { at: 2 * s + 7, dur: s }
  ].map((x, i) => ({ ...x, midi: 60 + i })))]));
  const { score } = transcribeMidiToScore(f, { grid: 16 });
  const events = (score.parts[0]!.measures[0] as any).events;
  assert.deepEqual(events.map((e: any) => e.t), [0, 0.25, 0.5], 'onsets land on the sixteenth grid');
});

test('a short first time signature is read as a pickup, not a bar in its own meter', () => {
  const f = parseMidiFile(smf([
    [...timeSig(1, 2), ...vlq(PPQ), 0xff, 0x58, 4, 4, 2, 24, 8],
    notesTrack([{ at: 0, dur: PPQ, midi: 60 }, { at: PPQ, dur: PPQ, midi: 62 }])
  ]));
  const { score, report } = transcribeMidiToScore(f);
  assert.equal(report.pickup, true);
  const first: any = score.parts[0]!.measures[0];
  assert.equal(first.implicit, true, 'the pickup is an incomplete bar');
  assert.equal(first.durationBeats, 1);
  assert.equal(first.attributes.time.beats, 4, 'it is written in the prevailing meter, not 1/4');
  assert.equal(first.number, 0);
  assert.equal((score.parts[0]!.measures[1] as any).number, 1);
});

test('a chord is split between the hands at its widest interior gap', () => {
  // D#1 + D#2 far below, then a close F#3/B3/D#4 voicing: the octave is the left hand
  // even though F#3 sits below the nominal middle-C split point.
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack(
    [27, 39, 54, 59, 63].map(m => ({ at: 0, dur: PPQ, midi: m }))
  )]));
  const { score, report } = transcribeMidiToScore(f, { handSplit: 60 });
  const events = (score.parts[0]!.measures[0] as any).events;
  const rh = events.filter((e: any) => e.staff === 1).map((e: any) => e.midi).sort((a: number, b: number) => a - b);
  const lh = events.filter((e: any) => e.staff === 2).map((e: any) => e.midi).sort((a: number, b: number) => a - b);
  assert.deepEqual(lh, [27, 39]);
  assert.deepEqual(rh, [54, 59, 63]);
  assert.equal(report.leftHandNotes, 2);
});

test('spelling follows the key signature', () => {
  const sharp = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(5)], notesTrack([{ at: 0, dur: PPQ, midi: 63 }])]));
  const a: any = (transcribeMidiToScore(sharp).score.parts[0]!.measures[0] as any).events[0];
  assert.deepEqual([a.pitch.step, a.pitch.alter], ['D', 1], 'B major writes D sharp');

  const flat = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(-4)], notesTrack([{ at: 0, dur: PPQ, midi: 63 }])]));
  const b: any = (transcribeMidiToScore(flat).score.parts[0]!.measures[0] as any).events[0];
  assert.deepEqual([b.pitch.step, b.pitch.alter], ['E', -1], 'A flat major writes E flat');
});

test('the octave follows the letter, not the pitch class', () => {
  // In C sharp major (7 sharps) MIDI 60 is B sharp — and B sharp 3, not C 4.
  const f = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(7)], notesTrack([{ at: 0, dur: PPQ, midi: 60 }])]));
  const e: any = (transcribeMidiToScore(f).score.parts[0]!.measures[0] as any).events[0];
  assert.deepEqual([e.pitch.step, e.pitch.alter, e.pitch.octave], ['B', 1, 3]);
});

test('a note held under moving notes keeps its length, in its own voice', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: 4 * PPQ, midi: 72 },   // held for the whole bar
    { at: PPQ, dur: PPQ, midi: 74 },     // moving notes underneath it
    { at: 2 * PPQ, dur: PPQ, midi: 76 }
  ])]));
  const { score, report } = transcribeMidiToScore(f, { maxVoices: 2 });
  const events = (score.parts[0]!.measures[0] as any).events;
  const held = events.find((e: any) => e.midi === 72);
  assert.equal(held.dur, 4, 'the held note is no longer cut back');
  assert.equal(report.clamped, 0);
  assert.equal(report.voices.rightHand, 2);
  const moving = events.filter((e: any) => e.midi !== 72);
  assert.ok(moving.every((e: any) => e.voice !== held.voice), 'the moving notes are a separate voice');
});

test('with only one voice allowed, the held note is cut back as before', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: 4 * PPQ, midi: 72 },
    { at: PPQ, dur: PPQ, midi: 74 }
  ])]));
  const { score, report } = transcribeMidiToScore(f, { maxVoices: 1 });
  const held = (score.parts[0]!.measures[0] as any).events.find((e: any) => e.midi === 72);
  assert.equal(held.dur, 1);
  assert.equal(report.clamped, 1);
});

test('voices are numbered from the top down, and kept apart per staff', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: 4 * PPQ, midi: 76 }, { at: PPQ, dur: PPQ, midi: 67 },   // right hand
    { at: 0, dur: 4 * PPQ, midi: 48 }, { at: PPQ, dur: PPQ, midi: 40 }    // left hand
  ])]));
  const { score } = transcribeMidiToScore(f, { maxVoices: 2 });
  const events = (score.parts[0]!.measures[0] as any).events;
  const voiceOf = (midi: number) => events.find((e: any) => e.midi === midi).voice;
  assert.ok(voiceOf(76) < voiceOf(67), 'the higher line takes the lower voice number');
  assert.ok(voiceOf(48) < voiceOf(40));
  assert.ok([1, 2].includes(voiceOf(76)), 'right hand uses voices 1-2');
  assert.ok([5, 6].includes(voiceOf(48)), 'left hand uses voices 5-6');
});

test('notes sharing an onset but not a length are never lost when voices run out', () => {
  // Three lengths at one onset with only two voices: the odd one must be merged,
  // not shortened to nothing. Cutting it back to the others' start would leave it
  // zero-length and it would vanish from the page entirely.
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: 4 * PPQ, midi: 72 },
    { at: 0, dur: 2 * PPQ, midi: 76 },
    { at: 0, dur: PPQ, midi: 79 }
  ])]));
  const { score } = transcribeMidiToScore(f, { maxVoices: 2 });
  const all = (score.parts[0]!.measures as any[]).flatMap(m => m.events);
  for (const midi of [72, 76, 79])
    assert.ok(all.some((e: any) => e.midi === midi), `midi ${midi} must still be written`);
  assert.ok(all.every((e: any) => e.dur > 0), 'no note may have zero length');
});

test('every source note reaches the page exactly once', () => {
  // The check that catches a note silently disappearing: source notes plus tie
  // continuations must equal the note elements written.
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: 0, dur: 5 * PPQ, midi: 72 }, { at: PPQ, dur: PPQ, midi: 67 },
    { at: 2 * PPQ, dur: 3 * PPQ, midi: 64 }, { at: 3 * PPQ, dur: PPQ, midi: 55 },
    { at: 0, dur: 2 * PPQ, midi: 48 }, { at: 5 * PPQ, dur: PPQ, midi: 43 }
  ])]));
  const source = f.tracks.reduce((a, b) => (b.notes.length > a.notes.length ? b : a)).notes.length;
  const { score, report } = transcribeMidiToScore(f);
  const written = (score.parts[0]!.measures as any[]).reduce((n, m) => n + m.events.length, 0);
  assert.equal(written, source + report.tied, 'nothing lost, nothing invented');
});

test('a note too short to notate is lengthened rather than dropped', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([{ at: 0, dur: 3, midi: 60 }])]));
  const { score, report } = transcribeMidiToScore(f, { grid: 16 });
  assert.equal(report.widened, 1);
  assert.equal((score.parts[0]!.measures[0] as any).events[0].dur, 0.25);
});

test('a poor fit to the grid is reported rather than silently forced', () => {
  const third = Math.round(PPQ / 3); // triplet eighths against a 1/16 grid
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack(
    [0, 1, 2, 3, 4, 5].map(i => ({ at: i * third, dur: third, midi: 60 + i }))
  )]));
  const { report } = transcribeMidiToScore(f, { grid: 16 });
  assert.match(report.warnings.join(' '), /does not sit cleanly|triplets/);
});

test('transcribes, exports and reparses without losing or corrupting notes', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(2)], notesTrack([
    { at: 0, dur: PPQ, midi: 60 }, { at: 0, dur: PPQ, midi: 64 }, { at: 0, dur: PPQ, midi: 43 },
    { at: PPQ, dur: PPQ, midi: 62 }, { at: PPQ, dur: PPQ, midi: 45 },
    { at: 2 * PPQ, dur: 2 * PPQ, midi: 59 }, { at: 2 * PPQ, dur: 2 * PPQ, midi: 47 }
  ])]));
  const { score } = transcribeMidiToScore(f);
  const xml = exportScoreModelToMusicXML(score);
  const back: any = parseMusicXMLToScoreModel(xml);
  const count = (m: any) => m.parts.reduce((n: number, p: any) =>
    n + p.measures.reduce((k: number, x: any) => k + x.events.filter((e: any) => e.type === 'note').length, 0), 0);
  const ties = (xml.match(/<tie type="start"\/>/g) ?? []).length;
  // A tied pair is one note written as two elements, so it reads back as two.
  assert.equal(count(back), count({ parts: score.parts }) + ties);
  assert.match(xml, /<staves>2<\/staves>/, 'a piano grand staff');
  assert.match(xml, /<clef number="2"><sign>F<\/sign>/, 'with a bass clef on the lower staff');
});

test('every note stays inside its bar and inside its voice', () => {
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack(
    Array.from({ length: 32 }, (_, i) => ({ at: i * (PPQ / 2), dur: PPQ, midi: 55 + (i % 12) }))
  )]));
  const { score } = transcribeMidiToScore(f);
  for (const m of score.parts[0]!.measures as any[]) {
    const cap = m.durationBeats ?? (m.attributes.time.beats * 4 / m.attributes.time.beat_type);
    for (const e of m.events) assert.ok(e.t + e.dur <= cap + 1e-9, `note past the bar line in bar ${m.number}`);
    const byVoice: Record<number, any[]> = {};
    for (const e of m.events) (byVoice[e.voice] ??= []).push(e);
    for (const v of Object.values(byVoice)) {
      const s = v.sort((a, b) => a.t - b.t);
      for (let i = 1; i < s.length; i++)
        assert.ok(s[i]!.t === s[i - 1]!.t || s[i]!.t >= s[i - 1]!.t + s[i - 1]!.dur - 1e-9, 'voices must not overlap');
    }
  }
});

test('a note crossing a bar line is tied over, not cut off at it', () => {
  // A whole note begun on the last sixteenth of bar 1 — the case that made a real
  // recording's opening chord collapse from a whole note to a sixteenth.
  const f = parseMidiFile(smf([[...timeSig(4, 2)], notesTrack([
    { at: PPQ * 3.75, dur: PPQ * 4, midi: 62 }
  ])]));
  const { score, report } = transcribeMidiToScore(f);
  const first: any = (score.parts[0]!.measures[0] as any).events[0];
  const second: any = (score.parts[0]!.measures[1] as any).events[0];
  assert.equal(first.dur, 0.25);
  assert.equal(first.tieStart, true, 'the first segment starts a tie');
  assert.equal(second.t, 0);
  assert.equal(second.dur, 3.75, 'the remainder continues in the next bar');
  assert.equal(second.tieStop, true);
  assert.equal(first.dur + second.dur, 4, 'the whole note survives intact');
  assert.equal(report.tied, 1);
  const xml = exportScoreModelToMusicXML(score);
  assert.equal((xml.match(/<tie type="start"\/>/g) ?? []).length, (xml.match(/<tie type="stop"\/>/g) ?? []).length);
});

test('the key signature is taken from the notes when the file declares a wrong one', () => {
  // Plainly D major, but keyboards and writers emit 0 sharps by default.
  const dMajor = [62, 66, 69, 61, 64, 71, 67];
  const f = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(0)], notesTrack(
    dMajor.map((m, i) => ({ at: i * PPQ, dur: PPQ, midi: m }))
  )]));
  const { score, report } = transcribeMidiToScore(f);
  assert.equal(report.keyFifths, 2, 'two sharps, from the notes');
  assert.equal(report.keyInferred, true);
  assert.match(report.warnings.join(' '), /declares 0 .*fit 2|notes fit 2/);
  assert.equal((score.parts[0]!.measures[0] as any).attributes.key_fifths, 2);
});

test('a declared key signature that fits the music is left alone', () => {
  // Genuine C major must not be second-guessed into something else.
  const cMajor = [60, 62, 64, 65, 67, 69, 71];
  const f = parseMidiFile(smf([[...timeSig(4, 2), ...keySig(0)], notesTrack(
    cMajor.map((m, i) => ({ at: i * PPQ, dur: PPQ, midi: m }))
  )]));
  const { report } = transcribeMidiToScore(f);
  assert.equal(report.keyFifths, 0);
  assert.equal(report.keyInferred, false);
});

test('a file with only drums is refused with a reason', () => {
  const body = [0, 0x99, 38, 100, ...vlq(PPQ), 0x89, 38, 0];
  assert.throws(() => transcribeMidiToScore(parseMidiFile(smf([body]))), /no pitched notes/);
});

// The real Dorico export, when supplied.
const REAL = process.env.MIDI_TEST_PATH;
if (REAL && fs.existsSync(REAL)) {
  test('transcribes a real Dorico piano export into a valid grand staff', () => {
    const f = parseMidiFile(new Uint8Array(fs.readFileSync(REAL)));
    const { score, report } = transcribeMidiToScore(f);
    assert.ok(report.notes > 1000);
    assert.equal(report.pickup, true, 'the 1/4 opening bar is a pickup');
    assert.ok(report.fit.p95 < 0.25, 'a humanized notation export should sit close to the grid');
    assert.ok(report.rightHandNotes > 0 && report.leftHandNotes > 0, 'both hands are used');
    const xml = exportScoreModelToMusicXML(score);
    assert.match(xml, /<staves>2<\/staves>/);
    for (const m of score.parts[0]!.measures as any[]) {
      const cap = m.durationBeats ?? (m.attributes.time.beats * 4 / m.attributes.time.beat_type);
      for (const e of m.events) assert.ok(e.t + e.dur <= cap + 1e-9);
    }
  });
}

console.log(`\n${passed} assertions passed.`);
