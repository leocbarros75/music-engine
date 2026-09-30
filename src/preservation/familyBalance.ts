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

export type SectionBalance = {
  firstBar: number;
  lastBar: number;
  families: FamilyActivity[];
  /** Null when the section is silent or a family is absent from it. */
  hierarchyHolds: boolean | null;
  violations: string[];
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
  /**
   * The same question asked section by section, because the whole-piece answer
   * hides where it goes wrong. The reference edition tests this in every
   * labelled section rather than once over the work, and it is right to.
   */
  sections: SectionBalance[];
  /** Sections whose order is wrong. Zero is the only acceptable number. */
  sectionsOutOfOrder: number;
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

/**
 * Sounding time per BAR for one part, counting overlapping notes once.
 *
 * Per bar rather than per piece, because a whole-piece average hides the thing
 * that matters. Measured over the whole work our brass sat at 37.5% against the
 * winds' 38.9% and passed; measured section by section it takes over the last
 * three — 96.9%, 89.4% and 85.0% against winds at 72.7, 67.2 and 63.1. The
 * climaxes are exactly where a listener notices who is on top.
 */
function soundingPerBar(part: any): { perBar: number[]; sumPerBar: number[]; eventsPerBar: number[] } {
  const measures = part?.measures ?? [];
  const perBar: number[] = [];
  const sumPerBar: number[] = [];
  const eventsPerBar: number[] = [];

  for (const m of measures) {
    const spans: Array<[number, number]> = [];
    let sum = 0;
    let events = 0;
    for (const e of m?.events ?? []) {
      if ((e?.type !== "note" && e?.type !== "unpitched") || e?.grace) continue;
      const t = Number(e.t);
      const dur = Number(e.dur);
      events++;
      if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
      spans.push([t, t + dur]);
      sum += dur;
    }
    spans.sort((a, b) => a[0] - b[0]);
    let sounding = 0;
    let cur: [number, number] | null = null;
    for (const sp of spans) {
      if (cur && sp[0] <= cur[1] + EPS) cur[1] = Math.max(cur[1], sp[1]);
      else { if (cur) sounding += cur[1] - cur[0]; cur = [sp[0], sp[1]]; }
    }
    if (cur) sounding += cur[1] - cur[0];
    perBar.push(sounding);
    sumPerBar.push(sum);
    eventsPerBar.push(events);
  }
  // A note held across a barline is counted in the bar it is written in, which
  // is what a reader sees and close enough for a share of the music.
  return { perBar, sumPerBar, eventsPerBar };
}

export function buildFamilyBalance(
  score: ScoreModel,
  options: { sectionBars?: number } = {}
): FamilyBalance {
  const parts = (score as any)?.parts ?? [];
  const longest = parts.reduce(
    (best: any, p: any) => ((p?.measures?.length ?? 0) > (best?.measures?.length ?? 0) ? p : best),
    parts[0]
  );
  const lengths = barLengths(longest?.measures ?? []);
  const totalBeats = lengths.reduce((a, b) => a + b, 0);
  const barCount = lengths.length;

  // Measure every part once, per bar, then add it up two ways.
  const measured = parts.map((part: any) => ({
    family: classifyFamily(`${part?.name ?? ""} ${part?.instrument ?? ""}`),
    ...soundingPerBar(part),
  }));

  /** Aggregate families over a half-open bar range. */
  const over = (from: number, to: number): FamilyActivity[] => {
    const span = lengths.slice(from, to).reduce((a, b) => a + b, 0);
    const acc = new Map<Family, FamilyActivity>();
    for (const m of measured) {
      const row =
        acc.get(m.family) ??
        { family: m.family, parts: 0, events: 0, soundingBeats: 0, overlapBeats: 0, averageActivity: 0 };
      row.parts++;
      for (let i = from; i < to; i++) {
        row.events += m.eventsPerBar[i] ?? 0;
        row.soundingBeats += m.perBar[i] ?? 0;
        row.overlapBeats += Math.max(0, (m.sumPerBar[i] ?? 0) - (m.perBar[i] ?? 0));
      }
      acc.set(m.family, row);
    }
    const out = [...acc.values()];
    for (const f of out) {
      f.averageActivity = span > 0 && f.parts > 0 ? f.soundingBeats / (f.parts * span) : 0;
    }
    out.sort((a, b) => b.averageActivity - a.averageActivity);
    return out;
  };

  /**
   * Strings over winds over brass. A stretch where none of the three sounds is
   * not out of order — it is a rest, or an entry the orchestra has not made
   * yet — so it returns null rather than a failure.
   */
  const judge = (families: FamilyActivity[]): { holds: boolean | null; violations: string[] } => {
    const of = (f: Family) => families.find((x) => x.family === f) ?? null;
    const st = of("strings"), ww = of("woodwinds"), br = of("brass");
    if (!st || !ww || !br) return { holds: null, violations: [] };
    if (st.averageActivity <= EPS && ww.averageActivity <= EPS && br.averageActivity <= EPS) {
      return { holds: null, violations: [] };
    }
    const pct = (x: FamilyActivity) => `${(100 * x.averageActivity).toFixed(1)}%`;
    const violations: string[] = [];
    if (!(st.averageActivity > ww.averageActivity)) {
      violations.push(`woodwinds ${pct(ww)} are not below strings ${pct(st)}`);
    }
    if (!(ww.averageActivity >= br.averageActivity)) {
      violations.push(`brass ${pct(br)} are not below woodwinds ${pct(ww)}`);
    }
    return { holds: violations.length === 0, violations };
  };

  const families = over(0, barCount);
  const whole = judge(families);

  const sectionBars = Math.max(1, Math.floor(options.sectionBars ?? 8));
  const sections: SectionBalance[] = [];
  for (let from = 0; from < barCount; from += sectionBars) {
    const to = Math.min(barCount, from + sectionBars);
    const fams = over(from, to);
    const verdict = judge(fams);
    sections.push({
      firstBar: from + 1,
      lastBar: to,
      families: fams,
      hierarchyHolds: verdict.holds,
      violations: verdict.violations,
    });
  }

  return {
    totalBeats,
    families,
    hierarchyHolds: whole.holds,
    violations: whole.violations,
    sections,
    sectionsOutOfOrder: sections.filter((x) => x.hierarchyHolds === false).length,
  };
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
  if (b.sectionsOutOfOrder > 0) {
    // The whole-piece figure can pass while the loudest stretches do not, and
    // those are the ones a listener notices.
    const where = b.sections
      .filter((x) => x.hierarchyHolds === false)
      .map((x) => `bars ${x.firstBar}-${x.lastBar} (${x.violations.join(", ")})`)
      .join("; ");
    return `${head} Over the whole piece that is the right order, but it fails in ${b.sectionsOutOfOrder} section(s): ${where}.`;
  }
  return head;
}
