import { pitchToMidi, midiToPitch } from "../../instruments/instrumentCatalog";
import { WOODWIND_RANGES, type WoodwindVoiceId } from "./woodwindRanges";

/**
 * Let the upper winds take turns with the tune.
 *
 * The mapping onto the voicing search is fixed: Violin I becomes the flute,
 * Violin II the oboe, the viola the clarinet. So the flute carries the melody
 * for the whole piece and the clarinet reads an inner voice for the whole
 * piece — on a 124-bar chart that left it moving inside eight semitones, 66 to
 * 74, while the reference edition's clarinet covers twenty-two and takes the
 * lead twice. A part that never leads is a part nobody wrote for.
 *
 * That edition shares the tune around. Measuring which upper voice is on top
 * across its 124 bars, eight bars at a time, gives flute 12 blocks, oboe 3,
 * clarinet 1 — the flute is firmly the principal, and the other two take a
 * phrase each. The rotation below keeps that proportion rather than splitting
 * the tune evenly, which would make the flute a third of a melody instrument.
 *
 * Note what this does and does not explain. The reference clarinet leads for
 * one block yet covers twenty-two semitones, so most of its range comes from an
 * inner line that actually moves, not from leading. Sharing the tune is worth
 * doing on its own terms; it is not the whole of that difference.
 *
 * Nothing is composed here. Both lines already exist; this swaps which player
 * reads which, a block of bars at a time. The density travels with the role,
 * because the melody line is the busy one and the inner line is the thinned
 * one — so whoever holds the tune is the active voice in that block.
 */

/** How long one player keeps the tune. Eight bars is a phrase in most music. */
const BLOCK_BARS = 8;

type Lead = Extract<WoodwindVoiceId, "fl" | "ob" | "cl">;

/**
 * Who leads, block by block, repeating: flute three times in four, with the
 * oboe and clarinet each taking one block of eight. Over sixteen blocks that is
 * flute 12, oboe 2, clarinet 2 — the reference's 12 / 3 / 1.
 */
const ROTATION: Lead[] = ["fl", "ob", "fl", "fl", "fl", "cl", "fl", "fl"];

const MATCH: Record<Lead, RegExp> = {
  fl: /^flute/i,
  ob: /^oboe/i,
  cl: /^clarinet/i,
};

export type SharePlan = { lead: string; blocks: number };

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/**
 * Move a stretch by whole octaves if — and only if — the receiving instrument
 * cannot reach it as written.
 *
 * Placing by PREFERRED register instead would drop the tune an octave whenever
 * it climbed past the oboe's or clarinet's sweet-spot ceiling, which sounds
 * like the right instinct and is not: it puts the melody underneath the line
 * accompanying it, and the texture turns inside out. The melody has already
 * been clamped into the flute's sweet spot, and the three upper sweet spots
 * overlap across most of it, so the usual answer is to leave it where it is.
 *
 * The cost is real and worth naming. On the 124-bar chart this was measured
 * against, the clarinet's lead leaves 8 of its 457 notes — 1.8% — above its
 * preferred ceiling, topping out at written F#6. That is playable and ordinary
 * in repertoire, but the reference edition's clarinet never goes there: it drops
 * the tune the octave and thins the flute underneath so the texture still works.
 * Thinning the flute under a borrowed melody is the missing half of that, and it
 * is not done here.
 */
