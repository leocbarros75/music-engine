// src/harmonize/satb/inferChordsFromMelody.ts
import type { ScoreModel } from "../../score/types";

// Convert MusicXML key signature (fifths) to tonic pitch class for MINOR keys.
function tonicPcFromFifthsMinor(fifths: number): number {
  const map: Record<number, number> = {
    "-7": 8,
    "-6": 3,
    "-5": 10,
    "-4": 5,
    "-3": 0,
    "-2": 7,
    "-1": 2,
    "0": 9,
    "1": 4,
    "2": 11,
    "3": 6,
    "4": 1,
    "5": 8,
    "6": 3,
    "7": 10
  };
  const k = String(fifths);
  return map[k] ?? 9;
}

type ChordEvent = {
  measure: number;
  t: number;
  symbol: string;
};

// Pitch class helpers
function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Convert MusicXML key signature (fifths) to tonic pitch class for MAJOR keys.
function tonicPcFromFifthsMajor(fifths: number): number {
  const map: Record<number, number> = {
    "-7": 11,
    "-6": 6,
    "-5": 1,
    "-4": 8,
    "-3": 3,
    "-2": 10,
    "-1": 5,
    "0": 0,
    "1": 7,
    "2": 2,
    "3": 9,
    "4": 4,
    "5": 11,
    "6": 6,
    "7": 1
  };
  const k = String(fifths);
  return map[k] ?? 0;
}

function majorScalePcs(tonicPc: number): number[] {
  const rel = [0, 2, 4, 5, 7, 9, 11];
  return rel.map((x) => (tonicPc + x) % 12);
}

type DiatonicTriad = {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  rootPc: number;
  pcs: number[];
  symbol: string;
};

function pcName(p: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return names[((p % 12) + 12) % 12]!;
}

// Build diatonic triads in major
function buildDiatonicTriadsMajor(tonicPc: number): DiatonicTriad[] {
  const scale = majorScalePcs(tonicPc);

  const root = (deg: number) => scale[deg - 1]!;
  const third = (deg: number) => scale[(deg - 1 + 2) % 7]!;
  const fifth = (deg: number) => scale[(deg - 1 + 4) % 7]!;
  const triadPcs = (deg: number) => [root(deg), third(deg), fifth(deg)];

  const sym = (deg: number): string => {
    if (deg === 1) return pcName(tonicPc);
    if (deg === 2) return pcName(root(deg)) + "m";
    if (deg === 3) return pcName(root(deg)) + "m";
    if (deg === 4) return pcName(root(deg));
    if (deg === 5) return pcName(root(deg));
    if (deg === 6) return pcName(root(deg)) + "m";
    return pcName(root(deg)) + "dim";
  };

  const out: DiatonicTriad[] = [];
  for (let d = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7; d <= 7; d = (d + 1) as any) {
    out.push({
      degree: d,
      rootPc: root(d),
      pcs: triadPcs(d).map((x) => x % 12),
      symbol: sym(d)
    });
  }
  return out;
}

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = m0?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

function averageMidiForPart(part: any): number | null {
  const vals: number[] = [];
  for (const m of part?.measures ?? []) {
    for (const e of m?.events ?? []) {
      if (e?.type !== "note") continue;
      if (typeof e?.midi === "number") vals.push(e.midi);
    }
  }
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum / vals.length;
}

