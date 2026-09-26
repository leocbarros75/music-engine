/**
 * The complementary ensembles: a piano part that stays, and players added
 * around it.
 *
 * These are not transcriptions. The pianist keeps the music — the recognisable
 * material is already theirs — and the added instruments supply continuity,
 * colour and a rise in intensity. That makes two things true that are not true
 * of a transcription, and the engine was getting both of them wrong.
 *
 * FIRST, the piano belongs in the score. `piano_with_strings` and its siblings
 * used the piano as a harmony and rhythm source and then dropped it, emitting
 * only the new parts. The ensemble whose name promises a combined score was the
 * one thing that could not produce one.
 *
 * SECOND, the added players do not all play all the time. A reference edition
 * of the same 62-bar song rests its first violin for 15 bars and its double
 * bass for 24 — more than a third of the piece — bringing them in as the music
 * opens up. Ours played every part in every bar, entering together in bar 1,
 * under a piano that was already carrying the song. Restraint is an arranging
 * parameter, and the engine had no way to express it.
 */

import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";

type PartLike = any;
type MeasureLike = any;

/**
 * An event's sounding pitch. `midi` is a cache the model fills in later, so at
 * arranging time a note may carry only its spelling — reading the field alone
 * silently treats every note as unpitched.
 */
function soundingMidi(ev: any): number | null {
  const cached = Number(ev?.midi);
  if (Number.isFinite(cached)) return cached;
  if (!ev?.pitch) return null;
  try {
    return pitchToMidi(ev.pitch);
  } catch {
    return null;
  }
}

/** Score order: added players above, the piano they accompany at the foot. */
export function withPianoPart(arrangedParts: PartLike[], pianoPart: PartLike | null): PartLike[] {
  if (!pianoPart) return arrangedParts;
  const already = arrangedParts.some((p) => p === pianoPart || String(p?.part_id) === String(pianoPart?.part_id));
  return already ? arrangedParts : [...arrangedParts, pianoPart];
}

// ── The arc ─────────────────────────────────────────────────────────────────

export type ArcOptions = {
  /**
   * Voices from the top of the ensemble down. The order matters: the top voice
   * is the one held back longest, because it is the one the ear takes as a
   * second melody against the piano's.
   */
  voicesTopDown: string[];
  /** Bars to leave to the piano entirely before anyone joins. */
  openBars?: number;
  /** Which table of entrance thresholds to use; the families differ. */
  family?: ArcFamily;
};

export type ArcDecision = {
  /** Part ids that should sound in this bar. */
  playing: Set<string>;
  /** Where the density sits relative to the piece: 0 thinnest, 1 fullest. */
  intensity: number;
};

/**
 * How busy each bar of the source is, as a fraction of the piece's own busiest.
 *
 * Measured rather than assumed: a verse and a chorus differ in how much the
 * pianist is playing, and that is the signal already present in the file. No
 * section labels are needed, and none are invented.
 */
export function densityCurve(measures: MeasureLike[]): number[] {
  const counts = measures.map((m: any) =>
    (m?.events ?? []).filter((e: any) => e?.type === "note" && e?.pitch).length
  );
  const sorted = counts.filter((c) => c > 0).slice().sort((a, b) => a - b);
  if (!sorted.length) return counts.map(() => 0);
  // The 90th percentile rather than the maximum: one exceptionally dense bar
  // should not flatten the whole curve beneath it.
  const peak = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
  return counts.map((c) => (peak > 0 ? Math.min(1, c / peak) : 0));
}

/**
 * Decide who plays in each bar.
 *
 * Two shapes combined. An ENTRY stagger at the start, so the ensemble arrives
 * rather than switching on: the piano has the opening to itself, the inner
 * voices join, and the top voice waits longest. Then a DENSITY rule for the
 * rest: the thinner the piano writing, the fewer players under it — the lowest
 * and highest voices drop out first, since the inner voices are the ones that
 * sustain harmony without competing for the melody.
 *
 * A part never re-enters and leaves within a bar of itself; short flickers read
 * as mistakes rather than phrasing, so a part that has just entered is held in
 * for a minimum span.
 */

