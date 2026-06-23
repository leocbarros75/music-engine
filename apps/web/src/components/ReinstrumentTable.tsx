/**
 * ReinstrumentTable.tsx
 *
 * Remap table for the "reinstrument" ensemble mode. Lists every part in the
 * uploaded score and lets the user assign each one a new instrument (or leave it
 * unchanged). The sounding pitch is preserved; the engine octave-fits any notes
 * outside the new instrument's range and writes correct transposed notation.
 */

import { useEffect, useState } from "react";

type PartInfo = {
  id: string;
  name: string;
  instrument: string;
  staves: number;
  measures: number;
  noteCount: number;
};

type Mapping = { part: string; to: string };

type Props = {
  musicxml: string | null;
  mappings: Mapping[];
  onChange: (mappings: Mapping[]) => void;
};

// Target instruments, grouped (mirrors REINSTRUMENT_TARGETS on the server).
const TARGETS: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  { group: "Strings", items: [
    { id: "violin_1", label: "Violin" },
    { id: "viola", label: "Viola" },
    { id: "cello", label: "Cello" },
    { id: "double_bass", label: "Double Bass" },
  ] },
  { group: "Woodwinds", items: [
    { id: "flute", label: "Flute" },
    { id: "oboe", label: "Oboe" },
    { id: "clarinet_bb", label: "Clarinet (Bb)" },
    { id: "bassoon", label: "Bassoon" },
  ] },
  { group: "Saxophones", items: [
    { id: "soprano_sax_bb", label: "Soprano Sax (Bb)" },
    { id: "alto_sax_eb", label: "Alto Sax (Eb)" },
    { id: "tenor_sax_bb", label: "Tenor Sax (Bb)" },
    { id: "baritone_sax_eb", label: "Baritone Sax (Eb)" },
  ] },
  { group: "Brass", items: [
    { id: "trumpet_bb_1", label: "Trumpet (Bb)" },
    { id: "horn_f", label: "Horn (F)" },
    { id: "trombone", label: "Trombone" },
    { id: "tuba_c", label: "Tuba" },
  ] },
];

export default function ReinstrumentTable({ musicxml, mappings, onChange }: Props) {
  const [parts, setParts] = useState<PartInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!musicxml) { setParts(null); return; }
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
        setParts(data.parts as PartInfo[]);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Network error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [musicxml]);

  // The current target for a part (matched by id, then name) — "" = unchanged.
  function targetFor(p: PartInfo): string {
    const m = mappings.find((x) => x.part === p.id) ?? mappings.find((x) => x.part === p.name);
    return m?.to ?? "";
  }

  function setTarget(p: PartInfo, to: string): void {
    // Always key the mapping by part id for a stable match.
    const next = mappings.filter((x) => x.part !== p.id && x.part !== p.name);
    if (to) next.push({ part: p.id, to });
    onChange(next);
  }

  if (!musicxml) {
    return <div className="pill warn">Upload a score above to choose which parts to re-instrument.</div>;
  }
  if (loading) return <div className="muted">Reading parts…</div>;
  if (error) return <div className="pill warn">{error}</div>;
  if (!parts || !parts.length) return <div className="pill warn">No parts found in this score.</div>;

  const changed = mappings.length;

  return (
    <div className="reinstrument-table">
      <div className="field">
        <label>Re-instrument parts</label>
        <div className="key-preview">
          <span className="slider-help">
            Assign any part to a new instrument. The music sounds the same — notes outside the
            new instrument's range jump by an octave, and transposed notation is written
            automatically. Leave a part on “— unchanged —” to keep it.
          </span>
        </div>
      </div>
      {parts.map((p) => {
        const to = targetFor(p);
        return (
          <div key={p.id} className="field reinstrument-row">
            <label>
              {p.name || p.id}
              <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                ({p.noteCount} notes{p.staves > 1 ? `, ${p.staves} staves` : ""})
              </span>
            </label>
            <select value={to} onChange={(e) => setTarget(p, e.target.value)}>
              <option value="">— unchanged —</option>
              {TARGETS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((it) => (
                    <option key={it.id} value={it.id}>{it.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        );
      })}
      <div className="key-preview">
        <span className="slider-help">
          {changed ? `${changed} part${changed > 1 ? "s" : ""} will be re-instrumented.` : "No changes yet — pick a new instrument for any part."}
        </span>
      </div>
    </div>
  );
}