function detectMelodyVoice(part: any): number | null {
  const counts = new Map<number, number>();
  for (const m of part?.measures ?? []) {
    for (const e of m?.events ?? []) {
      if (!e || (e.type !== "note" && e.type !== "rest")) continue;
      const v = Number(e.voice);
      if (!Number.isFinite(v)) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const voices = Array.from(counts.keys());
  if (voices.length <= 1) return null;
  if (counts.has(1)) return 1;
  let best = voices[0]!;
  let bestCount = counts.get(best) ?? 0;
  for (const v of voices) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function getMelodyPart(score: ScoreModel): { part: any; voice: number | null } | null {
  const parts = score.parts ?? [];
  if (!parts.length) return null;
  if (parts.length === 1) return { part: parts[0], voice: detectMelodyVoice(parts[0]) };

  const preferByName = ["melody", "soprano", "voice"];
  for (const needle of preferByName) {
    for (const p of parts) {
      const name = String(p?.name ?? "").toLowerCase();
      if (name.includes(needle)) return { part: p, voice: detectMelodyVoice(p) };
    }
  }

  let best = parts[0] ?? null;
  let bestAvg = -Infinity;
  for (const p of parts) {
    const avg = averageMidiForPart(p);
    if (avg !== null && avg > bestAvg) {
      best = p;
      bestAvg = avg;
    }
  }
  if (!best) return null;
  return { part: best, voice: detectMelodyVoice(best) };
}

function firstMelodyMidiInMeasure(measure: any, melodyVoice: number | null): number | null {
  const notes = (measure?.events ?? [])
    .filter((e: any) => e?.type === "note" && typeof e?.midi === "number")
    .filter((e: any) => (melodyVoice === null || melodyVoice === undefined ? true : e?.voice === melodyVoice));
  if (!notes.length) return null;
  notes.sort((a: any, b: any) => Number(a.t) - Number(b.t));
  return Number(notes[0]!.midi);
}

function progressionPenalty(prevDeg: number | null, nextDeg: number): number {
  if (prevDeg === null) return 0;

  const goodPairs = new Set<string>([
    "1->4",
    "1->5",
    "1->6",
    "6->2",
    "2->5",
    "4->5",
    "5->1",
    "5->6",
    "4->1"
  ]);

  if (prevDeg === nextDeg) return 2;
  if (goodPairs.has(`${prevDeg}->${nextDeg}`)) return 0;

  return 4;
}

export function inferChordsFromMelody(inScore: ScoreModel): ChordEvent[] {
  const melodyInfo = getMelodyPart(inScore);
  const melodyPart = melodyInfo?.part;
  const melodyVoice = melodyInfo?.voice ?? null;
  const measures = melodyPart?.measures ?? [];
  if (!measures.length) return [];

  const fifths = getKeyFifths(inScore);
  const tonic = tonicPcFromFifthsMajor(fifths);
  const triads = buildDiatonicTriadsMajor(tonic);

  const lastMeasureNumber = Number(measures[measures.length - 1]?.number ?? measures.length);

  const out: ChordEvent[] = [];
  let prevDeg: number | null = null;

  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const measureNumber = Number(m?.number ?? (i + 1));

    const isLast = measureNumber === lastMeasureNumber;
    const isPenult = measureNumber === lastMeasureNumber - 1;

    if (isLast) {
      out.push({ measure: measureNumber, t: 0, symbol: triads[0]!.symbol }); // I
      prevDeg = 1;
      continue;
    }

    if (isPenult) {
      const V = triads.find((t) => t.degree === 5)!;
      out.push({ measure: measureNumber, t: 0, symbol: V.symbol + "7" });
      prevDeg = 5;
      continue;
    }

    const midi = firstMelodyMidiInMeasure(m, melodyVoice);
    const melPc = midi === null ? null : pc(midi);

    const candidates = triads
      .filter((t) => (melPc === null ? true : t.pcs.includes(melPc)))
      .sort((a, b) => {
        const pref = (deg: number) => {
          if (deg === 1) return 0;
          if (deg === 5) return 1;
          if (deg === 4) return 2;
          if (deg === 6) return 3;
          if (deg === 2) return 4;
          if (deg === 3) return 6;
          return 9;
        };
        return pref(a.degree) - pref(b.degree);
      });

    let best = candidates[0] ?? triads[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of candidates.length ? candidates : triads) {
      const score = progressionPenalty(prevDeg, c.degree) + (c.degree === 7 ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    out.push({ measure: measureNumber, t: 0, symbol: best.symbol });
    prevDeg = best.degree;
  }

  return out;
}

// ─── Chord template used by inferChordsFromAllVoices ─────────────────────────

type ChordTemplate = {
  symbol: string;
  rootPc: number;
  pcs: number[];
  priority: number; // lower = more preferred
};

function buildChordLibrary(tonicPc: number, mode: string): ChordTemplate[] {
  const templates: ChordTemplate[] = [];

  if (mode === "minor") {
    // Natural minor scale: [0,2,3,5,7,8,10]
    const naturalIntervals = [0, 2, 3, 5, 7, 8, 10];
    const scale = naturalIntervals.map((i) => (tonicPc + i) % 12);

    // Degree qualities for natural minor: [m,dim,M,m,M,M,M]
    const triadIntervals: Array<[number, number]> = [
      [3, 7],   // i  - minor
      [3, 6],   // ii° - diminished
      [4, 7],   // III - major
      [3, 7],   // iv  - minor
      [4, 7],   // V   - major (harmonic minor raises 7)
      [4, 7],   // VI  - major
      [4, 7],   // VII - major
    ];
    const suffixes = ["m", "dim", "", "m", "", "", ""];
    const priorities = [0, 4, 5, 2, 1, 3, 6];

    for (let d = 0; d < 7; d++) {
      const rootPc = scale[d]!;
      const thirdPc = (rootPc + triadIntervals[d]![0]) % 12;
      const fifthPc = (rootPc + triadIntervals[d]![1]) % 12;
      const pcs = [rootPc, thirdPc, fifthPc];
      const symbol = pcName(rootPc) + suffixes[d];
      templates.push({ symbol, rootPc, pcs, priority: priorities[d]! });
    }

    // Harmonic minor: dominant V is always major (degree 5, raise leading tone)
    const domRoot = (tonicPc + 7) % 12;
    const domThird = (domRoot + 4) % 12;
    const domFifth = (domRoot + 7) % 12;
    const domSeventh = (domRoot + 10) % 12;

    // Override V with harmonic-minor version (major triad on dom)
    // Already included as degree 4 (index 4) but ensure we also have the dom7
    const dom7Symbol = pcName(domRoot) + "7";
    templates.push({
      symbol: dom7Symbol,
      rootPc: domRoot,
      pcs: [domRoot, domThird, domFifth, domSeventh],
      priority: 1
    });

  } else {
    // Major scale: [0,2,4,5,7,9,11]
    const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
    const scale = majorIntervals.map((i) => (tonicPc + i) % 12);

    // Diatonic triads: [M,m,m,M,M,m,dim]
    const triadIntervals: Array<[number, number]> = [
      [4, 7],   // I   - major
      [3, 7],   // ii  - minor
      [3, 7],   // iii - minor
      [4, 7],   // IV  - major
      [4, 7],   // V   - major
      [3, 7],   // vi  - minor
      [3, 6],   // vii° - diminished
    ];
    const suffixes = ["", "m", "m", "", "", "m", "dim"];
    const priorities = [0, 4, 5, 2, 1, 3, 6];

    for (let d = 0; d < 7; d++) {
      const rootPc = scale[d]!;
      const thirdPc = (rootPc + triadIntervals[d]![0]) % 12;
      const fifthPc = (rootPc + triadIntervals[d]![1]) % 12;
      const pcs = [rootPc, thirdPc, fifthPc];
      const symbol = pcName(rootPc) + suffixes[d];
      templates.push({ symbol, rootPc, pcs, priority: priorities[d]! });
    }

    // Dominant seventh on degree 5
    const domRoot = scale[4]!;
    const domThird = (domRoot + 4) % 12;
    const domFifth = (domRoot + 7) % 12;
    const domSeventh = (domRoot + 10) % 12;
    const dom7Symbol = pcName(domRoot) + "7";
    templates.push({
      symbol: dom7Symbol,
      rootPc: domRoot,
      pcs: [domRoot, domThird, domFifth, domSeventh],
      priority: 1
    });

    // Secondary dominant V/V: major triad + dom7 on scale[1] (degree 2 root)
    const vofvRoot = scale[1]!;
    templates.push({
      symbol: pcName(vofvRoot) + "7",
      rootPc: vofvRoot,
      pcs: [vofvRoot, (vofvRoot + 4) % 12, (vofvRoot + 7) % 12, (vofvRoot + 10) % 12],
      priority: 7
    });

    // Secondary dominant V/ii: major triad + dom7 on scale[5] (degree 6 root)
    const vofiiRoot = scale[5]!;
    templates.push({
      symbol: pcName(vofiiRoot) + "7",
      rootPc: vofiiRoot,
      pcs: [vofiiRoot, (vofiiRoot + 4) % 12, (vofiiRoot + 7) % 12, (vofiiRoot + 10) % 12],
      priority: 7
    });
  }

  return templates;
}

export function inferChordsFromAllVoices(inScore: ScoreModel): ChordEvent[] {
  const parts = inScore.parts ?? [];
  if (!parts.length) return inferChordsFromMelody(inScore);

  const m0 = parts[0]?.measures?.[0];
  const fifths: number = typeof m0?.attributes?.key_fifths === "number" ? m0.attributes.key_fifths : 0;
  const mode: string = m0?.attributes?.key_mode ?? "major";
  const divisions: number = typeof m0?.attributes?.divisions === "number" ? m0.attributes.divisions : 2;
  const beatsPerMeasure: number = m0?.attributes?.time?.beats ?? 4;

  const tonicPc = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
  const templates = buildChordLibrary(tonicPc, mode);

  // Tonic and dominant symbols for forced cadence
  const tonicSymbol = pcName(tonicPc);
  const domRoot = (tonicPc + 7) % 12;
  const dom7Symbol = pcName(domRoot) + "7";

  // Use the first part's measures as the measure index source
  const measures = parts[0]?.measures ?? [];
  if (!measures.length) return [];

  const out: ChordEvent[] = [];

  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi]!;
    const measureNumber: number = measure.number ?? mi + 1;
    const isLast = mi === measures.length - 1;
    const isPenult = mi === measures.length - 2;

    if (isLast) {
      out.push({ measure: measureNumber, t: 0, symbol: tonicSymbol });
      continue;
    }

    if (isPenult) {
      out.push({ measure: measureNumber, t: 0, symbol: dom7Symbol });
      continue;
    }

    // Divisor: t is in divisions, beat is in quarter notes
    const divisionsPerBeat = divisions;

    let prevBeatSymbol: string | null = null;

    for (let beat = 0; beat < beatsPerMeasure; beat++) {
      // Collect sounding pitch classes for this beat from ALL parts
      const soundingPcs = new Set<number>();

      for (const part of parts) {
        const partMeasure = part.measures[mi];
        if (!partMeasure) continue;

        for (const event of partMeasure.events) {
          if (event.type !== "note") continue;
          if (event.isRest) continue;
          const midi = event.midi;
          if (typeof midi !== "number") continue;

          const eventBeatStart = event.t / divisionsPerBeat;
          const eventBeatEnd = (event.t + event.dur) / divisionsPerBeat;

          if (eventBeatStart <= beat && beat < eventBeatEnd) {
            soundingPcs.add(((midi % 12) + 12) % 12);
          }
        }
      }

      if (soundingPcs.size === 0) continue;

      // Score each template
      let bestTemplate = templates[0]!;
      let bestScore = -Infinity;

      for (const template of templates) {
        const matched = template.pcs.filter((p) => soundingPcs.has(p)).length;
        const score = matched / template.pcs.length - template.priority * 0.04;
        if (score > bestScore) {
          bestScore = score;
          bestTemplate = template;
        }
      }

      const symbol = bestTemplate.symbol;
      if (symbol !== prevBeatSymbol) {
        out.push({ measure: measureNumber, t: beat, symbol });
        prevBeatSymbol = symbol;
      }
    }

    // If nothing was pushed for this measure, push tonic as fallback
    if (!out.length || out[out.length - 1]!.measure !== measureNumber) {
      out.push({ measure: measureNumber, t: 0, symbol: tonicSymbol });
    }
  }

  return out;
}
