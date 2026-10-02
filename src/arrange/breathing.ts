import type { Measure, NoteEvent, Part } from "../score/types";

/**
 * Wind and brass players have to breathe.
 *
 * A piano sustains as long as a key is held and a pedal is down. A flute does
 * not, and neither does a trumpet. Transcribing keyboard texture onto wind
 * parts without saying where the air comes from produces music that cannot be
 * played at all — not awkward, not unidiomatic: unperformable.
 *
 * The engine was doing exactly that. Every wind and brass part it produced ran
 * from the first bar to the last without a single rest — 248 beats on one
 * reference song, 492 on another, which at 71 to the quarter is three and a
 * half minutes of continuous tone in the first case and seven in the second.
 * A player needs air every five to fifteen seconds. A reference edition of the
 * same song breaks its flute at 48 beats and its oboe at 16, and writes 63
 * breath marks; ours wrote none.
 *
 * The rules:
 *
 *   1. Breaths are STAGGERED. The point is not that everyone rests — it is
 *      that the ensemble never stops together, so the texture carries on while
 *      any one player refills.
 *   2. A breath is taken where a note already ends at a barline, so no phrase
 *      is cut in half to find one.
 *   3. Never out of a tie: the note is still sounding into the next bar.
 *   4. Never out of the final bar, where the players agree a cutoff instead.
 *   5. A note long enough to give up its tail releases early, and the bar is
 *      filled with a rest. One too short to shorten keeps its full value and
 *      takes a breath mark, which asks the player to borrow a little time
 *      rather than lose the note.
 *
 * This is a starting plan, not a physiological guarantee: air varies with
 * instrument, dynamic, register and player, and a section will move these
 * breaths to suit the room. What it does guarantee is that there is somewhere
 * to move them from.
 */

const EPS = 1e-9;

export type BreathPlan = {
  /** Notes shortened to leave an audible gap before the barline. */
  releases: number;
  /** Notes left whole, marked for the player to snatch a breath. */
  marks: number;
  /** The longest unbroken stretch of notated sound left in any part, in beats. */
  longestRunBeats: number;
  /** The longest any player is asked to go without air, counting breath marks. */
  longestBreathlessBeats: number;
};

/**
 * How long each bar is, in quarter-note beats.
 *
 * Meter is inherited: a time signature holds until another replaces it, and a
 * pickup or other irregular bar states its own length outright.
 */
function barLengths(measures: Measure[], fallback = 4): number[] {
  const out: number[] = [];
  let meter = fallback;
  for (const m of measures) {
    const time = m?.attributes?.time;
    if (time && Number(time.beats) > 0 && Number(time.beat_type) > 0) {
      meter = (Number(time.beats) * 4) / Number(time.beat_type);
    }
    const stated = Number(m?.durationBeats);
    out.push(Number.isFinite(stated) && stated > 0 ? stated : meter);
  }
  return out;
}

/**
 * Which bars a part may breathe in.
 *
 * The top line gets an opportunity every other bar — it is the most exposed
 * and usually the busiest. The lower parts run a four-bar cycle on the odd
 * offsets, which keeps them clear of the top line's even bars.
 *
 * Four bars rather than six is a deliberate trade. Six kept every part clear
 * of every other, but left the lower voices up to twenty seconds between
 * breaths, which is playable only just. Four brings that to about thirteen,
 * at the cost of two offsets for three or four lower parts: in a quartet the
 * oboe and bassoon come up together. They are the two furthest apart, so what
 * is left sounding is a top and a middle rather than two neighbours, and the
 * flute is on the even bars either way.
 */
export function breathBars(partIndex: number, partCount: number, bars: number): Set<number> {
  const out = new Set<number>();
  if (bars <= 0) return out;
  if (partIndex === 0) {
    for (let b = 2; b <= bars; b += 2) out.add(b);
    return out;
  }
  const cycle = 4;
  const offsets = [1, 3];
  const offset = offsets[(partIndex - 1) % offsets.length]!;
  for (let b = offset; b <= bars; b += cycle) out.add(b);
  return out;
}

/**
 * Every stretch of unbroken sound in a part, in absolute beats, merged.
 *
 * With `breathMarksBreak`, a note carrying a breath mark also ends a stretch.
 * The two answer different questions: without it you get how long the part
 * LOOKS unbroken, with it you get how long the player actually goes without
 * air, which is the number that decides whether the part can be played. A
 * breath mark makes no gap in the notation but the player takes one anyway.
 */
