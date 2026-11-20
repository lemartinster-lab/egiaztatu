import { scribeWordsToSegments, type ScribeWord } from "./parse";
import type { Segment } from "./types";

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export interface TranscriptionResult {
  segments: Segment[];
  /** Duración aproximada del audio, en segundos. */
  durationSeconds: number;
  language: string;
}

/**
 * Transcribe un audio/vídeo ya subido a Vercel Blob con ElevenLabs Scribe,
 * separando a los hablantes (diarización). Se envía solo la URL, no el
 * archivo, para no superar el límite de tamaño de las funciones de Vercel.
 */
export async function transcribeFromUrl(fileUrl: string): Promise<TranscriptionResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Falta ELEVENLABS_API_KEY en el servidor");

  const form = new FormData();
  form.set("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.set("cloud_storage_url", fileUrl);
  form.set("diarize", "true");
  form.set("language_code", "spa");
  form.set("tag_audio_events", "false");
  form.set("timestamps_granularity", "word");

  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    language_code?: string;
    words?: ScribeWord[];
  };
  const words = data.words ?? [];
  const last = words[words.length - 1];
  return {
    segments: scribeWordsToSegments(words),
    durationSeconds: Math.round(last?.end ?? 0),
    language: data.language_code ?? "spa",
  };
}
