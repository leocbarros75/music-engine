// src/arrange/orchestra/worshipOrchestraArranger.ts
//
// Worship / church orchestra arranger — the standard PraiseCharts layout.
//
// Calibrated from 6 real PraiseCharts orchestrations (see memory:
// worship_orchestra.md). The orchestra is brass-forward and SUPPORTIVE — it
// cushions a choir + rhythm band rather than being a self-contained symphony.
//
// Engine: reuse the string DP voice engine for a strong 5-voice core
// (V1/V2/Vla/Vc/Cb), then map those voices onto the worship-orchestra parts and
// octave-place each into its instrument's register. Authentic PraiseCharts part
// names (with sax substitutes) are emitted; pitches are CONCERT and the exporter
// writes each part's transposition. The named sax substitute is a label only —
// the actual sax-transposed extraction is produced on demand by the
// re-instrumentation tool.
//
// Combined parts (Trumpet 1-2, Horn 1-2, Trombone 1-2) carry two voices on one
// staff (voice 1 = upper, voice 2 = lower).

import type { ScoreModel, NoteEvent } from "../../score/types";
// Orchestra owns its entire core — forked from the string engine so tuning the
// orchestra can never affect strings/winds/brass (see src/arrange/orchestra/core).
import { arrangeStringEnsemble } from "./core/stringArranger";
import { arrangeStringQuartetFromPianoInstrumentation, arrangeSatbToStringQuartetDirect } from "./core/pianoSatbCore";
import { arrangeOrchestraPolyphonic } from "./polyphony/orchestraPolyphonicArranger";
import { midiToPitch, pitchToMidi, getInstrumentSpec } from "../../instruments/instrumentCatalog";
import type { ProfileId } from "./core/types";

type ChordEvent = { measure: number; t: number; symbol: string };
type StringVoice = "vln1" | "vln2" | "vla" | "vc" | "cb";

// Concert sweet-spot registers (where each worship part characteristically sits).
// Cross-checked against the PraiseCharts calibration (written ranges converted to
// concert) and the existing catalog/brass/woodwind sweet spots.
type Reg = { prefMin: number; prefMax: number };
const REG: Record<string, Reg> = {
  fl:    { prefMin: 72, prefMax: 91 }, // C5..G6 — high descant/melody line
  tpt1:  { prefMin: 60, prefMax: 79 }, // C4..G5
  tpt2:  { prefMin: 57, prefMax: 74 }, // A3..D5
  tpt3:  { prefMin: 55, prefMax: 72 }, // G3..C5
  cl:    { prefMin: 55, prefMax: 79 }, // G3..G5 — Clarinet (warm woodwind, below the flute)
  bsn:   { prefMin: 41, prefMax: 62 }, // F2..D4 — Bassoon (woodwind bass)
  hn:    { prefMin: 53, prefMax: 69 }, // F3..A4
  tbn1:  { prefMin: 48, prefMax: 65 }, // C3..F4
  tbn2:  { prefMin: 43, prefMax: 60 }, // G2..C4
  // Trombone 3/Tuba: floor raised G1→Bb1. Real charts bottom at ~B1 typically;
  // G1 is pure tuba territory and unplayable when a trombonist covers the part.
  lowbr: { prefMin: 34, prefMax: 53 }, // Bb1..F3 — Trombone 3 / Tuba
  vln1:  { prefMin: 62, prefMax: 84 }, // D4..C6
  vln2:  { prefMin: 57, prefMax: 79 }, // A3..G5
  vla:   { prefMin: 50, prefMax: 69 }, // D3..A4
  celbs: { prefMin: 40, prefMax: 60 }, // E2..C4 — Cello (upper voice of Cello-Bass)
  cbass: { prefMin: 28, prefMax: 45 }, // E1..A2 — Double Bass (lower voice, 8vb)
};

// The worship-orchestra part roster. `voices` lists which string-DP voice feeds
// each notated voice on the staff (top-to-bottom). `reg` keys index REG.
type PartDef = {
  partId: string;
  name: string;
  instrument: string;
  voices: Array<{ src: StringVoice; reg: string; voice: number }>;
};

// Order: woodwinds (Fl/Ob, Bassoon) → Horn (between winds and brass) → Trumpets,
// Trombones, low brass → [Timpani + Percussion inserted here] → strings.
const WORSHIP_PARTS: PartDef[] = [
  // ── Woodwinds (Flute/Oboe descant, Clarinet a separate staff, Bassoon bass) ──
  { partId: "P_FLOB", name: "Flute/Oboe", instrument: "flute",
    voices: [{ src: "vln1", reg: "fl", voice: 1 }] },
  { partId: "P_CL", name: "Clarinet", instrument: "clarinet_bb",
    voices: [{ src: "vln1", reg: "cl", voice: 1 }] },
  // Bassoon doubles the BASS LINE (chord root / slash bass) in its register —
  // the whole low section carries the bass proposed by the source.
  { partId: "P_BSN", name: "Bassoon", instrument: "bassoon",
    voices: [{ src: "cb", reg: "bsn", voice: 1 }] },

  // ── Horn — between woodwinds and brass ──
  { partId: "P_HN12", name: "Horn 1-2", instrument: "horn_f",
    voices: [{ src: "vla", reg: "hn", voice: 1 }, { src: "vc", reg: "hn", voice: 2 }] },

  // ── Brass ──
  { partId: "P_TPT1", name: "Trumpet 1", instrument: "trumpet_bb_1",
    voices: [{ src: "vln1", reg: "tpt1", voice: 1 }] },
  { partId: "P_TPT23", name: "Trumpet 2-3", instrument: "trumpet_bb_2",
    voices: [{ src: "vln2", reg: "tpt2", voice: 1 }, { src: "vla", reg: "tpt3", voice: 2 }] },
  { partId: "P_TBN12", name: "Trombone 1-2", instrument: "trombone",
    voices: [{ src: "vc", reg: "tbn1", voice: 1 }, { src: "vla", reg: "tbn2", voice: 2 }] },
  { partId: "P_LOWBR", name: "Trombone 3/Tuba", instrument: "tuba_c",
    voices: [{ src: "cb", reg: "lowbr", voice: 1 }] },

  // ── Strings (the cushion) — percussion is spliced in before these ──
  { partId: "P_VLN1", name: "Violin 1", instrument: "violin_1",
    voices: [{ src: "vln1", reg: "vln1", voice: 1 }] },
  { partId: "P_VLN2", name: "Violin 2", instrument: "violin_2",
    voices: [{ src: "vln2", reg: "vln2", voice: 1 }] },
  { partId: "P_VLA", name: "Viola", instrument: "viola",
    voices: [{ src: "vla", reg: "vla", voice: 1 }] },
  // Cello-Bass = the bass line in octaves (cello register + double bass 8vb),
  // both from the rooted cb voice so the foundation is unmistakable.
  { partId: "P_CELBS", name: "Cello-Bass", instrument: "cello",
    voices: [{ src: "cb", reg: "celbs", voice: 1 }, { src: "cb", reg: "cbass", voice: 2 }] },
];

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) { try { return pitchToMidi(ev.pitch); } catch { return null; } }
  return null;
}

/** Octave-place into a register's sweet spot, then hard-clamp to the catalog absolute range. */
function place(midi: number, reg: Reg, instrument: string): number {
  let m = midi;
  const mid = (reg.prefMin + reg.prefMax) / 2;
  // Move toward the sweet spot by octaves.
  while (m < reg.prefMin - 6) m += 12;
  while (m > reg.prefMax + 6) m -= 12;
  if (m < reg.prefMin) { const up = m + 12; if (Math.abs(up - mid) < Math.abs(m - mid)) m = up; }
  if (m > reg.prefMax) { const dn = m - 12; if (Math.abs(dn - mid) < Math.abs(m - mid)) m = dn; }
  // Hard safety clamp to the instrument's playable range.
  const spec = getInstrumentSpec(instrument);
  if (spec) {
    const lo = Number((spec as any).midi_low), hi = Number((spec as any).midi_high);
    while (Number.isFinite(lo) && m < lo) m += 12;
    while (Number.isFinite(hi) && m > hi) m -= 12;
    if (Number.isFinite(lo) && m < lo) m = lo;
    if (Number.isFinite(hi) && m > hi) m = hi;
  }
  return m;
}

export type IntensityMode = "tutti" | "build";

/**
 * The full worship-orchestra roster (for the custom-ensemble part picker), in
 * score order. Percussion parts (Timpani, Crash/Triangle) are generated in
 * addPercussion but are listed here so the UI can offer them.
 */
