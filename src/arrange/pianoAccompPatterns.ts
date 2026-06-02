/**
 * Piano Accompaniment Pattern Library — Phase 1
 *
 * Generates left-hand accompaniment note events from chord symbols.
 *
 * Patterns implemented (sourced from):
 *   "alberti"          — Mozart K.545 1st mvt (Allegro, 4/4) and 2nd mvt (Andante, 3/4)
 *                        Formula: root-5th-3rd-5th in 8ths (4/4) or 16ths (3/4 slow)
 *   "block_beats"      — Stevens "Contemporary Accompaniment Patterns" #1-4
 *                        Root+3rd+5th chord block on every beat (quarter notes)
 *   "boom_chick"       — Stevens patterns #6-8 (Classic / Broadway / Middle Eastern)
 *                        Root on beats 1+3, upper chord stab on 2+4
 *   "broken_ascending" — Stevens patterns #11-12 / K.545 m11
 *                        Ascending root-3rd-5th-oct arpeggio per beat in 16th notes
 *   "waltz_bass"       — Classic 3/4 waltz texture (root on 1, chord on 2+3)
 *
 * Patterns added from "Pop Ballad Accompaniment" (Ron Drotos / keyboardimprov.com):
 *   "pop_arpeggio"     — Lessons 4: 8th-note rolling arpeggio root→5th→oct→5th cycling
 *   "walking_bass"     — Lessons 12, 14: chromatic walking bass, quarter notes, approaches
 *                        next chord root chromatically on the final beat
 *   "pedal_bass"       — Lesson 13: root sustained as whole note (Elton John pedal-tone style)
 *
 * All patterns handle mid-measure chord changes automatically: the active chord
 * is looked up at the start of each pattern group (Alberti group, beat, etc.)
 * using carry-forward from the nearest preceding chord symbol.
 */

import { parseChordSymbol } from "../harmonize/satb/chordSymbol";
import { midiToPitch } from "../instruments/instrumentCatalog";
import type { NoteEvent } from "../score/types";

// ─── Public types ─────────────────────────────────────────────────────────────

export type LhPatternId =
  /** K.545 style — root-5th-3rd-5th in 8ths (4/4) or 16ths (3/4 slow) */
  | "alberti"
  /** Block chord on every beat (Stevens #1-4) */
  | "block_beats"
  /** Root on odd beats, mid+high chord on even beats (Stevens #6-8) */
  | "boom_chick"
  /** Ascending arpeggio per beat in 16ths (Stevens #11-12) */
  | "broken_ascending"
  /** Classic waltz: root on 1, chord on 2+3 (3/4 only) */
  | "waltz_bass"
  /**
   * Schubert Serenade "guitar strum" (3/4 or 4/4):
   *   bass(8th) + alternating [mid, high] for remaining eighths
   *   Schubert Ständchen D.957 No.4: D minor, 3/4, bass-octave + inner intervals
   */
  | "serenade_strum"
  /**
   * Erlkönig root-then-chords (4/4 dramatic):
   *   root alone on beat 1 (quarter), full mid+high chord block on all remaining beats
   *   Schubert Erlkönig D.328: D minor/major, 4/4, tense block texture
   */
  | "root_chord_stabs"
  /**
   * Two-tone interval oscillation (Erlkönig / Schubert Sonata No.18):
   *   mid and high chord tones alternating as 8th notes throughout the measure
   *   Creates a sustained tremolo-like inner voice texture
   */
  | "interval_oscillation"
  /**
   * Jazz shell voicing (Silent Night Jazz arr. / Autumn Leaves):
   *   beats 1-2: root (bass) + compound 3rd "10th" (mid+oct) as a wide half-note dyad
   *   beat 3:    mid (chord 3rd) — quarter note
   *   beat 4:    bass (root) — quarter note  (omitted in 3/4)
   *   Gives the characteristic open, spacious jazz LH texture without 7th-chord parsing.
   */
  | "jazz_shell"
  /**
   * Octave bass (Praise the Lord the Almighty — LOBE DEN HERREN, 3/4):
   *   Every beat: root note played as octave unison pair (bass + bass+12)
   *   Gives the stately pipe-organ / hymn-march power texture.
   *   Works in any time signature; chord root is re-read on each beat.
   */
  | "octave_bass"
  /**
   * Nocturne arpeggiation (Chopin Op. 9 No. 2, 12/8 — Mendelssohn Op. 19 No. 3, 6/8):
   *   Compound-meter pattern grouped by dotted quarter (1.5 quarter-note beats):
   *     8th 1 (tGroup + 0.0): bass alone
   *     8th 2 (tGroup + 0.5): mid + high chord
   *     8th 3 (tGroup + 1.0): mid + high chord (repeated)
   *   numGroups = Math.round(measureBeats / 1.5)
   *     12/8 → 4 groups, 6/8 → 2 groups, 9/8 → 3 groups
   *   Creates the characteristic rolling compound-time texture of Romantic nocturnes.
   */
  | "nocturne"
  /**
   * Pop Ballad rolling 8th-note arpeggio (Ron Drotos Lesson 4):
   *   8th notes cycling root→5th→oct→5th throughout the measure.
   *   Smoother than broken_ascending (8ths vs 16ths); characteristic of pop piano LH.
   *   In 4/4: 8 eighth notes = 2 full cycles. In 3/4: 6 eighths = 1.5 cycles.
   */
  | "pop_arpeggio"
  /**
   * Walking bass with chromatic approach (Ron Drotos Lessons 12, 14):
   *   Quarter-note bass line walking through chord tones: root→3rd→5th→approach.
   *   Final beat uses a chromatic approach note (one semitone below/above) leading
   *   toward the next measure's chord root. Creates the melodic "walking" feel
   *   characteristic of pop ballad and gospel bass lines.
   */
  | "walking_bass"
  /**
   * Pedal tone (sustained root) — Ron Drotos Lesson 13 / Elton John style:
   *   Root note sustained as a whole note for the entire measure.
   *   While the LH holds still, the RH can move through neighbor/passing chords
   *   (e.g., C → F/C → C with bass pedaling on C throughout).
   *   Creates the spacious, open quality of Elton John / gospel piano ballads.
   */
  | "pedal_bass";

