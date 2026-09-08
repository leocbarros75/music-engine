import fs from 'node:fs';
import { checkHarmonyResponse } from './httpSmoke.mjs';
const file = process.argv[2];
const granularity = process.argv[3] ?? 'beat';
const url = process.argv[4] ?? 'http://localhost:3001/analyze_harmony';
if (!file || !['beat', 'measure'].includes(granularity)) {
  console.error('Usage: node tests/harmony/runHarmonyTest.mjs <xml> [beat|measure] [url]');
  process.exit(1);
}
const response = await fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ musicxml: fs.readFileSync(file, 'utf8'), options: { granularity, ignorePercussion: true } }),
  signal: AbortSignal.timeout(30000)
});
console.log(JSON.stringify(await checkHarmonyResponse(response, granularity), null, 2));
