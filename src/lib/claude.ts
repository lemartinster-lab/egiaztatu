import Anthropic from "@anthropic-ai/sdk";
import {
  CLAIMS_SCHEMA,
  EXTRACT_SYSTEM,
  verifySystem,
  verifyUserMessage,
} from "./prompts";
import {
  extractJsonObject,
  normalizeClaims,
  normalizeVerification,
  segmentsToPrompt,
} from "./parse";
import type { Claim, Segment, Source, VerificationResult } from "./types";
import { UserFacingError } from "./errors";

/** Límite de texto de entrada (≈ 2 horas de debate). */
export const MAX_TRANSCRIPT_CHARS = 160_000;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor");
  return new Anthropic({ apiKey });
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

/** Paso 1: extraer y clasificar afirmaciones del debate. */
export async function extractClaims(segments: Segment[]): Promise<Claim[]> {
  const transcript = segmentsToPrompt(segments);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new UserFacingError("La transcripción es demasiado larga (máximo ≈ 2 horas).");
  }
  const res = await client().messages.create({
    model: model(),
    max_tokens: 16_000,
    system: EXTRACT_SYSTEM,
    // Salida estructurada: el modelo devuelve un JSON que cumple el esquema.
    output_config: { format: { type: "json_schema", schema: CLAIMS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Transcripción del debate:\n\n${transcript}`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: unknown;
  try {
    // Plan B incluido: extractJsonObject también lee JSON envuelto en texto.
    parsed = extractJsonObject(text);
  } catch {
    throw new UserFacingError("La IA no devolvió afirmaciones en un formato válido. Inténtalo de nuevo.");
  }
  return normalizeClaims(parsed);
}

/** Recoge todas las URLs que el buscador devolvió de verdad. */
function collectRetrieved(content: Anthropic.ContentBlock[], into: Source[]) {
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === "web_search_result") into.push({ url: r.url, title: r.title });
      }
    }
    if (block.type === "text" && block.citations) {
      for (const c of block.citations) {
        if (c.type === "web_search_result_location") {
          into.push({ url: c.url, title: c.title ?? c.url });
        }
      }
    }
  }
}

/** Paso 2: verificar UNA afirmación con búsqueda web y fuentes reales. */
export async function verifyClaim(
  claim: Pick<Claim, "id" | "checkable" | "quote">,
  date: string | undefined,
): Promise<VerificationResult> {
  const today = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: verifyUserMessage(claim.checkable, claim.quote, date) },
  ];
  const retrieved: Source[] = [];
  let finalText = "";

  // Las búsquedas largas pueden devolver "pause_turn": se continúa hasta 3 veces.
  for (let turn = 0; turn < 3; turn++) {
    const res = await client().messages.create({
      model: model(),
      max_tokens: 4_000,
      system: verifySystem(today),
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
          user_location: { type: "approximate", country: "ES", timezone: "Europe/Madrid" },
        },
      ],
      messages,
    });
    collectRetrieved(res.content, retrieved);
    finalText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }

  let parsed: unknown = {};
  try {
    parsed = extractJsonObject(finalText);
  } catch {
    parsed = {};
  }
  return normalizeVerification(parsed, claim.id, retrieved);
}
