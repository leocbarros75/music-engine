// src/import/rhythmChartPdf.ts
//
// Rhythm-chart PDF importer. Parses a PraiseCharts/Prism-style "Rhythm" part
// (chords + slash comping + written ensemble figures) into a structured chart:
// per-measure chords with beat positions, kick onsets, sections, tempo, key.
//
// How: pdf-parse gives positioned text items. The notation font leaks its
// glyphs as text — ’ (slash beat), Û (figure notehead), | (sustained diamond),
// ‰/Œ (rests) — with x/y coordinates. Measure numbers sit in their own font at
// a fixed y per system; chords sit in a band above the staff; slash chords are
// two symbols stacked at the same x. We reconstruct beats by interpolating x
// across the measure span, snapped to the half-beat grid.

import { createRequire } from "node:module";
import path from "node:path";
const _req = createRequire(path.resolve("package.json"));
const pdfParse: (buf: Buffer, opts?: any) => Promise<{ text: string }> = _req("pdf-parse");

type Item = { s: string; x: number; y: number; f: string };

export type RhythmChartMeasure = {
  number: number;                       // chart numbering (0 = pickup)
  chords: Array<{ t: number; symbol: string }>;
  kicks: number[] | null;               // onset beats of written figures; null = comping/sustain
  section?: string;
};

export type RhythmChart = {
  title?: string;
  tempoBpm?: number;
  beats: number;
  beatType: number;
  keyFifths: number;
  measures: RhythmChartMeasure[];
  warnings: string[];
};

const GLYPH_SLASH = "’";
const GLYPH_NOTE = "Û";
const GLYPH_DIAMOND = "|";
const GLYPH_RESTS = new Set(["‰", "Œ"]);
const GLYPH_SET = new Set([GLYPH_SLASH, GLYPH_NOTE, GLYPH_DIAMOND, "‰", "Œ", "J", "?", "«", "»"]);
const SECTION_RE = /^(VERSE|CHORUS|BRIDGE|REPRISE|INTRO|OUTRO|TAG|ENDING|INTERLUDE|VAMP)\b/i;

function snapHalf(b: number, beats: number): number {
  const s = Math.round(b * 2) / 2;
  return Math.max(0, Math.min(beats - 0.5, s));
}

