import type { CounterpointRules, RuleHit, Slice, VoiceId, Voicing } from "./types";
import type { Range } from "./ranges";
import { parseChordSymbol } from "../../../harmonize/satb/chordSymbol";

type VoiceCrossingConfig = {
  allow_voice_crossing: boolean;
  max_crossing_duration_slices: number;
  allowed_on_weak_beats_only: boolean;
  ensemble_hierarchy: string[];
  collision_handler: { resolution_priority: string[] };
  octave_displacement: { max_octaves_down: number };
  penalties: { crossingPenalty: number; unresolvedCrossingHardPenalty: number };
};

const DEFAULT_CONFIG: VoiceCrossingConfig = {
  allow_voice_crossing: false,
  max_crossing_duration_slices: 0,
  allowed_on_weak_beats_only: true,
  ensemble_hierarchy: ["violin_1", "violin_2", "viola", "cello", "double_bass"],
  collision_handler: {
    resolution_priority: ["attempt_voice_swap", "attempt_octave_displacement_down", "recalculate_nearest_chord_tone"]
  },
  octave_displacement: { max_octaves_down: 2 },
  penalties: { crossingPenalty: 2, unresolvedCrossingHardPenalty: 20 }
};

const HIERARCHY_MAP: Record<string, VoiceId> = {
  violin_1: "vln1",
  violin_2: "vln2",
  viola: "vla",
  cello: "vc",
  double_bass: "cb",
  vln1: "vln1",
  vln2: "vln2",
  vla: "vla",
  vc: "vc",
  cb: "cb"
};

function getConfig(rules: CounterpointRules): VoiceCrossingConfig {
  const voiceleading = rules.voiceleading ?? {};
  const nested = voiceleading.voice_leading_constraints?.voice_crossing ?? null;
  const flat = voiceleading.voice_crossing ?? null;
  const raw = (nested ?? flat ?? {}) as Partial<VoiceCrossingConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    collision_handler: {
      ...DEFAULT_CONFIG.collision_handler,
      ...(raw.collision_handler ?? {})
    },
    octave_displacement: {
      ...DEFAULT_CONFIG.octave_displacement,
      ...(raw.octave_displacement ?? {})
    },
    penalties: {
      ...DEFAULT_CONFIG.penalties,
      ...(raw.penalties ?? {})
    }
  };
}

function normalizeHierarchy(hierarchy: string[]): VoiceId[] {
  const out: VoiceId[] = [];
  for (const h of hierarchy) {
    const key = String(h || "").toLowerCase().replace(/\s+/g, "_");
    const mapped = HIERARCHY_MAP[key];
    if (mapped) out.push(mapped);
  }
  return out.length ? out : ["vln1", "vln2", "vla", "vc", "cb"];
}

export function detectVoiceCrossing(hierarchy: VoiceId[], slicePitches: Voicing) {
  const violations: Array<{ upper: VoiceId; lower: VoiceId; upperMidi: number; lowerMidi: number; amount: number }> = [];
  for (let i = 0; i < hierarchy.length - 1; i++) {
    const upper = hierarchy[i]!;
    const lower = hierarchy[i + 1]!;
    const upperMidi = slicePitches[upper];
    const lowerMidi = slicePitches[lower];
    if (upperMidi === null || lowerMidi === null) continue;
    if (lowerMidi > upperMidi) {
      violations.push({
        upper,
        lower,
        upperMidi,
        lowerMidi,
        amount: lowerMidi - upperMidi
      });
    }
  }
  return { isCrossing: violations.length > 0, violations };
}

function inRange(midi: number, range: Range): boolean {
  return midi >= range.absMin && midi <= range.absMax;
}

function chordPcs(symbol: string | null): number[] {
  if (!symbol) return [];
  const parsed = parseChordSymbol(symbol);
  return parsed?.pcs ?? [];
}

