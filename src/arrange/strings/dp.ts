import type { CandidateState, PendingRecovery, Slice, TransitionScore, VoiceId, Voicing } from "./types";
import { evaluateTransition, PROFILE_WEIGHTS } from "./constraints";

type Node = {
  cost: number;
  prevIndex: number;
  penalties: TransitionScore["penalties"];
  state: CandidateState;
};

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function emptyPending(): PendingRecovery {
  return { vln1: null, vln2: null, vla: null, vc: null, cb: null };
}

export function runDp(params: {
  slices: Slice[];
  candidatesBySlice: Voicing[][];
  profileId: keyof typeof PROFILE_WEIGHTS;
}): { best: CandidateState[]; penalties: Array<{ measure: number; t: number; penalties: TransitionScore["penalties"] }> } {
  const { slices, candidatesBySlice, profileId } = params;
  const profile = PROFILE_WEIGHTS[profileId];
  if (!slices.length || !candidatesBySlice.length) return { best: [], penalties: [] };

  const layers: Node[][] = [];
  let prevLayer: Node[] = candidatesBySlice[0].map((voicing) => ({
    cost: 0,
    prevIndex: -1,
    penalties: [],
    state: { voicing, pendingRecovery: emptyPending() }
  }));
  layers.push(prevLayer);

  for (let i = 1; i < slices.length; i++) {
    const slice = slices[i];
    const nextLayer: Node[] = [];
    const candidates = candidatesBySlice[i];
    for (let j = 0; j < candidates.length; j++) {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrev = -1;
      let bestPenalties: TransitionScore["penalties"] = [];
      let bestPending = emptyPending();

      for (let k = 0; k < prevLayer.length; k++) {
        const prevNode = prevLayer[k];
        const score = evaluateTransition(prevNode.state.voicing, candidates[j], {
          profile,
          pendingRecovery: prevNode.state.pendingRecovery
        });
        const cost = prevNode.cost + score.cost;
        if (cost < bestCost) {
          bestCost = cost;
          bestPrev = k;
          bestPenalties = score.penalties;
          bestPending = score.pendingRecovery;
        }
      }

      nextLayer.push({
        cost: bestCost,
        prevIndex: bestPrev,
        penalties: bestPenalties,
        state: { voicing: candidates[j], pendingRecovery: bestPending }
      });
    }

    const bestPenalty = nextLayer.reduce((best, n) => (n.cost < best.cost ? n : best), nextLayer[0]!);
    prevLayer = nextLayer;
    layers.push(nextLayer);
  }

  let bestIdx = 0;
  for (let i = 1; i < prevLayer.length; i++) {
    if (prevLayer[i].cost < prevLayer[bestIdx].cost) bestIdx = i;
  }

  const bestPath: CandidateState[] = [];
  const penaltiesBySlice: Array<{ measure: number; t: number; penalties: TransitionScore["penalties"] }> = [];
  let cursor = bestIdx;
  for (let i = slices.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const node = layer[cursor];
    bestPath.unshift(node.state);
    if (i > 0) {
      penaltiesBySlice.unshift({ measure: slices[i].measure, t: slices[i].t, penalties: node.penalties });
      cursor = node.prevIndex;
      if (cursor < 0) break;
    }
  }

  return { best: bestPath, penalties: penaltiesBySlice };
}