export type LhPatternOptions = {
  chords: Array<{ measure: number; t: number; symbol: string }>;
  measureNumber: number;
  /** Total quarter-note beats in the measure (4 for 4/4, 3 for 3/4, 2 for 2/4, etc.) */
  measureBeats: number;
  lhPattern: LhPatternId;
  /** Lowest MIDI for the bass (root) note. Default: 43 = G2 */
  bassMin?: number;
  /** Highest MIDI for the bass (root) note. Default: 57 = A3 */
  bassMax?: number;
  warnings?: string[];
};

// ─── Internal types ───────────────────────────────────────────────────────────

type ChordVoices = {
  /** Root note MIDI, placed in [bassMin, bassMax] */
  bass: number;
  /** Third above bass, within an octave */
  mid: number;
  /** Fifth above bass, within an octave */
  high: number;
};

// ─── Chord tone utilities ─────────────────────────────────────────────────────

/**
 * Given a chord symbol and a target bass MIDI range, returns {bass, mid, high}
 * MIDI values suitable for Alberti / block-chord / arpeggio patterns.
 *
 * Layout rule (matches K.545 LH voice assignment):
 *   bass  = chord root placed in [bassMin, bassMax]
 *   mid   = chord 3rd (minor or major) placed above bass, within one octave
 *   high  = chord 5th (or nearest interval 6-8 st) placed above bass, within one octave
 *
 * For diminished / augmented / suspended chords the nearest qualifying interval
 * is used so the pattern always produces 3 distinct pitches.
 */
export function chordVoicesInRange(
  symbol: string,
  bassMin: number,
  bassMax: number
): ChordVoices | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;

  const { rootPc, pcs } = parsed;

  // Place root in bass range (start low and step up by octave)
  let bass = 12 + rootPc; // octave 1 as floor
  while (bass < bassMin) bass += 12;
  while (bass > bassMax) bass -= 12;
  // Final safety: if still out of range, clamp
  if (bass < bassMin) bass = bassMin;
  if (bass > bassMax) bass = bassMax;

  // Sorted non-zero intervals above root (1–11 semitones)
  const intervals = pcs
    .map((pc) => ((pc - rootPc + 12) % 12))
    .filter((i) => i > 0)
    .sort((a, b) => a - b);

  // Identify third-like (3–4 st) and fifth-like (6–8 st) intervals
  // Fallback: use first two available intervals if the chord is unusual
  const thirdIntv = intervals.find((i) => i >= 3 && i <= 4) ?? intervals[0] ?? 4;
  const fifthIntv = intervals.find((i) => i >= 6 && i <= 8) ?? intervals[1] ?? 7;

  return {
    bass,
    mid: bass + thirdIntv,
    high: bass + fifthIntv,
  };
}

/**
 * Find the active chord symbol at a given (measureNumber, beat-t) position.
 * Scans the sorted chord array and returns the last chord at or before that point.
 */
export function pickChordAt(
  chords: Array<{ measure: number; t: number; symbol: string }>,
  measureNumber: number,
  t: number
): string | null {
  const mNum = Number(measureNumber);
  let best: { measure: number; t: number; symbol: string } | null = null;
  for (const c of chords) {
    const cm = Number(c.measure);
    const ct = Number(c.t);
    if (cm > mNum) break;
    if (cm < mNum) {
      best = c;
      continue;
    }
    // same measure
    if (ct <= t + 1e-6) best = c;
  }
  return best?.symbol ?? null;
}

// ─── Note event builder ───────────────────────────────────────────────────────

function makeNote(
  midi: number,
  t: number,
  dur: number,
  voice: number,
  staff: number,
  id: string
): NoteEvent {
  const pitch = midiToPitch(midi);
  return { type: "note", t, dur, voice, staff, pitch, midi, id } as any;
}

// ─── Pattern implementations ──────────────────────────────────────────────────

/**
 * ALBERTI BASS (K.545 style)
 *
 * 4/4 moderate tempo: 2 groups × 4 eighth notes = [root,5th,3rd,5th] per 2 beats.
 * 3/4 slow tempo:     3 groups × 4 sixteenth notes = [root,5th,3rd,5th] per beat.
 *
 * Chord lookup happens at the start of each group so mid-measure changes work.
 */
