// src/harmony/phraseDetect.ts

export type PhraseGenre = "classical_common_practice" | "hymn_chorale" | "worship_pop";

export type PhraseDetectOptions = {
  genre?: PhraseGenre;
  minBeatsPerPhrase?: number;
};

export type HarmonyBeatLike = {
  measureNumber: number;
  beatNumber: number;
  roman?: { roman?: string } | null;
  chord?: { pcs?: number[]; confidence?: number } | null;
};

export type CadenceLike = {
  atMeasure: number;
  type: string;
  confidence?: number;
  evidence?: { prevRoman?: string; lastRoman?: string };
};

export type PhraseBoundaryEvidence = {
  cadence?: { type: string; confidence: number };
  tonicArrival?: boolean;
  harmonicRhythmSlowdown?: boolean;
};

export type Phrase = {
  id: string;
  start: { measure: number; beat: number; index: number };
  end: { measure: number; beat: number; index: number };
  cadence?: { atMeasure: number; type: string; confidence: number };
  confidence: number; // 0..1
  evidence: PhraseBoundaryEvidence;
};

type Weights = {
  cadence: number;
  tonicArrival: number;
  slowdown: number;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function romanStr(b: HarmonyBeatLike): string {
  return String(b?.roman?.roman ?? "").trim();
}

function isTonicRoman(r: string): boolean {
  return r === "I" || r === "i";
}

function isCadenceStrong(type: string): boolean {
  // Treat these as stronger phrase ends by default
  return (
    type === "authentic_perfect" ||
    type === "authentic_imperfect" ||
    type === "half" ||
    type === "plagal" ||
    type === "deceptive"
  );
}

function defaultWeights(genre: PhraseGenre): Weights {
  // Priority 3 first: make it genre-adaptive, without killing classical behavior.
  if (genre === "worship_pop") {
    return { cadence: 0.55, tonicArrival: 0.25, slowdown: 0.20 };
  }
  if (genre === "hymn_chorale") {
    return { cadence: 0.65, tonicArrival: 0.20, slowdown: 0.15 };
  }
  return { cadence: 0.75, tonicArrival: 0.15, slowdown: 0.10 };
}

function beatIndexKey(measure: number, beat: number): string {
  return `${measure}:${beat}`;
}

function computeBeatIndices(beats: HarmonyBeatLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    map.set(beatIndexKey(b.measureNumber, b.beatNumber), i);
  }
  return map;
}

function computeHarmonicChangeFlags(beats: HarmonyBeatLike[]): boolean[] {
  // True when harmony content differs from previous beat (by roman string primarily, then pcs).
  const changed: boolean[] = new Array(beats.length).fill(false);

  for (let i = 0; i < beats.length; i++) {
    if (i === 0) {
      changed[i] = true;
      continue;
    }
    const a = beats[i - 1]!;
    const b = beats[i]!;
    const ra = romanStr(a);
    const rb = romanStr(b);

    if (ra && rb && ra !== rb) {
      changed[i] = true;
      continue;
    }

    const pa = (a.chord?.pcs ?? []).slice().sort((x, y) => x - y).join(",");
    const pb = (b.chord?.pcs ?? []).slice().sort((x, y) => x - y).join(",");
    changed[i] = pa !== pb;
  }

  return changed;
}

function rollingChangeRate(changed: boolean[], endIndex: number, window: number): number {
  const a = Math.max(0, endIndex - window + 1);
  const b = endIndex;
  const len = b - a + 1;
  if (len <= 0) return 0;

  let c = 0;
  for (let i = a; i <= b; i++) if (changed[i]) c++;
  return c / len;
}

function pickMinBeatsPerPhrase(genre: PhraseGenre, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) return Math.floor(override);
  if (genre === "worship_pop") return 8;
  if (genre === "hymn_chorale") return 8;
  return 8;
}

function findCadenceAtMeasure(cadences: CadenceLike[], atMeasure: number): CadenceLike | null {
  for (const c of cadences) {
    if (c.atMeasure === atMeasure) return c;
  }
  return null;
}

