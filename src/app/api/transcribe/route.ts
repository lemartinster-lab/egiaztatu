import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { transcribeFromUrl } from "@/lib/elevenlabs";
import { describeError } from "@/lib/errors";
import { enforceLimit, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Solo se transcriben archivos de nuestro propio Blob Store. */
function isOwnBlob(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const limited = await enforceLimit(request, "transcribe");
  if (limited) return limited;

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || !isOwnBlob(url)) return jsonError("Archivo no válido");

  try {
    const result = await transcribeFromUrl(url);
    if (result.segments.length === 0) {
      return jsonError("No se ha detectado voz en el archivo", 422);
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("Error transcribiendo", e);
    return jsonError(
      describeError(e, "elevenlabs", "No se ha podido transcribir el audio. Inténtalo de nuevo."),
      502,
    );
  } finally {
    // Privacidad: el audio se borra en cuanto se ha transcrito.
    await del(url).catch((e) => console.error("No se pudo borrar el blob", e));
  }
}