export const WORSHIP_ROSTER: Array<{ id: string; name: string; section: "Woodwinds" | "Brass" | "Percussion" | "Strings" }> = [
  { id: "P_FLOB", name: "Flute/Oboe", section: "Woodwinds" },
  { id: "P_CL", name: "Clarinet", section: "Woodwinds" },
  { id: "P_BSN", name: "Bassoon", section: "Woodwinds" },
  { id: "P_HN12", name: "Horn 1-2", section: "Brass" },
  { id: "P_TPT1", name: "Trumpet 1", section: "Brass" },
  { id: "P_TPT23", name: "Trumpet 2-3", section: "Brass" },
  { id: "P_TBN12", name: "Trombone 1-2", section: "Brass" },
  { id: "P_LOWBR", name: "Trombone 3/Tuba", section: "Brass" },
  { id: "P_TIMP", name: "Timpani", section: "Percussion" },
  { id: "P_PERC", name: "Percussion (Crash/Triangle)", section: "Percussion" },
  { id: "P_VLN1", name: "Violin 1", section: "Strings" },
  { id: "P_VLN2", name: "Violin 2", section: "Strings" },
  { id: "P_VLA", name: "Viola", section: "Strings" },
  { id: "P_CELBS", name: "Cello-Bass", section: "Strings" },
];

/**
 * Orchestrate a string-voice core (4 or 5 parts in slot order V1/V2/Vla/Vc[/Cb])
 * onto the worship-orchestra roster. Used by every source mode (auto DP core,
 * piano→quartet core, SATB→quartet core). All orchestration/sound decisions live
 * here, so changing the orchestra never touches the input machinery that built
 * the core.
 *
 * `parts` (custom ensemble): when provided, only those part ids are kept in the
 * output. The full harmonic core is always computed first, so even a small custom
 * ensemble gets correct voice assignments and registers — we just render fewer
 * instruments. Intensity + percussion are computed on the full roster, then the
 * filter is applied last.
 */
export function orchestrateStringCore(
  stringScore: ScoreModel,
  warnings: string[] = [],
  options: { intensity?: IntensityMode; parts?: string[]; melodyRests?: boolean[]; balance?: OrchestraBalance; partRanges?: PartRange[]; pianoLeads?: boolean } = {}
): ScoreModel {
  const orch = remapToWorship(stringScore);
  const intensity = options.intensity ?? "build";
  const balance = options.balance ?? "default";
  const phraseLen = 4;
  const phraseInt = computePhraseIntensities(orch, phraseLen);
  // Ritornello: measures where the melody rests but there's harmony = instrumental
  // intros/turnarounds/tags where the orchestra should come FORWARD (Tovey).
  const gaps = detectInstrumentalGaps(orch, options.melodyRests);
  // Parts the user controls manually are excluded from the automatic build.
  const manual = new Set((options.partRanges ?? []).filter((r) => r.ranges?.length).map((r) => r.part));
  const pianoLeads = options.pianoLeads === true;
  if (intensity === "build") {
    gateSections(orch, phraseInt, phraseLen, gaps, balance, manual, pianoLeads);
    warnings.push(
      pianoLeads
        ? "[orchestra] The pianist is playing the song, so the orchestra accompanies it: strings cushion throughout, winds answer, brass is held back for the arrivals."
        : "[orchestra] Worship orchestra (build): strings cushion throughout, brass/winds enter and build to the climaxes."
    );
  } else {
    warnings.push("[orchestra] Worship orchestra (tutti): full ensemble throughout.");
    if (pianoLeads) {
      // Worth saying plainly rather than quietly overriding a setting the
      // player chose: a tutti orchestra does not stay under a piano.
      warnings.push("[orchestra] Tutti was requested with the piano kept, so nothing is held back — the orchestra will cover the pianist.");
    }
  }
  // Open spacing: widen muddy low intervals + spread excessive unison piles
  // (overtone-series principle — wide at the bottom, closer at the top).
  refineSpacing(orch);
  // Ritornello fills: in instrumental gaps the top voices take the lead so the
  // orchestra has a melodic top where the vocal would be (both build + tutti).
  fillGapTops(orch, gaps);
  if (gaps.some(Boolean)) warnings.push(`[orchestra] Ritornello: orchestra comes forward in ${gaps.filter(Boolean).length} instrumental gap measure(s).`);
  // Climaxes: the flute descant lifts an octave (its brilliant register) so the
  // final choruses gain a true top instead of sitting in the narrow melody octave.
  liftFluteAtClimaxes(orch, phraseInt, phraseLen);
  // Three sections were playing one rhythm: let the inner strings hold.
  const held = holdInnerStrings(orch);
  if (held) warnings.push(`[orchestra] Inner strings hold rather than re-bow the piano's repeated chords: ${held} re-articulations tied into held notes.`);
  // Percussion (Timpani + Crash/Triangle) — driven by the same intensity curve.
  addPercussion(orch, phraseInt, phraseLen, pianoLeads);

  // Advanced: manual per-instrument measure ranges (overrides everything above).
  applyManualRanges(orch, options.partRanges);
  if (manual.size) warnings.push(`[orchestra] Manual measure ranges set for ${manual.size} part(s).`);

  // Custom ensemble: keep only the selected parts (default = all).
  if (Array.isArray(options.parts) && options.parts.length) {
    const keep = new Set(options.parts);
    const before = (orch as any).parts.length;
    (orch as any).parts = (orch as any).parts.filter((p: any) => keep.has(p.part_id));
    const kept = (orch as any).parts.length;
    if (kept === 0) {
      // Safety: an empty selection would yield an empty score — fall back to all.
      (orch as any).parts = remapAndRebuildFallback(stringScore, intensity, phraseLen);
      warnings.push("[orchestra] Custom ensemble had no valid parts — using the full roster.");
    } else if (kept < before) {
      warnings.push(`[orchestra] Custom ensemble: ${kept} of ${before} parts selected.`);
    }
  }
  // Last, so everything above still works on the chart's own part ids — the
  // user's part selection, the manual ranges and the intensity gating all name
  // the combined staves. Only the score that comes out is one player per staff.
  const splitCount = splitSectionParts(orch, phraseInt, phraseLen);
  const punctuated = brassPunctuatesAtClimaxes(orch, phraseInt, phraseLen, pianoLeads);
  if (punctuated) {
    warnings.push(`[orchestra] Brass punctuates the climaxes rather than sitting on them: ${punctuated} phrase-ending bars given back to the strings and winds.`);
  }
  if (splitCount) {
    warnings.push(
      `[orchestra] ${splitCount} shared staves split so every player has their own: ` +
      `Horn 1 and 2, Trumpet 2 and 3, Trombone 1 and 2, Trombone 3 and Tuba, Flute and Oboe, Cello and Double Bass. ` +
      `Each can now be given written breaths rather than an instruction to stagger them.`
    );
  }
  return orch;
}

// Rebuild the full orchestra (used only as the empty-selection fallback).
function remapAndRebuildFallback(stringScore: ScoreModel, intensity: IntensityMode, phraseLen: number): any[] {
  const orch = remapToWorship(stringScore);
  const phraseInt = computePhraseIntensities(orch, phraseLen);
  const gaps = detectInstrumentalGaps(orch);
  if (intensity === "build") gateSections(orch, phraseInt, phraseLen, gaps);
  fillGapTops(orch, gaps);
  addPercussion(orch, phraseInt, phraseLen);
  return (orch as any).parts;
}

// ── Intensity / participation — calibrated from 5 PraiseCharts ───────────────
// Each section enters at a different intensity threshold: strings cushion almost
// always; horn is the present inner brass; trumpets/trombones build to the lifts;
// the low brass (Tbn 3/Tuba) and woodwind descant save for the biggest moments.
// Real charts measured: strings ~82–99%, horn ~54–83%, trumpets/tbn ~55–75%,
// low brass lowest-start→highest-end, flute descant ~50%.
const SECTION_THRESHOLD: Record<string, number> = {
  P_VLN1: 0.10, P_VLN2: 0.12, P_VLA: 0.14, P_CELBS: 0.12, // strings — near-constant
  // The viola was briefly raised to 0.46, which matched the reference edition
  // exactly — 47 of 79 bars, where its own table calls the viola "selected
  // octave support in larger sections". It measured well and sounded wrong:
  // Leo's ear says the viola belongs with the rest of the cushion here, and
  // that is the call that counts. A number agreeing with another arranger's
  // score is not the same as it being right for this one.
  P_HN12: 0.50,                                            // horn — present inner glue
  // Clarinet/Bassoon pulled back (was 0.40/0.34) to hit the pro family balance —
  // 3 doubling wind parts were over-weighting winds (21% vs 16% target). Reserving
  // them drops winds toward 16% and lifts strings' relative share toward 36%.
  P_BSN: 0.52,                                             // bassoon — woodwind bass, reserved for fuller sections
  P_CL: 0.55,                                              // clarinet — warm woodwind, comes in for lifts
  P_TPT1: 0.62, P_TBN12: 0.70,                             // lead trumpet / trombones — build to lifts
  P_TPT23: 0.70, P_FLOB: 0.34,                             // 2-3 trumpets + flute/oboe line — see FLUTE_OBOE_SPLIT
  P_LOWBR: 0.82,                                           // low brass — biggest moments only
};
// Brass raised by 0.20 across the board (horn 0.30->0.50, lead trumpet
// 0.42->0.62, trombones and 2-3 trumpets 0.50->0.70, low brass 0.62->0.82).
// +0.12 was enough to pass the ordering but left only 2.8 points between brass
// and winds, which is too thin to hold across other sources.
//
// The note above targets a chart balance of Brass 48 / Strings 36 / Winds 16 by
// share of note count, which put the brass ABOVE the woodwinds: 53.0% of the
// piece against 47.6%, measured per part. Both Codex editions of the same song
// keep brass under the winds and the winds under the strings — 76.96 / 35.89 /
// 25.16 in their transcription — and that is the order a texture wants when
// anything else is carrying the tune. Leo chose that order for this engine too.
//
// Note-count share was the wrong measure to calibrate against in the first
// place: it stays correct however loud the whole room gets. See familyBalance.ts.

