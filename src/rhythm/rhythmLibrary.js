"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRhythmCellsAndTemplates = loadRhythmCellsAndTemplates;
exports.pickGrooveTemplate = pickGrooveTemplate;
exports.pickCellForTemplate = pickCellForTemplate;
// src/rhythm/rhythmLibrary.ts
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
function warn(warnings, msg) {
    warnings.push(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
}
function sameMeter(a, b) {
    return a.beats === b.beats && a.beatType === b.beatType;
}
function measureLenInQuarter(m) {
    // Total quarter-units in a measure:
    // beats * (4 / beatType)
    return m.beats * (4 / m.beatType);
}
function loadRhythmCellsAndTemplates(params) {
    var warnings = params.warnings;
    var cellsPath = node_path_1.default.resolve(process.cwd(), "src/rhythm/data/rhythmCells.json");
    var templatesPath = node_path_1.default.resolve(process.cwd(), "src/rhythm/data/grooveTemplates.json");
    if (!node_fs_1.default.existsSync(cellsPath))
        warn(warnings, "[rhythm] Missing file: ".concat(cellsPath));
    if (!node_fs_1.default.existsSync(templatesPath))
        warn(warnings, "[rhythm] Missing file: ".concat(templatesPath));
    var cellsRaw = node_fs_1.default.readFileSync(cellsPath, "utf8");
    var templatesRaw = node_fs_1.default.readFileSync(templatesPath, "utf8");
    var cellsJson = JSON.parse(cellsRaw);
    var templatesJson = JSON.parse(templatesRaw);
    return {
        cells: Array.isArray(cellsJson.cells) ? cellsJson.cells : [],
        templates: Array.isArray(templatesJson.templates) ? templatesJson.templates : []
    };
}
function pickGrooveTemplate(params) {
    var templates = params.templates, style = params.style, meter = params.meter, role = params.role, warnings = params.warnings;
    var matches = templates.filter(function (t) { return t.style === style && t.role === role && sameMeter(t.meter, meter); });
    if (!matches.length) {
        warn(warnings, "[rhythm] No groove template for style=\"".concat(style, "\" role=\"").concat(role, "\" meter=").concat(meter.beats, "/").concat(meter.beatType, "."));
        return null;
    }
    // v1: if multiple matches, pick first
    if (matches.length > 1) {
        warn(warnings, "[rhythm] Multiple groove templates matched for style=\"".concat(style, "\" role=\"").concat(role, "\" meter=").concat(meter.beats, "/").concat(meter.beatType, ". Using first: ").concat(matches[0].id));
    }
    return matches[0];
}
function pickCellForTemplate(params) {
    var _a, _b, _c;
    var template = params.template, cells = params.cells, warnings = params.warnings;
    var meter = template.meter;
    var len = measureLenInQuarter(meter);
    var cellById = new Map();
    for (var _i = 0, cells_1 = cells; _i < cells_1.length; _i++) {
        var c = cells_1[_i];
        cellById.set(c.id, c);
    }
    // Expand candidates with weights
    var candidates = [];
    for (var _d = 0, _e = (_a = template.cells) !== null && _a !== void 0 ? _a : []; _d < _e.length; _d++) {
        var cw = _e[_d];
        var cell = cellById.get(cw.cellId);
        if (!cell) {
            warn(warnings, "[rhythm] Template \"".concat(template.id, "\" references missing cell \"").concat(cw.cellId, "\"."));
            continue;
        }
        if (!sameMeter(cell.meter, meter)) {
            warn(warnings, "[rhythm] Cell \"".concat(cell.id, "\" meter mismatch. Template meter=").concat(meter.beats, "/").concat(meter.beatType, ", cell meter=").concat(cell.meter.beats, "/").concat(cell.meter.beatType, ". Skipping."));
            continue;
        }
        var sum = ((_b = cell.durs) !== null && _b !== void 0 ? _b : []).reduce(function (a, b) { return a + Number(b !== null && b !== void 0 ? b : 0); }, 0);
        if (Math.abs(sum - len) > 1e-6) {
            warn(warnings, "[rhythm] Cell \"".concat(cell.id, "\" durations sum=").concat(sum, " but expected=").concat(len, ". Skipping."));
            continue;
        }
        candidates.push({ cell: cell, weight: Math.max(0, Number((_c = cw.weight) !== null && _c !== void 0 ? _c : 0)) });
    }
    if (!candidates.length) {
        warn(warnings, "[rhythm] No valid rhythm cells for template \"".concat(template.id, "\"."));
        return null;
    }
    // v1 weighted pick (stable-ish): deterministic using a simple hash of template id
    // so runs are repeatable while we test.
    var seed = Array.from(template.id).reduce(function (acc, ch) { return acc + ch.charCodeAt(0); }, 0);
    var total = candidates.reduce(function (a, b) { return a + b.weight; }, 0) || 1;
    var r = (seed % 997) / 997; // 0..1
    r *= total;
    for (var _f = 0, candidates_1 = candidates; _f < candidates_1.length; _f++) {
        var c = candidates_1[_f];
        if (r <= c.weight)
            return c.cell;
        r -= c.weight;
    }
    return candidates[candidates.length - 1].cell;
}
