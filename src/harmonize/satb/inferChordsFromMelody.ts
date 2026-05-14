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

function getKeyMode(score: ScoreModel): "major" | "minor" {
  const m0 = score.parts?.[0]?.measures?.[0];
  const raw = String(m0?.attributes?.key_mode ?? "").toLowerCase();
  if (raw === "minor") return "minor";
  return "major";
}

function minorScalePcs(tonicPc: number): number[] {
  // Natural minor: [0,2,3,5,7,8,10]
  return [0, 2, 3, 5, 7, 8, 10].map((x) => (tonicPc + x) % 12);
}

// Build diatonic triads in minor (using harmonic minor for degree V = major dominant)
function buildDiatonicTriadsMinor(tonicPc: number): DiatonicTriad[] {
  const scale = minorScalePcs(tonicPc);

  //            i    ii°  III  iv   V    VI   VII
  const thirds = [3, 3,   4,   3,   4,   4,   4];  // m3 or M3
  const fifths  = [7, 6,   7,   7,   7,   7,   7];  // P5 or d5
  const suf     = ["m", "dim", "", "m", "", "", ""];

  const out: DiatonicTriad[] = [];
  for (let d = 1 as 1|2|3|4|5|6|7; d <= 7; d = (d + 1) as any) {
    const r = scale[d - 1]!;
    // Degree 5: harmonic minor raises the 7th → major third on V
    const thirdPc = d === 5 ? (r + 4) % 12 : (r + thirds[d - 1]!) % 12;
    const fifthPc  = (r + fifths[d - 1]!) % 12;
    out.push({
      degree: d,
      rootPc: r,
      pcs: [r, thirdPc, fifthPc],
      symbol: pcName(r) + suf[d - 1]!
    });
  }
  return out;
}

