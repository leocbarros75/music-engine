import { useEffect, useRef, useState } from 'react';

export type PhrasePlan = { version: 1; sourceFingerprint: string; phrases: Array<{ id: string; startBar: number; endBar: number; dynamic: string; activeParts: string[]; reason: string }> };
const labels: Record<string, string> = { violin2: 'Violin II', viola: 'Viola', cello: 'Cello', bass: 'Double Bass' };
export default function PhraseCollaboration({ musicxml, settings, partIds, disabled, onPlanChange }: {
  musicxml: string; settings: any; partIds: string[]; disabled: boolean; onPlanChange: (plan: PhrasePlan | null) => void;
}) {
  const [data, setData] = useState<{ context: any; plan: PhrasePlan; aiUsed?: boolean } | null>(null);
  const [brief, setBrief] = useState('Begin gently, build toward the final phrase, and keep the melody clear.');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [approved, setApproved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sourceKey = JSON.stringify([musicxml, settings, partIds]);
  useEffect(() => { controller.current?.abort(); setData(null); setBusy(false); setApproved(false); onPlanChange(null); return () => controller.current?.abort(); }, [sourceKey]);
  async function request(ai: boolean, imported?: unknown) {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setApproved(false); onPlanChange(null);
    try {
      const res = await fetch(ai ? '/propose_phrase_plan' : '/phrase_context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: current.signal,
        body: JSON.stringify({ musicxml, settings, partIds, brief, phrasePlan: imported }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw Error(json.error ?? 'Phrase planning failed.');
      if (!current.signal.aborted) setData(json);
    } catch (e: any) { if (!current.signal.aborted) setError(e.message ?? 'Phrase planning failed.'); }
    finally { if (!current.signal.aborted) setBusy(false); }
  }
  function edit(index: number, changes: Partial<PhrasePlan['phrases'][number]>) {
    if (!data) return;
    setData({ ...data, plan: { ...data.plan, phrases: data.plan.phrases.map((p, i) => i === index ? { ...p, ...changes } : p) } });
    setApproved(false); onPlanChange(null);
  }
  function download() {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ instructions: 'Return only the plan object. Keep fingerprint, phrase order and boundaries. Edit only dynamic (pp/p/mp/mf), activeParts (violin2/viola/cello/bass; cello required) and reason. Engine owns notes; source melody is protected.', context: data.context, plan: data.plan }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'phrase-collaboration.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel" aria-label="Phrase collaboration">
    <h3>Shape the arrangement by phrase</h3>
    <p>For string ensemble. Review accompaniment entrances and dynamics while the engine protects the melody. Phrase boundaries are working suggestions based on rests, repeats, fermatas and four-bar groups.</p>
    <button type="button" disabled={disabled || busy || !musicxml} onClick={() => request(false)}>Inspect phrases</button>
    <label>Musical direction<textarea rows={2} maxLength={3000} value={brief} onChange={e => setBrief(e.target.value)} disabled={busy || disabled}/></label>
    <p>“Ask Claude” sends the phrase summary, including melody, lyrics and chords, and your direction to the configured AI provider. Inspecting and editing a plan do not call AI.</p>
    <button type="button" disabled={disabled || busy || !data || !brief.trim()} onClick={() => request(true)}>{busy ? 'Working…' : 'Ask Claude for a proposal'}</button>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>{data.aiUsed ? 'AI proposal — review before using.' : 'Editable plan — no AI was called.'} The melody and cello remain active throughout.</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Written bars</th><th>Dynamic</th><th>Accompaniment</th><th>Musical reason</th></tr></thead><tbody>
        {data.plan.phrases.map((p, i) => <tr key={p.id}><td>{p.startBar}–{p.endBar}<small style={{ display: 'block' }}>{data.context.phrases[i]?.evidence}</small></td>
          <td><select aria-label={`Dynamic for bars ${p.startBar}–${p.endBar}`} value={p.dynamic} disabled={busy || disabled} onChange={e => edit(i, { dynamic: e.target.value })}>{['pp','p','mp','mf'].map(d => <option key={d}>{d}</option>)}</select></td>
          <td>{Object.entries(labels).map(([id,label]) => <label key={id} style={{ display: 'block' }}><input type="checkbox" checked={p.activeParts.includes(id)} disabled={id === 'cello' || busy || disabled} onChange={e => edit(i, { activeParts: e.target.checked ? [...p.activeParts, id] : p.activeParts.filter(v => v !== id) })}/>{label}</label>)}</td>
          <td><textarea aria-label={`Reason for bars ${p.startBar}–${p.endBar}`} maxLength={500} rows={2} value={p.reason} disabled={busy || disabled} onChange={e => edit(i, { reason: e.target.value })}/></td></tr>)}
      </tbody></table></div>
      <button type="button" disabled={busy || disabled} onClick={download}>Export brief and plan</button>
      <label>Import a collaborator’s plan<input type="file" accept=".json,application/json" disabled={busy || disabled} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        try { if (file.size > 240000) throw Error('Plan file must be under 240 KB.'); const value = JSON.parse(await file.text()); await request(false, value.plan ?? value); }
        catch (err: any) { setError(err.message); }
      }}/></label>
      <label><input type="checkbox" checked={approved} disabled={busy || disabled} onChange={e => { setApproved(e.target.checked); onPlanChange(e.target.checked ? data.plan : null); }}/>Use this reviewed plan for the next arrangement</label>
    </>}
  </section>;
}
