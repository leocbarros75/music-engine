import { pitchToMidi } from "../../instruments/instrumentCatalog";
import { parseChordSymbol } from "../../harmonize/satb/chordSymbol";

export type RuleSeverity = "warn" | "error";

export type RuleViolation = {
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  measure?: number;
  t?: number;
  voices?: string[];
};

export type ChordEvent = { measure: number; t: number; symbol: string };
export type RuleCheckOptions = {
  strictness?: "relaxed" | "standard" | "strict";
  level?: string;
};

type RuleCheckResult = {
  rulesVersion: string;
  violations: RuleViolation[];
  warnings: string[];
};

type ChoralRules = {
  ranges: {
    voices: Record<string, { minMidi: number; maxMidi: number; softMinMidi?: number; softMaxMidi?: number }>;
  };
  spacing: {
    adjacentMaxSemitones: { SA: number; AT: number; TB: number };
    allowOpenVoicing?: boolean;
  };
  forbiddenIntervals: {
    parallelPerfect: { intervalClasses: number[] };
  };
};

// Rule data inlined — no file-system access needed at runtime (works on Render etc.)
const BUILT_IN_RULES: ChoralRules = {
  ranges: {
    voices: {
      soprano: { minMidi: 60, maxMidi: 76, softMinMidi: 62, softMaxMidi: 74 }, // C4..E5
      alto:    { minMidi: 55, maxMidi: 69, softMinMidi: 57, softMaxMidi: 67 }, // G3..A4
      tenor:   { minMidi: 52, maxMidi: 64, softMinMidi: 54, softMaxMidi: 62 }, // E3..E4
      bass:    { minMidi: 40, maxMidi: 57, softMinMidi: 42, softMaxMidi: 55 }  // E2..A3
    }
  },
  spacing: {
    adjacentMaxSemitones: { SA: 12, AT: 12, TB: 19 },
    allowOpenVoicing: true
  },
  forbiddenIntervals: {
    parallelPerfect: { intervalClasses: [0, 7] }
  }
};

function loadRules(): ChoralRules {
  return BUILT_IN_RULES;
}

const VOICE_ORDER = ["soprano", "alto", "tenor", "bass"] as const;
const PART_IDS: Record<string, string> = {
  soprano: "P_S",
  alto: "P_A",
  tenor: "P_T",
  bass: "P_B"
};

const PC_BY_NAME: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};

type VoiceNote = { measure: number; t: number; midi: number; event: any };

function findVoicePart(score: any, voice: string): any | null {
  const parts = score?.parts ?? [];
  const byId = parts.find((p: any) => String(p?.part_id ?? "") === PART_IDS[voice]);
  if (byId) return byId;
  const byName = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes(voice));
  return byName ?? null;
}

function getMeasure(part: any, measureNumber: number): any | null {
  const measures = part?.measures ?? [];
  return measures.find((m: any) => Number(m?.number) === Number(measureNumber)) ?? null;
}

function getEventMidi(event: any): number | null {
  if (!event || event.type !== "note") return null;
  if (typeof event.midi === "number" && Number.isFinite(event.midi)) return Number(event.midi);
  if (event.pitch) {
    const midi = pitchToMidi(event.pitch);
    return Number.isFinite(midi) ? midi : null;
  }
  return null;
}

function activeNoteAt(measure: any, t: number): any | null {
  if (!measure) return null;
  const events = Array.isArray(measure?.events) ? measure.events : [];
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e?.t);
    const ed = Number(e?.dur);
    if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
    if (et <= t && t < et + ed) return e;
  }
  return events.find((e: any) => e?.type === "note" && Number(e?.t) === Number(t)) ?? null;
}

function collectOnsetsForMeasure(voiceParts: Record<string, any>, measureNumber: number): number[] {
  const set = new Set<number>();
  for (const voice of VOICE_ORDER) {
    const part = voiceParts[voice];
    if (!part) continue;
    const measure = getMeasure(part, measureNumber);
    if (!measure) continue;
    const events = Array.isArray(measure?.events) ? measure.events : [];
    for (const e of events) {
      const t = Number(e?.t);
      if (Number.isFinite(t)) set.add(t);
    }
  }
  if (!set.has(0)) set.add(0);
  return Array.from(set).sort((a, b) => a - b);
}

