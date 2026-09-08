import { inspectPhrases, validatePhrasePlan, applyPhrasePlan } from "../ai/phrasePlan";
import { synchronizePerformance } from "../exporters/synchronizePerformance";
import { prepareSourceLock, lockSourceInModel, preserveAndVerifyXml, verifySourceOutput, type PreservationReport } from "../preservation/sourcePreservation";
import { toSoundingScore, transposeChordSymbol } from "../score/pitch";
// src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts
// Full server-side pipeline: MusicXML in → arranged MusicXML out.
import { parseMusicXMLToScoreModel } from "../parsers/musicxmlParser";
import { harmonizeSatbFromChords } from "../harmonize/satb/harmonizeSatbFromChords";
import { inferChordsFromMelody } from "../harmonize/satb/inferChordsFromMelody";
import { applyAppSettings, type AppSettings } from "../app/applyAppSettings";
import { checkChoralRules } from "../rules/choral/checkChoralRules";
import { exportScoreModelToMusicXML, ensureFinalBarlines } from "../exporters/musicxmlExporter";
import { extractChordEventsFromMusicXml, type ChordEvent } from "../extract/chordEventsFromMusicXml";
import { scoreHasPianoPart } from "../arrange/arrangeStringQuartetFromPianoInstrumentation";

export type PipelineRequest = {
  phrasePlan?: unknown;
  musicxml: string;
  settings: AppSettings;
  chords?: ChordEvent[];
  options?: Record<string, unknown>;
};

export type PipelineResult = {
  ok: true;
  musicxml: string;
  midiBase64?: string;
  scoreModel: unknown;
  warnings: string[];
  meta: {
    ensemble: string;
    styleUsed?: string;
    chordSource: string;
    cadenceMeasures: number[];
    chordEventCount: number;
    parts?: Array<{ name: string; instrument: string }>;
    title?: string;
    phraseCollaboration?: { status: string; phraseCount: number; sourceFingerprint: string; plan: unknown };
    preservation?: PreservationReport;
    performance?: { status: string; reason?: string; durationSeconds?: number; warnings?: string[] };
  };
};

export type PipelineError = {
  ok: false;
  error: string;
  warnings: string[];
};

function normalizeHarmonizeReturn(x: any): any {
  if (x && typeof x === "object" && "scoreModel" in x) return (x as any).scoreModel;
  return x;
}

