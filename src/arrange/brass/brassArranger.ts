// src/arrange/brass/brassArranger.ts
//
// Brass ensemble arranger — same engine pattern as the woodwind arranger:
//   1. Run the string DP (block) or the polyphonic engine (contrapuntal).
//   2. Remap the string voices → brass instruments by explicit DP slot:
//        Trumpet 1 ← vln1   Trumpet 2 ← vln2   Horn ← vla
//        Trombone  ← vc     Tuba      ← cb
//      (Quartet drops the Horn; Tuba still maps to cb so it stays the bass.)
//   3. Octave-place each note into the instrument's sweet-spot register.
//   4. For the block path, apply a per-voice rhythm grid from the source.
//
// Concert pitch throughout; the MusicXML exporter writes the transposition
// (Trumpet +2, Horn +7; Trombone/Tuba concert bass clef).

import type { ScoreModel, NoteEvent } from "../../score/types";
import { arrangeStringEnsemble } from "../strings/stringArranger";
import { arrangeBrassPolyphonic } from "./polyphony/brassPolyphonicArranger";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import type { ProfileId, Slice, Voicing, VoiceId } from "../strings/types";
import { buildCandidatesForSlice } from "../strings/candidates";
import {
  BRASS_RANGES, BRASS_TO_STRING_VOICE, BRASS_PART_META, BRASS_CHARACTER,
  BRASS_QUARTET_VOICES, BRASS_QUINTET_VOICES, type BrassVoiceId,
} from "./brassRanges";

type ChordEvent = { measure: number; t: number; symbol: string };
export type BrassActivity = "grounded" | "less_active" | "active" | "high_active";

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}
function snapDur(d: number): number {
  const S = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25] as const;
  for (const s of S) if (s <= d + 1e-9) return s;
  return 0.25;
}
function pickChordAt(chords: ChordEvent[], measure: number, t: number): string | null {
  const evs = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!evs.length) return null;
  let best: ChordEvent | null = null;
  for (const c of evs) if (Number(c.t) <= t) best = c;
  return best?.symbol ?? evs[0]?.symbol ?? null;
}
function clampToSweetSpot(midi: number, r: { absMin: number; absMax: number; prefMin: number; prefMax: number }): number {
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  const mid = (r.prefMin + r.prefMax) / 2;
  if (m < r.prefMin) { const up = m + 12; if (up <= r.absMax && Math.abs(up - mid) <= Math.abs(m - mid)) m = up; }
  if (m > r.prefMax) { const dn = m - 12; if (dn >= r.absMin && Math.abs(dn - mid) <= Math.abs(m - mid)) m = dn; }
  return m;
}
function activityToAgility(a: BrassActivity): number {
  return a === "grounded" ? 0.2 : a === "less_active" ? 0.6 : a === "active" ? 0.9 : 1.0;
}
function thinOnsets(times: number[], agility: number, measureLen: number, isMelody: boolean): number[] {
  if (isMelody || agility >= 0.8) return times;
  const step = agility < 0.5 ? measureLen / 2 : 1.0;
  const kept = times.filter((t) => Math.abs(t - Math.round(t / step) * step) < 1e-6);
  if (!kept.length || Math.abs(kept[0]! - 0) > 1e-6) kept.unshift(0);
  return Array.from(new Set(kept)).sort((a, b) => a - b);
}

// Map the string-DP score's voices onto brass instruments by explicit slot.
function remapStringToBrass(stringScore: ScoreModel, voices: BrassVoiceId[]): ScoreModel {
  const parts: any[] = (stringScore as any).parts ?? [];
  const bySlot: Record<string, any> = {};
  // String parts in canonical order vln1,vln2,vla,vc,cb
  const slotOrder = ["vln1", "vln2", "vla", "vc", "cb"];
  parts.slice(0, 5).forEach((p, i) => { bySlot[slotOrder[i]!] = p; });

  const brassParts = voices.map((bv) => {
    const slot = BRASS_TO_STRING_VOICE[bv];
    const src = bySlot[slot];
    const meta = BRASS_PART_META[bv];
    const range = BRASS_RANGES[bv];
    if (!src) return { ...meta, staves: 1, measures: [] };
    const measures = (src.measures ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).map((ev: any) => {
        if (ev.type !== "note" || !ev.pitch) return ev;
        const midi = eventMidi(ev);
        if (midi === null) return ev;
        const placed = clampToSweetSpot(midi, range);
        return placed === midi ? ev : { ...ev, pitch: midiToPitch(placed) };
      }),
    }));
    return { ...src, part_id: meta.part_id, name: meta.name, instrument: meta.instrument, staves: 1, measures };
  });

  return {
    ...(stringScore as any),
    parts: brassParts,
    meta: { ...(stringScore as any).meta, ensemble: "brass_ensemble" },
  } as any;
}

