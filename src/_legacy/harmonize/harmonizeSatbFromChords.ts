// src/harmonize/harmonizeSatbFromChords.ts
import type { ScoreModel } from "../score/types";
import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";

type ChordEvent = {
  measure: number;
  t: number;
  symbol: string; // e.g. "C", "F", "G7", "Am", "Dm7", "C/E"
};

type HarmonizeOptions = {
  keepMelodyInSoprano?: boolean;
  forceRootInBass?: boolean; // default true
};

type HarmonizeRequest = {
  scoreModel: ScoreModel;
  chords: ChordEvent[];
  options?: HarmonizeOptions;
};

type VoiceName = "Soprano" | "Alto" | "Tenor" | "Bass";

type Range = { min: number; max: number };

const RANGES: Record<VoiceName, Range> = {
  // Sounding ranges (MIDI)
  Soprano: { min: 60, max: 81 }, // C4..A5
  Alto: { min: 55, max: 74 }, // G3..D5
  Tenor: { min: 48, max: 69 }, // C3..A4 (notated treble-8vb elsewhere)
  Bass: { min: 40, max: 64 } // E2..E4
};

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function clampInt(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

const STEP_TO_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

function parseRootToken(tok: string): number | null {
  const m = tok.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return null;
  if (acc === "#") return (base + 1) % 12;
  if (acc === "b") return (base + 11) % 12;
  return base;
}

function chordPcsFromSymbol(symbol: string): { rootPc: number; pcs: number[]; bassPcPref: number | null } | null {
  const s = symbol.trim();

  let main = s;
  let slashBass: string | null = null;
  if (s.includes("/")) {
    const parts = s.split("/");
    main = (parts[0] ?? "").trim();
    slashBass = (parts[1] ?? "").trim();
  }

  const m = main.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!m) return null;

  const rootTok = m[1]!;
  const qualTok = (m[2] ?? "").trim().toLowerCase();

  const rootPc = parseRootToken(rootTok);
  if (rootPc === null) return null;

  const isMinor =
    qualTok === "m" ||
    qualTok === "min" ||
    qualTok.startsWith("m7") ||
    qualTok.startsWith("min7");

  const isMaj7 = qualTok === "maj7";
  const isMin7 = qualTok === "m7" || qualTok === "min7";
  const is7 = qualTok === "7" || (!isMaj7 && qualTok.endsWith("7"));

  // Triad base
  const third = isMinor ? 3 : 4;
  const fifth = 7;
  const pcs: number[] = [rootPc, (rootPc + third) % 12, (rootPc + fifth) % 12];

  // Sevenths
  if (isMaj7) pcs.push((rootPc + 11) % 12);
  else if (is7 || isMin7) pcs.push((rootPc + 10) % 12);

  const bassPcPref = slashBass ? parseRootToken(slashBass) : null;

  return { rootPc, pcs: Array.from(new Set(pcs)), bassPcPref };
}

function midiCandidatesForPcInRange(pitchClass: number, range: Range): number[] {
  const out: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (pc(m) === pitchClass) out.push(m);
  }
  return out;
}

function bestByPenalty(cands: number[], penalty: (m: number) => number): number | null {
  if (!cands.length) return null;
  let best = cands[0]!;
  let bestP = penalty(best);
  for (let i = 1; i < cands.length; i++) {
    const m = cands[i]!;
    const p = penalty(m);
    if (p < bestP) {
      bestP = p;
      best = m;
    }
  }
  return best;
}

function chooseVoiceNote(params: {
  chordPcs: number[];
  targetMidi: number;
  range: Range;
  belowMidi?: number;
  aboveMidi?: number;
  preferPc?: number | null;
  restrictToPreferPc?: boolean;
}): number | null {
  const { chordPcs, targetMidi, range, belowMidi, aboveMidi, preferPc, restrictToPreferPc } = params;

  // If we must lock to a specific pitch-class (e.g., bass root), do it.
  if (restrictToPreferPc && preferPc !== null && preferPc !== undefined) {
    const only = midiCandidatesForPcInRange(preferPc, range).filter((m) => {
      if (belowMidi !== undefined && m >= belowMidi) return false;
      if (aboveMidi !== undefined && m <= aboveMidi) return false;
      return true;
    });

    if (only.length) {
      const mid = (range.min + range.max) / 2;
      return bestByPenalty(only, (m) => {
        const dist = Math.abs(m - targetMidi);
        const center = Math.abs(m - mid) * 0.12;
        return dist + center;
      });
    }
    // If no candidates exist, fall through to normal selection.
  }

  let pcs = chordPcs.slice();
  if (preferPc !== null && preferPc !== undefined && pcs.includes(preferPc)) {
    pcs = [preferPc, ...pcs.filter((x) => x !== preferPc)];
  }

  const allCands: number[] = [];
  for (const p of pcs) allCands.push(...midiCandidatesForPcInRange(p, range));

  const filtered = allCands.filter((m) => {
    if (belowMidi !== undefined && m >= belowMidi) return false;
    if (aboveMidi !== undefined && m <= aboveMidi) return false;
    return true;
  });

  if (!filtered.length) return null;

  const mid = (range.min + range.max) / 2;
  return bestByPenalty(filtered, (m) => {
    const dist = Math.abs(m - targetMidi);
    const center = Math.abs(m - mid) * 0.12;

    // Stronger preference than before, but not infinite.
    const prefer =
      preferPc !== null && preferPc !== undefined && pc(m) === preferPc ? -2.0 : 0;

    return dist + center + prefer;
  });
}

