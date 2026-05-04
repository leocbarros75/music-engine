// src/arrange/mapToFullOrchestra.ts
import type { ScoreModel } from "../score/types";
import { clampPitchToInstrumentRange, pitchToMidi } from "../instruments/instrumentCatalog";
import { applyParticipationByPhrase, type ParticipationRules } from "./applyParticipation";
import { enforceRanges } from "./enforceRanges";

type Section = "strings" | "woodwinds" | "brass" | "percussion";

export type FullOrchestraOptions = {
  profile?: "classical";
  blockMeasures?: number; // 2/4 typical, we treat this as phraseLen for now
  targets?: Partial<Record<Section, number>>;
};

type ScoreEvent = any;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isNote(ev: any): boolean {
  return ev && ev.type === "note" && ev.pitch && typeof ev.pitch.step === "string" && typeof ev.pitch.octave === "number";
}

/**
 * Minimum note-duration floor (in ScoreModel divisions, 4 = 1 quarter note) per instrument.
 * Brass instruments should sustain half notes; inner woodwinds: quarter notes;
 * timpani: one hit per measure (whole note = 16 divs in 4/4).
 * Strings and flute carry the melody/texture unchanged (return 0 → no floor).
 */
function minDurForInstrument(instrument: string): number {
  switch (instrument) {
    case "trumpet_bb_1":
    case "trumpet_bb_2":
    case "horn_f":
    case "trombone":
    case "tuba_c":
      return 8;   // half note (4 divs/beat × 2)
    case "oboe":
    case "clarinet_bb":
    case "bassoon":
      return 4;   // quarter note
    case "timpani":
      return 16;  // downbeat hit only (whole note)
    default:
      return 0;   // violin, viola, cello, flute — no floor
  }
}

/**
 * Drop notes whose onset is within `minDur` divisions of the previous kept note
 * and extend each kept note's duration to at least `minDur`.
 * This ensures brass/woodwind inner parts don't end up with unplayable fast passages.
 */
function simplifyToMinDuration(events: ScoreEvent[], minDur: number): ScoreEvent[] {
  if (!minDur) return events;
  const notes  = (events ?? []).filter(isNote).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const others = (events ?? []).filter((e) => !isNote(e));
  if (!notes.length) return others;

  const kept: ScoreEvent[] = [];
  let lastKeptT = -Infinity;

  for (const ev of notes) {
    const t = ev.t ?? 0;
    if (t - lastKeptT >= minDur) {
      kept.push({ ...ev, dur: Math.max(ev.dur ?? minDur, minDur) });
      lastKeptT = t;
    }
    // Notes closer than minDur to the last kept note are silently dropped —
    // they would be impractical to play at any reasonable tempo.
  }

  return kept;
}

function groupEventsByTime(events: ScoreEvent[]): Map<number, ScoreEvent[]> {
  const m = new Map<number, ScoreEvent[]>();
  for (const ev of events ?? []) {
    const t = typeof ev.t === "number" ? ev.t : 0;
    const arr = m.get(t) ?? [];
    arr.push(ev);
    m.set(t, arr);
  }
  return m;
}

function pickByRegister(eventsAtTime: ScoreEvent[], which: "high" | "mid" | "low"): ScoreEvent[] {
  const notes = (eventsAtTime ?? []).filter(isNote);
  const others = (eventsAtTime ?? []).filter((e) => !isNote(e));

  if (notes.length === 0) return [...others];

  const sorted = [...notes].sort((a, b) => pitchToMidi(a.pitch) - pitchToMidi(b.pitch));

  let chosen: ScoreEvent;
  if (which === "low") chosen = sorted[0];
  else if (which === "high") chosen = sorted[sorted.length - 1];
  else chosen = sorted[Math.floor(sorted.length / 2)];

  return [chosen, ...others.filter((e) => e.type !== "rest")];
}

function mapMeasureEvents(
  srcEvents: ScoreEvent[],
  instrumentId: string,
  role: "melody" | "inner" | "bass"
): ScoreEvent[] {
  const byTime = groupEventsByTime(srcEvents ?? []);
  const out: ScoreEvent[] = [];

  const times = [...byTime.keys()].sort((a, b) => a - b);
  for (const t of times) {
    const slice = byTime.get(t) ?? [];
    const picked =
      role === "bass" ? pickByRegister(slice, "low") : role === "melody" ? pickByRegister(slice, "high") : pickByRegister(slice, "mid");

    for (const ev of picked) {
      if (isNote(ev)) {
        const p2 = clampPitchToInstrumentRange(ev.pitch, instrumentId);
        out.push({ ...ev, pitch: p2 });
      } else {
        out.push(ev);
      }
    }
  }

  // Apply playability floor: brass need half-note minima, inner woodwinds quarter-note, etc.
  const minDur = minDurForInstrument(instrumentId);
  return simplifyToMinDuration(out, minDur);
}