function buildAlberti(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  // 3/4 (slow) → 16th notes so 4 notes fit in 1 beat; 4/4+ → 8th notes so 4 notes span 2 beats
  const noteDur = measureBeats <= 3 ? 0.25 : 0.5;
  const groupBeats = noteDur * 4; // beats covered by one 4-note Alberti group

  const numGroups = Math.round(measureBeats / groupBeats);
  for (let g = 0; g < numGroups; g++) {
    const tGroup = g * groupBeats;
    const v = getVoices(tGroup);
    if (!v) continue;
    // Alberti sequence: root → 5th → 3rd → 5th
    const seq = [v.bass, v.high, v.mid, v.high];
    for (let i = 0; i < 4; i++) {
      const t = tGroup + i * noteDur;
      events.push(
        makeNote(seq[i]!, t, noteDur, voice, staff, `lh-alb-${mNum}-${t.toFixed(3)}-${i}`)
      );
    }
  }
  return events;
}

/**
 * BLOCK BEATS (Stevens #1–4)
 *
 * Root+3rd+5th block chord on every beat as quarter notes.
 * All three notes share the same voice; the exporter renders them as a chord.
 */
function buildBlockBeats(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    events.push(makeNote(v.bass, b, 1, voice, staff, `lh-blk-${mNum}-${b}-r`));
    events.push(makeNote(v.mid, b, 1, voice, staff, `lh-blk-${mNum}-${b}-m`));
    events.push(makeNote(v.high, b, 1, voice, staff, `lh-blk-${mNum}-${b}-h`));
  }
  return events;
}

/**
 * BOOM-CHICK (Stevens #6–8)
 *
 * Beat 1 (and 3 in 4/4): single root note — the "boom".
 * Beat 2 (and 4 in 4/4): mid+high chord stab — the "chick".
 * In 3/4: boom on beat 1, chick on beats 2+3.
 */
function buildBoomChick(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    if (b % 2 === 0) {
      // "boom" — single root
      events.push(makeNote(v.bass, b, 1, voice, staff, `lh-bmc-${mNum}-${b}-r`));
    } else {
      // "chick" — mid + high
      events.push(makeNote(v.mid, b, 1, voice, staff, `lh-bmc-${mNum}-${b}-m`));
      events.push(makeNote(v.high, b, 1, voice, staff, `lh-bmc-${mNum}-${b}-h`));
    }
  }
  return events;
}

/**
 * BROKEN ASCENDING (Stevens #11–12 / K.545 m11)
 *
 * Each beat: root → 3rd → 5th → root(octave) as 16th notes.
 * Creates a flowing arpeggiated texture across the whole measure.
 */
function buildBrokenAscending(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const noteDur = 0.25; // sixteenth note
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    const oct = v.bass + 12; // octave above root
    const seq = [v.bass, v.mid, v.high, oct];
    for (let i = 0; i < 4; i++) {
      const t = b + i * noteDur;
      events.push(
        makeNote(seq[i]!, t, noteDur, voice, staff, `lh-brk-${mNum}-${t.toFixed(3)}-${i}`)
      );
    }
  }
  return events;
}

/**
 * WALTZ BASS (classic 3/4)
 *
 * Beat 1: root (quarter note).
 * Beats 2+3: mid + high chord (quarter notes each).
 * Handles chord changes at beats 2 and 3 independently.
 */
function buildWaltzBass(
  getVoices: (t: number) => ChordVoices | null,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const v0 = getVoices(0);
  if (!v0) return [];

  const events: NoteEvent[] = [];

  // Beat 1: root
  events.push(makeNote(v0.bass, 0, 1, voice, staff, `lh-wlz-${mNum}-0-r`));

  // Beat 2: mid + high (use chord at beat 1; fall back to beat 0)
  const v1 = getVoices(1) ?? v0;
  events.push(makeNote(v1.mid, 1, 1, voice, staff, `lh-wlz-${mNum}-1-m`));
  events.push(makeNote(v1.high, 1, 1, voice, staff, `lh-wlz-${mNum}-1-h`));

  // Beat 3: mid + high (use chord at beat 2; fall back to beat 1 or 0)
  const v2 = getVoices(2) ?? v1;
  events.push(makeNote(v2.mid, 2, 1, voice, staff, `lh-wlz-${mNum}-2-m`));
  events.push(makeNote(v2.high, 2, 1, voice, staff, `lh-wlz-${mNum}-2-h`));

  return events;
}

/**
 * SERENADE STRUM (Schubert Ständchen D.957 No.4)
 *
 * Guitar-like arpeggiation across all eighth notes in the measure:
 *   note 0 (t=0.0): bass  — low root (anchors the harmony)
 *   notes 1+:       alternating mid → high → mid → high …
 *
 * 3/4  → 6 eighth notes  (bass + 5 alternating)
 * 4/4  → 8 eighth notes  (bass + 7 alternating)
 *
 * Chord is re-read at each eighth so mid-measure changes are handled.
 */
function buildSerenadeStrum(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const noteDur = 0.5; // eighth note
  const totalNotes = Math.round(measureBeats / noteDur); // 6 for 3/4, 8 for 4/4

  for (let i = 0; i < totalNotes; i++) {
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;

    // i=0 → bass; odd i → mid; even i>0 → high
    const midi = i === 0 ? v.bass : i % 2 === 1 ? v.mid : v.high;
    events.push(
      makeNote(midi, t, noteDur, voice, staff, `lh-ser-${mNum}-${t.toFixed(3)}-${i}`)
    );
  }
  return events;
}

