import { useEffect, useState } from "react";

export type PartInfo = {
  id: string;
  name: string;
  instrument: string;
  staves: number;
  measures: number;
  noteCount: number;
};

type ScoreInfo = {
  title: string;
  ensemble: string;
  partCount: number;
  parts: PartInfo[];
};

type Props = {
  musicxml: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onExtract: (ids: string[]) => void;
  onTitleDetected?: (title: string) => void;
};

// Instrument family → emoji icon
function iconFor(instrument: string): string {
  const s = instrument.toLowerCase();
  if (s.includes("violin") || s.includes("viola") || s.includes("cello") || s.includes("bass")) return "🎻";
  if (s.includes("flute") || s.includes("piccolo"))   return "🪈";
  if (s.includes("oboe") || s.includes("bassoon") || s.includes("clarinet")) return "🎵";
  if (s.includes("trumpet") || s.includes("horn") || s.includes("trombone") || s.includes("tuba")) return "🎺";
  if (s.includes("piano") || s.includes("keyboard") || s.includes("organ")) return "🎹";
  if (s.includes("harp"))   return "🎸";
  if (s.includes("drum") || s.includes("percussion") || s.includes("timpani")) return "🥁";
  if (s.includes("soprano") || s.includes("alto") || s.includes("tenor") || s.includes("bass voice")) return "🎤";
  return "🎼";
}

export default function PartsSelector({ musicxml, selectedIds, onChange, onExtract, onTitleDetected }: Props) {
  const [scoreInfo, setScoreInfo] = useState<ScoreInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fetch parts whenever a new file is loaded
  useEffect(() => {
    if (!musicxml) { setScoreInfo(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/list_parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicxml }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) { setError(data.error ?? "Failed to list parts."); return; }
        setScoreInfo(data as ScoreInfo);
        // Auto-fill title if the score has one
        if (data.title && onTitleDetected) onTitleDetected(String(data.title));
        // Default: select all parts
        onChange((data.parts as PartInfo[]).map((p) => p.id));
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Network error"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [musicxml]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleAll(checked: boolean) {
    onChange(checked ? (scoreInfo?.parts ?? []).map((p) => p.id) : []);
  }

  function togglePart(id: string, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id));
  }

  if (!musicxml) return null;
  if (loading) return <div className="parts-loading">Detecting instruments…</div>;
  if (error)   return <div className="parts-error">{error}</div>;
  if (!scoreInfo || !scoreInfo.parts.length) return null;

  const allSelected = selectedIds.length === scoreInfo.parts.length;
  const noneSelected = selectedIds.length === 0;
  const isOrchestral = scoreInfo.parts.length > 4;

  return (
    <div className="parts-selector">
      <div className="parts-header">
        <div className="parts-title-row">
          <h3>
            {isOrchestral ? "🎼 Orchestral Score Detected" : "🎵 Parts Detected"}
          </h3>
          <span className="parts-badge">{scoreInfo.partCount} part{scoreInfo.partCount !== 1 ? "s" : ""}</span>
        </div>
        {scoreInfo.title && (
          <div className="parts-score-title">"{scoreInfo.title}"</div>
        )}
        <p className="parts-hint">
          {isOrchestral
            ? "Select which instruments to extract or arrange. Only selected parts will be used."
            : "Choose which parts to include in the arrangement."}
        </p>
      </div>

      <div className="parts-controls">
        <label className="parts-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span>{allSelected ? "Deselect all" : "Select all"}</span>
        </label>
        <span className="parts-selected-count">
          {selectedIds.length} / {scoreInfo.partCount} selected
        </span>
      </div>

      <div className="parts-list">
        {scoreInfo.parts.map((part) => {
          const selected = selectedIds.includes(part.id);
          return (
            <label key={part.id} className={`part-row ${selected ? "selected" : ""}`}>
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => togglePart(part.id, e.target.checked)}
              />
              <span className="part-icon">{iconFor(part.instrument || part.name)}</span>
              <span className="part-name">{part.name || part.instrument || part.id}</span>
              <span className="part-meta">
                {part.measures}m · {part.noteCount} notes
                {part.staves > 1 && <span className="part-staves"> · {part.staves} staves</span>}
              </span>
            </label>
          );
        })}
      </div>

      {/* Extract action — only shown for orchestral / multi-part scores */}
      {isOrchestral && (
        <div className="parts-actions">
          <button
            className="ghost"
            disabled={noneSelected}
            onClick={() => onExtract(selectedIds)}
            title="Download selected parts as a new MusicXML file without re-arranging"
          >
            ⬇ Extract Part{selectedIds.length !== 1 ? "s" : ""}
          </button>
          <span className="parts-action-hint">
            Extract saves a new MusicXML with only the selected instruments.
            Arrange runs the full AI arrangement pipeline on the selection.
          </span>
        </div>
      )}
    </div>
  );
}
