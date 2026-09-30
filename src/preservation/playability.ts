import type { ScoreModel } from "../score/types";
import { getInstrumentSpec } from "../instruments/instrumentCatalog";
import { pitchToMidi } from "../score/standard";

/**
 * Can a person actually play this part?
 *
 * The engine has always known the answer and never said it. It produced parts
 * that ran 248 beats — three and a half minutes — without a rest or a breath
 * mark anywhere, and nothing in the output remarked on it. The numbers needed
 * to catch that were all computed along the way and thrown out.
 *
 * So this is the arranger's own report on its work, per part, in the terms a
 * player would use: how much there is to play, how high and how low it goes,
 * and the longest stretch with no chance to take air.
 *
 * The final note is excluded from that stretch deliberately. A piece usually
 * ends on a held chord or a fermata, and the players agree a cutoff between
 * them; counting it would flag every arrangement ever written.
 *
 * Two things here go beyond describing the notes and actually judge them:
 * whether anything falls outside the instrument at all, and whether it sits
 * outside the register the instrument is comfortable in. The first is a
 * mistake. The second is a decision, which may be a good one — a brass
 * climax lives at the top of the horn on purpose — so it is reported and not
 * complained about.
 */

export type PartPlayability = {
  part: string;
  instrument: string;
  events: number;
  /** Null when the part is silent throughout. */
  lowSoundingMidi: number | null;
  highSoundingMidi: number | null;
  /** The longest run of sound with no rest and no breath mark, in quarter beats. */
  maxContinuousBeatsExceptFinal: number;
  breathMarks: number;
  /** Bars in which the part does not sound at all. */
  silentBars: number;
  totalBars: number;
  /** Notes the instrument cannot play. Anything above zero is a fault. */
  outOfRange: number;
  /** Notes outside the comfortable register — a decision, not necessarily a fault. */
  outsideComfortable: number;
};

export type PlayabilityAudit = {
  parts: PartPlayability[];
  /** The worst stretch without air in the whole score, and who plays it. */
  worst: { part: string; beats: number } | null;
  /** Notes no instrument in this score can play. Should be zero. */
  totalOutOfRange: number;
};

const EPS = 1e-9;

