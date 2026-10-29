/**
 * Canonical drum id → General MIDI percussion key.
 *
 * An arranger writes an unpitched event as a NAME — `{ type: 'unpitched',
 * instrumentId: 'kick' }` — and only the MusicXML exporter ever turned that
 * name into a number. Playback reads the arranger's score model directly, not
 * the exported file, so it had no way to know what a "kick" sounds like and
 * dropped the whole kit: 1499 events scheduled as silence.
 *
 * These numbers are General MIDI percussion keys, which are identities rather
 * than pitches — 36 is a kick on any kit, at any transposition. They must agree
 * with `getPercussionMap` in the exporter, or a chart would play one drum and
 * print another; `tests/score/percussionPlayback.test.ts` asserts that for
 * every alias here, so the two cannot drift apart silently.
 *
 * The aliases are the exporter's own. Only a handful are ever written by the
 * arrangers (kick, snare, hihat, hihat_open, ride, crash, suspended_cymbal,
 * triangle), but accepting the rest costs nothing and means a new percussion
 * voice is audible the day it is written rather than the day someone notices.
 */
const PERCUSSION_MIDI: Array<[string[], number]> = [
  [['kick', 'bd', 'bass_drum'], 36],
  [['snare', 'sd', 'snare_drum'], 38],
  [['hihat', 'hi_hat', 'hihat_closed', 'hhc'], 42],
  [['hihat_open', 'hho'], 46],
  [['ride', 'rc', 'ride_cymbal'], 51],
  [['crash', 'cc', 'crash_cymbal'], 49],
  [['suspended_cymbal', 'sus_cymbal', 'suspended cymbal', 'susp_cymbal'], 57],
  [['mallets', 'mallet'], 81],
  [['bells', 'jingle_bell', 'sleigh_bells', 'sleighbells'], 83],
  [['chimes', 'wind_chimes', 'bell_tree', 'belltree'], 84],
  [['tambourine', 'tambo'], 54],
  [['shaker'], 82],
  [['maraca', 'maracas'], 70],
  [['claves', 'clave'], 75],
  [['triangle', 'tri'], 81],
  [['cabasa'], 69],
  [['cowbell'], 56],
  [['woodblock', 'wood_block'], 76],
];

/** Every alias this module knows, for the test that compares it to the exporter. */
export const PERCUSSION_ALIASES: string[] = PERCUSSION_MIDI.flatMap(([names]) => names);

/** The General MIDI percussion key for a canonical drum id, or null. */
export function percussionMidi(instrumentId: string | undefined): number | null {
  const id = (instrumentId ?? '').toLowerCase();
  if (!id) return null;
  // Exact match on the alias, as the exporter does — never a substring, or
  // "bass_drum" would be caught by anything looking for "bass".
  for (const [names, midi] of PERCUSSION_MIDI) if (names.includes(id)) return midi;
  return null;
}