// ── User-controllable family balance ─────────────────────────────────────────
// The engine default targets the pro balance (Brass 48 / Strings 36 / Winds 16).
// The user can bias it: lowering a family's entrance thresholds makes it play
// more (bigger share); raising makes it recede.
export type OrchestraBalance = "default" | "more_strings" | "more_winds" | "more_brass";
const FAMILY_OF: Record<string, "wind" | "brass" | "strings"> = {
  P_FLOB: "wind", P_CL: "wind", P_BSN: "wind",
  P_HN12: "brass", P_TPT1: "brass", P_TPT23: "brass", P_TBN12: "brass", P_LOWBR: "brass",
  P_VLN1: "strings", P_VLN2: "strings", P_VLA: "strings", P_CELBS: "strings",
};
const BALANCE_ADJ: Record<OrchestraBalance, { wind: number; brass: number; strings: number }> = {
  default:      { wind:  0.00, brass:  0.00, strings:  0.00 },
  // Strings are already near-constant (saturated), so "more strings" works by
  // making winds + brass recede strongly enough to clear the intensity arc,
  // which raises the strings' relative share.
  more_strings: { wind: +0.24, brass: +0.18, strings: -0.10 },
  more_winds:   { wind: -0.25, brass: +0.10, strings: +0.08 },
  more_brass:   { wind: +0.12, brass: -0.15, strings: +0.06 },
};
/**
 * How much further each family holds back when a piano is playing the song.
 *
 * This orchestra is written to a worship-chart balance in which the brass is a
 * leading voice. That is right when the orchestra IS the arrangement. It is
 * wrong the moment a pianist is playing the piece underneath: the brass then
 * competes with the thing it is supposed to be accompanying.
 *
 * The size of the difference is not a guess. The Codex editions of the same
 * song, one a transcription and one with the piano kept, differ like this:
 *
 *   transcription    strings 76.96%  winds 35.89%  brass 25.16%
 *   piano kept       strings 89.97%  winds 10.17%  brass  1.34%
 *
 * The strings hold their ground and even gain; the winds fall to a third of
 * their activity and the brass to a twentieth. So the strings are left alone
 * here and the reservation falls on the winds and brass, which is also the
 * order a texture needs when something else is carrying the tune.
 */
const PIANO_LEADS_ADJ: Record<"wind" | "brass" | "strings", number> = {
  strings: 0.00,
  wind: 0.34,
  brass: 0.56,
};

function adjustedThreshold(
  partId: string,
  balance: OrchestraBalance,
  pianoLeads = false
): number | undefined {
  const base = SECTION_THRESHOLD[partId];
  if (base === undefined) return undefined;
  const fam = FAMILY_OF[partId];
  if (!fam) return base;
  const reserved = pianoLeads ? PIANO_LEADS_ADJ[fam] : 0;
  return Math.max(0, Math.min(1, base + BALANCE_ADJ[balance][fam] + reserved));
}

// ── Flute climax lift ─────────────────────────────────────────────────────────
// The Flute/Oboe line tracks the melody octave, which leaves the flute in a
// narrow, dull band (~C5–Bb5) all piece. At climax phrases (the big choruses,
// intensity ≥ 0.92 — includes the forced-tutti final phrase) lift it an octave
// into the flute's brilliant register, capped at A6 so it stays tasteful.
const FLUTE_LIFT_INTENSITY = 0.92;
const FLUTE_LIFT_CEILING = 93; // A6
function liftFluteAtClimaxes(orch: ScoreModel, phraseInt: number[], phraseLen: number): void {
  const fl = ((orch as any).parts ?? []).find((p: any) => p.part_id === "P_FLOB");
  if (!fl) return;
  for (let mi = 0; mi < (fl.measures ?? []).length; mi++) {
    const pi = Math.floor(mi / phraseLen);
    if ((phraseInt[pi] ?? 0) < FLUTE_LIFT_INTENSITY) continue;
    for (const ev of (fl.measures[mi]?.events ?? [])) {
      if (ev?.type !== "note" || !ev.pitch) continue;
      const m = eventMidi(ev);
      if (m === null || m + 12 > FLUTE_LIFT_CEILING) continue;
      ev.midi = m + 12;
      ev.pitch = midiToPitch(m + 12);
    }
  }
}

// ── Open spacing — low-interval limit (Forsyth/Adler) ────────────────────────
// Below C3 (MIDI 48) no interval tighter than a 5th: low thirds/seconds are
// muddy. When two low voices are closer than a 5th, drop the lower an octave if
// it stays in range and the slot is free. (Unison doublings are left alone —
// they're normal reinforcement, not mud.)
const LOW_LIMIT_MIDI = 48; // C3
function refineSpacing(orch: ScoreModel): void {
  const parts: any[] = (orch as any).parts ?? [];
  const pitched = parts.filter((p) => p.part_id !== "P_TIMP" && p.part_id !== "P_PERC");
  const loOf = new Map<string, number>();
  for (const p of pitched) {
    const spec = getInstrumentSpec(p.instrument);
    loOf.set(p.part_id, spec ? Number((spec as any).midi_low) : 0);
  }
  const nM = Math.max(0, ...pitched.map((p) => (p.measures ?? []).length));
  for (let mi = 0; mi < nM; mi++) {
    const byOnset = new Map<string, Array<{ ev: any; lo: number }>>();
    for (const p of pitched) {
      const lo = loOf.get(p.part_id) ?? 0;
      for (const ev of (p.measures?.[mi]?.events ?? [])) {
        if (ev?.type !== "note" || !ev.pitch) continue;
        const k = String(Math.round(Number(ev.t ?? 0) * 1000));
        const arr = byOnset.get(k) ?? [];
        arr.push({ ev, lo });
        byOnset.set(k, arr);
      }
    }
    for (const grp of byOnset.values()) {
      const occ = new Map<number, number>();
      for (const g of grp) { const m = eventMidi(g.ev); if (m !== null) occ.set(m, (occ.get(m) ?? 0) + 1); }
      const sorted = grp.map((g) => ({ g, m: eventMidi(g.ev) ?? 0 })).sort((a, b) => a.m - b.m);
      for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1]!, hi = sorted[i]!;
        const gap = hi.m - lo.m;
        if (hi.m < LOW_LIMIT_MIDI && gap > 0 && gap < 7) {
          const down = lo.m - 12;
          if (down >= lo.g.lo && (occ.get(down) ?? 0) === 0) {
            occ.set(lo.m, (occ.get(lo.m) ?? 1) - 1); occ.set(down, 1);
            lo.g.ev.midi = down; lo.g.ev.pitch = midiToPitch(down); lo.m = down;
          }
        }
      }
    }
  }
}

// ── Advanced: manual per-instrument measure ranges ───────────────────────────
// A power-user override. When a part has explicit ranges it plays ONLY in those
// (1-based, inclusive) measures and rests everywhere else, bypassing the
// automatic build. Parts without ranges keep the automatic behaviour.
export type PartRange = { part: string; ranges: Array<[number, number]> };

function inAnyRange(measureNumber: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => measureNumber >= Math.min(a, b) && measureNumber <= Math.max(a, b));
}

function applyManualRanges(orch: ScoreModel, partRanges?: PartRange[]): void {
  if (!Array.isArray(partRanges) || !partRanges.length) return;
  const parts: any[] = (orch as any).parts ?? [];
  for (const { part: pid, ranges } of partRanges) {
    if (!Array.isArray(ranges) || !ranges.length) continue;
    const part = parts.find((p) => p.part_id === pid);
    if (!part) continue;
    for (const m of part.measures ?? []) {
      const num = Number(m?.number);
      if (inAnyRange(num, ranges)) continue; // keep the notes here
      m.events = [{ id: `${pid}-manual-rest-${num}`, t: 0, dur: measureLenOf(m), type: "rest", isRest: true, voice: 1, staff: 1 } as any];
    }
  }
}

