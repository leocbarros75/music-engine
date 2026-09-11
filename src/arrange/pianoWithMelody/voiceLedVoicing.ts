/**
 * Voice-led chord voicing — piano_with_melody only.
 *
 * The shared voicer (`chordVoicesInRange` in ../pianoAccompPatterns) rebuilds every
 * chord from scratch in root position and has no memory of what came before, so a
 * player's fingers jump on every chord change:
 *
 *     D  -> G/B     D4 F#4 A4  ->  G4 B4 D5     every finger leaps a 4th
 *
 * even though the two chords share a D. This module chooses, from all the voicings
 * of the chord that fit the hand's window, the one closest to the previous chord —
 * so common tones stay put and everything else moves as little as possible:
 *
 *     D  -> G/B     D4 F#4 A4  ->  D4 G4 B4     D held; others move 1 and 2
 *
 * Only `arrangePianoFromSatb` reaches this, and only for ensembleTag
 * "piano_with_melody". Plain piano / grand_piano / acoustic_piano keep using the
 * root-position voicer and are byte-identical.
 */

import { parseChordSymbol } from "../../harmonize/satb/chordSymbol";

export type ChordVoices = { bass: number; mid: number; high: number };

/**
 * Carries the previous voicing across beats and bar lines. One state per hand,
 * created once per arrangement.
 */
export type VoiceLedState = {
  lastSymbol: string | null;
  last: ChordVoices | null;
  /**
   * Left hand: the bottom note is the harmony's bass and is pinned to the chord's
   * root — or to the named bass of a slash chord — with only its octave voice-led.
   * Right hand: the stack floats freely above that bass.
   */
  pinBass: boolean;
};

export function createVoiceLedState(hand: "rh" | "lh"): VoiceLedState {
  return { lastSymbol: null, last: null, pinBass: hand === "lh" };
}

/** Widest comfortable reach for one hand, lowest to highest note. */
const MAX_HAND_SPAN = 12;

/*
 * Why the left hand pins its bass rather than voice-leading it.
 *
 * Letting the whole LH stack float put the bass on inversions and, under a sustained
 * pattern like pedal_bass, on notes outside the chord altogether — a B under a D
 * chord. The left hand's bottom note IS the harmony's bass in this texture; nothing
 * else is playing one. So it is fixed by the chord symbol and only its octave is
 * chosen to sit near the previous bass. The notes above it still voice-lead.
 *
 * The right hand has no such duty: its stack sits above the bass, and insisting on a
 * root there is exactly what forced D4 F#4 A4 up to G4 B4 D5 instead of D4 G4 B4.
 */

/**
 * Keeps the voicing from drifting up the window over a long song.
 *
 * The anchor is on the BOTTOM note, held near where the hand starts, not on the
 * middle of the stack held near the middle of the window: the left hand's window is
 * nearly two octaves, so a centre-of-stack anchor actively pulls the bass upward and
 * a cadence ends up in second inversion.
 */
const REGISTER_ANCHOR_WEIGHT = 0.25;

function distinct(xs: number[]): number[] {
  return [...new Set(xs)];
}

/**
 * Best three-note voicing of `symbol` inside [lo, hi], nearest to `prev`.
 * Returns null when the chord cannot be parsed or nothing fits the window.
 */