function isPerfectInterval(semitones: number, allowed: number[]): boolean {
  const ic = Math.abs(semitones) % 12;
  return allowed.includes(ic);
}

function tonicPcFromKey(fifths: number, mode: string | null): number {
  const major = ((fifths * 7) % 12 + 12) % 12;
  if (mode === "minor") return (major + 9) % 12;
  return major;
}

function detectKeyContext(score: any): { keyFifths: number | null; keyMode: string | null; tonicPc: number | null } {
  const parts = score?.parts ?? [];
  for (const part of parts) {
    const measures = part?.measures ?? [];
    for (const measure of measures) {
      const attrs = measure?.attributes ?? {};
      if (typeof attrs.key_fifths === "number") {
        const mode = typeof attrs.key_mode === "string" ? attrs.key_mode : null;
        return {
          keyFifths: attrs.key_fifths,
          keyMode: mode,
          tonicPc: tonicPcFromKey(attrs.key_fifths, mode)
        };
      }
    }
  }
  return { keyFifths: null, keyMode: null, tonicPc: null };
}

function collectVoiceNotes(part: any): { list: VoiceNote[]; indexByEvent: Map<any, number> } {
  const list: VoiceNote[] = [];
  const indexByEvent = new Map<any, number>();
  const measures = part?.measures ?? [];
  for (const measure of measures) {
    const measureNumber = Number(measure?.number);
    const events = Array.isArray(measure?.events) ? measure.events : [];
    for (const e of events) {
      if (e?.type !== "note") continue;
      const midi = getEventMidi(e);
      if (midi === null) continue;
      list.push({
        measure: Number.isFinite(measureNumber) ? measureNumber : 0,
        t: Number(e?.t ?? 0),
        midi,
        event: e
      });
    }
  }
  list.sort((a, b) => (a.measure - b.measure) || (a.t - b.t));
  list.forEach((item, idx) => indexByEvent.set(item.event, idx));
  return { list, indexByEvent };
}

