import assert from "node:assert/strict";
import { placeLowBrass, lowBrassPlacementSentence } from "../../src/arrange/brass/lowBrassPlacement";

/**
 * Where the low brass puts its attacks.
 *
 * The derived parts double their donor's rhythm exactly, which gets the notes
 * right and the texture wrong: all three trombones attacked together on every
 * beat, ~30/19/24/26% across the bar and identical for each.
 *
 * Measured, the reference edition separates them, and the two are
 * complementary:
 *
 *   Trombone 2      beat 1  12%   beat 2  44%   beat 3   0%   beat 4  44%
 *   Bass Trombone   beat 1  38%   beat 2  10%   beat 3  32%   beat 4  10%
 *
 * Trombone 1 is left alone — it is the melodic trombone and that edition
 * spreads it over all four beats (14/23/10/27) — and so is the tuba, whose
 * half-time pulse on beats 1 and 3 is already what it writes for a verse.
 */

/** A part with an attack on every beat of every bar. */
function part(name: string, bars: number, onsets = [0, 1, 2, 3]): any {
  return {
    part_id: name,
    name,
    measures: Array.from({ length: bars }, (_, i) => ({
      number: i + 1,
      attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
      events: onsets.map((t, k) => ({
        type: "note", t, dur: 0.5,
        pitch: { step: "C", octave: 3, alter: 0 }, id: `${name}-${i}-${k}`,
      })),
    })),
  };
}

const onsetsIn = (p: any, bar: number) =>
  (p.measures?.[bar]?.events ?? [])
    .filter((e: any) => e?.type === "note")
    .map((e: any) => Number(e.t))
    .sort((a: number, b: number) => a - b);

const BARS = 6;

// ── The second trombone takes the backbeat ────────────────────────────────
{
  const parts = [part("Trombone", BARS), part("Trombone 2", BARS), part("Bass Trombone", BARS), part("Tuba", BARS)];
  const plans = placeLowBrass(parts);
  const t2 = parts[1]!;
  for (let bar = 0; bar < BARS; bar++) {
    assert.deepEqual(onsetsIn(t2, bar), [1, 3],
      `Trombone 2 bar ${bar + 1} should keep beats 2 and 4 only`);
  }
  assert.ok(plans.some((p) => p.part === "Trombone 2" && p.dropped > 0));
}

// ── The bass trombone takes the downbeats between them ────────────────────
{
  const parts = [part("Trombone", BARS), part("Trombone 2", BARS), part("Bass Trombone", BARS), part("Tuba", BARS)];
  placeLowBrass(parts);
  const bt = parts[2]!;
  for (let bar = 0; bar < BARS; bar++) {
    assert.deepEqual(onsetsIn(bt, bar), [0, 2],
      `Bass Trombone bar ${bar + 1} should keep beats 1 and 3 only`);
  }
}

// ── Together they still cover the bar ─────────────────────────────────────
{
  const parts = [part("Trombone 2", BARS), part("Bass Trombone", BARS)];
  placeLowBrass(parts);
  for (let bar = 0; bar < BARS; bar++) {
    const both = new Set([...onsetsIn(parts[0]!, bar), ...onsetsIn(parts[1]!, bar)]);
    assert.deepEqual([...both].sort((a, b) => a - b), [0, 1, 2, 3],
      `bar ${bar + 1}: the pair must still cover every beat between them`);
  }
}

// ── The melodic trombone and the tuba are not touched ─────────────────────
{
  const parts = [part("Trombone", BARS), part("Trombone 1", BARS), part("Tuba", BARS), part("Horn in F", BARS)];
  const plans = placeLowBrass(parts);
  assert.deepEqual(plans, [], "nobody else is placed by this pass");
  for (const p of parts) {
    for (let bar = 0; bar < BARS; bar++) {
      assert.deepEqual(onsetsIn(p, bar), [0, 1, 2, 3], `${p.name} must be left as it was`);
    }
  }
}

// ── An off-beat note is a figure, not a chord stab ────────────────────────
{
  // Dropping these would be editing the line rather than placing it.
  // 1.5 and 3.5, not 0.5 and 2.5: those two ROUND to odd beats, so a filter
  // without the off-beat guard keeps them anyway and the case proves nothing.
  // 1.5 rounds to 2 and 3.5 to 4 — both even, both dropped without the guard.
  const parts = [part("Trombone 2", BARS, [0, 1, 1.5, 3.5])];
  placeLowBrass(parts);
  for (let bar = 0; bar < BARS; bar++) {
    const on = onsetsIn(parts[0]!, bar);
    assert.ok(on.includes(1.5) && on.includes(3.5),
      `bar ${bar + 1}: off-beat attacks must survive, got ${on.join(",")}`);
    assert.ok(!on.includes(0), "but the downbeat is still dropped from the backbeat part");
  }
}

// ── A bar is never silenced outright ──────────────────────────────────────
{
  // Only downbeat attacks, handed to the backbeat part: thinning would empty
  // the bar, and whether a part rests is the participation gate's decision.
  const parts = [part("Trombone 2", BARS, [0, 2])];
  placeLowBrass(parts);
  for (let bar = 0; bar < BARS; bar++) {
    assert.ok(onsetsIn(parts[0]!, bar).length > 0,
      `bar ${bar + 1} was emptied; this pass must not silence a part`);
  }
}

// ── Reporting and degenerate input ────────────────────────────────────────
{
  assert.deepEqual(placeLowBrass([]), []);
  assert.equal(lowBrassPlacementSentence([]), null);
  const line = lowBrassPlacementSentence([{ part: "Trombone 2", kept: 127, dropped: 138 }]);
  assert.ok(line && /Trombone 2 kept 127, dropped 138/.test(line));
  // A single-note bar is left alone — there is nothing to thin.
  const one = [part("Trombone 2", 2, [0])];
  placeLowBrass(one);
  assert.deepEqual(onsetsIn(one[0]!, 0), [0]);
}

console.log("PASS low brass placement");
