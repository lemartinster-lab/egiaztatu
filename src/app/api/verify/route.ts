import { NextResponse } from "next/server";
import { verifyClaim } from "@/lib/claude";
import { enforceLimit, jsonError } from "@/lib/http";
import { MAX_CLAIM_CHARS } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 300;

interface VerifyBody {
  id?: unknown;
  checkable?: unknown;
  quote?: unknown;
  date?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const limited = await enforceLimit(request, "verify");
  if (limited) return limited;

  const b = (await request.json().catch(() => ({}))) as VerifyBody;
  const ok =
    typeof b.id === "string" &&
    b.id.length <= 20 &&
    typeof b.checkable === "string" &&
    b.checkable.trim().length > 0 &&
    b.checkable.length <= MAX_CLAIM_CHARS &&
    typeof b.quote === "string" &&
    b.quote.length <= MAX_CLAIM_CHARS;
  if (!ok) return jsonError("Afirmación no válida");

  const date = typeof b.date === "string" && DATE_RE.test(b.date) ? b.date : undefined;

  try {
    const result = await verifyClaim(
      { id: b.id as string, checkable: b.checkable as string, quote: b.quote as string },
      date,
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("Error verificando", e);
    return jsonError("No se ha podido verificar esta afirmación.", 502);
  }
}
