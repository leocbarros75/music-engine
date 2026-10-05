import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import { BRASS_RANGES } from "./brassRanges";

/**
 * Eight players, not five.
 *
 * Our brass route builds a quintet — two trumpets, horn, trombone, tuba — which
 * is a real chamber ensemble and stays reachable. But the reference edition of
 * this chart is an orchestral brass section of eight, and measured against it
 * the missing three are a second horn, a second trombone and a bass trombone:
 *
 *   Horn 1        69% sounding, range 61-78      Horn 2         52%, 61-71
 *   Trombone 1    47%,          42-66            Trombone 2     30%, 47-54
 *   Bass Trombone 41%,          42-47            Tuba           66%, 30-40
 *
 * The new parts are not composed. Each doubles its donor's rhythm exactly and
 * takes the nearest chord tone BELOW it — a chord tone the section is already
 * sounding at that instant, as the gap figuration does — so the harmony stays
 * the voicing's and only the spacing is new.
 *
 * The spacing rules are the reference's own, from its PROCESS notes: generated
 * bass-trombone support stays at least seven semitones above the tuba, adjacent
 * generated low-brass voices keep at least four, and the generated trombones
 * ascend Bass Trombone - Trombone 2 - Trombone 1 while the horns ascend Horn 2
 * - Horn 1.
 */

/** At least this far above the tuba's bass, per the reference's own rule. */
const BT_ABOVE_TUBA = 7;

/** Adjacent generated low-brass voices keep at least this much air. */
const LOW_BRASS_GAP = 4;

/** How far below its donor a derived part may reach for a chord tone. */
const MAX_DROP = 14;

type Derived = {
  /** The part this one is derived from, by name. */
  donor: RegExp;
  id: string;
  name: string;
  instrument: string;
  /** Range key for clamping. */
  range: keyof typeof BRASS_RANGES;
  /** Insert after this part, by name, to keep score order. */
  after: RegExp;
};

const DERIVED: Derived[] = [
  { donor: /^horn/i,       id: "P_HN2",  name: "Horn 2",        instrument: "horn_f",   range: "hn",   after: /^horn/i },
  { donor: /^trombone/i,   id: "P_TBN2", name: "Trombone 2",    instrument: "trombone", range: "tbn",  after: /^trombone/i },
  // Derived from Trombone 2 DOWNWARD, not from the tuba upward. Reaching up
  // from the tuba was the first attempt and put it at 47-63 where the reference
  // writes 42-47: a bass trombone is the bottom of the trombone section, and
  // our tuba already sits higher than that edition's, so the error compounded.
  // It also inherited the tuba's rhythm, which never rests, so it never rested
  // either — against 33 bars off there. Trombone 2's line gives it both the
  // right register and a share of that part's rests.
  { donor: /^trombone 2/i, id: "P_BTBN", name: "Bass Trombone", instrument: "trombone", range: "tbn",  after: /^trombone 2/i },
];

export type ExpandPlan = { part: string; from: string; notes: number; crowded?: number };

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/** The nearest pitch below `from` whose class is one of the chord's. */
function chordToneBelow(from: number, pcs: Set<number>, floor: number): number | null {
  for (let m = from - 1; m >= Math.max(floor, from - MAX_DROP); m--) {
    if (pcs.has(((m % 12) + 12) % 12)) return m;
  }
  return null;
}

/**
 * Add Horn 2, Trombone 2 and Bass Trombone, derived from the players already
 * there. Returns what was added, so the caller can say so.
 */