function progressionPenaltyMinor(prevDeg: number | null, nextDeg: number): number {
  if (prevDeg === null) return 0;

  // Common functional progressions in minor
  const goodPairs = new Set<string>([
    "1->4", "1->5", "1->6",   // i→iv, i→V, i→VI
    "4->5", "4->1",            // iv→V, iv→i (plagal)
    "5->1", "5->6",            // V→i, V→VI (deceptive)
    "6->2", "6->5",            // VI→ii°, VI→V
    "2->5",                    // ii°→V
    "3->6", "3->7",            // III→VI, III→VII
    "7->3",                    // VII→III
  ]);

  if (prevDeg === nextDeg) return 2;
  if (goodPairs.has(`${prevDeg}->${nextDeg}`)) return 0;
  return 4;
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

// ── Hindemith Craft of Musical Composition, Ch. IV §4, p. 122: root-progression quality ─────
// "A progression based on the interval of a fifth... is the strongest of all chord-progressions.
//  [After fourth, third, second.]  The experience we have had with Series 2 teaches us that a
//  chord-progression based on a root-progression of a tritone will be the least valuable of all."
// Returns true when the pitch-class distance between two chord roots equals exactly 6 semitones.
function rootMotionIsTritone(
  prevDeg: number | null,
  nextDeg: number,
  triads: DiatonicTriad[]
): boolean {
  if (prevDeg === null) return false;
  const prevTriad = triads.find((t) => t.degree === prevDeg);
  const nextTriad = triads.find((t) => t.degree === nextDeg);
  if (!prevTriad || !nextTriad) return false;
  const diff = Math.abs(prevTriad.rootPc - nextTriad.rootPc);
  // Pitch-class distance is always measured in [0, 6] (fold at 6, since tritone = 6 = its own inverse)
  const pcDist = diff > 6 ? 12 - diff : diff;
  return pcDist === 6;
}

// ── Piston Harmony Ch. 5, p. 48: strong vs. weak progressions ─────────────────────────────
// "Progressions with root moving by fourth, fifth, or second are strong progressions."
// "A progression with root moving up a third is a weak progression."
// Returns the root interval class: "strong" (4th/5th/2nd), "weak" (3rd up), or "neutral".
function progressionStrength(
  fromDeg: number,
  toDeg: number,
  scaleLen: number = 7
): "strong" | "weak" | "neutral" {
  // Interval in scale steps (mod 7, 1-based degrees)
  const interval = ((toDeg - fromDeg + scaleLen) % scaleLen) as number; // 0..6
  // Up by 2nd (1 step) or 4th (3 steps) or 5th (4 steps): strong
  if (interval === 1 || interval === 3 || interval === 4) return "strong";
  // Up by 3rd (2 steps): weak
  if (interval === 2) return "weak";
  // Down by 3rd (5 steps up = 2 down): neutral-ish (Piston: "not definitely either")
  return "neutral";
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
  const mode   = getKeyMode(inScore);
  const tonic  = mode === "minor"
    ? tonicPcFromFifthsMinor(fifths)
    : tonicPcFromFifthsMajor(fifths);
  const triads = mode === "minor"
    ? buildDiatonicTriadsMinor(tonic)
    : buildDiatonicTriadsMajor(tonic);

  // Choose the mode-appropriate progression penalty function
  const progressionPen = mode === "minor"
    ? progressionPenaltyMinor
    : progressionPenalty;

  const lastMeasureNumber = Number(measures[measures.length - 1]?.number ?? measures.length);

  const out: ChordEvent[] = [];
  let prevDeg: number | null = null;

  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const measureNumber = Number(m?.number ?? (i + 1));

    const isLast = measureNumber === lastMeasureNumber;
    const isPenult = measureNumber === lastMeasureNumber - 1;

    if (isLast) {
      out.push({ measure: measureNumber, t: 0, symbol: triads[0]!.symbol }); // I / i
      prevDeg = 1;
      continue;
    }

    if (isPenult) {
      const V = triads.find((t) => t.degree === 5)!;
      // In minor, V is already the harmonic-minor major chord; append "7" for V7
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

    // Relative position in the freely-chosen portion of the piece.
    // The last 2 measures are forced (V, I), so inner measures run 0..measures.length-3.
    const innerLen = Math.max(1, measures.length - 2);
    const relPos = i / innerLen; // 0 = first inner measure, 1 = last inner measure

    for (const c of candidates.length ? candidates : triads) {
      let score = progressionPen(prevDeg, c.degree) + (c.degree === 7 ? 3 : 0);

      // ── Piston Harmony Ch. 12, p. 132: deceptive cadence V→VI ───────────────
      // "By far the most frequent alternative to V-I is V-VI."
      // "The use of a deceptive cadence near the end of a piece helps to sustain
      //  the musical interest at the moment when the final authentic cadence is
      //  expected."
      // The problem: V→vi is in goodPairs (score 0) but so is V→I, and since I
      // appears first in the sorted candidates list it always wins the tie.
      // Fix: give vi a score bonus in the second half of inner measures so it
      // is genuinely preferred once per phrase over the routine V→I resolution.
      if (prevDeg === 5 && c.degree === 6 && relPos >= 0.5) {
        score -= 1.5; // vi beats I (score 0) when the melody supports it
      }

      // ── Piston Harmony Ch. 5, p. 48: strong progressions on downbeats ───────
      // Penalise weak progressions (root moves up a diatonic 3rd) very mildly —
      // they sound fine but are less decisive. This nudges the algorithm toward
      // "strong" root motion (4th/5th/2nd) more often than the algorithm's bare
      // pref() ordering does, without forbidding weak progressions outright.
      if (prevDeg !== null) {
        const strength = progressionStrength(prevDeg, c.degree);
        if (strength === "weak") score += 0.5;
      }

      // ── Hindemith Craft of Musical Composition, Ch. IV §4, p. 122: tritone root-motion ───
      // "A chord-progression based on a root-progression of a tritone will be the least
      //  valuable of all."  The tritone between roots (6 semitones in pitch-class space)
      //  creates harmonic ambiguity and is ranked below even weak progressions.
      if (rootMotionIsTritone(prevDeg, c.degree, triads)) {
        score += 3; // equal to viidim penalty: both represent maximum harmonic instability
      }

      // ── Hindemith Craft of Musical Composition, Ch. IV §3, p. 115: opening stability ─────
      // "The first and last of these harmonies… are the best and most satisfying."
      // Harmonic fluctuation should begin with stable chords (Group I): degree 7 (viidim)
      // is the most tense diatonic chord and is inappropriate as an opening harmony.
      // Already penalised +3 above; add an extra +2 for the first two inner measures.
      if (i <= 1 && c.degree === 7) {
        score += 2;
      }

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

    // Secondary dominant V/V: bare major triad on scale[1] (degree II, raised 3rd)
    // e.g. in C major: D major (D, F#, A); in E major: F# major (F#, A#, C#)
    const vofvRoot = scale[1]!;
    const vofvThird = (vofvRoot + 4) % 12;  // raised 3rd (chromatic)
    const vofvFifth = (vofvRoot + 7) % 12;
    templates.push({
      symbol: pcName(vofvRoot),           // triad only — no 7th suffix
      rootPc: vofvRoot,
      pcs: [vofvRoot, vofvThird, vofvFifth],
      priority: 7
    });
    // V/V with dominant 7th as well
    templates.push({
      symbol: pcName(vofvRoot) + "7",
      rootPc: vofvRoot,
      pcs: [vofvRoot, vofvThird, vofvFifth, (vofvRoot + 10) % 12],
      priority: 8
    });

    // Secondary dominant V/ii: bare major triad on scale[5] (raised 3rd)
    // e.g. in C major: A major (A, C#, E); in E major: C# major (C#, E#, G#)
    const vofiiRoot = scale[5]!;
    const vofiiThird = (vofiiRoot + 4) % 12;
    const vofiiFifth = (vofiiRoot + 7) % 12;
    templates.push({
      symbol: pcName(vofiiRoot),
      rootPc: vofiiRoot,
      pcs: [vofiiRoot, vofiiThird, vofiiFifth],
      priority: 8
    });
    templates.push({
      symbol: pcName(vofiiRoot) + "7",
      rootPc: vofiiRoot,
      pcs: [vofiiRoot, vofiiThird, vofiiFifth, (vofiiRoot + 10) % 12],
      priority: 9
    });

    // bVII: borrowed subtonic major triad from parallel Mixolydian
    // e.g. in C major: Bb major (Bb, D, F); in E major: D major (D, F#, A)
    const bviiRoot = (tonicPc + 10) % 12;
    templates.push({
      symbol: pcName(bviiRoot),
      rootPc: bviiRoot,
      pcs: [bviiRoot, (bviiRoot + 4) % 12, (bviiRoot + 7) % 12],
      priority: 9
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
