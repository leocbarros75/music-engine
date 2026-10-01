/**
 * Say whether the lower strings are plucking or bowing.
 *
 * The engine wrote neither word, ever. On a chart that matters: the reference
 * edition of one marks "Pizz." seven times and "Arco" seven times, and more
 * than a third of its events are plucked — "pizzicato harmonic foundation"
 * (374 of them), "pizzicato cello pulse" (275), "pizzicato backbeat" (85). A
 * cello reading an unmarked part plays it with the bow, which is a different
 * sound from the one the arrangement is reaching for.
 *
 * Marked only where it is TRUE. You do not pluck a whole note, so the word
 * follows the writing rather than being asserted over it: a run of short notes
 * is plucked, and the bow comes back when the part starts sustaining again. Our
 * lower strings are about half short notes and half held ones on a chart, so
 * both words get used.
 *
 * Only the cello and the bass. Plucked violins are a particular effect rather
 * than a default, and nothing here has established when to ask for one.
 *
 * And only on a CHART. The first version asked for pizzicato wherever the lower
 * strings played short notes, which marked a baroque arrangement whose cello is
 * 89% quarter notes — but that is a walking continuo line and it is played with
 * the bow. The evidence for plucking is one pop rhythm chart, so that is as far
 * as the rule goes; a score says nothing about whether its short notes want a
 * pluck, and guessing made the engine wrong about Bach.
 */

export type PizzPlan = { part: string; switches: number };

/** The longest note that still reads as a pluck rather than a sustain. */
const SHORT_BEATS = 1;
/**
 * How many bars a texture must hold before it is worth a word.
 *
 * Without this the part flips on every passing long note, and a player reading
 * "Pizz./Arco/Pizz." three bars running puts the instrument down in disgust.
 */
const MIN_BARS = 4;

const LOWER_STRINGS = /^(cello|violoncello|double bass|contrabass)\b/i;

/**
 * Write a direction over this bar of THIS part, and no other.
 *
 * Copy-on-write, because the parts are built by shallow-copying measures: the
 * measure objects are distinct but they share one `performance` object between
 * them. Pushing into it put "Pizz." over the violins as well — all five parts
 * came back carrying the cello's marks.
 */
function addWords(measure: any, text: string): void {
  const perf = { ...(measure.performance ?? {}) } as any;
  const words: any[] = Array.isArray(perf.words) ? [...perf.words] : [];
  if (words.some((w) => String(w?.text ?? "") === text)) return;
  words.push({ t: 0, text, placement: "above" });
  perf.words = words;
  measure.performance = perf;
}

/**
 * Mark the plucked and bowed stretches of the lower strings.
 *
 * Returns what it marked, per part, so the caller can report it rather than
 * claim it ran.
 */
export function markPizzicato(parts: any[]): PizzPlan[] {
  const out: PizzPlan[] = [];

  for (const part of parts ?? []) {
    if (!LOWER_STRINGS.test(String(part?.name ?? ""))) continue;
    const measures: any[] = part?.measures ?? [];
    if (!measures.length) continue;

    // Is this bar plucked? A bar with nothing in it keeps whatever came before.
    const plucked: Array<boolean | null> = measures.map((m) => {
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
      if (!notes.length) return null;
      const short = notes.filter((e: any) => Number(e.dur) <= SHORT_BEATS + 1e-9).length;
      return short * 2 >= notes.length;        // mostly short = plucked
    });

    // Smooth it: a stretch shorter than MIN_BARS is absorbed by its neighbours,
    // so the part does not flip back and forth.
    const settled: Array<boolean | null> = plucked.slice();
    let i = 0;
    while (i < settled.length) {
      if (settled[i] === null) { i++; continue; }
      let j = i;
      while (j + 1 < settled.length && (settled[j + 1] === settled[i] || settled[j + 1] === null)) j++;
      const bars = j - i + 1;
      if (bars < MIN_BARS) {
        // Hand the stretch to whichever side already has a state.
        const before = i > 0 ? settled[i - 1] : null;
        const after = j + 1 < settled.length ? settled[j + 1] : null;
        const take = before !== null ? before : after;
        if (take !== null) for (let k = i; k <= j; k++) settled[k] = take;
      }
      i = j + 1;
    }

    let current: boolean | null = null;
    let switches = 0;
    let plucked_yet = false;
    for (let b = 0; b < settled.length; b++) {
      const state = settled[b];
      if (state === null || state === current) continue;
      // "Arco" before any "Pizz." tells a player to do what they were already
      // doing. The bow is the default; only say otherwise, and only say when to
      // come back from it.
      if (!state && !plucked_yet) { current = state; continue; }
      addWords(measures[b], state ? "Pizz." : "Arco");
      if (state) plucked_yet = true;
      current = state;
      switches++;
    }
    if (switches) out.push({ part: String(part.name), switches });
  }
  return out;
}

/** One line for the warnings, naming what was marked where. */
export function pizzicatoSentence(plans: PizzPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} ${p.switches}`);
  return (
    `[strings] Plucked and bowed stretches marked in the lower strings: ${bits.join(", ")} change(s). ` +
    `The word follows the writing — short notes are plucked, and the bow returns where the part sustains.`
  );
}
