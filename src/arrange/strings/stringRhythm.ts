import type { ScoreModel } from "../../score/types";
import { pitchToMidi, midiToPitch, shiftOctavesIntoRange } from "../../instruments/instrumentCatalog";
import { parseChordSymbol } from "../../harmonize/satb/chordSymbol";

type Activity = "grounded" | "less_active" | "active" | "high_active";

type ApplyOptions = {
  vln1Activity?: Activity;
  vln2Activity?: Activity;
  vlaActivity?: Activity;
  vcActivity?: Activity;
  cbActivity?: Activity;
  chordEvents?: { measure: number; t: number; symbol: string }[];
  keyFifths?: number;
  keyMode?: "major" | "minor";
  syncopate?: boolean;
  warnings?: string[];
  allowNonChordTones?: boolean;
  level?: string;
  minSubdivision?: number;
  minMidi?: number;
  maxMidi?: number;
  preserveVln1Melody?: boolean;
  enforceChordRootBass?: boolean;
  tempoBpm?: number;
};

type NoteEvent = {
  id?: string;
  t: number;
  dur: number;
  type: "note" | "rest";
  pitch?: { step: string; alter?: number; octave: number };
  midi?: number;
  voice?: number;
  staff?: number;
  role?: "chord" | "passing";
};

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function activityRatio(level?: Activity): number {
  switch (level) {
    case "high_active":
      return 1;
    case "active":
      return 0.55;
    case "less_active":
      return 0.3;
    case "grounded":
    default:
      return 0;
  }
}

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function isStrongBeat(t: number): boolean {
  return near(t, Math.round(t));
}

function isChordBoundary(chords: { measure: number; t: number }[], measure: number, t: number): boolean {
  for (const c of chords) {
    if (Number(c.measure) !== Number(measure)) continue;
    if (near(Number(c.t), t)) return true;
  }
  return false;
}

function shouldSubdivide(measureNumber: number, t: number, ratio: number, salt = 0): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1540483477) ^ 0x27d4eb2f;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

function shouldSyncopate(measureNumber: number, t: number, ratio: number, salt = 0): boolean {
  if (ratio <= 0) return false;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 1103515245) ^ (tKey * 214013) ^ (salt * 69069) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  return h / 1000 < Math.min(0.4, ratio);
}

function shouldChooseMeasure(measureNumber: number, ratio: number, salt = 0): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  let h = (measureNumber * 2654435761) ^ (salt * 1597334677);
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

function unitForActivity(dur: number, activity: Activity): number {
  if (activity === "less_active") {
    return dur >= 2 ? 1 : dur;
  }
  if (activity === "active") {
    return dur >= 1 ? 0.5 : dur;
  }
  if (activity === "high_active") {
    if (dur >= 1) return 0.5;
    if (dur >= 0.5) return 0.25;
    return dur;
  }
  return dur;
}

function maybeSyncopateEvent(
  ev: NoteEvent,
  measureNumber: number,
  ratio: number,
  salt: number,
  chordEvents: { measure: number; t: number }[],
  enabled: boolean
): NoteEvent[] {
  if (!enabled || ev.type !== "note" || ev.dur < 0.5) return [ev];
  if (!isStrongBeat(ev.t)) return [ev];
  if (isChordBoundary(chordEvents, measureNumber, ev.t)) return [ev];
  if (!shouldSyncopate(measureNumber, ev.t, ratio, salt)) return [ev];
  const restDur = 0.5;
  if (ev.dur <= restDur) return [ev];
  return [
    { ...ev, type: "rest", pitch: undefined, midi: undefined, dur: restDur },
    { ...ev, t: ev.t + restDur, dur: ev.dur - restDur }
  ];
}

function splitEvent(ev: NoteEvent, unit: number): NoteEvent[] {
  if (!unit || unit <= 0 || unit >= ev.dur) return [ev];
  const out: NoteEvent[] = [];
  let cursor = ev.t;
  let idx = 0;
  const end = ev.t + ev.dur;
  while (cursor + unit <= end + 1e-9) {
    out.push({ ...ev, t: cursor, dur: unit, id: `${ev.id ?? "ev"}-r${idx}` });
    cursor += unit;
    idx += 1;
  }
  const tail = end - cursor;
  if (tail > 1e-6) {
    out.push({ ...ev, t: cursor, dur: tail, id: `${ev.id ?? "ev"}-r${idx}` });
  }
  return out;
}

function normalizeMidi(ev: NoteEvent): NoteEvent {
  if (typeof ev.midi === "number") return ev;
  if (ev.pitch) {
    const midi = pitchToMidi(ev.pitch);
    return { ...ev, midi };
  }
  return ev;
}

function applyToPart(
  part: any,
  activity: Activity,
  warnings: string[],
  salt: number,
  options: {
    chordEvents?: { measure: number; t: number; symbol: string }[];
    keyFifths?: number;
    keyMode?: "major" | "minor";
    syncopate?: boolean;
    allowNonChordTones?: boolean;
    minSubdivision?: number;
    minMidi?: number;
    maxMidi?: number;
    [key: string]: unknown;
  } = {}
): void {
  const ratio = activityRatio(activity);
  if (ratio <= 0) return;

  const chordEvents = options.chordEvents ?? [];
  const keyFifths = typeof options.keyFifths === "number" ? options.keyFifths : 0;
  const keyMode = options.keyMode ?? "major";
  const scale = buildScalePcs(keyFifths, keyMode);
  const allowNonChordTones = options.allowNonChordTones !== false;
  // Auto-apply minimum subdivision based on tempo: fast tempos use longer minimum notes
  const tempoFloor = typeof options.tempoBpm === "number" && options.tempoBpm > 0
    ? options.tempoBpm > 132
      ? 4   // ≥132 bpm: minimum quarter note — no 8ths
      : options.tempoBpm > 96
        ? 2 // 97-132 bpm: minimum 8th note
        : 0
    : 0;
  const minSubdivision = Math.max(
    typeof options.minSubdivision === "number" ? options.minSubdivision : 0,
    tempoFloor
  );
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : null;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : null;
  const clampRange = (m: number | null): number | null => {
    if (m === null || minMidi === null || maxMidi === null) return m;
    return shiftOctavesIntoRange(m, minMidi, maxMidi);
  };

  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const lastMeasureNumber = measures.length ? Number(measures[measures.length - 1]?.number ?? measures.length) : 0;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const events: NoteEvent[] = Array.isArray(m?.events) ? m.events : [];
    const next: NoteEvent[] = [];
    if (mNum === lastMeasureNumber) {
      // Leave last measure rhythm unchanged to match melody cadence.
      m.events = events;
      continue;
    }
    for (const ev of events) {
      if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number") {
        next.push(ev as any);
        continue;
      }
      if (ev.type !== "note") {
        next.push(ev as any);
        continue;
      }
      const unit = unitForActivity(ev.dur, activity);
      const enforcedUnit = minSubdivision > 0 && unit < minSubdivision ? minSubdivision : unit;
      const synced = maybeSyncopateEvent(normalizeMidi(ev), mNum, ratio, salt, chordEvents, options.syncopate === true);
      for (const syncEv of synced) {
        const splitUnit = enforcedUnit;
        if (splitUnit >= syncEv.dur || syncEv.type !== "note") {
          if (syncEv.type === "note") {
            const m0 = typeof syncEv.midi === "number" ? syncEv.midi : syncEv.pitch ? pitchToMidi(syncEv.pitch) : null;
            const m1 = clampRange(m0);
            if (m1 !== null && m1 !== m0) {
              next.push({ ...syncEv, midi: m1, pitch: midiToPitch(m1) });
              continue;
            }
          }
          next.push(syncEv);
          continue;
        }
        const doSplit = shouldSubdivide(mNum, syncEv.t, ratio, salt);
        if (!doSplit) {
          next.push(syncEv);
          continue;
        }
        const split = splitEvent(syncEv, splitUnit);
        const chord = chordAt(chordEvents, mNum, syncEv.t);
        const chordPcs = chord?.pcs ?? [];
        for (const s of split) {
          let midi = typeof s.midi === "number" ? s.midi : s.pitch ? pitchToMidi(s.pitch) : null;
          const onBoundary = isChordBoundary(chordEvents, mNum, s.t) || isStrongBeat(s.t);
          if (midi !== null && !onBoundary && allowNonChordTones) {
            const usePassing = shouldUsePassing(mNum, s.t, salt);
            const useNeighbor = !usePassing && shouldUseNeighbor(mNum, s.t, salt);
            if (usePassing) {
              const dir = passDir(mNum, s.t, salt);
              const pass = passingMidi(midi, dir, scale, chordPcs);
              if (pass !== null) midi = pass;
            } else if (useNeighbor) {
              const dir = passDir(mNum, s.t, salt + 1);
              const neigh = neighborMidi(midi, dir, scale, chordPcs);
              if (neigh !== null) midi = neigh;
            }
          }
          midi = clampRange(midi);
          if (midi !== null) {
            s.midi = midi;
            s.pitch = midiToPitch(midi);
          }
          next.push(s);
        }
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
  warn(warnings, `[strings] Polyphonic rhythm applied to ${part?.name ?? "part"} (activity=${activity}).`);
}

function chordAt(chords: { measure: number; t: number; symbol: string }[], measure: number, t: number) {
  const events = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!events.length) return null;
  let best = events[0];
  for (const c of events) {
    if (Number(c.t) <= t) best = c;
  }
  const parsed = parseChordSymbol(best.symbol);
  const rootPc = parsed?.rootPc ?? null;
  const bassPc = parseSlashBassPc(best.symbol) ?? rootPc;
  return parsed
    ? { ...best, pcs: parsed.pcs ?? [], rootPc, bassPc }
    : { ...best, pcs: [], rootPc: null, bassPc: null };
}

function parseSlashBassPc(symbolRaw: string): number | null {
  const s = String(symbolRaw || "").trim();
  if (!s || !s.includes("/")) return null;
  const slash = s.split("/")[1]?.trim();
  if (!slash) return null;
  const parsed = parseChordSymbol(slash);
  return parsed?.rootPc ?? null;
}

function enforceBassToChordRoot(
  part: any,
  chordEvents: { measure: number; t: number; symbol: string }[],
  options: { strongBeatsOnly?: boolean } = {}
): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  let prevMidi = 40;
  const strongOnly = options.strongBeatsOnly !== false;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const divisions = Number(m?.attributes?.divisions ?? 1);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    const beatUnit = divisions * (4 / beatType);
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note" || typeof ev.t !== "number") {
        next.push(ev as any);
        continue;
      }
      const isStrong = beatUnit > 0 ? Math.abs(ev.t % beatUnit) < 1e-6 : Math.abs(ev.t - Math.round(ev.t)) < 1e-6;
      if (strongOnly && !isStrong) {
        next.push(ev as any);
        continue;
      }
      const chord = chordAt(chordEvents, mNum, ev.t);
      const bassPc = typeof chord?.bassPc === "number" ? chord.bassPc : chord?.rootPc ?? chord?.pcs?.[0];
      if (typeof bassPc !== "number") {
        next.push(ev as any);
        continue;
      }
      const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, bassPc), 28, 60);
      prevMidi = midi;
      next.push({ ...ev, midi, pitch: midiToPitch(midi) });
    }
    m.events = next;
  }
}

