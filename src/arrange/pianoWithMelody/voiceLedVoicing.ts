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
  /** Cost of a non-root bottom note; see the constants below. */
  rootBottomPenalty: number;
  /** Left hand only: a slash chord's named bass note must sit at the bottom. */
  enforceNotatedBass: boolean;
};

export function createVoiceLedState(hand: "rh" | "lh", rootBottomPenaltyOverride?: number): VoiceLedState {
  return {
    lastSymbol: null,
    last: null,
    rootBottomPenalty:
      rootBottomPenaltyOverride ?? (hand === "lh" ? LH_NON_ROOT_BOTTOM_PENALTY : RH_NON_ROOT_BOTTOM_PENALTY),
    enforceNotatedBass: hand === "lh"
  };
}

/** Widest comfortable reach for one hand, lowest to highest note. */
const MAX_HAND_SPAN = 12;

/**
 * Cost of putting something other than the root (or the slash bass) at the bottom.
 *
 * This applies to the LEFT hand only, where the bottom note is the harmonic
 * foundation: voice leading may still invert a chord when that saves enough motion,
 * but roots stay in the bass by default. Raise to keep more roots, lower to let the
 * bass move more freely.
 *
 * The right hand passes 0. Its stack sits above the bass and has no bass function,
 * so insisting on a root there would recreate the very leaping this module exists to
 * remove — it is what forces D4 F#4 A4 up to G4 B4 D5 instead of settling on D4 G4 B4.
 */
const LH_NON_ROOT_BOTTOM_PENALTY = 3;
const RH_NON_ROOT_BOTTOM_PENALTY = 0;

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
  rootBottomPenalty: number,
  enforceNotatedBass: boolean
): ChordVoices | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;

  const pcs = distinct(parsed.pcs);
  if (!pcs.length) return null;

  // The note that should sit at the bottom: the slash bass when the symbol names
  // one (the B of G/B), otherwise the root.
  const bottomPc = parsed.bassPc ?? parsed.rootPc;

  const pool: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) pool.push(m);
  if (pool.length < 3) return null;

  // A triad must be complete; a seventh chord may omit its fifth, as it usually does.
  const needCoverage = Math.min(3, pcs.length);
  const homeBottom = lo + 2;
  const prevArr = prev ? [prev.bass, prev.mid, prev.high] : null;

  const scan = (requiredBottomPc: number | null): { v: number[]; cost: number } | null => {
  let best: { v: number[]; cost: number } | null = null;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const v = [pool[i]!, pool[j]!, pool[k]!];
        if (v[2]! - v[0]! > MAX_HAND_SPAN) continue;
        if (distinct(v.map((x) => x % 12)).length < needCoverage) continue;
        if (requiredBottomPc !== null && v[0]! % 12 !== requiredBottomPc) continue;

        let cost = prevArr
          ? Math.abs(v[0]! - prevArr[0]!) +
            Math.abs(v[1]! - prevArr[1]!) +
            Math.abs(v[2]! - prevArr[2]!)
          : // First chord of the piece: seed low in the window, like the old voicer,
            // so the arrangement starts where a player expects it to.
            Math.abs(v[0]! - homeBottom);

        if (rootBottomPenalty > 0 && v[0]! % 12 !== bottomPc) cost += rootBottomPenalty;
        cost += REGISTER_ANCHOR_WEIGHT * Math.abs(v[0]! - homeBottom);

        if (!best || cost < best.cost) best = { v, cost };
      }
    }
  }
  return best;
  };

  // A slash chord names its bass note: the lead sheet asked for the B of G/B, so in
  // the left hand that is a requirement, not a preference the movement cost may
  // outvote. Fall back to a free search only if the window admits no such voicing.
  const notatedBass = parsed.bassPc;
  const best =
    (enforceNotatedBass && notatedBass !== null ? scan(notatedBass) : null) ?? scan(null);

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

  const v = bestVoicing(symbol, lo, hi, state.last, state.rootBottomPenalty, state.enforceNotatedBass);
  if (!v) return null;

  state.lastSymbol = symbol;
  state.last = v;
  return v;
}