function measureLenOf(m: any): number {
  const beats = Number(m?.attributes?.time?.beats ?? 4);
  const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
  return beats * (4 / beatType);
}

/**
 * Per-phrase intensity arc (light intro → peak at the final choruses), modulated
 * by the melody's local register + density. In "tutti" mode every phrase is full
 * (1) so all sections play, but the percussion still uses the underlying arc to
 * decide crash/triangle accents.
 */
function computePhraseIntensities(orch: ScoreModel, phraseLen: number): number[] {
  const parts: any[] = (orch as any).parts ?? [];
  const nMeasures = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  if (nMeasures === 0) return [];
  const nPhrases = Math.ceil(nMeasures / phraseLen);
  const melody = parts.find((p) => p.part_id === "P_VLN1");
  const allMidis: number[] = [];
  for (const m of melody?.measures ?? []) for (const e of (m.events ?? [])) {
    if (e?.type === "note" && e.pitch) { const v = eventMidi(e); if (v !== null) allMidis.push(v); }
  }
  const loRef = allMidis.length ? Math.min(...allMidis) : 60;
  const hiRef = allMidis.length ? Math.max(...allMidis) : 72;
  const span = Math.max(1, hiRef - loRef);

  const out: number[] = [];
  for (let pi = 0; pi < nPhrases; pi++) {
    const progress = nPhrases > 1 ? pi / (nPhrases - 1) : 1;
    // A straight ramp from nothing to everything.
    //
    // This used to open at 0.45 and rise to 0.92, which sounds like a build
    // and is not one: the lowest entrance threshold that matters is the horn's
    // 0.30, so the floor already cleared it and the horn could never be gated
    // off — it played all 62 bars of every chart, and the trumpets, trombones
    // and flute descant rested only in the opening phrase.
    //
    // The error hid behind the metric it was calibrated against. Family
    // balance by note count came out at brass 49 / strings 32 / winds 18
    // against a target of 48 / 36 / 16 — near enough to look right, because
    // everyone was over-playing PROPORTIONALLY. Balance measures who plays
    // relative to whom; it cannot see that nobody ever rests.
    //
    // Measured against the participation figures from the real charts
    // (strings 82-99%, horn 54-83%, trumpets and trombones 55-75%, flute
    // descant ~50%), a plain linear ramp fits best, and fits better on all
    // three test pieces at once. Mean error per part against those bands:
    //
    //              Living Hope   Holy Holy Holy   O Espirito
    //   was            22.6pp         14.1pp         16.8pp
    //   now             3.9pp         11.9pp          7.8pp
    //
    // Family balance did not suffer for it — 47 / 37 / 16 on the reference
    // chart, closer to target than before.
    const base = progress;
    let sum = 0, count = 0;
    for (let mi = pi * phraseLen; mi < Math.min((pi + 1) * phraseLen, nMeasures); mi++) {
      for (const e of (melody?.measures?.[mi]?.events ?? [])) {
        if (e?.type === "note" && e.pitch) { const v = eventMidi(e); if (v !== null) { sum += v; count++; } }
      }
    }
    const meanReg = count ? (sum / count - loRef) / span : 0.5;
    const density = Math.min(1, count / (phraseLen * 4));
    const mod = 0.18 * meanReg + 0.10 * density - 0.10;
    out.push(Math.max(0, Math.min(1, base + mod)));
  }
  if (nPhrases > 2) out[0] = Math.min(out[0]!, 0.40);  // open light
  out[nPhrases - 1] = 1;                                // big finish
  return out;
}

// Tovey's ritornello: in an instrumental gap (the vocal/melody rests), the
// orchestra comes FORWARD — even in a light intro. Treat such measures as
// near-full intensity so the harmony sections all play.
const RITORNELLO_INTENSITY = 0.9;

/**
 * Rest each section's measures that fall below its entrance threshold (build).
 * Per-measure (not per-phrase) so the ritornello boost can lift individual
 * instrumental-gap measures to full while sung measures follow the build arc.
 */
function gateSections(orch: ScoreModel, phraseIntensity: number[], phraseLen: number, gaps: boolean[], balance: OrchestraBalance = "default", manual?: Set<string>, pianoLeads = false): void {
  const parts: any[] = (orch as any).parts ?? [];
  const nMeasures = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  for (const part of parts) {
    if (manual?.has(part.part_id)) continue; // user controls this part's measures manually
    const thr = adjustedThreshold(part.part_id, balance, pianoLeads);
    if (thr === undefined) continue;
    for (let mi = 0; mi < nMeasures; mi++) {
      const pi = Math.floor(mi / phraseLen);
      let eff = phraseIntensity[pi] ?? 1;
      if (gaps[mi]) eff = Math.max(eff, RITORNELLO_INTENSITY); // orchestra forward in the gap
      if (eff >= thr) continue;
      const m = part.measures?.[mi];
      if (!m) continue;
      m.events = [{ id: `${part.part_id}-rest-${mi}`, t: 0, dur: measureLenOf(m), type: "rest", isRest: true, voice: 1, staff: 1 } as any];
    }
  }
}

/**
 * Per-measure "instrumental gap": the melody (Violin 1) is mostly resting but
 * there is harmony to play (a chord). These are intros / turnarounds / tags
 * where the orchestra takes the lead instead of cushioning under a sung melody.
 */
function detectInstrumentalGaps(orch: ScoreModel, melodyRests?: boolean[]): boolean[] {
  const parts: any[] = (orch as any).parts ?? [];
  const harmonyIds = new Set(["P_VLN2", "P_VLA", "P_CELBS", "P_HN12"]);
  const harmony = parts.filter((p) => harmonyIds.has(p.part_id));
  const n = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  const melody = parts.find((p) => p.part_id === "P_VLN1");
  const gaps: boolean[] = [];
  for (let mi = 0; mi < n; mi++) {
    // A gap needs harmony to play (otherwise it's silence, not a ritornello).
    const harmHas = harmony.some((p) => (p.measures?.[mi]?.events ?? []).some((e: any) => e?.type === "note" && e.pitch));
    // The melody must be RESTING. Prefer the source-melody signal (the DP fills
    // the orchestrated melody voice even where the source rests); fall back to
    // the orchestrated Violin 1 if no source signal was supplied.
    let melResting: boolean;
    if (melodyRests && mi < melodyRests.length) {
      melResting = melodyRests[mi]!;
    } else {
      const m = melody?.measures?.[mi];
      const len = measureLenOf(m);
      let melDur = 0;
      for (const e of (m?.events ?? [])) if (e?.type === "note" && e.pitch) melDur += Number(e.dur ?? 0);
      melResting = melDur < 0.4 * len;
    }
    gaps[mi] = melResting && harmHas;
  }
  return gaps;
}

/**
 * Per-measure "is the source melody mostly resting here?" — drives the ritornello.
 * Finds the melody/soprano/top part of the source and measures its staff-1
 * sounding fraction.
 */
export function sourceMelodyRestMeasures(score: ScoreModel): boolean[] {
  const parts: any[] = (score as any).parts ?? [];
  if (!parts.length) return [];
  let mp = parts.find((p) => /soprano|melody|voice|lead/i.test(String(p?.name ?? "")));
  if (!mp) {
    let best: any = null, bestAvg = -Infinity;
    for (const p of parts) {
      const ms: number[] = [];
      for (const m of p.measures ?? []) for (const e of (m.events ?? [])) {
        if (e?.type === "note" && e.pitch) { const v = eventMidi(e); if (v !== null) ms.push(v); }
      }
      if (ms.length) { const avg = ms.reduce((a, b) => a + b, 0) / ms.length; if (avg > bestAvg) { bestAvg = avg; best = p; } }
    }
    mp = best ?? parts[0];
  }
  const n = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  const rests: boolean[] = [];
  for (let mi = 0; mi < n; mi++) {
    const m = mp?.measures?.[mi];
    const len = measureLenOf(m);
    let dur = 0;
    for (const e of (m?.events ?? [])) if (e?.type === "note" && e.pitch && Number(e.staff ?? 1) === 1) dur += Number(e.dur ?? 0);
    rests[mi] = dur < 0.4 * len;
  }
  return rests;
}

/**
 * In instrumental gaps, give the lyrical top voices (Flute/Oboe + Violin 1) the
 * top harmony line (from Violin 2) so the orchestra's ritornello has a real
 * melodic top where the vocal would otherwise be — instead of a bottom-heavy pad.
 */
