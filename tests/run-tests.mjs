import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
// Separate processes prevent server/module state from leaking between suites.
export function runJobs(jobs, { cwd = root, timeout = 120000, log = console.log } = {}) {
  let failed = 0;
  for (const { name, args } of jobs) {
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, HOLY_TEST_PATH: path.join(root, 'tests/preservation/fixtures/holy-holy-holy.musicxml') }
    });
    const ok = !result.error && !result.signal && result.status === 0;
    log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
      failed++;
      log([result.error?.message, result.signal, result.stdout, result.stderr].filter(Boolean).join('\n'));
    }
  }
  log(`\n${jobs.length - failed}/${jobs.length} test jobs passed; ${failed} failed.`);
  return failed ? 1 : 0;
}

async function main() {
  const { EXPECTATIONS_BY_BASENAME } = await import('./harmony/expectations.ts');
  const group = process.argv[2] ?? 'all';
  const mode = process.argv[3];
  if (!['all', 'harmony', 'arrange', 'musicxml'].includes(group) ||
      (mode !== undefined && (group !== 'harmony' || !['beat', 'measure'].includes(mode))) || process.argv.length > 4) {
    console.error('Usage: node --import tsx tests/run-tests.mjs [all|harmony|arrange|musicxml] [beat|measure (harmony only)]');
    process.exit(1);
  }
  const jobs = [];
  const add = (name, file, ...args) => jobs.push({ name, args: ['--import', 'tsx', file, ...args] });
  if (group === 'all') {
    for (const file of [
      'tests/ai/phraseCollaboration.test.ts',
      'tests/application/applicationPaths.test.ts',
      'tests/import/midiFile.test.ts',
      'tests/import/midiTranscribe.test.ts',
      'tests/import/extractLeadSheet.test.ts',
      'tests/score/scoreStandard.test.ts',
      'tests/preservation/sourcePreservation.test.ts',
      'tests/preservation/serverPreservation.test.ts',
      'tests/performance/performance.test.ts',
      'tests/runner/runner.test.ts'
    ]) add(file, file);
  }
  if (group === 'all' || group === 'arrange') {
    for (const file of [
      'src/arrange/strings/__tests__/stringArranger.test.ts',
      'src/arrange/stringsPolyphony/__tests__/stringsPolyphonicArranger.test.ts',
      'tests/arrange/candidates.test.ts',
      'tests/arrange/voiceLedVoicing.test.ts',
      'tests/arrange/stringSustain.test.ts',
      'tests/arrange/stringRegister.test.ts',
      'tests/arrange/innerVoiceMotion.test.ts'
    ]) add(file, file);
  }
  if (group === 'all' || group === 'musicxml') {
    for (const file of ['tests/musicxml/holyHolyHolyChordTest.ts', 'tests/musicxml/choralRulesCheckTest.ts',
      'tests/musicxml/choralRulesUnitTest_doubling_resolution.ts']) add(file, file);
  }
  if (group === 'all' || group === 'harmony') {
    for (const file of Object.keys(EXPECTATIONS_BY_BASENAME).sort()) {
      for (const granularity of mode ? [mode] : ['beat', 'measure']) {
        add(`${file} (${granularity})`, 'tests/harmony/runHarmonyTest.ts', `tests/musicxml/${file}`, granularity);
      }
    }
    add('Roman confidence', 'tests/harmony/runRomanConfidenceTest.ts');
    add('MusicXML exporter', 'tests/harmony/runMusicXMLExportTest.ts');
  }
  process.exitCode = runJobs(jobs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
