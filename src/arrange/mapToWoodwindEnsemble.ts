// src/arrange/mapToWoodwindEnsemble.ts

import type { ScoreModel } from "../score/types";
import { InstrumentCatalog, shiftOctavesIntoRange, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

type ChordEvent = { measure: number; t: number; symbol: string };

export type WoodwindMapOptions = {
  level?: "beginner" | "intermediate" | "advanced" | "professional";
  accompaniment?: string;
  textureMode?: string;
  chords?: ChordEvent[];
  warnings?: string[];
};

function makePart(part_id: string, name: string, instrument: string, staves = 1) {
  return { part_id, name, instrument, staves, measures: [] as any[] };
}

function cloneMeasureShell(m: any) {
  return { number: m.number, attributes: { ...m.attributes }, events: [] as any[] };
}

function addNote(
  measure: any,
  t: number,
  dur: number,
  pitch: { step: string; alter?: number; octave: number },
  voice: number,
  idPrefix: string,
  seq: number
) {
  measure.events.push({
    id: `${idPrefix}_${measure.number}_${seq}`,
    t,
    dur,
    type: "note",
    pitch,
    voice,
    staff: 1
  });
}

function warn(warnings: string[] | undefined, msg: string): void {
  if (!warnings) return;
  warnings.push(msg);
}

function parsePcToken(tok: string): number | null {
  const m = String(tok ?? "").trim().match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const byStep: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = byStep[step];
  if (typeof base !== "number") return null;
  const alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  return (base + alter + 12) % 12;
}

function parseBassPc(symbol: string): number | null {
  const s = String(symbol ?? "").trim();
  if (!s) return null;
  const slash = s.split("/");
  if (slash.length > 1) {
    const bass = parsePcToken(slash[1] ?? "");
    if (bass !== null) return bass;
  }
  const parsed = parseChordSymbol(s);
  if (parsed) return parsed.rootPc;
  return parsePcToken(s);
}

function measureBeats(attrs: any | undefined): number {
  const beats = Number(attrs?.time?.beats ?? 4);
  const beatType = Number(attrs?.time?.beat_type ?? attrs?.time?.beatType ?? 4);
  if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) return 4;
  return beats * (4 / beatType);
}

function uniquePcs(pcs: number[]): number[] {
  return Array.from(new Set(pcs.map((pc) => ((pc % 12) + 12) % 12)));
}