function fillGapTops(orch: ScoreModel, gaps: boolean[]): void {
  const parts: any[] = (orch as any).parts ?? [];
  const topSrc = parts.find((p) => p.part_id === "P_VLN2");
  if (!topSrc) return;
  const targets: Array<[string, string]> = [["P_FLOB", "fl"], ["P_VLN1", "vln1"]];
  for (let mi = 0; mi < gaps.length; mi++) {
    if (!gaps[mi]) continue;
    const srcNotes = (topSrc.measures?.[mi]?.events ?? []).filter((e: any) => e?.type === "note" && e.pitch);
    if (!srcNotes.length) continue;
    for (const [pid, regKey] of targets) {
      const p = parts.find((x) => x.part_id === pid);
      const m = p?.measures?.[mi];
      if (!m) continue;
      const hasNote = (m.events ?? []).some((e: any) => e?.type === "note" && e.pitch);
      if (hasNote) continue; // the melody voice already plays here — leave it
      m.events = srcNotes.map((e: any, i: number) => {
        const midi = eventMidi(e);
        if (midi === null) return e;
        const placed = place(midi, REG[regKey]!, p.instrument);
        return { id: `${pid}-fill-${mi}-${i}`, t: e.t, dur: e.dur, type: "note", pitch: midiToPitch(placed), voice: 1, staff: 1 };
      });
    }
  }
}

// ── Percussion: Timpani (pitched) + Crash/Triangle (unpitched) ───────────────
// Two staves: a pitched timpani part (bass roots on downbeats + cadences, enters
// for the fuller sections) and an unpitched percussion part (crash on the big
// phrase climaxes, triangle on the lifts). Both follow the intensity curve.
const TIMP_THRESHOLD = 0.50;   // timpani joins the fuller sections
const TRIANGLE_THRESHOLD = 0.55;
const CRASH_THRESHOLD = 0.72;

/**
 * Two drums, tuned once, and no retuning in the middle of the piece.
 *
 * The timpani part took whatever pitch the bar's bass happened to land on and
 * shifted it into range. On a 79-bar piece in F that produced six different
 * pitches — F2, G2, A2, B-flat2, C3, D3 — which is six drums, or a player
 * retuning mid-performance, and the score said nothing about either. The Codex
 * edition of the same source uses exactly two, F2 and C3, and rests on every
 * other harmony.
 *
 * So: tonic and dominant, the classical pair, chosen from the key signature and
 * placed low in the instrument. Everything else is a rest. This is the oldest
 * convention there is for the instrument, and the reason it exists is that
 * changing a drum's pitch takes a pedal, a foot and several seconds.
 *
 * The minor mode is read from the key signature's own mode rather than assumed:
 * A minor and C major share a signature, and a timpanist in A minor wants A and
 * E, not C and G.
 */
export function timpaniTuning(
  fifths: number,
  mode: string | undefined,
  lo: number,
  hi: number
): { tonic: number; dominant: number; tonicPc: number; dominantPc: number } {
  const majorPc = (((fifths * 7) % 12) + 12) % 12;
  // The relative minor sits three semitones below its relative major.
  const tonicPc = /minor|aeolian/i.test(String(mode ?? "")) ? (majorPc + 9) % 12 : majorPc;
  const dominantPc = (tonicPc + 7) % 12;
  // Lowest placement at or above E2, then drop an octave if the fifth above it
  // would not fit — the pair has to sit on two real drums.
  let tonic = 40 + ((((tonicPc - 40) % 12) + 12) % 12);
  if (tonic + 7 > hi) tonic -= 12;
  if (tonic < lo) tonic += 12;
  return { tonic, dominant: tonic + 7, tonicPc, dominantPc };
}

/** "F2, C3" — what goes above the staff so the player can tune before playing. */
export function tuningLabel(tonic: number, dominant: number): string {
  const NAMES = ["C", "C#", "D", "E-flat", "E", "F", "F#", "G", "A-flat", "A", "B-flat", "B"];
  const name = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
  return `${name(tonic)}, ${name(dominant)}`;
}

/**
 * Give every player their own staff.
 *
 * The chart layout puts two players on one line — "Horn 1-2", "Trumpet 2-3",
 * "Cello-Bass" — which is how worship charts are engraved and is fine there.
 * In an orchestral score it costs two things. A player reading a two-note staff
 * has to work out which note is theirs, and, more concretely, a shared staff
 * cannot be given written breaths: the breathing pass sees a section, marks
 * "stagger breathing" and leaves the line unbroken, so our winds and brass ran
 * 74 beats without a written break where the reference edition never exceeds
 * 3.875.
 *
 * Two shapes to split, and they are not the same:
 *
 *  - CHORDAL staves really do carry two parts at once — Horn 1-2 has two notes
 *    on 423 onsets. The upper note is the first player, the lower the second.
 *    Where only one note is written, both players have it.
 *  - UNISON staves carry a single shared line: Flute/Oboe and Trombone 3/Tuba
 *    have exactly one note per onset. Both players take that line, each moved
 *    by octaves into their own instrument's range — which matters, because the
 *    flute line reaches A6 and an oboe cannot play it.
 */
/**
 * Where the flute takes over from the oboe.
 *
 * The combined line's own entrance threshold sits at this value, so everything
 * the flute plays today it still plays. What changes is below it: the line now
 * sounds in quieter passages too, and all of that goes to the oboe, which is
 * the voice for it.
 */
const FLUTE_OBOE_SPLIT = 0.50;

type SplitTake = "upper" | "lower" | "copy";
type SplitTarget = {
  id: string;
  name: string;
  instrument: string;
  take: SplitTake;
  /** Only sound where the phrase is at least this intense. */
  minIntensity?: number;
  /** Only sound where the phrase is below this. */
  maxIntensity?: number;
};

const SECTION_SPLITS: Record<string, SplitTarget[]> = {
  // Flute and oboe do not double: they trade. The reference edition of this
  // source gives its oboe eleven bars and its first flute forty-seven, and the
  // two share NOT ONE bar — "oboe colors verse passages in measures 4-13 and
  // 46-56; Flute 1 takes the other selected melodic passages".
  //
  // The same line in unison was the alternative, and it read badly for the
  // oboe: 12% of its notes above its comfortable top, and an octave lower put
  // 43% below the bottom. Neither octave is a good answer to a line written for
  // a flute. Giving each its own passages is.
  P_FLOB: [
    { id: "P_FL", name: "Flute", instrument: "flute", take: "copy", minIntensity: FLUTE_OBOE_SPLIT },
    { id: "P_OB", name: "Oboe", instrument: "oboe", take: "copy", maxIntensity: FLUTE_OBOE_SPLIT },
  ],
  // Second players come in later than firsts, and the bottom of the section
  // later still. Without this every brass staff entered together and the family
  // took over the climaxes: measured section by section, brass ran 96.9% of
  // bars 57-64 against the woodwinds' 72.7%, and 94.5% against 70.7% in 65-72.
  // The whole-piece average passed while the loudest third of the piece was
  // brass-led.
  //
  // The reference edition writes its brass the same way round — first horn 154
  // events to second horn's 38, first trumpet 218 to second's 109 — so the
  // section keeps its colour while the family stops dominating.
  P_HN12: [
    { id: "P_HN1", name: "Horn 1", instrument: "horn_f", take: "upper" },
    { id: "P_HN2", name: "Horn 2", instrument: "horn_f", take: "lower", minIntensity: 0.72 },
  ],
  P_TPT23: [
    { id: "P_TPT2", name: "Trumpet 2", instrument: "trumpet_bb_2", take: "upper" },
    { id: "P_TPT3", name: "Trumpet 3", instrument: "trumpet_bb_2", take: "lower", minIntensity: 0.88 },
  ],
  P_TBN12: [
    { id: "P_TBN1", name: "Trombone 1", instrument: "trombone", take: "upper" },
    { id: "P_TBN2", name: "Trombone 2", instrument: "trombone", take: "lower", minIntensity: 0.88 },
  ],
  P_LOWBR: [
    { id: "P_TBN3", name: "Trombone 3", instrument: "trombone", take: "copy" },
    { id: "P_TU", name: "Tuba", instrument: "tuba_c", take: "copy", minIntensity: 0.92 },
  ],
  P_CELBS: [
    { id: "P_VC", name: "Cello", instrument: "cello", take: "upper" },
    { id: "P_CB", name: "Double Bass", instrument: "double_bass", take: "lower" },
  ],
};

/** Move a pitch by whole octaves until the instrument can play it at all. */
function intoRange(midi: number, instrument: string): number {
  const spec = getInstrumentSpec(instrument);
  if (!spec) return midi;
  let m = midi;
  while (m < spec.midi_low) m += 12;
  while (m > spec.midi_high) m -= 12;
  return m;
}

/**
 * Where a copied line should sit for the second player.
 *
 * Both players on a unison staff take the same line, but not necessarily in the
 * same octave: the Flute/Oboe line reaches A6, which is the very top of what an
 * oboe can play and a fourth above where it is comfortable. Clamping note by
 * note would drop only the high ones and tear octave holes in the middle of a
 * phrase, so the shift is chosen once for the whole line — the octave that
 * leaves the least of it outside the register the instrument is happy in.
 */
