import type { RhythmChart } from '../import/rhythmChartPdf';
import { arrangeWorshipOrchestraFromRhythmChart, buildRhythmChartSkeleton } from '../arrange/orchestra/worshipOrchestraArranger';
import { exportScoreModelToMusicXML } from '../exporters/musicxmlExporter';
import { synchronizePerformance } from '../exporters/synchronizePerformance';
import { normalizeAppSettings } from './normalizeAppSettings';
import { generateArrangement } from './generateArrangement';

/** A parsed chart is an input adapter; every result uses the canonical exports. */
export function arrangeRhythmChart(chart: RhythmChart, rawSettings: unknown) {
  const settings = normalizeAppSettings(rawSettings);
  const ensemble = String(settings.ensemble ?? 'choral').toLowerCase();
  const warnings = [...chart.warnings];
  const chordCount = chart.measures.reduce((sum, bar) => sum + bar.chords.length, 0);
  let result: any;
  if (['orchestra', 'piano_orchestra', 'satb_orchestra'].includes(ensemble)) {
    const arranged = arrangeWorshipOrchestraFromRhythmChart(chart, {
      warnings, intensity: settings.orchestraIntensity ?? 'build', parts: settings.orchestraParts,
      balance: settings.orchestraBalance ?? 'default', partRanges: settings.orchestraPartRanges
    });
    const synced = synchronizePerformance(exportScoreModelToMusicXML(arranged.scoreModel), arranged.scoreModel);
    if (synced.report.reason) warnings.push(`MIDI/playback unavailable: ${synced.report.reason}`);
    warnings.push(...(synced.report.warnings ?? []));
    result = { ok: true, musicxml: synced.musicxml, scoreModel: synced.scoreModel, midiBase64: synced.midiBase64,
      warnings, meta: { performance: synced.report, preservation: { status: 'not_applicable', reason: 'Arrangement generated from a chord/rhythm chart, without a source melody.' } } };
  } else {
    const { score, chords } = buildRhythmChartSkeleton(chart);
    result = generateArrangement({ musicxml: exportScoreModelToMusicXML(score as any), settings, chords,
      options: { keepMelodyInSoprano: true } });
    if (!result.ok) return { ...result, warnings: [...warnings, ...result.warnings] };
    result.warnings = [...warnings, ...result.warnings];
  }
  const preservation = { status: 'not_applicable', reason: 'Arrangement generated from a chord/rhythm chart, without a source melody.' };
  result.scoreModel.meta.sourcePreservation = preservation;
  return { ...result, warnings: [...result.warnings, `[rhythm-chart] ${chart.measures.length} measures, ${chordCount} chords → ${ensemble}.`],
    meta: { ...result.meta, preservation, ensemble, chordSource: 'rhythm_chart_pdf', cadenceMeasures: result.meta.cadenceMeasures ?? [],
      chordEventCount: chordCount,
      parts: result.scoreModel.parts.map((p: any) => ({ name: p.name ?? p.part_id, instrument: p.instrument ?? '' })),
      title: chart.title ?? '', tempoBpm: chart.tempoBpm ?? null, keyFifths: chart.keyFifths,
      measures: chart.measures.length, figureBars: chart.measures.filter(m => m.kicks?.length).length,
      sections: chart.measures.filter(m => m.section).map(m => `${m.section}@m${m.number}`)
    }
  };
}