/**
 * ROOT-CHORD STABS (Schubert Erlkönig D.328)
 *
 * Dramatic texture — stark contrast between bass attack and chord blocks:
 *   beat 0:           root alone (quarter) — the "attack"
 *   beats 1 … end:   mid + high block (quarter each)
 *
 * Works in any time signature; chord is looked up at each beat.
 */
function buildRootChordStabs(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    if (b === 0) {
      // Beat 1: root only
      events.push(makeNote(v.bass, b, 1, voice, staff, `lh-rcs-${mNum}-${b}-r`));
    } else {
      // All other beats: mid + high chord block
      events.push(makeNote(v.mid, b, 1, voice, staff, `lh-rcs-${mNum}-${b}-m`));
      events.push(makeNote(v.high, b, 1, voice, staff, `lh-rcs-${mNum}-${b}-h`));
    }
  }
  return events;
}

/**
 * INTERVAL OSCILLATION (Erlkönig / Sonata No.18)
 *
 * Mid and high chord tones alternating as eighth notes throughout the measure.
 * Creates a sustained tremolo-like inner-voice texture.
 *
 *   even 8ths (0, 2, 4 …): mid
 *   odd  8ths (1, 3, 5 …): high
 */
function buildIntervalOscillation(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const noteDur = 0.5; // eighth note
  const totalNotes = Math.round(measureBeats / noteDur);

  for (let i = 0; i < totalNotes; i++) {
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;
    const midi = i % 2 === 0 ? v.mid : v.high;
    events.push(
      makeNote(midi, t, noteDur, voice, staff, `lh-osc-${mNum}-${t.toFixed(3)}-${i}`)
    );
  }
  return events;
}

/**
 * JAZZ SHELL (Silent Night Jazz arr. / Autumn Leaves)
 *
 * Open wide-voicing texture characteristic of jazz piano left hand:
 *
 *   beats 1-2 (t=0, dur=2): root (low) + compound 3rd "10th" (mid+oct) — half-note dyad
 *   beat 3    (t=2, dur=1): mid (chord 3rd) — quarter
 *   beat 4    (t=3, dur=1): bass (root) — quarter  [4/4 only]
 *
 *   3/4: half dyad (beats 1-2) + mid quarter (beat 3)
 *   2/4: single half dyad for the whole measure
 *
 * "Ten" (10th) = mid + 12 semitones — compound 3rd, no 7th-chord parsing needed.
 * Approximates root+maj7 / root+min7 shells with available triad information.
 */
function buildJazzShell(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const v0 = getVoices(0);
  if (!v0) return [];

  const events: NoteEvent[] = [];

  // Compound 3rd ("10th") = mid note transposed up an octave
  const ten = v0.mid + 12;

  // beats 1-2: wide half-note dyad  [root, 10th]
  const halfDur = Math.min(2, measureBeats);
  events.push(makeNote(v0.bass, 0, halfDur, voice, staff, `lh-jsh-${mNum}-0-r`));
  events.push(makeNote(ten,    0, halfDur, voice, staff, `lh-jsh-${mNum}-0-t`));

  if (measureBeats >= 3) {
    // beat 3: mid (chord 3rd)
    const v2 = getVoices(2) ?? v0;
    events.push(makeNote(v2.mid, 2, 1, voice, staff, `lh-jsh-${mNum}-2-m`));
  }

  if (measureBeats >= 4) {
    // beat 4: bass (root return)
    const v3 = getVoices(3) ?? v0;
    events.push(makeNote(v3.bass, 3, 1, voice, staff, `lh-jsh-${mNum}-3-r`));
  }

  return events;
}

/**
 * OCTAVE BASS (Praise the Lord the Almighty — LOBE DEN HERREN, 3/4)
 *
 * Every beat: chord root played as an octave unison pair (bass + bass+12).
 * No inner voices — pure two-note octave punch on every quarter beat.
 *
 * Source: both hands throughout mirror each note at the octave, giving
 * a massive pipe-organ / stately-march texture characteristic of German chorales.
 *
 * Works in any time signature; chord root is re-read per beat so mid-measure
 * chord changes are supported.
 */
function buildOctaveBass(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    // Root in bass register + same root one octave higher
    events.push(makeNote(v.bass,      b, 1, voice, staff, `lh-oct-${mNum}-${b}-lo`));
    events.push(makeNote(v.bass + 12, b, 1, voice, staff, `lh-oct-${mNum}-${b}-hi`));
  }
  return events;
}

/**
 * NOCTURNE ARPEGGIATION (Chopin Op. 9 No. 2 / Mendelssohn Op. 19 No. 3)
 *
 * Compound-meter left-hand pattern grouped by dotted quarter (1.5 q beats):
 *   tGroup + 0.0: bass alone (8th note)
 *   tGroup + 0.5: mid + high chord (8th note)
 *   tGroup + 1.0: mid + high chord again (8th note)
 *
 * numGroups:  12/8 → 4,  9/8 → 3,  6/8 → 2
 *
 * Chord is re-read at each group so mid-measure changes are handled.
 */