function enforceNoBassCelloOverlap(
  cb: any,
  vc: any,
  chordEvents: { measure: number; t: number; symbol: string }[],
  level?: string
): void {
  const cbMeasures = Array.isArray(cb?.measures) ? cb.measures : [];
  const vcMeasures = Array.isArray(vc?.measures) ? vc.measures : [];
  if (!cbMeasures.length || !vcMeasures.length) return;
  const levelRaw = String(level ?? "").toLowerCase();
  const vcMin = 36;
  const vcMax = levelRaw === "beginner" ? 64 : 76;
  const cbByMeasure = new Map<number, Map<number, number>>();
  for (const m of cbMeasures) {
    const map = new Map<number, number>();
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null) continue;
      map.set(Number(ev.t ?? 0), midi);
    }
    cbByMeasure.set(Number(m?.number) || 1, map);
  }

  for (const m of vcMeasures) {
    const mNum = Number(m?.number) || 1;
    const cbMap = cbByMeasure.get(mNum);
    if (!cbMap) continue;
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") {
        next.push(ev as any);
        continue;
      }
      const t = Number(ev.t ?? 0);
      const cbMidi = cbMap.get(t);
      if (typeof cbMidi !== "number") {
        next.push(ev as any);
        continue;
      }
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null || midi !== cbMidi) {
        next.push(ev as any);
        continue;
      }
      const chord = chordAt(chordEvents, mNum, t);
      const chordPcs = chord?.pcs ?? [];
      let nextMidi = midi;
      if (chordPcs.length) {
        nextMidi = pickCandidateNear(midi, chordPcs, vcMin, vcMax, "either", cbMidi, cbMidi % 12);
      } else {
        const up = midi + 12;
        const down = midi - 12;
        if (up <= vcMax) nextMidi = up;
        else if (down >= vcMin) nextMidi = down;
      }
      if (nextMidi === cbMidi) {
        const altUp = nextMidi + 12;
        const altDown = nextMidi - 12;
        if (altUp <= vcMax) nextMidi = altUp;
        else if (altDown >= vcMin) nextMidi = altDown;
      }
      if (nextMidi !== midi) {
        next.push({ ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi) });
      } else {
        next.push(ev as any);
      }
    }
    m.events = next;
  }
}

function enforceNoViolaCelloOverlap(
  vla: any,
  vc: any,
  chordEvents: { measure: number; t: number; symbol: string }[],
  level?: string
): void {
  const vlaMeasures = Array.isArray(vla?.measures) ? vla.measures : [];
  const vcMeasures = Array.isArray(vc?.measures) ? vc.measures : [];
  if (!vlaMeasures.length || !vcMeasures.length) return;
  const levelRaw = String(level ?? "").toLowerCase();
  const vlaMin = 48;
  const vlaMax = levelRaw === "intermediate" ? 81 : 84;
  const vcByMeasure = new Map<number, Map<number, number>>();
  for (const m of vcMeasures) {
    const map = new Map<number, number>();
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null) continue;
      map.set(Number(ev.t ?? 0), midi);
    }
    vcByMeasure.set(Number(m?.number) || 1, map);
  }

  for (const m of vlaMeasures) {
    const mNum = Number(m?.number) || 1;
    const vcMap = vcByMeasure.get(mNum);
    if (!vcMap) continue;
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") {
        next.push(ev as any);
        continue;
      }
      const t = Number(ev.t ?? 0);
      const vcMidi = vcMap.get(t);
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null || typeof vcMidi !== "number" || midi !== vcMidi) {
        next.push(ev as any);
        continue;
      }
      let nextMidi = midi;
      const up = shiftOctavesIntoRange(midi + 12, vlaMin, vlaMax);
      if (up !== vcMidi) nextMidi = up;
      else {
        const down = shiftOctavesIntoRange(midi - 12, vlaMin, vlaMax);
        if (down !== vcMidi) nextMidi = down;
      }
      if (nextMidi !== midi) {
        next.push({ ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi) });
      } else {
        next.push(ev as any);
      }
    }
    m.events = next;
  }
}

function enforceNoVln1Vln2Unison(
  vln1: any,
  vln2: any,
  chordEvents: { measure: number; t: number; symbol: string }[],
  level?: string
): void {
  const v1Measures = Array.isArray(vln1?.measures) ? vln1.measures : [];
  const v2Measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  if (!v1Measures.length || !v2Measures.length) return;
  const levelRaw = String(level ?? "").toLowerCase();
  const minMidi = 55;
  const maxMidi = levelRaw === "beginner" ? 83 : 96;
  const v1ByMeasure = new Map<number, Map<number, number>>();
  for (const m of v1Measures) {
    const map = new Map<number, number>();
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null) continue;
      map.set(Number(ev.t ?? 0), midi);
    }
    v1ByMeasure.set(Number(m?.number) || 1, map);
  }

  for (const m of v2Measures) {
    const mNum = Number(m?.number) || 1;
    const v1Map = v1ByMeasure.get(mNum);
    if (!v1Map) continue;
    const next: NoteEvent[] = [];
    let prevMidi: number | null = null;
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") {
        next.push(ev as any);
        continue;
      }
      const t = Number(ev.t ?? 0);
      const v1Midi = v1Map.get(t);
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null || typeof v1Midi !== "number" || midi !== v1Midi) {
        next.push(ev as any);
        prevMidi = typeof midi === "number" ? midi : prevMidi;
        continue;
      }
      const chord = chordAt(chordEvents, mNum, t);
      const chordPcs = chord?.pcs ?? [];
      let nextMidi = midi;
      const seed = typeof prevMidi === "number" ? prevMidi : midi;
      if (chordPcs.length) {
        nextMidi = pickCandidateNear(seed, chordPcs, minMidi, maxMidi, "either", v1Midi, v1Midi % 12);
      } else {
        const up = midi + 12;
        const down = midi - 12;
        if (up <= maxMidi) nextMidi = up;
        else if (down >= minMidi) nextMidi = down;
      }
      if (nextMidi === v1Midi) {
        const altUp = nextMidi + 12;
        const altDown = nextMidi - 12;
        if (altUp <= maxMidi) nextMidi = altUp;
        else if (altDown >= minMidi) nextMidi = altDown;
      }
      next.push({ ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi) });
      prevMidi = nextMidi;
    }
    m.events = next;
  }
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number") return ev.midi;
  if (ev?.pitch) return pitchToMidi(ev.pitch);
  return null;
}

function activeMidiAt(events: any[], t: number): number | null {
  let bestStart = -Infinity;
  let bestMidi: number | null = null;
  for (const ev of events ?? []) {
    if (ev?.type !== "note") continue;
    const start = Number(ev.t ?? 0);
    const dur = Number(ev.dur ?? 0);
    if (!(dur > 0)) continue;
    if (start - 1e-6 <= t && t < start + dur - 1e-6) {
      const midi = eventMidi(ev);
      if (midi === null) continue;
      if (start >= bestStart) {
        bestStart = start;
        bestMidi = midi;
      }
    }
  }
  return bestMidi;
}

function minUpperDuringWindow(upperEvents: any[], start: number, end: number): number | null {
  const sampleTimes: number[] = [start];
  for (const ev of upperEvents ?? []) {
    if (ev?.type !== "note") continue;
    const t = Number(ev.t ?? 0);
    if (t > start + 1e-6 && t < end - 1e-6) sampleTimes.push(t);
  }
  let minMidi: number | null = null;
  for (const t of sampleTimes) {
    const midi = activeMidiAt(upperEvents, t);
    if (midi === null) continue;
    if (minMidi === null || midi < minMidi) minMidi = midi;
  }
  return minMidi;
}

function pickBelowLimit(
  prevMidi: number,
  upperLimit: number,
  pcs: number[],
  minMidi: number,
  maxMidi: number
): number {
  const cappedMax = Math.min(maxMidi, upperLimit);
  if (pcs.length) {
    const lowOct = Math.floor(minMidi / 12) - 1;
    const highOct = Math.floor(cappedMax / 12) + 1;
    const candidates: number[] = [];
    for (const pc of pcs) {
      for (let oct = lowOct; oct <= highOct; oct++) {
        const midi = pc + oct * 12;
        if (midi >= minMidi && midi <= cappedMax) candidates.push(midi);
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => Math.abs(a - prevMidi) - Math.abs(b - prevMidi));
      return candidates[0]!;
    }
  }
  let next = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
  while (next > upperLimit && next - 12 >= minMidi) next -= 12;
  if (next > upperLimit) next = Math.min(cappedMax, Math.max(minMidi, upperLimit));
  return shiftOctavesIntoRange(next, minMidi, maxMidi);
}

function enforceNoCrossingPair(
  upper: any,
  lower: any,
  chordEvents: { measure: number; t: number; symbol: string }[],
  lowerRange: { min: number; max: number }
): void {
  const upperMeasures = Array.isArray(upper?.measures) ? upper.measures : [];
  const lowerMeasures = Array.isArray(lower?.measures) ? lower.measures : [];
  if (!upperMeasures.length || !lowerMeasures.length) return;
  const upperByMeasure = new Map<number, any>();
  for (const m of upperMeasures) upperByMeasure.set(Number(m?.number) || 1, m);

  for (const m of lowerMeasures) {
    const mNum = Number(m?.number) || 1;
    const upperMeasure = upperByMeasure.get(mNum);
    if (!upperMeasure) continue;
    const upperEvents = Array.isArray(upperMeasure?.events) ? upperMeasure.events : [];
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") {
        next.push(ev as any);
        continue;
      }
      const start = Number(ev.t ?? 0);
      const dur = Number(ev.dur ?? 0);
      const end = start + Math.max(0, dur);
      const midi = eventMidi(ev);
      if (midi === null || !(dur > 0)) {
        next.push(ev as any);
        continue;
      }
      const upperMin = minUpperDuringWindow(upperEvents, start, end);
      if (upperMin === null || midi <= upperMin) {
        next.push(ev as any);
        continue;
      }
      const chord = chordAt(chordEvents, mNum, start);
      const pcs = chord?.pcs ?? [];
      const fixed = pickBelowLimit(midi, upperMin, pcs, lowerRange.min, lowerRange.max);
      next.push({ ...ev, midi: fixed, pitch: midiToPitch(fixed) });
    }
    m.events = next;
  }
}

function enforceViolin2ChordToneGapFill(
  vln2: any,
  refs: { vln1?: any; vla?: any; vc?: any; cb?: any },
  chordEvents: { measure: number; t: number; symbol: string }[],
  range: { min: number; max: number }
): void {
  const v2Measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  if (!v2Measures.length) return;
  const byMeasure = (part: any): Map<number, any> => {
    const map = new Map<number, any>();
    for (const m of part?.measures ?? []) map.set(Number(m?.number) || 1, m);
    return map;
  };
  const v1By = byMeasure(refs.vln1);
  const vaBy = byMeasure(refs.vla);
  const vcBy = byMeasure(refs.vc);
  const cbBy = byMeasure(refs.cb);
  for (const m of v2Measures) {
    const mNum = Number(m?.number) || 1;
    const v1m = v1By.get(mNum);
    const vam = vaBy.get(mNum);
    const vcm = vcBy.get(mNum);
    const cbm = cbBy.get(mNum);
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note" || typeof ev.t !== "number") {
        next.push(ev as any);
        continue;
      }
      const currMidi = eventMidi(ev);
      if (currMidi === null) {
        next.push(ev as any);
        continue;
      }
      const chord = chordAt(chordEvents, mNum, ev.t);
      const thirdPc = chordThirdPc(chord);
      const fifthPc = chordFifthPc(chord);
      const tonePcs = [thirdPc, fifthPc].filter((pc): pc is number => typeof pc === "number");
      if (!tonePcs.length) {
        next.push(ev as any);
        continue;
      }
      const presentPcs = new Set<number>();
      for (const meas of [v1m, vam, vcm, cbm]) {
        const midi = activeMidiAt(meas?.events ?? [], ev.t);
        if (typeof midi === "number") presentPcs.add(((midi % 12) + 12) % 12);
      }
      const currPc = ((currMidi % 12) + 12) % 12;
      let targetPc: number | null = null;
      if (typeof thirdPc === "number" && !presentPcs.has(thirdPc)) targetPc = thirdPc;
      else if (typeof fifthPc === "number" && !presentPcs.has(fifthPc)) targetPc = fifthPc;
      else if (tonePcs.includes(currPc)) targetPc = currPc;

      let lo = range.min;
      let hi = range.max;
      const belowV1 = activeMidiAt(v1m?.events ?? [], ev.t);
      const aboveVla = activeMidiAt(vam?.events ?? [], ev.t);
      if (typeof belowV1 === "number") hi = Math.min(hi, belowV1);
      if (typeof aboveVla === "number") lo = Math.max(lo, aboveVla);
      if (lo > hi) {
        lo = range.min;
        hi = range.max;
      }

      const pcs = targetPc === null ? tonePcs : [targetPc];
      const midi = pickCandidateNear(currMidi, pcs, lo, hi, "either");
      next.push({ ...ev, midi, pitch: midiToPitch(midi) });
    }
    m.events = next;
  }
}

