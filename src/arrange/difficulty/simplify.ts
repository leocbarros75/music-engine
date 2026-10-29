import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import {
  bandFor, playableRange, isPlayerLevel, gridFor, breathCapFor, WIND_OR_BRASS,
  type Band, type PlayerLevel,
} from "./levels";
import { quantizeToGrid } from "./rhythm";
import { applyBreathing } from "../breathing";

/**
 * A simplified alternate for a part that sits too high or too low for the
 * player who has to read it.
 *
 * Phase 1 moves REGISTER and nothing else. Every note keeps its pitch class,
 * its onset and its duration; only the octave may change. That is a deliberate
 * limit, not an oversight — moving a line into a comfortable register makes it
 * reachable, and leaves it exactly as rhythmically hard as it was.
 *
 * The professional part is never touched. A simplified part is ADDED beside it,
 * named "<part> (simplified)", the way a publisher prints an alternate: the
 * director chooses at the stand, and nothing that already worked can regress.
 */

/** A note that has to leave the band loses less than a line that wanders. */
const CLAMP_COST = 3;

/**
 * What introducing a crossing with a neighbouring part costs.
 *
 * A cost, NOT a veto. Crossing is ordinary music — measured on the reference
 * jazz edition, its bass sits above its own bass trombone at 10 of 19 shared
 * onsets — so forbidding it outright would block most useful simplification.
 * This only discourages an octave choice that newly tangles a part with the one
 * above or below it when another choice fits the register just as well.
 */
const CROSS_COST = 2;

/** Whole octaves only. A simplified part is the same music. */
const OCTAVE_CHOICES = [0, -12, 12, -24, 24];

/**
 * The band's CEILING is the constraint; its floor is not.
 *
 * What makes a part hard is height — the notes above the staff are where tone,
 * intonation and endurance all fail first. Sitting below a band is usually
 * comfortable, and on most of these instruments it is where a student is
 * happiest.
 *
 * Treating the floor as a constraint too produced the opposite of
 * simplification: a flute line at 66-76 fell one semitone under the catalog's
 * preferred floor of 67, so the pass moved the ENTIRE line up an octave, to
 * 78-88, to satisfy it. The part got harder. Only the ceiling pushes a line,
 * and only downwards; the floor is enforced solely by the instrument's own
 * range, which is a different question and is handled by the wall below.
 */
function tooHigh(midi: number, band: Band): boolean {
  return midi > band.hi;
}

export type SimplifyPlan = {
  part: string;
  instrument: string;
  level: PlayerLevel;
  band: Band;
  /** Notes whose octave moved. */
  moved: number;
  notes: number;
  /** The constant octave applied to the whole line, before per-note repairs. */
  lineShift: number;
  /** Notes still above the band's ceiling, no lower octave being playable. */
  outside: number;
  /** Crossings with a neighbouring part that the move introduced. */
  crossings: number;
  lowBefore: number; highBefore: number;
  lowAfter: number; highAfter: number;
  /** Quarter-beats per grid slot, or null where the rhythm was left alone. */
  grid: number | null;
  /** Notes absorbed by the one that began their slot. */
  dropped: number;
  /** Notes whose onset or length moved onto the grid. */
  requantized: number;
  /** Breath rests written so the part is not asked to hold too long. */
  breaths: number;
  /** Longest stretch without air afterwards, in quarter-beats. */
  longestHold: number;
};

export type SimplifyOptions = {
  /**
   * The ensemble being written, which decides how coarse the rhythmic grid may
   * get. A swung chart keeps its eighths at every level — see gridFor.
   */
  ensemble?: string;
};

export type LevelSelection = {
  default?: PlayerLevel;
  /** Per part, by part name or part_id. One weak player, not a weak orchestra. */
  byPart?: Record<string, PlayerLevel>;
};

function isNote(e: any): boolean {
  return e?.type === "note" && !e.grace;
}

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

/** Every sounding note of a part, with where it lives. */
function noteRefs(part: any): Array<{ bar: number; ev: any; midi: number }> {
  const out: Array<{ bar: number; ev: any; midi: number }> = [];
  (part?.measures ?? []).forEach((m: any, bar: number) => {
    for (const ev of (m?.events ?? [])) {
      if (!isNote(ev)) continue;
      const midi = eventMidi(ev);
      if (midi !== null) out.push({ bar, ev, midi });
    }
  });
  return out;
}

/** The highest note each neighbour sounds at each onset, for the crossing cost. */
function onsetTops(part: any): Map<string, number> {
  const tops = new Map<string, number>();
  (part?.measures ?? []).forEach((m: any, bar: number) => {
    for (const ev of (m?.events ?? [])) {
      if (!isNote(ev)) continue;
      const midi = eventMidi(ev);
      if (midi === null) continue;
      const key = `${bar}:${Number(ev.t)}`;
      const prev = tops.get(key);
      if (prev === undefined || midi > prev) tops.set(key, midi);
    }
  });
  return tops;
}

