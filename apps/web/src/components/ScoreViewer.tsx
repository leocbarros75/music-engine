import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

type Props = {
  musicxml: string | null;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Rendering the whole score inline can crash the browser tab: OpenSheetMusicDisplay
 * builds one giant SVG, and a 14-part × 99-measure orchestra score exhausts memory
 * (the "screen goes black after 40s"). So for large scores we render only the first
 * few measures as a preview — the full arrangement is always available via the
 * MusicXML / MIDI download buttons above this panel.
 */
const PREVIEW_STAFF_BUDGET = 160; // ~ parts × measures the browser renders comfortably

function measureScore(xml: string): { parts: number; measures: number } {
  const parts = (xml.match(/<score-part\b/g) ?? []).length || 1;
  const measureTags = (xml.match(/<measure\b/g) ?? []).length;
  const measures = Math.max(1, Math.round(measureTags / parts));
  return { parts, measures };
}

export default function ScoreViewer({ musicxml }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<{ shown: number; total: number; parts: number } | null>(null);

  useEffect(() => {
    if (!musicxml || !containerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTruncated(null);

    async function render() {
      if (!containerRef.current) return;

      const { parts, measures } = measureScore(musicxml!);
      const budgetMeasures = Math.max(6, Math.floor(PREVIEW_STAFF_BUDGET / parts));
      const isLarge = parts * measures > PREVIEW_STAFF_BUDGET;
      const drawUpTo = isLarge ? Math.min(measures, budgetMeasures) : measures;

      if (!osmdRef.current) {
        osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: true,
          drawTitle: true,
          drawSubtitle: false,
          drawComposer: false,
          drawCredits: false,
          backend: "svg",
          followCursor: false,
        });
      }

      try {
        await osmdRef.current.load(musicxml!);
        if (cancelled) return;
        // Always set explicitly — the instance is reused across renders.
        osmdRef.current.setOptions({ drawUpToMeasureNumber: drawUpTo });
        osmdRef.current.render();
        if (!cancelled && isLarge) setTruncated({ shown: drawUpTo, total: measures, parts });
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to render score.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [musicxml]);

  function exportSvg() {
    if (!containerRef.current) return;
    const svgEls = containerRef.current.querySelectorAll("svg");
    if (!svgEls.length) return;

    // Collect all SVG pages into one document
    const parts: string[] = [];
    svgEls.forEach((svg) => {
      // Clone so we can add xmlns
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      parts.push(clone.outerHTML);
    });

    const combined = `<?xml version="1.0" encoding="UTF-8"?>\n` + parts.join("\n");
    const blob = new Blob([combined], { type: "image/svg+xml" });
    downloadBlob(blob, "score.svg");
  }

  function exportPdf() {
    if (!containerRef.current) return;
    // Use browser print — print stylesheet hides everything except .score-print-area
    const svgEls = containerRef.current.querySelectorAll("svg");
    if (!svgEls.length) return;

    // Collect all SVGs
    const svgHtml = Array.from(svgEls).map((svg) => {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.style.maxWidth = "100%";
      clone.style.display = "block";
      clone.style.marginBottom = "8px";
      return clone.outerHTML;
    }).join("");

    const printWin = window.open("", "_blank");
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html><html><head>
      <title>Score</title>
      <style>
        body { margin: 0; padding: 16px; background: #fff; }
        svg { max-width: 100%; display: block; margin-bottom: 8px; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>${svgHtml}</body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 300);
  }

  if (!musicxml) return null;

  return (
    <div className="score-viewer">
      {loading && <div className="score-loading">Rendering score...</div>}
      {error && <div className="score-error">{error}</div>}
      {truncated && (
        <div className="score-truncated" style={{
          margin: "8px 0", padding: "10px 12px", borderRadius: 8,
          background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)",
          fontSize: "0.9rem", lineHeight: 1.4,
        }}>
          <b>Large arrangement</b> ({truncated.parts} parts × {truncated.total} measures).
          Previewing the first {truncated.shown} measures to keep your browser responsive —
          use the <b>↓ MusicXML</b> or <b>↓ MIDI</b> buttons above for the complete score.
        </div>
      )}
      {!loading && !error && (
        <div className="score-export-row">
          <button className="ghost" onClick={exportSvg} title="Download score as SVG vector image">
            ↓ SVG
          </button>
          <button className="ghost" onClick={exportPdf} title="Open print dialog to save as PDF">
            ↓ PDF
          </button>
        </div>
      )}
      <div ref={containerRef} className="score-canvas" />
    </div>
  );
}