function cadenceScore(c: CadenceLike | null): number {
  if (!c) return 0;
  const conf = clamp01(typeof c.confidence === "number" ? c.confidence : 0.6);
  const strong = isCadenceStrong(String(c.type)) ? 1 : 0.6;
  return clamp01(conf * strong);
}

function tonicArrivalScore(prevBeat: HarmonyBeatLike | null, curBeat: HarmonyBeatLike): number {
  // Reward arrival on I/i, especially if previous beat was not tonic.
  const r = romanStr(curBeat);
  if (!isTonicRoman(r)) return 0;
  const prevR = prevBeat ? romanStr(prevBeat) : "";
  if (!prevBeat) return 0.6;
  if (!isTonicRoman(prevR)) return 1.0;
  return 0.4;
}

function slowdownScore(changeRatePrev: number, changeRateHere: number): number {
  // If the current window has fewer changes than the previous window, treat as slowdown.
  const delta = changeRatePrev - changeRateHere;
  if (delta <= 0) return 0;
  // scale: delta 0..0.6 -> score 0..1
  return clamp01(delta / 0.6);
}

function boundaryConfidence(e: PhraseBoundaryEvidence, w: Weights): number {
  const cCad = e.cadence ? clamp01(e.cadence.confidence) : 0;
  const cTon = e.tonicArrival ? 1 : 0;
  const cSlow = e.harmonicRhythmSlowdown ? 1 : 0;

  const sum = w.cadence + w.tonicArrival + w.slowdown;
  if (sum <= 0) return 0;

  return clamp01((cCad * w.cadence + cTon * w.tonicArrival + cSlow * w.slowdown) / sum);
}

function phraseId(n: number): string {
  return `P${String(n).padStart(3, "0")}`;
}