function getScoreBeatsPerMeasure(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const beats = m0?.attributes?.time?.beats;
  if (typeof beats === "number" && beats > 0) return beats;
  return 4;
}

function buildChordMap(chords: ChordEvent[]): Map<string, ChordEvent> {
  const map = new Map<string, ChordEvent>();
  for (const c of chords) map.set(`${c.measure}:${c.t}`, c);
  return map;
}

function getSopranoSource(score: ScoreModel): { partIndex: number; part: any } | null {
  const parts = score.parts ?? [];
  for (let i = 0; i < parts.length; i++) {
    const name = String(parts[i]?.name ?? "").toLowerCase();
    if (name.includes("soprano")) return { partIndex: i, part: parts[i] };
  }
  if (parts[0]) return { partIndex: 0, part: parts[0] };
  return null;
}

function makeEmptyPart(part_id: string, name: string, measuresTemplate: any[]): any {
  return {
    part_id,
    name,
    measures: measuresTemplate.map((m) => ({
      number: m.number,
      attributes: m.attributes ? { ...m.attributes } : undefined,
      events: []
    }))
  };
}

function ensureMeasureAttributesOnlyOnFirst(part: any): void {
  const ms = part.measures ?? [];
  for (let i = 0; i < ms.length; i++) {
    if (i === 0) continue;
    if (ms[i]?.attributes) delete ms[i].attributes;
  }
}

function addNoteEvent(measure: any, t: number, dur: number, midi: number): void {
  measure.events.push({
    type: "note",
    t,
    dur,
    pitch: midiToPitch(midi),
    midi
  });
}

function addRestEvent(measure: any, t: number, dur: number): void {
  measure.events.push({
    type: "rest",
    t,
    dur
  });
}

function pcsMissing(chordPcs: number[], soprMidi: number, altoMidi: number | null, tenorMidi: number | null, bassMidi: number): number[] {
  const present = new Set<number>([pc(soprMidi), pc(bassMidi)]);
  if (altoMidi !== null) present.add(pc(altoMidi));
  if (tenorMidi !== null) present.add(pc(tenorMidi));

  const missing = chordPcs.filter((p) => !present.has(p));
  return missing;
}

