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
import { arrangeStringPolyphonic } from "../stringsPolyphony/stringsPolyphonicArranger";
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

/** Map the 5 string-DP parts (by slot order) onto the worship-orchestra roster. */
function remapToWorship(stringScore: ScoreModel): ScoreModel {
  const parts: any[] = (stringScore as any).parts ?? [];
  const slotOrder: StringVoice[] = ["vln1", "vln2", "vla", "vc", "cb"];
  const bySlot: Record<string, any> = {};
  parts.slice(0, 5).forEach((p, i) => { bySlot[slotOrder[i]!] = p; });

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
};

/**
 * Arrange a score as a worship/church orchestra (PraiseCharts layout).
 * Runs the string DP for a strong 5-voice core, then maps it onto the worship
 * roster with authentic part names and concert-pitch range placement.
 */
export function arrangeWorshipOrchestra(
  score: ScoreModel,
  chords: ChordEvent[],
  options: WorshipOrchestraOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile = options.profile ?? "melody_harmony";

  if (options.polyphonic) {
    const poly = arrangeStringPolyphonic(score, chords, { level: options.level });
    warnings.push(...(poly.warnings ?? []));
    warnings.push("[orchestra] Worship orchestra (contrapuntal core): brass+winds+strings on a 5-voice polyphonic core.");
    return { scoreModel: remapToWorship(poly.scoreModel as ScoreModel), warnings };
  }

  const sr = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(sr.warnings ?? []));
  warnings.push("[orchestra] Worship orchestra: Tpt 1-2-3, Horn 1-2, Tbn 1-2 + low brass, Flute/Oboe descant, strings cushion.");
  return { scoreModel: remapToWorship(sr.scoreModel as ScoreModel), warnings };
}
