// src/arrange/woodwinds/woodwindArranger.ts
//
// Woodwind quartet arranger — built on the same DP engine as the string
// ensemble arranger.
//
// Architecture (mirrors piano_with_strings approach):
// 1. Run arrangeStringEnsemble (DP) on the input score → proper 4-voice
//    harmonic separation in the vln1/vln2/vla/vc register slots.
// 2. Drop Double Bass (woodwind quartet has 4 voices).
// 3. Remap each string part to its woodwind counterpart:
//      Violin I  → Flute          (top voice, highest register)
//      Violin II → Oboe           (upper-middle voice)
//      Viola     → Clarinet in Bb (lower-middle voice, concert sounding)
//      Cello     → Bassoon        (bass voice)
// 4. Clamp any notes that fall outside the woodwind range by octave shift.
// 5. Apply rhythm grid from source melody (same post-processor as strings)
//    so voices have quarter-note activity even when the template is sparse.

import type { ScoreModel, NoteEvent } from "../../score/types";
import { arrangeStringEnsemble } from "../strings/stringArranger";
import { arrangeWoodwindPolyphonic } from "./polyphony/woodwindPolyphonicArranger";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import type { ProfileId } from "../strings/types";
import {
  WOODWIND_RANGES,
  WOODWIND_TO_STRING_VOICE,
  WOODWIND_PART_META,
  WOODWIND_CHARACTER,
  QUARTET_VOICES,
  QUINTET_VOICES,
  type WoodwindVoiceId,
} from "./woodwindRanges";
import { shareMelodyAmongWinds, shareMelodySentence } from "./shareMelody";
import { buildCandidatesForSlice } from "../strings/candidates";
import type { Slice, VoiceId, Voicing } from "../strings/types";

type ChordEvent = { measure: number; t: number; symbol: string };

// ─────────────────────────────────────────────────────────────────────────────

function clampMidiByOctave(
  midi: number,
  range: { absMin: number; absMax: number }
): number {
  let out = midi;
  while (out < range.absMin) out += 12;
  while (out > range.absMax) out -= 12;
  return out;
}

/**
 * Octave-fit into the absolute range, then nudge toward the instrument's
 * sweet-spot (preferred) register when an octave shift keeps it in range.
 * This steers each woodwind into its best-sounding tessitura per Adler/Forsyth
 * (e.g. flute melodies sit in G4–E6, not the weak low octave; oboe in its
 * plaintive middle; horn in the noble C3–C5 register).
 */
function clampToSweetSpot(
  midi: number,
  range: { absMin: number; absMax: number; prefMin: number; prefMax: number }
): number {
  let m = clampMidiByOctave(midi, range);
  // Already in sweet spot → done.
  if (m >= range.prefMin && m <= range.prefMax) return m;
  // Too low: try up an octave if it lands within absolute range.
  if (m < range.prefMin) {
    const up = m + 12;
    if (up <= range.absMax && Math.abs(up - midpoint(range)) <= Math.abs(m - midpoint(range))) return up;
  }
  // Too high: try down an octave.
  if (m > range.prefMax) {
    const down = m - 12;
    if (down >= range.absMin && Math.abs(down - midpoint(range)) <= Math.abs(m - midpoint(range))) return down;
  }
  return m;
}

function midpoint(r: { prefMin: number; prefMax: number }): number {
  return (r.prefMin + r.prefMax) / 2;
}

/**
 * Thin a measure's onset-time grid according to an instrument's agility.
 *
 * Calibrated against real woodwind ensemble scores, where Flute/Oboe/Clarinet/
 * Bassoon ALL play 85–97% fast notes — so those voices (agility ≥0.8) follow the
 * source rhythm in full. Only the Horn (agility <0.5) is the idiomatic sustained
 * pad and gets thinned to half-measure onsets (Adler/Forsyth).
 *   agility ≥0.8 OR melody : keep every onset — full activity
 *   agility 0.5–0.8        : keep on-beat (quarter-note) onsets
 *   agility <0.5 (Horn)    : keep half-measure onsets — sustained pad
 */
function thinOnsetsByAgility(
  times: number[],
  agility: number,
  measureLen: number,
  isMelody: boolean
): number[] {
  if (isMelody || agility >= 0.8) return times;
  const keepHalfOnly = agility < 0.5;
  const step = keepHalfOnly ? measureLen / 2 : 1.0; // half-measure pad vs quarter-note
  const kept = times.filter((t) => {
    const r = Math.round(t / step) * step;
    return Math.abs(t - r) < 1e-6;
  });
  // Always keep the downbeat so the voice never drops out entirely.
  if (!kept.length || Math.abs(kept[0]! - 0) > 1e-6) kept.unshift(0);
  return Array.from(new Set(kept)).sort((a, b) => a - b);
}

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

