/**
 * Rhythm, for a player who cannot read the professional part.
 *
 * Phase 1 moved register, which makes a line reachable and leaves it exactly
 * as hard to count. This is the half that makes it countable.
 *
 * It is a GRID, not a minimum note length, and the difference matters. Measured
 * across the arranged output, a minimum-length rule would have done almost
 * nothing: sixteenths are 1% of the notes. What is actually hard sits
 * elsewhere — dotted eighths are 20% of the brass and 21% of the orchestra, and
 * 36% of the jazz band's onsets fall off the beat. A grid catches all three at
 * once, because a note that does not start on the grid is moved onto it and a
 * note too short to reach the next grid point is absorbed by the one before.
 *
 * This is lossy, deliberately. A simplified part has fewer notes than the one
 * it stands in for; that is what makes it simpler. Pitches are never invented —
 * the note that survives each grid slot is the one that was already sounding
 * first in it.
 */

function isNote(e: any): boolean {
  return e?.type === "note" && !e.grace;
}

function barLengthOf(m: any, fallback = 4): number {
  const t = m?.attributes?.time;
  if (t && Number(t.beats) > 0 && Number(t.beat_type) > 0) {
    return (Number(t.beats) * 4) / Number(t.beat_type);
  }
  const stated = Number(m?.durationBeats);
  return Number.isFinite(stated) && stated > 0 ? stated : fallback;
}

export type QuantizePlan = {
  /** Notes that survived, now sitting on the grid. */
  kept: number;
  /** Notes absorbed by the one that began their grid slot. */
  dropped: number;
  /** Surviving notes whose onset or length changed. */
  moved: number;
};

/**
 * Put every note of a part on a grid of `grid` quarter-beats.
 *
 * One slot, one attack. Where several notes begin inside the same slot the
 * earliest wins and the rest are absorbed; where several sound together at that
 * same instant they are a chord and all survive, because thinning a chord is a
 * question about harmony, not about rhythm.
 *
 * Rests are dropped from any bar this rewrites. The exporter spells the gaps
 * between events itself, so the air stays exactly where the notes leave it
 * rather than being described twice and disagreeing.
 */
export function quantizeToGrid(part: any, grid: number): QuantizePlan {
  const plan: QuantizePlan = { kept: 0, dropped: 0, moved: 0 };
  if (!(grid > 0)) return plan;

  for (const m of (part?.measures ?? [])) {
    const notes = (m?.events ?? []).filter(isNote)
      .sort((a: any, b: any) => Number(a.t) - Number(b.t));
    if (!notes.length) continue;

    const barLen = barLengthOf(m);
    const lastSlot = Math.max(0, Math.ceil(barLen / grid) - 1);

    const bySlot = new Map<number, any[]>();
    for (const e of notes) {
      const slot = Math.min(Math.floor(Number(e.t) / grid + 1e-6), lastSlot);
      const at = bySlot.get(slot);
      if (at) at.push(e); else bySlot.set(slot, [e]);
    }

    const slots = [...bySlot.keys()].sort((a, b) => a - b);
    const out: any[] = [];

    slots.forEach((slot, i) => {
      const group = bySlot.get(slot)!;
      const firstT = Number(group[0].t);
      // Everything sounding at that first instant is one chord and is kept.
      const chord = group.filter((e) => Math.abs(Number(e.t) - firstT) < 1e-9);
      plan.dropped += group.length - chord.length;

      const start = slot * grid;
      const nextStart = i + 1 < slots.length ? slots[i + 1]! * grid : barLen;
      const held = Math.max(...chord.map((e) => Number(e.dur) || grid));
      // Round the length onto the grid, never shorter than one slot, and never
      // past the next attack — a simplified part must not overlap itself.
      let dur = Math.max(grid, Math.round(held / grid) * grid);
      dur = Math.min(dur, Math.max(grid / 2, nextStart - start));

      for (const e of chord) {
        if (Math.abs(Number(e.t) - start) > 1e-9 || Math.abs(Number(e.dur) - dur) > 1e-9) plan.moved++;
        e.t = start;
        e.dur = dur;
        out.push(e);
        plan.kept++;
      }
    });

    // A bar that sounded still sounds: `out` holds at least the first slot.
    m.events = out;
  }

  return plan;
}
