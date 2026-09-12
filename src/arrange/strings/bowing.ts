/**
 * Bow directions for a string part — only where they carry information.
 *
 * What this does NOT do is alternate down/up across every note. A sequence of
 * correct-looking bow symbols does not prove a passage is comfortably bowed:
 * direction says which way the arm travels, not how much bow the stroke uses or
 * where in the bow it starts. Two notes marked down-bow can leave the hand in
 * completely different places depending on the lengths the player chose, and
 * nothing in this engine models bow position, contact point, string choice or
 * fingering — so nothing here can plan distribution.
 *
 * What a printed part genuinely needs is the small number of directions a
 * section would otherwise have to agree on by hand: where a phrase is retaken,
 * and whether a pickup goes up. Those follow from the score alone. Everything
 * else is left to the players, which is also how published parts read.
 *
 * Bowing SLURS are deliberately not generated. A slur is a phrasing and
 * bow-distribution decision, and the one mechanical rule available here —
 * "slur each bar" — is exactly the rule that produced fourteen bar-long slurs,
 * twelve of them containing repeated attacks, in the reference arrangement this
 * work started from.
 */

import type { NoteEvent, Part } from "../../score/types";

/** A rest at least this long is a real break in the line, not a comma. */
const RETAKE_REST_BEATS = 1;

function isNote(ev: any): boolean {
  return ev?.type === "note" && ev?.isRest !== true;
}

function addTechnical(ev: NoteEvent, mark: string): void {
  const evAny = ev as any;
  const existing: string[] = Array.isArray(evAny.technical) ? evAny.technical : [];
  if (!existing.includes(mark)) evAny.technical = [...existing, mark];
}

/**
 * Mark bow directions on one already-arranged string part, in place.
 *
 * `pickup` is true when the part's first bar is an incomplete one: a note
 * leading into the downbeat is taken up-bow so the downbeat itself falls down.
 */
export function markBowDirections(part: Part, options: { pickup?: boolean } = {}): number {
  let marked = 0;
  let restBeats = Infinity; // before the first note, everything is a fresh start
  let first = true;

  for (const measure of part.measures ?? []) {
    const events = [...(measure?.events ?? [])].sort((a: any, b: any) => Number(a.t) - Number(b.t));
    for (const ev of events) {
      if (!isNote(ev)) {
        if ((ev as any)?.isRest === true || (ev as any)?.type === "rest") {
          restBeats += Number((ev as any).dur ?? 0);
        }
        continue;
      }
      if (restBeats >= RETAKE_REST_BEATS) {
        // A pickup leads INTO the first downbeat, so it goes up and lands down.
        addTechnical(ev as NoteEvent, first && options.pickup ? "up-bow" : "down-bow");
        marked++;
      }
      restBeats = 0;
      first = false;
    }
  }
  return marked;
}

/** True when the part's first bar is shorter than the meter — an anacrusis. */
export function startsWithPickup(part: Part): boolean {
  const first: any = part.measures?.[0];
  if (!first) return false;
  if (first.implicit === true) return true;
  const beats = Number(first.attributes?.time?.beats);
  const beatType = Number(first.attributes?.time?.beat_type);
  if (!Number.isFinite(beats) || !Number.isFinite(beatType)) return false;
  const full = beats * (4 / beatType);
  const filled = (first.events ?? []).reduce(
    (sum: number, e: any) => sum + (e?.chord === true ? 0 : Number(e?.dur ?? 0)),
    0
  );
  return filled > 0 && filled < full - 1e-9;
}
