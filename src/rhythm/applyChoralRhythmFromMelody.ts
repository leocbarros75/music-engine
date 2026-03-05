import type { ScoreModel } from "../score/types";

export type ApplyChoralRhythmResult = {
  applied: boolean;
  warnings: string[];
};

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // warnings only
  // eslint-disable-next-line no-console
  console.warn(msg);
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

function getMelodyPart(score: ScoreModel): { part: any; index: number; voice: number | null } | null {
  const parts = score.parts ?? [];
  if (!parts.length) return null;

  const findByName = (needle: string) =>
    parts.findIndex((p) => String(p?.name ?? "").toLowerCase().includes(needle));

  const preferByName = ["melody", "soprano", "voice"];
  for (const needle of preferByName) {
    const idx = findByName(needle);
    if (idx >= 0) {
      const part = parts[idx];
      if (!part) continue;
      return { part, index: idx, voice: detectMelodyVoice(part) };
    }
  }

  let bestIdx = 0;
  let bestAvg = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const avg = averageMidiForPart(parts[i]);
    if (avg !== null && avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }

  const part = parts[bestIdx];
  if (!part) return null;
  return { part, index: bestIdx, voice: detectMelodyVoice(part) };
}

function getOtherParts(score: ScoreModel, melodyIndex: number): any[] {
  const parts = score.parts ?? [];
  return parts.filter((_, i) => i !== melodyIndex);
}

function getMeasureNumber(m: any, fallback: number): number {
  const n = Number(m?.number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function findEventAtTime(events: any[], t: number): any | null {
  for (const e of events) {
    const et = Number(e.t);
    const ed = Number(e.dur);
    if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
    if (et <= t && t < et + ed) return e;
  }
  return events.find((e) => Number(e.t) === t) ?? null;
}

function findLastNoteBefore(events: any[], t: number): any | null {
  let best: any | null = null;
  let bestT = -Infinity;
  for (const e of events) {
    if (!e || e.type !== "note" || e.isRest) continue;
    const et = Number(e.t);
    if (!Number.isFinite(et)) continue;
    if (et <= t && et >= bestT) {
      best = e;
      bestT = et;
    }
  }
  return best;
}

function cloneWithRhythm(params: {
  source: any | null;
  template: any;
  idPrefix: string;
  voiceFallback?: number;
  staffFallback?: number;
}): any {
  const { source, template, idPrefix, voiceFallback = 1, staffFallback = 1 } = params;

  const t = Number(template?.t);
  const dur = Number(template?.dur);
  const baseVoice = Number(source?.voice);
  const baseStaff = Number(source?.staff);
  const voice = Number.isFinite(baseVoice) ? baseVoice : voiceFallback;
  const staff = Number.isFinite(baseStaff) ? baseStaff : staffFallback;

  const id = `${idPrefix}_${t}_${dur}`;
  if (!source || source.type === "rest" || source.isRest) {
    return { id, t, dur, type: "rest", voice, staff, isRest: true };
  }

  const pitch = source?.pitch;
  const midi = source?.midi;
  return {
    id,
    t,
    dur,
    type: "note",
    voice,
    staff,
    pitch,
    midi
  };
}

export function applyChoralRhythmFromMelody(score: ScoreModel): ApplyChoralRhythmResult {
  const warnings: string[] = [];
  const melodyInfo = getMelodyPart(score);

  if (!melodyInfo) {
    warn(warnings, "[rhythm] No melody part found. Choral accompaniment not applied.");
    return { applied: false, warnings };
  }

  const melodyPart = melodyInfo.part;
  const melodyVoice = melodyInfo.voice;
  const otherParts = getOtherParts(score, melodyInfo.index);

  if (!otherParts.length) {
    warn(warnings, "[rhythm] No inner/Bass parts found. Choral accompaniment not applied.");
    return { applied: false, warnings };
  }

  const melodyMeasures = melodyPart.measures ?? [];
  const measureCount = melodyMeasures.length;

  if (!measureCount) {
    warn(warnings, "[rhythm] Melody part has no measures. Choral accompaniment not applied.");
    return { applied: false, warnings };
  }

  for (let i = 0; i < measureCount; i++) {
    const melM = melodyMeasures[i];
    if (!melM) continue;

    const melEvents = (melM.events ?? [])
      .filter((e: any) => isNoteOrRest(e))
      .filter((e: any) => (melodyVoice === null || melodyVoice === undefined ? true : e?.voice === melodyVoice))
      .sort((a: any, b: any) => Number(a.t) - Number(b.t));

    if (!melEvents.length) continue;

    for (const part of otherParts) {
      const m = part?.measures?.[i];
      if (!m) continue;

      const measureNumber = getMeasureNumber(m, i + 1);
      const events = (m.events ?? []).filter((e: any) => isNoteOrRest(e));
      const other = (m.events ?? []).filter((e: any) => !isNoteOrRest(e));

      const nextEvents: any[] = [];
      for (let j = 0; j < melEvents.length; j++) {
        const template = melEvents[j];
        if (!template || !Number.isFinite(Number(template.t)) || !Number.isFinite(Number(template.dur))) continue;
        const t = Number(template.t);
        let source = findEventAtTime(events, t);
        if (!source || source.type === "rest" || source.isRest) {
          const fallback = findLastNoteBefore(events, t);
          if (fallback) source = fallback;
        }
        const idPrefix = `${part.part_id ?? part.name ?? "part"}_m${measureNumber}_i${j}`;
        nextEvents.push(cloneWithRhythm({ source, template, idPrefix }));
      }

      m.events = [...other, ...nextEvents].sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
    }
  }

  // eslint-disable-next-line no-console
  console.log("[rhythm] Choral accompaniment: copied melody rhythm to inner voices and Bass.");

  return { applied: true, warnings };
}