function placeLineForInstrument(midis: number[], instrument: string): number {
  const spec = getInstrumentSpec(instrument);
  if (!spec || !midis.length) return 0;
  const lo = spec.preferred_low ?? spec.midi_low;
  const hi = spec.preferred_high ?? spec.midi_high;
  const strain = (shift: number): number => {
    let total = 0;
    for (const m of midis) {
      const p = m + shift;
      if (p < spec.midi_low || p > spec.midi_high) return Infinity;
      total += p < lo ? lo - p : p > hi ? p - hi : 0;
    }
    return total;
  };
  let best = 0;
  let bestStrain = strain(0);
  for (const shift of [-24, -12, 12, 24]) {
    const v = strain(shift);
    if (v < bestStrain) { bestStrain = v; best = shift; }
  }
  return best;
}

/**
 * Brass does not sit on a climax, it punctuates one.
 *
 * Once the music is loud enough, every brass staff is gated in and then plays
 * every bar of it — so measured section by section the brass ran 75-80% of the
 * last three sections against woodwinds at 60-73%, and led the loudest third of
 * the piece. The reference edition answers this by writing brass as short
 * pillars at named arrivals: its brass never exceeds 5.88% of a section.
 *
 * This is the same idea at this engine's own scale rather than a copy of it.
 * The section keeps its brass colour on the bars that begin a phrase, and gives
 * the last bar of each phrase back to the strings and winds. It costs the brass
 * a quarter of its climax activity and costs the music nothing it needs.
 */
const BRASS_PART_IDS = new Set(["P_HN1", "P_HN2", "P_TPT1", "P_TPT2", "P_TPT3", "P_TBN1", "P_TBN2", "P_TBN3", "P_TU"]);
const BRASS_PUNCTUATES_ABOVE = 0.85;

function brassPunctuatesAtClimaxes(
  orch: ScoreModel,
  phraseInt: number[],
  phraseLen: number,
  pianoLeads = false
): number {
  let silenced = 0;
  for (const part of ((orch as any).parts ?? []) as any[]) {
    if (!BRASS_PART_IDS.has(String(part?.part_id))) continue;
    (part.measures ?? []).forEach((m: any, i: number) => {
      const intensity = phraseInt[Math.floor(i / phraseLen)] ?? 1;
      if (intensity < BRASS_PUNCTUATES_ABOVE) return;
      // Never the closing bar of the piece: a final chord wants its brass.
      if (i >= part.measures.length - 1) return;
      // With a pianist underneath, the brass marks the start of a phrase and
      // then gets out of the way — which is what the reference means by short
      // pillars at arrivals, and why its brass never passes 5.88% of a section
      // even at the end. Without one, it only gives back the phrase's last bar.
      const give = pianoLeads
        ? i % phraseLen !== 0
        : i % phraseLen === phraseLen - 1;
      if (!give) return;
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note");
      if (!notes.length) return;
      m.events = [{ id: `${part.part_id}-p-${i}`, t: 0, dur: measureLenOf(m), type: "rest", isRest: true, voice: 1, staff: 1 }];
      silenced++;
    });
  }
  return silenced;
}

export function splitSectionParts(
  orch: ScoreModel,
  phraseInt: number[] = [],
  phraseLen = 4
): number {
  const parts: any[] = (orch as any).parts ?? [];
  const out: any[] = [];
  let split = 0;
  const intensityAt = (barIndex: number): number =>
    phraseInt.length ? (phraseInt[Math.floor(barIndex / phraseLen)] ?? 1) : 1;

  for (const part of parts) {
    const targets = SECTION_SPLITS[String(part?.part_id)];
    if (!targets) { out.push(part); continue; }
    split++;

    for (const target of targets) {
      // A copied line is placed once, as a line. A split chord is already in
      // the register the voicing put it in.
      let lineShift = 0;
      if (target.take === "copy") {
        const all: number[] = [];
        for (const m of part.measures ?? []) {
          for (const e of m?.events ?? []) {
            if (e?.type !== "note" || e.grace) continue;
            const v = eventMidi(e);
            if (v !== null) all.push(v);
          }
        }
        lineShift = placeLineForInstrument(all, target.instrument);
      }
      const measures = (part.measures ?? []).map((m: any, barIndex: number) => {
        const events: any[] = m?.events ?? [];
        const notes = events.filter((e) => e?.type === "note" && !e.grace);
        const others = events.filter((e) => !(e?.type === "note" && !e.grace));
        if (!notes.length) return JSON.parse(JSON.stringify(m));

        // This player's passage, or the other's?
        const intensity = intensityAt(barIndex);
        const mine =
          (target.minIntensity === undefined || intensity >= target.minIntensity) &&
          (target.maxIntensity === undefined || intensity < target.maxIntensity);
        if (!mine) {
          const len = measureLenOf(m);
          return {
            ...JSON.parse(JSON.stringify(m)),
            events: [{ id: `${target.id}-r-${barIndex}`, t: 0, dur: len, type: "rest", isRest: true, voice: 1, staff: 1 }],
          };
        }

        // Group by onset so "upper" and "lower" mean the same instant.
        const byT = new Map<number, any[]>();
        for (const e of notes) {
          const t = Number(e.t);
          if (!byT.has(t)) byT.set(t, []);
          byT.get(t)!.push(e);
        }
        const kept: any[] = [];
        for (const [, group] of byT) {
          group.sort((a, b) => (eventMidi(b) ?? 0) - (eventMidi(a) ?? 0)); // high to low
          let chosen: any;
          if (target.take === "copy" || group.length === 1) chosen = group[0];
          else chosen = target.take === "upper" ? group[0] : group[group.length - 1];
          const midi = eventMidi(chosen);
          const placed = midi === null ? null : intoRange(midi + lineShift, target.instrument);
          kept.push({
            ...JSON.parse(JSON.stringify(chosen)),
            id: `${target.id}-${chosen.id}`,
            ...(placed !== null && placed !== midi ? { pitch: midiToPitch(placed) } : {}),
          });
        }
        kept.sort((a, b) => Number(a.t) - Number(b.t));
        return { ...JSON.parse(JSON.stringify(m)), events: [...others, ...kept].sort((a, b) => Number(a.t) - Number(b.t)) };
      });
      out.push({ part_id: target.id, name: target.name, instrument: target.instrument, staves: 1, measures });
    }
  }
  (orch as any).parts = out;
  return split;
}

/**
 * Let the inner strings hold a note instead of re-bowing it.
 *
 * The orchestra's string core copies the piano's notes straight into four
 * parts. So every time the pianist re-strikes a chord, all four sections
 * re-articulate with them — and the inner voices, which mostly sit still while
 * the tune moves above, came out re-striking the same pitch on 65% of Violin
 * 2's notes, 58% of the Viola's and 74% of the Cello-Bass's, with not one tie
 * anywhere in the score. All three then had exactly 563 events and byte-identical
 * onset rhythms: three sections playing one rhythm.
 *
 * The Codex transcription of the same source gives its inner voices a fraction
 * of the activity of its first violin — 525 / 212 / 121 across V1, V2 and viola
 * — because it follows the piano's INTERIOR voices, which change far less often
 * than its top line does.
 *
 * Violin 1 is left out of this deliberately. It carries the tune, and a tune
 * that repeats a pitch means it; merging those would rewrite the melody. That
 * distinction is the same one the string route draws, and it cost a whole
 * round of work to get right there.
 *
 * A held note is written as one note, tied across the standard values when no
 * single note value spans it, and never across a barline.
 */
const INNER_STRING_PARTS = new Set(["P_VLN2", "P_VLA", "P_CELBS"]);

export function holdInnerStrings(orch: ScoreModel): number {
  let merged = 0;
  for (const part of ((orch as any).parts ?? []) as any[]) {
    if (!INNER_STRING_PARTS.has(String(part?.part_id))) continue;
    for (const m of part.measures ?? []) {
      const events: any[] = m?.events ?? [];
      const notes = events.filter((e) => e?.type === "note" && !e.grace);
      if (notes.length < 2) continue;
      const others = events.filter((e) => !(e?.type === "note" && !e.grace));
      notes.sort((a, b) => Number(a.t) - Number(b.t));

      const out: any[] = [];
      let run: any[] = [];
      const flush = () => {
        if (!run.length) return;
        const first = run[0];
        if (run.length === 1) { out.push(first); run = []; return; }
        const total = run.reduce((sum, e) => sum + Number(e.dur), 0);
        merged += run.length - 1;
        // One sound. Split only where no single written value spans it, and
        // tie the pieces so the bow is not retaken.
        const pieces = splitIntoStandardValues(total);
        let t = Number(first.t);
        pieces.forEach((dur, i) => {
          out.push({
            ...JSON.parse(JSON.stringify(first)),
            id: `${first.id}-h${i}`,
            t, dur,
            ...(i > 0 ? { tieStop: true } : {}),
            ...(i < pieces.length - 1 ? { tieStart: true } : {}),
          });
          t += dur;
        });
        run = [];
      };
      for (const ev of notes) {
        const prev = run[run.length - 1];
        const same =
          prev &&
          eventMidi(prev) !== null &&
          eventMidi(prev) === eventMidi(ev) &&
          Math.abs(Number(prev.t) + Number(prev.dur) - Number(ev.t)) < 1e-9 &&
          prev.tieStart !== true &&
          ev.tieStop !== true;
        if (!same) flush();
        run.push(ev);
      }
      flush();
      m.events = [...others, ...out].sort((a, b) => Number(a.t) - Number(b.t));
    }
  }
  return merged;
}

