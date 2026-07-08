// src/omr/omrProvider.ts
//
// OMR (Optical Music Recognition) integration. Reads a NOTATED-score PDF (actual
// noteheads on staves) and returns MusicXML, which then flows into the normal
// arrange pipeline exactly like an uploaded .musicxml file.
//
// OMR itself runs OUT of process — it's too heavy for the Node app — so this is a
// thin, provider-agnostic HTTP client. It goes live the moment you point it at a
// cloud OMR API via env vars; until then getOmrProvider() returns null and the
// endpoint reports "not configured". A "mock" provider exists for testing the
// end-to-end plumbing without a real key.
//
// Configure a real provider (e.g. Halbestunde, Newzik, or any OMR API) with:
//   OMR_PROVIDER      = "cloud"            (or "mock" to test, unset = disabled)
//   OMR_API_URL       = https://…/recognize
//   OMR_API_KEY       = <your key>
//   OMR_API_AUTH_HEADER = Authorization    (default)
//   OMR_API_AUTH_PREFIX = "Bearer "        (default; use "" for a raw key header)
//   OMR_API_FILE_FIELD  = file             (multipart field name, default)
//   OMR_API_RESULT_FIELD = musicxml        (JSON field holding the MusicXML, default)

export interface OmrResult {
  musicxml: string;
  warnings: string[];
  provider: string;
}

export interface OmrProvider {
  readonly name: string;
  recognize(pdf: Buffer, opts?: { filename?: string }): Promise<OmrResult>;
}

const env = (k: string, d = ""): string => (process.env[k] ?? d).trim();

function looksLikeMusicXml(s: string): boolean {
  return /<score-partwise|<score-timewise|<\?xml/i.test(s.slice(0, 400));
}

/**
 * Generic cloud OMR client. POSTs the PDF as multipart/form-data and accepts the
 * MusicXML back in the common shapes: the raw body, a JSON string field, a
 * base64 JSON field, or a JSON result URL to fetch. Async job-polling providers
 * would need a small extension (documented as a follow-up).
 */
class CloudOmrProvider implements OmrProvider {
  readonly name = "cloud";
  private url = env("OMR_API_URL");
  private key = env("OMR_API_KEY");

  configured(): boolean {
    return !!this.url && !!this.key;
  }

  async recognize(pdf: Buffer, opts: { filename?: string } = {}): Promise<OmrResult> {
    if (!this.configured()) {
      throw new Error("OMR cloud provider is not configured (set OMR_API_URL and OMR_API_KEY).");
    }
    const authHeader = env("OMR_API_AUTH_HEADER", "Authorization");
    const authPrefix = process.env.OMR_API_AUTH_PREFIX ?? "Bearer ";
    const fileField = env("OMR_API_FILE_FIELD", "file");
    const resultField = env("OMR_API_RESULT_FIELD", "musicxml");

    const form = new FormData();
    form.append(fileField, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), opts.filename ?? "score.pdf");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env("OMR_API_TIMEOUT_MS", "120000")));
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: "POST",
        headers: { [authHeader]: `${authPrefix}${this.key}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`OMR provider returned HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }

    // 1) Raw MusicXML body.
    if (ct.includes("xml") || looksLikeMusicXml(text)) {
      return { musicxml: text, warnings: [], provider: this.name };
    }

    // 2) JSON shapes.
    let json: any;
    try { json = JSON.parse(text); } catch {
      throw new Error("OMR provider returned an unrecognized (non-XML, non-JSON) response.");
    }
    const warnings: string[] = Array.isArray(json?.warnings) ? json.warnings.map(String) : [];
    const field = json?.[resultField] ?? json?.musicxml ?? json?.result ?? json?.data;

    if (typeof field === "string" && looksLikeMusicXml(field)) {
      return { musicxml: field, warnings, provider: this.name };
    }
    if (typeof field === "string" && /^[A-Za-z0-9+/=\s]+$/.test(field) && field.length > 40) {
      const decoded = Buffer.from(field, "base64").toString("utf-8");
      if (looksLikeMusicXml(decoded)) return { musicxml: decoded, warnings, provider: this.name };
    }
    const resultUrl = json?.resultUrl ?? json?.result_url ?? json?.url;
    if (typeof resultUrl === "string" && /^https?:\/\//.test(resultUrl)) {
      const r2 = await fetch(resultUrl, { headers: { [authHeader]: `${authPrefix}${this.key}` } });
      const body2 = await r2.text();
      if (looksLikeMusicXml(body2)) return { musicxml: body2, warnings, provider: this.name };
    }
    throw new Error("OMR provider response did not contain MusicXML. Check OMR_API_RESULT_FIELD or the provider's async/job flow.");
  }
}

/** Tiny fixed MusicXML so the endpoint + UI plumbing can be tested without a key. */
class MockOmrProvider implements OmrProvider {
  readonly name = "mock";
  async recognize(_pdf: Buffer): Promise<OmrResult> {
    const musicxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note></measure>
<measure number="2"><note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note></measure>
</part></score-partwise>`;
    return { musicxml, warnings: ["[omr] MOCK provider — returns a placeholder 2-bar melody, not real recognition."], provider: this.name };
  }
}

/** Returns the configured provider, or null if OMR is disabled on this server. */
export function getOmrProvider(): OmrProvider | null {
  const which = env("OMR_PROVIDER").toLowerCase();
  if (which === "mock") return new MockOmrProvider();
  if (which === "cloud") {
    const p = new CloudOmrProvider();
    return p.configured() ? p : null;
  }
  return null;
}

export function omrStatus(): { enabled: boolean; provider: string | null } {
  const p = getOmrProvider();
  return { enabled: !!p, provider: p?.name ?? null };
}
