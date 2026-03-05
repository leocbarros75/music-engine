import { useState } from "react";
import type { JobDebug } from "../types";

type Props = {
  debug?: JobDebug;
};

export default function DebugPanel({ debug }: Props) {
  const [hoveredMeasure, setHoveredMeasure] = useState<number | null>(null);

  if (!debug) {
    return (
      <div className="debug-card">
        <h3>Debug</h3>
        <div className="muted">No debug data yet.</div>
      </div>
    );
  }

  const melodyName = debug.melodyPartName || "(unknown)";
  const melodyId = debug.melodyPartId ? ` (${debug.melodyPartId})` : "";
  const melodyVoice = debug.melodyVoice !== null && debug.melodyVoice !== undefined ? debug.melodyVoice : "n/a";
  const melodyNotes = debug.melodyNoteCount ?? "n/a";
  const detectedKeyMode = debug.detectedInputKeyMode ?? "n/a";

  const chordCount = debug.chordEventCount ?? 0;
  const chordSample = debug.chordEventSample ?? [];
  const chordSampleText = chordSample
    .slice(0, 20)
    .map((c) => `m${c.measure} t=${c.t}: ${c.symbol}`)
    .join("\n");

  const chordWarnings = debug.chordWarnings ?? [];
  const chordWarningText = chordWarnings.join("\n");

  const mismatches = debug.chordCheck?.mismatches ?? [];
  const mismatchText = mismatches
    .map((m) => `m${m.measure} chord=${m.chord} out=[${m.outputPcs.join(", ")}] expected=[${m.chordPcs.join(", ")}]`)
    .join("\n");

  const ruleViolations = debug.ruleViolations ?? [];
  const rulesVersion = debug.rulesVersion ?? "n/a";
  const ruleViolationText = ruleViolations
    .slice(0, 50)
    .map((v) => {
      const loc = v.measure != null ? `m${v.measure}` : "m?";
      const t = v.t != null ? ` t=${v.t}` : "";
      const voices = v.voices?.length ? ` [${v.voices.join(", ")}]` : "";
      return `${loc}${t} ${v.ruleId}: ${v.message}${voices}`;
    })
    .join("\n");

  const ruleWarnings = debug.ruleWarnings ?? [];
  const ruleWarningText = ruleWarnings.join("\n");

  const textureType = debug.textureAnalysis?.type ?? "n/a";
  const textureDensity = debug.textureAnalysis?.density?.densityLevel ?? "n/a";
  const textureScore =
    debug.textureAnalysis?.density?.densityScore != null ? debug.textureAnalysis.density.densityScore : "n/a";
  const spacingQuality = debug.textureAnalysis?.spacingQuality ?? "n/a";
  const motionSummary = debug.textureAnalysis?.motionSummary ?? null;
  const motionText = motionSummary
    ? `parallel=${motionSummary.parallel ?? 0}, similar=${motionSummary.similar ?? 0}, contrary=${
        motionSummary.contrary ?? 0
      }, oblique=${motionSummary.oblique ?? 0}, parallelPerfect=${motionSummary.parallelPerfect ?? 0}`
    : "n/a";

  const rhythmDensity = debug.rhythmDensity?.voices ?? null;
  const densityVoiceOrder = ["soprano", "alto", "tenor", "bass"];
  const densityVoiceKeys = rhythmDensity
    ? [
        ...densityVoiceOrder.filter((k) => k in rhythmDensity),
        ...Object.keys(rhythmDensity).filter((k) => !densityVoiceOrder.includes(k))
      ]
    : [];

  const measureCounts = new Map<number, number>();
  const violationsByMeasure = new Map<number, typeof ruleViolations>();
  for (const v of ruleViolations) {
    if (v.measure == null) continue;
    measureCounts.set(v.measure, (measureCounts.get(v.measure) ?? 0) + 1);
    const list = violationsByMeasure.get(v.measure) ?? [];
    list.push(v);
    violationsByMeasure.set(v.measure, list);
  }
  const measures = Array.from(measureCounts.keys()).sort((a, b) => a - b);
  const maxCount = Math.max(1, ...Array.from(measureCounts.values()));
  const hoveredViolations = hoveredMeasure != null ? violationsByMeasure.get(hoveredMeasure) ?? [] : [];

  return (
    <div className="debug-card">
      <h3>Debug</h3>
      <div className="debug-grid">
        <div>
          <div className="summary-label">Melody Part</div>
          <div>
            {melodyName}
            {melodyId}
          </div>
        </div>
        <div>
          <div className="summary-label">Melody Voice</div>
          <div>{melodyVoice}</div>
        </div>
        <div>
          <div className="summary-label">Melody Notes</div>
          <div>{melodyNotes}</div>
        </div>
        <div>
          <div className="summary-label">Input Key Mode</div>
          <div>{detectedKeyMode}</div>
        </div>
        <div>
          <div className="summary-label">Chord Events</div>
          <div>{chordCount}</div>
        </div>
        <div>
          <div className="summary-label">Rule Violations</div>
          <div>{ruleViolations.length}</div>
        </div>
        <div>
          <div className="summary-label">Rules Version</div>
          <div>{rulesVersion}</div>
        </div>
        <div>
          <div className="summary-label">Texture Type</div>
          <div>{textureType}</div>
        </div>
        <div>
          <div className="summary-label">Texture Density</div>
          <div>
            {textureDensity} ({textureScore})
          </div>
        </div>
        <div>
          <div className="summary-label">Spacing Quality</div>
          <div>{spacingQuality}</div>
        </div>
      </div>

      <div className="debug-section">
        <div className="summary-label">Chord Sample (first 20)</div>
        <pre className="debug-pre">{chordSampleText || "(none)"}</pre>
      </div>

      <div className="debug-section">
        <div className="summary-label">Chord Warnings</div>
        <pre className="debug-pre">{chordWarningText || "(none)"}</pre>
      </div>

      <div className="debug-section">
        <div className="summary-label">Chord Check Mismatches</div>
        <pre className="debug-pre">{mismatchText || "(none)"}</pre>
      </div>

      <div className="debug-section">
        <div className="summary-label">Violation Timeline</div>
        {measures.length === 0 ? (
          <div className="muted">No violations yet.</div>
        ) : (
          <div className="violation-timeline">
            {measures.map((m) => {
              const count = measureCounts.get(m) ?? 0;
              const height = 18 + Math.round((count / maxCount) * 60);
              return (
                <div
                  key={`m-${m}`}
                  className="violation-bar"
                  style={{ height: `${height}px` }}
                  title={`m${m}: ${count} violation${count === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHoveredMeasure(m)}
                  onMouseLeave={() => setHoveredMeasure(null)}
                >
                  <span>{m}</span>
                </div>
              );
            })}
          </div>
        )}
        {hoveredMeasure != null && (
          <div className="violation-detail">
            <div className="summary-label">m{hoveredMeasure} violations</div>
            {hoveredViolations.length === 0 ? (
              <div className="muted">No details for this measure.</div>
            ) : (
              <div className="violation-detail-list">
                {hoveredViolations.map((v, idx) => (
                  <div key={`${v.ruleId}-${idx}`} className={`violation-detail-item ${v.severity}`}>
                    <span className="violation-detail-rule">{v.ruleId}</span>
                    <span className="violation-detail-msg">{v.message}</span>
                    {v.voices?.length ? (
                      <span className="violation-detail-voices">[{v.voices.join(", ")}]</span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="debug-section">
        <div className="summary-label">Rule Warnings</div>
        <pre className="debug-pre">{ruleWarningText || "(none)"}</pre>
      </div>

      <div className="debug-section">
        <div className="summary-label">Motion Summary (Top vs Bottom)</div>
        <pre className="debug-pre">{motionText || "(none)"}</pre>
      </div>

      <div className="debug-section">
        <div className="summary-label">Rhythm Density (Notes / Measure)</div>
        {!rhythmDensity || densityVoiceKeys.length === 0 ? (
          <div className="muted">No rhythm density data yet.</div>
        ) : (
          <div className="density-grid">
            {densityVoiceKeys.map((voiceKey) => {
              const voice = rhythmDensity[voiceKey];
              const measures = voice?.measures ?? [];
              const maxNotes = Math.max(1, ...measures.map((m) => m.notes));
              const avg = voice?.avgNotesPerMeasure ?? 0;
              return (
                <div key={`density-${voiceKey}`} className="density-block">
                  <div className="density-header">
                    <span className="density-label">{voiceKey}</span>
                    <span className="density-meta">avg {avg.toFixed(2)}</span>
                  </div>
                  <div className="density-chart">
                    {measures.map((m, idx) => {
                      const height = 12 + Math.round((m.notes / maxNotes) * 44);
                      return (
                        <div
                          key={`${voiceKey}-${m.measure}-${idx}`}
                          className="density-bar"
                          style={{ height: `${height}px` }}
                          title={`m${m.measure}: ${m.notes} notes`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="debug-section">
        <div className="summary-label">Rule Violations (first 50)</div>
        <pre className="debug-pre">{ruleViolationText || "(none)"}</pre>
      </div>
    </div>
  );
}
