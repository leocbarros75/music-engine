// src/arrange/mapToPercussion.ts

import type { ScoreModel } from "../score/types";
import { extractOnsetChords } from "../analyze/chordExtractor";

type PercStyle = "swing" | "bossa" | "ballad";

export type PercussionOptions = {
  style?: PercStyle;

  // Groove density controls
  enableSwingSkip?: boolean; // ride skip ("ding-ding-da-ding" feel)
  includeSnareBackbeat?: boolean; // light snare on 2 and 4
  includeHiHatBackbeat?: boolean; // closed hat on 2 and 4

  // If true, add a light kick on chord onsets (only when they are not too dense)
  kickOnChordOnsets?: boolean;

  // Short hit duration: hitDur = divisions / hitDurFraction
  hitDurFraction?: number; // default 8 -> 480/8 = 60 ticks

  // Orchestral colors
  enableTimpani?: boolean; // add a pitched timpani part
  enableSuspendedCymbal?: boolean; // add suspended cymbal (unpitched) events
  enableMallets?: boolean; // add mallets (unpitched) hits
  enableBells?: boolean; // add bells (unpitched) hits
  enableChimes?: boolean; // add chimes (unpitched) hits

  // Suspended cymbal behavior
  susCymbalMode?: "hit" | "roll"; // default roll for ballad, hit for swing/bossa
  susCymbalRollWholeBar?: boolean; // if true, roll spans the bar
};

type ResolvedPercOptions = Required<PercussionOptions>;

const DEFAULTS_BY_STYLE: Record<PercStyle, ResolvedPercOptions> = {
  swing: {
    style: "swing",
    enableSwingSkip: true,
    includeSnareBackbeat: false,
    includeHiHatBackbeat: true,
    kickOnChordOnsets: true,
    hitDurFraction: 8,

    enableTimpani: true,
    enableSuspendedCymbal: true,
    enableMallets: true,
    enableBells: true,
    enableChimes: true,

    susCymbalMode: "hit",
    susCymbalRollWholeBar: false
  },
  bossa: {
    style: "bossa",
    enableSwingSkip: false,
    includeSnareBackbeat: true,
    includeHiHatBackbeat: true,
    kickOnChordOnsets: true,
    hitDurFraction: 8,

    enableTimpani: true,
    enableSuspendedCymbal: true,
    enableMallets: true,
    enableBells: true,
    enableChimes: true,

    susCymbalMode: "hit",
    susCymbalRollWholeBar: false
  },
  ballad: {
    style: "ballad",
    enableSwingSkip: false,
    includeSnareBackbeat: false,
    includeHiHatBackbeat: false,
    kickOnChordOnsets: false,
    hitDurFraction: 8,

    enableTimpani: true,
    enableSuspendedCymbal: true,
    enableMallets: true,
    enableBells: true,
    enableChimes: true,

    susCymbalMode: "roll",
    susCymbalRollWholeBar: true
  }
};

function resolveOptions(opts?: PercussionOptions): ResolvedPercOptions {
  const style: PercStyle = opts?.style ?? "swing";
  const base = DEFAULTS_BY_STYLE[style];

  return {
    style,
    enableSwingSkip: opts?.enableSwingSkip ?? base.enableSwingSkip,
    includeSnareBackbeat: opts?.includeSnareBackbeat ?? base.includeSnareBackbeat,
    includeHiHatBackbeat: opts?.includeHiHatBackbeat ?? base.includeHiHatBackbeat,
    kickOnChordOnsets: opts?.kickOnChordOnsets ?? base.kickOnChordOnsets,
    hitDurFraction: opts?.hitDurFraction ?? base.hitDurFraction,

    enableTimpani: opts?.enableTimpani ?? base.enableTimpani,
    enableSuspendedCymbal: opts?.enableSuspendedCymbal ?? base.enableSuspendedCymbal,
    enableMallets: opts?.enableMallets ?? base.enableMallets,
    enableBells: opts?.enableBells ?? base.enableBells,
    enableChimes: opts?.enableChimes ?? base.enableChimes,

    susCymbalMode: opts?.susCymbalMode ?? base.susCymbalMode,
    susCymbalRollWholeBar: opts?.susCymbalRollWholeBar ?? base.susCymbalRollWholeBar
  };
}

function makePart(part_id: string, name: string, instrument: string, staves = 1) {
  return { part_id, name, instrument, staves, measures: [] as any[] };
}

