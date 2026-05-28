// src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts
// Full server-side pipeline: MusicXML in → arranged MusicXML out.
import { parseMusicXMLToScoreModel } from "../parsers/musicxmlParser";
import { harmonizeSatbFromChords } from "../harmonize/satb/harmonizeSatbFromChords";
import { inferChordsFromMelody } from "../harmonize/satb/inferChordsFromMelody";
import { applyAppSettings, type AppSettings } from "../app/applyAppSettings";
import { checkChoralRules } from "../rules/choral/checkChoralRules";
import { exportScoreModelToMusicXML } from "../exporters/musicxmlExporter";
import { exportSatbScoreModelToMusicXML } from "../exporters/satbMusicxmlExporter";
import { extractChordEventsFromMusicXml, type ChordEvent } from "../extract/chordEventsFromMusicXml";
import { mapPianoToFullOrchestraOpen } from "../arrange/mapToFullOrchestra";
import { scoreHasPianoPart } from "../arrange/arrangeStringQuartetFromPianoInstrumentation";

export type PipelineRequest = {
  musicxml: string;
  settings: AppSettings;
  chords?: ChordEvent[];
  options?: Record<string, unknown>;
};

export type PipelineResult = {
  ok: true;
  musicxml: string;
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
    // 1. Parse input MusicXML
    const inputScore = parseMusicXMLToScoreModel(musicxml);

    // 2. Resolve chords: use provided, fall back to <harmony> tags, then infer
    const extractResult = extractChordEventsFromMusicXml(musicxml);
    if (extractResult.warnings.length) warnings.push(...extractResult.warnings);

    const parsedChords = Array.isArray((inputScore as any)?.meta?.inputChords)
      ? (inputScore as any).meta.inputChords
      : [];
    const providedChords = Array.isArray(req.chords) ? req.chords : [];
    const chordsFromFile = extractResult.chords;

    const chordsToUse = providedChords.length
      ? providedChords
      : chordsFromFile.length
        ? chordsFromFile
        : parsedChords;

    const inferredIfEmpty = !chordsToUse.length ? inferChordsFromMelody(inputScore as any) : [];

    const finalChords = chordsToUse.length ? chordsToUse : inferredIfEmpty;
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
      settings.instrumentation === "piano_copy_to_string_quartet" ||
      settings.instrumentation === "satb_to_string_quartet" ||
      settings.instrumentation === "piano_copy_to_woodwind_quartet" ||
      settings.instrumentation === "satb_to_woodwind_quartet";

    let harmonizedScore: any;
    if (isCopyInstrumentation) {
      harmonizedScore = inputScore;
    } else {
      let outScore: any;
      try {
        outScore = (harmonizeSatbFromChords as any)(inputScore, finalChords, harmOpts);
      } catch {
        outScore = (harmonizeSatbFromChords as any)({
          scoreModel: inputScore,
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

    // 6. Choral rule check (skip for non-SATB ensembles)
    const ensembleRaw = String(settings.ensemble ?? scoreModelOut?.meta?.ensemble ?? "").toLowerCase();
    const isPiano = ensembleRaw === "piano" || ensembleRaw === "piano_with_melody" || ensembleRaw === "grand_piano";
    const isPianoStringQuartet = ensembleRaw === "piano_string_quartet";
    const isSatbStringQuartet  = ensembleRaw === "satb_string_quartet";
    const isStrings = ensembleRaw === "string_ensemble" || ensembleRaw === "strings" || isPianoStringQuartet || isSatbStringQuartet ||
      // piano_with_strings uses the piano as a harmony source and outputs strings only
      ensembleRaw === "piano_with_strings";
    const isWoodwinds = ensembleRaw === "woodwind_ensemble" || ensembleRaw === "woodwinds";
    const isBrass = ensembleRaw === "brass_ensemble" || ensembleRaw === "brass";
    const isOrchestra = ensembleRaw === "orchestra";

    // 6a. Full orchestra expansion — run after SATB/string harmonization
    if (isOrchestra) {
      try {
        const orchestraScore = mapPianoToFullOrchestraOpen(scoreModelOut, { profile: "classical" });
        scoreModelOut = orchestraScore as any;
      } catch (err: any) {
        warnings.push(`[orchestra] Expansion failed, using SATB output: ${err?.message ?? String(err)}`);
      }
    }

    if (!isPiano && !isStrings && !isWoodwinds && !isBrass && !isOrchestra) {
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

    // 8. Export to MusicXML
    const hasPianoPart = scoreModelOut.parts?.some(
      (p: any) => String(p?.instrument ?? "").toLowerCase().includes("piano")
    );
    const hasGrandStaff = scoreModelOut.parts?.some((p: any) => Number(p?.staves ?? 1) === 2);
    const hasWoodwindPart = scoreModelOut.parts?.some((p: any) => {
      const s = `${p?.instrument ?? ""} ${p?.name ?? ""}`.toLowerCase();
      return s.includes("flute") || s.includes("oboe") || s.includes("clarinet") || s.includes("bassoon");
    });
    const hasBrassPart = scoreModelOut.parts?.some((p: any) => {
      const s = `${p?.instrument ?? ""} ${p?.name ?? ""}`.toLowerCase();
      return s.includes("trumpet") || s.includes("horn") || s.includes("trombone") || s.includes("tuba");
    });
    // Double bass is a transposing instrument (written one octave higher than sounding).
    // The general exporter handles this correctly via getTransposeForInstrument;
    // the SATB exporter does not — so route any score with a double bass through
    // the general exporter.
    const hasDoubleBass = scoreModelOut.parts?.some((p: any) => {
      const s = `${p?.instrument ?? ""} ${p?.name ?? ""}`.toLowerCase();
      return s.includes("double_bass") || s.includes("double bass") || s.includes("contrabass");
    });

    const useGeneralExporter =
      isPiano || isWoodwinds || isBrass || isOrchestra || hasPianoPart || hasGrandStaff || hasWoodwindPart || hasBrassPart || hasDoubleBass;

    const outputXml = useGeneralExporter
      ? exportScoreModelToMusicXML(scoreModelOut)
      : exportSatbScoreModelToMusicXML(scoreModelOut);

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
      scoreModel: scoreModelOut,
      warnings,
      meta: {
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
