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

interface GeminiPart {
  text: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

const SYSTEM_PROMPT = `You extract property-management facts from inbound emails for a German Berlin property
("WEG Immanuelkirchstraße 26", id LIE-001). The output must be valid JSON only — no prose, no markdown fences.

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
- Don't restate ERP data already known (tenant names, rents, owner addresses) — only extract things that don't fit a structured table.
- Tribal knowledge wins: open issues, side-agreements, withholdings, appointments, complaints, decisions, contractor changes.
- Each candidate is one atomic fact, one bullet. Don't bundle multiple facts.
- If the email has nothing extractable, return {"candidates": []}.`;

export async function extractCandidates(
  apiKey: string,
  emailBody: string,
  meta: { subject: string; from: string; to: string }
): Promise<CandidateFact[]> {
  const userText = [
    `Subject: ${meta.subject}`,
    `From: ${meta.from}`,
    `To: ${meta.to}`,
    "",
    emailBody.slice(0, 12000),
  ].join("\n");

  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      // Gemini 3 Pro: "high" is the high-reasoning level (locked per AGENTS.md).
      // Never silently downgrade to "low" or another model.
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
