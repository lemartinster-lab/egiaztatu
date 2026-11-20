import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { enforceLimit, jsonError } from "@/lib/http";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";

export const runtime = "nodejs";

const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

/**
 * Autoriza al navegador a subir el audio directamente a Vercel Blob.
 * El archivo no pasa por esta función (así se evita el límite de 4,5 MB).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  if (body.type === "blob.generate-client-token") {
    const limited = await enforceLimit(request, "upload");
    if (limited) return limited;
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_TYPES,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
        // Red de seguridad: aunque falle el borrado tras transcribir,
        // el archivo desaparece en 24 horas.
        ttlDays: 1,
      }),
      // Sin onUploadCompleted: así Vercel no llama de vuelta a esta ruta
      // (esa llamada quedaría bloqueada por la contraseña del modo personal).
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Error autorizando la subida", e);
    return jsonError("No se ha podido autorizar la subida del archivo", 400);
  }
}
