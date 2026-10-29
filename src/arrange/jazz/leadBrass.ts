import { punchBars } from "./expandSections";

/**
 * The lead trumpet and lead trombone punctuate too.
 *
 * Adding the nine missing chairs got the section SIZES right and left the two
 * lead brass parts scored like saxophones. Against the reference edition:
 *
 *   Trumpet 1     reference  75 notes, 9% sounding, 21 of 124 bars played
 *                 ours      419 notes, 66%,         93 bars
 *   Trombone 1    reference 106 notes, 16%,         34 bars
 *                 ours      419 notes, 66%,         93 bars
 *
 * Five times the material. A big band's brass does not hold a line the way its
 * saxophones do: it enters, it punches, it takes a passage of its own, and it
 * sits out the rest. Our two leads were playing every bar the saxes played,
 * which is what made eight brass parts against five saxes sound like a wall
 * even once the derived six were correctly sparse.
 *
 * Nothing is rewritten here. The parts are already correct note for note; this
 * decides WHICH BARS they keep, and the bars are the ones its own leads play:
 * the section's punches, plus one passage of their own.
 *
 * It runs before the chairs are derived, so Trumpet 2 and Trombone 2 double a
 * donor that has already been gated — and because a lead keeps every punch bar,
 * its derived chairs always find it there.
 */

/**
 * The one passage each lead takes alone, as a fraction of the chart.
 *
 * Measured: the reference's lead trombone has a continuous lead stretch at bars
 * 37-51 of 124, and its lead trumpet at 90-92 and 98-99. Held as fractions
 * those are 0.30-0.41 and 0.73-0.80, which is also the shape — the trombone
 * takes its passage in the first half and the trumpet near the end, so the two
 * do not compete.
 *
 * Fractions rather than bar numbers for the same reason the entry points are:
 * bars 37 and 90 mean nothing on a chart that is not 124 bars long.
 */
const SOLO: Record<"trumpet" | "trombone", { from: number; to: number }> = {
  trombone: { from: 0.30, to: 0.41 },
  trumpet: { from: 0.73, to: 0.80 },
};

type Lead = { name: RegExp; kind: "trumpet" | "trombone" };

const LEADS: Lead[] = [
  { name: /^trumpet$/i, kind: "trumpet" },
  { name: /^trombone$/i, kind: "trombone" },
];

export type LeadPlan = {
  part: string;
  notesBefore: number;
  notesAfter: number;
  barsBefore: number;
  barsAfter: number;
  /** Bars kept because the section punches there. */
  punch: number;
  /** Bars kept as this part's own passage. */
  solo: number;
};

function isNote(e: any): boolean {
  return e?.type === "note" && !e.grace;
}

/** The bars a lead keeps: its section's punches, plus its own passage. */
export function leadBars(kind: "trumpet" | "trombone", barCount: number): Set<number> {
  const out = new Set<number>(punchBars(kind, barCount));
  const { from, to } = SOLO[kind];
  for (let b = Math.floor(barCount * from); b <= Math.ceil(barCount * to) && b < barCount; b++) {
    out.add(b);
  }
  return out;
}

/**
 * Thin the two lead brass parts to the bars a lead actually plays. Mutates the
 * parts in place and returns what changed, so the caller can say so.
 */
export function gateLeadBrass(parts: any[], barCount: number): LeadPlan[] {
  if (!parts?.length || barCount <= 0) return [];
  const out: LeadPlan[] = [];

  for (const lead of LEADS) {
    const part = parts.find((p) => lead.name.test(String(p?.name ?? "")));
    if (!part) continue;

    const keep = leadBars(lead.kind, barCount);
    const punch = punchBars(lead.kind, barCount);

    let notesBefore = 0;
    let notesAfter = 0;
    let barsBefore = 0;
    let barsAfter = 0;
    let punchKept = 0;
    let soloKept = 0;

    (part.measures ?? []).forEach((m: any, bar: number) => {
      const here = (m?.events ?? []).filter(isNote).length;
      if (here) barsBefore++;
      notesBefore += here;

      if (!keep.has(bar)) {
        // A bar this part sits out. Its rests are written by the exporter, which
        // fills an empty measure, so nothing is left behind.
        m.events = (m?.events ?? []).filter((e: any) => !isNote(e));
        return;
      }
      if (here) {
        barsAfter++;
        notesAfter += here;
        if (punch.has(bar)) punchKept++; else soloKept++;
      }
    });

    if (!notesBefore) continue;
    out.push({
      part: String(part.name),
      notesBefore, notesAfter,
      barsBefore, barsAfter,
      punch: punchKept, solo: soloKept,
    });
  }

  return out;
}

/** One line naming what the leads gave up. */
export function leadBrassSentence(plans: LeadPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) =>
    `${p.part} ${p.notesBefore}→${p.notesAfter} notes over ${p.barsBefore}→${p.barsAfter} bars ` +
    `(${p.punch} on the section's punches, ${p.solo} its own)`
  );
  return (
    `[jazz] The lead brass punctuates rather than carrying: ${bits.join("; ")}. ` +
    `The reference edition's lead trumpet plays 21 of 124 bars and its lead trombone 34, ` +
    `against the 93 ours played when they were scored like the saxophones. No note is ` +
    `rewritten — this only decides which bars they keep.`
  );
}
