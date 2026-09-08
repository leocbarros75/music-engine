import type { AppSettings } from "./applyAppSettings";
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function isActivity(v: unknown): v is "grounded" | "less_active" | "active" | "high_active" {
  return v === "grounded" || v === "less_active" || v === "active" || v === "high_active";
}

export function normalizeAppSettings(raw: unknown): AppSettings {
  if (!isObject(raw)) raw = {};
  const anyRaw = raw as Record<string, unknown>;
  const keyFifths = typeof anyRaw.keyFifths === "number" ? anyRaw.keyFifths : undefined;
  const accompanimentType =
    typeof anyRaw.accompanimentType === "string"
      ? anyRaw.accompanimentType
      : typeof anyRaw.accompaniment === "string"
        ? anyRaw.accompaniment
        : undefined;
  const keySignatureMode =
    anyRaw.keySignatureMode === "original" || anyRaw.keySignatureMode === "manual"
      ? (anyRaw.keySignatureMode as AppSettings["keySignatureMode"])
      : anyRaw.keySignature === "original" ? "original" : typeof anyRaw.keySignature === "string" ? "manual" : undefined;
  const timeSignatureMode =
    anyRaw.timeSignatureMode === "original" || anyRaw.timeSignatureMode === "manual"
      ? (anyRaw.timeSignatureMode as AppSettings["timeSignatureMode"])
      : anyRaw.timeSignature === "original" ? "original" : typeof anyRaw.timeSignature === "string" ? "manual" : undefined;

  return {
    preserveSource: anyRaw.preserveSource !== false,
    melodyOctaveShift: anyRaw.melodyOctaveShift === undefined ? 0 : Number(anyRaw.melodyOctaveShift),
    sourceMelodyPartId: typeof anyRaw.sourceMelodyPartId === "string" ? anyRaw.sourceMelodyPartId : undefined,
    title: typeof anyRaw.title === "string" ? anyRaw.title : undefined,
    ensemble: typeof anyRaw.ensemble === "string" ? anyRaw.ensemble : undefined,
    keySignature: typeof anyRaw.keySignature === "string" ? anyRaw.keySignature : undefined,
    keyFifths,
    keySignatureMode,
    targetKey: typeof anyRaw.targetKey === "string" ? anyRaw.targetKey : undefined,
    timeSignature: typeof anyRaw.timeSignature === "string" ? anyRaw.timeSignature : undefined,
    timeSignatureMode,
    tempo: typeof anyRaw.tempo === "number" ? anyRaw.tempo : undefined,
    style: typeof anyRaw.style === "string" ? anyRaw.style : undefined,
    level: typeof anyRaw.level === "string" ? (anyRaw.level as AppSettings["level"]) : undefined,
    accompanimentType,
    accompaniment: typeof anyRaw.accompaniment === "string" ? anyRaw.accompaniment : undefined,
    ruleStrictness:
      anyRaw.ruleStrictness === "relaxed" || anyRaw.ruleStrictness === "standard" || anyRaw.ruleStrictness === "strict"
        ? (anyRaw.ruleStrictness as AppSettings["ruleStrictness"])
        : undefined,
    textureMode: typeof anyRaw.textureMode === "string" ? anyRaw.textureMode : undefined,
    styleProfile: typeof anyRaw.styleProfile === "string" ? anyRaw.styleProfile : undefined,
    modernMode: typeof anyRaw.modernMode === "string" ? anyRaw.modernMode : undefined,
    bassActivity:
      anyRaw.bassActivity === "grounded" ||
      anyRaw.bassActivity === "less_active" ||
      anyRaw.bassActivity === "active" ||
      anyRaw.bassActivity === "high_active"
        ? (anyRaw.bassActivity as AppSettings["bassActivity"])
        : undefined,
    tenorActivity:
      anyRaw.tenorActivity === "grounded" ||
      anyRaw.tenorActivity === "less_active" ||
      anyRaw.tenorActivity === "active" ||
      anyRaw.tenorActivity === "high_active"
        ? (anyRaw.tenorActivity as AppSettings["tenorActivity"])
        : undefined,
    altoActivity:
      anyRaw.altoActivity === "grounded" ||
      anyRaw.altoActivity === "less_active" ||
      anyRaw.altoActivity === "active" ||
      anyRaw.altoActivity === "high_active"
        ? (anyRaw.altoActivity as AppSettings["altoActivity"])
        : undefined,
    sopranoActivity:
      anyRaw.sopranoActivity === "grounded" ||
      anyRaw.sopranoActivity === "less_active" ||
      anyRaw.sopranoActivity === "active" ||
      anyRaw.sopranoActivity === "high_active"
        ? (anyRaw.sopranoActivity as AppSettings["sopranoActivity"])
        : undefined,
    vln1Activity:
      anyRaw.vln1Activity === "grounded" ||
      anyRaw.vln1Activity === "less_active" ||
      anyRaw.vln1Activity === "active" ||
      anyRaw.vln1Activity === "high_active"
        ? (anyRaw.vln1Activity as AppSettings["vln1Activity"])
        : undefined,
    vln2Activity:
      anyRaw.vln2Activity === "grounded" ||
      anyRaw.vln2Activity === "less_active" ||
      anyRaw.vln2Activity === "active" ||
      anyRaw.vln2Activity === "high_active"
        ? (anyRaw.vln2Activity as AppSettings["vln2Activity"])
        : undefined,
    vlaActivity:
      anyRaw.vlaActivity === "grounded" ||
      anyRaw.vlaActivity === "less_active" ||
      anyRaw.vlaActivity === "active" ||
      anyRaw.vlaActivity === "high_active"
        ? (anyRaw.vlaActivity as AppSettings["vlaActivity"])
        : undefined,
    vcActivity:
      anyRaw.vcActivity === "grounded" ||
      anyRaw.vcActivity === "less_active" ||
      anyRaw.vcActivity === "active" ||
      anyRaw.vcActivity === "high_active"
        ? (anyRaw.vcActivity as AppSettings["vcActivity"])
        : undefined,
    cbActivity:
      anyRaw.cbActivity === "grounded" ||
      anyRaw.cbActivity === "less_active" ||
      anyRaw.cbActivity === "active" ||
      anyRaw.cbActivity === "high_active"
        ? (anyRaw.cbActivity as AppSettings["cbActivity"])
        : undefined,
    instrumentation:
      anyRaw.instrumentation === "auto" ||
      anyRaw.instrumentation === "piano_copy_to_string_quartet" ||
      anyRaw.instrumentation === "satb_to_string_quartet" ||
      anyRaw.instrumentation === "piano_copy_to_woodwind_quartet" ||
      anyRaw.instrumentation === "satb_to_woodwind_quartet"
        ? (anyRaw.instrumentation as AppSettings["instrumentation"])
        : undefined,
    woodwindQuintet: typeof anyRaw.woodwindQuintet === "boolean" ? anyRaw.woodwindQuintet : undefined,
    woodwindSize:
      anyRaw.woodwindSize === "quartet" || anyRaw.woodwindSize === "quintet"
        ? (anyRaw.woodwindSize as AppSettings["woodwindSize"])
        : undefined,
    woodwindTexture:
      anyRaw.woodwindTexture === "melody_harmony" || anyRaw.woodwindTexture === "chorale" ||
      anyRaw.woodwindTexture === "contrapuntal" || anyRaw.woodwindTexture === "chamber"
        ? (anyRaw.woodwindTexture as AppSettings["woodwindTexture"])
        : undefined,
    bassoonEntryMeasure:
      typeof anyRaw.bassoonEntryMeasure === "number" && Number.isFinite(anyRaw.bassoonEntryMeasure)
        ? anyRaw.bassoonEntryMeasure
        : undefined,
    brassTexture:
      anyRaw.brassTexture === "melody_harmony" || anyRaw.brassTexture === "chamber" ||
      anyRaw.brassTexture === "chorale" || anyRaw.brassTexture === "fanfare" ||
      anyRaw.brassTexture === "contrapuntal"
        ? (anyRaw.brassTexture as AppSettings["brassTexture"])
        : undefined,
    brassExample: typeof anyRaw.brassExample === "string" ? anyRaw.brassExample : undefined,
    brassQuintet: typeof anyRaw.brassQuintet === "boolean" ? anyRaw.brassQuintet : undefined,
    woodwindExample:  typeof anyRaw.woodwindExample === "string" ? anyRaw.woodwindExample : undefined,
    woodwindComposer: typeof anyRaw.woodwindComposer === "string" ? anyRaw.woodwindComposer : undefined,
    fluteActivity:    isActivity(anyRaw.fluteActivity)    ? anyRaw.fluteActivity    : undefined,
    oboeActivity:     isActivity(anyRaw.oboeActivity)     ? anyRaw.oboeActivity     : undefined,
    clarinetActivity: isActivity(anyRaw.clarinetActivity) ? anyRaw.clarinetActivity : undefined,
    hornActivity:     isActivity(anyRaw.hornActivity)     ? anyRaw.hornActivity     : undefined,
    bassoonActivity:  isActivity(anyRaw.bassoonActivity)  ? anyRaw.bassoonActivity  : undefined,
    sopranoMelodyShare:
      typeof anyRaw.sopranoMelodyShare === "number" && Number.isFinite(anyRaw.sopranoMelodyShare)
        ? anyRaw.sopranoMelodyShare
        : undefined,
    randomizeOffsets: typeof anyRaw.randomizeOffsets === "boolean" ? anyRaw.randomizeOffsets : undefined,
    pianoStylePreset: typeof anyRaw.pianoStylePreset === "string" ? anyRaw.pianoStylePreset : undefined,
    pianoStylePresetPath: typeof anyRaw.pianoStylePresetPath === "string" ? anyRaw.pianoStylePresetPath : undefined,
    useStringEnsembleArranger: typeof anyRaw.useStringEnsembleArranger === "boolean" ? anyRaw.useStringEnsembleArranger : undefined,
    lhPattern: typeof anyRaw.lhPattern === "string" ? anyRaw.lhPattern : undefined,
    rhPattern: typeof anyRaw.rhPattern === "string" ? anyRaw.rhPattern : undefined,
    bassRhythm: anyRaw.bassRhythm === "whole" || anyRaw.bassRhythm === "half" || anyRaw.bassRhythm === "quarter"
      ? anyRaw.bassRhythm : undefined,
    bassFinalNote: anyRaw.bassFinalNote === "follow_melody" || anyRaw.bassFinalNote === "default"
      ? anyRaw.bassFinalNote : undefined,
    reinstrument: Array.isArray(anyRaw.reinstrument)
      ? anyRaw.reinstrument
          .filter((r: any) => r && typeof r.part === "string" && typeof r.to === "string")
          .map((r: any) => ({ part: r.part, to: r.to }))
      : undefined,
    orchestraIntensity: anyRaw.orchestraIntensity === "build" || anyRaw.orchestraIntensity === "tutti"
      ? anyRaw.orchestraIntensity : undefined,
    // Symphonic orchestra period (explicit === checks: strict tsc rejects
    // .includes() on an unknown value — that broke a Render deploy once).
    symphonicPeriod: anyRaw.symphonicPeriod === "classical" || anyRaw.symphonicPeriod === "romantic"
      ? anyRaw.symphonicPeriod : undefined,
    orchestraTexture: anyRaw.orchestraTexture === "melody_harmony" || anyRaw.orchestraTexture === "chorale" || anyRaw.orchestraTexture === "contrapuntal"
      ? anyRaw.orchestraTexture : undefined,
    orchestraParts: Array.isArray(anyRaw.orchestraParts)
      ? anyRaw.orchestraParts.filter((s: any) => typeof s === "string")
      : undefined,
    orchestraBalance: (anyRaw.orchestraBalance === "default" || anyRaw.orchestraBalance === "more_strings" ||
      anyRaw.orchestraBalance === "more_winds" || anyRaw.orchestraBalance === "more_brass")
      ? anyRaw.orchestraBalance : undefined,
    orchestraPartRanges: Array.isArray(anyRaw.orchestraPartRanges)
      ? anyRaw.orchestraPartRanges
          .filter((r: any) => r && typeof r.part === "string" && Array.isArray(r.ranges))
          .map((r: any) => ({
            part: r.part,
            ranges: r.ranges
              .filter((x: any) => Array.isArray(x) && x.length === 2 && Number.isFinite(Number(x[0])) && Number.isFinite(Number(x[1])))
              .map((x: any) => [Number(x[0]), Number(x[1])] as [number, number]),
          }))
          .filter((r: any) => r.ranges.length)
      : undefined,
    suzukiVolume:
      typeof anyRaw.suzukiVolume === "number" && Number.isInteger(anyRaw.suzukiVolume) && anyRaw.suzukiVolume >= 1
        ? (anyRaw.suzukiVolume as number)
        : typeof anyRaw.suzukiVolume === "string" && /^\d+$/.test(anyRaw.suzukiVolume)
          ? parseInt(anyRaw.suzukiVolume, 10)
          : undefined,
  };
}