// Apply per-voice source rhythm to the brass voices (block path).
function applyBrassRhythm(
  score: ScoreModel,
  sourcePart: any,
  chords: ChordEvent[],
  key: { fifths: number; mode: "major" | "minor" },
  activity: Partial<Record<BrassVoiceId, BrassActivity>>
): void {
  if (!sourcePart) return;
  const srcMeasures: any[] = sourcePart.measures ?? [];
  const nameToVoice: Record<string, BrassVoiceId> = {
    "trumpet 1": "tpt1", "trumpet 2": "tpt2", "horn in f": "hn", "trombone": "tbn", "tuba": "tuba",
  };
  for (const part of (score as any).parts ?? []) {
    const wv = nameToVoice[String(part?.name ?? "").toLowerCase().trim()];
    if (!wv) continue;
    const stringVoice = BRASS_TO_STRING_VOICE[wv];
    const range = BRASS_RANGES[wv];
    const eff = activity[wv] ? activityToAgility(activity[wv]!) : BRASS_CHARACTER[wv].agility;
    const isMelody = wv === "tpt1" && activity[wv] !== "grounded" && activity[wv] !== "less_active";
    let prevMidi: number | null = null;

    part.measures = (part.measures ?? []).map((m: any) => {
      const mnum = Number(m.number);
      const beats = Number(m.attributes?.time?.beats ?? 4);
      const beatType = Number(m.attributes?.time?.beat_type ?? 4);
      const measureLen = beats * (4 / beatType);

      const dpSchedule = new Map<number, number>();
      for (const ev of (m.events ?? [])) {
        if (ev.type !== "note" || ev.isRest) continue;
        const mm = eventMidi(ev); if (mm !== null) dpSchedule.set(Number(ev.t ?? 0), mm);
      }
      const dpAnchorAt = (t: number) => { let b: number | null = null; for (const [st, p] of dpSchedule) if (st <= t + 1e-9) b = p; return b; };

      const srcM = srcMeasures.find((pm: any) => Number(pm.number) === mnum);
      const onsetSet = new Set<number>();
      if (srcM) for (const ev of (srcM.events ?? [])) {
        if (ev.type !== "note") continue;
        const t = Number(ev.t ?? 0);
        if (t >= 0 && t < measureLen) onsetSet.add(Math.round(t * 1000) / 1000);
      }
      if (!onsetSet.size) for (let t = 0; t < measureLen; t += 1.0) onsetSet.add(Math.round(t * 1000) / 1000);

      // quarter-note gap fill
      const sorted = Array.from(onsetSet).sort((a, b) => a - b);
      const bounds = [...sorted, measureLen];
      for (let i = 0; i < bounds.length - 1; i++) {
        const gs = bounds[i]!, ge = bounds[i + 1]!;
        if (ge - gs > 1 + 1e-9) for (let ft = gs + 1; ft < ge - 1e-9; ft += 1) onsetSet.add(Math.round(ft * 1000) / 1000);
      }

      const times = [...thinOnsets(Array.from(onsetSet).sort((a, b) => a - b), eff, measureLen, isMelody), measureLen];
      const events: NoteEvent[] = [];
      for (let i = 0; i < times.length - 1; i++) {
        const t = times[i]!, next = times[i + 1]!;
        const capDur = measureLen - t; if (capDur <= 0) continue;
        const dur = snapDur(Math.min(capDur, next - t)); if (dur <= 0) continue;
        const slice: Slice = { measure: mnum, t, dur, melodyMidi: null, chordSymbol: pickChordAt(chords, mnum, t) };
        const prevVoicing: Voicing | null = prevMidi !== null
          ? { vln1: null, vln2: null, vla: null, vc: null, cb: null, [stringVoice]: prevMidi } as any : null;
        const cands = buildCandidatesForSlice({ slice, prevVoicing, keyFifths: key.fifths, keyMode: key.mode })[stringVoice as VoiceId];
        const anchor = dpAnchorAt(t) ?? prevMidi ?? Math.round((range.prefMin + range.prefMax) / 2);
        let midi: number | null = null;
        if (cands.length) midi = cands.reduce((b, c) => (Math.abs(c - anchor) < Math.abs(b - anchor) ? c : b));
        if (midi === null) {
          events.push({ id: `${wv}-r-${mnum}-${t}`, t, dur, type: "rest", voice: 1, staff: 1, isRest: true } as any);
        } else {
          midi = clampToSweetSpot(midi, range); prevMidi = midi;
          events.push({ id: `${wv}-n-${mnum}-${t}`, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });
        }
      }
      return { ...m, events };
    });
  }
}

export type BrassArrangerOptions = {
  profile?: ProfileId;
  chords?: ChordEvent[];
  key?: { fifths: number; mode: "major" | "minor" };
  warnings?: string[];
  quintet?: boolean;          // true = with Horn (default); false = quartet (no Horn)
  polyphonic?: boolean;       // contrapuntal path
  level?: string;
  activity?: Partial<Record<BrassVoiceId, BrassActivity>>;
};

/**
 * Arrange a score as a brass quintet (Tpt1/Tpt2/Horn/Trombone/Tuba) or quartet.
 */
export function arrangeBrassEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: BrassArrangerOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile = options.profile ?? "melody_harmony";
  const quintet = options.quintet ?? true; // brass quintet is the standard ensemble
  const voices = quintet ? BRASS_QUINTET_VOICES : BRASS_QUARTET_VOICES;
  const key = options.key ?? { fifths: 0, mode: "major" as const };

  // Contrapuntal → polyphonic engine, keep independent rhythms (no flattening).
  if (options.polyphonic) {
    const poly = arrangeBrassPolyphonic(score, chords, { level: options.level });
    warnings.push(...(poly.warnings ?? []));
    return { scoreModel: remapStringToBrass(poly.scoreModel as ScoreModel, voices), warnings };
  }

  // Block path: string DP → remap → per-voice source rhythm.
  const sr = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(sr.warnings ?? []));
  const brassScore = remapStringToBrass(sr.scoreModel as ScoreModel, voices);

  const melodyPart = (score.parts ?? []).find((p: any) => {
    const n = String(p?.name ?? "").toLowerCase();
    return n.includes("soprano") || n.includes("melody") || n.includes("voice");
  }) ?? score.parts?.[0] ?? null;

  if (melodyPart && chords.length) {
    applyBrassRhythm(brassScore, melodyPart, chords, key, options.activity ?? {});
  }

  return { scoreModel: brassScore, warnings };
}
