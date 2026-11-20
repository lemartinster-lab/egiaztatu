import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/claude";
import { describeError } from "@/lib/errors";
import { enforceLimit, jsonError } from "@/lib/http";
import { MAX_CLAIMS } from "@/lib/parse";
import type { Segment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function isSegments(v: unknown): v is Segment[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 5000 &&
    v.every(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof (s as Segment).speaker === "string" &&
        typeof (s as Segment).text === "string",
    )
  );
}

export async function POST(request: Request) {
  const limited = await enforceLimit(request, "extract");
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as {
    segments?: unknown;
    maxClaims?: unknown;
  };
  if (!isSegments(body.segments)) return jsonError("Transcripción no válida");

  try {
    const max =
      typeof body.maxClaims === "number" && body.maxClaims >= 1
        ? Math.min(MAX_CLAIMS, Math.floor(body.maxClaims))
        : MAX_CLAIMS;
    const claims = await extractClaims(body.segments, max);
    return NextResponse.json({ claims });
  } catch (e) {
    console.error("Error extrayendo afirmaciones", e);
    return jsonError(
      describeError(e, "anthropic", "No se han podido extraer las afirmaciones. Inténtalo de nuevo."),
      502,
    );
  }
}
