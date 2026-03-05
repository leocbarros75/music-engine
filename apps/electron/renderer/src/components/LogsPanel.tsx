import type { LogEntry } from "../types";

type Props = {
  logs: LogEntry[];
  warnings: string[];
};

function formatTime(ts: string) {
  if (!ts) return "";
  const parts = ts.split("T");
  if (parts.length < 2) return ts;
  return parts[1].split(".")[0] || ts;
}

export default function LogsPanel({ logs, warnings }: Props) {
  return (
    <div className="logs-panel">
      <div className="logs-header">
        <div>
          <h3>Warnings</h3>
          <p>Non-fatal issues that were handled automatically.</p>
        </div>
      </div>
      <div className="warning-list">
        {warnings.length === 0 ? (
          <div className="muted">No warnings yet.</div>
        ) : (
          warnings.map((warning, index) => (
            <div key={`${warning}-${index}`} className="warning-item">
              <span className="badge warn">warn</span>
              <span>{warning}</span>
            </div>
          ))
        )}
      </div>

      <div className="logs-header">
        <div>
          <h3>Logs</h3>
          <p>Server and pipeline output.</p>
        </div>
      </div>
      <div className="log-stream">
        {logs.length === 0 ? (
          <div className="muted">No logs yet.</div>
        ) : (
          logs.map((entry, index) => (
            <div key={`${entry.ts}-${index}`} className={`log-line ${entry.level}`}>
              <span className="log-time">{formatTime(entry.ts)}</span>
              <span className="log-level">{entry.level}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