function soundingSpans(part: Part, breathMarksBreak = false): Array<[number, number]> {
  const lengths = barLengths(part?.measures ?? []);
  const spans: Array<[number, number, boolean]> = [];
  let barStart = 0;
  (part?.measures ?? []).forEach((m, i) => {
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note" || (ev as any).grace) continue;
      const t = Number(ev.t);
      const dur = Number(ev.dur);
      if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
      const breathes = Array.isArray(ev.articulations) && ev.articulations.includes("breath-mark");
      spans.push([barStart + t, barStart + t + dur, breathes]);
    }
    barStart += lengths[i] ?? 4;
  });
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  let cut = false;   // the previous note ended in a breath, so start a new stretch
  for (const [s, e, breathes] of spans) {
    const last = merged[merged.length - 1];
    // Adjacent counts as continuous: one note ending exactly where the next
    // begins gives the player no air, whatever the notation suggests.
    if (last && !cut && s <= last[1] + EPS) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
    cut = breathMarksBreak && breathes;
  }
  return merged;
}

/** The longest unbroken stretch of NOTATED sound in a part, in beats. */
export function longestRunBeats(part: Part): number {
  let longest = 0;
  for (const [s, e] of soundingSpans(part)) longest = Math.max(longest, e - s);
  return longest;
}

/**
 * The longest a player is asked to go without air, in beats — counting breath
 * marks as breaths, because that is what they are. This is the number that
 * says whether a part is playable.
 */
export function longestBreathlessBeats(part: Part): number {
  let longest = 0;
  for (const [s, e] of soundingSpans(part, true)) longest = Math.max(longest, e - s);
  return longest;
}

/**
 * Is this part played by more than one person?
 *
 * "Horn 1-2", "Trumpet 2-3", "Trombone 3/Tuba", "Flute/Oboe" — orchestral
 * scores put several players on one staff, and the distinction decides how
 * they breathe. A section staggers within itself: one player lifts while the
 * others hold, and the written line never breaks. Cutting a hole in such a
 * part would silence music the section can perfectly well sustain.
 *
 * A soloist has no one to hide behind, so the line itself has to give way.
 */
/**
 * Does this staff carry two players at once?
 *
 * The question that matters is the WRITING, not the name. A staff with two
 * notes sounding together cannot be given a breath: shortening the note takes
 * the air from both players at the same instant, which is the opposite of
 * staggering. A staff carrying ONE line can — even when it is headed "Horn
 * 1-2", because the two players are in unison and a written mark staggered
 * against the other staves still leaves somebody holding the line.
 *
 * Deciding on the name alone left the symphonic orchestra's brass with no air
 * at all: Horn 1-2 ran 175 beats, Horn 3-4 144, Trumpet 1-2 101, and every one
 * of those staves is a single line. They were told to stagger something that
 * was never broken.
 */
export function carriesTwoPlayers(part: Part): boolean {
  if (!isSectionPart(part)) return false;
  for (const m of part?.measures ?? []) {
    const byOnset = new Map<number, number>();
    for (const e of (m as any)?.events ?? []) {
      if (e?.type !== "note" || e.grace) continue;
      const t = Number(e.t);
      byOnset.set(t, (byOnset.get(t) ?? 0) + 1);
    }
    for (const n of byOnset.values()) if (n > 1) return true;
  }
  return false;
}

export function isSectionPart(part: Part): boolean {
  const name = `${part?.name ?? ""}`;
  // Two players named on one staff: "Horn 1-2", "Trumpet 2-3", "Violin I-II".
  if (/\d\s*[-–]\s*\d/.test(name)) return true;
  // Two instruments sharing a staff: "Flute/Oboe", "Trombone 3/Tuba".
  if (name.includes("/")) return true;
  // Explicitly plural desks.
  if (/\b(a\s*2|div\.?|soli)\b/i.test(name)) return true;
  return false;
}

/**
 * Tell a section to stagger its breathing, which is how one is asked for.
 *
 * The music is left exactly as written: the players sort it out between
 * themselves, and the line continues because someone is always holding it.
 */
export function markStaggeredBreathing(
  parts: Part[],
  text = "stagger breathing"
): number {
  let marked = 0;
  for (const part of parts ?? []) {
    const first = part?.measures?.[0];
    if (!first) continue;
    // Copy-on-write. The parts are built by shallow-copying measures, so the
    // measure objects are distinct while sharing one `performance` object
    // between them — pushing into it put the direction over every part in the
    // score. Found when "Pizz." appeared over the violins.
    const perf: any = { ...((first as any).performance ?? {}) };
    const words: any[] = Array.isArray(perf.words) ? [...perf.words] : [];
    if (words.some((w) => String(w?.text ?? "") === text)) continue;
    words.push({ t: 0, text, placement: "above" });
    perf.words = words;
    (first as any).performance = perf;
    marked++;
  }
  return marked;
}

