import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDp } from '../../src/arrange/strings/dp';
import { evaluateTransition, PROFILE_WEIGHTS } from '../../src/arrange/strings/constraints';
import type { Slice, Voicing } from '../../src/arrange/strings/types';

/**
 * Carrying only the N cheapest states out of each slice.
 *
 * The search costs slices × candidates², and piano+strings offers ~440
 * candidates per slice because its Violin I is deliberately free to take any
 * chord tone. That is 48 million transition evaluations and about 39 seconds —
 * the slowest thing the engine does.
 *
 * The hazard is not the pruning, it is the bookkeeping: a node remembers its
 * predecessor as an INDEX into the previous layer, and the path is rebuilt at
 * the end by walking those indices. Prune a layer after recording indices into
 * it, or keep one array and store another, and the backtrack silently rebuilds
 * the arrangement out of the wrong voicings — no crash, just different music.
 */

const voicing = (vln1: number, vln2: number, vla: number, vc: number): Voicing =>
  ({ vln1, vln2, vla, vc, cb: null });

/**
 * Slices whose best voicing sits at a DIFFERENT index each time.
 *
 * This matters more than it looks. My first fixture offered the same voicings
 * in the same order every slice, so holding still was free, the answer was
 * always candidate 0, and the cheapest kept state and the first listed state
 * were the same node — which meant a deliberately broken backtrack produced
 * identical output and every test passed. A fixture has to make the optimum
 * MOVE before it can tell a correct walk from a wrong one.
 */
function problem(slices: number, perSlice: number) {
  const s: Slice[] = [];
  const cands: Voicing[][] = [];
  for (let i = 0; i < slices; i++) {
    s.push({ measure: i + 1, t: 0, dur: 4, melodyMidi: null, chordSymbol: 'C' });
    const best = (i * 5 + 3) % perSlice;
    const layer: Voicing[] = [];
    for (let j = 0; j < perSlice; j++) {
      // Distance from this slice's comfortable voicing; the further out, the
      // dearer, so the cheapest candidate is at `best` rather than at 0.
      const off = (j - best + perSlice) % perSlice;
      layer.push(voicing(76 + off * 3, 67 + off * 2, 59 + off * 2, 48 + off));
    }
    cands.push(layer);
  }
  return { slices: s, candidatesBySlice: cands, profileId: 'melody_harmony' as const };
}

test('omitting the beam searches exhaustively, exactly as before', () => {
  const p = problem(6, 20);
  const a = runDp(p);
  const b = runDp({ ...p, beamWidth: undefined });
  assert.deepEqual(b.best, a.best, 'an absent beam changes nothing');
});

test('a beam wider than the layer prunes nothing and finds the same path', () => {
  const p = problem(6, 20);
  const exhaustive = runDp(p);
  const wide = runDp({ ...p, beamWidth: 1000 });
  assert.deepEqual(wide.best, exhaustive.best);
});

test('a zero or negative beam is treated as no beam, not as an empty one', () => {
  const p = problem(5, 12);
  const exhaustive = runDp(p);
  for (const beamWidth of [0, -1, Number.NaN]) {
    assert.deepEqual(runDp({ ...p, beamWidth }).best, exhaustive.best, `beamWidth=${beamWidth}`);
  }
});

test('a narrow beam still returns one voicing per slice — the backtrack holds', () => {
  // The bug this guards: prevIndex points into a layer that was pruned after
  // the index was taken, so the walk reads a different node than it recorded.
  for (const beamWidth of [1, 2, 3, 7]) {
    const p = problem(12, 25);
    const r = runDp({ ...p, beamWidth });
    assert.equal(r.best.length, p.slices.length,
      `beam=${beamWidth} rebuilt ${r.best.length} of ${p.slices.length} slices`);
    for (const state of r.best) {
      assert(state && state.voicing, `beam=${beamWidth} produced a state with no voicing`);
    }
  }
});

test('every voicing on the path is one that was actually offered for that slice', () => {
  // A broken backtrack shows up here: it returns real voicings, but from the
  // wrong slice.
  const beamWidth = 3;
  const p = problem(10, 16);
  const r = runDp({ ...p, beamWidth });
  r.best.forEach((state, i) => {
    const offered = p.candidatesBySlice[i]!.some(
      (v) => v.vln1 === state.voicing.vln1 && v.vln2 === state.voicing.vln2 &&
             v.vla === state.voicing.vla && v.vc === state.voicing.vc);
    assert(offered, `slice ${i} got a voicing that was never a candidate there`);
  });
});

test('the path it reports is the path it costed', () => {
  // The sharp end. A broken backtrack still returns real voicings, one per
  // slice, every one of them a genuine candidate for that slice — so none of
  // the looser checks above notice. What it cannot do is stay CONSISTENT: the
  // penalties recorded for a step must be what that step actually costs.
  // Walking the wrong nodes makes the two disagree.
  for (const beamWidth of [2, 4, 9, undefined]) {
    const p = problem(10, 16);
    const r = runDp({ ...p, beamWidth });
    for (let i = 1; i < r.best.length; i++) {
      const recomputed = evaluateTransition(r.best[i - 1]!.voicing, r.best[i]!.voicing, {
        profile: PROFILE_WEIGHTS['melody_harmony'],
        pendingRecovery: r.best[i - 1]!.pendingRecovery,
        strongBeat: true,
      });
      const reported = r.penalties[i - 1]!.penalties.reduce((a, x) => a + x.cost, 0);
      assert(Math.abs(recomputed.cost - reported) < 1e-9,
        `beam=${beamWidth} slice ${i}: reported ${reported.toFixed(3)} but the path's own ` +
        `transition costs ${recomputed.cost.toFixed(3)} — the backtrack walked different states`);
    }
  }
});

test('a beam never finds a cheaper path than the exhaustive search', () => {
  // It may find a dearer one — that is the trade — but finding a cheaper one
  // would mean the exhaustive search was not exploring everything.
  const p = problem(8, 18);
  const exhaustive = runDp(p);
  const cost = (r: ReturnType<typeof runDp>) =>
    r.penalties.reduce((a, s) => a + s.penalties.reduce((b, x) => b + x.cost, 0), 0);
  const full = cost(exhaustive);
  for (const beamWidth of [2, 5, 10]) {
    assert(cost(runDp({ ...p, beamWidth })) >= full - 1e-9,
      `beam=${beamWidth} beat the exhaustive search, which is impossible`);
  }
});
