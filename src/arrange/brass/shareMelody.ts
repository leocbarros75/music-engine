import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import { BRASS_RANGES, type BrassVoiceId } from "./brassRanges";

/**
 * Who has the tune, and for how long.
 *
 * `BRASS_TO_STRING_VOICE` hands the first trumpet Violin I, so it carried the
 * melody in every bar of the chart. That is not how brass is scored, and the
 * participation gate could not fix it: the trumpet was the only voice able to
 * carry a tune, so the gate had to keep it in every bar the chart had one. It
 * reached 61 bars off where the reference edition takes 84.
 *
 * Measuring the reference's top SOUNDING voice block by block — reading its
 * trumpets down a major second and its horns down a fifth, as its own README
 * specifies — the lead goes:
 *
 *   T1, T2, H1, H1, T1, H1, T2, T2, H1, H1, H1, H1, H1, H1, H1, T1
 *   Horn 1 on top for 10 blocks of 16, Trumpet 1 for 3, Trumpet 2 for 3.
 *
 * The horn leads most of the piece. That is the opposite of the wind quartet,
 * where the flute — the designated lead — kept three blocks in four, and it is
 * endurance that turns it round: a horn can play a whole chart and a trumpet
 * cannot. The nominal inner voice is the workhorse and the trumpets are guests.
 *
 * Nothing is composed here. As with the winds this swaps which player reads
 * which line, a block at a time. The horn takes the tune an octave down, into
 * 48-72, because its ceiling is 77 and the line runs to 84 — which lands it in
 * the middle of the horn's preferred register and close to the reference horn's
 * own sounding range. For the winds dropping an octave risked turning the
 * texture inside out; here it does not, because the trumpets are resting when
 * the horn leads.
 */

/** How long one player keeps the tune. */
const BLOCK_BARS = 8;

type Lead = Extract<BrassVoiceId, "tpt1" | "tpt2" | "hn">;

/**
 * Who leads, block by block, repeating. The horn takes five of every eight and
 * the trumpets split the other three, which over sixteen blocks is horn 10,
 * first trumpet 4, second trumpet 2 — against the reference's 10 / 3 / 3. A
 * trumpet opens, as it does there.
 */
const ROTATION: Lead[] = ["tpt1", "hn", "tpt2", "hn", "hn", "tpt1", "hn", "hn"];

const MATCH: Record<Lead, RegExp> = {
  tpt1: /^trumpet\s*1/i,
  tpt2: /^trumpet\s*2/i,
  hn: /^horn/i,
};

export type BrassSharePlan = { lead: string; blocks: number };

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/**
 * Move a stretch by whole octaves if the receiving instrument cannot reach it,
 * taking the SMALLEST move that works — see the wind version for why placing by
 * preferred register instead sends a line two octaves adrift.
 */
function placeForInstrument(measures: any[], from: number, to: number, voice: Lead): void {
  const range = BRASS_RANGES[voice];
  const midis: number[] = [];
  for (let i = from; i < to; i++) {
    for (const e of measures[i]?.events ?? []) {
      if (e?.type !== "note" || e.grace) continue;
      const m = eventMidi(e);
      if (m !== null) midis.push(m);
    }
  }
  if (!midis.length) return;

  const lo = Math.min(...midis), hi = Math.max(...midis);
  if (lo >= range.absMin && hi <= range.absMax) return;      // reachable as written

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
  if (!best) return;

  for (let i = from; i < to; i++) {
    for (const e of measures[i]?.events ?? []) {
      if (e?.type !== "note" || e.grace) continue;
      const m = eventMidi(e);
      if (m !== null) e.pitch = midiToPitch(m + best);
    }
  }
}

/**
 * Pass the tune between the first trumpet, the horn and the second trumpet.
 *
 * Returns who led and how often, plus the lead for every bar — the
 * participation gate needs the second, because once the horn has the tune the
 * trumpet is free to sit out a bar the chart does fill.
 */
export function shareBrassMelody(
  parts: any[],
  blockBars = BLOCK_BARS
): { plans: BrassSharePlan[]; leadByBar: Lead[] } {
  const find = (k: Lead) => (parts ?? []).find((p) => MATCH[k].test(String(p?.name ?? "")));
  const carrier = find("tpt1");
  if (!carrier) return { plans: [], leadByBar: [] };

  const present = (["tpt1", "hn", "tpt2"] as Lead[]).filter((k) => !!find(k));
  const bars = (carrier.measures ?? []).length;
  if (present.length < 2 || !present.includes("tpt1")) {
    return { plans: [], leadByBar: new Array<Lead>(bars).fill("tpt1") };
  }
  const rotation = ROTATION.filter((k) => present.includes(k));
  if (!rotation.length) return { plans: [], leadByBar: new Array<Lead>(bars).fill("tpt1") };

  const leadByBar = new Array<Lead>(bars).fill("tpt1");
  const counts = new Map<string, number>();

  for (let start = 0, block = 0; start < bars; start += blockBars, block++) {
    const lead = rotation[block % rotation.length]!;
    const end = Math.min(bars, start + blockBars);
    const part = find(lead);
    if (!part) continue;

    for (let i = start; i < end; i++) leadByBar[i] = lead;
    counts.set(String(part.name), (counts.get(String(part.name)) ?? 0) + 1);
    if (part === carrier) continue;                 // the trumpet already has it

    for (let i = start; i < end; i++) {
      const a = carrier.measures?.[i];
      const b = part.measures?.[i];
      if (!a || !b) continue;
      const held = a.events;
      a.events = b.events;
      b.events = held;
    }
    placeForInstrument(part.measures ?? [], start, end, lead);
    placeForInstrument(carrier.measures ?? [], start, end, "tpt1");
  }

  const plans = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([lead, blocks]) => ({ lead, blocks }));
  return { plans, leadByBar };
}

/** One line naming who took the tune and how often. */
export function shareBrassMelodySentence(
  plans: BrassSharePlan[],
  blockBars = BLOCK_BARS
): string | null {
  if (plans.length < 2) return null;
  const bits = plans.map((p) => `${p.lead} ${p.blocks}`);
  return (
    `[brass] The tune passes between the trumpets and the horn, ${blockBars} bars at a ` +
    `time — blocks each: ${bits.join(", ")}. The horn carries most of it, because a horn ` +
    `can play a whole chart and a trumpet cannot; nothing new is written, the players ` +
    `swap which line they read.`
  );
}
