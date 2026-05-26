/**
 * arrangePianoWithStrings.ts
 *
 * Takes a piano score and generates a complementary string quartet
 * (Violin I, Violin II, Viola, Cello) that supports the piano harmonically.
 *
 * The output is a 5-part ScoreModel:
 *   1. Piano   (grand staff — original, untouched)
 *   2. Violin I
 *   3. Violin II
 *   4. Viola
 *   5. Cello
 *
 * The strings provide a sustained harmonic cushion — the "piano + strings"
 * chamber texture of Brahms Piano Quartets / Schumann Piano Quintet.
 * They are voiced to complement (not compete with) the piano:
 *   – Notes are derived from the full piano harmony (all voices analysed)
 *   – SATB block-chord harmonisation → mapped to string instrument ranges
 *   – Slower movement than the piano by design
 */

import type { ScoreModel } from "../score/types";
import { harmonizeSatbFromChords } from "../harmonize/satb/harmonizeSatbFromChords";
import { inferChordsFromAllVoices } from "../harmonize/satb/inferChordsFromMelody";
import {
  clampMidiToInstrumentRange,
  getInstrumentSpec,
  midiToPitch,
  pitchToMidi
} from "../instruments/instrumentCatalog";

export type ArrangePianoWithStringsOptions = {
  styleProfile?: string;
  level?: string;
  warnings?: string[];
};

// ── helpers ────────────────────────────────────────────────────────────────

function cloneDeep<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Clone a SATB source part and remap every note into the given string
 * instrument's playable range (clamped, not transposed by octave).
 */
function remapToStringInstrument(
  srcPart: any,
  instrumentId: string,
  partId: string,
  partName: string
): any {
  const spec = getInstrumentSpec(instrumentId);

  const measures = (srcPart?.measures ?? []).map((m: any, mi: number) => {
    const events = (m?.events ?? []).map((ev: any) => {
      if (ev?.type !== "note") return cloneDeep(ev);
      const midi =
        typeof ev?.midi === "number"
          ? ev.midi
          : ev?.pitch
            ? pitchToMidi(ev.pitch)
            : null;
      if (midi === null || !spec) return cloneDeep(ev);
      const clamped = clampMidiToInstrumentRange(midi, spec);
      return { ...cloneDeep(ev), midi: clamped, pitch: midiToPitch(clamped) };
    });

    const m2 = { ...cloneDeep(m), events };
    // Attributes belong only on the first measure
    if (mi > 0 && m2.attributes) delete m2.attributes;
    return m2;
  });

  return {
    part_id: partId,
    name: partName,
    instrument: instrumentId,
    staves: 1,
    measures
  };
}

/** Find a part whose name contains one of the given substrings; fall back by index. */
function findPart(score: ScoreModel, names: string[], fallbackIndex: number): any | null {
  const parts = (score as any).parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (names.some(nm => n.includes(nm))) return p;
  }
  return parts[fallbackIndex] ?? null;
}

// ── main export ────────────────────────────────────────────────────────────

export function arrangePianoWithStrings(
  pianoScore: ScoreModel,
  options: ArrangePianoWithStringsOptions = {}
): ScoreModel {
  const warnings = options.warnings ?? [];

  // ── 1. Infer chord events from all piano voices ─────────────────────────
  const chords = inferChordsFromAllVoices(pianoScore);
  if (!chords.length) {
    warnings.push(
      "[piano+strings] No chords could be inferred from the piano score. " +
      "String parts will be empty."
    );
  }

  // ── 2. Harmonize SATB — homophonic block chords = sustained cushion ─────
  let satbScore: any = null;
  if (chords.length) {
    try {
      let result: any = (harmonizeSatbFromChords as any)(pianoScore, chords, {
        accompanimentType: "homophonic",
        styleProfile: options.styleProfile ?? "classical",
      });
      // Unwrap { scoreModel } wrapper when present
      if (result && typeof result === "object" && "scoreModel" in result) {
        result = result.scoreModel;
      }
      satbScore = result;
    } catch (err: any) {
      warnings.push(
        `[piano+strings] Harmonizer error: ${err?.message ?? String(err)}`
      );
    }
  }

  // ── 3. Map S/A/T/B voices → string instrument ranges ───────────────────
  const sopranoSrc = satbScore ? findPart(satbScore, ["soprano", " s "], 0) : null;
  const altoSrc    = satbScore ? findPart(satbScore, ["alto",    " a "], 1) : null;
  const tenorSrc   = satbScore ? findPart(satbScore, ["tenor",   " t "], 2) : null;
  const bassSrc    = satbScore ? findPart(satbScore, ["bass",    " b "], 3) : null;

  const violin1 = sopranoSrc
    ? remapToStringInstrument(sopranoSrc, "violin_1", "P_V1", "Violin I")
    : null;
  const violin2 = (altoSrc ?? sopranoSrc)
    ? remapToStringInstrument(altoSrc ?? sopranoSrc, "violin_2", "P_V2", "Violin II")
    : null;
  const viola = (tenorSrc ?? altoSrc)
    ? remapToStringInstrument(tenorSrc ?? altoSrc, "viola", "P_VA", "Viola")
    : null;
  const cello = bassSrc
    ? remapToStringInstrument(bassSrc, "cello", "P_VC", "Cello")
    : null;

  // ── 4. Keep the original piano part intact ──────────────────────────────
  const rawPianoParts: any[] = (pianoScore as any).parts ?? [];
  const rawPiano = rawPianoParts[0] ?? null;

  if (!rawPiano) {
    warnings.push("[piano+strings] No piano part found in source score.");
  }

  const pianoPart = rawPiano
    ? {
        ...cloneDeep(rawPiano),
        part_id: "P_PNO",
        name: "Piano",
        instrument: "piano",
        staves: 2
      }
    : null;

  // ── 5. Assemble 5-part combined score: Piano first, then strings ────────
  const parts = [pianoPart, violin1, violin2, viola, cello].filter(Boolean);

  return {
    ...(cloneDeep(pianoScore) as any),
    meta: {
      ...(cloneDeep((pianoScore as any).meta) ?? {}),
      ensemble: "piano_with_strings"
    },
    parts
  } as ScoreModel;
}