/**
 * One octave for the whole line, chosen on the whole line.
 *
 * Note by note this would be wrong twice over, and both mistakes have already
 * been made in this codebase: choosing each note's octave separately collapsed
 * a derived saxophone line to three semitones, and treating an out-of-range
 * note as disqualifying stranded 392 notes an octave high because 14 of them
 * would have dropped under the horn. A player's register is a property of the
 * part, not of each note in it.
 */
function chooseLineShift(
  line: number[],
  band: Band,
  playable: Band | null,
  above: Map<string, number> | null,
  below: Map<string, number> | null,
  keys: string[],
): number {
  if (!line.length) return 0;

  let best = 0;
  let bestScore = Infinity;
  for (const o of OCTAVE_CHOICES) {
    let outside = 0, unplayable = 0, crossings = 0;
    for (let i = 0; i < line.length; i++) {
      const m = line[i]! + o;
      if (tooHigh(m, band)) outside++;
      if (playable && (m < playable.lo || m > playable.hi)) unplayable++;
      // A crossing this move would INTRODUCE: it did not cross before and does
      // now. An ordering the arranger already chose is none of our business.
      const key = keys[i]!;
      const up = above?.get(key);
      if (up !== undefined && line[i]! <= up && m > up) crossings++;
      const dn = below?.get(key);
      if (dn !== undefined && line[i]! >= dn && m < dn) crossings++;
    }
    // The tie-break is to MOVE THE MUSIC LEAST, not to centre it in the band.
    //
    // Centring was the first version and it put the fault back by another door:
    // with nothing above the ceiling at either octave, the distance-to-centre
    // term still dragged a flute line sitting at 66-76 up to 78-88, because the
    // preferred band's middle is 80. A simplified part should differ from the
    // original as little as it can and no less.
    const score =
      outside + unplayable * CLAMP_COST + crossings * CROSS_COST + Math.abs(o) / 1000;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** The level that applies to a part: its own override, else the score default. */
function levelFor(part: any, levels: LevelSelection): PlayerLevel {
  const byPart = levels.byPart ?? {};
  for (const key of [String(part?.name ?? ""), String(part?.part_id ?? "")]) {
    const v = key ? byPart[key] : undefined;
    if (isPlayerLevel(v)) return v;
  }
  return isPlayerLevel(levels.default) ? levels.default : "professional";
}

/**
 * Add a simplified alternate for every part that needs one. Mutates `parts` in
 * place and returns what was added, so the caller can say so.
 */
export function simplifyForLevel(
  parts: any[],
  levels: LevelSelection,
  options: SimplifyOptions = {},
): SimplifyPlan[] {
  if (!Array.isArray(parts) || !parts.length) return [];
  // Nothing to do at all unless some part is below professional. This is what
  // makes the pass provably inert by default.
  const wanted = parts.some((p) => levelFor(p, levels) !== "professional");
  if (!wanted) return [];
  if (parts.some((p) => /\(simplified\)\s*$/i.test(String(p?.name ?? "")))) return [];

  const out: SimplifyPlan[] = [];
  // Snapshot the original line-up: neighbours are judged against the score as
  // the arranger left it, not against alternates added as we go.
  const original = parts.slice();

  for (const part of original) {
    const level = levelFor(part, levels);
    if (level === "professional") continue;

    const instrument = String(part?.instrument ?? "");
    const band = bandFor(instrument, level);
    if (!band) continue;

    const refs = noteRefs(part);
    if (!refs.length) continue;

    const playable = playableRange(instrument);
    const idx = original.indexOf(part);
    const above = idx > 0 ? onsetTops(original[idx - 1]) : null;
    const below = idx >= 0 && idx < original.length - 1 ? onsetTops(original[idx + 1]) : null;
    const keys = refs.map((r) => `${r.bar}:${Number(r.ev.t)}`);

    const lineShift = chooseLineShift(refs.map((r) => r.midi), band, playable, above, below, keys);

    // Phase two: a note still outside the band moves on its own, but ONLY when
    // that brings it inside and keeps it on the instrument. A note that cannot
    // be helped is left where the arranger put it and counted, never forced to
    // some other pitch — that would change the harmony to flatter a metric.
    const after: number[] = [];
    let moved = 0, outside = 0;
    for (const r of refs) {
      let m = r.midi + lineShift;
      // Only a note ABOVE the ceiling is brought down on its own, and only when
      // dropping it lands inside the band and stays on the instrument.
      if (tooHigh(m, band)) {
        for (const step of [-12, -24]) {
          const cand = m + step;
          if (cand > band.hi || cand < band.lo) continue;
          if (playable && (cand < playable.lo || cand > playable.hi)) continue;
          m = cand;
          break;
        }
      }
      // The hard wall: never hand a player a note the instrument cannot sound.
      if (playable) {
        while (m > playable.hi) m -= 12;
        while (m < playable.lo) m += 12;
      }
      if (tooHigh(m, band)) outside++;
      if (m !== r.midi) moved++;
      after.push(m);
    }

    // What the move actually did to the neighbours, for the report.
    let crossings = 0;
    refs.forEach((r, i) => {
      const key = keys[i]!;
      const up = above?.get(key);
      if (up !== undefined && r.midi <= up && after[i]! > up) crossings++;
      const dn = below?.get(key);
      if (dn !== undefined && r.midi >= dn && after[i]! < dn) crossings++;
    });

    // One clone, three passes: register, then rhythm, then air. The clone is
    // built before anything is known to have changed, because a part can be
    // perfectly placed and still be unreadable — register alone was Phase 1,
    // and a part already in its band may still need its rhythm simplified.
    const clone = JSON.parse(JSON.stringify(part));
    clone.part_id = `${String(part.part_id ?? "P")}_SIMPLE`;
    clone.name = `${String(part.name ?? "Part")} (simplified)`;
    noteRefs(clone).forEach((r, i) => { r.ev.pitch = midiToPitch(after[i]!); });

    const grid = gridFor(level, options.ensemble);
    const q = grid ? quantizeToGrid(clone, grid) : { kept: 0, dropped: 0, moved: 0 };

    // Air last, so it is measured against the rhythm the player will actually
    // read rather than the one the professional was given. Only the players who
    // run out of breath: a string part tires, but it does not breathe.
    const cap = breathCapFor(level);
    const blows = WIND_OR_BRASS.test(`${part?.name ?? ""} ${instrument}`);
    const breath = cap && blows
      ? applyBreathing([clone] as any, { maxBreathlessBeats: cap, writeRests: true })
      : null;

    // Nothing to offer: an alternate identical to the original would tell the
    // director something untrue about the part.
    if (!moved && !q.dropped && !q.moved && !(breath?.releases)) continue;

    parts.splice(parts.indexOf(part) + 1, 0, clone);

    out.push({
      part: String(part.name ?? part.part_id ?? "Part"),
      instrument, level, band, moved, notes: refs.length, lineShift, outside, crossings,
      lowBefore: Math.min(...refs.map((r) => r.midi)),
      highBefore: Math.max(...refs.map((r) => r.midi)),
      lowAfter: Math.min(...after),
      highAfter: Math.max(...after),
      grid,
      dropped: q.dropped,
      requantized: q.moved,
      breaths: breath?.releases ?? 0,
      longestHold: breath?.longestBreathlessBeats ?? 0,
    });
  }

  return out;
}

/** One line naming what was simplified and what it cost. */
export function simplifySentence(plans: SimplifyPlan[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => {
    const parts: string[] = [];
    if (p.moved) parts.push(`${p.moved}/${p.notes} notes re-octaved, ${p.lowBefore}-${p.highBefore} into ${p.lowAfter}-${p.highAfter}`);
    if (p.requantized || p.dropped) {
      parts.push(`${p.requantized} onto a ${p.grid}-beat grid` + (p.dropped ? `, ${p.dropped} absorbed` : ""));
    }
    if (p.breaths) {
      const held = Math.round(p.longestHold);
      parts.push(`${p.breaths} breath rest${p.breaths === 1 ? "" : "s"}, longest hold now ${held} beat${held === 1 ? "" : "s"}`);
    }
    return `${p.part} for a ${p.level} player (${parts.join("; ") || "no change"})`;
  });
  const outside = plans.reduce((n, p) => n + p.outside, 0);
  const crossings = plans.reduce((n, p) => n + p.crossings, 0);
  const dropped = plans.reduce((n, p) => n + p.dropped, 0);

  return (
    `[level] Simplified alternates added beside the original parts, which are ` +
    `unchanged: ${bits.join("; ")}. Register moves by whole octaves only, so every ` +
    `note keeps its pitch class; the rhythm is put on a grid, which is lossy by ` +
    `design — a simplified part has fewer notes than the one it stands in for.` +
    (dropped
      ? ` ${dropped} note(s) were absorbed by the note that began their grid slot; ` +
        `no pitch was invented.`
      : "") +
    (outside
      ? ` ${outside} note(s) stay above the target register because no lower octave ` +
        `of them is both inside it and playable.`
      : "") +
    (crossings
      ? ` ${crossings} note(s) now cross a neighbouring part where they did not ` +
        `before.`
      : "")
  );
}
