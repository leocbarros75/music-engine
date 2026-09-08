/** Optional live-server smoke check; deterministic harmony assertions run via npm test. */
export async function checkHarmonyResponse(response, granularity) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Harmony HTTP ${response.status}: ${text.slice(0, 500)}`);
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('Harmony response is not valid JSON'); }
  if (result?.ok !== true) throw new Error('Harmony response did not report ok:true');
  const records = granularity === 'measure' ? result.measures : result.beats;
  if (!Array.isArray(records) || records.length === 0) throw new Error('Harmony response has no analysis records');
  return result;
}