function snapDur(dur: number): number {
  const STANDARD = [4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 0.5, 0.25] as const;
  for (const s of STANDARD) { if (s <= dur + 1e-9) return s; }
  return 0.25;
}

function pickChordAt(
  chords: ChordEvent[],
  measure: number,
  t: number
): string | null {
  const evs = chords.filter(c => Number(c.measure) === Number(measure));
  if (!evs.length) return null;
  let best: ChordEvent | null = null;
  for (const c of evs) { if (Number(c.t) <= t) best = c; }
  return best?.symbol ?? evs[0]?.symbol ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-processor: apply source melody rhythm to each woodwind voice while
// keeping the DP-assigned register (same DP-anchor approach as strings).
// ─────────────────────────────────────────────────────────────────────────────

function applyMelodyRhythmToWoodwinds(
  score: ScoreModel,
  sourcePart: any,            // melody/soprano source part from the input score
  chords: ChordEvent[],
  key: { fifths: number; mode: "major" | "minor" },
  activity?: Partial<Record<WoodwindVoiceId, WoodwindActivity>>
): void {
  if (!sourcePart) return;

  const sourceMeasures: any[] = sourcePart.measures ?? [];
  const FILL_STEP = 1.0; // quarter-note minimum activity

  for (const part of (score as any).parts ?? []) {
    const nameLC = String(part?.name ?? "").toLowerCase().trim();
    // Identify woodwind voice by part name
    let wvId: WoodwindVoiceId | null = null;
    if (nameLC === "flute")                         wvId = "fl";
    else if (nameLC === "oboe")                     wvId = "ob";
    else if (nameLC === "clarinet in bb" || nameLC === "clarinet") wvId = "cl";
    else if (nameLC === "horn in f" || nameLC === "horn") wvId = "hn";
    else if (nameLC === "bassoon")                  wvId = "bn";
    if (!wvId) continue;

    const stringVoice = WOODWIND_TO_STRING_VOICE[wvId];
    const range       = WOODWIND_RANGES[wvId];
    const character   = WOODWIND_CHARACTER[wvId];
    // User activity override (if set) replaces the instrument's default agility.
    const userActivity = activity?.[wvId];
    const effAgility   = userActivity ? activityToAgility(userActivity) : character.agility;
    // Flute is the top voice = melody carrier; it always keeps full activity
    // unless the user explicitly grounds it.
    const isMelody    = wvId === "fl" && userActivity !== "grounded" && userActivity !== "less_active";
    let prevMidi: number | null = null;

    part.measures = (part.measures ?? []).map((m: any) => {
      const mnum       = Number(m.number);
      const beats      = Number(m.attributes?.time?.beats ?? 4);
      const beatType   = Number(m.attributes?.time?.beat_type ?? 4);
      const measureLen = beats * (4 / beatType);

      // ── DP anchor schedule for this voice ────────────────────────────────
      const dpSchedule = new Map<number, number>();
      for (const ev of (m.events ?? [])) {
        if (ev.type !== "note" || ev.isRest) continue;
        const m2 = eventMidi(ev);
        if (m2 !== null) dpSchedule.set(Number(ev.t ?? 0), m2);
      }
      const getDpAnchor = (t: number): number | null => {
        let best: number | null = null;
        for (const [st, pitch] of dpSchedule) {
          if (st <= t + 1e-9) best = pitch;
        }
        return best;
      };

      // ── Rhythm grid from source melody onsets ────────────────────────────
      const srcM = sourceMeasures.find((pm: any) => Number(pm.number) === mnum);
      const onsetSet = new Set<number>();
      // How long the source holds each of those onsets. Taking the distance to
      // the next onset instead butts every note against the one after it, which
      // is what turned a chart written 71% in eighths with 42% of its time
      // silent into a wall of quarters sounding 92% of the time. The rests in a
      // wind part are the phrasing; they are not spare room to fill.
      const srcDur = new Map<number, number>();
      let srcNotes = 0;
      let srcSlashes = 0;
      if (srcM) {
        for (const ev of (srcM.events ?? [])) {
          if (ev.type !== "note") continue;
          const t = Number(ev.t ?? 0);
          if (t < 0 || t >= measureLen) continue;
          srcNotes++;
          if (String(ev.notehead ?? "").toLowerCase() === "slash") srcSlashes++;
          const key = Math.round(t * 1000) / 1000;
          onsetSet.add(key);
          const d = Number(ev.dur);
          if (Number.isFinite(d) && d > 0) {
            // A chord sounds as one attack: take the longest of its notes.
            srcDur.set(key, Math.max(srcDur.get(key) ?? 0, d));
          }
        }
      }
      // Rhythm slashes rather than written notes: the chart is naming a groove
      // here, not a melody.
      const barIsChordRhythm = srcNotes > 0 && srcSlashes / srcNotes >= 0.5;

      // Does the source's tune ever stop in this bar? A chart melody often runs
      // wall to wall — this one's 56 melody bars sound 100% of their length —
      // and a tune that never stops is a tune nobody can play.
      let covered = 0;
      {
        const ts = [...srcDur.keys()].sort((a, b) => a - b);
        let cursor = 0;
        for (const t of ts) {
          const end = Math.min(measureLen, t + (srcDur.get(t) ?? 0));
          if (end > cursor) { covered += end - Math.max(cursor, t); cursor = end; }
        }
      }
      // Dense AND unbroken. "Unbroken" alone catches a hymn in whole notes,
      // which is continuous but gives the player one note a bar to shape and
      // needs no beat of rest carved out of it — cutting the last beat of every
      // bar would mangle it. Three or more attacks with no air between them is a
      // stream; this chart's melody bars run 4.5.
      const sourceNeverStops =
        srcDur.size >= 3 && covered >= measureLen - 1e-6;
      // A bar the source leaves empty: an instrumental gap, where there is no
      // melody to carry and no rhythm to read.
      const sourceSilent = !onsetSet.size;
      if (sourceSilent) {
        for (let t = 0; t < measureLen; t += FILL_STEP)
          onsetSet.add(Math.round(t * 1000) / 1000);
      }

      // What an INVENTED onset is worth — one the grid adds because the source
      // has nothing there. Three-quarters of its slot: enough to carry the
      // harmony, with the last quarter left as air.
      //
      // Giving it the whole slot is what made the 30 source-empty bars of this
      // chart four quarter-notes jammed together in all four parts at once —
      // 4.0 notes a bar and 94% sounding in every one of them, against the
      // reference's 52-72%. Giving it the shortest note in the bar instead went
      // too far the other way and left the accompanying voices 15 points under
      // the reference where the music actually is.
      //
      // In a gap the roles invert, which is the oldest rule in the book
      // (Tovey): the melody instrument leads where the chart gives nothing, and
      // the others recede under it. The reference does exactly this — its flute
      // sounds 72% of an empty bar while its oboe drops to 52% — so an
      // accompanying voice takes a short attack there and the melody keeps the
      // fuller one.
      const slotFill = (slot: number) => slot * 0.75;
      const gapFill = (slot: number) =>
        sourceSilent && !isMelody ? Math.min(slot, 0.5) : slotFill(slot);

      // Fill gaps > 1 beat with quarter notes, so an ACCOMPANYING voice keeps the
      // harmony present while the melody is resting.
      //
      // Not for the melody carrier. Where the tune rests, that rest is the tune —
      // filling it invented 245 attacks on this chart, which is most of the
      // difference between our flute's 543 notes and the reference's 298, and it
      // fills in exactly the places a player would breathe.
      if (!isMelody) {
        const sorted = Array.from(onsetSet).sort((a, b) => a - b);
        const bounds = [...sorted, measureLen];
        for (let i = 0; i < bounds.length - 1; i++) {
          const gs = bounds[i]!, ge = bounds[i + 1]!;
          if (ge - gs > FILL_STEP + 1e-9) {
            for (let ft = gs + FILL_STEP; ft < ge - 1e-9; ft += FILL_STEP)
              onsetSet.add(Math.round(ft * 1000) / 1000);
          }
        }
      }

      // The tune breathes at the end of the bar.
      //
      // Where the reference rests inside its melody bars is the one strong
      // signal in its phrasing: beat 3 is silent in 44 of 56, beat 3.5 in 35,
      // against 6 at beat 1. It drops whatever sits on the last beat about 69%
      // of the time. Which onsets it keeps elsewhere is nearly flat by beat
      // position — 31% to 55% — so there is no metrical hierarchy to read off,
      // and a strong-beat rule would be invention wearing the clothes of
      // evidence. The end-of-bar breath is the part the data actually supports.
      //
      // This DOES drop melody notes, so it is gated on the source leaving the
      // player no air of its own. A source that already rests is phrased
      // already: a hymn in half notes keeps every one of them.
      const breathes = isMelody && !barIsChordRhythm && sourceNeverStops;
      const breathFrom = measureLen - FILL_STEP;
      if (breathes) {
        for (const t of [...onsetSet]) if (t >= breathFrom - 1e-6) onsetSet.delete(t);
        if (!onsetSet.size) onsetSet.add(0);   // never drop the bar entirely
      }

      // Over a groove the melody holds a note; it does not drum along with the
      // chord rhythm. Keeping every slash onset gave the flute 2.9 attacks a bar
      // where the reference writes 1.4 — and simply lengthening those attacks
      // made it louder, not calmer, because the count never came down. So thin
      // to the half-measure first, then let what is left sustain.
      if (isMelody && barIsChordRhythm) {
        const half = measureLen / 2;
        const kept = [...onsetSet].filter(
          (t) => Math.abs(t - Math.round(t / half) * half) < 1e-6
        );
        if (!kept.length) kept.push(0);        // never drop the bar entirely
        onsetSet.clear();
        for (const t of kept) onsetSet.add(t);
      }

      // Thin onsets by the instrument's agility so each plays to its idiom:
      // Flute/Clarinet stay busy, Oboe/Bassoon move on beats, Horn sustains.
      const thinned = thinOnsetsByAgility(
        Array.from(onsetSet).sort((a, b) => a - b),
        effAgility,
        measureLen,
        isMelody
      );
      const times = [...thinned];
      times.push(measureLen);

      // ── Build events ──────────────────────────────────────────────────────
      const events: NoteEvent[] = [];
      for (let i = 0; i < times.length - 1; i++) {
        const t      = times[i]!;
        const next   = times[i + 1]!;
        const capDur = measureLen - t;
        if (capDur <= 0) continue;
        // The Horn is the one idiomatic sustained pad (Adler/Forsyth), and
        // thinOnsetsByAgility already hands it a half-measure grid — it should
        // hold through to its next onset.
        //
        // The MELODY carrier takes the length the source wrote, so the silence
        // between its attacks survives; that silence is its phrasing. An
        // accompanying voice does not copy it. Lifting the melody's exact note
        // lengths into the harmony left the oboe, clarinet and bassoon 8-18
        // points under the reference wherever the music actually was — the
        // melody's breathing is not the harmony's. They hold three-quarters of
        // their slot instead, and recede to a short attack in a gap.
        const sustains = effAgility < 0.5;
        const own = isMelody ? srcDur.get(t) : undefined;
        const want = sustains
          ? next - t
          : own !== undefined
            // A slash bar is the chart telling the rhythm section what to play;
            // it is not a tune. Reading its chord rhythm as melody gave the
            // flute 2.9 attacks a bar where the reference writes 1.4, 63% of
            // them a half note or longer — it sustains over the groove rather
            // than drumming along with it.
            //
            // Half of its (now half-measure) span, then air. Holding for the
            // WHOLE span is how the first attempt at this made the flute louder
            // instead of calmer: fewer attacks, but each one filling the bar,
            // came to 77% sounding against the reference's 56%.
            ? (isMelody && barIsChordRhythm ? Math.max(own, (next - t) * 0.5) : own)
            : gapFill(next - t);
        // Dropping the late onsets is not enough on its own: a note starting
        // earlier can still hold straight through the breath. Release it at the
        // barline's door instead.
        const ceiling = breathes ? Math.max(0.25, breathFrom - t) : capDur;
        const dur = snapDur(Math.min(capDur, ceiling, next - t, want));
        if (dur <= 0) continue;

        const slice: Slice = {
          measure: mnum, t, dur,
          melodyMidi: null,
          chordSymbol: pickChordAt(chords, mnum, t),
        };
        const prevVoicing: Voicing | null = prevMidi !== null
          ? { vln1: null, vln2: null, vla: null, vc: null, cb: null, [stringVoice]: prevMidi } as any
          : null;

        const candidateMap = buildCandidatesForSlice({
          slice, prevVoicing,
          keyFifths: key.fifths,
          keyMode:   key.mode,
        });
        const cands = candidateMap[stringVoice as VoiceId];

        // Anchor determines which chord tone wins.
        // Flute/Oboe/Clarinet: use DP-assigned register (preserves voice spread).
        // Bassoon: ignore DP anchor and target the mid-point of its preferred
        //   low register (~A2, MIDI 45) so the root/bass candidates from the
        //   "cb" slot land in the characteristic bass octave.
        const dpAnchor = getDpAnchor(t);
        const anchor   = wvId === "bn"
          ? (prevMidi ?? Math.round((range.prefMin + 45) / 2)) // low-register bias
          : dpAnchor !== null
            ? dpAnchor
            : (prevMidi ?? Math.round((range.prefMin + range.prefMax) / 2));

        let midi: number | null = null;
        if (cands.length) {
          midi = cands.reduce((best, c) =>
            Math.abs(c - anchor) < Math.abs(best - anchor) ? c : best
          );
          // Steer into the instrument's sweet-spot register (Adler/Forsyth).
          midi = clampToSweetSpot(midi, range);
        }

        if (midi === null) {
          events.push({
            id: `${wvId}-r-${mnum}-${t}`,
            t, dur, type: "rest", voice: 1, staff: 1, isRest: true,
          } as any);
        } else {
          prevMidi = midi;
          events.push({
            id: `${wvId}-n-${mnum}-${t}`,
            t, dur, type: "note",
            pitch: midiToPitch(midi),
            voice: 1, staff: 1,
          });
        }
      }
      return { ...m, events };
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export type WoodwindActivity = "grounded" | "less_active" | "active" | "high_active";

export type WoodwindArrangerOptions = {
  profile?:           ProfileId;
  chords?:            ChordEvent[];
  key?:               { fifths: number; mode: "major" | "minor" };
  warnings?:          string[];
  /** true = Flute/Oboe/Clarinet/Horn/Bassoon quintet; false (default) = quartet without horn */
  quintet?:           boolean;
  /**
   * Optional override for the rhythm-template part.  When set (e.g. the frozen
   * piano part in piano_with_woodwinds mode) it is used as the onset-time grid
   * for all upper voices instead of the auto-detected melody part.
   * The function filters to RH notes (staff=1 or voice≤2) automatically.
   */
  rhythmSourcePart?:  any;
  /**
   * Per-instrument activity override. When set for a voice it replaces the
   * instrument's idiomatic default agility (controls rhythmic density):
   *   grounded → sustained pad   less_active → on-beat
   *   active   → follow source   high_active → follow source (no thinning)
   */
  activity?: Partial<Record<WoodwindVoiceId, WoodwindActivity>>;
  /**
   * Real counterpoint mode. When true, routes through arrangeWoodwindPolyphonic
   * (motif imitation, staggered entries, rhythm stratification, suspensions)
   * instead of the block-chord DP — and SKIPS the uniform-rhythm post-processor
   * so each voice keeps its independent rhythm. Use for "contrapuntal" texture.
   */
  polyphonic?: boolean;
  /** Difficulty level passed to the polyphonic engine (rule strictness / rhythm complexity). */
  level?: string;
};

/** Map a user activity level to an effective agility for onset thinning. */
function activityToAgility(a: WoodwindActivity): number {
  switch (a) {
    case "grounded":    return 0.2;  // sustained pad (half-measure)
    case "less_active": return 0.6;  // on-beat (quarter grid)
    case "active":      return 0.9;  // follow source rhythm
    case "high_active": return 1.0;  // follow source rhythm, never thinned
  }
}

/**
 * Remap the 4/5 string parts produced by an arranger into woodwind instruments,
 * clamping each note into its instrument's sweet-spot register.
 */
function remapStringPartsToWoodwinds(
  stringScoreModel: ScoreModel,
  voices: WoodwindVoiceId[]
): ScoreModel {
  const stringParts = (stringScoreModel.parts ?? []).slice(0, voices.length);
  const woodwindParts = stringParts.map((part: any, idx: number) => {
    const wvId  = voices[idx]!;
    const meta  = WOODWIND_PART_META[wvId];
    const range = WOODWIND_RANGES[wvId];
    const measures = (part.measures ?? []).map((m: any) => {
      const events = (m.events ?? []).map((ev: any) => {
        if (ev.type !== "note" || !ev.pitch) return ev;
        const midi = eventMidi(ev);
        if (midi === null) return ev;
        const clamped = clampToSweetSpot(midi, range);
        if (clamped === midi) return ev;
        return { ...ev, pitch: midiToPitch(clamped) };
      });
      return { ...m, events };
    });
    return { ...part, part_id: meta.part_id, name: meta.name, instrument: meta.instrument, staves: 1, measures };
  });
  return {
    ...(stringScoreModel as any),
    parts: woodwindParts,
    meta:  { ...(stringScoreModel as any).meta, ensemble: "woodwind_ensemble" },
  } as any;
}

/**
 * Arrange a score as a woodwind quartet or quintet.
 *
 * Two engines, selected by `polyphonic`:
 *  • Block/homophonic (default): arrangeStringEnsemble DP → remap → apply a
 *    shared source-rhythm grid (each voice picks chord tones; voices align).
 *  • Counterpoint (polyphonic=true): arrangeWoodwindPolyphonic → remap, KEEPING
 *    the engine's independent rhythms (motif imitation, staggered entries,
 *    rhythm stratification, suspensions). The uniform-rhythm post-processor is
 *    skipped so the polyphony is preserved.
 */
export function arrangeWoodwindEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: WoodwindArrangerOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile  = options.profile ?? "melody_harmony";
  const quintet  = options.quintet ?? false;
  const voices   = quintet ? QUINTET_VOICES : QUARTET_VOICES;

  // ── Counterpoint path: real polyphony, no rhythm flattening ──────────────
  if (options.polyphonic) {
    const polyResult = arrangeWoodwindPolyphonic(score, chords, { level: options.level });
    warnings.push(...(polyResult.warnings ?? []));
    const woodwindScore = remapStringPartsToWoodwinds(polyResult.scoreModel as ScoreModel, voices);
    // NOTE: deliberately NOT calling applyMelodyRhythmToWoodwinds — that forces
    // every voice onto one shared onset grid, which would collapse the
    // independent contrapuntal rhythms back into homophony.
    return { scoreModel: woodwindScore, warnings };
  }

  // ── Block/homophonic path ────────────────────────────────────────────────
  const stringResult = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(stringResult.warnings ?? []));
  const woodwindScore = remapStringPartsToWoodwinds(stringResult.scoreModel as ScoreModel, voices);

  // Rhythm post-processing — shared source-rhythm grid per voice.
  const key = options.key ?? { fifths: 0, mode: "major" as const };

  // When a piano source is provided, filter to RH notes only so the rhythm
  // matches the piano melody rather than both hands combined.
  let rhythmPart: any = options.rhythmSourcePart ?? null;
  if (!rhythmPart) {
    rhythmPart = (score.parts ?? []).find((p: any) => {
      const n = String(p?.name ?? "").toLowerCase();
      return n.includes("soprano") || n.includes("melody") || n.includes("voice");
    }) ?? score.parts?.[0] ?? null;
  } else {
    const pianoMeasures: any[] = (rhythmPart.measures ?? []).map((m: any) => {
      const events = (m.events ?? []).filter((ev: any) => {
        if (ev.type !== "note") return false;
        const staff = Number(ev.staff ?? 1);
        const voice = Number(ev.voice ?? 1);
        return staff === 1 || voice <= 2; // right hand only
      });
      return { ...m, events };
    });
    rhythmPart = { ...rhythmPart, measures: pianoMeasures };
  }

  if (rhythmPart && chords.length) {
    applyMelodyRhythmToWoodwinds(woodwindScore, rhythmPart, chords, key, options.activity);

    // The flute is the fixed melody carrier on this path — WOODWIND_TO_STRING_VOICE
    // hands it Violin I and the others an inner line for the whole piece. Pass the
    // tune around so the clarinet is not reading the viola part from bar 1 to the
    // end.
    //
    // Who may hold it. The flute needs the same test as `isMelody` above: if it is
    // grounded or less active there is no foreground line to pass in the first
    // place. For the other two, only "grounded" disqualifies. The default texture
    // marks the oboe and clarinet "less_active", but that describes the ACCOMPANYING
    // role, which is the very thing meant to rotate — reading it as "never leads"
    // is what froze the clarinet into an eight-semitone band for 124 bars. A
    // grounded voice is a sustained pad by idiom and genuinely should not take a
    // tune.
    const leads = (v: "fl" | "ob" | "cl") => {
      const a = options.activity?.[v];
      if (v === "fl") return a !== "grounded" && a !== "less_active";
      return a !== "grounded";
    };
    const shared = shareMelodyAmongWinds((woodwindScore as any).parts, { eligible: leads });
    const line = shareMelodySentence(shared);
    if (line) warnings.push(line);
  }

  return { scoreModel: woodwindScore, warnings };
}
