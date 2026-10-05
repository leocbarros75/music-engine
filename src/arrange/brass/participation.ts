/**
 * Who plays this bar.
 *
 * Brass is scored by endurance, and the reference edition of this chart is
 * explicit that the tempting implementation — an eight-note chord for every
 * harmony, every player sounding — buys unnecessary density at a real cost to
 * the players. It decides which accompaniment voices take part BEFORE it
 * assigns them notes. Ours decided nothing: all five parts sounded in all 124
 * bars, zero whole-bar rests, the trumpets working exactly as hard as the tuba.
 *
 * Measured across the reference's 124 bars, its eight parts are a hierarchy:
 *
 *   Tuba          66% sounding, silent in   1 bar   — one entrance, carries it
 *   Horn 1        69%           silent in  17       — a ONE-bar breath, often
 *   Trombone 1    47%           silent in  22       — recedes under the tune
 *   Trumpet 2     25%           silent in  69       — brief responses
 *   Trumpet 1     24%           silent in  84       — 8 entrances, rests of
 *                                                      20 and 28 bars
 *
 * The trumpets' rests are sectional, not scattered: they sit out whole
 * passages. That is the shape reproduced here.
 *
 * The reference also rests Trumpet 1 through 34 of its 56 melody bars, because
 * its tune moves elsewhere and the trumpet is silent when another instrument
 * leads. That needs `leadByBar` from `shareBrassMelody`: pass it and a trumpet
 * may sit out a bar the chart does fill, so long as it is not the one holding
 * the tune. Without it the trumpet is the only voice that can carry a melody,
 * and silencing it in a melody bar would delete the tune rather than
 * redistribute it — so it then rests only where the chart gives nothing.
 */

export type Participation = { part: string; rested: number; blocks: number };

type Voice = "tpt1" | "tpt2" | "hn" | "tbn" | "tuba";

const MATCH: Array<[Voice, RegExp]> = [
  ["tpt1", /^trumpet\s*1/i],
  ["tpt2", /^trumpet\s*2/i],
  ["hn", /^horn/i],
  ["tbn", /^(trombone|tenor trombone)/i],
  ["tuba", /^tuba/i],
];

/**
 * A passage shorter than this does not get the trumpets out of their chairs.
 *
 * One or two bars off is a hiccup, not a rest; the reference's trumpet takes 7
 * rest blocks across the piece, not one per short gap in the tune.
 *
 * Merging the tune-less runs across short melodic fragments — reasoning that
 * the reference's 20- and 28-bar rests are longer than any single run here —
 * was the first attempt and it was wrong. It collapsed the whole middle of the
 * chart into one 52-bar silence, where the reference in fact alternates four
 * bars on and four off through that section. Its long rests come from the shape
 * of its own phrase plan, not from gluing our runs together.
 */
const MIN_BLOCK_BARS = 3;

/** Horn 1 takes a single bar off this often. Never two in a row. */
const HORN_BREATH_EVERY = 7;

/** The trombone recedes under the tune one bar in this many. */
const TROMBONE_REST_EVERY = 4;

/** Trumpet 2 answers the phrase that just ended, then drops out. */
const RESPONSE_BARS = 2;

type BarKind = "empty" | "slash" | "melody";

/** What the source is doing in each bar: a tune, a groove, or nothing. */
function classify(source: any): BarKind[] {
  return (source?.measures ?? []).map((m: any) => {
    const es = (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
    if (!es.length) return "empty";
    const slashes = es.filter(
      (e: any) => String(e.notehead ?? "").toLowerCase() === "slash"
    ).length;
    return slashes / es.length >= 0.5 ? "slash" : "melody";
  });
}

/**
 * The passages with no tune in them, long enough to be worth sitting out.
 * Returned as [start, end) bar indices.
 */
function instrumentalBlocks(kinds: BarKind[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] === "melody") { i++; continue; }
    let end = i;
    while (end < kinds.length && kinds[end] !== "melody") end++;
    if (end - i >= MIN_BLOCK_BARS) blocks.push([i, end]);
    i = end;
  }
  return blocks;
}

/**
 * Decide who sounds in each bar and silence the rest.
 *
 * The invariants that keep this safe: the tuba never rests, so the bass is
 * always there; and the trumpet keeps every bar where the chart has a tune, so
 * the melody is never deleted.
 */
