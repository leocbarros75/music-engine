export function validateMusicXML(xml: string) {
  const issues: string[] = [];

  if (!xml.includes("<score-partwise")) {
    issues.push("Missing <score-partwise> root element.");
  }

  if (!xml.includes("</score-partwise>")) {
    issues.push("Missing closing </score-partwise> tag.");
  }

  const pitchBlocks = xml.match(/<pitch>[\s\S]*?<\/pitch>/g) || [];
  for (const p of pitchBlocks) {
    if (!p.includes("<step>")) {
      issues.push("Pitch missing <step>.");
    }
    if (!p.includes("<octave>")) {
      issues.push("Pitch missing <octave>.");
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}