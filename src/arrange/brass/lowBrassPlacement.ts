/**
 * Where the low brass puts its attacks.
 *
 * The derived parts double their donor's rhythm exactly, which is right for
 * getting the notes but wrong as a texture: it left all three trombones
 * attacking together on every beat of the bar —
 *
 *   ours            beat 1  30%   beat 2  19%   beat 3  24%   beat 4  26%
 *   (identical for Trombone 1, Trombone 2 and the Bass Trombone)
 *
 * The reference edition separates them, and its own notes say so: short
 * chord attacks for the trombones "principally on beats 2 and 4", and selected
 * lower supports for the bass trombone "separated by rests". Measured, that is
 * exactly what it does, and the two are complementary:
 *
 *   Trombone 2      beat 1  12%   beat 2  44%   beat 3   0%   beat 4  44%
 *   Bass Trombone   beat 1  38%   beat 2  10%   beat 3  32%   beat 4  10%
 *
 * So the second trombone takes the backbeat and the bass trombone the downbeats
 * between them. Together they still cover the bar; separately neither is
 * doubling anybody.
 *
 * Trombone 1 is left alone — it is the melodic trombone and the reference
 * spreads it across all four beats (14 / 23 / 10 / 27). So is the tuba, whose
 * half-time pulse on beats 1 and 3 is already what that edition writes for a
 * verse.
 *
 * Nothing is added. This only drops attacks the part already had, so every note
 * that survives is a note the voicing chose.
 */

export type PlacementPlan = { part: string; kept: number; dropped: number };

/** Beats 2 and 4 of a 4/4 bar — the odd beat indices. */
const BACKBEAT = (beat: number) => beat % 2 === 1;

/** Beats 1 and 3 — the even indices. */
const DOWNBEAT = (beat: number) => beat % 2 === 0;

const TARGETS: Array<[RegExp, (beat: number) => boolean]> = [
  [/^trombone 2\b/i, BACKBEAT],
  [/^bass trombone\b/i, DOWNBEAT],
];

/** The bar's length in quarter-note beats. */
function measureLenBeats(m: any): number {
  const t = m?.attributes?.time;
  if (t && Number(t.beats) > 0 && Number(t.beat_type) > 0) {
    return (Number(t.beats) * 4) / Number(t.beat_type);
  }
  return 4;
}

/**
 * Keep each low-brass voice to its own beats, so the section is not three
 * players hitting the same four.
 */
export function placeLowBrass(parts: any[]): PlacementPlan[] {
  const out: PlacementPlan[] = [];

  for (const part of parts ?? []) {
    const name = String(part?.name ?? "");
    const want = TARGETS.find(([re]) => re.test(name))?.[1];
    if (!want) continue;

    let kept = 0;
    let dropped = 0;

    for (const m of part.measures ?? []) {
      const len = measureLenBeats(m);
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
      if (notes.length < 2) continue;              // nothing to thin

      const keepers = notes.filter((e: any) => {
        const t = Number(e.t);
        if (!(t >= 0 && t < len)) return true;      // leave anything odd alone
        // Only whole-beat attacks are placed; an off-beat note is a figure, not
        // a chord stab, and dropping it would be editing the line rather than
        // placing it.
        if (Math.abs(t - Math.round(t)) > 1e-9) return true;
        return want(Math.round(t));
      });

      // Never silence a bar outright — a part that drops out is the
      // participation gate's decision, not this pass's.
      if (!keepers.length) continue;

      const others = (m.events ?? []).filter(
        (e: any) => !(e?.type === "note" && !e.grace)
      );
      dropped += notes.length - keepers.length;
      kept += keepers.length;
      m.events = [...others, ...keepers].sort((a: any, b: any) => Number(a.t) - Number(b.t));
    }

    if (dropped) out.push({ part: name, kept, dropped });
  }

  return out;
}

/** One line naming who was placed where. */
export function lowBrassPlacementSentence(plans: PlacementPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} kept ${p.kept}, dropped ${p.dropped}`);
  return (
    `[brass] The low brass stops doubling itself: ${bits.join("; ")}. ` +
    `The second trombone takes beats 2 and 4 and the bass trombone the downbeats ` +
    `between them, so the two cover the bar without either shadowing the other.`
  );
}