function chooseNearestChordToneBelow(
  upperMidi: number,
  preferMidi: number,
  pcs: number[],
  range: Range
): number | null {
  if (!pcs.length) return null;
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let m = range.absMin; m <= range.absMax; m++) {
    if (((m % 12) + 12) % 12 !== pcs[0] && !pcs.includes(((m % 12) + 12) % 12)) continue;
    if (m > upperMidi) continue;
    const score = Math.abs(m - preferMidi);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

function resolveViolationWithSwap(
  upper: VoiceId,
  lower: VoiceId,
  voicing: Voicing,
  ranges: Record<VoiceId, Range>,
  locked: Record<VoiceId, boolean>
): boolean {
  if (locked[upper] || locked[lower]) return false;
  const upperMidi = voicing[upper];
  const lowerMidi = voicing[lower];
  if (upperMidi === null || lowerMidi === null) return false;
  if (!inRange(lowerMidi, ranges[upper]) || !inRange(upperMidi, ranges[lower])) return false;
  voicing[upper] = lowerMidi;
  voicing[lower] = upperMidi;
  return true;
}

function resolveViolationWithOctaveDown(
  upperMidi: number,
  lower: VoiceId,
  voicing: Voicing,
  ranges: Record<VoiceId, Range>,
  maxDown: number
): boolean {
  const lowerMidi = voicing[lower];
  if (lowerMidi === null) return false;
  for (let i = 1; i <= maxDown; i++) {
    const shifted = lowerMidi - 12 * i;
    if (!inRange(shifted, ranges[lower])) continue;
    if (shifted <= upperMidi) {
      voicing[lower] = shifted;
      return true;
    }
  }
  return false;
}

function resolveViolationWithChordTone(
  upperMidi: number,
  lower: VoiceId,
  voicing: Voicing,
  prevVoicing: Voicing,
  ranges: Record<VoiceId, Range>,
  pcs: number[]
): boolean {
  const prefer = prevVoicing[lower] ?? voicing[lower] ?? upperMidi - 3;
  const candidate = chooseNearestChordToneBelow(upperMidi, prefer, pcs, ranges[lower]);
  if (candidate === null) return false;
  voicing[lower] = candidate;
  return true;
}

export function resolveVoiceCrossing(params: {
  slice: Slice;
  voicing: Voicing;
  prevVoicing: Voicing;
  rules: CounterpointRules;
  ranges: Record<VoiceId, Range>;
  locked?: Record<VoiceId, boolean>;
  crossingCounts?: Record<string, number>;
}): { voicing: Voicing; crossingCounts: Record<string, number>; ruleHits: RuleHit[]; cost: number } {
  const config = getConfig(params.rules);
  const hierarchy = normalizeHierarchy(config.ensemble_hierarchy);
  const locked = params.locked ?? { vln1: false, vln2: false, vla: false, vc: false, cb: false };
  const crossingCounts = { ...(params.crossingCounts ?? {}) };
  const voicing: Voicing = { ...params.voicing };
  const ruleHits: RuleHit[] = [];
  let cost = 0;

  const { isCrossing, violations } = detectVoiceCrossing(hierarchy, voicing);
  const pcs = chordPcs(params.slice.chordSymbol);

  for (const v of violations) {
    const key = `${v.upper}-${v.lower}`;
    const prevCount = crossingCounts[key] ?? 0;
    const allow =
      config.allow_voice_crossing &&
      (!config.allowed_on_weak_beats_only || !params.slice.isStrongBeat) &&
      prevCount + 1 <= config.max_crossing_duration_slices;

    if (allow) {
      crossingCounts[key] = prevCount + 1;
      cost += config.penalties.crossingPenalty;
      ruleHits.push({ id: "crossing_allowed", cost: config.penalties.crossingPenalty, detail: key });
      continue;
    }

    crossingCounts[key] = 0;
    let resolved = false;
    for (const strat of config.collision_handler.resolution_priority) {
      if (strat === "attempt_voice_swap") {
        resolved = resolveViolationWithSwap(v.upper, v.lower, voicing, params.ranges, locked);
      } else if (strat === "attempt_octave_displacement_down") {
        resolved = resolveViolationWithOctaveDown(
          v.upperMidi,
          v.lower,
          voicing,
          params.ranges,
          config.octave_displacement.max_octaves_down
        );
      } else if (strat === "recalculate_nearest_chord_tone") {
        resolved = resolveViolationWithChordTone(v.upperMidi, v.lower, voicing, params.prevVoicing, params.ranges, pcs);
      }
      if (resolved) {
        ruleHits.push({ id: "crossing_resolved", cost: 0, detail: `${v.upper}-${v.lower}-${strat}` });
        break;
      }
    }
    if (!resolved) {
      cost += config.penalties.unresolvedCrossingHardPenalty;
      ruleHits.push({
        id: "crossing_unresolved",
        cost: config.penalties.unresolvedCrossingHardPenalty,
        detail: `${v.upper}-${v.lower}`
      });
    }
  }

  return { voicing, crossingCounts, ruleHits, cost };
}

export function enforceHierarchyAcrossScore(params: {
  slices: Slice[];
  voicings: Voicing[];
  rules: CounterpointRules;
  ranges: Record<VoiceId, Range>;
}): { voicings: Voicing[]; ruleHits: RuleHit[] } {
  const out: Voicing[] = [];
  const ruleHits: RuleHit[] = [];
  let prev: Voicing = { vln1: null, vln2: null, vla: null, vc: null, cb: null };
  let crossingCounts: Record<string, number> = {};
  for (let i = 0; i < params.slices.length; i++) {
    const slice = params.slices[i]!;
    const current = { ...params.voicings[i]! };
    const locked: Record<VoiceId, boolean> = {
      vln1: slice.melodyMidi !== null,
      vln2: false,
      vla: false,
      vc: false,
      cb: false
    };
    const res = resolveVoiceCrossing({
      slice,
      voicing: current,
      prevVoicing: prev,
      rules: params.rules,
      ranges: params.ranges,
      locked,
      crossingCounts
    });
    crossingCounts = res.crossingCounts;
    ruleHits.push(...res.ruleHits);
    out.push(res.voicing);
    prev = res.voicing;
  }
  return { voicings: out, ruleHits };
}
