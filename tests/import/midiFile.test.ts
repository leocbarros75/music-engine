import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMidiFile } from '../../src/import/midiFile.ts';
import { exportMidi } from '../../src/score/midi.ts';

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }

// ── Fixture builders ─────────────────────────────────────────────────────────
// Hand-built bytes, because the engine's own writer emits a deliberately clean
// subset: Type 1, explicit note-offs, one channel per track, never running status.
// A reader tested only by round-tripping our own output would pass every test here
// and still fail on every file Dorico, Logic or Cubase produces.
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const header = (format: number, tracks: number, division: number) =>
  [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(format), ...u16(tracks), ...u16(division)];
const track = (body: number[]) =>
  [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length + 4), ...body, 0x00, 0xff, 0x2f, 0x00];
const file = (format: number, division: number, bodies: number[][]) =>
  new Uint8Array([...header(format, bodies.length, division), ...bodies.flatMap(track)]);

test('running status: a status byte omitted on repeat is carried forward', () => {
  // note-on C4, then TWO more note-ons with the status byte omitted.
  const f = parseMidiFile(file(1, 480, [[
    0x00, 0x90, 60, 100,
    0x00, /* running */ 62, 100,
    0x00, /* running */ 64, 100,
    0x60, 0x80, 60, 0,
    0x00, /* running */ 62, 0,
    0x00, /* running */ 64, 0
  ]]));
  const notes = f.tracks[0]!.notes;
  assert.equal(notes.length, 3, 'all three running-status note-ons must be read');
  assert.deepEqual(notes.map(n => n.midi), [60, 62, 64]);
  assert.deepEqual(notes.map(n => n.durationTick), [96, 96, 96]);
});

test('a note-on with velocity 0 is a note-off', () => {
  const f = parseMidiFile(file(1, 480, [[
    0x00, 0x90, 60, 100,
    0x78, 0x90, 60, 0        // velocity 0 = release, not a second note
  ]]));
  assert.equal(f.tracks[0]!.notes.length, 1);
  assert.equal(f.tracks[0]!.notes[0]!.durationTick, 120);
});

test('the same pitch may sound twice before either releases', () => {
  const f = parseMidiFile(file(1, 480, [[
    0x00, 0x90, 60, 100,
    0x30, 0x90, 60, 90,      // struck again while still held
    0x30, 0x80, 60, 0,
    0x30, 0x80, 60, 0
  ]]));
  const notes = f.tracks[0]!.notes;
  assert.equal(notes.length, 2, 'neither copy may be dropped');
  assert.deepEqual(notes.map(n => n.startTick), [0, 48]);
  assert.deepEqual(notes.map(n => n.durationTick), [96, 96], 'oldest release closes the oldest note');
});

test('Type 0 keeps its channels apart inside one track', () => {
  const f = parseMidiFile(file(0, 480, [[
    0x00, 0x90, 60, 100,
    0x00, 0x91, 48, 100,
    0x60, 0x80, 60, 0,
    0x00, 0x81, 48, 0
  ]]));
  assert.equal(f.format, 0);
  assert.deepEqual(f.tracks[0]!.channels, [0, 1]);
  assert.deepEqual(f.tracks[0]!.notes.map(n => [n.midi, n.channel]), [[48, 1], [60, 0]]);
});

test('sysex and unknown meta events are skipped by their declared length', () => {
  const f = parseMidiFile(file(1, 480, [[
    0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7,        // sysex
    0x00, 0xff, 0x7f, 0x02, 0xde, 0xad,        // unknown meta
    0x00, 0x90, 60, 100,
    0x60, 0x80, 60, 0
  ]]));
  assert.equal(f.tracks[0]!.notes.length, 1, 'the note after the skipped blocks survives');
  assert.equal(f.tracks[0]!.notes[0]!.midi, 60);
});

