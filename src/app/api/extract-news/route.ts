import { NextResponse } from "next/server";
import { extractNewsClaims } from "@/lib/claude";
import { describeError } from "@/lib/errors";
import { enforceLimit, jsonError } from "@/lib/http";
import { validateNewsInput } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Extrae afirmaciones de una noticia o publicación: enlace, texto o capturas. */
export async function POST(request: Request) {
  const limited = await enforceLimit(request, "news");
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const v = validateNewsInput(body);
  if (!v.ok) return jsonError(v.error);

  try {
    const { meta, claims } = await extractNewsClaims(v.input);
    if (claims.length === 0) {
      return jsonError("No se han encontrado afirmaciones comprobables en este contenido.", 422);
    }
    return NextResponse.json({ meta, claims });
  } catch (e) {
    console.error("Error analizando noticia", e);
    return jsonError(
      describeError(e, "anthropic", "No se ha podido analizar la noticia. Inténtalo de nuevo."),
      502,
    );
  }
}