function parseBassPc(symbol: string, rootPc: number): number {
  const parts = symbol.split("/");
  if (parts.length < 2) return rootPc;
  const bassRaw = String(parts[1] ?? "").trim();
  if (!bassRaw) return rootPc;
  const match = bassRaw.match(/^([A-Ga-g])([#b]?)/);
  if (!match) return rootPc;
  const name = `${match[1]!.toUpperCase()}${match[2] ?? ""}`;
  return typeof PC_BY_NAME[name] === "number" ? PC_BY_NAME[name] : rootPc;
}

function parseChordDescriptor(symbol: string) {
  const main = String(symbol ?? "").split("/")[0] ?? "";
  const parsed = parseChordSymbol(String(main));
  if (!parsed) return null;
  const rootPc = parsed.rootPc;
  const bassPc = parseBassPc(symbol, rootPc);
  const chordPcs = parsed.pcs ?? [];
  const intervals = chordPcs.map((pc) => ((pc - rootPc) % 12 + 12) % 12);

  const thirdInterval = intervals.includes(3) ? 3 : intervals.includes(4) ? 4 : null;
  const fifthInterval = intervals.includes(7) ? 7 : intervals.includes(6) ? 6 : intervals.includes(8) ? 8 : null;
  const seventhInterval = intervals.includes(11)
    ? 11
    : intervals.includes(10)
      ? 10
      : intervals.includes(9)
        ? 9
        : null;

  return {
    symbol,
    rootPc,
    bassPc,
    chordPcs,
    thirdPc: thirdInterval != null ? (rootPc + thirdInterval) % 12 : null,
    fifthPc: fifthInterval != null ? (rootPc + fifthInterval) % 12 : null,
    seventhPc: seventhInterval != null ? (rootPc + seventhInterval) % 12 : null,
    isSeventh: seventhInterval != null,
    isRootPosition: bassPc === rootPc,
    isFirstInversion: thirdInterval != null && bassPc === (rootPc + thirdInterval) % 12
  };
}

function notePcFromMidi(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function normalizeStrictness(
  strictness: RuleCheckOptions["strictness"] | undefined,
  level: RuleCheckOptions["level"] | undefined
): "relaxed" | "standard" | "strict" {
  if (strictness === "relaxed" || strictness === "standard" || strictness === "strict") return strictness;
  if (level === "beginner") return "strict";
  if (level === "intermediate") return "standard";
  if (level === "advanced") return "standard";
  if (level === "professional") return "relaxed";
  return "standard";
}

function applyStrictness(
  violations: RuleViolation[],
  strictness: "relaxed" | "standard" | "strict"
): RuleViolation[] {
  if (strictness !== "strict") return violations;
  const escalate = new Set([
    "range.strict",
    "spacing.SA",
    "spacing.AT",
    "spacing.TB",
    "crossing.SA",
    "crossing.AT",
    "crossing.TB",
    "parallel.perfect",
    "hidden.perfect",
    "doubling.third.root_position",
    "doubling.third.first_inversion",
    "seventh.incomplete_root_position",
    "seventh.incomplete_inversion",
    "resolution.leading_tone",
    "resolution.seventh"
  ]);
  return violations.map((v) => (escalate.has(v.ruleId) ? { ...v, severity: "error" } : v));
}

export function checkChoralRules(
  scoreModel: any,
  chords: ChordEvent[] = [],
  options: RuleCheckOptions = {}
): RuleCheckResult {
  const warnings: string[] = [];
  const violations: RuleViolation[] = [];

  let rules: ChoralRules;
  try {
    rules = loadRules();
  } catch (err: any) {
    return {
      rulesVersion: "choral-v1",
      violations: [],
      warnings: [`[rules] Failed to load choral rules: ${err?.message ?? String(err)}`]
    };
  }

  const voiceParts: Record<string, any> = {};
  for (const voice of VOICE_ORDER) {
    const part = findVoicePart(scoreModel, voice);
    if (!part) {
      warnings.push(`[rules] Missing ${voice} part for rule checks.`);
    }
    voiceParts[voice] = part;
  }

  const measureNumbers = new Set<number>();
  for (const voice of VOICE_ORDER) {
    const part = voiceParts[voice];
    const measures = part?.measures ?? [];
    for (const m of measures) {
      const num = Number(m?.number);
      if (Number.isFinite(num)) measureNumbers.add(num);
    }
  }
  const measureList = Array.from(measureNumbers).sort((a, b) => a - b);

  for (const voice of VOICE_ORDER) {
    const part = voiceParts[voice];
    if (!part) continue;
    const range = rules.ranges.voices[voice];
    const measures = part?.measures ?? [];
    for (const measure of measures) {
      const number = Number(measure?.number);
      const events = Array.isArray(measure?.events) ? measure.events : [];
      for (const e of events) {
        if (e?.type !== "note") continue;
        const midi = getEventMidi(e);
        if (midi === null) continue;
        if (midi < range.minMidi || midi > range.maxMidi) {
          violations.push({
            ruleId: "range.strict",
            severity: "warn",
            message: `${voice} out of range (midi=${midi}, allowed ${range.minMidi}-${range.maxMidi}).`,
            measure: Number.isFinite(number) ? number : undefined,
            t: Number.isFinite(Number(e?.t)) ? Number(e?.t) : undefined,
            voices: [voice]
          });
        }
      }
    }
  }

  for (const measureNumber of measureList) {
    const onsets = collectOnsetsForMeasure(voiceParts, measureNumber);

    for (const t of onsets) {
      const sNote = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t);
      const aNote = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t);
      const tNote = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t);
      const bNote = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t);

      const sMidi = sNote ? getEventMidi(sNote) : null;
      const aMidi = aNote ? getEventMidi(aNote) : null;
      const tMidi = tNote ? getEventMidi(tNote) : null;
      const bMidi = bNote ? getEventMidi(bNote) : null;

      if (sMidi !== null && aMidi !== null && Math.abs(sMidi - aMidi) > rules.spacing.adjacentMaxSemitones.SA) {
        violations.push({
          ruleId: "spacing.SA",
          severity: "warn",
          message: `Soprano–Alto spacing exceeds octave (${Math.abs(sMidi - aMidi)} semitones).`,
          measure: measureNumber,
          t,
          voices: ["soprano", "alto"]
        });
      }

      if (aMidi !== null && tMidi !== null && Math.abs(aMidi - tMidi) > rules.spacing.adjacentMaxSemitones.AT) {
        violations.push({
          ruleId: "spacing.AT",
          severity: "warn",
          message: `Alto–Tenor spacing exceeds octave (${Math.abs(aMidi - tMidi)} semitones).`,
          measure: measureNumber,
          t,
          voices: ["alto", "tenor"]
        });
      }

      if (tMidi !== null && bMidi !== null && Math.abs(tMidi - bMidi) > rules.spacing.adjacentMaxSemitones.TB) {
        violations.push({
          ruleId: "spacing.TB",
          severity: "warn",
          message: `Tenor–Bass spacing exceeds ${rules.spacing.adjacentMaxSemitones.TB} semitones.`,
          measure: measureNumber,
          t,
          voices: ["tenor", "bass"]
        });
      }

      if (sMidi !== null && aMidi !== null && sMidi < aMidi) {
        violations.push({
          ruleId: "crossing.SA",
          severity: "warn",
          message: "Soprano is below Alto (voice crossing).",
          measure: measureNumber,
          t,
          voices: ["soprano", "alto"]
        });
      }

      if (aMidi !== null && tMidi !== null && aMidi < tMidi) {
        violations.push({
          ruleId: "crossing.AT",
          severity: "warn",
          message: "Alto is below Tenor (voice crossing).",
          measure: measureNumber,
          t,
          voices: ["alto", "tenor"]
        });
      }

      if (tMidi !== null && bMidi !== null && tMidi < bMidi) {
        violations.push({
          ruleId: "crossing.TB",
          severity: "warn",
          message: "Tenor is below Bass (voice crossing).",
          measure: measureNumber,
          t,
          voices: ["tenor", "bass"]
        });
      }
    }

    for (let i = 0; i < onsets.length - 1; i += 1) {
      const t1 = onsets[i]!;
      const t2 = onsets[i + 1]!;

      const s1 = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t1);
      const s2 = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t2);
      const a1 = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t1);
      const a2 = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t2);
      const t1n = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t1);
      const t2n = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t2);
      const b1 = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t1);
      const b2 = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t2);

      const pairs: Array<{
        label: string;
        v1: [any | null, any | null];
        v2: [any | null, any | null];
      }> = [
        { label: "SA", v1: [s1, s2], v2: [a1, a2] },
        { label: "AT", v1: [a1, a2], v2: [t1n, t2n] },
        { label: "TB", v1: [t1n, t2n], v2: [b1, b2] }
      ];

      for (const pair of pairs) {
        const m1 = pair.v1[0] ? getEventMidi(pair.v1[0]) : null;
        const m2 = pair.v1[1] ? getEventMidi(pair.v1[1]) : null;
        const n1 = pair.v2[0] ? getEventMidi(pair.v2[0]) : null;
        const n2 = pair.v2[1] ? getEventMidi(pair.v2[1]) : null;
        if (m1 === null || m2 === null || n1 === null || n2 === null) continue;

        const interval1 = Math.abs(m1 - n1);
        const interval2 = Math.abs(m2 - n2);

        if (
          isPerfectInterval(interval1, rules.forbiddenIntervals.parallelPerfect.intervalClasses) &&
          isPerfectInterval(interval2, rules.forbiddenIntervals.parallelPerfect.intervalClasses)
        ) {
          const dir1 = Math.sign(m2 - m1);
          const dir2 = Math.sign(n2 - n1);
          if (dir1 !== 0 && dir2 !== 0 && dir1 === dir2) {
            violations.push({
              ruleId: "parallel.perfect",
              severity: "warn",
              message: `Parallel perfect interval between ${pair.label} voices.`,
              measure: measureNumber,
              t: t2,
              voices: pair.label === "SA" ? ["soprano", "alto"] : pair.label === "AT" ? ["alto", "tenor"] : ["tenor", "bass"]
            });
          }
        }
      }

      // ── Hidden (direct) perfect intervals — outer voices only ──────────────
      // Fux, *Gradus ad Parnassum* (1725), cardinal rule 1 & 3:
      //   "Perfect consonance → Perfect consonance: contrary or oblique motion only."
      // In practice, the "hidden fifth/octave" rule applies specifically to outer
      // voices (Soprano + Bass) approaching a perfect interval in *similar* motion
      // when the upper voice moves by a leap (> 1 whole tone = >2 semitones).
      // Step motion in the soprano is the accepted exception (Aldwell & Schachter).
      //
      // Outer voices = soprano (upper) + bass (lower).
      {
        const soprM1 = s1 ? getEventMidi(s1) : null;
        const soprM2 = s2 ? getEventMidi(s2) : null;
        const bassM1 = b1 ? getEventMidi(b1) : null;
        const bassM2 = b2 ? getEventMidi(b2) : null;

        if (soprM1 !== null && soprM2 !== null && bassM1 !== null && bassM2 !== null) {
          const soprDir = Math.sign(soprM2 - soprM1);
          const bassDir = Math.sign(bassM2 - bassM1);

          // Similar motion: both voices moving in the same direction (not oblique)
          if (soprDir !== 0 && bassDir !== 0 && soprDir === bassDir) {
            const arrivalInterval = Math.abs(soprM2 - bassM2) % 12;
            const isPerfect = arrivalInterval === 0 || arrivalInterval === 7;
            const soprLeaps = Math.abs(soprM2 - soprM1) > 2; // leap = more than whole tone

            // Not already a parallel perfect (those are caught above)
            const departureInterval = Math.abs(soprM1 - bassM1) % 12;
            const depPerfect = departureInterval === 0 || departureInterval === 7;
            const alreadyParallel = isPerfectInterval(Math.abs(soprM1 - bassM1), [0, 7]) &&
                                    isPerfectInterval(Math.abs(soprM2 - bassM2), [0, 7]);

            if (isPerfect && soprLeaps && !alreadyParallel && !depPerfect) {
              violations.push({
                ruleId: "hidden.perfect",
                severity: "warn",
                message: `Hidden ${arrivalInterval === 0 ? "octave/unison" : "fifth"}: soprano and bass approach a perfect interval in similar motion with soprano leap (Fux).`,
                measure: measureNumber,
                t: t2,
                voices: ["soprano", "bass"]
              });
            }
          }
        }
      }
    }
  }

  const voiceNoteCache: Record<string, { list: VoiceNote[]; indexByEvent: Map<any, number> }> = {};
  for (const voice of VOICE_ORDER) {
    const part = voiceParts[voice];
    if (!part) continue;
    voiceNoteCache[voice] = collectVoiceNotes(part);
  }

  const keyContext = detectKeyContext(scoreModel);
  const tonicPc = keyContext.tonicPc;
  if (tonicPc !== null) {
    const leadingTonePc = (tonicPc + 11) % 12;
    for (const voice of VOICE_ORDER) {
      const notes = voiceNoteCache[voice]?.list ?? [];
      for (let i = 0; i < notes.length - 1; i += 1) {
        const current = notes[i]!;
        const next = notes[i + 1]!;
        const pc = notePcFromMidi(current.midi);
        if (pc !== leadingTonePc) continue;
        const nextPc = notePcFromMidi(next.midi);
        if (nextPc !== tonicPc || next.midi <= current.midi) {
          violations.push({
            ruleId: "resolution.leading_tone",
            severity: "warn",
            message: `${voice} leading tone did not resolve upward to tonic.`,
            measure: current.measure,
            t: current.t,
            voices: [voice]
          });
        }
      }
    }
  }

  if (Array.isArray(chords) && chords.length) {
    for (const chord of chords) {
      const measureNumber = Number(chord.measure);
      const t = Number(chord.t ?? 0);
      if (!Number.isFinite(measureNumber) || !Number.isFinite(t)) continue;
      const descriptor = parseChordDescriptor(chord.symbol);
      if (!descriptor) continue;

      const chordNotes: Array<{ voice: string; midi: number; pc: number; event: any }> = [];
      for (const voice of VOICE_ORDER) {
        const part = voiceParts[voice];
        const measure = part ? getMeasure(part, measureNumber) : null;
        const note = measure ? activeNoteAt(measure, t) : null;
        if (!note) continue;
        const midi = getEventMidi(note);
        if (midi === null) continue;
        chordNotes.push({ voice, midi, pc: notePcFromMidi(midi), event: note });
      }

      const countByPc = new Map<number, number>();
      for (const n of chordNotes) {
        countByPc.set(n.pc, (countByPc.get(n.pc) ?? 0) + 1);
      }

      if (!descriptor.isSeventh) {
        if (descriptor.isRootPosition && descriptor.thirdPc !== null) {
          const thirdCount = countByPc.get(descriptor.thirdPc) ?? 0;
          if (thirdCount > 1) {
            violations.push({
              ruleId: "doubling.third.root_position",
              severity: "warn",
              message: `Avoid doubling the third in root position triads (${chord.symbol}).`,
              measure: measureNumber,
              t,
              voices: chordNotes.filter((n) => n.pc === descriptor.thirdPc).map((n) => n.voice)
            });
          }
        }

        if (descriptor.isFirstInversion && descriptor.thirdPc !== null) {
          const thirdCount = countByPc.get(descriptor.thirdPc) ?? 0;
          if (thirdCount > 1) {
            violations.push({
              ruleId: "doubling.third.first_inversion",
              severity: "warn",
              message: `Avoid doubling the third when it is in the bass (${chord.symbol}).`,
              measure: measureNumber,
              t,
              voices: chordNotes.filter((n) => n.pc === descriptor.thirdPc).map((n) => n.voice)
            });
          }
        }
      }

      if (descriptor.isSeventh && descriptor.thirdPc !== null && descriptor.fifthPc !== null && descriptor.seventhPc !== null) {
        const missing: string[] = [];
        if (!countByPc.get(descriptor.rootPc)) missing.push("root");
        if (!countByPc.get(descriptor.thirdPc)) missing.push("third");
        if (!countByPc.get(descriptor.fifthPc)) missing.push("fifth");
        if (!countByPc.get(descriptor.seventhPc)) missing.push("seventh");

        if (descriptor.isRootPosition) {
          const missingNonFifth = missing.filter((tone) => tone !== "fifth");
          if (missingNonFifth.length) {
            violations.push({
              ruleId: "seventh.incomplete_root_position",
              severity: "warn",
              message: `Dominant seventh missing ${missingNonFifth.join(", ")} in root position (${chord.symbol}).`,
              measure: measureNumber,
              t
            });
          }
        } else if (missing.length) {
          violations.push({
            ruleId: "seventh.incomplete_inversion",
            severity: "warn",
            message: `Dominant seventh missing ${missing.join(", ")} in inversion (${chord.symbol}).`,
            measure: measureNumber,
            t
          });
        }
      }

      if (descriptor.seventhPc !== null) {
        for (const note of chordNotes) {
          if (note.pc !== descriptor.seventhPc) continue;
          const cache = voiceNoteCache[note.voice];
          if (!cache) continue;
          const idx = cache.indexByEvent.get(note.event);
          if (idx == null) continue;
          const next = cache.list[idx + 1];
          if (!next) continue;
          const delta = next.midi - note.midi;
          if (delta >= 0 || Math.abs(delta) > 2) {
            violations.push({
              ruleId: "resolution.seventh",
              severity: "warn",
              message: `Chordal seventh did not resolve downward by step in ${note.voice}.`,
              measure: measureNumber,
              t,
              voices: [note.voice]
            });
          }
        }
      }
    }
  }

  const strictness = normalizeStrictness(options.strictness, options.level);
  const finalViolations = applyStrictness(violations, strictness);

  return {
    rulesVersion: "choral-v1",
    violations: finalViolations,
    warnings
  };
}
