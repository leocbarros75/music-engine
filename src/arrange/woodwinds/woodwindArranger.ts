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
  key: { fifths: number; mode: "major" | "minor" }
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
    // Flute is the top voice = melody carrier; it always keeps full activity.
    const isMelody    = wvId === "fl";
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
      if (srcM) {
        for (const ev of (srcM.events ?? [])) {
          if (ev.type !== "note") continue;
          const t = Number(ev.t ?? 0);
          if (t >= 0 && t < measureLen) onsetSet.add(Math.round(t * 1000) / 1000);
        }
      }
      if (!onsetSet.size) {
        for (let t = 0; t < measureLen; t += FILL_STEP)
          onsetSet.add(Math.round(t * 1000) / 1000);
      }

      // Fill gaps > 1 beat with quarter notes
      const sorted = Array.from(onsetSet).sort((a, b) => a - b);
      const bounds = [...sorted, measureLen];
      for (let i = 0; i < bounds.length - 1; i++) {
        const gs = bounds[i]!, ge = bounds[i + 1]!;
        if (ge - gs > FILL_STEP + 1e-9) {
          for (let ft = gs + FILL_STEP; ft < ge - 1e-9; ft += FILL_STEP)
            onsetSet.add(Math.round(ft * 1000) / 1000);
        }
      }

      // Thin onsets by the instrument's agility so each plays to its idiom:
      // Flute/Clarinet stay busy, Oboe/Bassoon move on beats, Horn sustains.
      const thinned = thinOnsetsByAgility(
        Array.from(onsetSet).sort((a, b) => a - b),
        character.agility,
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
        const dur = snapDur(Math.min(capDur, next - t));
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
};

/**
 * Arrange a score as a woodwind quartet or quintet using the string DP engine.
 *
 *   1. Run arrangeStringEnsemble → 5-voice chord-tone arrangement.
 *   2. Remap string parts → woodwind instruments (quartet: 4 parts, quintet: 5).
 *   3. Clamp any notes outside each instrument's sounding range.
 *   4. Apply rhythm grid from source melody (or rhythmSourcePart if provided)
 *      with quarter-note fill so voices stay active even on sparse sources.
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

  // ── 1. Run the string DP ─────────────────────────────────────────────────
  const stringResult = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(stringResult.warnings ?? []));

  // For quartet: take first 4 string parts (Vln I/II/Vla/Vc), drop CB.
  // For quintet: take all 5 (Vln I/II/Vla/Vc/CB = Fl/Ob/Cl/Hn/Bn).
  const stringParts = (stringResult.scoreModel.parts ?? []).slice(0, voices.length);

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

    return {
      ...part,
      part_id:    meta.part_id,
      name:       meta.name,
      instrument: meta.instrument,
      staves:     1,
      measures,
    };
  });

  const woodwindScore: ScoreModel = {
    ...(stringResult.scoreModel as any),
    parts: woodwindParts,
    meta:  { ...(stringResult.scoreModel as any).meta, ensemble: "woodwind_ensemble" },
  } as any;

  // ── 3. Rhythm post-processing ────────────────────────────────────────────
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
    // Build a filtered version of the piano source containing only RH notes
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
    applyMelodyRhythmToWoodwinds(woodwindScore, rhythmPart, chords, key);
  }

  return { scoreModel: woodwindScore, warnings };
}
