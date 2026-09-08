export function validateMusicXml(xml: string): { ok: true } | { ok: false; error: string } {
  if (!xml || typeof xml !== "string") return { ok: false, error: "No MusicXML content provided." };
  const trimmed = xml.trimStart();
  if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<score")) {
    return { ok: false, error: "File does not appear to be an XML document." };
  }
  if (!/<score-partwise|<score-timewise/i.test(xml)) {
    return {
      ok: false,
      error: "File is not a valid MusicXML document — missing <score-partwise> or <score-timewise> root element."
    };
  }
  if (!/<part[\s>]/i.test(xml)) {
    return { ok: false, error: "MusicXML file contains no parts. Please upload a score with at least one instrument." };
  }
  if (!/<measure[\s>]/i.test(xml)) {
    return { ok: false, error: "MusicXML file contains no measures. The score appears to be empty." };
  }
  return { ok: true };
}
