import { densityCurve } from "../complementary";

/**
 * Let the accompanying voices sit out where the writing is thin.
 *
 * A string transcription of a piano piece had every one of its five parts
 * playing in all 62 bars. Nothing rested anywhere, and it is heard as
 * relentless long before it is seen in the notation.
 *
 * There is nothing in the source to inherit here: this piano plays continuously
 * in both hands for the whole piece — no bar without notes, no bar where the
 * right hand rests, not one beat of air. So which bars to sit out is an
 * orchestration decision, and the only honest basis for it in the source is how
 * THICK the writing is, bar by bar. Thin bars get fewer players.
 *
 * The figures come from the Codex piano-and-strings edition of the same song,
 * read as the share of bars each part sits out — but only the ones that survive
 * the change of role. Two do not:
 *
 *  - VIOLIN I rests 15 of 62 bars there, and must rest none here. In that
 *    edition the piano carries the song and the first violin is free to drop
 *    out; in a transcription it IS the song, and resting it drops the tune.
 *  - DOUBLE BASS rests 24 of 62 bars there, and rests fewer here, because the
 *    piano's left hand is no longer underneath it. Without a piano the cello
 *    and bass are the only foundation there is.
 *
 * The inner voices and the cello are doing the same job in both, so their
 * figures carry over directly: second violin 1 bar, viola 1, cello 8.
 *
 * This is the third time numbers have been moved between two arrangements of
 * this song, and twice before the numbers did not survive the move — wind
 * thresholds applied to strings rested Violin I in 44% of bars against a target
 * of 24%. Hence naming, each time, which figures transfer and why.
 */

export type AccompanyingVoice = "vln2" | "vla" | "vc" | "cb";

/**
 * The density below which each voice sits the bar out.
 *
 * Read against this source's own curve these give second violin 1 bar, viola 2,
 * cello 9 and double bass 14 — the Codex figures for the three voices whose job
 * is unchanged, and a little over half its bass.
 */
export const TRANSCRIPTION_REST_LEVELS: Record<AccompanyingVoice, number> = {
  vln2: 0.20,
  vla: 0.22,
  vc: 0.33,
  cb: 0.42,
};

/** Violin I is deliberately absent: it carries the melody and never rests. */
const VOICE_BY_NAME: Array<[RegExp, AccompanyingVoice]> = [
  [/violin\s*(ii\b|2\b)/i, "vln2"],
  [/viola/i, "vla"],
  [/violoncello|cello/i, "vc"],
  [/bass/i, "cb"],
];

function voiceOf(name: string): AccompanyingVoice | null {
  for (const [re, v] of VOICE_BY_NAME) if (re.test(name)) return v;
  return null;
}

/** Bar lengths in quarter beats, with the meter inherited until it changes. */
function barLengths(measures: any[]): number[] {
  const out: number[] = [];
  let meter = 4;
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

/**
 * Silence whole bars for the accompanying voices where the source is thinnest.
 *
 * `source` is the part the arrangement was made from, and the decision is about
 * the density of THAT writing rather than of the output. On the string route
 * this is the score's first part, which by the time it reaches here the pipeline
 * has renamed "Soprano" for the harmonizer — but it still carries the original
 * keyboard notes, both staves, 11 to 17 to the bar. Checked: the curve computed
 * here is identical to the one computed from the raw piano before parsing ever
 * reaches the harmonizer. Pass a genuinely monophonic line instead and this
 * measures melodic busyness, which is a different thing and not what the
 * thresholds below were fitted to.
 *
 * Returns the bars actually rested per part, so the caller can report what it
 * did rather than that it ran.
 */
export function restThinBars(
  outParts: any[],
  source: any,
  levels: Record<AccompanyingVoice, number> = TRANSCRIPTION_REST_LEVELS
): Map<string, number[]> {
  const rested = new Map<string, number[]>();
  const density = densityCurve(source?.measures ?? []);
  if (!density.length) return rested;

  for (const part of outParts ?? []) {
    const name = String(part?.name ?? "");
    const voice = voiceOf(name);
    if (!voice) continue;
    const level = levels[voice];
    const measures = part?.measures ?? [];
    const lengths = barLengths(measures);
    // The closing bar is left alone whatever its density: a final chord wants
    // its bass, and a piece that ends by subtraction sounds like it stopped
    // rather than finished.
    const limit = Math.min(measures.length - 1, density.length);
    const bars: number[] = [];

    for (let i = 0; i < limit; i++) {
      if (density[i]! >= level) continue;
      const m = measures[i];
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note");
      if (!notes.length) continue;

      // A tie into a bar that is about to fall silent would be left hanging, so
      // release it in the bar before.
      const prev = measures[i - 1];
      if (prev) {
        for (const e of prev.events ?? []) if (e?.tieStart) delete e.tieStart;
      }

      m.events = [{
        id: `${voice}-rest-${m?.number ?? i + 1}`,
        t: 0,
        dur: lengths[i] ?? 4,
        type: "rest",
        voice: 1,
        staff: 1,
        isRest: true,
      }];
      bars.push(Number(m?.number ?? i + 1));
    }
    if (bars.length) rested.set(name, bars);
  }
  return rested;
}

/** One line naming who sits out and where, for the warnings the player reads. */
export function restArcSentence(rested: Map<string, number[]>): string | null {
  if (!rested.size) return null;
  const bits = [...rested.entries()].map(([n, b]) => `${n} ${b.length}`);
  return (
    `[strings] The writing thins in places, so the lower voices sit out there: ` +
    `${bits.join(", ")} bars. Violin I plays throughout — it carries the tune.`
  );
}
