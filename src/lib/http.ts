import { NextResponse } from "next/server";
import { checkLimit, clientIp, type Action } from "./rateLimit";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Devuelve una respuesta 429 si la IP ha agotado su cupo diario, o null si puede seguir. */
export async function enforceLimit(req: Request, action: Action) {
  try {
    const r = await checkLimit(clientIp(req.headers), action);
    if (!r.ok) {
      return jsonError(
        `Has alcanzado el límite diario (${r.limit}) para esta acción. Vuelve mañana.`,
        429,
      );
    }
    return null;
  } catch (e) {
    // Si el contador falla, se registra y se deja pasar (mejor que tumbar la app).
    console.error("Error en el límite de uso", e);
    return null;
  }
}
