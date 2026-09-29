import type { ScoreModel } from "../score/types";

/**
 * How much does each family actually play?
 *
 * Family balance has been measured here before by share of note count, and that
 * metric could not see the fault it was meant to catch: strings, winds and brass
 * came out at 49/32/18 against a target of 48/36/16 while nobody ever rested,
 * because everyone over-played in proportion. A share stays correct however
 * loud the whole room gets.
 *
 * The measure that moves is the one the Codex piano-with-orchestra edition
 * uses: the average, per part, of the fraction of the piece that part is
 * sounding. Eight brass parts are then not compared unfairly with five wind
 * ones, and a family that never stops cannot hide behind a family that also
 * never stops. On the same source that edition runs strings 89.97%, woodwinds
 * 10.17%, brass 1.34% — and ours ran strings 110.72%, woodwinds 47.39%, brass
 * 93.75%, with the hierarchy inverted.
 *
 * A number over 100% was itself the giveaway: a part cannot sound for more time
 * than exists. It happens when one staff carries two lines — our "Cello-Bass" —
 * so activity here is the UNION of the sounding intervals, never their sum.
 * For a part that is genuinely monophonic the two are identical, which is why
 * the reference figures transfer. `overlapBeats` reports the difference, since
 * a staff carrying two lines is worth knowing about on its own.
 */

export type Family = "strings" | "woodwinds" | "brass" | "percussion" | "keyboard" | "other";

/**
 * Order matters more than it looks. "Bassoon", "contrabassoon" and "bass
 * trombone" all contain "bass", so a loose string test has to come last — the
 * classifier in applyParticipation.ts tests it first and calls a bassoon a
 * string. (That file's orchestra path is retired, so this is a note rather than
 * a bug report.)
 */
export function classifyFamily(text: string): Family {
  const s = String(text ?? "").toLowerCase();
  if (/piano|keyboard|organ|harpsichord|celesta/.test(s)) return "keyboard";
  if (/timpani|percussion|drum|cymbal|crash|triangle|tambourine|glockenspiel|marimba|xylophone|vibraphone|chime|bell/.test(s))
    return "percussion";
  // The double-reed that is called a horn, before anything tests for "horn".
  if (/cor anglais|english horn/.test(s)) return "woodwinds";
  // Brass before winds, because our orchestral parts carry the worship band's
  // doubling in their names — "Trumpet 2-3 (Alto Sax)", "Trombone 1-2 (Tenor
  // Sax)". Those are brass parts with a sax player's cue on them, and testing
  // for "sax" first files three brass staves under woodwinds.
  if (/trumpet|trombone|tuba|horn|cornet|euphonium|flugel/.test(s)) return "brass";
  if (/bassoon|flute|piccolo|oboe|clarinet|sax|recorder/.test(s)) return "woodwinds";
  if (/violin|viola|cello|contrabass|double bass|bass|harp|vln|vla/.test(s)) return "strings";
  return "other";
}

export type FamilyActivity = {
  family: Family;
  parts: number;
  events: number;
  /** Time the family's parts actually sound, in quarter beats, unions per part. */
  soundingBeats: number;
  /** How much a staff overlaps itself — above zero means two lines on one staff. */
  overlapBeats: number;
  /** soundingBeats / (parts x totalBeats): 0..1. */
  averageActivity: number;
};

export type FamilyBalance = {
  totalBeats: number;
  families: FamilyActivity[];
  /**
   * Strings above woodwinds above brass — the order a texture needs when
   * something else is carrying the tune. Null when a family is absent.
   */
  hierarchyHolds: boolean | null;
  violations: string[];
};

const EPS = 1e-9;

/** Bar lengths in quarter beats, meter inherited until it changes. */
function barLengths(measures: any[]): number[] {
  const out: number[] = [];
  let meter = 4;
  for (const m of measures ?? []) {
    const t = m?.attributes?.time;
    if (t && Number(t.beats) > 0 && Number(t.beat_type) > 0) {
      meter = (Number(t.beats) * 4) / Number(t.beat_type);
    }
    const stated = Number(m?.durationBeats);
    out.push(Number.isFinite(stated) && stated > 0 ? stated : meter);
  }
  return out;
}

