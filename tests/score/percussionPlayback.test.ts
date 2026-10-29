import assert from "node:assert/strict";
import { instrumentPlayback } from "../../src/score/instrumentPlayback";
import { percussionMidi, PERCUSSION_ALIASES } from "../../src/score/percussionMidi";
import { getPercussionMap } from "../../src/exporters/musicxmlExporter";
import { buildPerformance } from "../../src/score/performance";
import { exportMidi } from "../../src/score/midi";

/**
 * Seven of seventeen parts played back as the wrong instrument, and the drums
 * played as nothing at all.
 *
 * Found by running the app rather than by reading the score files, which had
 * been correct all along. Two separate faults:
 *
 * The General MIDI lookup matches SUBSTRINGS, and the SATB voice entry sat
 * sixth in an ordered list — so "Alto Sax" matched "alto" and four saxophones
 * and the bass came out as a choir, while the baritone, the guitar and the
 * drums had no entry at all and fell through to the piano fallback. "Tenor
 * Trombone" would have done the same. Every specific instrument now precedes
 * the bare voice words.
 *
 * And percussion is written as `type: 'unpitched'`, which the playback builder
 * skipped entirely: 1499 drum events scheduled as silence, in the browser
 * player and in the exported MIDI alike.
 */

// ── The lookup is ordered, and order is the whole rule ──
{
  const sf = (instrument: string, name: string) => instrumentPlayback({ instrument, name }).soundfont;

  // What was broken. Each of these came back "choir_aahs" or the piano fallback.
  assert.equal(sf("alto_sax_eb", "Alto Sax"), "alto_sax", "an alto saxophone is not a choir");
  assert.equal(sf("alto_sax_eb", "Alto Sax 2"), "alto_sax");
  assert.equal(sf("tenor_sax_bb", "Tenor Sax"), "tenor_sax", "a tenor saxophone is not a choir");
  assert.equal(sf("baritone_sax_eb", "Baritone Sax"), "baritone_sax");
  assert.equal(sf("guitar", "Rhythm Guitar"), "electric_guitar_jazz");
  assert.equal(sf("piano", "Piano"), "acoustic_grand_piano");
  assert.equal(sf("acoustic_bass", "Bass"), "acoustic_bass", "a rhythm-section bass is not a choir");

  // What must NOT regress. A choral part is named exactly for its voice and has
  // to reach the voice entry; "bassoon", "double bass" and "bass trombone" all
  // contain "bass" and have to be caught before the bare word.
  for (const voice of ["Soprano", "Alto", "Tenor", "Bass"]) {
    assert.equal(sf(voice, voice), "choir_aahs", `the choral ${voice} is a voice`);
  }
  assert.equal(sf("bassoon", "Bassoon"), "bassoon");
  assert.equal(sf("double_bass", "Double Bass"), "contrabass");
  assert.equal(sf("trombone", "Bass Trombone"), "trombone");
  assert.equal(sf("tuba_c", "Tuba"), "tuba");
  assert.equal(sf("timpani", "Timpani"), "timpani");

  // A kit is flagged, because the MIDI export has to put it on channel 9.
  assert.equal(instrumentPlayback({ instrument: "drums", name: "Drums" }).percussion, true);
  assert.equal(
    instrumentPlayback({ instrument: "drums", name: "Percussion (Crash/Triangle)" }).percussion, true,
    "the orchestra's percussion staff is a kit too"
  );
  assert.equal(instrumentPlayback({ instrument: "trumpet_bb", name: "Trumpet" }).percussion, false);
}

// ── The playback map and the engraving map cannot drift apart ──
{
  // They are separate tables — one is consulted when a file is written, the
  // other when a score is played — so a chart could print one drum and sound
  // another. Every alias has to agree.
  assert.ok(PERCUSSION_ALIASES.length >= 18, `expected a real table, got ${PERCUSSION_ALIASES.length} aliases`);
  for (const alias of PERCUSSION_ALIASES) {
    const written = getPercussionMap(alias);
    assert.ok(written, `the exporter does not know "${alias}"`);
    assert.equal(
      percussionMidi(alias), written!.midiUnpitched,
      `"${alias}" sounds as ${percussionMidi(alias)} but is written as ${written!.midiUnpitched}`
    );
  }
  assert.equal(percussionMidi("not_a_drum"), null);
  assert.equal(percussionMidi(undefined), null);
}