function bestVoicing(
  symbol: string,
  lo: number,
  hi: number,
  prev: ChordVoices | null,
  pinBass: boolean
): ChordVoices | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;

  const pcs = distinct(parsed.pcs);
  if (!pcs.length) return null;

  // The note that should sit at the bottom: the slash bass when the symbol names
  // one (the B of G/B), otherwise the root.
  const bottomPc = parsed.bassPc ?? parsed.rootPc;

  const poolUpTo = (ceiling: number): number[] => {
    const xs: number[] = [];
    for (let m = lo; m <= ceiling; m++) if (pcs.includes(m % 12)) xs.push(m);
    return xs;
  };

  const pool = poolUpTo(hi);
  if (pool.length < 3) return null;

  // A triad must be complete; a seventh chord may omit its fifth, as it usually does.
  const needCoverage = Math.min(3, pcs.length);
  const homeBottom = lo + 2;
  const prevArr = prev ? [prev.bass, prev.mid, prev.high] : null;

  const scan = (
    fixedBottom: number | null,
    // Upper notes may reach above the window only in the last-resort pass below,
    // where the alternative is three voices on one pitch.
    ceiling: number = hi
  ): { v: number[]; cost: number } | null => {
    const upper = ceiling === hi ? pool : poolUpTo(ceiling);
    let best: { v: number[]; cost: number } | null = null;
    const bottoms = fixedBottom !== null ? [fixedBottom] : pool;
    for (const b of bottoms) {
      for (const mid of upper) {
        if (mid <= b) continue;
        for (const high of upper) {
          if (high <= mid) continue;
          const v = [b, mid, high];
          if (high - b > MAX_HAND_SPAN) continue;
          if (distinct(v.map((x) => x % 12)).length < needCoverage) continue;

          let cost = prevArr
            ? // A pinned bass is not a free choice, so its distance must not sway the
              // decision — only the notes actually being chosen are scored.
              (fixedBottom !== null ? 0 : Math.abs(b - prevArr[0]!)) +
              Math.abs(mid - prevArr[1]!) +
              Math.abs(high - prevArr[2]!)
            : // First chord of the piece: seed low in the window, like the old voicer,
              // so the arrangement starts where a player expects it to.
              Math.abs(b - homeBottom);

          if (fixedBottom === null) cost += REGISTER_ANCHOR_WEIGHT * Math.abs(b - homeBottom);

          if (!best || cost < best.cost) best = { v, cost };
        }
      }
    }
    return best;
  };

  // Left hand: the bass belongs to the harmony, not to the voice leading. Fix its
  // pitch class from the chord symbol — the named bass of a slash chord, else the
  // root — and choose only its octave, nearest the previous bass so the line itself
  // does not leap. Everything above it is still voice-led.
  if (pinBass) {
    // Built from the window directly, not from `pool`: a slash chord can name a bass
    // that is not one of the chord's own pitch classes, as C/D does.
    const candidates: number[] = [];
    for (let m = lo; m <= hi; m++) if (m % 12 === bottomPc) candidates.push(m);
    if (candidates.length) {
      const target = prev ? prev.bass : homeBottom;

      // Nearest the previous bass, but with the same gentle pull toward the bottom
      // of the window that the free branch gets. Distance alone made the bass
      // ratchet UPWARD: each chord picks the octave nearest the last one, which
      // keeps moving in whichever direction it has already moved, and over a song
      // the whole left hand climbed an octave (D2–E3 became D2–A3).
      const octaveCost = (m: number) =>
        Math.abs(m - target) + REGISTER_ANCHOR_WEIGHT * Math.abs(m - homeBottom);

      // Prefer an octave that a full voicing can actually stack above. A bass near
      // the ceiling leaves no room for mid and high, and the voicing then collapsed
      // onto three copies of the bass — which a walking bass turns into the same
      // note three times in a row instead of root–3rd–5th.
      const stackable = candidates.filter((m) => scan(m) !== null);
      const octaves = stackable.length ? stackable : candidates;
      const bass = octaves.reduce((a, b) => (octaveCost(b) < octaveCost(a) ? b : a));

      const pinned = scan(bass);
      if (pinned) return { bass: pinned.v[0]!, mid: pinned.v[1]!, high: pinned.v[2]! };

      // No octave of this bass admits a stack inside the window. Reach above the
      // window rather than return a unison — still inside one hand span, so it
      // stays playable, and the upper voices remain real, distinct chord tones.
      const reached = scan(bass, bass + MAX_HAND_SPAN);
      if (reached) return { bass: reached.v[0]!, mid: reached.v[1]!, high: reached.v[2]! };
      return { bass, mid: bass, high: bass };
    }
    // The chord's bass note does not exist anywhere in this window; fall through.
  }

  const best = scan(null);
  if (!best) return null;
  return { bass: best.v[0]!, mid: best.v[1]!, high: best.v[2]! };
}

/**
 * Voice-led replacement for `chordVoicesInRange`, threading `state` so each chord is
 * chosen relative to the one before it.
 *
 * Repeating the same symbol returns the identical voicing rather than recomputing,
 * so a pattern that asks for the chord on every eighth note stays rock-steady and
 * the result does not depend on the order the pattern builders happen to ask in.
 */
export function voiceLedChordVoices(
  symbol: string,
  lo: number,
  hi: number,
  state: VoiceLedState
): ChordVoices | null {
  if (state.lastSymbol === symbol && state.last) return state.last;

  const v = bestVoicing(symbol, lo, hi, state.last, state.pinBass);
  if (!v) return null;

  state.lastSymbol = symbol;
  state.last = v;
  return v;
}
