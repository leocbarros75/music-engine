/**
 * PartLevelsTable.tsx
 *
 * Per-part player level. The real case is one weak player, not a weak section:
 * a first trumpet who reads anything and a second who does not, on the same
 * stand. The score-wide "Simplified parts" setting is the default, and this
 * overrides it for the parts you name.
 *
 * It works in BOTH directions, which is the point of having it:
 *   - Simplified parts Off, one part set to Beginner → only that part gets an
 *     easier alternate.
 *   - Simplified parts on, one part set to Professional → that player keeps the
 *     written part while everyone else gets an alternate.
 *
 * The list comes from the LAST ARRANGEMENT rather than from the uploaded file,
 * because these are the engine's own part names — "Trumpet 1", "Horn 2" — and
 * they do not exist until it has written them. So the flow is: generate, see
 * who is in the band, mark the player who needs help, generate again.
 */

import type { Settings } from "../types";

type PartLevel = NonNullable<Settings["partLevels"]>[number]["level"];

type Props = {
  /** Parts of the last arrangement, as the engine named them. */
  parts: Array<{ name: string; instrument: string }>;
  partLevels: NonNullable<Settings["partLevels"]>;
  onChange: (next: NonNullable<Settings["partLevels"]>) => void;
};

const OPTIONS: Array<{ value: "" | PartLevel; label: string }> = [
  { value: "", label: "Default" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "professional", label: "Professional — leave as written" },
];

/**
 * Parts this pass cannot act on, so the control is not offered for them.
 *
 * Mirrors EXCLUDED in src/arrange/difficulty/levels.ts: the piano routes
 * already branch on their own level setting, and a drum kit has no register to
 * move. Offering a dropdown that silently does nothing is worse than offering
 * none, which is the only reason this list is repeated here.
 */
const NOT_SIMPLIFIABLE = /piano|drum|percussion/i;

export default function PartLevelsTable({ parts, partLevels, onChange }: Props) {
  // An alternate cannot itself be simplified, and nobody means to try.
  const rows = (parts ?? []).filter(
    (p) => !/\(simplified\)\s*$/i.test(p.name) && !NOT_SIMPLIFIABLE.test(`${p.name} ${p.instrument}`)
  );
  if (!rows.length) return null;

  const levelOf = (name: string) => partLevels.find((r) => r.part === name)?.level ?? "";

  function set(name: string, value: string) {
    const rest = partLevels.filter((r) => r.part !== name);
    onChange(value ? [...rest, { part: name, level: value as PartLevel }] : rest);
  }

  const marked = partLevels.filter((r) => rows.some((p) => p.name === r.part));

  return (
    <div className="part-levels">
      <div className="part-levels-head">
        <span className="result-parts-label">Player level, per part</span>
        {marked.length > 0 && (
          <button type="button" className="link-button" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
      <p className="help">
        Overrides “Simplified parts” for the players you name — set one to
        Beginner to give just that player an easier copy, or to Professional to
        keep them on the written part. Generate again to apply.
      </p>
      <div className="part-levels-rows">
        {rows.map((p) => (
          <label key={p.name} className="part-levels-row">
            <span className="part-levels-name">{p.name}</span>
            <select value={levelOf(p.name)} onChange={(e) => set(p.name, e.target.value)}>
              {OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
