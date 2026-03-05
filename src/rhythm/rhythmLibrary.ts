// src/rhythm/rhythmLibrary.ts
import fs from "node:fs";
import path from "node:path";
import type { GrooveTemplate, MeterSpec, RhythmCell } from "./rhythmTypes";

type CellsJson = { version: string; unit: string; cells: RhythmCell[] };
type TemplatesJson = { version: string; unit: string; templates: GrooveTemplate[] };

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function sameMeter(a: MeterSpec, b: MeterSpec): boolean {
  return a.beats === b.beats && a.beatType === b.beatType;
}

function measureLenInQuarter(m: MeterSpec): number {
  // Total quarter-units in a measure:
  // beats * (4 / beatType)
  return m.beats * (4 / m.beatType);
}

export function loadRhythmCellsAndTemplates(params: {
  warnings: string[];
}): { cells: RhythmCell[]; templates: GrooveTemplate[] } {
  const { warnings } = params;

  const cellsPath = path.resolve(process.cwd(), "src/rhythm/data/rhythmCells.json");
  const templatesPath = path.resolve(process.cwd(), "src/rhythm/data/grooveTemplates.json");

  if (!fs.existsSync(cellsPath)) warn(warnings, `[rhythm] Missing file: ${cellsPath}`);
  if (!fs.existsSync(templatesPath)) warn(warnings, `[rhythm] Missing file: ${templatesPath}`);

  const cellsRaw = fs.readFileSync(cellsPath, "utf8");
  const templatesRaw = fs.readFileSync(templatesPath, "utf8");

  const cellsJson = JSON.parse(cellsRaw) as CellsJson;
  const templatesJson = JSON.parse(templatesRaw) as TemplatesJson;

  return {
    cells: Array.isArray(cellsJson.cells) ? cellsJson.cells : [],
    templates: Array.isArray(templatesJson.templates) ? templatesJson.templates : []
  };
}

export function pickGrooveTemplate(params: {
  templates: GrooveTemplate[];
  style: GrooveTemplate["style"];
  meter: MeterSpec;
  role: GrooveTemplate["role"];
  warnings: string[];
}): GrooveTemplate | null {
  const { templates, style, meter, role, warnings } = params;

  const matches = templates.filter((t) => t.style === style && t.role === role && sameMeter(t.meter, meter));
  if (!matches.length) {
    warn(
      warnings,
      `[rhythm] No groove template for style="${style}" role="${role}" meter=${meter.beats}/${meter.beatType}.`
    );
    return null;
  }

  // v1: if multiple matches, pick first
  if (matches.length > 1) {
    warn(
      warnings,
      `[rhythm] Multiple groove templates matched for style="${style}" role="${role}" meter=${meter.beats}/${meter.beatType}. Using first: ${matches[0]!.id}`
    );
  }
  return matches[0]!;
}

export function pickCellForTemplate(params: {
  template: GrooveTemplate;
  cells: RhythmCell[];
  warnings: string[];
}): RhythmCell | null {
  const { template, cells, warnings } = params;

  const meter = template.meter;
  const len = measureLenInQuarter(meter);

  const cellById = new Map<string, RhythmCell>();
  for (const c of cells) cellById.set(c.id, c);

  // Expand candidates with weights
  const candidates: Array<{ cell: RhythmCell; weight: number }> = [];
  for (const cw of template.cells ?? []) {
    const cell = cellById.get(cw.cellId);
    if (!cell) {
      warn(warnings, `[rhythm] Template "${template.id}" references missing cell "${cw.cellId}".`);
      continue;
    }
    if (!sameMeter(cell.meter, meter)) {
      warn(
        warnings,
        `[rhythm] Cell "${cell.id}" meter mismatch. Template meter=${meter.beats}/${meter.beatType}, cell meter=${cell.meter.beats}/${cell.meter.beatType}. Skipping.`
      );
      continue;
    }
    const sum = (cell.durs ?? []).reduce((a, b) => a + Number(b ?? 0), 0);
    if (Math.abs(sum - len) > 1e-6) {
      warn(warnings, `[rhythm] Cell "${cell.id}" durations sum=${sum} but expected=${len}. Skipping.`);
      continue;
    }
    candidates.push({ cell, weight: Math.max(0, Number(cw.weight ?? 0)) });
  }

  if (!candidates.length) {
    warn(warnings, `[rhythm] No valid rhythm cells for template "${template.id}".`);
    return null;
  }

  // v1 weighted pick (stable-ish): deterministic using a simple hash of template id
  // so runs are repeatable while we test.
  const seed = Array.from(template.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const total = candidates.reduce((a, b) => a + b.weight, 0) || 1;

  let r = (seed % 997) / 997; // 0..1
  r *= total;

  for (const c of candidates) {
    if (r <= c.weight) return c.cell;
    r -= c.weight;
  }

  return candidates[candidates.length - 1]!.cell;
}