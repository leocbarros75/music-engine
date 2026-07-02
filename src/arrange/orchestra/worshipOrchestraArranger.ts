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
  lowbr: { prefMin: 31, prefMax: 53 }, // G1..F3 — Trombone 3 / Tuba
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
  { partId: "P_TPT23", name: "Trumpet 2-3 (Alto Sax)", instrument: "trumpet_bb_2",
    voices: [{ src: "vln2", reg: "tpt2", voice: 1 }, { src: "vla", reg: "tpt3", voice: 2 }] },
  { partId: "P_TBN12", name: "Trombone 1-2 (Tenor Sax)", instrument: "trombone",
    voices: [{ src: "vc", reg: "tbn1", voice: 1 }, { src: "vla", reg: "tbn2", voice: 2 }] },
  { partId: "P_LOWBR", name: "Trombone 3/Tuba (Bari Sax)", instrument: "tuba_c",
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
  { id: "P_TPT23", name: "Trumpet 2-3 (Alto Sax)", section: "Brass" },
  { id: "P_TBN12", name: "Trombone 1-2 (Tenor Sax)", section: "Brass" },
  { id: "P_LOWBR", name: "Trombone 3/Tuba (Bari Sax)", section: "Brass" },
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
  options: { intensity?: IntensityMode; parts?: string[]; melodyRests?: boolean[]; balance?: OrchestraBalance; partRanges?: PartRange[] } = {}
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
  if (intensity === "build") {
    gateSections(orch, phraseInt, phraseLen, gaps, balance, manual);
    warnings.push("[orchestra] Worship orchestra (build): strings cushion throughout, brass/winds enter and build to the climaxes.");
  } else {
    warnings.push("[orchestra] Worship orchestra (tutti): full ensemble throughout.");
  }
  // Open spacing: widen muddy low intervals + spread excessive unison piles
  // (overtone-series principle — wide at the bottom, closer at the top).
  refineSpacing(orch);
  // Ritornello fills: in instrumental gaps the top voices take the lead so the
  // orchestra has a melodic top where the vocal would be (both build + tutti).
  fillGapTops(orch, gaps);
  if (gaps.some(Boolean)) warnings.push(`[orchestra] Ritornello: orchestra comes forward in ${gaps.filter(Boolean).length} instrumental gap measure(s).`);
  // Percussion (Timpani + Crash/Triangle) — driven by the same intensity curve.
  addPercussion(orch, phraseInt, phraseLen);

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
  P_HN12: 0.30,                                            // horn — present inner glue
  // Clarinet/Bassoon pulled back (was 0.40/0.34) to hit the pro family balance —
  // 3 doubling wind parts were over-weighting winds (21% vs 16% target). Reserving
  // them drops winds toward 16% and lifts strings' relative share toward 36%.
  P_BSN: 0.52,                                             // bassoon — woodwind bass, reserved for fuller sections
  P_CL: 0.55,                                              // clarinet — warm woodwind, comes in for lifts
  P_TPT1: 0.42, P_TBN12: 0.50,                             // lead trumpet / trombones — build to lifts
  P_TPT23: 0.50, P_FLOB: 0.50,                             // 2-3 trumpets + flute descant — for lifts
  P_LOWBR: 0.62,                                           // low brass — biggest moments only
};

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
function adjustedThreshold(partId: string, balance: OrchestraBalance): number | undefined {
  const base = SECTION_THRESHOLD[partId];
  if (base === undefined) return undefined;
  const fam = FAMILY_OF[partId];
  if (!fam) return base;
  return Math.max(0, Math.min(1, base + BALANCE_ADJ[balance][fam]));
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
    const base = 0.45 + 0.47 * Math.pow(progress, 0.7);
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
function gateSections(orch: ScoreModel, phraseIntensity: number[], phraseLen: number, gaps: boolean[], balance: OrchestraBalance = "default", manual?: Set<string>): void {
  const parts: any[] = (orch as any).parts ?? [];
  const nMeasures = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  for (const part of parts) {
    if (manual?.has(part.part_id)) continue; // user controls this part's measures manually
    const thr = adjustedThreshold(part.part_id, balance);
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

function addPercussion(orch: ScoreModel, phraseInt: number[], phraseLen: number): void {
  const parts: any[] = (orch as any).parts ?? [];
  const cello = parts.find((p) => p.part_id === "P_CELBS");
  if (!cello) return;
  const nMeasures = (cello.measures ?? []).length;
  if (nMeasures === 0) return;

  const timpMeasures: any[] = [];
  const percMeasures: any[] = [];
  const TIMP_LO = 38, TIMP_HI = 57; // D2..A3
  for (let mi = 0; mi < nMeasures; mi++) {
    const srcM = cello.measures[mi];
    const len = measureLenOf(srcM);
    const pi = Math.floor(mi / phraseLen);
    const intensity = phraseInt[pi] ?? 1;
    const isPhraseStart = mi % phraseLen === 0;

    // Timpani: bass root on beat 1 when the texture is full enough.
    const timpEvents: any[] = [];
    if (intensity >= TIMP_THRESHOLD) {
      const firstNote = (srcM?.events ?? []).find((e: any) => e?.type === "note" && e.pitch);
      const bassMidi = firstNote ? eventMidi(firstNote) : null;
      if (bassMidi !== null) {
        let m = bassMidi; while (m < TIMP_LO) m += 12; while (m > TIMP_HI) m -= 12;
        timpEvents.push({ id: `TIMP-${mi}`, t: 0, dur: Math.min(len, 2), type: "note", pitch: midiToPitch(m), voice: 1, staff: 1 });
      }
    }
    if (!timpEvents.length) timpEvents.push({ id: `TIMP-r-${mi}`, t: 0, dur: len, type: "rest", isRest: true, voice: 1, staff: 1 });
    timpMeasures.push({ number: srcM?.number ?? mi + 1, ...(mi === 0 && srcM?.attributes ? { attributes: JSON.parse(JSON.stringify(srcM.attributes)) } : {}), events: timpEvents });

    // Percussion (unpitched): crash on climax phrase starts; triangle on lifts.
    const percEvents: any[] = [];
    if (isPhraseStart && intensity >= CRASH_THRESHOLD) {
      percEvents.push({ id: `CRASH-${mi}`, t: 0, dur: len, type: "unpitched", instrumentId: "crash", voice: 1, staff: 1 });
    }
    if (isPhraseStart && intensity >= TRIANGLE_THRESHOLD) {
      percEvents.push({ id: `TRI-${mi}`, t: 0, dur: Math.min(len, 1), type: "unpitched", instrumentId: "triangle", voice: 1, staff: 1 });
    }
    if (!percEvents.length) percEvents.push({ id: `PERC-r-${mi}`, t: 0, dur: len, type: "rest", isRest: true, voice: 1, staff: 1 });
    percMeasures.push({ number: srcM?.number ?? mi + 1, ...(mi === 0 && srcM?.attributes ? { attributes: JSON.parse(JSON.stringify(srcM.attributes)) } : {}), events: percEvents });
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

  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, melodyRests: sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}

/**
 * Piano → worship orchestra. Faithful piano→quartet voice core (orchestra's own
 * forked transcription), then orchestrate. Self-contained — no shared deps.
 */
export function arrangeWorshipOrchestraFromPiano(
  score: ScoreModel,
  options: { warnings?: string[]; intensity?: IntensityMode; parts?: string[]; balance?: OrchestraBalance; partRanges?: PartRange[] } = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const core = arrangeStringQuartetFromPianoInstrumentation(score, { warnings });
  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, melodyRests: sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}

/**
 * SATB → worship orchestra. Faithful S/A/T/B → V1/V2/Vla/Vc transcription
 * (orchestra's own forked copy), then orchestrate. Self-contained.
 */
export function arrangeWorshipOrchestraFromSatb(
  score: ScoreModel,
  options: { warnings?: string[]; intensity?: IntensityMode; parts?: string[]; balance?: OrchestraBalance; partRanges?: PartRange[] } = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const core = arrangeSatbToStringQuartetDirect(score, { warnings });
  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity, parts: options.parts, balance: options.balance, partRanges: options.partRanges, melodyRests: sourceMelodyRestMeasures(score) });
  return { scoreModel, warnings };
}