function placeForInstrument(measures: any[], from: number, to: number, voice: Lead): number {
  const range = WOODWIND_RANGES[voice];

  const midis: number[] = [];
  for (let i = from; i < to; i++) {
    for (const e of measures[i]?.events ?? []) {
      if (e?.type !== "note" || e.grace) continue;
      const m = eventMidi(e);
      if (m !== null) midis.push(m);
    }
  }
  if (!midis.length) return 0;

  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  if (lo >= range.absMin && hi <= range.absMax) return 0;   // reachable as written

  // It is not reachable. Take the SMALLEST move that makes it playable, with the
  // preferred register deciding only between two moves of the same size.
  //
  // Picking the best preferred fit outright instead sends a line two octaves down
  // when one octave would already have been playable — the oboe's sweet spot is
  // 61–79, so a borrowed flute line at 92–97 scores better at −24 than at −12 and
  // lands an octave below the tune. Playability is the constraint here; register
  // is not a reason to keep moving once the notes are reachable.
  const strain = (shift: number): number => {
    if (lo + shift < range.absMin || hi + shift > range.absMax) return Infinity;
    let total = 0;
    for (const m of midis) {
      const p = m + shift;
      total += p < range.prefMin ? range.prefMin - p : p > range.prefMax ? p - range.prefMax : 0;
    }
    return total;
  };
  let best = 0;
  for (const pair of [[-12, 12], [-24, 24]]) {
    const scored = pair.map((s) => [s, strain(s)] as const).filter(([, v]) => v < Infinity);
    if (!scored.length) continue;
    scored.sort((a, b) => a[1] - b[1]);
    best = scored[0]![0];
    break;
  }
  if (!best) return 0;   // nothing fits; leave it for the range clamp downstream

  for (let i = from; i < to; i++) {
    for (const e of measures[i]?.events ?? []) {
      if (e?.type !== "note" || e.grace) continue;
      const m = eventMidi(e);
      if (m === null) continue;
      e.pitch = midiToPitch(m + best);
    }
  }
  return best;
}

/**
 * Pass the tune between flute, oboe and clarinet, a block of bars at a time.
 *
 * Returns who led and how often, so the caller can say what it did.
 */
export function shareMelodyAmongWinds(
  parts: any[],
  opts: { blockBars?: number; eligible?: (voice: Lead) => boolean } = {}
): SharePlan[] {
  const blockBars = opts.blockBars ?? BLOCK_BARS;
  const eligible = opts.eligible ?? (() => true);
  const find = (k: Lead) => (parts ?? []).find((p) => MATCH[k].test(String(p?.name ?? "")));
  const flute = find("fl");
  if (!flute) return [];

  // A player the user has grounded is accompanying on purpose. Don't hand it
  // the tune, and don't take the flute's tune away to give it to nobody.
  const present = (["fl", "ob", "cl"] as Lead[]).filter((k) => !!find(k) && eligible(k));
  if (present.length < 2 || !present.includes("fl")) return [];
  const rotation = ROTATION.filter((k) => present.includes(k));
  if (!rotation.length) return [];

  const bars = (flute.measures ?? []).length;
  const counts = new Map<string, number>();

  for (let start = 0, block = 0; start < bars; start += blockBars, block++) {
    const lead = rotation[block % rotation.length]!;
    const end = Math.min(bars, start + blockBars);
    const part = find(lead);
    if (!part) continue;

    counts.set(String(part.name), (counts.get(String(part.name)) ?? 0) + 1);
    if (part === flute) continue;                        // the flute already has it

    for (let i = start; i < end; i++) {
      const a = flute.measures?.[i];
      const b = part.measures?.[i];
      if (!a || !b) continue;
      const held = a.events;
      a.events = b.events;
      b.events = held;
    }
    // Each player now reads a line written for the other. Check both can.
    placeForInstrument(part.measures ?? [], start, end, lead);
    placeForInstrument(flute.measures ?? [], start, end, "fl");
  }

  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([lead, blocks]) => ({ lead, blocks }));
}

/** One line naming who took the tune and how often. */
export function shareMelodySentence(plans: SharePlan[], blockBars = BLOCK_BARS): string | null {
  if (plans.length < 2) return null;
  const bits = plans.map((p) => `${p.lead} ${p.blocks}`);
  return (
    `[winds] The upper winds take turns with the melody, ${blockBars} bars at a time — ` +
    `blocks each: ${bits.join(", ")}. Nothing new is written: the players swap which ` +
    `line they read, and a line only moves by an octave when its new player cannot reach it.`
  );
}