/**
 * How thin the writing has to get before this voice sits out.
 *
 * One threshold for everybody, applied only to the outer two voices, meant the
 * inner parts never rested at all: the oboe played 61 bars of 62. The shape
 * the rule was reaching for was right — the top competes with the melody the
 * pianist already has, the bottom adds weight a thin passage did not ask for,
 * and the inner pair can hold harmony without drawing attention. It just had
 * no numbers behind it.
 *
 * These come from a hand-written accompaniment of the same song, read as the
 * share of bars each part sits out — flute 44%, bassoon 26%, oboe 11%,
 * clarinet 3% — and converted through this source's own density curve into the
 * level each voice drops out below. So the curve is a V: outermost rests most,
 * innermost rests least.
 *
 * A thin bar can end with no added parts at all. That is deliberate. The
 * reference opens exactly that way — "piano first" — and the piano is carrying
 * the song regardless.
 */
/**
 * Fitted from hand-written accompaniments of the same song, read as the share
 * of bars each part sits out and converted through the source's own density
 * curve into the level it drops below.
 *
 * The two families are not the same shape and cannot share a table. In the
 * wind quartet the FLUTE is the most reserved voice (44% of bars out) and the
 * bassoon next; in the string cushion it is the DOUBLE BASS (39%) while the
 * first violin plays far more (24%). Winds rest from the top down, strings
 * from the bottom up. Applying the wind numbers to strings rested Violin I in
 * 44% of bars against a target of 24% — the cushion stopped cushioning.
 *
 *   winds    flute 44%   oboe 11%   clarinet 3%   bassoon 26%
 *   strings  vln1 24%    vln2 2%    viola 2%      cello 13%   bass 39%
 *
 * PULLED BACK for the winds after listening (2026-09-26). Matching those wind
 * figures exactly sounded too thin in the room — the flute out of half the
 * piece, and short gestures inside the bars it did play, compound into an
 * accompaniment that keeps disappearing. The reference is one arranger's
 * judgement about one song, not a standard, and Leo's ear is the one that
 * counts. Wind thresholds are about 0.08 lower than the fitted values and the
 * gesture rest is 1.5 beats rather than 2.5. The strings were not the
 * complaint and keep their fitted profile.
 */
export type ArcFamily = "winds" | "strings";

const REST_PROFILE: Record<ArcFamily, { top: number; bottom: number; innerOuter: number; innerCore: number }> = {
  // Outermost rests most, innermost least — a V.
  winds:   { top: 0.44, bottom: 0.36, innerOuter: 0.26, innerCore: 0.16 },
  // The bass is the reserved voice here and the top line carries; inner desks
  // hold the cushion almost throughout.
  strings: { top: 0.40, bottom: 0.50, innerOuter: 0.20, innerCore: 0.33 },
};

function restBelow(rank: number, count: number, family: ArcFamily): number {
  const p = REST_PROFILE[family];
  if (rank <= 0) return p.top;
  if (rank >= count - 1) return p.bottom;
  const inner = count - 2;
  if (inner <= 1) return p.innerOuter;
  const f = (rank - 1) / (inner - 1);
  return p.innerOuter + f * (p.innerCore - p.innerOuter);
}