function soundingMidi(ev: any): number | null {
  const cached = Number(ev?.midi);
  if (Number.isFinite(cached)) return cached;
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/** Bar lengths in quarter beats, with the meter inherited until it changes. */
function barLengths(measures: any[], fallback = 4): number[] {
  const out: number[] = [];
  let meter = fallback;
  for (const m of measures ?? []) {
    const t = m?.attributes?.time;
    if (t && Number(t.beats) > 0 && Number(t.beat_type) > 0) {
      meter = (Number(t.beats) * 4) / Number(t.beat_type);
    }
    const stated = Number(m?.durationBeats);
    out.push(Number.isFinite(stated) && stated > 0 ? stated : meter);
  }
  return out;
}

export function buildPlayabilityAudit(score: ScoreModel): PlayabilityAudit {
  const parts: PartPlayability[] = [];
  let totalOutOfRange = 0;
  let worst: { part: string; beats: number } | null = null;

  for (const part of (score as any)?.parts ?? []) {
    const measures = part?.measures ?? [];
    const lengths = barLengths(measures);
    const spec = getInstrumentSpec(part?.instrument);

    // Every sounding span, laid on one timeline so a run can be followed
    // across barlines. A breath mark ends a span: the player takes the time
    // there even though the notation shows none.
    const spans: Array<[number, number, boolean]> = [];
    let at = 0;
    let events = 0, breathMarks = 0, silentBars = 0, outOfRange = 0, outsideComfortable = 0;
    let lo: number | null = null, hi: number | null = null;

    measures.forEach((m: any, i: number) => {
      // A drum hit is something a player plays. It was not counted at all —
      // only type "note" was — so a percussion part reported zero events and
      // read as an empty staff. That claim was made twice in one session, once
      // about the orchestra's percussion and once about the jazz band's drums,
      // and both parts were full of music.
      //
      // What it must NOT do is join the pitch or the breathing figures: an
      // unpitched note has no register to be outside of, and the breathing
      // question is already asked only of players who breathe.
      const notes = (m?.events ?? []).filter(
        (e: any) => (e?.type === "note" || e?.type === "unpitched") && !e.grace
      );
      if (!notes.length) silentBars++;
      for (const ev of notes) {
        events++;
        const midi = ev?.type === "unpitched" ? null : soundingMidi(ev);
        const dur = Number(ev.dur);
        const t = Number(ev.t);
        if (Number.isFinite(t) && Number.isFinite(dur) && dur > 0) {
          const breathes = Array.isArray(ev.articulations) && ev.articulations.includes("breath-mark");
          if (breathes) breathMarks++;
          spans.push([at + t, at + t + dur, breathes]);
        }
        if (midi === null) continue;
        lo = lo === null ? midi : Math.min(lo, midi);
        hi = hi === null ? midi : Math.max(hi, midi);
        if (spec) {
          if (midi < spec.midi_low || midi > spec.midi_high) outOfRange++;
          else if (
            (spec.preferred_low !== undefined && midi < spec.preferred_low) ||
            (spec.preferred_high !== undefined && midi > spec.preferred_high)
          ) outsideComfortable++;
        }
      }
      at += lengths[i] ?? 4;
    });

    // Merge into unbroken runs. Adjacent counts as continuous — a note ending
    // exactly where the next begins gives no air, whatever the notation says.
    spans.sort((a, b) => a[0] - b[0]);
    const runs: Array<[number, number]> = [];
    let cut = false;
    for (const [s, e, breathes] of spans) {
      const last = runs[runs.length - 1];
      if (last && !cut && s <= last[1] + EPS) last[1] = Math.max(last[1], e);
      else runs.push([s, e]);
      cut = breathes;
    }
    // Drop the last run: the close is a held chord the players cut off
    // together. But only when there is something else to measure — a part that
    // never breaks at all has exactly ONE run, and dropping it reported 0.00
    // beats for a line that plays the whole piece without stopping. The worst
    // case in the engine's history would have been recorded as perfect.
    const measured = runs.length > 1 ? runs.slice(0, runs.length - 1) : runs;
    const maxRun = measured.reduce((m, [s, e]) => Math.max(m, e - s), 0);

    totalOutOfRange += outOfRange;
    const name = String(part?.name ?? part?.part_id ?? "?");
    // Only players who breathe can be short of air. A piano sustains under the
    // pedal and a timpanist is not holding a note with their lungs, so a long
    // unbroken keyboard run is not a finding and must not become "the worst
    // part in the score".
    const breathes = !/piano|keyboard|organ|harp|timpani|percussion|drum|guitar/i.test(
      `${name} ${part?.instrument ?? ""}`
    );
    if (events && breathes && (!worst || maxRun > worst.beats)) worst = { part: name, beats: maxRun };

    parts.push({
      part: name,
      instrument: String(part?.instrument ?? ""),
      events,
      lowSoundingMidi: lo,
      highSoundingMidi: hi,
      maxContinuousBeatsExceptFinal: Math.round(maxRun * 100) / 100,
      breathMarks,
      silentBars,
      totalBars: measures.length,
      outOfRange,
      outsideComfortable,
    });
  }

  return { parts, worst, totalOutOfRange };
}

/** One line a person can read without opening the JSON. */
export function playabilitySentence(audit: PlayabilityAudit, quarterBpm?: number): string {
  if (!audit.parts.length) return "No parts to audit.";
  const bits: string[] = [];
  if (audit.worst) {
    const secs = quarterBpm ? ` (~${Math.round((audit.worst.beats * 60) / quarterBpm)}s)` : "";
    bits.push(
      `longest stretch without air is ${audit.worst.beats.toFixed(1)} beats${secs}, in ${audit.worst.part}`
    );
  }
  if (audit.totalOutOfRange) {
    bits.push(`${audit.totalOutOfRange} note(s) fall outside the instrument — that is a fault, not a choice`);
  }
  return bits.length ? bits.join("; ") + "." : "Every part is within range and breaks regularly.";
}
