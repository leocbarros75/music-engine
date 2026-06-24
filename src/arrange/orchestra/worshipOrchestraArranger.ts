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
import { arrangeStringEnsemble } from "../strings/stringArranger";
import { arrangeOrchestraPolyphonic } from "./polyphony/orchestraPolyphonicArranger";
import { midiToPitch, pitchToMidi, getInstrumentSpec } from "../../instruments/instrumentCatalog";
import type { ProfileId } from "../strings/types";

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
  hn:    { prefMin: 53, prefMax: 69 }, // F3..A4
  tbn1:  { prefMin: 48, prefMax: 65 }, // C3..F4
  tbn2:  { prefMin: 43, prefMax: 60 }, // G2..C4
  lowbr: { prefMin: 31, prefMax: 53 }, // G1..F3 — Trombone 3 / Tuba
  vln1:  { prefMin: 62, prefMax: 84 }, // D4..C6
  vln2:  { prefMin: 57, prefMax: 79 }, // A3..G5
  vla:   { prefMin: 50, prefMax: 69 }, // D3..A4
  celbs: { prefMin: 36, prefMax: 60 }, // C2..C4 — Cello-Bass
};

// The worship-orchestra part roster. `voices` lists which string-DP voice feeds
// each notated voice on the staff (top-to-bottom). `reg` keys index REG.
type PartDef = {
  partId: string;
  name: string;
  instrument: string;
  voices: Array<{ src: StringVoice; reg: string; voice: number }>;
};

