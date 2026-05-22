// src/rhythm/preserveFinalMeasuresRhythm.ts
//
// After harmonisation and any rhythm processing, lock all non-soprano voices
// in the final N measures to the SAME rhythmic grid as the soprano (melody).
//
// This enforces the standard choral rule: the closing cadence is homorhythmic —
// all voices land together on the same beats as the melody, giving a clean,
// conclusive ending regardless of what independent activity was applied to
// the inner voices in the body of the piece.

import type { ScoreModel } from "../score/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function isNoteOrRest(e: any): boolean {
  return (
    e != null &&
    (e.type === "note" || e.type === "rest") &&
    typeof e.t === "number" &&
    typeof e.dur === "number"
  );
}

/** Return the average MIDI pitch of all note events in a part. */
function averageMidi(part: any): number | null {
  const vals: number[] = [];
  for (const m of part?.measures ?? []) {
    for (const e of m?.events ?? []) {
      if (e?.type === "note" && typeof e.midi === "number") vals.push(e.midi);
    }
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Find the melody part (soprano by name, or highest-pitch part). */
function findMelodyPart(score: ScoreModel): { part: any; index: number } | null {
  const parts = score.parts ?? [];
  if (!parts.length) return null;

  const MELODY_NAMES = ["soprano", "melody", "voice 1", "voice1"];
  for (let i = 0; i < parts.length; i++) {
    const n = String(parts[i]?.name ?? "").toLowerCase();
    if (MELODY_NAMES.some((k) => n.includes(k))) return { part: parts[i], index: i };
  }

  // Fall back to highest-average-pitch part
  let bestIdx = 0;
  let bestAvg = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const avg = averageMidi(parts[i]);
    if (avg !== null && avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }
  const part = parts[bestIdx];
  return part ? { part, index: bestIdx } : null;
}

/**
 * Find the note/rest event in `events` whose sounding window covers beat `t`.
 * Prefers an event whose onset is exactly `t`; falls back to any note still
 * ringing at that time; finally falls back to the last note that started
 * before `t` (useful when the inner voice has longer note values).
 */
function findPitchAt(events: any[], t: number): any | null {
  const EPS = 1e-6;

  // Exact onset match
  const exact = events.find(
    (e) => e?.type === "note" && Math.abs(Number(e.t) - t) < EPS
  );
  if (exact) return exact;

  // Note sounding at t (t is inside [onset, onset+dur))
  const spanning = events.find(
    (e) =>
      e?.type === "note" &&
      Number(e.t) <= t + EPS &&
      t < Number(e.t) + Number(e.dur) - EPS
  );
  if (spanning) return spanning;

  // Last note that started before t (hold the pitch)
  let best: any = null;
  let bestT = -Infinity;
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e.t);
    if (et <= t + EPS && et > bestT) {
      best = e;
      bestT = et;
    }
  }
  return best;
}

// ─── main export ─────────────────────────────────────────────────────────────

/**
 * Lock the last `numMeasures` of every non-soprano part to the soprano's
 * rhythmic grid.  Pitches (MIDI + spelling) are taken from whatever note the
 * voice had sounding at each soprano onset — so harmony is preserved, only
 * note lengths are adjusted.
 *
 * Mutates `score` in place.  Safe to call multiple times (idempotent after
 * the first run, assuming soprano rhythm is stable).
 */
export function preserveFinalMeasuresRhythm(
  score: ScoreModel,
  numMeasures = 2,
  warnings: string[] = []
): void {
  const parts = score.parts ?? [];
  if (parts.length < 2) return; // nothing to align

  const melodyInfo = findMelodyPart(score);
  if (!melodyInfo) return;

  const { part: melodyPart, index: melodyIndex } = melodyInfo;
  const melMeasures = melodyPart.measures ?? [];
  const totalMeasures = melMeasures.length;
  if (totalMeasures === 0) return;

  const startMi = Math.max(0, totalMeasures - numMeasures);

  let anyApplied = false;

  for (let mi = startMi; mi < totalMeasures; mi++) {
    const melM = melMeasures[mi];
    if (!melM) continue;

    // Soprano's note/rest events sorted by onset
    const soprEvents = (melM.events ?? [])
      .filter(isNoteOrRest)
      .sort((a: any, b: any) => Number(a.t) - Number(b.t));

    if (!soprEvents.length) continue;

    for (let pi = 0; pi < parts.length; pi++) {
      if (pi === melodyIndex) continue; // skip melody itself

      const part = parts[pi];
      const measure = part?.measures?.[mi];
      if (!measure) continue;

      const existingNotes = (measure.events ?? []).filter(isNoteOrRest);
      const otherEvents  = (measure.events ?? []).filter((e: any) => !isNoteOrRest(e));

      if (!existingNotes.length) continue; // nothing to reshape

      const newEvents: any[] = [];
      const measureNumber = Number(measure.number ?? mi + 1);

      for (let j = 0; j < soprEvents.length; j++) {
        const tmpl = soprEvents[j] as any;
        const t   = Number(tmpl.t);
        const dur = Number(tmpl.dur);

        if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;

        const source = findPitchAt(existingNotes, t);
        const idStr  = `pfmr_p${pi}_m${measureNumber}_j${j}`;

        if (!source || source.type === "rest" || source.isRest) {
          // No pitch available at this beat → emit a rest
          newEvents.push({
            id: idStr,
            t,
            dur,
            type: "rest",
            voice: existingNotes[0]?.voice ?? 2,
            staff: existingNotes[0]?.staff ?? 1,
            isRest: true,
          });
        } else {
          newEvents.push({
            id: idStr,
            t,
            dur,
            type: "note",
            voice: source.voice,
            staff: source.staff,
            pitch: source.pitch,
            midi: source.midi,
          });
        }
      }

      // Combine with non-note events (attributes, barlines, etc.)
      measure.events = [...otherEvents, ...newEvents].sort(
        (a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0)
      );
      anyApplied = true;
    }
  }

  if (anyApplied) {
    warnings.push(
      `[cadence] Last ${numMeasures} measure(s): all voices locked to soprano rhythm (homorhythmic cadence).`
    );
  }
}
