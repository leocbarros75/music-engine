import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";

/**
 * The violins break the chord where the tune stops.
 *
 * Giving a tune-less bar a real slice grid got the strings moving rhythmically
 * — four attacks instead of one held note — but they were four attacks on the
 * SAME note, because the voicing search is rewarded for minimal motion and has
 * no reason to go anywhere inside a static chord.
 *
 * Measured over the reference edition's 30 such bars, that is right for the
 * lower strings and wrong for the violins:
 *
 *   Violin 1   22 of 30 bars with moving pitch, 2.1 distinct pitches
 *   Violin 2   20 of 30                       , 2.3
 *   Viola       0 of 30                       , 1.0
 *   Cello       3 of 30                       , 1.1
 *   Double Bass 0 of 30                       , 1.0
 *
 * So the figure belongs to the violins alone; underneath them the chord is
 * held. Two distinct pitches is what the reference averages, not a long
 * arpeggio, so this alternates: on-beat attacks keep the pitch the voicing
 * chose, and the ones between step to the next chord tone.
 *
 * This is the one pass here that writes a note nobody chose, so it invents as
 * little as it can. The pitch it moves to is a chord tone already sounding
 * somewhere in the section at that moment — the harmony is the voicing's, and
 * only the order is new.
 */

const VIOLINS = /^(violin i{1,2}\b|violin [12]\b|vln)/i;

/** How far the figure may stray from the register the voicing picked. */
const MAX_REACH = 12;

export type FigurationPlan = { part: string; bars: number; notes: number };

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/** The nearest pitch above `from` whose pitch class is one of the chord's. */
function nextChordTone(from: number, pcs: Set<number>, ceiling: number): number | null {
  for (let m = from + 1; m <= Math.min(ceiling, from + MAX_REACH); m++) {
    if (pcs.has(((m % 12) + 12) % 12)) return m;
  }
  return null;
}

/**
 * Break the chord in the violins through the bars the melody leaves empty.
 *
 * `gapBars` is indexed by measure position, as the arranger's own gap array is.
 */
export function breakChordsInGaps(parts: any[], gapBars: boolean[]): FigurationPlan[] {
  const strings = (parts ?? []).filter((p) =>
    /^(violin|viola|cello|violoncello|double bass|contrabass)/i.test(String(p?.name ?? ""))
  );
  if (!strings.length) return [];
  const violins = strings.filter((p) => VIOLINS.test(String(p.name)));
  if (!violins.length) return [];

  // Violin I's own line is the ceiling for Violin II, so the figure cannot put
  // the second violin above the first.
  const first = violins.find((p) => /i\b|1\b/.test(String(p.name).toLowerCase()));

  const out: FigurationPlan[] = [];

  for (const part of violins) {
    const isSecond = part !== first;
    let barsTouched = 0;
    let moved = 0;

    for (let bar = 0; bar < (part.measures ?? []).length; bar++) {
      if (!gapBars[bar]) continue;
      const m = part.measures[bar];
      const notes = (m?.events ?? [])
        .filter((e: any) => e?.type === "note" && !e.grace)
        .sort((a: any, b: any) => Number(a.t) - Number(b.t));
      if (notes.length < 2) continue;

      // The chord as the section is actually voicing it in this bar.
      const pcs = new Set<number>();
      for (const other of strings) {
        for (const e of (other.measures?.[bar]?.events ?? [])) {
          if (e?.type !== "note" || e.grace) continue;
          const v = eventMidi(e);
          if (v !== null) pcs.add(((v % 12) + 12) % 12);
        }
      }
      if (pcs.size < 2) continue;              // a unison is nothing to break

      let touched = false;
      for (let i = 1; i < notes.length; i += 2) {
        const e = notes[i]!;
        if (e.tieStart || e.tieStop) continue;
        const cur = eventMidi(e);
        if (cur === null) continue;

        // Never above the first violin at that moment.
        let ceiling = cur + MAX_REACH;
        if (isSecond && first) {
          const above = (first.measures?.[bar]?.events ?? [])
            .filter((x: any) => x?.type === "note" && !x.grace)
            .map(eventMidi)
            .filter((v: any): v is number => v !== null);
          if (above.length) ceiling = Math.min(ceiling, Math.min(...above));
        }

        const next = nextChordTone(cur, pcs, ceiling);
        if (next === null || next === cur) continue;
        e.pitch = midiToPitch(next);
        moved++;
        touched = true;
      }
      if (touched) barsTouched++;
    }

    if (moved) out.push({ part: String(part.name), bars: barsTouched, notes: moved });
  }
  return out;
}

/** One line naming where the figure was written. */
export function gapFigurationSentence(plans: FigurationPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} ${p.notes} notes over ${p.bars} bars`);
  return (
    `[strings] The violins break the chord where the melody rests: ${bits.join(", ")}. ` +
    `Off-beat attacks step to the next chord tone the section is already sounding, so the ` +
    `harmony is the voicing's and only the order is new; the lower strings hold, as they do ` +
    `in the reference.`
  );
}