const WORSHIP_PARTS: PartDef[] = [
  // ── Woodwinds (one high melodic/descant line) ──
  { partId: "P_FLOB", name: "Flute/Oboe (Clarinet)", instrument: "flute",
    voices: [{ src: "vln1", reg: "fl", voice: 1 }] },

  // ── Brass (the core of the worship orchestra) ──
  { partId: "P_TPT12", name: "Trumpet 1-2", instrument: "trumpet_bb_1",
    voices: [{ src: "vln1", reg: "tpt1", voice: 1 }, { src: "vln2", reg: "tpt2", voice: 2 }] },
  { partId: "P_TPT3", name: "Trumpet 3 (Alto Sax)", instrument: "trumpet_bb_2",
    voices: [{ src: "vla", reg: "tpt3", voice: 1 }] },
  { partId: "P_HN12", name: "Horn 1-2", instrument: "horn_f",
    voices: [{ src: "vla", reg: "hn", voice: 1 }, { src: "vc", reg: "hn", voice: 2 }] },
  { partId: "P_TBN12", name: "Trombone 1-2 (Tenor Sax)", instrument: "trombone",
    voices: [{ src: "vc", reg: "tbn1", voice: 1 }, { src: "vla", reg: "tbn2", voice: 2 }] },
  { partId: "P_LOWBR", name: "Trombone 3/Tuba (Bari Sax)", instrument: "tuba_c",
    voices: [{ src: "cb", reg: "lowbr", voice: 1 }] },

  // ── Strings (the cushion) ──
  { partId: "P_VLN1", name: "Violin 1", instrument: "violin_1",
    voices: [{ src: "vln1", reg: "vln1", voice: 1 }] },
  { partId: "P_VLN2", name: "Violin 2", instrument: "violin_2",
    voices: [{ src: "vln2", reg: "vln2", voice: 1 }] },
  { partId: "P_VLA", name: "Viola", instrument: "viola",
    voices: [{ src: "vla", reg: "vla", voice: 1 }] },
  { partId: "P_CELBS", name: "Cello-Bass", instrument: "cello",
    voices: [{ src: "vc", reg: "celbs", voice: 1 }] },
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
 * Orchestrate a string-voice core (4 or 5 parts in slot order V1/V2/Vla/Vc[/Cb])
 * onto the worship-orchestra roster. Used by every source mode (auto DP core,
 * piano→quartet core, SATB→quartet core). All orchestration/sound decisions live
 * here, so changing the orchestra never touches the input machinery that built
 * the core.
 */
export function orchestrateStringCore(
  stringScore: ScoreModel,
  warnings: string[] = [],
  options: { intensity?: IntensityMode } = {}
): ScoreModel {
  const orch = remapToWorship(stringScore);
  const intensity = options.intensity ?? "build";
  if (intensity === "build") {
    applyWorshipIntensity(orch);
    warnings.push("[orchestra] Worship orchestra (build): strings cushion throughout, brass/winds enter and build to the climaxes.");
  } else {
    warnings.push("[orchestra] Worship orchestra (tutti): full ensemble throughout.");
  }
  return orch;
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
  P_TPT12: 0.46, P_TBN12: 0.50,                            // trumpets/trombones — build to lifts
  P_TPT3: 0.55, P_FLOB: 0.50,                              // 3rd tpt + descant — for lifts
  P_LOWBR: 0.62,                                           // low brass — biggest moments only
};

function measureLenOf(m: any): number {
  const beats = Number(m?.attributes?.time?.beats ?? 4);
  const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
  return beats * (4 / beatType);
}

/**
 * Phrase-based participation. Builds a rising intensity arc across the piece
 * (light intro → peak at the final choruses), modulated per phrase by the
 * melody's local register + density, then rests each section's phrases that fall
 * below its entrance threshold. Sections enter/exit at phrase boundaries (4 bars)
 * — like real charts — not measure-to-measure flicker.
 */
function applyWorshipIntensity(orch: ScoreModel, phraseLen = 4): void {
  const parts: any[] = (orch as any).parts ?? [];
  const nMeasures = Math.max(0, ...parts.map((p) => (p.measures ?? []).length));
  if (nMeasures === 0) return;
  const nPhrases = Math.ceil(nMeasures / phraseLen);

  // Melody reference = Violin 1 (top line) for local-intensity modulation.
  const melody = parts.find((p) => p.part_id === "P_VLN1");
  const allMidis: number[] = [];
  for (const m of melody?.measures ?? []) for (const e of (m.events ?? [])) {
    if (e?.type === "note" && e.pitch) { const v = eventMidi(e); if (v !== null) allMidis.push(v); }
  }
  const loRef = allMidis.length ? Math.min(...allMidis) : 60;
  const hiRef = allMidis.length ? Math.max(...allMidis) : 72;
  const span = Math.max(1, hiRef - loRef);

  // Per-phrase intensity.
  const phraseIntensity: number[] = [];
  for (let pi = 0; pi < nPhrases; pi++) {
    const progress = nPhrases > 1 ? pi / (nPhrases - 1) : 1;
    // Concave rising arc: ~0.45 → ~0.92.
    const base = 0.45 + 0.47 * Math.pow(progress, 0.7);
    // Local melody modulation: higher + busier phrase → more intense.
    let sum = 0, count = 0;
    for (let mi = pi * phraseLen; mi < Math.min((pi + 1) * phraseLen, nMeasures); mi++) {
      for (const e of (melody?.measures?.[mi]?.events ?? [])) {
        if (e?.type === "note" && e.pitch) { const v = eventMidi(e); if (v !== null) { sum += v; count++; } }
      }
    }
    const meanReg = count ? (sum / count - loRef) / span : 0.5;       // 0..1
    const density = Math.min(1, count / (phraseLen * 4));              // 0..1 (~4 notes/bar = busy)
    const mod = 0.18 * meanReg + 0.10 * density - 0.10;               // −0.10..+0.18
    phraseIntensity.push(Math.max(0, Math.min(1, base + mod)));
  }
  // Real worship almost always opens light — cap the first phrase to a
  // strings + horn texture so the brass/winds clearly enter as the song builds.
  if (nPhrases > 2) phraseIntensity[0] = Math.min(phraseIntensity[0]!, 0.40);
  // The final phrase is the big finish — force it to full tutti.
  phraseIntensity[nPhrases - 1] = 1;

  for (const part of parts) {
    const thr = SECTION_THRESHOLD[part.part_id];
    if (thr === undefined) continue; // unknown part → leave playing
    for (let pi = 0; pi < nPhrases; pi++) {
      if (phraseIntensity[pi]! >= thr) continue; // section plays this phrase
      // Rest this section for the phrase (whole-measure rests).
      for (let mi = pi * phraseLen; mi < Math.min((pi + 1) * phraseLen, nMeasures); mi++) {
        const m = part.measures?.[mi];
        if (!m) continue;
        m.events = [{ id: `${part.part_id}-rest-${mi}`, t: 0, dur: measureLenOf(m), type: "rest", isRest: true, voice: 1, staff: 1 } as any];
      }
    }
  }
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

  const scoreModel = orchestrateStringCore(core, warnings, { intensity: options.intensity });
  return { scoreModel, warnings };
}
