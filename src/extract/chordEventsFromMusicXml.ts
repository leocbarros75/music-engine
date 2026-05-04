// src/extract/chordEventsFromMusicXml.ts
// Extracts <harmony> chord symbol events from a raw MusicXML string.
import { DOMParser } from "@xmldom/xmldom";

export type ChordEvent = {
  measure: number;
  t: number;
  symbol: string;
};

export type ExtractChordResult = {
  chords: ChordEvent[];
  warnings: string[];
};

function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return String(el.textContent ?? "").trim();
}

function intOf(el: Element | null | undefined, fallback = 0): number {
  const s = textOf(el);
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function localNameOf(el: Element | null | undefined): string {
  if (!el) return "";
  const raw = String((el as any).localName ?? el.tagName ?? "");
  const parts = raw.split(":");
  return parts[parts.length - 1] ?? raw;
}

function elementsByTagName(root: Document | Element, tag: string): Element[] {
  const result: Element[] = [];
  const nsFn = (root as any).getElementsByTagNameNS;
  const nodeList = typeof nsFn === "function" ? nsFn.call(root, "*", tag) : (root as any).getElementsByTagName(tag);
  if (!nodeList) return result;
  for (let i = 0; i < nodeList.length; i++) {
    const item = nodeList.item(i);
    if (item && item.nodeType === 1) result.push(item as Element);
  }
  return result;
}

function firstChild(el: Element, tag: string): Element | null {
  const xs = elementsByTagName(el, tag);
  return xs.length ? xs[0] : null;
}

function accidentalFromAlter(alter: number, warnings: string[]): string {
  if (alter === 1) return "#";
  if (alter === -1) return "b";
  if (alter === 0) return "";
  if (alter > 1) { warnings.push(`[chord] root alter=${alter} not supported; using "#".`); return "#"; }
  if (alter < -1) { warnings.push(`[chord] root alter=${alter} not supported; using "b".`); return "b"; }
  return "";
}

function chordSuffixFromKind(kind: string, warnings: string[]): string {
  const k = String(kind || "").trim().toLowerCase();
  if (!k || k === "major") return "";
  if (k === "minor") return "m";
  if (k === "dominant" || k === "major-minor") return "7";
  if (k === "major-seventh") return "maj7";
  if (k === "minor-seventh") return "m7";
  if (k === "diminished") return "dim";
  if (k === "diminished-seventh") return "dim7";
  if (k === "half-diminished") return "ø7";
  if (k === "augmented") return "aug";
  if (k === "augmented-seventh") return "aug7";
  if (k === "suspended-fourth") return "sus4";
  if (k === "suspended-second") return "sus2";
  warnings.push(`[chord] Unsupported harmony kind "${kind}". Defaulting to major triad.`);
  return "";
}

function parseHarmonySymbol(harmonyEl: Element, warnings: string[]): { symbol: string } | null {
  const rootEl = firstChild(harmonyEl, "root");
  const rootStep = rootEl ? textOf(firstChild(rootEl, "root-step")) : "";
  if (!rootStep) return null;

  const rootAlterEl = rootEl ? firstChild(rootEl, "root-alter") : null;
  const rootAlter = rootAlterEl ? intOf(rootAlterEl, 0) : 0;
  const rootAcc = accidentalFromAlter(rootAlter, warnings);

  const kindEl = firstChild(harmonyEl, "kind");
  const kindText = kindEl ? textOf(kindEl) : "";
  const suffix = chordSuffixFromKind(kindText, warnings);

  const bassEl = firstChild(harmonyEl, "bass");
  const bassStep = bassEl ? textOf(firstChild(bassEl, "bass-step")) : "";
  const bassAlterEl = bassEl ? firstChild(bassEl, "bass-alter") : null;
  const bassAlter = bassAlterEl ? intOf(bassAlterEl, 0) : 0;
  const bassAcc = bassStep ? accidentalFromAlter(bassAlter, warnings) : "";

  const rootName = `${rootStep.toUpperCase()}${rootAcc}`;
  const bassName = bassStep ? `${bassStep.toUpperCase()}${bassAcc}` : "";

  const symbol = bassName ? `${rootName}${suffix}/${bassName}` : `${rootName}${suffix}`;
  return symbol ? { symbol } : null;
}

function parseMeasureNumber(mEl: Element, fallback: number): number {
  const raw = mEl.getAttribute("number");
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function extractChordEventsFromMusicXml(xml: string): ExtractChordResult {
  const warnings: string[] = [];
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const scorePartwise = elementsByTagName(doc, "score-partwise")[0] ?? null;
    if (!scorePartwise) {
      warnings.push("[chord] Could not find <score-partwise> root.");
      return { chords: [], warnings };
    }

    const chordEvents: ChordEvent[] = [];
    const partEls = elementsByTagName(scorePartwise, "part");

    for (let pi = 0; pi < partEls.length; pi++) {
      const partEl = partEls[pi] as Element;
      const measureEls = elementsByTagName(partEl, "measure");
      let curDivisions = 480;

      for (let mi = 0; mi < measureEls.length; mi++) {
        const mEl = measureEls[mi] as Element;
        const measureNumber = parseMeasureNumber(mEl, mi + 1);

        const attrsEl = firstChild(mEl, "attributes");
        if (attrsEl) {
          const divEl = firstChild(attrsEl, "divisions");
          const d = intOf(divEl, curDivisions);
          if (d > 0) curDivisions = d;
        }

        let t = 0;
        const childNodes = mEl.childNodes;

        for (let ci = 0; ci < childNodes.length; ci++) {
          const node = childNodes.item(ci);
          if (!node || node.nodeType !== 1) continue;
          const el = node as Element;
          const tag = localNameOf(el);

          if (tag === "harmony") {
            const parsed = parseHarmonySymbol(el, warnings);
            if (parsed) {
              const offsetEl = firstChild(el, "offset");
              const offsetDivs = offsetEl ? intOf(offsetEl, 0) : null;
              const rawBeat = offsetDivs !== null ? offsetDivs / curDivisions : t;
              const beat = Number.isFinite(rawBeat) ? rawBeat : 0;
              chordEvents.push({ measure: measureNumber, t: Math.max(0, beat), symbol: parsed.symbol });
            } else {
              warnings.push(`[chord] Could not parse <harmony> element in measure ${measureNumber}.`);
            }
            continue;
          }

          if (tag === "note") {
            const isChordTone = !!firstChild(el, "chord");
            const durEl = firstChild(el, "duration");
            const durDivs = intOf(durEl, curDivisions);
            const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
            if (!isChordTone) t += dur;
            continue;
          }

          if (tag === "backup") {
            const durEl = firstChild(el, "duration");
            const durDivs = intOf(durEl, 0);
            const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
            t -= dur;
            if (t < 0) t = 0;
            continue;
          }

          if (tag === "forward") {
            const durEl = firstChild(el, "duration");
            const durDivs = intOf(durEl, 0);
            const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
            t += dur;
            continue;
          }
        }
      }
    }

    const deduped: ChordEvent[] = [];
    const chordByKey = new Map<string, ChordEvent>();
    for (const c of chordEvents) {
      const key = `${c.measure}:${c.t}`;
      const existing = chordByKey.get(key);
      if (!existing) {
        chordByKey.set(key, c);
        deduped.push(c);
      } else if (existing.symbol !== c.symbol) {
        warnings.push(
          `[chord] Conflicting symbols at measure ${c.measure} t=${c.t}: "${existing.symbol}" vs "${c.symbol}". Using first.`
        );
      }
    }

    return { chords: deduped, warnings };
  } catch (err: any) {
    warnings.push(`[chord] Failed to parse MusicXML harmonies: ${err?.message || String(err)}`);
    return { chords: [], warnings };
  }
}