function cloneMeasureShell(m: any) {
  return { number: m.number, attributes: { ...m.attributes }, events: [] as any[] };
}

function addUnpitched(
  measure: any,
  t: number,
  dur: number,
  instrumentId: string,
  voice = 1,
  staff = 1
) {
  const id = `UP_${measure.number}_${t}_${voice}_${staff}_${instrumentId}_${Math.random().toString(16).slice(2, 10)}`;
  measure.events.push({ id, t, dur, type: "unpitched", instrumentId, voice, staff });
}

function addPitched(
  measure: any,
  t: number,
  dur: number,
  pitch: { step: string; alter?: number; octave: number },
  voice = 1,
  staff = 1
) {
  const id = `NOTE_${measure.number}_${t}_${voice}_${staff}_${pitch.step}${pitch.alter ?? 0}${pitch.octave}_${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  measure.events.push({ id, t, dur, type: "note", pitch, voice, staff });
}

function addRest(measure: any, t: number, dur: number, voice: number, staff = 1) {
  const id = `REST_${measure.number}_${t}_${voice}_${staff}_${Math.random().toString(16).slice(2, 10)}`;
  measure.events.push({ id, t, dur, type: "rest", voice, staff });
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function writeDrumsSwing(measure: any, divisions: number, beats: number, opt: ResolvedPercOptions) {
  const beatDur = divisions;
  const barDur = beats * beatDur;
  const hitDur = Math.max(Math.floor(divisions / opt.hitDurFraction), 1);

  // Ride on each beat (quarters)
  for (let b = 0; b < beats; b++) {
    addUnpitched(measure, b * beatDur, hitDur, "ride", 1, 1);
  }

  // Optional skip (triplet-ish placement): 2/3 of a beat after beat 1 and 3
  if (opt.enableSwingSkip) {
    const swingOffset = Math.round((2 * beatDur) / 3);

    // after beat 1
    const t1 = 0 + swingOffset;
    if (t1 > 0 && t1 < barDur) addUnpitched(measure, t1, hitDur, "ride", 1, 1);

    // after beat 3 (in 4/4: beat index 2)
    if (beats >= 3) {
      const t3 = 2 * beatDur + swingOffset;
      if (t3 > 0 && t3 < barDur) addUnpitched(measure, t3, hitDur, "ride", 1, 1);
    }
  }

  // Backbeat hats and/or snare on 2 and 4
  if (opt.includeHiHatBackbeat) {
    if (beats >= 2) addUnpitched(measure, 1 * beatDur, hitDur, "hihat", 1, 1);
    if (beats >= 4) addUnpitched(measure, 3 * beatDur, hitDur, "hihat", 1, 1);
  }

  if (opt.includeSnareBackbeat) {
    if (beats >= 2) addUnpitched(measure, 1 * beatDur, hitDur, "snare", 1, 1);
    if (beats >= 4) addUnpitched(measure, 3 * beatDur, hitDur, "snare", 1, 1);
  }

  // Light kick on 1
  addUnpitched(measure, 0, hitDur, "kick", 1, 1);
}

function writeDrumsBossa(measure: any, divisions: number, beats: number, opt: ResolvedPercOptions) {
  const beatDur = divisions;
  const barDur = beats * beatDur;
  const hitDur = Math.max(Math.floor(divisions / opt.hitDurFraction), 1);

  // Light hat on each beat
  for (let b = 0; b < beats; b++) addUnpitched(measure, b * beatDur, hitDur, "hihat", 1, 1);

  // Kick on 1 and 3
  addUnpitched(measure, 0, hitDur, "kick", 1, 1);
  if (beats >= 3) addUnpitched(measure, 2 * beatDur, hitDur, "kick", 1, 1);

  // Snare on 2 and 4 (very light)
  if (opt.includeSnareBackbeat) {
    if (beats >= 2) addUnpitched(measure, 1 * beatDur, hitDur, "snare", 1, 1);
    if (beats >= 4) addUnpitched(measure, 3 * beatDur, hitDur, "snare", 1, 1);
  }

  // Optional extra hat push on "& of 2" and "& of 4"
  const eighth = Math.floor(beatDur / 2);
  const tAnd2 = 1 * beatDur + eighth;
  const tAnd4 = 3 * beatDur + eighth;
  if (tAnd2 > 0 && tAnd2 < barDur) addUnpitched(measure, tAnd2, hitDur, "hihat", 1, 1);
  if (tAnd4 > 0 && tAnd4 < barDur) addUnpitched(measure, tAnd4, hitDur, "hihat", 1, 1);
}

function writeDrumsBallad(measure: any, divisions: number, beats: number, opt: ResolvedPercOptions) {
  const beatDur = divisions;
  const barDur = beats * beatDur;
  const hitDur = Math.max(Math.floor(divisions / opt.hitDurFraction), 1);

  // Very sparse: kick + ride on 1, optional ride on 3
  addUnpitched(measure, 0, hitDur, "kick", 1, 1);
  addUnpitched(measure, 0, hitDur, "ride", 1, 1);

  if (beats >= 3) addUnpitched(measure, 2 * beatDur, hitDur, "ride", 1, 1);

  // Keep bar readable if nothing else lands
  if ((measure.events?.length ?? 0) === 0) addRest(measure, 0, barDur, 1, 1);
}

function writeDrumsByStyle(measure: any, divisions: number, beats: number, opt: ResolvedPercOptions) {
  if (opt.style === "bossa") return writeDrumsBossa(measure, divisions, beats, opt);
  if (opt.style === "ballad") return writeDrumsBallad(measure, divisions, beats, opt);
  return writeDrumsSwing(measure, divisions, beats, opt);
}

function writeColorHits(
  drumsMeasure: any,
  divisions: number,
  beats: number,
  chordOnsets: Array<{ t: number }>,
  opt: ResolvedPercOptions
) {
  const beatDur = divisions;
  const barDur = beats * beatDur;

  const hitDur = Math.max(Math.floor(divisions / opt.hitDurFraction), 1);

  // We place colors on early chord onsets to avoid clutter.
  // Priority: bells, chimes, mallets, suspended cymbal
  const candidates = chordOnsets
    .map((x) => clampInt(x.t ?? 0, 0, barDur))
    .filter((t) => t > 0 && t < barDur)
    .slice()
    .sort((a, b) => a - b);

  const unique: number[] = [];
  for (const t of candidates) {
    const tooClose = unique.some((u) => Math.abs(u - t) < Math.floor(beatDur / 2));
    if (!tooClose) unique.push(t);
  }

  // Fallback when there are no chord onsets
  const fallbackTs = [beatDur, 2 * beatDur, 3 * beatDur].filter((t) => t > 0 && t < barDur);

  const pickT = (i: number) => unique[i] ?? fallbackTs[i] ?? beatDur;

  if (opt.enableBells) addUnpitched(drumsMeasure, pickT(0), hitDur, "bells", 1, 1);
  if (opt.enableChimes) addUnpitched(drumsMeasure, pickT(1), hitDur, "chimes", 1, 1);
  if (opt.enableMallets) addUnpitched(drumsMeasure, pickT(2), hitDur, "mallets", 1, 1);

  if (opt.enableSuspendedCymbal) {
    if (opt.susCymbalMode === "roll") {
      const rollDur = opt.susCymbalRollWholeBar ? barDur : Math.max(2 * beatDur, beatDur);
      addUnpitched(drumsMeasure, 0, rollDur, "suspended_cymbal", 1, 1);
    } else {
      addUnpitched(drumsMeasure, pickT(0), hitDur, "suspended_cymbal", 1, 1);
    }
  }
}

function writeTimpani(
  timMeasure: any,
  divisions: number,
  beats: number,
  chordOnsets: Array<{ t: number; notes?: any[] }>,
  opt: ResolvedPercOptions
) {
  const beatDur = divisions;
  const barDur = beats * beatDur;

  // We keep timpani simple and readable: 1 or 2 hits per bar
  // We use C3 as a safe default until we wire harmonic roots.
  const safePitch = { step: "C", octave: 3 };

  // Use the earliest onset and mid-bar onset if available
  const sorted = chordOnsets.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const t1 = clampInt(sorted[0]?.t ?? 0, 0, barDur);
  const t2 = clampInt(sorted[Math.floor(sorted.length / 2)]?.t ?? 2 * beatDur, 0, barDur);

  const dur1 = Math.max(Math.floor(barDur * 0.45), Math.floor(beatDur));
  const dur2 = Math.max(Math.floor(barDur * 0.45), Math.floor(beatDur));

  // If t1 is 0, keep it, otherwise pull to nearest beat for clarity
  const snapToBeat = (t: number) => Math.round(t / beatDur) * beatDur;

  const tt1 = t1 <= 0 ? 0 : snapToBeat(t1);
  const tt2 = t2 <= 0 ? 2 * beatDur : snapToBeat(t2);

  addPitched(timMeasure, tt1, clampInt(dur1, beatDur / 2, barDur), safePitch, 1, 1);

  // Second note only if it is far enough from first
  if (Math.abs(tt2 - tt1) >= beatDur) {
    addPitched(timMeasure, tt2, clampInt(dur2, beatDur / 2, barDur), safePitch, 1, 1);
  }

  if ((timMeasure.events?.length ?? 0) === 0) {
    addRest(timMeasure, 0, barDur, 1, 1);
  }
}

/**
 * Map any input ScoreModel to a percussion ScoreModel.
 *
 * Output parts:
 * - DRUMS: unpitched drumset + colors (suspended cymbal, mallets, bells, chimes)
 * - TIMP: pitched timpani (simple pattern for now)
 */
export function mapToPercussion(score: ScoreModel, options?: PercussionOptions): ScoreModel {
  const opt = resolveOptions(options);

  const drums = makePart("DRUMS", "Percussion", "drums", 1);
  const timp = makePart("TIMP", "Timpani", "timpani", 1);

  const partsOut = opt.enableTimpani ? [drums, timp] : [drums];

  const srcPart = score.parts?.[0];
  if (!srcPart?.measures || srcPart.measures.length === 0) {
    throw new Error("Parsed scoreModel has no measures in parts[0]. Check parser output.");
  }

  const chords = extractOnsetChords(score);

  // Group chord onsets per measure (for optional kick reinforcement and colors)
  const chordsByMeasure: Record<string, any[]> = {};
  for (const ch of chords) {
    const key = String(ch.measure);
    if (!chordsByMeasure[key]) chordsByMeasure[key] = [];
    chordsByMeasure[key].push(ch);
  }

  for (const m of srcPart.measures) {
    const drmShell = cloneMeasureShell(m);
    drums.measures.push(drmShell);

    const timShell = opt.enableTimpani ? cloneMeasureShell(m) : null;
    if (timShell) timp.measures.push(timShell);

    const divisions = m?.attributes?.divisions ?? score?.global?.divisions ?? 480;
    const beats = m?.attributes?.time?.beats ?? 4;
    const beatDur = divisions;
    const barDur = beats * beatDur;

    const hits = chordsByMeasure[String(m.number)] ?? [];
    const sortedHits = hits.slice().sort((a: any, b: any) => (a.t ?? 0) - (b.t ?? 0));

    // Groove for DRUMS
    writeDrumsByStyle(drmShell, divisions, beats, opt);

    // Optional: add light kick on chord onsets (only if not too dense)
    if (opt.kickOnChordOnsets) {
      if (sortedHits.length > 0) {
        const maxExtra = clampInt(beats, 1, 6);
        let added = 0;

        const hitDur = Math.max(Math.floor(divisions / opt.hitDurFraction), 1);

        for (const ch of sortedHits) {
          const t = ch?.t ?? 0;
          if (t <= 0) continue;
          if (t >= barDur) continue;

          const tooClose = (drmShell.events ?? []).some((ev: any) => {
            if (ev?.type !== "unpitched") return false;
            if (ev?.instrumentId !== "kick") return false;
            const dt = Math.abs((ev?.t ?? 0) - t);
            return dt < Math.floor(beatDur / 4);
          });

          if (tooClose) continue;

          addUnpitched(drmShell, t, hitDur, "kick", 1, 1);
          added += 1;
          if (added >= maxExtra) break;
        }
      }
    }

    // Colors on DRUMS
    const chordOnsets = sortedHits.map((x: any) => ({ t: x?.t ?? 0 }));
    writeColorHits(drmShell, divisions, beats, chordOnsets, opt);

    // TIMPANI (pitched)
    if (timShell && opt.enableTimpani) {
      writeTimpani(timShell, divisions, beats, sortedHits, opt);
    }

    // If, for some reason, DRUMS ended empty, add a bar rest
    if ((drmShell.events?.length ?? 0) === 0) addRest(drmShell, 0, barDur, 1, 1);
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "percussion" },
    global: { ...score.global },
    parts: partsOut
  } as any;
}

// Keep compatibility with arrangeRouter imports
export function mapPianoToPercussionOpen(score: ScoreModel, options?: PercussionOptions): ScoreModel {
  return mapToPercussion(score, options);
}