function chooseMidiForPc(
  pc: number,
  range: { min: number; max: number },
  params: { center: number; prev?: number | null; upper?: number | null; lower?: number | null }
): number | null {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    const mpc = ((m % 12) + 12) % 12;
    if (mpc !== ((pc % 12) + 12) % 12) continue;
    if (typeof params.upper === "number" && m > params.upper) continue;
    if (typeof params.lower === "number" && m < params.lower) continue;
    candidates.push(m);
  }
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const move = typeof params.prev === "number" ? Math.abs(c - params.prev) : 0;
    const center = Math.abs(c - params.center);
    const score = move * 3 + center;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function shiftOctavesToward(midi: number, lo: number, hi: number, center: number): number {
  let m = shiftOctavesIntoRange(midi, lo, hi);
  const candidates: number[] = [];
  for (let k = -4; k <= 4; k++) {
    const c = m + 12 * k;
    if (c >= lo && c <= hi) candidates.push(c);
  }
  if (candidates.length === 0) return m;
  let best = candidates[0]!;
  let bestDist = Math.abs(best - center);
  for (const c of candidates) {
    const d = Math.abs(c - center);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function homophonicLevel(options: WoodwindMapOptions): "beginner" | "intermediate" | "advanced" | null {
  const level = String(options.level ?? "").toLowerCase();
  const accompaniment = String(options.accompaniment ?? "").toLowerCase();
  const textureMode = String(options.textureMode ?? "").toLowerCase();
  const isHomophonic =
    accompaniment === "homophonic" ||
    accompaniment === "chordal" ||
    textureMode === "homophony_homorhythmic" ||
    textureMode === "homophony_melody_accompaniment";
  if (!isHomophonic) return null;
  if (level === "beginner") return "beginner";
  if (level === "intermediate") return "intermediate";
  if (level === "advanced") return "advanced";
  return null;
}

function findSourcePart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  const pianoByInstrument = parts.find((p: any) => String(p?.instrument ?? "").toLowerCase().includes("piano"));
  if (pianoByInstrument) return pianoByInstrument;
  const pianoByStaves = parts.find((p: any) => Number(p?.staves ?? 1) >= 2);
  if (pianoByStaves) return pianoByStaves;
  return parts[0] ?? null;
}

function normalizeChords(score: ScoreModel, options: WoodwindMapOptions): ChordEvent[] {
  const fromOptions = Array.isArray(options.chords) ? options.chords : [];
  const fromMeta = Array.isArray((score as any)?.meta?.inputChords) ? ((score as any).meta.inputChords as ChordEvent[]) : [];
  const src = fromOptions.length ? fromOptions : fromMeta;
  return src
    .map((c) => ({
      measure: Number(c.measure),
      t: Number(c.t),
      symbol: String(c.symbol ?? "")
    }))
    .filter((c) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol)
    .sort((a, b) => (a.measure - b.measure) || (a.t - b.t));
}

function collectRhTopNotes(m: any): Array<{ t: number; dur: number; midi: number }> {
  const notes = (m?.events ?? [])
    .filter((ev: any) => ev?.type === "note" && ev?.pitch)
    .map((ev: any) => ({ ev, midi: pitchToMidi(ev.pitch) }))
    .filter((x: any) => Number.isFinite(x.midi));
  const hasStaff = notes.some((n: any) => Number.isFinite(Number(n.ev?.staff)));
  const rh = notes.filter((n: any) => {
    if (hasStaff) return Number(n.ev?.staff ?? 1) === 1;
    return n.midi >= 60;
  });
  const src = rh.length ? rh : notes;
  const byT = new Map<number, { t: number; dur: number; midi: number }>();
  for (const n of src) {
    const t = Number(n.ev?.t ?? 0);
    const dur = Number(n.ev?.dur ?? 0);
    if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
    const prev = byT.get(t);
    if (!prev || n.midi > prev.midi) {
      byT.set(t, { t, dur, midi: n.midi });
    }
  }
  return Array.from(byT.values()).sort((a, b) => a.t - b.t);
}

function collectOnsetPcs(m: any): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const ev of m?.events ?? []) {
    if (ev?.type !== "note" || !ev?.pitch) continue;
    const t = Number(ev.t ?? 0);
    if (!Number.isFinite(t)) continue;
    const pc = ((pitchToMidi(ev.pitch) % 12) + 12) % 12;
    const list = out.get(t) ?? [];
    list.push(pc);
    out.set(t, list);
  }
  for (const [k, v] of out.entries()) out.set(k, uniquePcs(v));
  return out;
}