function getFirstPart(score: ScoreModel): any | null {
  const parts = (score as any)?.parts ?? [];
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return parts[0];
}

function buildPartFromSource(
  score: ScoreModel,
  srcPart: any,
  part_id: string,
  name: string,
  instrument: string,
  role: "melody" | "inner" | "bass"
): any {
  const srcMeasures = srcPart?.measures ?? [];
  const measures = (srcMeasures ?? []).map((m: any) => {
    const events = mapMeasureEvents(m?.events ?? [], instrument, role);
    return { ...clone(m), events };
  });

  return {
    part_id,
    name,
    instrument,
    staves: 1,
    measures
  };
}

/**
 * Map a piano (or any single source part) ScoreModel into a full orchestra scaffold,
 * then apply classical participation + range enforcement.
 *
 * - Concert pitch (no transposition handling yet)
 * - Participation only when profile === "classical"
 * - Phrase length uses blockMeasures (2/4/8), default 2
 */
export function mapPianoToFullOrchestraOpen(score: ScoreModel, opts: FullOrchestraOptions = {}): ScoreModel {
  const profile = opts.profile ?? "classical";
  const blockMeasures = opts.blockMeasures ?? 2;

  const targets = {
    strings: typeof opts.targets?.strings === "number" ? opts.targets.strings : 0.9,
    woodwinds: typeof opts.targets?.woodwinds === "number" ? opts.targets.woodwinds : 0.4,
    brass: typeof opts.targets?.brass === "number" ? opts.targets.brass : 0.3,
    percussion: typeof opts.targets?.percussion === "number" ? opts.targets.percussion : 0.2
  };

  const srcPart = getFirstPart(score);
  if (!srcPart) return score;

  // Desired internal part order (your pipeline output uses this order)
  const orchestraParts = [
    { id: "V1", name: "Violin I", instrument: "violin", role: "melody" as const },
    { id: "V2", name: "Violin II", instrument: "violin", role: "inner" as const },
    { id: "VA", name: "Viola", instrument: "viola", role: "inner" as const },
    { id: "VC", name: "Cello", instrument: "cello", role: "bass" as const },

    { id: "FL", name: "Flute", instrument: "flute", role: "melody" as const },
    { id: "OB", name: "Oboe", instrument: "oboe", role: "inner" as const },
    { id: "CL", name: "Clarinet in Bb", instrument: "clarinet_bb", role: "inner" as const },
    { id: "BN", name: "Bassoon", instrument: "bassoon", role: "bass" as const },

    { id: "TPT1", name: "Trumpet 1", instrument: "trumpet_bb_1", role: "inner" as const },
    { id: "TPT2", name: "Trumpet 2", instrument: "trumpet_bb_2", role: "inner" as const },
    { id: "HN", name: "Horn", instrument: "horn_f", role: "inner" as const },
    { id: "TBN", name: "Trombone", instrument: "trombone", role: "bass" as const },
    { id: "TUBA", name: "Tuba", instrument: "tuba_c", role: "bass" as const },

    // “DRUMS” in your system is an unpitched container; we keep it but it will likely rest in classical
    { id: "DRUMS", name: "Percussion", instrument: "drums", role: "inner" as const },
    { id: "TIMP", name: "Timpani", instrument: "timpani", role: "bass" as const }
  ];

  const mappedParts = orchestraParts.map((p) => buildPartFromSource(score, srcPart, p.id, p.name, p.instrument, p.role));

  let out: ScoreModel = {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "full_orchestra" },
    parts: mappedParts
  };

  // Participation (classical only)
  if (profile === "classical") {
    const rules: ParticipationRules = {
      weights: {
        strings: targets.strings,
        woodwinds: targets.woodwinds,
        brass: targets.brass,
        percussion: targets.percussion
      },
      phraseLen: (blockMeasures === 2 || blockMeasures === 4 || blockMeasures === 8 ? blockMeasures : 2) as 2 | 4 | 8,
      maxActive: {
        strings: 4,
        woodwinds: 2,
        brass: 2,
        percussion: 1
      },
      rotation: { repeatPenalty: 0.45 }
    };

    out = applyParticipationByPhrase(out, rules, 12345);
  }

  // Range enforcement (always safe, but you can later gate by profile if you want)
  out = enforceRanges(out);

  return out;
}