/** A one-bar score: a melodic part and a kit, written the way an arranger does. */
function kitScore(drumEvents: any[]): any {
  const bar = (events: any[]) => ({
    number: 1,
    attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
    events,
  });
  return {
    score_id: "T",
    meta: { ensemble: "jazz_band" },
    global: { divisions: 480 },
    parts: [
      {
        part_id: "TPT", name: "Trumpet", instrument: "trumpet_bb", staves: 1,
        measures: [bar([{ id: "n1", t: 0, dur: 1, type: "note", pitch: { step: "C", octave: 5 }, voice: 1, staff: 1 }])],
      },
      { part_id: "DRUMS", name: "Drums", instrument: "drums", staves: 1, measures: [bar(drumEvents)] },
    ],
  };
}

// ── The kit reaches playback, in both the shapes a drum event comes in ──
{
  // An arranger's own score model — which is what the app plays — names the
  // drum; a score parsed back from MusicXML carries the number the exporter
  // wrote. Taking only the second would have left the app silent while every
  // file-based check passed, so both are covered.
  const byName = buildPerformance(kitScore([
    { id: "d1", t: 0, dur: 0.5, type: "unpitched", instrumentId: "kick", voice: 1, staff: 1 },
    { id: "d2", t: 1, dur: 0.5, type: "unpitched", instrumentId: "snare", voice: 1, staff: 1 },
    { id: "d3", t: 2, dur: 0.5, type: "unpitched", instrumentId: "ride", voice: 1, staff: 1 },
  ]));
  const drums = byName.notes.filter((n: any) => n.partIdx === 1).map((n: any) => n.midi).sort((a, b) => a - b);
  assert.deepEqual(drums, [36, 38, 51], `the kit should sound 36/38/51, got ${drums}`);

  const byNumber = buildPerformance(kitScore([
    { id: "d1", t: 0, dur: 0.5, type: "unpitched", midiUnpitched: 42, voice: 1, staff: 1 },
  ]));
  assert.deepEqual(
    byNumber.notes.filter((n: any) => n.partIdx === 1).map((n: any) => n.midi), [42],
    "a drum parsed back from MusicXML carries its number and must still play"
  );

  // A drum nobody has mapped is dropped rather than played as some other sound.
  const unknown = buildPerformance(kitScore([
    { id: "d1", t: 0, dur: 0.5, type: "unpitched", instrumentId: "vibraslap", voice: 1, staff: 1 },
  ]));
  assert.equal(unknown.notes.filter((n: any) => n.partIdx === 1).length, 0);

  // The melodic part is untouched by any of this.
  assert.equal(byName.notes.filter((n: any) => n.partIdx === 0).length, 1);
}

// ── Exported MIDI puts the kit on channel 9, and nothing else there ──
{
  const bytes = exportMidi(kitScore([
    { id: "d1", t: 0, dur: 0.5, type: "unpitched", instrumentId: "kick", voice: 1, staff: 1 },
  ]));
  // Walk the chunks and read each track's single program change.
  const tracks: Array<{ name: string; channel: number; program: number }> = [];
  let i = 14;
  while (i < bytes.length - 8) {
    const len = (bytes[i + 4]! << 24) | (bytes[i + 5]! << 16) | (bytes[i + 6]! << 8) | bytes[i + 7]!;
    const body = bytes.subarray(i + 8, i + 8 + len);
    let name = "", channel = -1, program = -1;
    for (let j = 0; j < body.length - 3; j++) {
      if (body[j] === 0xff && body[j + 1] === 0x03) {
        const n = body[j + 2]!;
        name = new TextDecoder().decode(body.subarray(j + 3, j + 3 + n));
      }
      if (channel < 0 && body[j] === 0x00 && (body[j + 1]! & 0xf0) === 0xc0) {
        channel = body[j + 1]! & 0x0f;
        program = body[j + 2]!;
        break;
      }
    }
    if (name) tracks.push({ name, channel, program });
    i += 8 + len;
  }

  const kit = tracks.find((t) => t.name === "Drums");
  const tpt = tracks.find((t) => t.name === "Trumpet");
  assert.ok(kit && tpt, `expected both tracks, got ${tracks.map((t) => t.name).join(", ")}`);
  // Channel 9 is where a drum number means a drum. On any other channel the
  // same byte is a pitch, which is what the kit used to get.
  assert.equal(kit!.channel, 9, `the kit belongs on channel 9, got ${kit!.channel}`);
  assert.notEqual(tpt!.channel, 9, "a melodic part must stay off the percussion channel");
}

console.log("percussionPlayback: ok");