export function pipelineMusicxmlToArrangedMusicxml(
  req: PipelineRequest
): PipelineResult | PipelineError {
  const warnings: string[] = [];
  const { musicxml, settings, options = {} } = req;

  try {
    const phrasePlan = req.phrasePlan === undefined ? undefined : validatePhrasePlan(req.phrasePlan, inspectPhrases(musicxml, settings));
    if (phrasePlan && req.chords?.length) throw Error("Phrase collaboration uses source chords; remove request chord overrides.");
    // 1. Parse input MusicXML
    const writtenInput = parseMusicXMLToScoreModel(musicxml);
    const inputScore = toSoundingScore(writtenInput);
    const protection = prepareSourceLock(musicxml, inputScore, settings);
    let preservation = protection.report;
    // Shift only when explicitly requested; the immutable snapshot remains unchanged.
    if (protection.lock && protection.lock.shift) {
      const selected = inputScore.parts.find(p => p.part_id === protection.lock!.partId)!;
      selected.measures = JSON.parse(JSON.stringify(protection.lock.expected.measures));
    }
    const sourceTranspose = (protection.lock ? writtenInput.parts.find(p=>p.part_id===protection.lock!.partId) : writtenInput.parts[0])?.transpose;
    const chordSignature = (events: ChordEvent[]) => JSON.stringify(events.map(c => [c.measure, c.t, c.symbol]).sort((a,b) => Number(a[0])-Number(b[0]) || Number(a[1])-Number(b[1])));
    const concertChords = (events: ChordEvent[]) => events.map(c => ({ ...c, symbol: transposeChordSymbol(c.symbol, sourceTranspose) }));

    // 2. Resolve chords: use provided, fall back to <harmony> tags, then infer
    const extractResult = extractChordEventsFromMusicXml(musicxml);
    if (extractResult.warnings.length) warnings.push(...extractResult.warnings);

    const parsedChords = Array.isArray((inputScore as any)?.meta?.inputChords)
      ? (inputScore as any).meta.inputChords
      : [];
    const providedChords = Array.isArray(req.chords) ? concertChords(req.chords) : [];
    const chordsFromFile = concertChords(extractResult.chords);

    const chordsToUse = providedChords.length
      ? providedChords
      : chordsFromFile.length
        ? chordsFromFile
        : parsedChords;

    const inferredIfEmpty = !chordsToUse.length ? inferChordsFromMelody(inputScore as any) : [];

    const finalChords = chordsToUse.length ? chordsToUse : inferredIfEmpty;
    if (protection.lock && providedChords.length && chordsFromFile.length && chordSignature(providedChords) !== chordSignature(chordsFromFile)) {
      throw new Error("Provided chords differ from the source. Explicitly disable source preservation to reharmonize.");
    }
    if (protection.lock) protection.lock.score.meta.inputChords = chordsFromFile;
    const chordSource = providedChords.length
      ? "request"
      : chordsFromFile.length
        ? "musicxml_harmony"
        : parsedChords.length
          ? "musicxml_meta"
          : inferredIfEmpty.length
            ? "inferred"
            : "none";

    // eslint-disable-next-line no-console
    console.log(
      `[pipeline] chordSource=${chordSource} | fromFile=${chordsFromFile.length} | provided=${providedChords.length} | inferred=${inferredIfEmpty.length} | final=${finalChords.length}`
    );

    // 3. Map settings to harmonizer options
    const harmOpts: Record<string, unknown> = { ...options, keepMelodyInSoprano: true };
    const accompanimentLower = String(
      settings.accompanimentType ?? settings.accompaniment ?? ""
    ).toLowerCase();
    const textureMode = String(settings.textureMode ?? "").toLowerCase();

    if (textureMode === "polyphony") {
      harmOpts.accompanimentType = "polyphonic";
    } else if (
      textureMode === "homophony_homorhythmic" ||
      textureMode === "homophony_melody_accompaniment"
    ) {
      harmOpts.accompanimentType = "homophonic";
    }
    if (!harmOpts.accompanimentType && accompanimentLower) {
      harmOpts.accompanimentType = accompanimentLower;
    }
    if (!harmOpts.styleProfile && typeof settings.styleProfile === "string") {
      harmOpts.styleProfile = settings.styleProfile;
    }
    if (!harmOpts.modernMode && typeof settings.modernMode === "string") {
      harmOpts.modernMode = settings.modernMode;
    }
    if (String(settings.level ?? "").toLowerCase() === "advanced") {
      harmOpts.tenorMinOverride = 50;
    }
    if (accompanimentLower === "homophonic") {
      harmOpts.tenorRangeOverride = { min: 57, max: 62 };
      // Piano Choral Homophonic: raise bass floor to C3 so the left-hand span
      // (tenor + bass on staff 2) stays within a comfortable major 9th for most pianists.
      // Non-piano homophonic (choral ensemble) keeps the full E2-A3 bass range.
      if (textureMode === "homophony_homorhythmic") {
        harmOpts.bassMinOverride = 48; // C3
      }
    }
    if (accompanimentLower === "polyphonic") {
      if (!harmOpts.styleProfile) {
        const style = String(settings.style ?? "").toLowerCase();
        if (style === "baroque")        harmOpts.styleProfile = "baroque";
        else if (style === "romantic")  harmOpts.styleProfile = "romantic";
        else if (style === "modern")    harmOpts.styleProfile = "modern";
        else if (style === "worship")   harmOpts.styleProfile = "worship";  // dedicated worship profile
        else if (style === "classical") harmOpts.styleProfile = "classical";
        else harmOpts.styleProfile = "classical"; // pop/funk/samba → classical voice-leading
      }
      if (String(harmOpts.styleProfile).toLowerCase() === "modern" && !harmOpts.modernMode) {
        harmOpts.modernMode = "modernTonal";
      }
    }

    // 4. Harmonize — skip for copy instrumentation modes; the arranger works
    //    directly on the original parsed score (piano LH/RH staves preserved).
    // "piano_string_quartet" is a dedicated ensemble that always skips harmonization.
    const ensembleLower = String(settings.ensemble ?? "").toLowerCase();
    const isCopyInstrumentation =
      ensembleLower === "piano_string_quartet" ||
      ensembleLower === "satb_string_quartet" ||
      // piano_with_strings: the original piano is frozen as-is; bypassing
      // harmonizeSatbFromChords ensures frozenPianoPart captures the full
      // original piano score, not an SATB reduction of it.
      ensembleLower === "piano_with_strings" ||
      // Woodwind ensembles — mirror the string family:
      //   piano_woodwind_quartet  = direct piano copy → winds
      //   satb_woodwind_quartet   = Choral-wind (SATB transcription)
      //   piano_with_woodwinds    = piano as harmony source → wind arrangement
      ensembleLower === "piano_woodwind_quartet" ||
      ensembleLower === "satb_woodwind_quartet" ||
      ensembleLower === "piano_with_woodwinds" ||
      // Brass ensembles — mirror the woodwind family:
      //   piano_brass_quartet = direct piano copy → brass
      //   satb_brass_quartet  = Choral-brass (SATB transcription)
      //   piano_with_brass    = piano as harmony source → brass arrangement
      ensembleLower === "piano_brass_quartet" ||
      ensembleLower === "satb_brass_quartet" ||
      ensembleLower === "piano_with_brass" ||
      // Re-instrumentation passes the score through unharmonized — only swaps instruments.
      ensembleLower === "reinstrument" ||
      // Piano/SATB → orchestra are direct transcriptions of existing harmony.
      ensembleLower === "piano_orchestra" ||
      ensembleLower === "satb_orchestra" ||
      settings.instrumentation === "piano_copy_to_string_quartet" ||
      settings.instrumentation === "satb_to_string_quartet" ||
      settings.instrumentation === "piano_copy_to_woodwind_quartet" ||
      settings.instrumentation === "satb_to_woodwind_quartet";

    let harmonizedScore: any;
    if (isCopyInstrumentation) {
      harmonizedScore = inputScore;
    } else {
      const melodyInput = protection.lock ? { ...inputScore, meta: { ...inputScore.meta, inputKeyFifths: protection.lock.expected.measures[0]?.attributes?.key_fifths }, parts: inputScore.parts.filter(p => p.part_id === protection.lock!.partId) } : inputScore;
      let outScore: any;
      try {
        outScore = (harmonizeSatbFromChords as any)(melodyInput, finalChords, harmOpts);
      } catch {
        outScore = (harmonizeSatbFromChords as any)({
          scoreModel: melodyInput,
          chords: finalChords,
          options: harmOpts
        });
      }
      harmonizedScore = normalizeHarmonizeReturn(outScore);
    }

    if (!harmonizedScore || typeof harmonizedScore !== "object") {
      return { ok: false, error: "Harmonizer returned an invalid scoreModel.", warnings };
    }

    // 5. Apply app settings (key transposition, tempo, time signature, etc.)
    const appResult = applyAppSettings(harmonizedScore, settings, finalChords as any);
    let scoreModelOut = appResult.scoreModel as any;
    if (Array.isArray(appResult.warnings)) warnings.push(...appResult.warnings);

    const protectedTargetId = protection.lock ? lockSourceInModel(protection.lock, scoreModelOut, settings) : undefined;

    // 6. Choral rule check (skip for non-SATB ensembles)
    const ensembleRaw = String(settings.ensemble ?? scoreModelOut?.meta?.ensemble ?? "").toLowerCase();
    const isPiano = ensembleRaw === "piano" || ensembleRaw === "piano_with_melody" || ensembleRaw === "grand_piano";
    const isPianoStringQuartet = ensembleRaw === "piano_string_quartet";
    const isSatbStringQuartet  = ensembleRaw === "satb_string_quartet";
    const isStrings = ensembleRaw === "string_ensemble" || ensembleRaw === "strings" || isPianoStringQuartet || isSatbStringQuartet ||
      // piano_with_strings uses the piano as a harmony source and outputs strings only
      ensembleRaw === "piano_with_strings";
    const isWoodwinds = ensembleRaw === "woodwind_ensemble" || ensembleRaw === "woodwinds" ||
      ensembleRaw === "piano_woodwind_quartet" ||
      ensembleRaw === "satb_woodwind_quartet" ||
      ensembleRaw === "piano_with_woodwinds";
    const isBrass = ensembleRaw === "brass_ensemble" || ensembleRaw === "brass" ||
      ensembleRaw === "piano_brass_quartet" ||
      ensembleRaw === "satb_brass_quartet" ||
      ensembleRaw === "piano_with_brass";
    const isOrchestra = ensembleRaw === "orchestra" || ensembleRaw === "full_orchestra" ||
      ensembleRaw === "piano_orchestra" || ensembleRaw === "satb_orchestra";
    const isReinstrument = ensembleRaw === "reinstrument";
    // Symphonic (Classical/Romantic) — like the orchestra: skip choral rule
    // checking and use the general exporter (it applies written transposition).
    const isSymphonic = ensembleRaw === "symphonic_orchestra";

    // 6a. Orchestra is now produced inside applyAppSettings by the worship
    // orchestra arranger (PraiseCharts layout). The old mapPianoToFullOrchestraOpen
    // expansion is retired — scoreModelOut already holds the orchestra here.

    if (!isPiano && !isStrings && !isWoodwinds && !isBrass && !isOrchestra && !isSymphonic && !isReinstrument) {
      try {
        const ruleCheck = checkChoralRules(scoreModelOut, finalChords as any, {
          strictness: settings.ruleStrictness,
          level: settings.level
        });
        if (Array.isArray(ruleCheck.warnings)) warnings.push(...ruleCheck.warnings);
      } catch (err: any) {
        warnings.push(`[rules] Rule check failed: ${err?.message ?? String(err)}`);
      }
    }

    // 7. Build output metadata
    const prevMeta = scoreModelOut.meta ?? {};
    const keySignatureMode = settings.keySignatureMode ?? "original";
    const timeSignatureMode = settings.timeSignatureMode ?? "original";
    const keySig = keySignatureMode === "manual" ? settings.keySignature : prevMeta.key;
    const timeSig = timeSignatureMode === "manual" ? settings.timeSignature : prevMeta.time_signature;

    scoreModelOut.meta = {
      ...prevMeta,
      title: settings.title ?? prevMeta.title,
      ensemble: settings.ensemble ?? prevMeta.ensemble ?? "satb",
      key: keySig ?? prevMeta.key,
      time_signature: timeSig ?? prevMeta.time_signature,
      tempo_bpm: typeof settings.tempo === "number" ? settings.tempo : prevMeta.tempo_bpm,
      app: {
        settingsUsed: settings,
        detectedInputKeyFifths: appResult.detectedInputKeyFifths,
        appliedTransposeSemitones: appResult.appliedTransposeSemitones,
        warnings,
        styleUsed: appResult.styleUsed,
        cadenceMeasures: appResult.cadenceMeasures,
        chordSource
      }
    };

    // An explicit opt-out lets the settings tempo replace the source tempo map.
    if (settings.preserveSource === false && typeof settings.tempo === "number") {
      for (const part of scoreModelOut.parts) for (const bar of part.measures) {
        if (bar.performance) bar.performance = { ...bar.performance, tempos: undefined };
      }
    }

    if (phrasePlan) applyPhrasePlan(scoreModelOut, phrasePlan, protectedTargetId!);

    // 8. Export to MusicXML
    // One canonical MusicXML exporter for every ensemble.
    let outputXml = exportScoreModelToMusicXML(scoreModelOut);
    if (protection.lock && protectedTargetId) {
      const checked = preserveAndVerifyXml(protection.lock, scoreModelOut, outputXml, protectedTargetId);
      outputXml = checked.xml;
      preservation = checked.report;
    }
    scoreModelOut.meta.sourcePreservation = preservation;
    const synchronized = synchronizePerformance(outputXml, scoreModelOut, protectedTargetId);
    outputXml = synchronized.musicxml;
    scoreModelOut = synchronized.scoreModel;
    if (protection.lock && protectedTargetId) {
      preservation = verifySourceOutput(protection.lock, scoreModelOut, outputXml, protectedTargetId);
      scoreModelOut.meta.sourcePreservation = preservation;
    }
    if (synchronized.report.reason) warnings.push(`MIDI/playback unavailable: ${synchronized.report.reason}`);
    warnings.push(...(synchronized.report.warnings ?? []));

    // Closing double bar, added last — after source verification, so it can never
    // be mistaken for a change to the preserved source part. Engine-generated
    // sources (rhythm-chart PDF, typed chords) have no barline to copy across.
    outputXml = ensureFinalBarlines(outputXml);

    const cadenceMeasures: number[] = Array.isArray(appResult.cadenceMeasures)
      ? appResult.cadenceMeasures
      : [];

    // Collect output parts list (useful for orchestra / large ensembles)
    const outputParts: Array<{ name: string; instrument: string }> = (scoreModelOut.parts ?? []).map(
      (p: any) => ({ name: String(p?.name ?? ""), instrument: String(p?.instrument ?? p?.name ?? "") })
    );

    return {
      ok: true,
      musicxml: outputXml,
      midiBase64: synchronized.midiBase64,
      scoreModel: scoreModelOut,
      warnings,
      meta: {
        phraseCollaboration: phrasePlan ? { status: "applied", phraseCount: phrasePlan.phrases.length, sourceFingerprint: phrasePlan.sourceFingerprint, plan: phrasePlan } : undefined,
        preservation,
        performance: synchronized.report,
        ensemble: ensembleRaw,
        styleUsed: appResult.styleUsed,
        chordSource,
        cadenceMeasures,
        chordEventCount: finalChords.length,
        parts: outputParts,
        title: String(scoreModelOut.meta?.title ?? ""),
      }
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err), warnings };
  }
}