function alignEndingRhythmToMelody(
  melodyPart: any,
  targets: Array<{ part: any; range: { min: number; max: number } }>,
  chordEvents: { measure: number; t: number; symbol: string }[]
): void {
  if (!melodyPart) return;
  const measures = Array.isArray(melodyPart?.measures) ? melodyPart.measures : [];
  if (!measures.length) return;
  const lastMeasure = measures[measures.length - 1];
  if (!lastMeasure) return;
  const mNum = Number(lastMeasure.number) || measures.length;
  const melodyEvents: NoteEvent[] = (lastMeasure.events ?? [])
    .filter((ev: any) => ev && typeof ev.t === "number" && typeof ev.dur === "number")
    .map((ev: any) => ({ ...ev }));
  if (!melodyEvents.length) return;

  for (const target of targets) {
    const part = target.part;
    if (!part) continue;
    const measure = (part.measures ?? []).find((m: any) => Number(m?.number) === mNum);
    if (!measure) continue;
    const next: NoteEvent[] = [];
    let prevMidi =
      (measure.events ?? []).find((e: any) => e?.type === "note" && typeof e.midi === "number")?.midi ?? null;
    if (typeof prevMidi !== "number" && measure.events?.length) {
      const firstPitch = (measure.events ?? []).find((e: any) => e?.type === "note" && e?.pitch)?.pitch;
      if (firstPitch) prevMidi = pitchToMidi(firstPitch);
    }
    for (const ev of melodyEvents) {
      if (ev.type === "rest") {
        next.push({ ...ev, voice: 1, staff: 1 });
        continue;
      }
      const chord = chordAt(chordEvents, mNum, ev.t);
      const chordPcs = chord?.pcs ?? [];
      let midi = typeof prevMidi === "number" ? prevMidi : 60;
      if (chordPcs.length) {
        midi = pickCandidateNear(midi, chordPcs, target.range.min, target.range.max, "either");
      } else {
        midi = shiftOctavesIntoRange(midi, target.range.min, target.range.max);
      }
      prevMidi = midi;
      next.push({
        id: ev.id ? `${ev.id}-rhythm` : undefined,
        t: ev.t,
        dur: ev.dur,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
    }
    measure.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function buildScalePcs(fifths: number, mode: "major" | "minor"): number[] {
  const major = [0, 2, 4, 5, 7, 9, 11];
  const minor = [0, 2, 3, 5, 7, 8, 10];
  const root = ((fifths * 7) % 12 + 12) % 12;
  const base = mode === "minor" ? minor : major;
  return base.map((pc) => (root + pc) % 12);
}

function shouldUsePassing(measureNumber: number, t: number, salt = 0): boolean {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 912367) ^ (tKey * 12289) ^ (salt * 131) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  return h / 1000 < 0.35;
}

function shouldUseNeighbor(measureNumber: number, t: number, salt = 0): boolean {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 812263) ^ (tKey * 9176) ^ (salt * 97) ^ 0x7f4a7c15;
  h = (h >>> 0) % 1000;
  return h / 1000 < 0.25;
}

function passDir(measureNumber: number, t: number, salt = 0): 1 | -1 {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 92821) ^ (tKey * 193) ^ (salt * 73);
  h = (h >>> 0) % 1000;
  return h % 2 === 0 ? 1 : -1;
}

function passingMidi(midi: number, dir: 1 | -1, scalePcs: number[], chordPcs: number[]): number | null {
  const target = midi + dir;
  const pc = ((target % 12) + 12) % 12;
  if (scalePcs.includes(pc) && !chordPcs.includes(pc)) return target;
  return null;
}

function neighborMidi(midi: number, dir: 1 | -1, scalePcs: number[], chordPcs: number[]): number | null {
  const target = midi + dir;
  const pc = ((target % 12) + 12) % 12;
  if (scalePcs.includes(pc) && !chordPcs.includes(pc)) return target;
  return null;
}

function pickChordToneSequence(chord: { pcs?: number[]; rootPc?: number }, length = 4): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const majorThird = (root + 4) % 12;
  const minorThird = (root + 3) % 12;
  let third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
  if (third === null) {
    third = pcs.find((pc) => pc !== root && pc !== fifth) ?? root;
  }
  const base = [root, fifth, third, fifth];
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(base[i % base.length]);
  return out;
}

function chordThirdPc(chord: { pcs?: number[]; rootPc?: number } | null | undefined): number | null {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return null;
  const root = typeof chord?.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const majThird = (root + 4) % 12;
  const minThird = (root + 3) % 12;
  if (pcs.includes(majThird)) return majThird;
  if (pcs.includes(minThird)) return minThird;
  const fifth = (root + 7) % 12;
  return pcs.find((pc) => pc !== root && pc !== fifth) ?? pcs[0]!;
}

function chordFifthPc(chord: { pcs?: number[]; rootPc?: number } | null | undefined): number | null {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return null;
  const root = typeof chord?.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  if (pcs.includes(fifth)) return fifth;
  return pcs.find((pc) => pc !== root) ?? pcs[0]!;
}