/** Total sounding time of one part, counting overlapping notes once. */
function soundingOf(part: any): { sounding: number; sum: number; events: number } {
  const lengths = barLengths(part?.measures ?? []);
  const spans: Array<[number, number]> = [];
  let at = 0;
  let sum = 0;
  let events = 0;
  (part?.measures ?? []).forEach((m: any, i: number) => {
    for (const e of m?.events ?? []) {
      if ((e?.type !== "note" && e?.type !== "unpitched") || e?.grace) continue;
      const t = Number(e.t);
      const dur = Number(e.dur);
      events++;
      if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
      spans.push([at + t, at + t + dur]);
      sum += dur;
    }
    at += lengths[i] ?? 4;
  });
  spans.sort((a, b) => a[0] - b[0]);
  let sounding = 0;
  let cur: [number, number] | null = null;
  for (const s of spans) {
    if (cur && s[0] <= cur[1] + EPS) cur[1] = Math.max(cur[1], s[1]);
    else { if (cur) sounding += cur[1] - cur[0]; cur = [s[0], s[1]]; }
  }
  if (cur) sounding += cur[1] - cur[0];
  return { sounding, sum, events };
}

export function buildFamilyBalance(score: ScoreModel): FamilyBalance {
  const parts = (score as any)?.parts ?? [];
  const longest = parts.reduce(
    (best: any, p: any) => ((p?.measures?.length ?? 0) > (best?.measures?.length ?? 0) ? p : best),
    parts[0]
  );
  const totalBeats = barLengths(longest?.measures ?? []).reduce((a, b) => a + b, 0);

  const acc = new Map<Family, FamilyActivity>();
  for (const part of parts) {
    const family = classifyFamily(`${part?.name ?? ""} ${part?.instrument ?? ""}`);
    const { sounding, sum, events } = soundingOf(part);
    const row =
      acc.get(family) ??
      { family, parts: 0, events: 0, soundingBeats: 0, overlapBeats: 0, averageActivity: 0 };
    row.parts++;
    row.events += events;
    row.soundingBeats += sounding;
    row.overlapBeats += Math.max(0, sum - sounding);
    acc.set(family, row);
  }

  const families = [...acc.values()];
  for (const f of families) {
    f.averageActivity = totalBeats > 0 && f.parts > 0 ? f.soundingBeats / (f.parts * totalBeats) : 0;
  }
  families.sort((a, b) => b.averageActivity - a.averageActivity);

  const of = (f: Family) => families.find((x) => x.family === f) ?? null;
  const st = of("strings"), ww = of("woodwinds"), br = of("brass");
  const violations: string[] = [];
  let hierarchyHolds: boolean | null = null;
  if (st && ww && br) {
    hierarchyHolds = true;
    const pct = (x: FamilyActivity) => `${(100 * x.averageActivity).toFixed(1)}%`;
    if (!(st.averageActivity > ww.averageActivity)) {
      hierarchyHolds = false;
      violations.push(`woodwinds ${pct(ww)} are not below strings ${pct(st)}`);
    }
    if (!(ww.averageActivity > br.averageActivity)) {
      hierarchyHolds = false;
      violations.push(`brass ${pct(br)} are not below woodwinds ${pct(ww)}`);
    }
  }
  return { totalBeats, families, hierarchyHolds, violations };
}

/** One line for the warnings a player reads. */
export function familyBalanceSentence(b: FamilyBalance): string | null {
  if (!b.families.length) return null;
  const named = b.families.filter((f) => f.family !== "keyboard" && f.family !== "other");
  if (!named.length) return null;
  const bits = named.map((f) => `${f.family} ${(100 * f.averageActivity).toFixed(0)}%`);
  const head = `[balance] Average share of the piece each part sounds: ${bits.join(", ")}.`;
  if (b.hierarchyHolds === false) {
    return `${head} That is out of order — ${b.violations.join("; ")}. Under a soloist the strings should sit above the winds and the winds above the brass.`;
  }
  return head;
}