function buildNocturne(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const noteDur   = 0.5;   // eighth note
  const groupDur  = 1.5;   // dotted quarter = one compound beat
  const numGroups = Math.round(measureBeats / groupDur);

  for (let g = 0; g < numGroups; g++) {
    const tGroup = g * groupDur;
    const v = getVoices(tGroup);
    if (!v) continue;

    // 8th 1: bass
    events.push(makeNote(v.bass, tGroup,           noteDur, voice, staff, `lh-noc-${mNum}-${g}-b`));
    // 8th 2: mid + high
    events.push(makeNote(v.mid,  tGroup + noteDur, noteDur, voice, staff, `lh-noc-${mNum}-${g}-m`));
    events.push(makeNote(v.high, tGroup + noteDur, noteDur, voice, staff, `lh-noc-${mNum}-${g}-h`));
    // 8th 3: mid + high (repeated)
    events.push(makeNote(v.mid,  tGroup + 1.0,     noteDur, voice, staff, `lh-noc-${mNum}-${g}-m2`));
    events.push(makeNote(v.high, tGroup + 1.0,     noteDur, voice, staff, `lh-noc-${mNum}-${g}-h2`));
  }
  return events;
}

/**
 * POP BALLAD ARPEGGIO (Ron Drotos Lesson 4)
 *
 * Rolling 8th-note LH arpeggio cycling: root→5th→oct→5th
 * Smoother feel than broken_ascending (8ths vs 16ths, fewer subdivisions per beat).
 *
 * 4/4: 8 eighth notes = 2 full root→5th→oct→5th cycles.
 * 3/4: 6 eighth notes = 1.5 cycles (ends on oct after the 2nd loop).
 */
function buildPopArpeggio(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const noteDur = 0.5; // eighth note
  const totalEighths = Math.round(measureBeats / noteDur);

  for (let i = 0; i < totalEighths; i++) {
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;
    const cycle = [v.bass, v.high, v.bass + 12, v.high] as const; // root→5th→oct→5th
    events.push(
      makeNote(cycle[i % 4]!, t, noteDur, voice, staff, `lh-parp-${mNum}-${t.toFixed(3)}-${i}`)
    );
  }
  return events;
}

/**
 * WALKING BASS with chromatic approach (Ron Drotos Lessons 12, 14)
 *
 * Quarter-note bass line walking through chord tones:
 *   beat 1: root
 *   beat 2: 3rd
 *   beat 3: 5th
 *   beat 4: chromatic approach note toward next chord's root (one semitone below/above)
 *           Falls back to 5th if no next chord is available or chord doesn't change.
 *
 * In 3/4: root → 3rd → approach (3 beats).
 * Looks ahead to next measure using the full chords array.
 */
function buildWalkingBass(
  getVoices: (t: number) => ChordVoices | null,
  chords: Array<{ measure: number; t: number; symbol: string }>,
  measureNumber: number,
  measureBeats: number,
  bassMin: number,
  bassMax: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const beats = Math.round(measureBeats);
  const walkSeq = (v: ChordVoices) => [v.bass, v.mid, v.high, v.bass + 12]; // root→3rd→5th→oct

  for (let b = 0; b < beats; b++) {
    const v = getVoices(b);
    if (!v) continue;

    const isLastBeat = b === beats - 1;
    let midi: number;

    if (!isLastBeat) {
      // Walk through chord tones: root(0)→3rd(1)→5th(2)→oct(3)→…
      const seq = walkSeq(v);
      midi = seq[b % 4] ?? v.bass;
    } else {
      // Final beat: chromatic approach toward next chord root
      const nextSym = pickChordAt(chords, measureNumber + 1, 0);
      if (nextSym) {
        const nextV = chordVoicesInRange(nextSym, bassMin, bassMax);
        if (nextV && nextV.bass !== v.bass) {
          // One semitone in the direction of the next root
          const diff = nextV.bass - v.bass;
          midi = diff > 0 ? nextV.bass - 1 : nextV.bass + 1;
          // Clamp to bass range
          midi = Math.max(bassMin, Math.min(bassMax, midi));
        } else {
          midi = v.high; // same chord or parse failure → 5th
        }
      } else {
        midi = v.high; // no next chord info → 5th
      }
    }

    events.push(makeNote(midi, b, 1, voice, staff, `lh-wlk-${mNum}-${b}`));
  }
  return events;
}

/**
 * PEDAL BASS — sustained root (Ron Drotos Lesson 13 / Elton John style)
 *
 * Root note held as a whole note for the entire measure.
 * Creates the spacious, open quality of Elton John / gospel ballads where the LH
 * holds still while the RH moves through neighbor chords (e.g., C → F/C → C).
 *
 * Works in any time signature; always one note per measure.
 */