function applyViolin2BeginnerHighActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let t = 0;
    let prevMidi = 67;
    while (t < mLen - 1e-6) {
      const chord = chordAt(chordEvents, mNum, t);
      const thirdPc = chordThirdPc(chord);
      const pcs = thirdPc !== null ? [thirdPc] : chord?.pcs ?? [];
      let midi = prevMidi;
      if (pcs.length) {
        midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
      } else {
        midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
      }
      next.push({
        id: `vln2-hi-${mNum}-${t}`,
        t,
        dur: Math.min(0.5, mLen - t),
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
      t += 0.5;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2IntermediateActivePattern(vln2: any, options: ApplyOptions): void {
  const measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 88;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = minMidi + 7;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 2) {
      // Pattern: 8th rest, 8th, 8th, 8th (over two beats)
      next.push({ id: `vln2-int60-rest-${mNum}-${t}`, t, dur: 0.5, type: "rest", voice: 1, staff: 1 });
      const slots = [t + 0.5, t + 1.0, t + 1.5];
      for (const s of slots) {
        if (s >= mLen - 1e-6) continue;
        const chord = chordAt(chordEvents, mNum, s);
        const thirdPc = chordThirdPc(chord);
        const pcs = thirdPc !== null ? [thirdPc] : chord?.pcs ?? [];
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vln2-int60-${mNum}-${s}`,
          t: s,
          dur: 0.5,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2IntermediateHighActivePattern(vln2: any, options: ApplyOptions): void {
  const measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 88;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = minMidi + 9;
  const baseOrder: Array<"dot8_16" | "four16" | "dotq_8"> = ["dot8_16", "four16", "dotq_8"];
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let t = 0;
    const preferDir: "up" | "down" = passDir(mNum, 0, 101) > 0 ? "up" : "down";
    const order = [...baseOrder];
    // True random per-measure shuffle for rhythm-cell ordering.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let cellIdx = 0;
    while (t < mLen - 1e-6) {
      const cell = order[cellIdx % order.length]!;
      if (cell === "dot8_16") {
        // Cell: dotted 8th + 16th (1 beat)
        const chord = chordAt(chordEvents, mNum, t);
        const pcs = chord?.pcs ?? [];
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vln2-int100-dot8-${mNum}-${t}`,
          t,
          dur: Math.min(0.75, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        const t2 = t + 0.75;
        if (t2 < mLen - 1e-6) {
          const chord2 = chordAt(chordEvents, mNum, t2);
          const pcs2 = chord2?.pcs ?? pcs ?? [];
          let midi2 = prevMidi;
          if (pcs2.length) {
            midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi);
            if (preferDir === "up" && midi2 <= prevMidi && midi2 + 12 <= maxMidi) midi2 += 12;
            if (preferDir === "down" && midi2 >= prevMidi && midi2 - 12 >= minMidi) midi2 -= 12;
          } else {
            midi2 = shiftOctavesIntoRange(prevMidi + 1, minMidi, maxMidi);
          }
          next.push({
            id: `vln2-int100-16-${mNum}-${t2}`,
            t: t2,
            dur: Math.min(0.25, mLen - t2),
            type: "note",
            midi: midi2,
            pitch: midiToPitch(midi2),
            voice: 1,
            staff: 1
          });
          prevMidi = midi2;
        }
        t += 1;
      } else if (cell === "four16") {
        // Cell: four 16ths, preferred directional motion (1 beat)
        const slots = [t, t + 0.25, t + 0.5, t + 0.75];
        for (const s of slots) {
          if (s >= mLen - 1e-6) continue;
          const chord = chordAt(chordEvents, mNum, s);
          const pcs = chord?.pcs ?? [];
          let midi = prevMidi;
          if (pcs.length) {
            midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, prevMidi);
            if (preferDir === "up" && midi <= prevMidi && midi + 12 <= maxMidi) midi += 12;
            if (preferDir === "down" && midi >= prevMidi && midi - 12 >= minMidi) midi -= 12;
          } else {
            midi = shiftOctavesIntoRange(prevMidi + 1, minMidi, maxMidi);
          }
          next.push({
            id: `vln2-int100-16a-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.25, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
        }
        t += 1;
      } else {
        // Cell: dotted quarter + 8th (2 beats)
        const chord = chordAt(chordEvents, mNum, t);
        const pcs = chord?.pcs ?? [];
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vln2-int100-dotq-${mNum}-${t}`,
          t,
          dur: Math.min(1.5, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        const t2 = t + 1.5;
        if (t2 < mLen - 1e-6) {
          const chord2 = chordAt(chordEvents, mNum, t2);
          const pcs2 = chord2?.pcs ?? pcs ?? [];
          let midi2 = prevMidi;
          if (pcs2.length) {
            const excludePc = ((prevMidi % 12) + 12) % 12;
            midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi, excludePc);
          } else {
            midi2 = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vln2-int100-8-${mNum}-${t2}`,
            t: t2,
            dur: Math.min(0.5, mLen - t2),
            type: "note",
            midi: midi2,
            pitch: midiToPitch(midi2),
            voice: 1,
            staff: 1
          });
          prevMidi = midi2;
        }
        t += 2;
      }
      if (t >= mLen - 1e-6) break;
      cellIdx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaIntermediateActivePattern(vla: any, options: ApplyOptions): void {
  const measures = Array.isArray(vla?.measures) ? vla.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 81;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = minMidi + 12;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 2) {
      next.push({ id: `vla-int60-rest-${mNum}-${t}`, t, dur: 0.5, type: "rest", voice: 1, staff: 1 });
      const slots = [t + 0.5, t + 1.0, t + 1.5];
      for (const s of slots) {
        if (s >= mLen - 1e-6) continue;
        const chord = chordAt(chordEvents, mNum, s);
        const fifthPc = chordFifthPc(chord);
        const pcs = fifthPc !== null ? [fifthPc] : chord?.pcs ?? [];
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vla-int60-${mNum}-${s}`,
          t: s,
          dur: 0.5,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

export function applyStringPolyphonicRhythm(
  scoreModel: ScoreModel,
  options: ApplyOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings: string[] = options.warnings ?? [];
  const parts = Array.isArray(scoreModel?.parts) ? scoreModel.parts : [];

  const vln1 = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("violin i"));
  const vln2 = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("violin ii"));
  const vla = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("viola"));
  const vc = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("cello"));
  const cb = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("double bass"));
  const level = String(options.level ?? "").toLowerCase();

  if (vln1 && !options.preserveVln1Melody) {
    applyToPart(vln1, options.vln1Activity ?? "grounded", warnings, 7, {
      ...options,
      syncopate: false,
      allowNonChordTones: false
    });
  }
  if (vln2) {
    const vln2Range =
      level === "beginner"
        ? { minMidi: 55, maxMidi: 83 }
        : level === "intermediate"
          ? { minMidi: 55, maxMidi: 88 }
          : {};
    if (level === "beginner" && options.vln2Activity === "high_active") {
      // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
      applyViolin2BeginnerHighActive(vln2, { ...options, ...vln2Range });
      warn(warnings, "[strings] Beginner Violin II: 8th+16th on chord 3rd (activity=high_active).");
    } else if (level === "beginner" && options.vln2Activity === "active") {
      // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
      if (vln1) {
        applyViolin2BeginnerContraryToMelody(vln1, vln2, { ...options, ...vln2Range });
        warn(warnings, "[strings] Beginner Violin II: melody rhythm, contrary motion, 3rd/5th.");
      } else {
        applyViolin2BeginnerActive(vln2, { ...options, ...vln2Range });
        warn(warnings, "[strings] Beginner Violin II: 8th notes on 3rd/5th chord tones.");
      }
    } else if (level === "intermediate" && options.vln2Activity === "high_active") {
      applyViolin2IntermediateHighActivePattern(vln2, { ...options, ...vln2Range });
      warn(
        warnings,
        "[strings] Intermediate Violin II: dotted 8th+16th, four 16ths ascending, dotted quarter+8th."
      );
    } else if (level === "intermediate" && options.vln2Activity === "active") {
      // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
      applyViolin2IntermediateActivePattern(vln2, { ...options, ...vln2Range });
      warn(warnings, "[strings] Intermediate Violin II: 8th-rest+8th+8th+8th on chord 3rd.");
    } else if (level === "intermediate" && options.vln2Activity === "less_active" && vc) {
      // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
      applyViolin2IntermediateLessActiveContrary(vln2, vc, { ...options, ...vln2Range });
      warn(warnings, "[strings] Intermediate Violin II: 40% 8ths, 50% quarters, 10% halves on 3rd/5th, contrary to cello.");
    } else if (level === "advanced" && options.vln2Activity === "high_active") {
      // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
      applyViolin2AdvancedHighActive(vln2, cb, { ...options, minMidi: 55, maxMidi: 96 });
      warn(
        warnings,
        "[strings] Advanced Violin II (100%): shuffled 4x16/2x8/dotted-quarter+8th, contrary to double bass."
      );
    } else if (level === "advanced" && options.vln2Activity === "active") {
      // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
      applyViolin2AdvancedActive(vln2, vc, { ...options, minMidi: 55, maxMidi: 96 });
      warn(
        warnings,
        "[strings] Advanced Violin II (60%): shuffled cells, contrary to cello, harmonic-color tones."
      );
    } else if (level === "advanced" && options.vln2Activity === "less_active") {
      // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
      applyViolin2AdvancedLessActive(vln2, { ...options, minMidi: 55, maxMidi: 96 });
      warn(warnings, "[strings] Advanced Violin II (40%): 8ths on chord 3rd/5th.");
    } else {
      applyToPart(vln2, options.vln2Activity ?? "active", warnings, 11, { ...options, ...vln2Range });
    }
  }
  const beginnerContrary =
    level === "beginner" && options.vlaActivity === "less_active" && options.vcActivity === "less_active";
  if (beginnerContrary && vla && vc) {
    // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
    applyBeginnerContraryMotion(vla, vc, options);
    warn(warnings, "[strings] Beginner contrary motion applied (viola+cello, quarter/half only).");
  } else {
    if (vla) {
      const vlaMinSubdivision =
        options.vlaActivity === "high_active"
          ? level === "beginner"
            ? 1
            : level === "intermediate"
              ? 0.5
              : undefined
          : undefined;
      const vlaRange =
        level === "beginner"
          ? { minMidi: 48, maxMidi: 76 }
          : level === "intermediate"
            ? { minMidi: 48, maxMidi: 81 }
            : {};
      if (level === "intermediate" && options.vlaActivity === "high_active") {
        applyViolaIntermediateHighActivePattern(vla, { ...options, ...vlaRange });
        warn(
          warnings,
          "[strings] Intermediate viola (100%): shuffled cells from Violin II + Cello vocabulary."
        );
      } else if (level === "advanced" && options.vlaActivity === "high_active") {
        // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
        applyViolaAdvancedHighActiveTriplets(vla, { ...options, minMidi: 48, maxMidi: 84 });
        warn(warnings, "[strings] Advanced Viola (100%): triplet rhythm on chord 3rd applied.");
      } else if (level === "intermediate" && options.vlaActivity === "active") {
        // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
        applyViolaIntermediateActivePattern(vla, { ...options, ...vlaRange });
        warn(warnings, "[strings] Intermediate Viola: 8th-rest+8th+8th+8th on chord 5th.");
      } else if (level === "intermediate" && options.vlaActivity === "less_active" && vc) {
        // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
        applyViolaIntermediateAgainstCello(vla, vc, { ...options, ...vlaRange });
        warn(warnings, "[strings] Intermediate viola: Alberti 8ths vs cello quarters, arpeggio vs cello halves.");
      } else if (level === "advanced" && options.vlaActivity === "active") {
        // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
        applyViolaAdvancedActive(vla, { vln1, vln2, vc, cb }, { ...options, minMidi: 48, maxMidi: 84 });
        warn(warnings, "[strings] Advanced Viola (60%): 8ths, gap-fill on weak harmony, root when complete.");
      } else if (level === "advanced" && options.vlaActivity === "less_active" && vln2) {
        // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
        applyViolaAdvancedLessActive(vla, vln2, { ...options, minMidi: 48, maxMidi: 84 });
        warn(warnings, "[strings] Advanced Viola (40%): 8ths on chord 1st/5th to complete harmony.");
      } else {
        applyToPart(vla, options.vlaActivity ?? "active", warnings, 23, {
          ...options,
          minSubdivision: vlaMinSubdivision,
          ...vlaRange
        });
      }
      if (options.vlaActivity === "high_active") {
        if (level !== "intermediate" && level !== "advanced") {
          applyViolaArpeggio(vla, { ...options, ...vlaRange });
          warn(warnings, "[strings] Viola arpeggio applied (activity=high_active).");
        }
      }
      if (level === "beginner" && options.vlaActivity === "active") {
        // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
        applyViolaBeginnerActive(vla, options);
        warn(warnings, "[strings] Beginner viola: 60% Alberti (8ths), 40% quarter arpeggio.");
      }
    }
    if (vc) {
      const vcRange =
        level === "beginner"
          ? { minMidi: 36, maxMidi: 64 }
          : level === "intermediate"
            ? { minMidi: 36, maxMidi: 69 }
            : {};
      if (level === "intermediate" && options.vcActivity === "high_active") {
        applyCelloIntermediateHighActivePattern(vc, { ...options, ...vcRange });
        warn(
          warnings,
          "[strings] Intermediate cello (100%): quarter, two 8ths, Alberti 16ths, dotted 8th+16th."
        );
      } else if (level === "advanced" && options.vcActivity === "high_active") {
        // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
        applyCelloAdvancedHighActiveSyncopes(vc, { ...options, minMidi: 36, maxMidi: 76 });
        warn(warnings, "[strings] Advanced cello (100%): syncopation on chord 1st/3rd/5th.");
      } else if (level === "intermediate" && options.vcActivity === "active") {
        // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
        applyCelloIntermediateActive(vc, { ...options, ...vcRange });
        warn(
          warnings,
          "[strings] Intermediate cello: 40% Alberti 8ths, 20% quarters, 30% syncopation, 10% neighbor tones."
        );
      } else if (level === "intermediate" && options.vcActivity === "less_active") {
        // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
        applyCelloIntermediateLessActive(vc, { ...options, ...vcRange });
        warn(warnings, "[strings] Intermediate cello: 40% half notes on 3rd, 60% quarter arpeggios.");
      } else if (level === "advanced" && options.vcActivity === "active") {
        // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
        applyCelloAdvancedActivePattern(vc, { ...options, minMidi: 36, maxMidi: 76 });
        warn(warnings, "[strings] Advanced cello (60%): dotted 8th+16th arpeggio cell applied.");
      } else if (level === "advanced" && options.vcActivity === "less_active") {
        // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
        applyCelloAlberti(vc, { ...options, minMidi: 36, maxMidi: 76 });
        warn(warnings, "[strings] Advanced cello (40%): Alberti bass applied.");
      } else if (level === "beginner" && options.vcActivity === "active" && vln1) {
        // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
        applyCelloMelodyRhythmContrary(vln1, vc, { ...options, ...vcRange });
        warn(warnings, "[strings] Beginner cello follows melody rhythm with contrary motion.");
      } else {
        applyToPart(vc, options.vcActivity ?? "less_active", warnings, 37, { ...options, ...vcRange });
        if (level === "beginner" && options.vcActivity === "high_active") {
          // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
          applyCelloAlberti(vc, { ...options, ...vcRange });
          warn(warnings, "[strings] Cello Alberti applied (beginner, activity=high_active).");
        }
      }
    }
  }
  if (cb) {
    if (level === "intermediate" && options.cbActivity === "high_active") {
      applyDoubleBassIntermediateHighActive(cb, options);
      warn(warnings, "[strings] Intermediate Double Bass (100%): 8th notes on chord bass.");
    } else if (level === "advanced" && options.cbActivity === "high_active") {
      // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
      applyDoubleBassAdvancedHighActive(cb, options);
      warn(warnings, "[strings] Advanced Double Bass (100%): 8th+16th+16th rhythm cell.");
    } else if (level === "advanced" && options.cbActivity === "active") {
      // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
      applyDoubleBassIntermediateHighActive(cb, options);
      warn(warnings, "[strings] Advanced Double Bass (60%): 8th notes on chord bass.");
    } else {
      applyToPart(cb, options.cbActivity ?? "less_active", warnings, 51, options);
    }
  }
  if (String(options.level ?? "").toLowerCase() === "intermediate" && options.cbActivity === "less_active") {
    // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
  }

  const beginnerCbSync =
    level === "beginner" &&
    options.vcActivity === "less_active" &&
    options.cbActivity === "less_active" &&
    cb &&
    vc;
  if (beginnerCbSync) {
    // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
    let prevCbMidi = 40;
    const cbMin = 28;
    const cbMax = 60;
    for (const m of vc.measures ?? []) {
      const cbMeasure = (cb.measures ?? []).find((mm: any) => Number(mm?.number) === Number(m?.number));
      if (!cbMeasure) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cbMeasure as any).events = (m.events ?? []).map((ev: NoteEvent) => {
        if (ev.type !== "note") return { ...ev };
        const chord = chordAt(options.chordEvents ?? [], Number(m?.number) || 1, ev.t);
        const bassPc = typeof chord?.bassPc === "number" ? chord.bassPc : chord?.rootPc ?? chord?.pcs?.[0];
        if (typeof bassPc !== "number") {
          const midi = shiftOctavesIntoRange(prevCbMidi, cbMin, cbMax);
          return { ...ev, midi, pitch: midiToPitch(midi), voice: 1, staff: 1 };
        }
        const midi = shiftOctavesIntoRange(snapToPcNear(prevCbMidi, bassPc), cbMin, cbMax);
        prevCbMidi = midi;
        return { ...ev, midi, pitch: midiToPitch(midi), voice: 1, staff: 1 };
      });
    }
    warn(warnings, "[strings] Beginner: Double Bass rhythm synced to Cello; pitches follow chord bass.");
  }
  if (vln1 && (vln2 || vla || vc || cb)) {
    const levelRaw = String(options.level ?? "").toLowerCase();
    const vcRange = { min: 36, max: levelRaw === "beginner" ? 64 : 76 };
    alignEndingRhythmToMelody(
      vln1,
      [
        vln2 ? { part: vln2, range: { min: 55, max: 96 } } : null,
        vla ? { part: vla, range: { min: 48, max: levelRaw === "beginner" ? 76 : 84 } } : null,
        vc ? { part: vc, range: vcRange } : null,
        cb ? { part: cb, range: { min: 28, max: 60 } } : null
      ].filter(Boolean) as Array<{ part: any; range: { min: number; max: number } }>,
      options.chordEvents ?? []
    );
    warn(warnings, "[strings] Final measure rhythm aligned to melody for Vln II/Vla/Vc/Cb.");
  }
  if (cb && options.enforceChordRootBass) {
    enforceBassToChordRoot(cb, options.chordEvents ?? [], { strongBeatsOnly: false });
    warn(warnings, "[strings] Double Bass locked to chord roots on all beats.");
  }
  if (cb && vc) {
    enforceNoBassCelloOverlap(cb, vc, options.chordEvents ?? [], options.level);
    warn(warnings, "[strings] Cello adjusted to avoid overlap with Double Bass.");
  }
  if (vla && vc && String(options.level ?? "").toLowerCase() === "intermediate") {
    enforceNoViolaCelloOverlap(vla, vc, options.chordEvents ?? [], options.level);
    warn(warnings, "[strings] Intermediate: Viola adjusted to avoid overlap with Cello.");
  }
  if (vln1 && vln2 && String(options.level ?? "").toLowerCase() === "beginner") {
    enforceNoVln1Vln2Unison(vln1, vln2, options.chordEvents ?? [], options.level);
    warn(warnings, "[strings] Beginner: Violin II adjusted to avoid unison with Violin I.");
  }
  const levelRaw = String(options.level ?? "").toLowerCase();
  if (
    levelRaw === "advanced" &&
    (options.vln2Activity === "less_active" || options.vln2Activity === "active" || options.vln2Activity === "high_active") &&
    vln2
  ) {
    // LOCKED/ENFORCED: String/Advanced/Polyphonic Violin II harmony gap fill (40%, 60%, 100% active).
    enforceViolin2ChordToneGapFill(
      vln2,
      { vln1, vla, vc, cb },
      options.chordEvents ?? [],
      { min: 55, max: 96 }
    );
    warn(warnings, "[strings] Advanced Violin II: gap-fill on missing chord 3rd/5th.");
  }
  const v2Max = levelRaw === "beginner" ? 83 : levelRaw === "intermediate" ? 88 : 96;
  const vlaMax = levelRaw === "beginner" ? 76 : levelRaw === "intermediate" ? 81 : 84;
  const vcMaxStrict = levelRaw === "beginner" ? 64 : levelRaw === "intermediate" ? 69 : 76;
  if (vln1 && vln2) {
    enforceNoCrossingPair(vln1, vln2, options.chordEvents ?? [], { min: 55, max: v2Max });
    warn(warnings, "[strings] Enforced no crossing (Violin I above Violin II).");
  }
  if (vln2 && vla) {
    enforceNoCrossingPair(vln2, vla, options.chordEvents ?? [], { min: 48, max: vlaMax });
    warn(warnings, "[strings] Enforced no crossing (Violin II above Viola).");
  }
  if (vla && vc) {
    enforceNoCrossingPair(vla, vc, options.chordEvents ?? [], { min: 36, max: vcMaxStrict });
    warn(warnings, "[strings] Enforced no crossing (Viola above Cello).");
  }
  if (vc && cb) {
    enforceNoCrossingPair(vc, cb, options.chordEvents ?? [], { min: 28, max: 60 });
    warn(warnings, "[strings] Enforced no crossing (Cello above Double Bass).");
  }

  return { scoreModel, warnings };
}

function applyViolaArpeggio(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const level = String(options.level ?? "").toLowerCase();
  const restrictToEighths = level === "intermediate";
  const restrictToQuarters = level === "beginner";
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : null;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : null;
  const clampRange = (m: number): number => {
    if (minMidi === null || maxMidi === null) return m;
    return shiftOctavesIntoRange(m, minMidi, maxMidi);
  };
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const events: NoteEvent[] = Array.isArray(m?.events) ? m.events : [];
    const next: NoteEvent[] = [];
    let arpIndex = 0;
    const descending = mNum % 2 === 0;
    if (restrictToQuarters) {
      const mLen = measureLen(m);
      let baseMidi =
        events.find((e) => e?.type === "note" && typeof e.midi === "number")?.midi ??
        events.find((e) => e?.type === "note" && e?.pitch)
          ? pitchToMidi((events.find((e) => e?.type === "note" && e?.pitch) as any).pitch)
          : 60;
      for (let t = 0; t < mLen - 1e-6; t += 1) {
        const chord = chordAt(chordEvents, mNum, t);
        const chordPcs = chord?.pcs ?? [];
        if (!chordPcs.length || typeof baseMidi !== "number") continue;
        const idx = arpIndex % chordPcs.length;
        const pc = descending ? chordPcs[chordPcs.length - 1 - idx]! : chordPcs[idx]!;
        const midi = clampRange(snapToPcNear(baseMidi, pc));
        next.push({
          id: `vla-arp-${mNum}-${t}`,
          t,
          dur: 1,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        baseMidi = midi;
        arpIndex += 1;
      }
      m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
      continue;
    }
    for (const ev of events) {
      if (!ev || ev.type !== "note" || typeof ev.t !== "number" || typeof ev.dur !== "number") {
        next.push(ev as any);
        continue;
      }
      const chord = chordAt(chordEvents, mNum, ev.t);
      const chordPcs = chord?.pcs ?? [];
      if (!chordPcs.length || typeof ev.midi !== "number") {
        next.push(ev as any);
        continue;
      }
      const unitFloor = restrictToQuarters ? 1 : restrictToEighths ? 0.5 : 0;
      if (unitFloor > 0 && ev.dur < unitFloor) {
        next.push(ev as any);
        continue;
      }
      const unit = restrictToQuarters ? 1 : restrictToEighths ? 0.5 : ev.dur >= 0.5 ? 0.5 : ev.dur;
      const steps = Math.max(1, Math.round(ev.dur / unit));
      let cursor = ev.t;
      for (let i = 0; i < steps; i++) {
        const idx = (arpIndex + i) % chordPcs.length;
        const pc = descending ? chordPcs[chordPcs.length - 1 - idx]! : chordPcs[idx]!;
        const midi = clampRange(snapToPcNear(ev.midi, pc));
        next.push({
          ...ev,
          t: cursor,
          dur: unit,
          midi,
          pitch: midiToPitch(midi)
        });
        cursor += unit;
      }
      arpIndex += steps;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaBeginnerActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 48;
  const maxMidi = 76;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const useAlberti = shouldChooseMeasure(mNum, 0.6, 77);
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let prevMidi = 60;
    if (useAlberti) {
      for (let t = 0; t < mLen - 1e-6; t += 0.5) {
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) continue;
        const idx = Math.round(t * 2) % seq.length;
        const pc = seq[idx]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vla-beginner-alberti-${mNum}-${t}`,
          t,
          dur: 0.5,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    } else {
      for (let t = 0; t < mLen - 1e-6; t += 1) {
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) continue;
        const idx = Math.round(t) % seq.length;
        const pc = seq[idx]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vla-beginner-arp-${mNum}-${t}`,
          t,
          dur: 1,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function pickThirdAndFifth(chord: { pcs?: number[]; rootPc?: number }): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const majorThird = (root + 4) % 12;
  const minorThird = (root + 3) % 12;
  const third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
  const out: number[] = [];
  if (third !== null) out.push(third);
  out.push(fifth);
  return out.length ? out : pcs.slice(0, 2);
}

function pickRootAndFifth(chord: { pcs?: number[]; rootPc?: number }): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const out: number[] = [root];
  if (pcs.includes(fifth)) out.push(fifth);
  else {
    const alt = pcs.find((pc) => pc !== root);
    if (typeof alt === "number") out.push(alt);
  }
  return out.length ? out : pcs.slice(0, 2);
}

function applyViolin2AdvancedLessActive(vln2: any, options: ApplyOptions): void {
  const measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 67;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = pickThirdAndFifth(chord);
      if (!pcs.length) continue;
      const idx = Math.round(t * 2) % pcs.length;
      const pc = pcs[idx]!;
      const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
      next.push({
        id: `vln2-adv40-${mNum}-${t}`,
        t,
        dur: 0.5,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2AdvancedActive(vln2: any, vc: any, options: ApplyOptions): void {
  const measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const vcMeasures = Array.isArray(vc?.measures) ? vc.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  type CellId = "dot8_16" | "e_16_16" | "e_e" | "q";
  const baseOrder: CellId[] = ["dot8_16", "e_16_16", "e_e", "q"];
  let prevV2 = 67;
  let prevVc: number | null = null;

  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const vcMeasure = vcMeasures.find((mm: any) => Number(mm?.number) === mNum);
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    const order = [...baseOrder];
    // True random per-measure shuffle for rhythm-cell ordering.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let cellIdx = 0;
    for (let beat = 0; beat < mLen - 1e-6; beat += 1) {
      const cell = order[cellIdx % order.length]!;
      const slots: Array<{ t: number; dur: number }> =
        cell === "dot8_16"
          ? [
              { t: beat, dur: 0.75 },
              { t: beat + 0.75, dur: 0.25 }
            ]
          : cell === "e_16_16"
            ? [
                { t: beat, dur: 0.5 },
                { t: beat + 0.5, dur: 0.25 },
                { t: beat + 0.75, dur: 0.25 }
              ]
            : cell === "e_e"
              ? [
                  { t: beat, dur: 0.5 },
                  { t: beat + 0.5, dur: 0.5 }
                ]
              : [{ t: beat, dur: 1 }];

      for (const slot of slots) {
        if (slot.t >= mLen - 1e-6) continue;
        const chord = chordAt(chordEvents, mNum, slot.t);
        const colorPcs = pickThirdAndFifth(chord);
        const chordPcs = chord?.pcs ?? [];
        const pcs = colorPcs.length ? colorPcs : chordPcs;
        if (!pcs.length) continue;

        const vcNow = activeMidiAt(vcMeasure?.events ?? [], slot.t);
        let preferDir: "up" | "down" | "either" = "either";
        if (typeof vcNow === "number" && typeof prevVc === "number") {
          if (vcNow > prevVc) preferDir = "down";
          else if (vcNow < prevVc) preferDir = "up";
        }
        let midi = pickCandidateNear(prevV2, pcs, minMidi, maxMidi, preferDir, vcNow ?? undefined);
        if (typeof vcNow === "number" && midi <= vcNow) {
          while (midi <= vcNow && midi + 12 <= maxMidi) midi += 12;
        }
        next.push({
          id: `vln2-adv60-${mNum}-${slot.t}`,
          t: slot.t,
          dur: Math.min(slot.dur, mLen - slot.t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevV2 = midi;
        if (typeof vcNow === "number") prevVc = vcNow;
      }
      cellIdx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2AdvancedHighActive(vln2: any, cb: any, options: ApplyOptions): void {
  const measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const cbMeasures = Array.isArray(cb?.measures) ? cb.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
  type CellId = "four16" | "two8" | "dotq8";
  const baseOrder: CellId[] = ["four16", "two8", "dotq8"];
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevV2 = 67;
  let prevCb: number | null = null;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const cbMeasure = cbMeasures.find((mm: any) => Number(mm?.number) === mNum);
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    const order = [...baseOrder];
    // True random per-measure shuffle for rhythm-cell ordering.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let t = 0;
    let cellIdx = 0;
    while (t < mLen - 1e-6) {
      const cell = order[cellIdx % order.length]!;
      const slots: Array<{ t: number; dur: number }> =
        cell === "four16"
          ? [
              { t, dur: 0.25 },
              { t: t + 0.25, dur: 0.25 },
              { t: t + 0.5, dur: 0.25 },
              { t: t + 0.75, dur: 0.25 }
            ]
          : cell === "two8"
            ? [
                { t, dur: 0.5 },
                { t: t + 0.5, dur: 0.5 }
              ]
            : [
                { t, dur: 1.5 },
                { t: t + 1.5, dur: 0.5 }
              ];
      for (const slot of slots) {
        if (slot.t >= mLen - 1e-6) continue;
        const chord = chordAt(chordEvents, mNum, slot.t);
        const color = pickThirdAndFifth(chord);
        const pcs = color.length ? color : chord?.pcs ?? [];
        if (!pcs.length) continue;
        const cbNow = activeMidiAt(cbMeasure?.events ?? [], slot.t);
        let preferDir: "up" | "down" | "either" = "either";
        if (typeof cbNow === "number" && typeof prevCb === "number") {
          if (cbNow > prevCb) preferDir = "down";
          else if (cbNow < prevCb) preferDir = "up";
        } else {
          preferDir = passDir(mNum, slot.t, 407) > 0 ? "up" : "down";
        }
        let midi = pickCandidateNear(prevV2, pcs, minMidi, maxMidi, preferDir, cbNow ?? undefined);
        if (typeof cbNow === "number" && midi <= cbNow) {
          while (midi <= cbNow && midi + 12 <= maxMidi) midi += 12;
        }
        next.push({
          id: `vln2-adv100-${mNum}-${slot.t}`,
          t: slot.t,
          dur: Math.min(slot.dur, mLen - slot.t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevV2 = midi;
        if (typeof cbNow === "number") prevCb = cbNow;
      }
      t += cell === "dotq8" ? 2 : 1;
      cellIdx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaAdvancedLessActive(vla: any, vln2: any, options: ApplyOptions): void {
  const vlaMeasures = Array.isArray(vla?.measures) ? vla.measures : [];
  const v2Measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 60;
  for (const m of vlaMeasures) {
    const mNum = Number(m?.number) || 1;
    const v2Measure = v2Measures.find((mm: any) => Number(mm?.number) === mNum);
    const v2ByT = new Map<number, number>();
    for (const ev of v2Measure?.events ?? []) {
      if (ev?.type !== "note") continue;
      const t = Number(ev.t ?? 0);
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null) continue;
      v2ByT.set(Math.round(t * 1000), midi);
    }
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const rf = pickRootAndFifth(chord);
      if (!rf.length) continue;
      const rootPc = rf[0]!;
      const fifthPc = rf.length > 1 ? rf[1]! : rootPc;
      const v2Midi = v2ByT.get(Math.round(t * 1000));
      const v2Pc = typeof v2Midi === "number" ? ((v2Midi % 12) + 12) % 12 : null;
      const targetPc =
        v2Pc === fifthPc ? rootPc : v2Pc === rootPc ? fifthPc : Math.round(t * 2) % 2 === 0 ? rootPc : fifthPc;
      let midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
      if (typeof v2Midi === "number" && midi >= v2Midi) {
        while (midi >= v2Midi && midi - 12 >= minMidi) midi -= 12;
      }
      next.push({
        id: `vla-adv40-${mNum}-${t}`,
        t,
        dur: 0.5,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2BeginnerActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let prevMidi = 69;
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = pickThirdAndFifth(chord);
      if (!pcs.length) continue;
      const idx = Math.round(t * 2) % pcs.length;
      const pc = pcs[idx]!;
      const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
      next.push({
        id: `vln2-beginner-${mNum}-${t}`,
        t,
        dur: 0.5,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolin2BeginnerContraryToMelody(vln1: any, vln2: any, options: ApplyOptions): void {
  const v1Measures = Array.isArray(vln1?.measures) ? vln1.measures : [];
  const v2Measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
  let prevV2: number | null = null;
  let prevMelody: number | null = null;

  for (const m of v1Measures) {
    const mNum = Number(m?.number) || 1;
    const v2Measure = v2Measures.find((mm: any) => Number(mm?.number) === mNum);
    if (!v2Measure) continue;
    const next: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number") continue;
      if (ev.type !== "note") {
        next.push({ ...ev, voice: 1, staff: 1 });
        continue;
      }
      const melodyMidi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (melodyMidi === null) continue;
      const chord = chordAt(chordEvents, mNum, ev.t);
      const pcs = pickThirdAndFifth(chord);
      if (!pcs.length) {
        prevMelody = melodyMidi;
        continue;
      }
      const dir =
        prevMelody === null
          ? "either"
          : melodyMidi > prevMelody
            ? "down"
            : melodyMidi < prevMelody
              ? "up"
              : "either";
      const seed = typeof prevV2 === "number" ? prevV2 : shiftOctavesIntoRange(melodyMidi, minMidi, maxMidi);
      let midi = pickCandidateNear(seed, pcs, minMidi, maxMidi, dir as any);
      if (typeof midi !== "number") {
        midi = shiftOctavesIntoRange(seed, minMidi, maxMidi);
      }
      next.push({
        id: `vln2-contrary-${mNum}-${ev.t}`,
        t: ev.t,
        dur: ev.dur,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevV2 = midi;
      prevMelody = melodyMidi;
    }
    v2Measure.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function pickWeightedDuration(measureNumber: number, t: number): number {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 2246822519);
  h = (h >>> 0) % 1000;
  const r = h / 1000;
  if (r < 0.4) return 0.5; // 40% eighth
  if (r < 0.9) return 1; // 50% quarter
  return 2; // 10% half
}

function applyViolin2IntermediateLessActiveContrary(
  vln2: any,
  vc: any,
  options: ApplyOptions
): void {
  const v2Measures = Array.isArray(vln2?.measures) ? vln2.measures : [];
  const vcMeasures = Array.isArray(vc?.measures) ? vc.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 55;
  const maxMidi = 88; // G3..E6

  let prevV2: number | null = null;
  let prevVc: number | null = null;
  for (const m of v2Measures) {
    const mNum = Number(m?.number) || 1;
    const vcMeasure = vcMeasures.find((mm: any) => Number(mm?.number) === mNum);
    if (!vcMeasure) continue;
    const vcByT = new Map<number, number>();
    for (const ev of vcMeasure.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      if (midi === null) continue;
      vcByT.set(Number(ev.t ?? 0), midi);
    }
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    const mLen = beats * (4 / beatType);
    const next: NoteEvent[] = [];
    let t = 0;
    while (t < mLen - 1e-6) {
      const dur = Math.min(pickWeightedDuration(mNum, t), mLen - t);
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = pickThirdAndFifth(chord);
      if (pcs.length) {
        const vcMidi = vcByT.get(t);
        let preferDir: "up" | "down" | "either" = "either";
        if (typeof vcMidi === "number" && typeof prevVc === "number") {
          if (vcMidi > prevVc) preferDir = "down";
          else if (vcMidi < prevVc) preferDir = "up";
        }
        const seed = typeof prevV2 === "number" ? prevV2 : minMidi + 7;
        const midi = pickCandidateNear(seed, pcs, minMidi, maxMidi, preferDir);
        next.push({
          id: `vln2-int-contrary-${mNum}-${t}`,
          t,
          dur,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevV2 = midi;
      }
      if (typeof vcByT.get(t) === "number") prevVc = vcByT.get(t)!;
      t += dur;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaAdvancedActive(
  vla: any,
  refs: { vln1?: any; vln2?: any; vc?: any; cb?: any },
  options: ApplyOptions
): void {
  const vlaMeasures = Array.isArray(vla?.measures) ? vla.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
  const byMeasure = (part: any): Map<number, any> => {
    const map = new Map<number, any>();
    for (const m of part?.measures ?? []) map.set(Number(m?.number) || 1, m);
    return map;
  };
  const v1By = byMeasure(refs.vln1);
  const v2By = byMeasure(refs.vln2);
  const vcBy = byMeasure(refs.vc);
  const cbBy = byMeasure(refs.cb);
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };

  let prevMidi = 60;
  for (const m of vlaMeasures) {
    const mNum = Number(m?.number) || 1;
    const v1m = v1By.get(mNum);
    const v2m = v2By.get(mNum);
    const vcm = vcBy.get(mNum);
    const cbm = cbBy.get(mNum);
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = chord?.pcs ?? [];
      if (!pcs.length) continue;
      const rootPc = typeof chord?.rootPc === "number" ? chord.rootPc : pcs[0]!;
      const thirdPc = chordThirdPc(chord);
      const fifthPc = chordFifthPc(chord);

      const present = new Set<number>();
      for (const src of [v1m, v2m, vcm, cbm]) {
        const midi = activeMidiAt(src?.events ?? [], t);
        if (typeof midi === "number") present.add(((midi % 12) + 12) % 12);
      }

      let targetPc = rootPc;
      if (typeof thirdPc === "number" && !present.has(thirdPc)) targetPc = thirdPc;
      else if (typeof fifthPc === "number" && !present.has(fifthPc)) targetPc = fifthPc;

      const v2Now = activeMidiAt(v2m?.events ?? [], t);
      let midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
      if (typeof v2Now === "number" && midi >= v2Now) {
        while (midi >= v2Now && midi - 12 >= minMidi) midi -= 12;
      }

      next.push({
        id: `vla-adv60-${mNum}-${t}`,
        t,
        dur: 0.5,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaAdvancedHighActiveTriplets(vla: any, options: ApplyOptions): void {
  const measures = Array.isArray(vla?.measures) ? vla.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 60;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let beat = 0; beat < mLen - 1e-6; beat += 1) {
      const chord = chordAt(chordEvents, mNum, beat);
      const pcs = chord?.pcs ?? [];
      if (!pcs.length) continue;
      const third = chordThirdPc(chord);
      const targetPc = typeof third === "number" ? third : pcs[0]!;
      // Keep advanced-100 triplet engine, but lock pitch class to the chord 3rd.
      for (let i = 0; i < 3; i++) {
        const t = beat + i / 3;
        if (t >= mLen - 1e-6) continue;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
        next.push({
          id: `vla-adv100-trip-${mNum}-${t}`,
          t,
          dur: Math.min(1 / 3, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloAlberti(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 64;
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let prevMidi = minMidi + 12;
    for (let t = 0; t < mLen - 1e-6; t += 1) {
      const chord = chordAt(chordEvents, mNum, t);
      const seq = pickChordToneSequence(chord, 4);
      if (!seq.length) continue;
      const idx = Math.round(t) % seq.length;
      const pc = seq[idx]!;
      const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
      next.push({
        id: `vc-alberti-${mNum}-${t}`,
        t,
        dur: 1,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloIntermediateLessActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 36;
  const maxMidi = 69; // C2..A4
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 48;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    const useQuarter = shouldChooseMeasure(mNum, 0.6, 142); // 60% quarter arpeggios
    if (useQuarter) {
      for (let t = 0; t < mLen - 1e-6; t += 1) {
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) continue;
        const pc = seq[Math.round(t) % seq.length]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vc-int-q-${mNum}-${t}`,
          t,
          dur: 1,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    } else {
      for (let t = 0; t < mLen - 1e-6; t += 2) {
        const chord = chordAt(chordEvents, mNum, t);
        const thirdPc = chordThirdPc(chord);
        const pcs = thirdPc !== null ? [thirdPc] : chord?.pcs ?? [];
        if (!pcs.length) continue;
        const midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
        next.push({
          id: `vc-int-h-${mNum}-${t}`,
          t,
          dur: Math.min(2, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function pickCelloIntermediateActiveMode(measureNumber: number): "alberti" | "quarter" | "sync" | "neighbor" {
  let h = (measureNumber * 2654435761) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  const r = h / 1000;
  if (r < 0.4) return "alberti"; // 40%
  if (r < 0.6) return "quarter"; // 20%
  if (r < 0.9) return "sync"; // 30%
  return "neighbor"; // 10%
}

function applyCelloIntermediateActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 36;
  const maxMidi = 69; // C2..A4
  const keyFifths = typeof options.keyFifths === "number" ? options.keyFifths : 0;
  const keyMode = options.keyMode ?? "major";
  const scale = buildScalePcs(keyFifths, keyMode);
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 48;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const mode = pickCelloIntermediateActiveMode(mNum);
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    if (mode === "alberti") {
      for (let t = 0; t < mLen - 1e-6; t += 0.5) {
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) continue;
        const idx = Math.round(t * 2) % seq.length;
        const pc = seq[idx]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vc-int60-ab-${mNum}-${t}`,
          t,
          dur: 0.5,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    } else if (mode === "quarter") {
      for (let t = 0; t < mLen - 1e-6; t += 1) {
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) continue;
        const pc = seq[Math.round(t) % seq.length]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vc-int60-q-${mNum}-${t}`,
          t,
          dur: 1,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    } else if (mode === "sync") {
      let t = 0.5;
      const pattern = [1.5, 0.5]; // dotted quarter + eighth (syncopated)
      let idx = 0;
      while (t < mLen - 1e-6) {
        const dur = Math.min(pattern[idx % pattern.length]!, mLen - t);
        const chord = chordAt(chordEvents, mNum, t);
        const seq = pickChordToneSequence(chord, 4);
        if (!seq.length) break;
        const pc = seq[idx % seq.length]!;
        const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
        next.push({
          id: `vc-int60-sync-${mNum}-${t}`,
          t,
          dur,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        t += dur;
        idx += 1;
      }
    } else {
      for (let t = 0; t < mLen - 1e-6; t += 1) {
        const chord = chordAt(chordEvents, mNum, t);
        const chordPcs = chord?.pcs ?? [];
        if (!chordPcs.length) continue;
        const basePc = chordPcs[Math.round(t) % chordPcs.length]!;
        const baseMidi = shiftOctavesIntoRange(snapToPcNear(prevMidi, basePc), minMidi, maxMidi);
        const dir = passDir(mNum, t, 31);
        const neighbor = neighborMidi(baseMidi, dir, scale, chordPcs);
        const midi = neighbor !== null ? shiftOctavesIntoRange(neighbor, minMidi, maxMidi) : baseMidi;
        next.push({
          id: `vc-int60-nei-${mNum}-${t}`,
          t,
          dur: 1,
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloAdvancedActivePattern(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 76; // C2..E5
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 48;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 1) {
      const chord = chordAt(chordEvents, mNum, t);
      const seq = pickChordToneSequence(chord, 4);
      if (!seq.length) continue;
      const beatIndex = Math.floor(t);
      const pcA = seq[(beatIndex * 2) % seq.length]!;
      const pcB = seq[(beatIndex * 2 + 1) % seq.length]!;
      const midiA = shiftOctavesIntoRange(snapToPcNear(prevMidi, pcA), minMidi, maxMidi);
      next.push({
        id: `vc-adv60-dot8-${mNum}-${t}`,
        t,
        dur: Math.min(0.75, mLen - t),
        type: "note",
        midi: midiA,
        pitch: midiToPitch(midiA),
        voice: 1,
        staff: 1
      });
      prevMidi = midiA;
      const t2 = t + 0.75;
      if (t2 < mLen - 1e-6) {
        const midiB = shiftOctavesIntoRange(snapToPcNear(prevMidi, pcB), minMidi, maxMidi);
        next.push({
          id: `vc-adv60-16-${mNum}-${t2}`,
          t: t2,
          dur: Math.min(0.25, mLen - t2),
          type: "note",
          midi: midiB,
          pitch: midiToPitch(midiB),
          voice: 1,
          staff: 1
        });
        prevMidi = midiB;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloAdvancedHighActiveSyncopes(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 76; // C2..E5
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 48;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let idx = 0;
    // Syncopation: attacks on offbeats (8th offset), sustained through strong beats.
    for (let t = 0.5; t < mLen - 1e-6; t += 1) {
      const chord = chordAt(chordEvents, mNum, t);
      const triad: number[] = [];
      const rootPc =
        typeof chord?.rootPc === "number" ? chord.rootPc : Array.isArray(chord?.pcs) && chord.pcs.length ? chord.pcs[0]! : null;
      const thirdPc = chordThirdPc(chord);
      const fifthPc = chordFifthPc(chord);
      if (typeof rootPc === "number") triad.push(rootPc);
      if (typeof thirdPc === "number" && !triad.includes(thirdPc)) triad.push(thirdPc);
      if (typeof fifthPc === "number" && !triad.includes(fifthPc)) triad.push(fifthPc);
      if (!triad.length) continue;

      const pc = triad[idx % triad.length]!;
      const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
      next.push({
        id: `vc-adv100-sync-${mNum}-${t}`,
        t,
        dur: Math.min(1, mLen - t),
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
      idx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloIntermediateHighActivePattern(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 36;
  const maxMidi = 69; // C2..A4
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 48;
  const baseOrder: Array<"quarter" | "two8" | "alberti16" | "dot8_16"> = [
    "quarter",
    "two8",
    "alberti16",
    "dot8_16"
  ];
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let t = 0;
    const cellOrder = [...baseOrder];
    // True random per-measure shuffle for rhythm-cell ordering.
    for (let i = cellOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = cellOrder[i]!;
      cellOrder[i] = cellOrder[j]!;
      cellOrder[j] = tmp;
    }
    let cellIdx = 0;
    while (t < mLen - 1e-6) {
      const cell = cellOrder[cellIdx % cellOrder.length]!;
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = chord?.pcs ?? [];
      if (cell === "quarter") {
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vc-int100-q-${mNum}-${t}`,
          t,
          dur: Math.min(1, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      } else if (cell === "two8") {
        const times = [t, t + 0.5];
        let lastPc: number | null = null;
        for (const s of times) {
          if (s >= mLen - 1e-6) continue;
          let midi = prevMidi;
          if (pcs.length) {
            const excludePc = lastPc;
            midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either", undefined, excludePc ?? undefined);
          } else {
            midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vc-int100-8-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.5, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
          lastPc = ((midi % 12) + 12) % 12;
        }
      } else if (cell === "alberti16") {
        const seq = pickChordToneSequence(chord, 4);
        for (let i = 0; i < 4; i++) {
          const s = t + i * 0.25;
          if (s >= mLen - 1e-6) continue;
          if (!seq.length) continue;
          const pc = seq[i % seq.length]!;
          const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
          next.push({
            id: `vc-int100-ab16-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.25, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
        }
      } else {
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vc-int100-dot8-${mNum}-${t}`,
          t,
          dur: Math.min(0.75, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        const t2 = t + 0.75;
        if (t2 < mLen - 1e-6) {
          const chord2 = chordAt(chordEvents, mNum, t2);
          const pcs2 = chord2?.pcs ?? pcs;
          let midi2 = prevMidi;
          if (pcs2.length) {
            const excludePc = ((prevMidi % 12) + 12) % 12;
            midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, "either", undefined, excludePc);
          } else {
            midi2 = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vc-int100-16-${mNum}-${t2}`,
            t: t2,
            dur: Math.min(0.25, mLen - t2),
            type: "note",
            midi: midi2,
            pitch: midiToPitch(midi2),
            voice: 1,
            staff: 1
          });
          prevMidi = midi2;
        }
      }
      t += 1;
      cellIdx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaIntermediateHighActivePattern(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
  const maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 81; // C3..A5
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 60;
  const baseOrder: Array<"dot8_16" | "four16" | "dotq_8" | "quarter" | "two8" | "alberti16"> = [
    "dot8_16",
    "four16",
    "dotq_8",
    "quarter",
    "two8",
    "alberti16"
  ];
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    let t = 0;
    const preferDir: "up" | "down" = passDir(mNum, 0, 211) > 0 ? "up" : "down";
    const order = [...baseOrder];
    // True random per-measure shuffle for rhythm-cell ordering.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let cellIdx = 0;
    while (t < mLen - 1e-6) {
      const cell = order[cellIdx % order.length]!;
      const chord = chordAt(chordEvents, mNum, t);
      const pcs = chord?.pcs ?? [];
      if (cell === "quarter") {
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vla-int100-q-${mNum}-${t}`,
          t,
          dur: Math.min(1, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        t += 1;
      } else if (cell === "two8") {
        const times = [t, t + 0.5];
        let lastPc: number | null = null;
        for (const s of times) {
          if (s >= mLen - 1e-6) continue;
          let midi = prevMidi;
          if (pcs.length) {
            midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, undefined, lastPc ?? undefined);
          } else {
            midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vla-int100-8-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.5, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
          lastPc = ((midi % 12) + 12) % 12;
        }
        t += 1;
      } else if (cell === "alberti16") {
        const seq = pickChordToneSequence(chord, 4);
        for (let i = 0; i < 4; i++) {
          const s = t + i * 0.25;
          if (s >= mLen - 1e-6 || !seq.length) continue;
          const pc = seq[i % seq.length]!;
          const midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
          next.push({
            id: `vla-int100-ab16-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.25, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
        }
        t += 1;
      } else if (cell === "dot8_16") {
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vla-int100-dot8-${mNum}-${t}`,
          t,
          dur: Math.min(0.75, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        const t2 = t + 0.75;
        if (t2 < mLen - 1e-6) {
          const chord2 = chordAt(chordEvents, mNum, t2);
          const pcs2 = chord2?.pcs ?? pcs;
          let midi2 = prevMidi;
          if (pcs2.length) {
            midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi);
          } else {
            midi2 = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vla-int100-16-${mNum}-${t2}`,
            t: t2,
            dur: Math.min(0.25, mLen - t2),
            type: "note",
            midi: midi2,
            pitch: midiToPitch(midi2),
            voice: 1,
            staff: 1
          });
          prevMidi = midi2;
        }
        t += 1;
      } else if (cell === "four16") {
        const slots = [t, t + 0.25, t + 0.5, t + 0.75];
        for (const s of slots) {
          if (s >= mLen - 1e-6) continue;
          const chordS = chordAt(chordEvents, mNum, s);
          const pcsS = chordS?.pcs ?? [];
          let midi = prevMidi;
          if (pcsS.length) {
            midi = pickCandidateNear(prevMidi, pcsS, minMidi, maxMidi, preferDir, prevMidi);
            if (preferDir === "up" && midi <= prevMidi && midi + 12 <= maxMidi) midi += 12;
            if (preferDir === "down" && midi >= prevMidi && midi - 12 >= minMidi) midi -= 12;
          } else {
            midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vla-int100-16a-${mNum}-${s}`,
            t: s,
            dur: Math.min(0.25, mLen - s),
            type: "note",
            midi,
            pitch: midiToPitch(midi),
            voice: 1,
            staff: 1
          });
          prevMidi = midi;
        }
        t += 1;
      } else {
        let midi = prevMidi;
        if (pcs.length) {
          midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `vla-int100-dotq-${mNum}-${t}`,
          t,
          dur: Math.min(1.5, mLen - t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
        const t2 = t + 1.5;
        if (t2 < mLen - 1e-6) {
          const chord2 = chordAt(chordEvents, mNum, t2);
          const pcs2 = chord2?.pcs ?? pcs;
          let midi2 = prevMidi;
          if (pcs2.length) {
            const excludePc = ((prevMidi % 12) + 12) % 12;
            midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi, excludePc);
          } else {
            midi2 = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
          }
          next.push({
            id: `vla-int100-8b-${mNum}-${t2}`,
            t: t2,
            dur: Math.min(0.5, mLen - t2),
            type: "note",
            midi: midi2,
            pitch: midiToPitch(midi2),
            voice: 1,
            staff: 1
          });
          prevMidi = midi2;
        }
        t += 2;
      }
      cellIdx += 1;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyDoubleBassIntermediateHighActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 28;
  const maxMidi = 60; // E1..C4
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 40;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const bassPc = typeof chord?.bassPc === "number" ? chord.bassPc : chord?.rootPc ?? chord?.pcs?.[0];
      let midi = prevMidi;
      if (typeof bassPc === "number") {
        midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, bassPc), minMidi, maxMidi);
      } else {
        midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
      }
      next.push({
        id: `cb-int100-8-${mNum}-${t}`,
        t,
        dur: Math.min(0.5, mLen - t),
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyDoubleBassAdvancedHighActive(part: any, options: ApplyOptions): void {
  const measures = Array.isArray(part?.measures) ? part.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 28;
  const maxMidi = 60; // E1..C4
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };
  let prevMidi = 40;
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let beat = 0; beat < mLen - 1e-6; beat += 1) {
      const slots: Array<{ t: number; dur: number }> = [
        { t: beat, dur: 0.5 },
        { t: beat + 0.5, dur: 0.25 },
        { t: beat + 0.75, dur: 0.25 }
      ];
      for (const slot of slots) {
        if (slot.t >= mLen - 1e-6) continue;
        const chord = chordAt(chordEvents, mNum, slot.t);
        const bassPc = typeof chord?.bassPc === "number" ? chord.bassPc : chord?.rootPc ?? chord?.pcs?.[0];
        let midi = prevMidi;
        if (typeof bassPc === "number") {
          midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, bassPc), minMidi, maxMidi);
        } else {
          midi = shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
        }
        next.push({
          id: `cb-adv100-cell-${mNum}-${slot.t}`,
          t: slot.t,
          dur: Math.min(slot.dur, mLen - slot.t),
          type: "note",
          midi,
          pitch: midiToPitch(midi),
          voice: 1,
          staff: 1
        });
        prevMidi = midi;
      }
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyViolaIntermediateAgainstCello(vla: any, vc: any, options: ApplyOptions): void {
  const vlaMeasures = Array.isArray(vla?.measures) ? vla.measures : [];
  const vcMeasures = Array.isArray(vc?.measures) ? vc.measures : [];
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 48;
  const maxMidi = 81; // C3..A5
  const measureLen = (m: any): number => {
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    return beats * (4 / beatType);
  };

  let prevMidi = 60;
  for (const m of vlaMeasures) {
    const mNum = Number(m?.number) || 1;
    const vcMeasure = vcMeasures.find((mm: any) => Number(mm?.number) === mNum);
    if (!vcMeasure) continue;
    const vcEvents = (vcMeasure.events ?? []).filter((e: any) => e?.type === "note");
    const vcByT = new Map<number, number>();
    for (const e of vcEvents) {
      const midi = typeof e.midi === "number" ? e.midi : e.pitch ? pitchToMidi(e.pitch) : null;
      if (midi === null) continue;
      vcByT.set(Number(e.t ?? 0), midi);
    }
    const next: NoteEvent[] = [];
    const mLen = measureLen(m);
    for (let t = 0; t < mLen - 1e-6; t += 0.5) {
      const chord = chordAt(chordEvents, mNum, t);
      const seq = pickChordToneSequence(chord, 4);
      if (!seq.length) continue;
      const idx = Math.round(t * 2) % seq.length;
      const pc = seq[idx]!;
      const vcMidi = vcByT.get(t);
      let midi = shiftOctavesIntoRange(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
      if (typeof vcMidi === "number" && midi === vcMidi) {
        const up = shiftOctavesIntoRange(midi + 12, minMidi, maxMidi);
        if (up !== vcMidi) midi = up;
        else {
          const down = shiftOctavesIntoRange(midi - 12, minMidi, maxMidi);
          if (down !== vcMidi) midi = down;
        }
      }
      next.push({
        id: `vla-int-ab-${mNum}-${t}`,
        t,
        dur: 0.5,
        type: "note",
        midi,
        pitch: midiToPitch(midi),
        voice: 1,
        staff: 1
      });
      prevMidi = midi;
    }
    m.events = next.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function applyCelloMelodyRhythmContrary(vln1: any, vc: any, options: ApplyOptions): void {
  const chordEvents = options.chordEvents ?? [];
  const minMidi = 36;
  const maxMidi = 64;
  let prevVc = 48;
  let prevMelody: number | null = null;
  for (const m of vln1?.measures ?? []) {
    const mNum = Number(m?.number) || 1;
    const vlnEvents: NoteEvent[] = Array.isArray(m?.events) ? m.events : [];
    const vcEvents: NoteEvent[] = [];
    for (const ev of vlnEvents) {
      if (ev.type !== "note" || typeof ev.t !== "number" || typeof ev.dur !== "number") {
        vcEvents.push({ ...ev });
        continue;
      }
      const melodyMidi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
      const chord = chordAt(chordEvents, mNum, ev.t);
      const chordPcs = chord?.pcs ?? [];
      if (!chordPcs.length || melodyMidi === null) {
        vcEvents.push({ ...ev });
        continue;
      }
      const melodyDir =
        prevMelody === null
          ? "either"
          : melodyMidi > prevMelody
            ? "up"
            : melodyMidi < prevMelody
              ? "down"
              : "either";
      const preferDir = melodyDir === "up" ? "down" : melodyDir === "down" ? "up" : "either";
      const nextVc = pickCandidateNear(prevVc, chordPcs, minMidi, maxMidi, preferDir, melodyMidi);
      vcEvents.push({
        id: `vc-melody-rhythm-${mNum}-${ev.t}`,
        t: ev.t,
        dur: ev.dur,
        type: "note",
        midi: nextVc,
        pitch: midiToPitch(nextVc),
        voice: 1,
        staff: 1
      });
      prevVc = nextVc;
      prevMelody = melodyMidi;
    }
    const vcMeasure = (vc?.measures ?? []).find((mm: any) => Number(mm?.number) === mNum);
    if (vcMeasure) vcMeasure.events = vcEvents.sort((a, b) => Number(a.t) - Number(b.t));
  }
}

function snapToPcNear(baseMidi: number, pc: number): number {
  const baseOct = Math.floor(baseMidi / 12);
  const candidates = [baseOct - 1, baseOct, baseOct + 1].map((oct) => pc + oct * 12);
  let best = candidates[0]!;
  let bestDist = Math.abs(best - baseMidi);
  for (const c of candidates) {
    const d = Math.abs(c - baseMidi);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function pickCandidateNear(
  prevMidi: number,
  pcs: number[],
  minMidi: number,
  maxMidi: number,
  preferDir: "up" | "down" | "either",
  excludeMidi?: number,
  excludePc?: number
): number {
  const baseOct = Math.floor(prevMidi / 12);
  const candidates: number[] = [];
  for (const pc of pcs) {
    for (let oct = -2; oct <= 2; oct++) {
      const midi = pc + (baseOct + oct) * 12;
      if (midi >= minMidi && midi <= maxMidi) candidates.push(midi);
    }
  }
  if (!candidates.length) return shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
  let filtered = typeof excludeMidi === "number" ? candidates.filter((m) => m !== excludeMidi) : candidates;
  if (typeof excludePc === "number") {
    filtered = filtered.filter((m) => ((m % 12) + 12) % 12 !== excludePc);
  }
  const dirFilter = filtered.filter((m) =>
    preferDir === "either" ? true : preferDir === "up" ? m > prevMidi : m < prevMidi
  );
  const pool = dirFilter.length ? dirFilter : filtered.length ? filtered : candidates;
  pool.sort((a, b) => Math.abs(a - prevMidi) - Math.abs(b - prevMidi));
  return pool[0]!;
}

function buildQuarterHalfPattern(measureLen: number, measureNumber: number): number[] {
  const out: number[] = [];
  let remaining = measureLen;
  const useTwo = measureNumber % 2 === 0;
  while (remaining > 0.01) {
    if (remaining >= 2 && useTwo) {
      out.push(2);
      remaining -= 2;
    } else {
      out.push(1);
      remaining -= 1;
    }
  }
  return out;
}

function applyBeginnerContraryMotion(
  vla: any,
  vc: any,
  options: ApplyOptions
): void {
  const chordEvents = options.chordEvents ?? [];
  const vlaMin = 48;
  const vlaMax = 76;
  const vcMin = 36;
  const vcMax = 64;
  let prevVla = 60;
  let prevVc = 48;
  const measures = Array.isArray(vla?.measures) ? vla.measures : [];
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    const beats = Number(m?.attributes?.time?.beats ?? 4);
    const measureLen = beats * (4 / beatType);
    const pattern = buildQuarterHalfPattern(measureLen, mNum);
    const vcEvents: NoteEvent[] = [];
    let t = 0;
    for (const dur of pattern) {
      const chord = chordAt(chordEvents, mNum, t);
      const chordPcs = chord?.pcs ?? [];
      if (!chordPcs.length) {
        t += dur;
        continue;
      }
      const nextVc = pickCandidateNear(prevVc, chordPcs, vcMin, vcMax, "either");
      vcEvents.push({
        id: `vc-contrary-${mNum}-${t}`,
        t,
        dur,
        type: "note",
        midi: nextVc,
        pitch: midiToPitch(nextVc),
        voice: 1,
        staff: 1
      });
      prevVc = nextVc;
      t += dur;
    }

    const vlaEvents: NoteEvent[] = [];
    for (let i = 0; i < vcEvents.length; i++) {
      const ev = vcEvents[i]!;
      const dur = ev.dur;
      const next = vcEvents[i + 1];
      if (dur === 1 && next && next.dur === 1) {
        const chord = chordAt(chordEvents, mNum, ev.t);
        const chordPcs = chord?.pcs ?? [];
        if (chordPcs.length) {
          const prevVcMidi = i > 0 ? vcEvents[i - 1]?.midi : null;
          const vcDir =
            typeof prevVcMidi === "number"
              ? ev.midi > prevVcMidi
                ? "up"
                : ev.midi < prevVcMidi
                  ? "down"
                  : "either"
              : "either";
          const vlaDir = vcDir === "up" ? "down" : vcDir === "down" ? "up" : "either";
          const nextVla = pickCandidateNear(
            prevVla,
            chordPcs,
            vlaMin,
            vlaMax,
            vlaDir,
            ev.midi,
            ((ev.midi % 12) + 12) % 12
          );
          vlaEvents.push({
            id: `vla-contrary-${mNum}-${ev.t}`,
            t: ev.t,
            dur: 2,
            type: "note",
            midi: nextVla,
            pitch: midiToPitch(nextVla),
            voice: 1,
            staff: 1
          });
          prevVla = nextVla;
        }
        i += 1;
        continue;
      }
      if (dur === 2) {
        for (let k = 0; k < 2; k++) {
          const t2 = ev.t + k;
          const chord = chordAt(chordEvents, mNum, t2);
          const chordPcs = chord?.pcs ?? [];
          if (!chordPcs.length) continue;
          const prevVcMidi = i > 0 ? vcEvents[i - 1]?.midi : null;
          const vcDir =
            typeof prevVcMidi === "number"
              ? ev.midi > prevVcMidi
                ? "up"
                : ev.midi < prevVcMidi
                  ? "down"
                  : "either"
              : "either";
          const vlaDir = vcDir === "up" ? "down" : vcDir === "down" ? "up" : "either";
          const nextVla = pickCandidateNear(
            prevVla,
            chordPcs,
            vlaMin,
            vlaMax,
            vlaDir,
            ev.midi,
            ((ev.midi % 12) + 12) % 12
          );
          vlaEvents.push({
            id: `vla-contrary-${mNum}-${t2}`,
            t: t2,
            dur: 1,
            type: "note",
            midi: nextVla,
            pitch: midiToPitch(nextVla),
            voice: 1,
            staff: 1
          });
          prevVla = nextVla;
        }
        continue;
      }
      // Fallback for odd durations, keep quarter.
      const chord = chordAt(chordEvents, mNum, ev.t);
      const chordPcs = chord?.pcs ?? [];
      if (chordPcs.length) {
        const nextVla = pickCandidateNear(
          prevVla,
          chordPcs,
          vlaMin,
          vlaMax,
          "either",
          ev.midi,
          ((ev.midi % 12) + 12) % 12
        );
        vlaEvents.push({
          id: `vla-contrary-${mNum}-${ev.t}`,
          t: ev.t,
          dur,
          type: "note",
          midi: nextVla,
          pitch: midiToPitch(nextVla),
          voice: 1,
          staff: 1
        });
        prevVla = nextVla;
      }
    }

    m.events = vlaEvents.sort((a, b) => Number(a.t) - Number(b.t));
    const vcMeasure = (Array.isArray(vc?.measures) ? vc.measures : []).find((mm: any) => Number(mm?.number) === mNum);
    if (vcMeasure) vcMeasure.events = vcEvents.sort((a, b) => Number(a.t) - Number(b.t));
  }
}