/** Normalize chart chord spellings to what the engine's parser understands. */
export function normalizeChartSymbol(raw: string): string {
  let s = raw.replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
  // Split a slash chord, normalize the top, keep the bass.
  const slash = s.split("/");
  let main = slash[0]!;
  main = main
    .replace(/\(maj\.?7\)/i, "maj7")            // C#m(maj.7) → C#mmaj7
    .replace(/aug7/i, "7#5")                     // Xaug7 → X7#5
    .replace(/\(([#b]\d+)\)/g, "$1")             // 7(#9) → 7#9, 7(b5) → 7b5
    .replace(/[().]/g, "");
  // X2 → Xadd9 (worship "2" chord)
  const m2 = main.match(/^([A-G][#b]?)(m?)2$/);
  if (m2) main = m2[1]! + (m2[2] ? "madd9" : "add9");
  // combined #5#9 → keep the #9 colour (parser has 7#9; drop the #5 approximation)
  main = main.replace(/7#5#9/, "7#9");
  return slash.length > 1 ? main + "/" + slash[1] : main;
}

/** Best-fit major key from the chord roots (weighted toward the final chord). */
function estimateKeyFifths(symbols: string[]): number {
  const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const roots: number[] = [];
  for (const s of symbols) {
    const m = s.match(/^([A-G])([#b]?)/);
    if (!m) continue;
    let pc = NOTE[m[1]!]!;
    if (m[2] === "#") pc += 1; if (m[2] === "b") pc -= 1;
    roots.push(((pc % 12) + 12) % 12);
  }
  if (!roots.length) return 0;
  let best = 0, bestScore = -1;
  for (let f = -7; f <= 7; f++) {
    const tonic = ((f * 7) % 12 + 12) % 12;
    const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((i) => (tonic + i) % 12));
    let score = 0;
    for (const r of roots) if (scale.has(r)) score++;
    if (roots[roots.length - 1] === tonic) score += roots.length * 0.5; // final chord = tonic
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best;
}

export async function parseRhythmChartPdf(buf: Buffer): Promise<RhythmChart> {
  const warnings: string[] = [];
  const pages: Item[][] = [];
  await pdfParse(buf, {
    pagerender(pd: any) {
      return pd.getTextContent().then((tc: any) => {
        pages.push(tc.items.map((it: any) => ({
          s: String(it.str), x: it.transform[4], y: it.transform[5], f: String(it.fontName),
        })));
        return "";
      });
    },
  });

  // Whole-document text helpers (title, tempo).
  const allItems = pages.flat();
  const tempoIt = allItems.find((it) => /»\s*\d+/.test(it.s));
  const tempoBpm = tempoIt ? Number((tempoIt.s.match(/»\s*(\d+)/) ?? [])[1]) : undefined;

  // Font names are PER PAGE in pdf.js — detect the measure-number font and the
  // notation font independently on every page.
  function pageFonts(page: Item[]): { numberFont: string | null; notationFont: string | null } {
    const fontDigits = new Map<string, { total: number; ints: number }>();
    for (const it of page) {
      const e = fontDigits.get(it.f) ?? { total: 0, ints: 0 };
      e.total++;
      if (/^\d{1,3}$/.test(it.s.trim())) e.ints++;
      fontDigits.set(it.f, e);
    }
    let numberFont: string | null = null; let best = 0;
    for (const [f, e] of fontDigits) {
      if (e.total >= 3 && e.ints / e.total > 0.9 && e.ints > best) { numberFont = f; best = e.ints; }
    }
    const notationFont = page.find((it) => it.s.includes(GLYPH_SLASH) || it.s.includes(GLYPH_NOTE))?.f ?? null;
    return { numberFont, notationFont };
  }

  const beats = 4, beatType = 4; // v1: charts are overwhelmingly 4/4
  const measures: RhythmChartMeasure[] = [];

  for (const page of pages) {
    const { numberFont, notationFont } = pageFonts(page);
    if (!numberFont) continue;
    const nums = page
      .filter((it) => it.f === numberFont && /^\d{1,3}$/.test(it.s.trim()))
      .map((it) => ({ n: Number(it.s.trim()), x: it.x, y: it.y }));
    if (!nums.length) continue;
    // Cluster into systems by y.
    const systems: Array<{ y: number; nums: typeof nums }> = [];
    for (const n of nums.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const sys = systems.find((s) => Math.abs(s.y - n.y) < 6);
      if (sys) sys.nums.push(n); else systems.push({ y: n.y, nums: [n] });
    }
    for (const sys of systems) {
      sys.nums.sort((a, b) => a.x - b.x);
      const numY = sys.y;
      const inBand = (it: Item, lo: number, hi: number) => it.y - numY > lo && it.y - numY < hi;
      const glyphs = page.filter((it) => it.f === notationFont && inBand(it, 8, 34) &&
        (it.s === GLYPH_SLASH || it.s === GLYPH_NOTE || it.s === GLYPH_DIAMOND || GLYPH_RESTS.has(it.s)));
      const chordItems = page.filter((it) =>
        inBand(it, 35, 56) && it.f !== numberFont && !GLYPH_SET.has(it.s) && it.s.trim() !== "" &&
        /^[A-Ga-gmMsudijao0-9#b()./+\-Δø°]+$/.test(it.s.trim()));
      const sectionItems = page.filter((it) => SECTION_RE.test(it.s.trim()) && inBand(it, 40, 80));

      const rightEdge = Math.max(...glyphs.map((g) => g.x), ...chordItems.map((c) => c.x), sys.nums[sys.nums.length - 1]!.x) + 18;

      // Optional pickup region before the first numbered measure (first system of the piece only).
      const spans: Array<{ number: number; x0: number; x1: number }> = [];
      const firstX = sys.nums[0]!.x;
      if (measures.length === 0) {
        const pre = glyphs.filter((g) => g.x < firstX - 6);
        const preContent = pre.filter((g) => g.s === GLYPH_DIAMOND || g.s === GLYPH_NOTE || g.s === GLYPH_SLASH);
        if (preContent.length) {
          const x0 = Math.min(...preContent.map((g) => g.x)) - 6;
          spans.push({ number: 0, x0, x1: firstX });
        }
      }
      for (let i = 0; i < sys.nums.length; i++) {
        spans.push({ number: sys.nums[i]!.n, x0: sys.nums[i]!.x, x1: i + 1 < sys.nums.length ? sys.nums[i + 1]!.x : rightEdge });
      }

      // Cluster chord items into symbols: x-clusters, then split stacked levels.
      // Gap ≤ 12 keeps split suffixes together (F | # | m | 7); a fresh root
      // letter A-G after ≥7px starts a NEW chord even inside that window, so
      // adjacent chords ("F#m D") don't fuse.
      chordItems.sort((a, b) => a.x - b.x);
      const clusters: Item[][] = [];
      for (const it of chordItems) {
        const cur = clusters[clusters.length - 1];
        const gap = cur ? it.x - Math.max(...cur.map((c) => c.x)) : Infinity;
        const startsRoot = /^[A-G]/.test(it.s.trim());
        const curHasRoot = cur ? /^[A-G]/.test(cur.map((c) => c.s).join("").trim()) : false;
        const sameStack = cur ? cur.some((c) => Math.abs(c.x - it.x) < 6 && Math.abs(c.y - it.y) >= 7) : false;
        if (cur && gap < 12 && !(startsRoot && curHasRoot && gap >= 7 && !sameStack)) cur.push(it);
        else clusters.push([it]);
      }
      type ChordTok = { x: number; symbol: string };
      const chordToks: ChordTok[] = [];
      for (const cl of clusters) {
        // Two levels with a note-letter start each → stacked slash chord.
        const ys = cl.map((c) => c.y - numY);
        const hiLevel = cl.filter((c, i) => ys[i]! >= 45.5);
        const loLevel = cl.filter((c, i) => ys[i]! < 45.5);
        const text = (arr: Item[]) => arr.sort((a, b) => a.x - b.x || b.y - a.y).map((c) => c.s).join("");
        const isChordStart = (t: string) => /^[A-G]/.test(t);
        const hiT = text(hiLevel), loT = text(loLevel);
        let symbol: string;
        if (hiLevel.length && loLevel.length && isChordStart(hiT) && isChordStart(loT)) {
          symbol = `${hiT}/${loT}`; // stacked: top over bottom
        } else {
          symbol = text(cl);
        }
        symbol = symbol.replace(/\s+/g, "");
        if (/^[A-G]/.test(symbol)) chordToks.push({ x: Math.min(...cl.map((c) => c.x)), symbol });
      }

      for (let si = 0; si < spans.length; si++) {
        const span = spans[si]!;
        const width = Math.max(1, span.x1 - span.x0);
        const g = glyphs.filter((it) => it.x >= span.x0 && it.x < span.x1).sort((a, b) => a.x - b.x);
        const slashes = g.filter((it) => it.s === GLYPH_SLASH);
        const notes = g.filter((it) => it.s === GLYPH_NOTE);

        // Beat mapping. Best anchor: the comping slashes ARE the beats (a full
        // comping bar has one slash per beat). With ≥2 slashes fit a linear map
        // (slash i → beat i); otherwise fall back to a padded proportional map.
        let beatOfRaw: (x: number) => number;
        if (slashes.length >= 2) {
          const x1s = slashes[0]!.x;
          const step = (slashes[slashes.length - 1]!.x - x1s) / (slashes.length - 1);
          beatOfRaw = (x) => (x - x1s) / Math.max(1, step);
        } else {
          const pad = width * 0.10;
          beatOfRaw = (x) => ((x - (span.x0 + pad)) / Math.max(1, width - pad)) * beats;
        }
        const beatOf = (x: number) => snapHalf(beatOfRaw(x), beats);

        let kicks: number[] | null = null;
        const kickAnchors: Array<{ x: number; b: number }> = [];
        if (notes.length) {
          kicks = [];
          for (const n of notes) {
            const b = beatOf(n.x);
            kickAnchors.push({ x: n.x, b });
            if (!kicks.includes(b)) kicks.push(b);
          }
          kicks.sort((a, b) => a - b);
        }
        // Slash anchors too — a chord is engraved directly above its time event.
        const timeAnchors = [
          ...kickAnchors,
          ...slashes.map((sl, i) => ({ x: sl.x, b: slashes.length >= 2 ? i : beatOf(sl.x) })),
        ];

        // Chords: engraved above their time event — snap to the nearest anchor
        // by x-distance (≤ 22px); fall back to the proportional map.
        const chords = chordToks
          .filter((c) => c.x >= span.x0 - 8 && c.x < span.x1 - 6)
          .map((c) => {
            let t: number | null = null;
            let bestDx = 22;
            for (const a of timeAnchors) {
              const dx = Math.abs(a.x - c.x);
              if (dx < bestDx) { bestDx = dx; t = a.b; }
            }
            if (t === null) t = beatOf(c.x);
            return { t, symbol: normalizeChartSymbol(c.symbol) };
          })
          .sort((a, b) => a.t - b.t);
        if (chords.length && chords[0]!.t <= 0.5) chords[0]!.t = 0; // first chord sits on the downbeat
        // Same beat twice: identical symbol → drop the duplicate; different
        // symbol → nudge the later one half a beat instead of losing it.
        const chordsClean: typeof chords = [];
        for (const c of chords) {
          const clash = chordsClean.find((p) => p.t === c.t);
          if (!clash) { chordsClean.push(c); continue; }
          if (clash.symbol === c.symbol) continue;
          c.t = Math.min(beats - 0.5, c.t + 0.5);
          chordsClean.push(c);
        }
        chordsClean.sort((a, b) => a.t - b.t);
        const section = sectionItems.find((s) => s.x >= span.x0 - 10 && s.x < span.x1)?.s.trim();
        measures.push({ number: span.number, chords: chordsClean, kicks, ...(section ? { section } : {}) });
      }
    }
  }

  measures.sort((a, b) => a.number - b.number);
  const allSymbols = measures.flatMap((m) => m.chords.map((c) => c.symbol));
  const keyFifths = estimateKeyFifths(allSymbols);
  if (!allSymbols.length) warnings.push("[rhythm-chart] No chords found — is this a rhythm chart PDF?");

  const titleIt = allItems.filter((it) => it.s.trim().length > 3 && it.y > 700).sort((a, b) => b.y - a.y);
  const title = titleIt.find((it) => !/PRISM|TOMMY|WORDS|MUSIC|Arranged|Orchestrated|Rhythm/i.test(it.s))?.s.trim();

  return { title, tempoBpm, beats, beatType, keyFifths, measures, warnings };
}