export function harmonizeSatbFromChords(req: HarmonizeRequest): { ok: true; scoreModel: ScoreModel } {
  const options: HarmonizeOptions = req.options ?? {};
  const keepMelody = options.keepMelodyInSoprano !== false;
  const forceRootInBass = options.forceRootInBass !== false;

  const inScore = req.scoreModel;
  const beatsPerMeasure = getScoreBeatsPerMeasure(inScore);

  const soprSrc = getSopranoSource(inScore);
  if (!soprSrc) {
    return {
      ok: true,
      scoreModel: {
        ...(inScore as any),
        meta: { ...(inScore.meta ?? {}), ensemble: "satb" },
        parts: []
      } as ScoreModel
    };
  }

  const soprPart = soprSrc.part;
  const measuresTemplate = (soprPart.measures ?? []).map((m: any) => ({
    number: m.number,
    attributes: m.attributes ? { ...m.attributes } : undefined
  }));

  const outS = makeEmptyPart("P_S", "Soprano", measuresTemplate);
  const outA = makeEmptyPart("P_A", "Alto", measuresTemplate);
  const outT = makeEmptyPart("P_T", "Tenor", measuresTemplate);
  const outB = makeEmptyPart("P_B", "Bass", measuresTemplate);

  const chordMap = buildChordMap(req.chords ?? []);

  // Carry melody from input soprano if requested
  if (keepMelody) {
    for (let mi = 0; mi < measuresTemplate.length; mi++) {
      const srcM = soprPart.measures?.[mi];
      const dstM = outS.measures?.[mi];
      if (!dstM) continue;
      const srcEvents = (srcM?.events ?? []).filter((e: any) => e?.type === "note" || e?.type === "rest");
      for (const e of srcEvents) dstM.events.push({ ...e });
    }
  }

  // Voice-leading state
  let prevA: number | null = null;
  let prevT: number | null = null;
  let prevB: number | null = null;

  for (let mi = 0; mi < measuresTemplate.length; mi++) {
    const measureNumber = measuresTemplate[mi]?.number ?? mi + 1;

    const mS = outS.measures?.[mi];
    const mA = outA.measures?.[mi];
    const mT = outT.measures?.[mi];
    const mB = outB.measures?.[mi];

    if (!mS || !mA || !mT || !mB) continue;

    const chordEv = chordMap.get(`${measureNumber}:0`);
    const parsed = chordEv ? chordPcsFromSymbol(chordEv.symbol) : null;

    if (!parsed) {
      for (let t = 0; t < beatsPerMeasure; t++) {
        addRestEvent(mA, t, 1);
        addRestEvent(mT, t, 1);
        addRestEvent(mB, t, 1);
      }
      continue;
    }

    const chordPcs = parsed.pcs;
    const rootPc = parsed.rootPc;

    // Bass preference:
    // - if slash is given, lock to it
    // - else if forceRootInBass, lock to root
    // - else allow any chord tone with a weak preference for root
    const bassPcPref = parsed.bassPcPref !== null ? parsed.bassPcPref : rootPc;
    const lockBassToPref = parsed.bassPcPref !== null || forceRootInBass;

    for (let t = 0; t < beatsPerMeasure; t++) {
      let soprMidi: number | null = null;
      const sEv = (mS.events ?? []).find((e: any) => e?.type === "note" && Number(e.t) === t);
      if (sEv?.midi !== undefined) soprMidi = Number(sEv.midi);

      if (soprMidi === null) {
        addRestEvent(mA, t, 1);
        addRestEvent(mT, t, 1);
        addRestEvent(mB, t, 1);
        continue;
      }

      // ---- BASS (LOCK TO ROOT/SLASH IF REQUESTED) ----
      const bassTarget = prevB ?? 48; // around C3
      const bassMidi =
        chooseVoiceNote({
          chordPcs,
          targetMidi: bassTarget,
          range: RANGES.Bass,
          belowMidi: soprMidi,
          preferPc: bassPcPref,
          restrictToPreferPc: lockBassToPref
        }) ??
        // fallback: allow any chord tone if lock had no candidate
        chooseVoiceNote({
          chordPcs,
          targetMidi: bassTarget,
          range: RANGES.Bass,
          belowMidi: soprMidi,
          preferPc: bassPcPref,
          restrictToPreferPc: false
        });

      if (bassMidi === null) {
        addRestEvent(mA, t, 1);
        addRestEvent(mT, t, 1);
        addRestEvent(mB, t, 1);
        continue;
      }

      // Targets: keep upper voices closer + within spacing rules
      const altoCeil = soprMidi - 1;
      const altoMinFromS = soprMidi - 12; // S–A <= 12
      const tenorMinFromA = (a: number) => a - 12; // A–T <= 12
      const tenorMaxFromA = (a: number) => a - 1;

      // Tenor must be above bass
      const tenorLow = bassMidi + 1;

      // Start with a reasonable alto target near soprano
      const altoTarget = prevA ?? clampInt(soprMidi - 3, RANGES.Alto.min, RANGES.Alto.max);

      // Start with a reasonable tenor target between bass and alto
      const tenorTargetBase = prevT ?? clampInt(altoTarget - 7, RANGES.Tenor.min, RANGES.Tenor.max);

      // ---- FIRST PASS: choose Alto (tight to soprano) ----
      let altoMidi =
        chooseVoiceNote({
          chordPcs,
          targetMidi: altoTarget,
          range: RANGES.Alto,
          aboveMidi: Math.max(tenorLow, altoMinFromS),
          belowMidi: altoCeil,
          preferPc: null,
          restrictToPreferPc: false
        }) ?? null;

      // If alto failed, relax slightly but still keep under soprano
      if (altoMidi === null) {
        altoMidi =
          chooseVoiceNote({
            chordPcs,
            targetMidi: clampInt(soprMidi - 6, RANGES.Alto.min, RANGES.Alto.max),
            range: RANGES.Alto,
            aboveMidi: tenorLow,
            belowMidi: altoCeil,
            preferPc: null,
            restrictToPreferPc: false
          }) ?? null;
      }

      // ---- SECOND PASS: choose Tenor based on Alto (keep A–T <= 12) ----
      let tenorMidi: number | null = null;
      if (altoMidi !== null) {
        tenorMidi =
          chooseVoiceNote({
            chordPcs,
            targetMidi: tenorTargetBase,
            range: RANGES.Tenor,
            aboveMidi: tenorLow,
            belowMidi: tenorMaxFromA(altoMidi),
            preferPc: null,
            restrictToPreferPc: false
          }) ?? null;

        // If tenor too low vs alto spacing, try closer
        if (tenorMidi === null) {
          tenorMidi =
            chooseVoiceNote({
              chordPcs,
              targetMidi: clampInt(altoMidi - 5, RANGES.Tenor.min, RANGES.Tenor.max),
              range: RANGES.Tenor,
              aboveMidi: tenorLow,
              belowMidi: tenorMaxFromA(altoMidi),
              preferPc: null,
              restrictToPreferPc: false
            }) ?? null;
        }
      }

      // ---- CHORD COMPLETENESS: try to cover missing chord tones ----
      // If Alto or Tenor exists, try to steer them toward missing pcs.
      const missing1 = pcsMissing(chordPcs, soprMidi, altoMidi, tenorMidi, bassMidi);

      if (altoMidi !== null && missing1.length > 0) {
        // Try to retarget alto to a missing chord tone (still within spacing)
        const prefer = missing1[0]!;
        const alt2 =
          chooseVoiceNote({
            chordPcs,
            targetMidi: altoMidi,
            range: RANGES.Alto,
            aboveMidi: Math.max(tenorLow, altoMinFromS),
            belowMidi: altoCeil,
            preferPc: prefer,
            restrictToPreferPc: false
          }) ?? null;
        if (alt2 !== null) altoMidi = alt2;
      }

      const missing2 = pcsMissing(chordPcs, soprMidi, altoMidi, tenorMidi, bassMidi);

      if (altoMidi !== null && missing2.length > 0) {
        // Try to retarget tenor to a missing tone (respect A–T spacing)
        const prefer = missing2[0]!;
        const ten2 =
          chooseVoiceNote({
            chordPcs,
            targetMidi: tenorMidi ?? tenorTargetBase,
            range: RANGES.Tenor,
            aboveMidi: tenorLow,
            belowMidi: tenorMaxFromA(altoMidi),
            preferPc: prefer,
            restrictToPreferPc: false
          }) ?? null;
        if (ten2 !== null) tenorMidi = ten2;
      }

      // Final safety: if Alto exists enforce S–A <= 12
      if (altoMidi !== null && soprMidi - altoMidi > 12) {
        // push alto up
        const alt3 =
          chooseVoiceNote({
            chordPcs,
            targetMidi: soprMidi - 4,
            range: RANGES.Alto,
            aboveMidi: tenorLow,
            belowMidi: altoCeil,
            preferPc: null,
            restrictToPreferPc: false
          }) ?? null;
        if (alt3 !== null) altoMidi = alt3;
      }

      // Write events
      if (altoMidi === null) addRestEvent(mA, t, 1);
      else addNoteEvent(mA, t, 1, altoMidi);

      if (tenorMidi === null) addRestEvent(mT, t, 1);
      else addNoteEvent(mT, t, 1, tenorMidi);

      addNoteEvent(mB, t, 1, bassMidi);

      prevA = altoMidi ?? prevA;
      prevT = tenorMidi ?? prevT;
      prevB = bassMidi;
    }
  }

  ensureMeasureAttributesOnlyOnFirst(outS);
  ensureMeasureAttributesOnlyOnFirst(outA);
  ensureMeasureAttributesOnlyOnFirst(outT);
  ensureMeasureAttributesOnlyOnFirst(outB);

  // Preserve required ScoreModel fields by spreading inScore first
  const out: ScoreModel = {
    ...(inScore as any),
    meta: {
      ...(inScore.meta ?? {}),
      ensemble: "satb",
      harmonize: {
        mode: "satb_from_chords",
        version: "0.3",
        note: "Locks bass to chord root (or slash), improves spacing, and prefers missing chord tones."
      }
    } as any,
    parts: [outS, outA, outT, outB]
  };

  return { ok: true, scoreModel: out };
}