import type {
  Claim,
  ClaimType,
  Confidence,
  Segment,
  Source,
  VerificationResult,
  Verdict,
} from "./types";

export const MAX_CLAIMS = 40;
export const MAX_CLAIM_CHARS = 600;

/* ------------------------------------------------------------------ */
/* JSON devuelto por la IA                                             */
/* ------------------------------------------------------------------ */

/**
 * Extrae el primer objeto JSON de un texto del modelo. Acepta JSON "limpio",
 * bloques ```json ... ``` o texto con explicaciones alrededor.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* probamos el siguiente candidato */
    }
  }
  throw new Error("La respuesta de la IA no contiene un JSON válido");
}

function str(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* ------------------------------------------------------------------ */
/* Transcripción pegada como texto                                     */
/* ------------------------------------------------------------------ */

// "Nombre Apellido: texto"  ·  "MODERADORA: texto"  ·  "Sr. Pérez: texto"
const SPEAKER_LINE =
  /^\s*([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'\- ]{0,40}?)\s*:\s+(.+)$/;

/**
 * Convierte una transcripción pegada en tramos por hablante.
 * Las líneas sin "Nombre:" se añaden al hablante anterior.
 */
export function parseTranscriptText(raw: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(SPEAKER_LINE);
    const speaker = m ? normalizeSpeaker(m[1]) : null;
    const text = m ? m[2].trim() : trimmed;
    const last = segments[segments.length - 1];
    if (speaker === null) {
      if (last) last.text += " " + text;
      else segments.push({ speaker: "Interviniente", text });
    } else if (last && last.speaker === speaker) {
      last.text += " " + text;
    } else {
      segments.push({ speaker, text });
    }
  }
  return segments;
}

function normalizeSpeaker(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  // "PEDRO PÉREZ" -> "Pedro Pérez"
  if (clean === clean.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(clean)) {
    return clean
      .toLowerCase()
      .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return clean;
}

/* ------------------------------------------------------------------ */
/* Transcripción de ElevenLabs                                         */
/* ------------------------------------------------------------------ */

export interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event" | string;
  speaker_id?: string | null;
}

/** "speaker_0" -> "Hablante 1" */
export function speakerLabel(id: string | null | undefined): string {
  const n = id?.match(/(\d+)$/);
  return n ? `Hablante ${Number(n[1]) + 1}` : "Hablante";
}

/** Agrupa las palabras de ElevenLabs Scribe en tramos por hablante. */
export function scribeWordsToSegments(words: ScribeWord[]): Segment[] {
  const segments: Segment[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const speaker = speakerLabel(w.speaker_id);
    const last = segments[segments.length - 1];
    if (last && last.speaker === speaker) {
      last.text += w.text;
    } else if (w.type === "spacing" || !w.text.trim()) {
      if (last) last.text += w.text;
    } else {
      segments.push({ speaker, text: w.text, start: w.start });
    }
  }
  return segments
    .map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);
}

/** Sustituye "Hablante 1" por el nombre real que escriba el usuario. */
export function renameSpeakers(
  segments: Segment[],
  names: Record<string, string>,
): Segment[] {
  return segments.map((s) => ({
    ...s,
    speaker: names[s.speaker]?.trim() || s.speaker,
  }));
}

export function segmentsToPrompt(segments: Segment[]): string {
  return segments.map((s) => `[${s.speaker}] ${s.text}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* Afirmaciones extraídas                                              */
/* ------------------------------------------------------------------ */

const CLAIM_TYPES: ClaimType[] = ["hecho", "opinion", "promesa"];

export function normalizeClaims(raw: unknown): Claim[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { claims?: unknown }).claims)
      ? ((raw as { claims: unknown[] }).claims)
      : [];
  const out: Claim[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const quote = str(o.quote, MAX_CLAIM_CHARS);
    if (!quote) continue;
    const type = CLAIM_TYPES.includes(o.type as ClaimType)
      ? (o.type as ClaimType)
      : "opinion";
    out.push({
      id: `c${out.length + 1}`,
      speaker: str(o.speaker, 80) || "Interviniente",
      quote,
      type,
      checkable: str(o.checkable, MAX_CLAIM_CHARS) || quote,
      topic: str(o.topic, 60),
    });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Veredictos                                                          */
/* ------------------------------------------------------------------ */

const VERDICTS: Verdict[] = ["verdadero", "enganoso", "falso", "no_verificable"];
const CONFIDENCES: Confidence[] = ["alta", "media", "baja"];

/** Normaliza una URL para compararla (sin #, sin barra final, sin www). */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}${url.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/**
 * Valida el veredicto del modelo y aplica la regla de oro de Egiaztatu:
 * solo se aceptan fuentes que el buscador devolvió de verdad en esta
 * consulta, y sin fuentes no hay veredicto (pasa a "no verificable").
 */
export function normalizeVerification(
  raw: unknown,
  claimId: string,
  retrieved: Source[],
): VerificationResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let verdict: Verdict = VERDICTS.includes(o.verdict as Verdict)
    ? (o.verdict as Verdict)
    : "no_verificable";
  let confidence: Confidence = CONFIDENCES.includes(o.confidence as Confidence)
    ? (o.confidence as Confidence)
    : "baja";

  const byUrl = new Map(retrieved.map((s) => [normalizeUrl(s.url), s]));
  const seen = new Set<string>();
  const sources: Source[] = [];
  const rawSources = Array.isArray(o.sources) ? o.sources : [];
  for (const s of rawSources) {
    const url = typeof s === "string" ? s : str((s as Record<string, unknown>)?.url);
    const key = normalizeUrl(url);
    const real = byUrl.get(key);
    if (real && !seen.has(key)) {
      seen.add(key);
      sources.push({
        url: real.url,
        title: real.title || str((s as Record<string, unknown>)?.title, 200) || real.url,
      });
    }
    if (sources.length >= 5) break;
  }

  let downgraded = false;
  if (verdict !== "no_verificable" && sources.length === 0) {
    verdict = "no_verificable";
    confidence = "baja";
    downgraded = true;
  }

  return {
    claimId,
    verdict,
    confidence,
    explanation:
      str(o.explanation, 1500) ||
      "No se ha podido elaborar una explicación para esta afirmación.",
    context: str(o.context, 1000),
    sources,
    downgraded,
  };
}