export function gateBrassParticipation(
  parts: any[],
  source: any,
  leadByBar?: string[]
): Participation[] {
  const kinds = classify(source);
  if (!kinds.length) return [];
  /** Does this voice hold the tune in this bar? With no plan, the trumpet does. */
  const leads = (voice: Voice, i: number) =>
    leadByBar?.length ? leadByBar[i] === voice : voice === "tpt1";
  const blocks = instrumentalBlocks(kinds);
  const inBlock = new Array<number>(kinds.length).fill(-1);
  blocks.forEach(([s, e], bi) => { for (let i = s; i < e; i++) inBlock[i] = bi; });

  const out: Participation[] = [];

  // Decided first, applied second. The melody has to be checked across the
  // whole section before any of it is cleared — silencing part by part cannot
  // see that it has just left a bar with no tune in it at all.
  const plan: Array<{ part: any; voice: Voice; silent: boolean[] }> = [];

  for (const part of parts ?? []) {
    const name = String(part?.name ?? "");
    const voice = MATCH.find(([, re]) => re.test(name))?.[0];
    if (!voice || voice === "tuba") continue;     // the foundation never stops

    const measures: any[] = part?.measures ?? [];
    const silentAt = new Array<boolean>(Math.min(measures.length, kinds.length)).fill(false);

    for (let i = 0; i < measures.length && i < kinds.length; i++) {
      const bi = inBlock[i]!;
      let silent = false;

      // The trumpets work as a section. When the horn has the tune they are
      // both out of the melody bars; when either of them has it, both may play,
      // and uncrossBrassSection keeps the second below the first.
      //
      // Resting only the FIRST trumpet was not enough. The horn takes the tune
      // an octave down to stay inside its range, so a second trumpet still
      // playing harmony sits above the melody and buries it — measuring the top
      // sounding voice put Trumpet 2 there for 7 blocks of 16 while it led only
      // 2. "Usually silent when another instrument leads" is a rule about the
      // section, not about one player.
      const trumpetLeads = leads("tpt1", i) || leads("tpt2", i);
      const buriesTheTune = kinds[i] === "melody" && !trumpetLeads;

      if (voice === "tpt1") {
        // Sectional: out for the whole tune-less passage.
        silent = bi >= 0 || buriesTheTune;
      } else if (voice === "tpt2") {
        // The same passages, but it answers the phrase that just ended first.
        silent = (bi >= 0 && i - blocks[bi]![0] >= RESPONSE_BARS) || buriesTheTune;
      } else if (voice === "hn") {
        // A one-bar breath at a steady interval, wherever it falls.
        silent = i > 0 && i % HORN_BREATH_EVERY === 0;
      } else if (voice === "tbn") {
        // Recedes under the tune; holds the groove where there is none.
        silent = kinds[i] === "melody" && i % TROMBONE_REST_EVERY === 0;
      }

      // Never drop a SECTION while holding the tune. The trumpets' rests run
      // for whole passages, and a player cannot hand back seven bars of melody
      // to nobody.
      //
      // The horn's single bar is a different thing and is left alone: a brass
      // player leading a whole chart has to breathe, and the reference's Horn 1
      // takes exactly that, resting 7 of the 56 melody bars it otherwise
      // carries. Protecting it here as well cut its rests from 17 to 7 and had
      // the workhorse of the section never taking a breath at all.
      // Only in a MELODY bar: that is where there is a tune to hold. Written as
      // "not an empty bar" this also fired in slash bars, where with no lead
      // plan the trumpet counts as leading by default — and it cancelled its
      // own sectional rest straight through the groove.
      if (silent && voice !== "hn" && kinds[i] === "melody" && leads(voice, i)) silent = false;

      silentAt[i] = silent;
    }

    plan.push({ part, voice, silent: silentAt });
  }

  // A melody bar always keeps a melodic voice.
  //
  // The horn is allowed its breath and both trumpets are out under a horn-led
  // passage, and those two rules together took the tune out of 6 melody bars
  // altogether — trombone and tuba holding harmony under nothing. The reference
  // never does that, and what it does instead is obvious once named: somebody
  // covers the breath. The first trumpet comes back for that one bar.
  const MELODIC: Voice[] = ["tpt1", "tpt2", "hn"];
  const slot = (v: Voice) => plan.find((p) => p.voice === v);
  const cover = slot("tpt1") ?? slot("tpt2");
  if (cover) {
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== "melody") continue;
      const anyMelodic = MELODIC.some((v) => {
        const s = slot(v);
        if (!s || i >= s.silent.length) return false;
        if (s.silent[i]) return false;
        return (s.part.measures?.[i]?.events ?? [])
          .some((e: any) => e?.type === "note" && !e.grace);
      });
      if (!anyMelodic && i < cover.silent.length) cover.silent[i] = false;
    }
  }

  for (const { part, silent } of plan) {
    const measures: any[] = part?.measures ?? [];
    let rested = 0;
    const touched = new Set<number>();
    for (let i = 0; i < silent.length; i++) {
      if (!silent[i]) continue;
      const m = measures[i];
      if (!m) continue;
      const had = (m.events ?? []).some((e: any) => e?.type === "note" && !e.grace);
      if (!had) continue;
      m.events = (m.events ?? []).filter((e: any) => e?.type !== "note" || e.grace);
      rested++;
      if (inBlock[i]! >= 0) touched.add(inBlock[i]!);
    }
    if (rested) out.push({ part: String(part.name), rested, blocks: touched.size });
  }
  return out;
}

/** One line naming who sits out and how much. */
export function participationSentence(plans: Participation[]): string | null {
  if (!plans.length) return null;
  const bits = plans.map((p) => `${p.part} ${p.rested}`);
  return (
    `[brass] Not everyone plays every bar — bars off: ${bits.join(", ")}. ` +
    `The trumpets sit out the passages with no tune in them, the horn takes a ` +
    `bar to breathe, the trombone recedes under the melody, and the tuba carries ` +
    `throughout. Endurance is part of the writing, not an afterthought.`
  );
}