function mapBeginnerHomophonic(score: ScoreModel, options: WoodwindMapOptions): ScoreModel {
  const srcPart = findSourcePart(score);
  if (!srcPart) return score;
  const level = String(options.level ?? "").toLowerCase();
  const isIntermediate = level === "intermediate";
  const isAdvanced = level === "advanced";
  const isUpperHomophonic = isIntermediate || isAdvanced;

  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const outParts = [fl, ob, cl, bn];

  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures ?? []) {
    const shells = outParts.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;
    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = normalizeChords(score, options);
  const chordsByMeasure = new Map<number, ChordEvent[]>();
  for (const ch of chords) {
    const list = chordsByMeasure.get(ch.measure) ?? [];
    list.push(ch);
    chordsByMeasure.set(ch.measure, list);
  }
  for (const list of chordsByMeasure.values()) {
    list.sort((a, b) => a.t - b.t);
  }

  // Homophonic ranges by level (strict no-crossing order):
  // Beginner:
  //   Flute C4-G5, Oboe D4-Eb6, Clarinet E3-C6, Bassoon F1-G3.
  // Intermediate:
  //   Flute C4-G6, Oboe C4-Eb6, Clarinet E3-G6, Bassoon Bb1-G4.
  // Advanced:
  //   Flute B3-D7, Oboe Bb3-A6, Clarinet E3-C7, Bassoon B1-E5.
  const rFL = isAdvanced
    ? { midi_low: 59, midi_high: 98, preferred_low: 67, preferred_high: 89 }
    : isIntermediate
      ? { midi_low: 60, midi_high: 91, preferred_low: 67, preferred_high: 84 }
      : { midi_low: 60, midi_high: 79, preferred_low: 67, preferred_high: 77 };
  const rOB = isAdvanced
    ? { midi_low: 58, midi_high: 93, preferred_low: 64, preferred_high: 86 }
    : isIntermediate
      ? { midi_low: 60, midi_high: 87, preferred_low: 65, preferred_high: 82 }
      : { midi_low: 62, midi_high: 87, preferred_low: 67, preferred_high: 82 };
  const rCL = isAdvanced
    ? { midi_low: 52, midi_high: 96, preferred_low: 60, preferred_high: 88 }
    : isIntermediate
      ? { midi_low: 52, midi_high: 91, preferred_low: 60, preferred_high: 84 }
      : { midi_low: 52, midi_high: 84, preferred_low: 60, preferred_high: 79 };
  const rBN = isAdvanced
    ? { midi_low: 35, midi_high: 76, preferred_low: 40, preferred_high: 60 }
    : isIntermediate
      ? { midi_low: 34, midi_high: 67, preferred_low: 38, preferred_high: 55 }
      : { midi_low: 29, midi_high: 55, preferred_low: 34, preferred_high: 50 };

  let seq = 0;
  let prevOb: number | null = null;
  let prevCl: number | null = null;
  let prevBn: number | null = null;
  let activeChord: ChordEvent | null = null;

  for (let mi = 0; mi < (srcPart.measures ?? []).length; mi++) {
    const srcMeasure = srcPart.measures[mi];
    const mNum = Number(srcMeasure?.number ?? mi + 1);
    const shells = measureMap[String(mNum)];
    if (!shells) continue;

    const melody = collectRhTopNotes(srcMeasure);
    const onsetPcs = collectOnsetPcs(srcMeasure);
    const chordsHere = chordsByMeasure.get(mNum) ?? [];
    const mBeats = measureBeats(srcMeasure?.attributes);
    const bassPlan: Array<{ t: number; dur: number; midi: number }> = [];

    if (chordsHere.length) {
      for (let ci = 0; ci < chordsHere.length; ci++) {
        const ch = chordsHere[ci]!;
        const nextT = ci + 1 < chordsHere.length ? chordsHere[ci + 1]!.t : mBeats;
        const dur = Math.max(0.25, nextT - ch.t);
        const bassPc = parseBassPc(ch.symbol);
        if (bassPc === null) continue;
        const bnMidi =
          chooseMidiForPc(bassPc, { min: rBN.midi_low, max: rBN.midi_high }, {
            center: 41,
            prev: prevBn
          }) ?? shiftOctavesToward(41, rBN.midi_low, rBN.midi_high, 41);
        bassPlan.push({ t: ch.t, dur, midi: bnMidi });
        addNote(shells[3], ch.t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
      }
    } else {
      const lh = (srcMeasure?.events ?? [])
        .filter((ev: any) => ev?.type === "note" && ev?.pitch)
        .map((ev: any) => ({ ev, midi: pitchToMidi(ev.pitch) }))
        .filter((x: any) => Number.isFinite(x.midi) && Number(x.ev?.staff ?? 2) === 2);
      const byT = new Map<number, number[]>();
      for (const n of lh) {
        const t = Number(n.ev?.t ?? 0);
        const list = byT.get(t) ?? [];
        list.push(n.midi);
        byT.set(t, list);
      }
      const times = Array.from(byT.keys()).sort((a, b) => a - b);
      for (let ti = 0; ti < times.length; ti++) {
        const t = times[ti]!;
        const nextT = ti + 1 < times.length ? times[ti + 1]! : mBeats;
        const dur = Math.max(0.25, nextT - t);
        const low = Math.min(...(byT.get(t) ?? [41]));
        const bnMidi = shiftOctavesToward(low, rBN.midi_low, rBN.midi_high, 41);
        bassPlan.push({ t, dur, midi: bnMidi });
        addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
      }
    }

    const bassAt = (t: number): number | null => {
      let active: { t: number; midi: number } | null = null;
      for (const b of bassPlan) {
        if (b.t - 1e-9 <= t && t < b.t + b.dur - 1e-9) {
          if (!active || b.t > active.t) active = { t: b.t, midi: b.midi };
        }
      }
      return active?.midi ?? null;
    };

    let chordIdx = 0;

    for (const mEv of melody) {
      while (chordIdx < chordsHere.length && chordsHere[chordIdx]!.t <= mEv.t + 1e-9) {
        activeChord = chordsHere[chordIdx]!;
        chordIdx += 1;
      }

      const fluteSourceMidi = isUpperHomophonic ? mEv.midi + 12 : mEv.midi;
      const flMidi = shiftOctavesIntoRange(fluteSourceMidi, rFL.midi_low, rFL.midi_high);
      addNote(shells[0], mEv.t, mEv.dur, midiToPitch(flMidi), 1, "FL", ++seq);

      const melodyPc = ((flMidi % 12) + 12) % 12;
      const parsed = activeChord ? parseChordSymbol(activeChord.symbol) : null;
      const bassPc = activeChord ? (parseBassPc(activeChord.symbol) ?? parsed?.rootPc ?? melodyPc) : melodyPc;
      const fallbackPcs = onsetPcs.get(mEv.t) ?? [melodyPc];
      const pcs = uniquePcs(parsed?.pcs?.length ? parsed.pcs : fallbackPcs);
      const rootPc = parsed?.rootPc ?? pcs[0] ?? melodyPc;
      const majThird = (rootPc + 4) % 12;
      const minThird = (rootPc + 3) % 12;
      const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
      const fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;

      const preferred = uniquePcs(
        [
          thirdPc ?? undefined,
          fifthPc ?? undefined,
          rootPc,
          ...pcs.filter((pc) => pc !== melodyPc && pc !== bassPc)
        ].filter((x): x is number => typeof x === "number")
      );
      const harmonyPcs = preferred.length ? preferred : uniquePcs([rootPc, bassPc]);
      const bassMidi = bassAt(mEv.t);

      let obMidi: number | null = null;
      let clMidi: number | null = null;

      if (isUpperHomophonic) {
        const requiredPcs = uniquePcs(
          [rootPc, thirdPc ?? undefined, fifthPc ?? undefined].filter((x): x is number => typeof x === "number")
        );
        const chordCore = requiredPcs.length ? requiredPcs : harmonyPcs;

        const coveredBefore = new Set<number>();
        for (const pc of [melodyPc, bassPc]) {
          if (chordCore.includes(pc)) coveredBefore.add(pc);
        }
        const missingBefore = chordCore.filter((pc) => !coveredBefore.has(pc));
        const obPriority = uniquePcs([...missingBefore, ...harmonyPcs]);
        let obChosenPc: number | null = null;

        for (const pc of obPriority) {
          const pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
            center: Math.min(flMidi - 4, rOB.preferred_high ?? rOB.midi_high),
            prev: prevOb,
            upper: flMidi - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
          });
          if (pick !== null) {
            obMidi = pick;
            obChosenPc = pc;
            break;
          }
        }
        if (obMidi === null) {
          obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);
          obChosenPc = ((obMidi % 12) + 12) % 12;
        }

        const coveredAfterOb = new Set<number>(coveredBefore);
        if (obChosenPc !== null && chordCore.includes(obChosenPc)) coveredAfterOb.add(obChosenPc);
        const missingAfterOb = chordCore.filter((pc) => !coveredAfterOb.has(pc));
        const chordComplete = missingAfterOb.length === 0;

        const clPriority = chordComplete
          ? uniquePcs([obChosenPc ?? undefined, ...harmonyPcs].filter((x): x is number => typeof x === "number"))
          : uniquePcs([
              ...missingAfterOb,
              ...harmonyPcs.filter((pc) => pc !== obChosenPc),
              ...harmonyPcs.filter((pc) => pc === obChosenPc)
            ]);

        for (const pc of clPriority) {
          const pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
            center: Math.min((obMidi ?? flMidi) - 5, rCL.preferred_high ?? rCL.midi_high),
            prev: prevCl,
            upper: (obMidi ?? flMidi) - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
          });
          if (pick !== null) {
            clMidi = pick;
            break;
          }
        }
        if (clMidi === null) clMidi = shiftOctavesToward((obMidi ?? flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
      } else {
        for (const pc of harmonyPcs) {
          const pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
            center: Math.min(flMidi - 4, rOB.preferred_high ?? rOB.midi_high),
            prev: prevOb,
            upper: flMidi - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
          });
          if (pick !== null) {
            obMidi = pick;
            break;
          }
        }
        if (obMidi === null) obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);

        for (const pc of harmonyPcs) {
          const pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
            center: Math.min((obMidi ?? flMidi) - 5, rCL.preferred_high ?? rCL.midi_high),
            prev: prevCl,
            upper: (obMidi ?? flMidi) - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
          });
          if (pick !== null) {
            clMidi = pick;
            break;
          }
        }
        if (clMidi === null) clMidi = shiftOctavesToward((obMidi ?? flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
      }

      if (obMidi! >= flMidi) obMidi = shiftOctavesIntoRange(flMidi - 1, rOB.midi_low, rOB.midi_high);
      if (clMidi! >= obMidi!) clMidi = shiftOctavesIntoRange(obMidi! - 1, rCL.midi_low, rCL.midi_high);
      if (typeof bassMidi === "number" && clMidi! <= bassMidi) {
        const lifted = shiftOctavesIntoRange(bassMidi + 1, rCL.midi_low, rCL.midi_high);
        clMidi = lifted < obMidi! ? lifted : clMidi;
      }
      if (clMidi! >= obMidi!) {
        const raisedOb = shiftOctavesIntoRange(clMidi! + 1, rOB.midi_low, rOB.midi_high);
        if (raisedOb < flMidi) obMidi = raisedOb;
      }
      if (clMidi! >= obMidi!) clMidi = Math.max(rCL.midi_low, Math.min(rCL.midi_high, obMidi! - 1));

      addNote(shells[1], mEv.t, mEv.dur, midiToPitch(obMidi!), 1, "OB", ++seq);
      addNote(shells[2], mEv.t, mEv.dur, midiToPitch(clMidi!), 1, "CL", ++seq);
      prevOb = obMidi!;
      prevCl = clMidi!;
    }
  }

  if (!chords.length) {
    warn(
      options.warnings,
      `[woodwinds] ${isAdvanced ? "Advanced" : isIntermediate ? "Intermediate" : "Beginner"} homophonic: no chord hints found, bassoon used source bass notes.`
    );
  } else {
    warn(
      options.warnings,
      isAdvanced
        ? "[woodwinds] Advanced homophonic applied (Flute melody +8ve, strict advanced ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
        : isIntermediate
          ? "[woodwinds] Intermediate homophonic applied (Flute melody +8ve, strict intermediate ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
          : "[woodwinds] Beginner homophonic applied (Flute original melody pitch, strict beginner ranges, no crossing, Bassoon chord bass, Oboe/Clarinet harmony)."
    );
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: outParts
  } as any;
}

