import type { JobDebug } from "../types";

type Props = {
  debug?: JobDebug;
};

export default function ViolationsPanel({ debug }: Props) {
  if (!debug) {
    return (
      <div className="violations-panel">
        <div className="muted">No rule data yet.</div>
      </div>
    );
  }

  const violations = debug.ruleViolations ?? [];
  const warnCount = violations.filter((v) => v.severity === "warn").length;
  const errorCount = violations.filter((v) => v.severity === "error").length;

  if (violations.length === 0) {
    return (
      <div className="violations-panel">
        <div className="muted">No rule violations detected.</div>
      </div>
    );
  }

  return (
    <div className="violations-panel">
      <div className="violations-summary">
        <div>
          <span className="pill warn">Warnings</span> {warnCount}
        </div>
        <div>
          <span className="pill error">Errors</span> {errorCount}
        </div>
      </div>
      <div className="violation-list">
        {violations.slice(0, 80).map((v, idx) => {
          const loc = v.measure != null ? `m${v.measure}` : "m?";
          const t = v.t != null ? ` t=${v.t}` : "";
          const voices = v.voices?.length ? ` [${v.voices.join(", ")}]` : "";
          return (
            <div key={`${v.ruleId}-${idx}`} className={`violation-item ${v.severity}`}>
              <span className="violation-loc">
                {loc}
                {t}
              </span>
              <span className="violation-rule">{v.ruleId}</span>
              <span className="violation-msg">{v.message}</span>
              <span className="violation-voices">{voices}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
