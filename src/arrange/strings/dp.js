"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDp = runDp;
var constraints_1 = require("./constraints");
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
function emptyPending() {
    return { vln1: null, vln2: null, vla: null, vc: null, cb: null };
}
function runDp(params) {
    var slices = params.slices, candidatesBySlice = params.candidatesBySlice, profileId = params.profileId;
    var profile = constraints_1.PROFILE_WEIGHTS[profileId];
    if (!slices.length || !candidatesBySlice.length)
        return { best: [], penalties: [] };
    var layers = [];
    var prevLayer = candidatesBySlice[0].map(function (voicing) { return ({
        cost: 0,
        prevIndex: -1,
        penalties: [],
        state: { voicing: voicing, pendingRecovery: emptyPending() }
    }); });
    layers.push(prevLayer);
    for (var i = 1; i < slices.length; i++) {
        var slice = slices[i];
        var nextLayer = [];
        var candidates = candidatesBySlice[i];
        for (var j = 0; j < candidates.length; j++) {
            var bestCost = Number.POSITIVE_INFINITY;
            var bestPrev = -1;
            var bestPenalties = [];
            var bestPending = emptyPending();
            for (var k = 0; k < prevLayer.length; k++) {
                var prevNode = prevLayer[k];
                var score = (0, constraints_1.evaluateTransition)(prevNode.state.voicing, candidates[j], {
                    profile: profile,
                    pendingRecovery: prevNode.state.pendingRecovery
                });
                var cost = prevNode.cost + score.cost;
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
        var bestPenalty = nextLayer.reduce(function (best, n) { return (n.cost < best.cost ? n : best); }, nextLayer[0]);
        prevLayer = nextLayer;
        layers.push(nextLayer);
    }
    var bestIdx = 0;
    for (var i = 1; i < prevLayer.length; i++) {
        if (prevLayer[i].cost < prevLayer[bestIdx].cost)
            bestIdx = i;
    }
    var bestPath = [];
    var penaltiesBySlice = [];
    var cursor = bestIdx;
    for (var i = slices.length - 1; i >= 0; i--) {
        var layer = layers[i];
        var node = layer[cursor];
        bestPath.unshift(node.state);
        if (i > 0) {
            penaltiesBySlice.unshift({ measure: slices[i].measure, t: slices[i].t, penalties: node.penalties });
            cursor = node.prevIndex;
            if (cursor < 0)
                break;
        }
    }
    return { best: bestPath, penalties: penaltiesBySlice };
}