/**
 * Give every part somewhere to breathe.
 *
 * `parts` must be wind or brass only — a string section has no such need and a
 * piano none at all, and passing one in would punch holes in it for nothing.
 */
/**
 * Try to take a breath at the end of one bar. Returns what it managed, or null
 * if this bar offers nowhere legal to do it.
 *
 * This is the whole rule set in one place, so the planned breaths and the
 * repaired ones below are taken on identical terms.
 */
function tryBreathAtBar(
  part: Part,
  lengths: number[],
  i: number,
  release: number,
  minKept: number,
  writeRests: boolean
): "release" | "mark" | null {
  if (i < 0 || i >= part.measures.length - 1) return null;  // never the closing bar
  const barEnd = lengths[i] ?? 4;
  const notes = (part.measures[i]?.events ?? []).filter(
    (e): e is NoteEvent & { type: "note" } => e?.type === "note" && !(e as any).grace
  );
  if (!notes.length) return null;                            // already silent here

  // Everything that runs to the barline — a chord ends as one gesture, so
  // shortening one of its notes and not the others would split it.
  const atBarline = notes.filter((e) => Number(e.t) + Number(e.dur) >= barEnd - EPS);
  if (!atBarline.length) return null;                        // the bar already ends in air
  if (atBarline.some((e) => e.tieStart === true)) return null;  // sounding into the next bar
  if (atBarline.some((e) => Array.isArray(e.articulations) && e.articulations.includes("breath-mark"))) {
    return null;                                             // already breathing here
  }

  // THE COMMA IS ALWAYS WRITTEN. Whether a rest is written with it depends on
  // whether the part has anywhere else to breathe.
  //
  // A dot over a note says play it short; a comma says take a breath. Writing
  // clipped note-ends everywhere and calling it breathing produced something
  // that sounded staccato, which is a different instruction — so the
  // complementary parts, which get their air from the arc and from releasing
  // before the next attack, take the comma alone and keep every written value.
  //
  // A transcription has neither of those. Marks alone there leave a part that
  // is 62 bars of unbroken notation with a few commas over it — the reference
  // edition of the same song writes a rest AND a comma at alternating bar
  // ends, staggered between players, and its longest notated run is under
  // eight beats against our two hundred and forty-eight. So where there is no
  // other air, the note gives up its tail as well: an eighth, or half its
  // value when it is already short, with the attack kept.
  if (writeRests) {
    const shortest = Math.min(...atBarline.map((e) => Number(e.dur)));
    const room = Math.min(release, shortest / 2);
    if (shortest - room >= minKept - EPS && room >= minKept - EPS) {
      for (const e of atBarline) {
        e.dur = Number(e.dur) - room;
        const on = Array.isArray(e.articulations) ? [...e.articulations] : [];
        on.push("breath-mark");
        e.articulations = on;
      }
      return "release";
    }
  }
  for (const e of atBarline) {
    const on = Array.isArray(e.articulations) ? [...e.articulations] : [];
    on.push("breath-mark");
    e.articulations = on;
  }
  return "mark";
}

/** The absolute beat at which each bar ends. */
function barEnds(lengths: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const l of lengths) { at += l; out.push(at); }
  return out;
}