export function expandBrassSection(score: any): ExpandPlan[] {
  const parts: any[] = score?.parts ?? [];
  if (!parts.length) return [];
  const find = (re: RegExp) => parts.find((p) => re.test(String(p?.name ?? "")));
  if (find(/^horn 2/i)) return [];                  // already a section

  const out: ExpandPlan[] = [];

  for (const spec of DERIVED) {
    const donor = find(spec.donor);
    if (!donor) continue;
    const range = BRASS_RANGES[spec.range];
    const tuba = find(/^tuba/i);

    let notes = 0;
    let crowded = 0;
    const measures = (donor.measures ?? []).map((m: any, bar: number) => {
      const copy = JSON.parse(JSON.stringify(m));
      const src = (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
      if (!src.length) return copy;

      // The chord as the section is voicing it in this bar.
      const pcs = new Set<number>();
      for (const p of parts) {
        for (const e of (p.measures?.[bar]?.events ?? [])) {
          if (e?.type !== "note" || e.grace) continue;
          const v = eventMidi(e);
          if (v !== null) pcs.add(((v % 12) + 12) % 12);
        }
      }

      const events: any[] = [];
      for (const [i, e] of src.entries()) {
        const cur = eventMidi(e);
        if (cur === null) continue;

        // The floor this voice may not go below.
        let floor = range.absMin;
        if (spec.id === "P_BTBN" && tuba) {
          // At least seven semitones above the tuba's note at this moment.
          const under = (tuba.measures?.[bar]?.events ?? [])
            .filter((x: any) => x?.type === "note" && !x.grace)
            .map(eventMidi)
            .filter((v: any): v is number => v !== null);
          if (under.length) floor = Math.max(floor, Math.min(...under) + BT_ABOVE_TUBA);
        }

        // Everyone reaches down to the next chord tone; the Bass Trombone's
        // floor is what keeps it clear of the tuba.
        //
        // That clearance cannot always be honoured, and the reason is upstream:
        // our tuba sits at 37-52 where the reference edition's is 30-40, about
        // ten semitones high. Seven semitones above a tuba that high leaves no
        // chord tone under Trombone 2 at all — insisting on it left the bass
        // trombone with 5 notes in 124 bars. So the rule applies where it fits
        // and gives way where it does not, and `crowded` counts the bars where
        // it gave way so the warning can say so. The real fix is the tuba's
        // register, which is a separate fault.
        let pick = chordToneBelow(
          cur, pcs, spec.id === "P_BTBN" ? floor : floor + LOW_BRASS_GAP
        );
        if (pick === null && spec.id === "P_BTBN") {
          pick = chordToneBelow(cur, pcs, range.absMin);
          if (pick !== null) crowded++;
        }
        if (pick === null) continue;

        events.push({
          ...JSON.parse(JSON.stringify(e)),
          id: `${spec.id}-${bar}-${i}`,
          pitch: midiToPitch(pick),
        });
        notes++;
      }
      copy.events = [
        ...(m?.events ?? []).filter((e: any) => !(e?.type === "note" && !e.grace)),
        ...events,
      ].sort((a: any, b: any) => Number(a.t) - Number(b.t));
      return copy;
    });

    if (!notes) continue;

    const part = {
      ...JSON.parse(JSON.stringify(donor)),
      part_id: spec.id,
      name: spec.name,
      instrument: spec.instrument,
      measures,
    };

    // Score order: below the player it sits under.
    const anchor = parts.findIndex((p) => spec.after.test(String(p?.name ?? "")));
    if (anchor >= 0) parts.splice(anchor + 1, 0, part);
    else parts.push(part);

    out.push({ part: spec.name, from: String(donor.name), notes, crowded });
  }

  return out;
}

/** One line naming the players added. */
export function expandSectionSentence(plans: ExpandPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} from ${p.from} (${p.notes} notes)`);
  const crowded = plans.reduce((n, p) => n + (p.crowded ?? 0), 0);
  return (
    `[brass] An eight-part section rather than a quintet: ${bits.join(", ")}. ` +
    `Each doubles its donor's rhythm and takes a chord tone the section is already ` +
    `sounding, kept seven semitones clear of the tuba and four from its neighbour.` +
    (crowded
      ? ` The bass trombone comes closer than seven semitones to the tuba on ${crowded} ` +
        `note(s): our tuba sits about ten semitones above the reference's, so there is no ` +
        `chord tone left beneath the second trombone. The tuba's register is the fix.`
      : "")
  );
}