/** Largest standard note values first, to be tied together. */
function splitIntoStandardValues(total: number): number[] {
  const VALUES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
  const pieces: number[] = [];
  let left = total;
  let guard = 0;
  while (left > 1e-9 && guard++ < 32) {
    const piece = VALUES.find((v) => v <= left + 1e-9);
    if (piece === undefined) break;
    pieces.push(piece);
    left -= piece;
  }
  return pieces.length ? pieces : [total];
}

function addPercussion(orch: ScoreModel, phraseInt: number[], phraseLen: number, pianoLeads = false): void {
  const parts: any[] = (orch as any).parts ?? [];
  const cello = parts.find((p) => p.part_id === "P_CELBS");
  if (!cello) return;
  const nMeasures = (cello.measures ?? []).length;
  if (nMeasures === 0) return;

  const timpMeasures: any[] = [];
  const percMeasures: any[] = [];
  // Under a piano the drums are punctuation rather than a layer: the reference
  // edition gives its timpanist five attacks in the whole piece.
  const timpThr = TIMP_THRESHOLD + (pianoLeads ? 0.30 : 0);
  const crashThr = CRASH_THRESHOLD + (pianoLeads ? 0.20 : 0);
  const triThr = TRIANGLE_THRESHOLD + (pianoLeads ? 0.30 : 0);
  const TIMP_LO = 38, TIMP_HI = 57; // D2..A3
  const keyBar: any = parts.map((p: any) => p?.measures?.[0]?.attributes).find((a: any) => a?.key_fifths !== undefined);
  const tuning = timpaniTuning(Number(keyBar?.key_fifths ?? 0), keyBar?.key_mode, TIMP_LO, TIMP_HI);
  for (let mi = 0; mi < nMeasures; mi++) {
    const srcM = cello.measures[mi];
    const len = measureLenOf(srcM);
    const pi = Math.floor(mi / phraseLen);
    const intensity = phraseInt[pi] ?? 1;
    const isPhraseStart = mi % phraseLen === 0;

    // Timpani: tonic or dominant on beat 1 when the texture is full enough AND
    // the harmony underneath is one the two drums can actually sound. Any other
    // bass note is a rest — the alternative is a third drum or a retuning.
    const timpEvents: any[] = [];
    if (intensity >= timpThr) {
      const firstNote = (srcM?.events ?? []).find((e: any) => e?.type === "note" && e.pitch);
      const bassMidi = firstNote ? eventMidi(firstNote) : null;
      if (bassMidi !== null) {
        const pc = ((bassMidi % 12) + 12) % 12;
        const drum =
          pc === tuning.tonicPc ? tuning.tonic : pc === tuning.dominantPc ? tuning.dominant : null;
        if (drum !== null) {
          timpEvents.push({ id: `TIMP-${mi}`, t: 0, dur: Math.min(len, 2), type: "note", pitch: midiToPitch(drum), voice: 1, staff: 1 });
        }
      }
    }
    if (!timpEvents.length) timpEvents.push({ id: `TIMP-r-${mi}`, t: 0, dur: len, type: "rest", isRest: true, voice: 1, staff: 1 });
    timpMeasures.push({ number: srcM?.number ?? mi + 1, ...(mi === 0 && srcM?.attributes ? { attributes: JSON.parse(JSON.stringify(srcM.attributes)) } : {}), events: timpEvents });

    // Percussion (unpitched): crash on climax phrase starts; triangle on lifts.
    const percEvents: any[] = [];
    if (isPhraseStart && intensity >= crashThr) {
      percEvents.push({ id: `CRASH-${mi}`, t: 0, dur: len, type: "unpitched", instrumentId: "crash", voice: 1, staff: 1 });
    }
    if (isPhraseStart && intensity >= triThr) {
      percEvents.push({ id: `TRI-${mi}`, t: 0, dur: Math.min(len, 1), type: "unpitched", instrumentId: "triangle", voice: 1, staff: 1 });
    }
    if (!percEvents.length) percEvents.push({ id: `PERC-r-${mi}`, t: 0, dur: len, type: "rest", isRest: true, voice: 1, staff: 1 });
    percMeasures.push({ number: srcM?.number ?? mi + 1, ...(mi === 0 && srcM?.attributes ? { attributes: JSON.parse(JSON.stringify(srcM.attributes)) } : {}), events: percEvents });
  }

  // Say what the drums are tuned to, above the first bar, so the player can set
  // them before a note is played.
  if (timpMeasures[0]) {
    const perf: any = (timpMeasures[0] as any).performance ?? ((timpMeasures[0] as any).performance = {});
    const words: any[] = Array.isArray(perf.words) ? perf.words : (perf.words = []);
    words.push({ t: 0, text: `Timpani: ${tuningLabel(tuning.tonic, tuning.dominant)}`, placement: "above" });
  }
  const timpPart = { part_id: "P_TIMP", name: "Timpani", instrument: "timpani", staves: 1, measures: timpMeasures };
  const percPart = { part_id: "P_PERC", name: "Percussion (Crash/Triangle)", instrument: "drums", staves: 1, measures: percMeasures };

  // Splice both in just before the strings (before Violin 1).
  const vln1Idx = parts.findIndex((p) => p.part_id === "P_VLN1");
  const at = vln1Idx >= 0 ? vln1Idx : parts.length;
  parts.splice(at, 0, timpPart, percPart);
  (orch as any).parts = parts;
}

/** Map the 5 string-DP parts (by slot order) onto the worship-orchestra roster. */
function remapToWorship(stringScore: ScoreModel): ScoreModel {
  const parts: any[] = (stringScore as any).parts ?? [];
  const slotOrder: StringVoice[] = ["vln1", "vln2", "vla", "vc", "cb"];
  const bySlot: Record<string, any> = {};
  parts.slice(0, 5).forEach((p, i) => { bySlot[slotOrder[i]!] = p; });

  // A 4-voice core (piano→quartet / SATB) has no double bass. Derive the cb
  // voice from the cello an octave lower so the low brass / Cello-Bass foundation
  // gets a real bass line.
  if (!bySlot["cb"] && bySlot["vc"]) {
    const vc = bySlot["vc"];
    bySlot["cb"] = {
      ...vc,
      measures: (vc.measures ?? []).map((m: any) => ({
        ...m,
        events: (m.events ?? []).map((ev: any) => {
          if (ev?.type !== "note" || !ev.pitch) return ev;
          const midi = eventMidi(ev);
          if (midi === null) return ev;
          return { ...ev, pitch: midiToPitch(midi - 12) };
        }),
      })),
    };
  }

  const measureCount = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));

  const orchParts = WORSHIP_PARTS.map((def) => {
    const measures: any[] = [];
    for (let mi = 0; mi < measureCount; mi++) {
      // Gather this part's notated voices for measure mi.
      const events: NoteEvent[] = [];
      for (const vd of def.voices) {
        const srcPart = bySlot[vd.src];
        const srcM = srcPart?.measures?.[mi];
        const reg = REG[vd.reg]!;
        for (const ev of (srcM?.events ?? [])) {
          if (ev?.type !== "note" || !ev.pitch) {
            if (ev?.type === "rest" && vd.voice === 1) {
              events.push({ ...ev, voice: vd.voice, staff: 1 });
            }
            continue;
          }
          const midi = eventMidi(ev);
          if (midi === null) continue;
          const placed = place(midi, reg, def.instrument);
          events.push({
            id: `${def.partId}-${mi}-${vd.voice}-${ev.t}`,
            t: ev.t, dur: ev.dur, type: "note",
            pitch: midiToPitch(placed), voice: vd.voice, staff: 1,
          } as any);
        }
      }
      events.sort((a, b) => Number(a.t) - Number(b.t) || Number(a.voice) - Number(b.voice));
      const template = bySlot[def.voices[0]!.src]?.measures?.[mi];
      measures.push({
        number: template?.number ?? mi + 1,
        ...(mi === 0 && template?.attributes ? { attributes: JSON.parse(JSON.stringify(template.attributes)) } : {}),
        events,
      });
    }
    return { part_id: def.partId, name: def.name, instrument: def.instrument, staves: 1, measures };
  });

  return {
    ...(stringScore as any),
    parts: orchParts,
    meta: { ...(stringScore as any).meta, ensemble: "orchestra" },
  } as ScoreModel;
}