export function applyBreathing(
  parts: Part[],
  options?: {
    releaseBeats?: number;
    minKeptBeats?: number;
    maxBreathlessBeats?: number;
    /**
     * Write a rest alongside the comma. TRUE for a part whose only air is the
     * one we give it; FALSE where the writing already breathes — the
     * complementary parts rest by the arc and release before each next attack,
     * and clipping them as well is what read as staccato.
     */
    writeRests?: boolean;
  }
): BreathPlan {
  const writeRests = options?.writeRests !== false;
  const release = Math.max(0, options?.releaseBeats ?? 0.5);   // an eighth
  // A note must keep at least an eighth, so a quarter can still give up half
  // its length: quarter becomes eighth-note-plus-eighth-rest, which is how a
  // breath is normally written. Anything shorter takes a mark instead.
  // How little a note may be left holding. An eighth where only a comma is
  // written — nothing is being shortened, so the floor is about taste. A
  // SIXTEENTH where a rest has to appear: a bar whose last note is already an
  // eighth cannot give up an eighth, and refusing to halve it was leaving
  // sixteen-bar stretches with no rest anywhere. The reference does the same
  // and says so — "if it is already short, half its duration is released
  // instead", and some of its rests are sixteenths.
  const minKept = options?.minKeptBeats ?? (writeRests ? 0.25 : 0.5);
  // About sixteen seconds at 60 to the quarter, thirteen at 71 — the far end
  // of a comfortable phrase, not a limit anyone should be working at.
  // How long a line may run before the repair pass insists on a break.
  //
  // Eight beats where a rest is written — about seven seconds at 71 to the
  // quarter, and the figure the reference edition lands on for eight brass
  // players. Sixteen where only a comma goes in: the player is taking the
  // time either way, and clipping a complementary part that often is what
  // read as staccato.
  const maxBreathless = options?.maxBreathlessBeats ?? (writeRests ? 8 : 16);
  const usable = (parts ?? []).filter((p) => (p?.measures?.length ?? 0) > 0);
  const bars = Math.max(0, ...usable.map((p) => p.measures.length));
  let releases = 0;
  let marks = 0;

  usable.forEach((part, index) => {
    const candidates = breathBars(index, usable.length, bars);
    const lengths = barLengths(part.measures);

    for (let i = 0; i < part.measures.length; i++) {
      if (!candidates.has(i + 1)) continue;
      const took = tryBreathAtBar(part, lengths, i, release, minKept, writeRests);
      if (took === "release") releases++;
      else if (took === "mark") marks++;
    }

    // ── Repair ────────────────────────────────────────────────────────────
    // The plan above is positional: it offers each player a breath on a fixed
    // cycle and moves on. Where those bars happen to be tied or to end in air
    // already, the player simply goes without, and two failures in a row leave
    // a longer gap than the cycle promised — the choral bassoon ran 32 beats
    // that way, worse than the wider cycle it replaced.
    //
    // So having asked politely, ask again where it matters: find any stretch
    // still longer than a player can hold, and take the latest legal breath
    // that splits it. This targets the thing that actually matters — nobody
    // goes too long without air — instead of trusting the grid to cover it.
    const ends = barEnds(lengths);
    // A stretch with no legal breath in it does not stop the search. It used to:
    // the loop broke on the first span it could not fix and abandoned the rest
    // of the part, so a single tied passage left every later stretch unrepaired.
    // Tightening the limit made that visible rather than causing it — the
    // bassoon and first horn came out at 15.75 beats where the limit asked for
    // four, WORSE than the eight-beat limit they replaced, because the wider
    // limit had simply not asked as often.
    const giveUp = new Set<string>();
    for (let guard = 0; guard < part.measures.length * 2; guard++) {
      // Which span to repair depends on what the part is allowed to write. If
      // rests are going in, the NOTATION has to break — a comma over an
      // unbroken line gives the player air but still prints sixty-two bars
      // with nowhere to put the pencil. Where only commas are written, the
      // comma IS the break and counting it is correct.
      const tooLong = soundingSpans(part, !writeRests).find(
        ([s, e]) => e - s > maxBreathless + EPS && !giveUp.has(`${s}:${e}`)
      );
      if (!tooLong) break;
      const [spanStart, spanEnd] = tooLong;
      // Bars whose barline falls strictly inside the stretch.
      const inside: number[] = [];
      for (let i = 0; i < ends.length; i++) {
        if (ends[i]! > spanStart + EPS && ends[i]! < spanEnd - EPS) inside.push(i);
      }
      // Prefer the last one that still lands within a playable span; failing
      // that, the earliest available — late air beats none.
      const within = inside.filter((i) => ends[i]! <= spanStart + maxBreathless + EPS);
      const order = [...within.reverse(), ...inside];
      let took: "release" | "mark" | null = null;
      for (const i of order) {
        took = tryBreathAtBar(part, lengths, i, release, minKept, writeRests);
        if (took) break;
      }
      // Nothing legal in this one — it stands, and the next stretch still gets
      // its turn.
      if (!took) { giveUp.add(`${spanStart}:${spanEnd}`); continue; }
      if (took === "release") releases++;
      else marks++;
    }
  });

  return {
    releases,
    marks,
    longestRunBeats: Math.max(0, ...usable.map((p) => longestRunBeats(p))),
    longestBreathlessBeats: Math.max(0, ...usable.map((p) => longestBreathlessBeats(p))),
  };
}