export function planArc(measures: MeasureLike[], options: ArcOptions): ArcDecision[] {
  const voices = options.voicesTopDown;
  const family: ArcFamily = options.family ?? "winds";
  const open = Math.max(0, options.openBars ?? 1);
  const density = densityCurve(measures);
  const n = measures.length;

  // Entry order: inner voices first, then outward, and the top voice last.
  // With four voices that is 2nd, 3rd, 4th (lowest), 1st (top).
  const inner = voices.slice(1, Math.max(1, voices.length - 1));
  const entryOrder = [...inner, ...voices.slice(-1), ...voices.slice(0, 1)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const entryBar = new Map<string, number>();
  entryOrder.forEach((v, i) => entryBar.set(v, open + i));

  const raw: Array<Set<string>> = [];
  // Bars each voice has played. An entrance that lasts one bar is not an
  // entrance — the smoother deletes it as flicker, and it deserves to.
  const played = new Map<string, number>();
  const ARRIVAL_BARS = 2;
  for (let i = 0; i < n; i++) {
    const bar = i + 1;
    const d = density[i] ?? 0;
    const playing = new Set<string>();
    for (const v of voices) {
      if (bar < (entryBar.get(v) ?? 0) + 1) continue;      // has not entered yet
      // An INNER voice's first appearance is its arrival and is not up for
      // debate: that is what makes the ensemble gather rather than switch on,
      // and a thin opening is exactly where it is audible — "piano first, then
      // quiet clarinet colour, a little bassoon, then oboe". Gating it by
      // density collapsed all four onto one bar.
      //
      // The outer voices get no such exemption. The top competes with the
      // melody the pianist already has and the bottom adds weight, so if the
      // writing is thin when their turn comes, they wait for it to open out.
      const rank = voices.indexOf(v);
      const isOuter = rank === 0 || rank === voices.length - 1;
      const settled = (played.get(v) ?? 0) >= ARRIVAL_BARS;
      if ((isOuter || settled) && d < restBelow(rank, voices.length, family)) continue;
      played.set(v, (played.get(v) ?? 0) + 1);
      playing.add(v);
    }
    raw.push(playing);
  }

  // Smooth: a part that appears for a single bar between two rests is noise.
  for (const v of voices) {
    for (let i = 1; i < n - 1; i++) {
      if (raw[i]!.has(v) && !raw[i - 1]!.has(v) && !raw[i + 1]!.has(v)) raw[i]!.delete(v);
      if (!raw[i]!.has(v) && raw[i - 1]!.has(v) && raw[i + 1]!.has(v)) raw[i]!.add(v);
    }
  }

  return raw.map((playing, i) => ({ playing, intensity: density[i] ?? 0 }));
}

// ── How often a sustaining part re-attacks ──────────────────────────────────

/** Note values a player reads without counting, longest first. */
const BOW_LENGTHS = [4, 3, 2, 1.5, 1];

/**
 * The longest note worth writing at this tempo, in beats.
 *
 * A bow lasts a couple of seconds at a comfortable speed, so the value that
 * fills one is a function of tempo, not a constant. At 71 to the quarter a
 * half note runs about 1.7 seconds and is exactly right; at 120 the same
 * duration wants a dotted half; at 60, a dotted quarter. Picking a note value
 * rather than a raw duration keeps the result readable.
 */
export function bowLengthBeats(quarterBpm: number, secondsPerBow = 1.8): number {
  const bpm = Number.isFinite(quarterBpm) && quarterBpm > 0 ? quarterBpm : 90;
  const beats = (secondsPerBow * bpm) / 60;
  return BOW_LENGTHS.find((v) => v <= beats + 1e-9) ?? 1;
}

/** The tempo the score asks for, or null when it does not say. */
export function quarterBpmOf(measures: MeasureLike[]): number | null {
  for (const m of measures ?? []) {
    const bpm = Number((m as any)?.performance?.tempos?.[0]?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) return bpm;
  }
  return null;
}

/**
 * Stop a sustaining part from re-striking a note it is already holding.
 *
 * Our complementary parts were built on the piano's own onsets — the branch
 * says as much, "use piano RH onsets as rhythm grid" — which for a ballad
 * means the strings hammer out every quaver the pianist plays. On the
 * reference song that is 1,367 attacks against a reference edition's 606, and
 * the difference is almost entirely repeated notes: 671 quarters and 547
 * eighths where the reference writes 421 half notes.
 *
 * Adjacent notes of the SAME pitch are merged and re-emitted at a bow's
 * length. Only the same pitch: a part that is actually moving keeps every note
 * it had, so this thins repetition without touching melody. The pieces are
 * separate notes rather than ties, because a renewed bow is what is wanted —
 * a tie would ask one player to hold a whole phrase in a single stroke.
 */
export function sustainForBowing(parts: PartLike[], maxBeats: number): number {
  let removed = 0;
  for (const part of parts) {
    for (const measure of part?.measures ?? []) {
      const events: any[] = (measure?.events ?? []) as any[];
      const notes = events.filter((e) => e?.type === "note" && Number.isFinite(Number(e?.t)));
      if (notes.length < 2) continue;
      const others = events.filter((e) => e?.type !== "note");

      // One stream per sounding pitch; a divisi stack is several streams that
      // happen to share onsets, and each is held or re-struck on its own.
      const byPitch = new Map<string, any[]>();
      for (const n of notes) {
        const k = `${n.voice ?? 1}|${soundingMidi(n) ?? JSON.stringify(n.pitch)}`;
        const list = byPitch.get(k);
        if (list) list.push(n);
        else byPitch.set(k, [n]);
      }

      const kept: any[] = [];
      for (const stream of byPitch.values()) {
        stream.sort((a, b) => Number(a.t) - Number(b.t));
        let i = 0;
        while (i < stream.length) {
          // Gather everything contiguous at this pitch.
          const first = stream[i]!;
          let end = Number(first.t) + Number(first.dur);
          let j = i + 1;
          while (j < stream.length && Math.abs(Number(stream[j]!.t) - end) < 1e-9) {
            end += Number(stream[j]!.dur);
            j++;
          }
          const wasCount = j - i;
          // Re-emit that span as bow lengths, the last piece taking the
          // remainder so the span still ends exactly where it did.
          let at = Number(first.t);
          let piece = 0;
          while (at < end - 1e-9) {
            const dur = Math.min(maxBeats, end - at);
            kept.push({ ...first, id: `${first.id}-b${piece}`, t: at, dur });
            at += dur;
            piece++;
          }
          // How many attacks this span cost, against how many it now costs.
          removed += wasCount - piece;
          i = j;
        }
      }
      kept.sort((a, b) => (Math.abs(Number(a.t) - Number(b.t)) > 1e-9 ? Number(a.t) - Number(b.t) : Number(a.midi ?? 0) - Number(b.midi ?? 0)));
      measure.events = [...others, ...kept];
    }
  }
  return removed;
}

/**
 * Silence the bars the arc does not call for. Notes are removed, not muted:
 * the exporter fills an empty measure with a rest, which is what a player
 * needs to see.
 */
export function applyArc(parts: PartLike[], arc: ArcDecision[]): Map<string, number> {
  const rested = new Map<string, number>();
  for (const part of parts) {
    const id = String(part?.part_id ?? "");
    let count = 0;
    const measures: MeasureLike[] = part?.measures ?? [];
    for (let i = 0; i < measures.length; i++) {
      const decision = arc[i];
      if (!decision || decision.playing.has(id)) continue;
      const had = (measures[i]?.events ?? []).some((e: any) => e?.type === "note");
      if (had) { measures[i]!.events = []; count++; }
    }
    rested.set(id, count);
  }
  return rested;
}

// ── A short answer at the end of a phrase ───────────────────────────────────

/**
 * Give the top voice something to say at the end of a phrase.
 *
 * Sustaining is the right default for an accompaniment, and the pass above
 * makes it one — but a line that only ever holds is furniture. The reference
 * edition lets its first violin answer on selected phrase tails: a quarter and
 * two quavers over the last two beats, slurred, stepping away to a neighbouring
 * chord tone and back. Thirty-two notes in a 62-bar song. Not much, and the
 * only place the part sounds like a voice rather than a pad.
 *
 * WHICH BARS. The reference names them outright — 16, 18, 20, 23, 26 — which
 * its own guide admits is a decision about that score and not a rule. But the
 * shape of the list gives the rule away: it is every other bar once the music
 * has opened up. So the condition here is the density already measured for the
 * arc, plus alternation, which needs no section labels and invents none.
 *
 * WHICH NOTE. The step-away pitch is taken from what the rest of the ensemble
 * is actually sounding in that bar, not from a chord symbol. That keeps the
 * inflection inside the harmony as voiced rather than as named — and it cannot
 * disagree with the other parts, because it is drawn from them.
 */
export function addAnsweringGestures(
  parts: PartLike[],
  arc: ArcDecision[],
  options?: { minIntensity?: number; beats?: number; everyNth?: number }
): number {
  const top = parts[0];
  if (!top) return 0;
  const topId = String(top.part_id ?? "");
  const minIntensity = options?.minIntensity ?? 0.6;
  const span = options?.beats ?? 2;
  const everyNth = Math.max(1, options?.everyNth ?? 2);

  let added = 0;
  let eligibleSeen = 0;

  const measures: MeasureLike[] = top.measures ?? [];
  for (let i = 0; i < measures.length; i++) {
    const decision = arc[i];
    if (!decision || decision.intensity < minIntensity || !decision.playing.has(topId)) continue;

    const measure = measures[i]!;
    const notes = (measure.events ?? []).filter((e: any) => e?.type === "note");
    if (!notes.length) continue;

    // How long the bar is, taken from what is written in it.
    const barBeats = notes.reduce((m: number, e: any) => Math.max(m, Number(e.t) + Number(e.dur)), 0);
    if (barBeats < span * 2) continue;          // too short to answer within

    // The note holding the tail of the bar. Only a HELD note is replaced: a
    // part already moving there is saying something of its own.
    const tailStart = barBeats - span;
    const held = notes.find((e: any) =>
      Number(e.t) <= tailStart + 1e-9 && Number(e.t) + Number(e.dur) >= barBeats - 1e-9);
    if (!held) continue;
    const others = notes.filter((e: any) => e !== held);
    if (others.some((e: any) => Number(e.t) > tailStart + 1e-9)) continue;  // already busy

    eligibleSeen++;
    if ((eligibleSeen - 1) % everyNth !== 0) continue;

    const p = soundingMidi(held);
    if (p === null) continue;

    // What the rest of the ensemble is sounding in this bar.
    const pcs = new Set<number>();
    for (const part of parts) {
      if (part === top) continue;
      for (const e of (part?.measures?.[i]?.events ?? []) as any[]) {
        if (e?.type !== "note") continue;
        const m = soundingMidi(e);
        if (m !== null) pcs.add(((m % 12) + 12) % 12);
      }
    }
    if (!pcs.size) continue;

    // The nearest other chord tone, a step or so away — near enough to be an
    // inflection rather than a leap into a new line.
    let q: number | null = null;
    for (let d = 1; d <= 4; d++) {
      for (const cand of [p + d, p - d]) {
        if (cand !== p && pcs.has(((cand % 12) + 12) % 12)) { q = cand; break; }
      }
      if (q !== null) break;
    }
    if (q === null) continue;

    // Quarter, quaver, quaver — under one slur, back where it started.
    const shorten = tailStart - Number(held.t);
    if (shorten > 1e-9) held.dur = shorten;
    else measure.events = (measure.events ?? []).filter((e: any) => e !== held);

    const half = span / 2;
    const quarterPiece = half;
    const eighthPiece = half / 2;
    const gesture = [
      { t: tailStart, dur: quarterPiece, midi: p, slurStart: true },
      { t: tailStart + quarterPiece, dur: eighthPiece, midi: q },
      { t: tailStart + quarterPiece + eighthPiece, dur: eighthPiece, midi: p, slurStop: true },
    ];
    gesture.forEach((g, k) => {
      (measure.events as any[]).push({
        ...held,
        id: `${held.id}-ans${k}`,
        t: g.t,
        dur: g.dur,
        midi: g.midi,
        // The step-away note needs a spelling of its own; reusing the held
        // note's pitch would write the wrong notehead at the right MIDI.
        pitch: g.midi === p ? held.pitch : midiToPitch(g.midi),
        ...(g.slurStart ? { slurStart: true } : {}),
        ...(g.slurStop ? { slurStop: true } : {}),
      });
    });
    (measure.events as any[]).sort((a: any, b: any) => Number(a.t) - Number(b.t));
    added += 3;
  }
  return added;
}

// ── Phrasing the accompaniment ──────────────────────────────────────────────

/** How long a complementary line may sound before it has to let go. */
const PHRASE_SPAN_BEATS = 6;
/** The silence that opens when it does — long enough to be a rest, not a blip. */
const PHRASE_REST_BEATS = 1.5;
/** Never leave a note shorter than this behind. */
const PHRASE_MIN_KEPT = 0.5;

/**
 * Break the added lines into gestures.
 *
 * The parts around a piano were playing continuously — 15 to 31 beats of
 * unbroken sound, against 4.5 to 6 in a careful hand-written accompaniment of
 * the same song. That is not a breathing problem, which we fixed by taking an
 * eighth here and there; it is a phrasing one. An accompaniment under a piano
 * that already has the tune should speak in short gestures and then stop, so
 * the ear keeps returning to the piano. Ours never stopped, so it stopped
 * being an accompaniment and became a pad.
 *
 * The device is the plainest one there is: where a line has sounded for longer
 * than it should, end the gesture early and leave a rest. Repeat until nothing
 * runs too long. Notes are shortened, never deleted outright, and never below
 * an eighth — the point is to open air between phrases, not to thin the line
 * until it disappears.
 *
 * Rests are not gaps to be filled. They are what makes the next entry audible.
 */
export function phraseComplement(
  parts: PartLike[],
  maxSpanBeats = PHRASE_SPAN_BEATS,
  restBeats = PHRASE_REST_BEATS
): number {
  let opened = 0;
  for (const part of parts ?? []) {
    const lengths = (part?.measures ?? []).map((m: any) => {
      const notes = (m?.events ?? []).filter((e: any) => e?.type === "note");
      const t = m?.attributes?.time;
      if (t && Number(t.beats) > 0 && Number(t.beat_type) > 0) return (Number(t.beats) * 4) / Number(t.beat_type);
      return notes.reduce((a: number, e: any) => Math.max(a, Number(e.t) + Number(e.dur)), 4) || 4;
    });
    // Absolute start of each bar, so a span can be followed across barlines.
    const starts: number[] = [];
    let at = 0;
    for (const l of lengths) { starts.push(at); at += l; }

    let skipBefore = 0;
    for (let guard = 0; guard < (part?.measures?.length ?? 0) * 8; guard++) {
      // Every note, in order, with where it sits on the whole timeline.
      const all: Array<{ ev: any; from: number; to: number }> = [];
      (part.measures ?? []).forEach((m: any, i: number) => {
        for (const ev of (m?.events ?? [])) {
          if (ev?.type !== "note" || ev.grace) continue;
          const from = (starts[i] ?? 0) + Number(ev.t);
          all.push({ ev, from, to: from + Number(ev.dur) });
        }
      });
      all.sort((a, b) => a.from - b.from || a.to - b.to);
      if (!all.length) break;

      // Walk forward to the first stretch that has run longer than it may,
      // ignoring any we have already failed to break — a span we cannot cut is
      // a reason to move on, not to abandon the rest of the part. Giving up on
      // the whole line at the first awkward span is what made the first version
      // of this open eight rests in a piece and stop.
      let spanStart = all[0]!.from;
      let reach = all[0]!.to;
      let found: { start: number; end: number } | null = null;
      for (let i = 1; i <= all.length; i++) {
        const n = all[i];
        if (!n || n.from > reach + 1e-9) {
          if (reach - spanStart > maxSpanBeats + 1e-9 && spanStart >= skipBefore - 1e-9) {
            found = { start: spanStart, end: reach };
            break;
          }
          if (!n) break;
          spanStart = n.from; reach = n.to; continue;
        }
        reach = Math.max(reach, n.to);
        if (reach - spanStart > maxSpanBeats + 1e-9 && spanStart >= skipBefore - 1e-9) {
          found = { start: spanStart, end: reach };
          break;
        }
      }
      if (!found) break;

      // End the gesture at the note boundary nearest the limit, not at whatever
      // note happened to cross it — that note can be an eighth with nothing to
      // give. Walk back through the candidates until one can spare the rest.
      const aim = found.start + maxSpanBeats;
      const inSpan = all
        .filter((n) => n.to > found!.start + 1e-9 && n.from < found!.end - 1e-9)
        .sort((a, b) => Math.abs(a.to - aim) - Math.abs(b.to - aim));
      let changed = false;
      for (const anchor of inSpan) {
        if (anchor.to - restBeats <= found.start + PHRASE_MIN_KEPT) continue;
        const cut = anchor.to - restBeats;
        for (const n of all) {
          if (n.to <= cut + 1e-9 || n.from >= anchor.to - 1e-9) continue;
          const kept = Math.max(PHRASE_MIN_KEPT, cut - n.from);
          if (kept < Number(n.ev.dur) - 1e-9) { n.ev.dur = kept; n.ev.tieStart = false; changed = true; }
        }
        if (changed) break;
      }
      if (!changed) { skipBefore = found.end; continue; }   // nothing to give here; look past it
      opened++;
    }
  }
  return opened;
}

/** A complementary note lets go this much before the next attack arrives. */
const RELEASE_SHARE = 0.75;

/**
 * Let go a little before the next attack.
 *
 * This is how the reference accompaniment actually breathes: a note of a beat
 * and a half followed by a half-beat gap, over and over — thirty-three such
 * gaps in the oboe and every one of them the same length. Not a phrase break;
 * just a line that does not lean on the piano.
 *
 * I built this once, measured the longest unbroken span, saw it fall to a beat
 * and a half, and deleted it for shattering the phrasing. The metric was
 * wrong: it counts any silence as a break, so it scored the reference's own
 * texture as badly as ours. What actually sounded wrong was the OTHER thing —
 * holes of a beat and a half dropped into the middle of phrases, which read as
 * chopping rather than as air.
 *
 * Nothing is deleted and nothing moves; notes only get shorter, never below an
 * eighth, and never a note tied onward.
 */
export function releaseBeforeNextAttack(parts: PartLike[], share = RELEASE_SHARE): number {
  let shortened = 0;
  for (const part of parts ?? []) {
    for (const m of part?.measures ?? []) {
      const notes = (m?.events ?? [])
        .filter((e: any) => e?.type === "note" && !e.grace)
        .sort((a: any, b: any) => Number(a.t) - Number(b.t));
      if (!notes.length) continue;
      const time = m?.attributes?.time;
      const barBeats = time && Number(time.beats) > 0 && Number(time.beat_type) > 0
        ? (Number(time.beats) * 4) / Number(time.beat_type)
        : notes.reduce((a: number, e: any) => Math.max(a, Number(e.t) + Number(e.dur)), 4) || 4;
      for (let i = 0; i < notes.length; i++) {
        const ev = notes[i]!;
        if (ev.tieStart === true) continue;
        const nextAt = i + 1 < notes.length ? Number(notes[i + 1]!.t) : barBeats;
        const room = nextAt - Number(ev.t);
        if (room <= 0) continue;
        const want = Math.max(PHRASE_MIN_KEPT, room * share);
        if (want < Number(ev.dur) - 1e-9) { ev.dur = want; shortened++; }
      }
    }
  }
  return shortened;
}
