/**
 * Give the lower strings the chart's own pulse.
 *
 * On a rhythm chart our cello and bass sustained: half their notes were a beat
 * or longer, sixty-one of them whole notes. The reference edition of the same
 * chart writes its cello 92% quarter-or-shorter and its bass 97%, and the shape
 * is always the same — every attack is an EIGHTH long, and the rhythm lives in
 * the spacing between them. Its bass is quarters apart in forty bars and a
 * two-feel in twenty-five. That is what a plucked foundation looks like, and it
 * is why marking our held notes "Pizz." would have been a lie about them.
 *
 * The rhythm is not invented here. A slash bar is the chart saying "play the
 * chord, THIS rhythm", so the attack points are read off the slashes: 53 of
 * this source's 124 bars carry them.
 *
 * And it carries forward, because that is what a chart means. A band reads a
 * slash bar and keeps that feel until it is told otherwise — the bars in
 * between notate the melody, not a new instruction to the rhythm section.
 * Stopping at the slash bars left the bass pulsing for 33 bars and sustaining
 * through the rest, a groove that keeps stopping; the reference's bass plays
 * short notes in 123 of its 124 bars.
 *
 * The pitches are not changed either — each attack takes whatever that part was
 * already sounding at that moment. This only decides how long the notes are and
 * where they fall.
 */

/** How long a plucked attack lasts, whatever the gap after it. */
const PLUCK_BEATS = 0.5;

const LOWER_STRINGS = /^(cello|violoncello|double bass|contrabass)\b/i;

export type PulsePlan = { part: string; bars: number; attacks: number };

/** The distinct onsets a bar's slashes ask for, in order. */
function slashOnsets(measure: any): number[] {
  const out = new Set<number>();
  for (const e of measure?.events ?? []) {
    if (e?.type !== "note") continue;
    if (String(e.notehead ?? "").toLowerCase() !== "slash") continue;
    const t = Number(e.t);
    if (Number.isFinite(t)) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

/** Which pitch a part is sounding at a given moment in one of its bars. */
function soundingAt(measure: any, t: number): any | null {
  let best: any = null;
  for (const e of measure?.events ?? []) {
    if (e?.type !== "note" || e.grace) continue;
    const start = Number(e.t);
    const end = start + Number(e.dur);
    if (start <= t + 1e-9 && t < end - 1e-9) {
      // The lowest sounding note: these are bass parts, and a divisi upper note
      // is not what the foundation should pluck.
      if (!best || Number(e.midi ?? Infinity) < Number(best.midi ?? Infinity)) best = e;
    }
  }
  return best;
}

export function pulseLowerStrings(outParts: any[], source: any): PulsePlan[] {
  const sourceMeasures: any[] = source?.measures ?? [];
  if (!sourceMeasures.length) return [];
  const plans: PulsePlan[] = [];

  for (const part of outParts ?? []) {
    if (!LOWER_STRINGS.test(String(part?.name ?? ""))) continue;
    const measures: any[] = part?.measures ?? [];
    let bars = 0;
    let attacks = 0;

    // The feel in force. A slash bar sets it; later bars keep it until the next
    // one says otherwise, which is what "simile" asks for.
    let feel: number[] = [];
    for (let i = 0; i < measures.length && i < sourceMeasures.length; i++) {
      const stated = slashOnsets(sourceMeasures[i]);
      if (stated.length >= 2) feel = stated;
      const onsets = feel;
      if (onsets.length < 2) continue;          // nothing asked for yet
      const m = measures[i];
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
      if (!notes.length) continue;              // the part is resting here

      // The bar's length, so the last attack cannot run past the barline.
      const time = m?.attributes?.time;
      const barLen = time && Number(time.beats) > 0 && Number(time.beat_type) > 0
        ? (Number(time.beats) * 4) / Number(time.beat_type)
        : 4;

      const struck: any[] = [];
      onsets.forEach((t, k) => {
        const under = soundingAt(m, t);
        if (!under) return;
        // An eighth, or the gap before the next attack when that is shorter.
        // Some slash rhythms are closer than an eighth apart, and writing a
        // fixed length into those produced notes overlapping inside one part —
        // two of them in this source, in a line one player bows.
        const next = k + 1 < onsets.length ? onsets[k + 1]! : barLen;
        const dur = Math.max(0.125, Math.min(PLUCK_BEATS, next - t));
        if (dur <= 0) return;
        struck.push({
          ...JSON.parse(JSON.stringify(under)),
          id: `${part.part_id ?? "p"}-pulse-${i}-${t}`,
          t,
          dur,
          // A tie into or out of a plucked attack makes no sense.
          tieStart: undefined,
          tieStop: undefined,
        });
      });
      if (struck.length < 2) continue;

      const others = (m?.events ?? []).filter((e: any) => !(e?.type === "note" && !e.grace));
      m.events = [...others, ...struck].sort((a: any, b: any) => Number(a.t) - Number(b.t));
      bars++;
      attacks += struck.length;
    }
    if (bars) plans.push({ part: String(part.name), bars, attacks });
  }
  return plans;
}

/** One line naming what was re-struck and where. */
export function pulseSentence(plans: PulsePlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} ${p.attacks} attacks over ${p.bars} bars`);
  return (
    `[strings] The lower strings take the chart's own rhythm where it writes slashes: ${bits.join(", ")}. ` +
    `Short notes, the chart's spacing, and the pitches the voicing already chose.`
  );
}
