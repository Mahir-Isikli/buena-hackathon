/**
 * Gemini 3.1 Pro REST client for candidate-fact extraction.
 *
 * One model, end-to-end: gemini-3-pro-preview with high thinking. No
 * fallback to Flash, 2.5 Pro, or anything else. If a call fails, retry
 * on the same model.
 */

const GEMINI_MODEL = "gemini-3-pro-preview";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

export interface CandidateFact {
  /** Section heading the fact belongs to, e.g. "Open issues", "Bank", "Owners". */
  section: string;
  /** Optional unit ID like "EH-014" if the fact is unit-scoped. */
  unit?: string;
  /** The fact phrased as a single bullet line (no leading dash). */
  fact: string;
  /** 0..1 model confidence. */
  confidence: number;
  /** Short snippet from the source that supports the fact (for hover popover). */
  snippet?: string;
}

interface GeminiTextPart {
  text: string;
}

interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

type GeminiRequestPart = GeminiTextPart | GeminiInlineDataPart;

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

const SYSTEM_PROMPT = `You extract property-management facts from inbound material for a German Berlin property
("WEG Immanuelkirchstraße 26", id LIE-001). The material may be an email, PDF, scan, image,
plain text file, HTML, JSON, CSV, or another uploaded document. The output must be valid JSON only,
no prose, no markdown fences.

Schema:
{
  "candidates": [
    {
      "section": "Open issues" | "Bank" | "Owners" | "Service providers" | "Last assembly decisions" | "Identity" | "Units",
      "unit": "EH-XXX or null",
      "fact": "single bullet sentence, German or English, no leading dash",
      "confidence": 0.0..1.0,
      "snippet": "<= 160 chars from the source supporting this fact"
    }
  ]
}

Rules:
- Be conservative. Precision over recall. If unsure, skip it.
- Use deterministic routing hints when present. If a hint resolves a single unit and the material clearly concerns that resident/provider context, set unit to that EH-XXX.
- Don't restate ERP data already known (tenant names, rents, owner addresses) — only extract things that don't fit a structured table.
- Tribal knowledge wins: open issues, side-agreements, withholdings, appointments, complaints, decisions, contractor changes.
- Each candidate is one atomic fact, one bullet. Don't bundle multiple facts.
- If the material has nothing extractable, return {"candidates": []}.`;

export async function extractCandidates(
  apiKey: string,
  emailBody: string,
  meta: {
    subject: string;
    from: string;
    to: string;
    routingHint?: string;
  }
): Promise<CandidateFact[]> {
  const userText = [
    `Subject: ${meta.subject}`,
    `From: ${meta.from}`,
    `To: ${meta.to}`,
    meta.routingHint ? "" : null,
    meta.routingHint ? "Deterministic routing hints:" : null,
    meta.routingHint ?? null,
    "",
    emailBody.slice(0, 12000),
  ]
    .filter((v): v is string => v !== null)
    .join("\n");

  return generateCandidates(apiKey, [{ text: userText }]);
}

export async function extractBulkCandidates(
  apiKey: string,
  doc: {
    filename: string;
    mimeType: string;
    text?: string;
    data?: ArrayBuffer;
  },
  meta: {
    propertyId: string;
    propertyLabel?: string;
    propertyAddress?: string;
    note?: string;
    routingHint?: string;
  }
): Promise<CandidateFact[]> {
  const intro = [
    `Bulk upload filename: ${doc.filename}`,
    `Mime type: ${doc.mimeType}`,
    `Selected property: ${meta.propertyId}`,
    meta.propertyLabel ? `Property label: ${meta.propertyLabel}` : null,
    meta.propertyAddress ? `Property address: ${meta.propertyAddress}` : null,
    meta.note ? `Operator note: ${meta.note}` : null,
    meta.routingHint ? "" : null,
    meta.routingHint ? "Deterministic routing hints:" : null,
    meta.routingHint ?? null,
    "",
  ]
    .filter((v): v is string => v !== null)
    .join("\n");

  if (typeof doc.text === "string" && doc.text.trim()) {
    return generateCandidates(apiKey, [
      {
        text: `${intro}Extract facts from this uploaded document text:\n\n${doc.text.slice(0, 12000)}`,
      },
    ]);
  }

  if (doc.data && supportsInlineDocument(doc.mimeType) && doc.data.byteLength <= 5_000_000) {
    return generateCandidates(apiKey, [
      {
        text: `${intro}Analyze the attached uploaded document and extract only the relevant property-management facts.`,
      },
      {
        inlineData: {
          mimeType: doc.mimeType,
          data: arrayBufferToBase64(doc.data),
        },
      },
    ]);
  }

  return [];
}

async function generateCandidates(
  apiKey: string,
  parts: GeminiRequestPart[]
): Promise<CandidateFact[]> {
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "high" },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gemini ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return [];

  let parsed: { candidates?: CandidateFact[] };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn("[buena] failed to parse Gemini JSON", text.slice(0, 200));
    return [];
  }
  const out = parsed.candidates ?? [];
  return out.filter(
    (c) =>
      c &&
      typeof c.section === "string" &&
      typeof c.fact === "string" &&
      typeof c.confidence === "number"
  );
}

function supportsInlineDocument(mimeType: string): boolean {
  return [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ].includes(mimeType);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
