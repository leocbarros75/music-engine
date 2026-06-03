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
    else if (nameLC === "bassoon")                  wvId = "bn";
    if (!wvId) continue;

    const stringVoice = WOODWIND_TO_STRING_VOICE[wvId];
    const range       = WOODWIND_RANGES[wvId];
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

      const times = Array.from(onsetSet).sort((a, b) => a - b);
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
          // Clamp to woodwind range
          midi = clampMidiByOctave(midi, range);
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
  profile?: ProfileId;
  chords?: ChordEvent[];
  key?: { fifths: number; mode: "major" | "minor" };
  warnings?: string[];
};

/**
 * Arrange a score as a woodwind quartet (Flute, Oboe, Clarinet in Bb, Bassoon).
 *
 * Uses the same DP voice-separation engine as the string ensemble:
 *   1. Run arrangeStringEnsemble → 5-voice SATB-like arrangement.
 *   2. Drop Double Bass; remap Vln I/II, Vla, Vc to Fl/Ob/Cl/Bn.
 *   3. Clamp any notes outside each instrument's sounding range by octave.
 *   4. Apply source melody rhythm to all four voices (quarter-note minimum),
 *      keeping each voice's DP-assigned register for proper voice separation.
 */
export function arrangeWoodwindEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: WoodwindArrangerOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile  = options.profile ?? "melody_harmony";

  // ── 1. Run the string DP ─────────────────────────────────────────────────
  const stringResult = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(stringResult.warnings ?? []));

  // ── 2. Take the 4 upper parts (Vln I, II, Vla, Vc); drop Double Bass ────
  const stringParts = (stringResult.scoreModel.parts ?? []).slice(0, 4);

  const wvOrder: WoodwindVoiceId[] = ["fl", "ob", "cl", "bn"];
  const woodwindParts = stringParts.map((part: any, idx: number) => {
    const wvId  = wvOrder[idx]!;
    const meta  = WOODWIND_PART_META[wvId];
    const range = WOODWIND_RANGES[wvId];

    // Clamp every note into the woodwind's sounding range
    const measures = (part.measures ?? []).map((m: any) => {
      const events = (m.events ?? []).map((ev: any) => {
        if (ev.type !== "note" || !ev.pitch) return ev;
        const midi = eventMidi(ev);
        if (midi === null) return ev;
        const clamped = clampMidiByOctave(midi, range);
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
    parts:     woodwindParts,
    meta: {
      ...(stringResult.scoreModel as any).meta,
      ensemble: "woodwind_ensemble",
    },
  } as any;

  // ── 3. Apply source melody rhythm so voices have rhythmic activity ────────
  const melodyPart = (score.parts ?? []).find((p: any) => {
    const n = String(p?.name ?? "").toLowerCase();
    return n.includes("soprano") || n.includes("melody") || n.includes("voice");
  }) ?? score.parts?.[0] ?? null;

  const key = options.key ?? { fifths: 0, mode: "major" as const };

  if (melodyPart && chords.length) {
    applyMelodyRhythmToWoodwinds(woodwindScore, melodyPart, chords, key);
  }

  return { scoreModel: woodwindScore, warnings };
}