export function detectPhrasesFromHarmony(
  beats: HarmonyBeatLike[],
  cadences: CadenceLike[],
  key: { tonic?: string; mode?: string } | null,
  opts?: PhraseDetectOptions
): { phrases: Phrase[]; beatPhraseIds: Array<{ measure: number; beat: number; phraseId: string }> } {
  const genre: PhraseGenre = opts?.genre ?? "classical_common_practice";
  const weights = defaultWeights(genre);
  const minBeatsPerPhrase = pickMinBeatsPerPhrase(genre, opts?.minBeatsPerPhrase);

  if (!beats.length) return { phrases: [], beatPhraseIds: [] };

  const idxMap = computeBeatIndices(beats);
  const changed = computeHarmonicChangeFlags(beats);

  // Candidate boundaries: end of a measure that contains a cadence OR tonic arrival OR slowdown.
  // We'll evaluate per measure end, because cadences are measure-based in your engine right now.
  const lastIndex = beats.length - 1;
  const byMeasureEndIndex = new Map<number, number>();

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    // track the last beat index seen for each measure
    byMeasureEndIndex.set(b.measureNumber, i);
  }

  const measureNums = Array.from(byMeasureEndIndex.keys()).sort((a, b) => a - b);

  const boundaries: Array<{ endIndex: number; atMeasure: number; evidence: PhraseBoundaryEvidence; score: number }> = [];

  for (const m of measureNums) {
    const endIndex = byMeasureEndIndex.get(m);
    if (typeof endIndex !== "number") continue;

    const endBeat = beats[endIndex]!;
    const prevBeat = endIndex > 0 ? beats[endIndex - 1]! : null;

    const c = findCadenceAtMeasure(cadences, m);
    const cScore = cadenceScore(c);

    // tonic arrival: last beat in measure is I/i (common in hymn endings too)
    const tScore = tonicArrivalScore(prevBeat, endBeat);

    // slowdown: fewer harmony changes in last 4 beats vs previous 4 beats
    const rateHere = rollingChangeRate(changed, endIndex, 4);
    const ratePrev = rollingChangeRate(changed, Math.max(0, endIndex - 4), 4);
    const sScore = slowdownScore(ratePrev, rateHere);

    const evidence: PhraseBoundaryEvidence = {
      cadence: c
        ? { type: String(c.type), confidence: clamp01(typeof c.confidence === "number" ? c.confidence : 0.6) }
        : undefined,
      tonicArrival: tScore >= 0.8,
      harmonicRhythmSlowdown: sScore >= 0.5
    };

    const conf = boundaryConfidence(evidence, weights);

    // Keep boundary if there is meaningful evidence
    const hasAny = cScore > 0 || tScore > 0 || sScore > 0;
    if (!hasAny) continue;

    boundaries.push({ endIndex, atMeasure: m, evidence, score: conf });
  }

  // Always ensure last beat is a boundary.
  if (!boundaries.some((b) => b.endIndex === lastIndex)) {
    const lastBeat = beats[lastIndex]!;
    const c = findCadenceAtMeasure(cadences, lastBeat.measureNumber);
    const evidence: PhraseBoundaryEvidence = {
      cadence: c
        ? { type: String(c.type), confidence: clamp01(typeof c.confidence === "number" ? c.confidence : 0.6) }
        : undefined,
      tonicArrival: isTonicRoman(romanStr(lastBeat)),
      harmonicRhythmSlowdown: true
    };
    boundaries.push({
      endIndex: lastIndex,
      atMeasure: lastBeat.measureNumber,
      evidence,
      score: boundaryConfidence(evidence, weights)
    });
  }

  // Sort boundaries and enforce minimum phrase length.
  boundaries.sort((a, b) => a.endIndex - b.endIndex);

  const phrases: Phrase[] = [];
  const beatPhraseIds: Array<{ measure: number; beat: number; phraseId: string }> = [];

  let phraseStartIndex = 0;
  let phraseCount = 0;

  for (let bi = 0; bi < boundaries.length; bi++) {
    const bnd = boundaries[bi]!;
    const endIndex = bnd.endIndex;

    const span = endIndex - phraseStartIndex + 1;
    const isLast = endIndex === lastIndex;

    // If too short and not last, skip this boundary (merge forward).
    if (!isLast && span < minBeatsPerPhrase) continue;

    phraseCount++;
    const id = phraseId(phraseCount);

    const startBeat = beats[phraseStartIndex]!;
    const endBeat = beats[endIndex]!;

    const cadence = findCadenceAtMeasure(cadences, bnd.atMeasure);
    const cadenceObj = cadence
      ? { atMeasure: cadence.atMeasure, type: String(cadence.type), confidence: clamp01(cadence.confidence ?? 0.6) }
      : undefined;

    const phrase: Phrase = {
      id,
      start: { measure: startBeat.measureNumber, beat: startBeat.beatNumber, index: phraseStartIndex },
      end: { measure: endBeat.measureNumber, beat: endBeat.beatNumber, index: endIndex },
      cadence: cadenceObj,
      confidence: clamp01(bnd.score),
      evidence: bnd.evidence
    };

    phrases.push(phrase);

    for (let i = phraseStartIndex; i <= endIndex; i++) {
      const bb = beats[i]!;
      beatPhraseIds.push({ measure: bb.measureNumber, beat: bb.beatNumber, phraseId: id });
    }

    phraseStartIndex = endIndex + 1;
    if (phraseStartIndex > lastIndex) break;
  }

  // If we never emitted a phrase, make one covering everything.
  if (!phrases.length) {
    const id = phraseId(1);
    const startBeat = beats[0]!;
    const endBeat = beats[lastIndex]!;
    phrases.push({
      id,
      start: { measure: startBeat.measureNumber, beat: startBeat.beatNumber, index: 0 },
      end: { measure: endBeat.measureNumber, beat: endBeat.beatNumber, index: lastIndex },
      confidence: 0.35,
      evidence: { harmonicRhythmSlowdown: true }
    });
    for (let i = 0; i <= lastIndex; i++) {
      const bb = beats[i]!;
      beatPhraseIds.push({ measure: bb.measureNumber, beat: bb.beatNumber, phraseId: id });
    }
  }

  return { phrases, beatPhraseIds };
}