export type WorshipOrchestraOptions = {
  profile?: ProfileId;
  chords?: ChordEvent[];
  key?: { fifths: number; mode: "major" | "minor" };
  warnings?: string[];
  polyphonic?: boolean;
  level?: string;
  intensity?: IntensityMode;
  parts?: string[];
  balance?: OrchestraBalance;
  partRanges?: PartRange[];
  /** Override the per-measure "melody resting" signal (ritornello detection). */
  melodyRests?: boolean[];
  /** A pianist is playing the piece: winds, brass and percussion hold back. */
  pianoLeads?: boolean;
};

/**
 * Arrange a score as a worship/church orchestra (PraiseCharts layout).
 * Runs the string DP for a strong 5-voice core, then orchestrates it (with the
 * intensity build) via the shared orchestrateStringCore path.
 */
export function arrangeWorshipOrchestra(
  score: ScoreModel,
  chords: ChordEvent[],
  options: WorshipOrchestraOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile = options.profile ?? "melody_harmony";

  const core = options.polyphonic
    ? arrangeOrchestraPolyphonic(score, chords, { level: options.level }).scoreModel as ScoreModel
    : arrangeStringEnsemble(score, chords, { profile }).scoreModel as ScoreModel;

  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, pianoLeads: options.pianoLeads, melodyRests: options.melodyRests ?? sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}

export type RhythmChartLike = { beats: number; beatType: number; keyFifths: number; measures: Array<{ number: number; chords: Array<{ t: number; symbol: string }>; kicks: number[] | null }> };

/**
 * Build a HARMONY+RHYTHM skeleton from a parsed rhythm chart: one guide-tone
 * melody part whose onsets are the chord changes + kicks (comping bars = one
 * sustained slice, figure bars = a slice per kick), plus the chord events. The
 * guide-tone top (chord 3rd/root/5th nearest the previous note) gives any
 * arranger a real line to work from — without it the melody-less DP top voice
 * blows up combinatorially. Shared by the orchestra path AND the general pipeline
 * so a chart PDF can drive ANY ensemble.
 */
export function buildRhythmChartSkeleton(chart: RhythmChartLike): { score: ScoreModel; chords: ChordEvent[] } {
  const beats = chart.beats || 4;
  const measures: any[] = [];
  const chordEvents: ChordEvent[] = [];
  // Guide-tone top line: without a melody the DP's top voice would be free
  // (combinatorial blow-up + aimless line). Synthesize the classic arranger's
  // accompaniment top — the chord tone (3rd/root/5th) nearest the previous
  // note, in a singable band — and lock the grid to it as NOTES.
  const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let lastChordPcs: number[] = [chart.keyFifths >= 0 ? ((chart.keyFifths * 7) % 12) : (((chart.keyFifths * 7) % 12) + 12) % 12];
  let prevTop = 72;
  const topFor = (symbol: string | null): number => {
    if (symbol) {
      const m = symbol.match(/^([A-G])([#b]?)(m(?![a-z]))?/);
      if (m) {
        let root = NOTE_PC[m[1]!]!;
        if (m[2] === "#") root += 1; if (m[2] === "b") root -= 1;
        root = ((root % 12) + 12) % 12;
        const third = (root + (m[3] ? 3 : 4)) % 12;
        lastChordPcs = [third, root, (root + 7) % 12]; // prefer the 3rd (guide tone)
      }
    }
    let best = prevTop, bestD = Infinity;
    for (const pc of lastChordPcs) {
      for (let midi = 64; midi <= 81; midi++) {
        if (midi % 12 !== pc) continue;
        const d = Math.abs(midi - prevTop) + lastChordPcs.indexOf(pc) * 0.4;
        if (d < bestD) { bestD = d; best = midi; }
      }
    }
    prevTop = best;
    return best;
  };
  chart.measures.forEach((m, i) => {
    const num = i + 1; // sequential numbering (chart pickup becomes measure 1)
    const chordAt = (t: number) => {
      let sym: string | null = null;
      for (const c of m.chords) if (c.t <= t + 1e-9) sym = c.symbol;
      return sym;
    };
    const times = [0, ...(m.kicks ?? []), ...m.chords.map((c) => c.t)]
      .filter((t, idx, a) => t >= 0 && t < beats && a.indexOf(t) === idx)
      .sort((a, b) => a - b);
    const events = times.map((t, ti) => ({
      id: `grid-${num}-${t}`, t, dur: (ti + 1 < times.length ? times[ti + 1]! : beats) - t,
      type: "note", pitch: midiToPitch(topFor(chordAt(t))), voice: 1, staff: 1,
    }));
    measures.push({
      number: num,
      ...(i === 0 ? { attributes: { divisions: 4, time: { beats, beat_type: chart.beatType || 4, beatType: chart.beatType || 4 }, key_fifths: chart.keyFifths, key_mode: "major" } } : {}),
      events,
    });
    for (const c of m.chords) chordEvents.push({ measure: num, t: c.t, symbol: c.symbol });
  });
  const gridScore: any = {
    score_id: "rhythm_chart",
    meta: { title: "Rhythm chart", ensemble: "orchestra", inputKeyFifths: chart.keyFifths },
    parts: [{ part_id: "P_GRID", name: "Rhythm", instrument: "piano", staves: 1, measures }],
  };
  return { score: gridScore as ScoreModel, chords: chordEvents };
}

/**
 * Rhythm chart (PDF) → worship orchestra. Rhythm-aware: comping = sustained pads,
 * figure bars = ensemble hits (kicks), plus the full orchestra intensity build.
 * melodyRests is forced all-false (accompaniment: the band carries the melody).
 */
export function arrangeWorshipOrchestraFromRhythmChart(
  chart: RhythmChartLike,
  options: { warnings?: string[]; intensity?: IntensityMode; parts?: string[]; balance?: OrchestraBalance; partRanges?: PartRange[] } = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const { score, chords } = buildRhythmChartSkeleton(chart);
  warnings.push(`[orchestra] Rhythm chart: ${chart.measures.length} measures, ${chords.length} chord events, ${chart.measures.filter((m) => m.kicks?.length).length} figure bars.`);
  return arrangeWorshipOrchestra(score, chords, {
    ...options,
    warnings,
    melodyRests: new Array(chart.measures.length).fill(false),
  });
}

/**
 * Piano → worship orchestra. Faithful piano→quartet voice core (orchestra's own
 * forked transcription), then orchestrate. Self-contained — no shared deps.
 */
export function arrangeWorshipOrchestraFromPiano(
  score: ScoreModel,
  options: { warnings?: string[]; intensity?: IntensityMode; parts?: string[]; balance?: OrchestraBalance; partRanges?: PartRange[]; pianoLeads?: boolean } = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const core = arrangeStringQuartetFromPianoInstrumentation(score, { warnings });
  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, pianoLeads: options.pianoLeads, melodyRests: sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}

/**
 * SATB → worship orchestra. Faithful S/A/T/B → V1/V2/Vla/Vc transcription
 * (orchestra's own forked copy), then orchestrate. Self-contained.
 */
/**
 * Did the SATB split actually produce a quartet?
 *
 * When it cannot find four voices it returns the source score untouched, which
 * looks like success — a ScoreModel with parts and notes — and is not. The tell
 * is the roster: a real core is the four string voices it builds by name.
 */
function builtSatbCore(core: ScoreModel): boolean {
  const parts = (core as any)?.parts ?? [];
  if (parts.length < 4) return false;
  const named = (re: RegExp) => parts.some((p: any) => re.test(String(p?.name ?? "")));
  return named(/violin\s*(i\b|1)/i) && named(/violin\s*(ii\b|2)/i) && named(/viola/i) && named(/cello|bass/i);
}

export function arrangeWorshipOrchestraFromSatb(
  score: ScoreModel,
  options: { warnings?: string[]; intensity?: IntensityMode; parts?: string[]; balance?: OrchestraBalance; partRanges?: PartRange[] } = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const core = arrangeSatbToStringQuartetDirect(score, { warnings });
  // The quartet core is what the whole orchestra is built from: every wind and
  // brass part reads a string voice. When the source has no four voices to find
  // — a piano score, a single vocal line — that call hands the score straight
  // back, and the orchestration then has one line to spread across fourteen
  // parts. The result was ten silent staves and not one word about why.
  if (!builtSatbCore(core)) {
    const found = ((score as any)?.parts ?? []).map((p: any) => p?.name ?? "?").join(", ") || "none";
    warnings.push(
      `[satb→orchestra] Your uploaded file does not appear to be an SATB score. ` +
      `Found parts: ${found}. The "SATB → orchestra" mode expects four vocal parts ` +
      `(soprano, alto, tenor, bass), or a closed score with two per staff. Most of ` +
      `the orchestra will be silent. For a piano source use "piano → orchestra" instead.`
    );
  }
  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, melodyRests: sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}