test('tempo, time signature, key signature, markers and CC64 are captured', () => {
  const f = parseMidiFile(file(1, 480, [[
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,  // 500000 us = 120 bpm
    0x00, 0xff, 0x58, 0x04, 3, 2, 24, 8,       // 3/4
    0x00, 0xff, 0x59, 0x02, 0xfd, 0x01,        // 3 flats, minor
    0x00, 0xff, 0x06, 0x05, 0x49, 0x6e, 0x74, 0x72, 0x6f,
    0x00, 0xb0, 64, 127,                       // sustain down
    0x60, 0xb0, 64, 0                          // sustain up
  ]]));
  assert.equal(Math.round(f.tempos[0]!.bpm), 120);
  assert.deepEqual(f.timeSigs[0], { tick: 0, beats: 3, beatType: 4 });
  assert.deepEqual(f.keySigs[0], { tick: 0, fifths: -3, mode: 'minor' }, 'fifths is signed');
  assert.equal(f.markers[0]!.text, 'Intro');
  assert.deepEqual(f.pedal.map(p => p.down), [true, false]);
});

test('channel 10 is reported as drums', () => {
  const f = parseMidiFile(file(1, 480, [[0x00, 0x99, 38, 100, 0x60, 0x89, 38, 0]]));
  assert.equal(f.tracks[0]!.isDrums, true);
});

test('a note left hanging is closed and warned about, not dropped', () => {
  const f = parseMidiFile(file(1, 480, [[0x00, 0x90, 60, 100, 0x60, 0x90, 62, 100]]));
  assert.equal(f.tracks[0]!.notes.length, 2);
  assert.match(f.warnings.join(' '), /no note-off/);
});

test('unsupported time bases and file types are refused with a reason', () => {
  assert.throws(() => parseMidiFile(new Uint8Array([...header(2, 1, 480)])), /Type 2/);
  assert.throws(() => parseMidiFile(file(1, 0xe278, [[]])), /SMPTE|ticks per quarter/i);
  assert.throws(() => parseMidiFile(new Uint8Array([1, 2, 3, 4])), /MThd/);
});

test('missing tempo and meter fall back to the MIDI defaults, with a warning', () => {
  const f = parseMidiFile(file(1, 480, [[0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]]));
  assert.equal(f.tempos[0]!.bpm, 120);
  assert.deepEqual(f.timeSigs[0], { tick: 0, beats: 4, beatType: 4 });
  assert.equal(f.warnings.filter(w => /assuming/.test(w)).length, 2);
});

test('round-trips a score exported by the engine itself', () => {
  const score: any = {
    meta: { title: 'roundtrip' },
    parts: [{
      part_id: 'P1', name: 'Piano', instrument: 'piano', pitchSpace: 'sounding',
      measures: [{
        number: 1,
        attributes: { divisions: 4, key_fifths: 0, time: { beats: 4, beat_type: 4 } },
        events: [
          { type: 'note', t: 0, dur: 1, midi: 60 },
          { type: 'note', t: 1, dur: 1, midi: 64 },
          { type: 'note', t: 2, dur: 2, midi: 67 }
        ]
      }]
    }]
  };
  const f = parseMidiFile(exportMidi(score, 120));
  const notes = f.tracks.flatMap(t => t.notes).sort((a, b) => a.startTick - b.startTick);
  assert.deepEqual(notes.map(n => n.midi), [60, 64, 67]);
  assert.deepEqual(notes.map(n => n.startTick / f.ppq), [0, 1, 2], 'onsets survive in quarter notes');
  assert.deepEqual(notes.map(n => n.durationTick / f.ppq), [1, 1, 2]);
  assert.equal(Math.round(f.tempos[0]!.bpm), 120);
});

// A real Dorico export, when one is supplied. Not committed to the repo, so this
// is skipped rather than failed when the path is absent.
const REAL = process.env.MIDI_TEST_PATH;
if (REAL && fs.existsSync(REAL)) {
  test('reads a real Dorico piano export', () => {
    const f = parseMidiFile(new Uint8Array(fs.readFileSync(REAL)));
    assert.equal(f.format, 1);
    assert.ok(f.ppq > 0);
    const notes = f.tracks.flatMap(t => t.notes);
    assert.ok(notes.length > 0, 'the piano track must yield notes');
    assert.ok(notes.every(n => n.durationTick > 0), 'every note has a positive duration');
    assert.ok(notes.every(n => n.midi >= 0 && n.midi <= 127));
    assert.equal(f.warnings.length, 0, 'a well-formed file should raise no warnings');
  });
}

console.log(`\n${passed} assertions passed.`);
