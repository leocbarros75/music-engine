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

export default function ScoreViewer({ musicxml }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!musicxml || !containerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function render() {
      if (!containerRef.current) return;

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
        osmdRef.current.render();
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