function mapLegacyOpen(score: ScoreModel): ScoreModel {
  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const partsOut = [fl, ob, cl, bn];

  const srcPart = score.parts[0];
  if (!srcPart) return score;
  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures) {
    const shells = partsOut.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;

    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = extractOnsetChords(score);

  const rFL = InstrumentCatalog.flute;
  const rOB = InstrumentCatalog.oboe;
  const rCL = InstrumentCatalog.clarinet_bb;
  const rBN = InstrumentCatalog.bassoon;

  const CENTER_FL = 79;
  const CENTER_OB = 74;
  const CENTER_CL = 69;
  const CENTER_BN = 46;

  let seq = 0;
  for (const ch of chords) {
    const shells = measureMap[String(ch.measure)];
    if (!shells) continue;

    const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
    if (notes.length === 0) continue;

    const t = ch.t;
    const dur = Math.max(...notes.map((n) => (n as any).dur ?? 1), 1);

    const pick = (idx: number) => notes[Math.min(Math.max(idx, 0), notes.length - 1)]!.midi;

    const low = pick(0);
    const mid1 = pick(Math.floor((notes.length - 1) * 0.33));
    const mid2 = pick(Math.floor((notes.length - 1) * 0.66));
    const high = pick(notes.length - 1);

    let mBN = low;
    let mCL = mid1;
    let mOB = mid2;
    let mFL = high;

    mBN = shiftOctavesToward(mBN, rBN.midi_low, rBN.midi_high, CENTER_BN);
    mCL = shiftOctavesToward(mCL, rCL.midi_low, rCL.midi_high, CENTER_CL);
    mOB = shiftOctavesToward(mOB, rOB.midi_low, rOB.midi_high, CENTER_OB);
    mFL = shiftOctavesToward(mFL, rFL.midi_low, rFL.midi_high, CENTER_FL);

    if (mCL < mBN) mCL = shiftOctavesToward(mCL + 12, rCL.midi_low, rCL.midi_high, CENTER_CL);
    if (mOB < mCL) mOB = shiftOctavesToward(mOB + 12, rOB.midi_low, rOB.midi_high, CENTER_OB);
    if (mFL < mOB) mFL = shiftOctavesToward(mFL + 12, rFL.midi_low, rFL.midi_high, CENTER_FL);

    addNote(shells[0], t, dur, midiToPitch(mFL), 1, "FL", ++seq);
    addNote(shells[1], t, dur, midiToPitch(mOB), 1, "OB", ++seq);
    addNote(shells[2], t, dur, midiToPitch(mCL), 1, "CL", ++seq);
    addNote(shells[3], t, dur, midiToPitch(mBN), 1, "BN", ++seq);
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: partsOut
  } as any;
}

/**
 * Woodwind ensemble mapping (concert pitch view):
 * Flute (C), Oboe (C), Clarinet in Bb (shows concert pitch), Bassoon (C)
 */
export function mapPianoToWoodwindEnsembleOpen(score: ScoreModel, options: WoodwindMapOptions = {}): ScoreModel {
  if (homophonicLevel(options)) {
    return mapBeginnerHomophonic(score, options);
  }
  return mapLegacyOpen(score);
}