function buildPedalBass(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  voice: number,
  staff: number,
  mNum: number
): NoteEvent[] {
  const v = getVoices(0);
  if (!v) return [];
  return [makeNote(v.bass, 0, measureBeats, voice, staff, `lh-ped-${mNum}-0`)];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate left-hand accompaniment note events for one measure.
 *
 * Assigns notes to Voice 4 / Staff 2 (LH bass staff of the grand staff).
 * The caller is responsible for placing melody on Staff 1, Voice 1.
 *
 * Returns an empty array (not a rest) when no chord data is available for the
 * measure — the caller can insert a whole-measure rest if desired.
 */
export function generateLhPattern(options: LhPatternOptions): NoteEvent[] {
  const {
    chords,
    measureNumber,
    measureBeats,
    lhPattern,
    // Hallelujah (Leonard Cohen) piano arrangement analysis: LH range 26–69,
    // avg 49 (C#3). Pop/folk piano roots regularly reach C2–E2 (36–40).
    // Classical default was G2 (43); lowered to C2 (36) so pop bass doesn't
    // get octave-shifted up when the root naturally sits in the low register.
    bassMin = 36, // C2  (was G2=43; Hallelujah LH min observed: D1=26, roots ~C2-D2)
    bassMax = 57, // A3
    warnings = [],
  } = options;

  // Helper: active chord voices at a given beat within this measure
  function getVoices(t: number): ChordVoices | null {
    const symbol = pickChordAt(chords, measureNumber, t);
    if (!symbol) return null;
    const v = chordVoicesInRange(symbol, bassMin, bassMax);
    if (!v) {
      warnings.push(`[accomp] m${measureNumber} t=${t}: cannot parse chord "${symbol}" — skipping note`);
    }
    return v;
  }

  // No chord data for this measure at all → return empty (caller decides)
  if (!pickChordAt(chords, measureNumber, 0)) {
    return [];
  }

  const LH_VOICE = 4;
  const LH_STAFF = 2;

  switch (lhPattern) {
    case "alberti":
      return buildAlberti(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "block_beats":
      return buildBlockBeats(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "boom_chick":
      return buildBoomChick(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "broken_ascending":
      return buildBrokenAscending(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "waltz_bass":
      return buildWaltzBass(getVoices, LH_VOICE, LH_STAFF, measureNumber);

    case "serenade_strum":
      return buildSerenadeStrum(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "root_chord_stabs":
      return buildRootChordStabs(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "interval_oscillation":
      return buildIntervalOscillation(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "jazz_shell":
      return buildJazzShell(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "octave_bass":
      return buildOctaveBass(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "nocturne":
      return buildNocturne(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "pop_arpeggio":
      return buildPopArpeggio(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    case "walking_bass":
      return buildWalkingBass(
        getVoices, chords, measureNumber, measureBeats,
        bassMin, bassMax, LH_VOICE, LH_STAFF, measureNumber
      );

    case "pedal_bass":
      return buildPedalBass(getVoices, measureBeats, LH_VOICE, LH_STAFF, measureNumber);

    default:
      warnings.push(`[accomp] Unknown LH pattern "${lhPattern as string}" — no notes generated`);
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT-HAND ACCOMPANIMENT PATTERN LIBRARY
// Source: Piano Worship Example 1 (melody_inner_voice), Example 3 (melody_fill_eighths)
// ─────────────────────────────────────────────────────────────────────────────

export type RhPatternId =
  /**
   * Block chord on every beat — treble range, voice 1 staff 1.
   * Default for homophonic accompaniment. Matches current behaviour.
   */
  | "block_beats"
  /**
   * Two-voice inner texture (Piano Worship Example 1, 4/4 + Example 3, 3/4).
   *   Voice 1 (v1): 8th-note alternation — chord 5th(8th) + chord 3rd(8th) per beat
   *                 Creates the characteristic "chiming" worship inner-voice line.
   *   Voice 2 (v2): sustained root on strong beats (half notes in 4/4, quarters in 3/4)
   *                 Provides harmonic anchor below the chiming line.
   * Best for: polyphonic accompaniment, worship, contemporary, romantic styles.
   */
  | "melody_inner_voice"
  /**
   * Ascending broken-chord 8th fills (Example 3 / Example 4).
   *   Voice 1 (v1): continuous 8th notes cycling root → 3rd → 5th → 3rd per 2 beats.
   *   Smooth, flowing line that connects chords like a flowing inner register.
   * Best for: ballad, lyrical 3/4, romantic accompaniment.
   */
  | "melody_fill_eighths"
  /**
   * Syncopated offbeat chord hits.
   *   Mid + high chord tones on the "and" of each beat (8th-note upbeats).
   *   Produces the characteristic syncopated piano feel of pop / gospel / light jazz.
   *   No notes on the downbeats — the LH bass provides the metric anchor.
   */
  | "syncopated"
  /**
   * Ascending arpeggio per beat (treble range).
   *   Each beat: root(16th) → 3rd(16th) → 5th(16th) → root+oct(16th).
   *   Creates a flowing broken-chord texture across the whole measure.
   *   Best for: romantic, classical, ballad, through-composed passages.
   */
  | "arpeggio"
  /**
   * Melody only — piano RH carries just the melody; no chord accompaniment.
   *   Handled externally by arrangePianoFromSatb: the melody notes are copied
   *   into piano staff 1 voice 1, and no separate Melody part is created.
   *   generateRhPattern returns [] for this value.
   */
  | "melody_only"
  /**
   * Dotted ballad — 3+1 dotted-quarter + 8th groupings (Ron Drotos Lesson 15).
   *   Per 2-beat group: chord(dotted quarter, 1.5 beats) + chord(8th, 0.5 beats).
   *   The short 8th hit falls on the "and of beat 2" (or "and of beat 4"), creating
   *   the signature forward-leaning rhythmic feel of Elton John's "Your Song" and
   *   similar pop ballad piano accompaniments.
   *   In 4/4: 2 groups; in 3/4: 1 group (2 beats) + 1 quarter (beat 3).
   */
  | "dotted_ballad";

export type RhPatternOptions = {
  chords: Array<{ measure: number; t: number; symbol: string }>;
  measureNumber: number;
  /** Total quarter-note beats in the measure */
  measureBeats: number;
  rhPattern: RhPatternId;
  /** Min MIDI for the treble root. Default: 60 = C4 */
  trebleMin?: number;
  /** Max MIDI for the treble root. Default: 72 = C5 */
  trebleMax?: number;
  warnings?: string[];
};

// ─── RH pattern implementations ──────────────────────────────────────────────

/**
 * RH BLOCK BEATS — treble equivalent of the LH block_beats pattern.
 * Root+3rd+5th chord block on every beat as quarter notes.
 * Voice 1, Staff 1. Root placed in treble range (default C4–C5).
 */
function buildRhBlockBeats(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V = 1, S = 1;
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    events.push(makeNote(v.bass, b, 1, V, S, `rh-blk-${mNum}-${b}-r`));
    events.push(makeNote(v.mid,  b, 1, V, S, `rh-blk-${mNum}-${b}-m`));
    events.push(makeNote(v.high, b, 1, V, S, `rh-blk-${mNum}-${b}-h`));
  }
  return events;
}

/**
 * RH MELODY INNER VOICE — Piano Worship Example 1 (4/4) + Example 3 (3/4).
 *
 * Voice 1 (v1, s1): 8th-note alternation — 5th on even 8ths, 3rd on odd 8ths.
 *   The characteristic "chiming" inner-voice texture of worship piano accompaniment.
 *   In 4/4: 8 eighth notes per measure → 4 high/mid pairs.
 *   In 3/4: 6 eighth notes per measure → 3 high/mid pairs.
 *
 * Voice 2 (v2, s1): sustained root on strong beats.
 *   4/4+: half notes at beats 0 and 2.
 *   3/4:  quarter notes on each beat.
 *   2/4:  half note for whole measure.
 */
function buildRhMelodyInnerVoice(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V1 = 1, V2 = 2, S = 1;
  const noteDur = 0.5; // 8th note

  // Voice 1: 8th alternation — high(5th) on even, mid(3rd) on odd
  const totalEighths = Math.round(measureBeats / noteDur);
  for (let i = 0; i < totalEighths; i++) {
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;
    const pitch = i % 2 === 0 ? v.high : v.mid;
    events.push(makeNote(pitch, t, noteDur, V1, S, `rh-miv1-${mNum}-${i}`));
  }

  // Voice 2: sustained root on strong beats
  const v2Dur = measureBeats >= 4 ? 2 : measureBeats === 3 ? 1 : measureBeats;
  for (let b = 0; b < measureBeats - 1e-6; b += v2Dur) {
    const v = getVoices(b);
    if (!v) continue;
    events.push(makeNote(v.bass, b, v2Dur, V2, S, `rh-miv2-${mNum}-${b.toFixed(1)}`));
  }

  return events;
}

/**
 * RH MELODY FILL EIGHTHS — Example 3 (3/4) + Example 4 (4/4).
 *
 * Voice 1 (v1, s1): continuous ascending broken-chord 8th notes.
 *   Cycle: root → 3rd → 5th → 3rd (repeating every 4 8ths = 2 beats).
 *   Smooth flowing inner voice that connects chord changes like a rolled arpeggio.
 *   In 4/4: 8 eighths → 2 full cycles.
 *   In 3/4: 6 eighths → 1.5 cycles (ends on the 5th).
 */
function buildRhMelodyFillEighths(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V1 = 1, S = 1;
  const noteDur = 0.5; // 8th note
  const totalEighths = Math.round(measureBeats / noteDur);

  for (let i = 0; i < totalEighths; i++) {
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;
    // Cycle: root(0) → 3rd(1) → 5th(2) → 3rd(3) → root(4) …
    const seq = [v.bass, v.mid, v.high, v.mid] as const;
    events.push(makeNote(seq[i % 4]!, t, noteDur, V1, S, `rh-mfe-${mNum}-${i}`));
  }

  return events;
}

/**
 * RH SYNCOPATED — offbeat chord hits on the "and" of every beat.
 *
 * Only fires on odd 8th-note positions (t = 0.5, 1.5, 2.5 …).
 * The downbeat rests let the LH bass articulate the metric pulse cleanly.
 * Mid + high chord tones only (no root — root lives in the LH bass).
 */
function buildRhSyncopated(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V = 1, S = 1;
  const noteDur = 0.5; // 8th note
  const totalEighths = Math.round(measureBeats / noteDur);
  for (let i = 0; i < totalEighths; i++) {
    if (i % 2 === 0) continue; // skip downbeats — fire only on offbeats
    const t = i * noteDur;
    const v = getVoices(t);
    if (!v) continue;
    events.push(makeNote(v.mid,  t, noteDur, V, S, `rh-syn-${mNum}-${i}-m`));
    events.push(makeNote(v.high, t, noteDur, V, S, `rh-syn-${mNum}-${i}-h`));
  }
  return events;
}

/**
 * RH ARPEGGIO — ascending 16th-note broken chord per beat (treble range).
 *
 * Each beat: root(16th) → 3rd(16th) → 5th(16th) → root+octave(16th).
 * Re-reads the chord on each beat to handle mid-measure changes.
 * Best for: romantic, classical, ballad, long-note melody passages.
 */
function buildRhArpeggio(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V = 1, S = 1;
  const noteDur = 0.25; // 16th note
  for (let b = 0; b < Math.round(measureBeats); b++) {
    const v = getVoices(b);
    if (!v) continue;
    const seq = [v.bass, v.mid, v.high, v.bass + 12] as const;
    for (let i = 0; i < 4; i++) {
      events.push(makeNote(seq[i]!, b + i * noteDur, noteDur, V, S, `rh-arp-${mNum}-${b}-${i}`));
    }
  }
  return events;
}

/**
 * RH DOTTED BALLAD — Elton John / "Your Song" feel (Ron Drotos Lesson 15)
 *
 * 3+1 subdivision: dotted quarter (1.5 beats) + 8th (0.5 beats) per 2-beat group.
 * The short 8th hit lands on the "and of beat 2" (t=1.5) and "and of beat 4" (t=3.5),
 * creating the characteristic forward-leaning, guitar-strum feel of pop ballad piano.
 *
 * Per group (2 beats):
 *   tGroup + 0.0: mid+high chord (dotted quarter, 1.5 beats)
 *   tGroup + 1.5: mid+high chord (8th, 0.5 beats)
 *
 * 4/4: 2 complete groups.
 * 3/4: 1 complete group (2 beats) + remainder quarter on beat 3.
 *
 * Uses mid+high only — root lives in the LH pedal or walking bass.
 */
function buildRhDottedBallad(
  getVoices: (t: number) => ChordVoices | null,
  measureBeats: number,
  mNum: number
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const V = 1, S = 1;

  const numGroups = Math.floor(measureBeats / 2);

  for (let g = 0; g < numGroups; g++) {
    const tGroup = g * 2;

    // Dotted quarter hit (1.5 beats)
    const v0 = getVoices(tGroup);
    if (v0) {
      events.push(makeNote(v0.mid,  tGroup,       1.5, V, S, `rh-db-${mNum}-${g}-m0`));
      events.push(makeNote(v0.high, tGroup,       1.5, V, S, `rh-db-${mNum}-${g}-h0`));
    }
    // 8th note hit — "and of beat 2" / "and of beat 4"
    const v1 = getVoices(tGroup + 1.5);
    if (v1) {
      events.push(makeNote(v1.mid,  tGroup + 1.5, 0.5, V, S, `rh-db-${mNum}-${g}-m1`));
      events.push(makeNote(v1.high, tGroup + 1.5, 0.5, V, S, `rh-db-${mNum}-${g}-h1`));
    }
  }

  // Remainder beat(s) after last complete group (e.g., beat 3 in 3/4)
  const remainStart = numGroups * 2;
  if (remainStart < measureBeats - 1e-6) {
    const vR = getVoices(remainStart);
    if (vR) {
      const remainDur = measureBeats - remainStart;
      events.push(makeNote(vR.mid,  remainStart, remainDur, V, S, `rh-db-${mNum}-rem-m`));
      events.push(makeNote(vR.high, remainStart, remainDur, V, S, `rh-db-${mNum}-rem-h`));
    }
  }

  return events;
}

// ─── RH main export ───────────────────────────────────────────────────────────

/**
 * Generate right-hand inner-voice note events for one measure.
 *
 * Assigns notes to Voice 1 (and optionally Voice 2) on Staff 1 (treble staff).
 * Root placed in the treble range [trebleMin, trebleMax] (default C4–C5).
 *
 * Returns an empty array when no chord data is available for the measure.
 */
export function generateRhPattern(options: RhPatternOptions): NoteEvent[] {
  const {
    chords,
    measureNumber,
    measureBeats,
    rhPattern,
    trebleMin = 60, // C4
    trebleMax = 72, // C5
    warnings = [],
  } = options;

  function getRhVoices(t: number): ChordVoices | null {
    const symbol = pickChordAt(chords, measureNumber, t);
    if (!symbol) return null;
    const v = chordVoicesInRange(symbol, trebleMin, trebleMax);
    if (!v) {
      warnings.push(`[rh-accomp] m${measureNumber} t=${t}: cannot parse chord "${symbol}" — skipping`);
    }
    return v;
  }

  if (!pickChordAt(chords, measureNumber, 0)) return [];

  switch (rhPattern) {
    case "block_beats":
      return buildRhBlockBeats(getRhVoices, measureBeats, measureNumber);
    case "melody_inner_voice":
      return buildRhMelodyInnerVoice(getRhVoices, measureBeats, measureNumber);
    case "melody_fill_eighths":
      return buildRhMelodyFillEighths(getRhVoices, measureBeats, measureNumber);
    case "syncopated":
      return buildRhSyncopated(getRhVoices, measureBeats, measureNumber);
    case "arpeggio":
      return buildRhArpeggio(getRhVoices, measureBeats, measureNumber);
    case "dotted_ballad":
      return buildRhDottedBallad(getRhVoices, measureBeats, measureNumber);
    case "melody_only":
      return []; // melody is placed in piano RH by the caller; nothing extra needed
    default:
      warnings.push(`[rh-accomp] Unknown RH pattern "${rhPattern as string}" — falling back to melody_inner_voice`);
      return buildRhMelodyInnerVoice(getRhVoices, measureBeats, measureNumber);
  }
}
