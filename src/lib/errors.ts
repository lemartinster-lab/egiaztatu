/**
 * Traduce los errores de Anthropic y ElevenLabs a mensajes claros en español.
 * Pensado para el modo personal: dice la causa real, pero nunca muestra claves.
 */

export type Service = "anthropic" | "elevenlabs";

/** Error de ElevenLabs con su código HTTP, para poder traducirlo. */
export class ElevenLabsError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`ElevenLabs respondió ${status}: ${detail.slice(0, 300)}`);
    this.name = "ElevenLabsError";
  }
}

/** Errores propios que ya están redactados para el usuario. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

interface ErrorLike {
  status?: unknown;
  message?: unknown;
  name?: unknown;
  /** Cuerpo del error de la API de Anthropic (SDK): { error: { message } } */
  error?: unknown;
}

/**
 * Saca la frase útil de un error de API. Los errores del SDK traen el cuerpo
 * JSON ({"type":"error","error":{"message":"…"}}) en `error` o dentro del texto.
 */
export function readableApiMessage(err: ErrorLike): string {
  const fromBody = (body: unknown): string | null => {
    if (!body || typeof body !== "object") return null;
    const b = body as { message?: unknown; error?: unknown; detail?: unknown };
    if (b.error && typeof b.error === "object") {
      const inner = fromBody(b.error);
      if (inner) return inner;
    }
    if (typeof b.message === "string" && b.message) return b.message;
    if (b.detail) {
      if (typeof b.detail === "string") return b.detail;
      const d = fromBody(b.detail);
      if (d) return d;
    }
    return null;
  };

  const direct = fromBody(err.error);
  if (direct) return direct;

  const message = typeof err.message === "string" ? err.message : "";
  const jsonStart = message.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = fromBody(JSON.parse(message.slice(jsonStart)));
      if (parsed) return parsed;
    } catch {
      /* no era JSON */
    }
  }
  return message.replace(/^\d{3}\s+/, "");
}

const NAMES: Record<Service, string> = { anthropic: "Anthropic", elevenlabs: "ElevenLabs" };
const KEYS: Record<Service, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};
const CONSOLES: Record<Service, string> = {
  anthropic: "console.anthropic.com → Billing",
  elevenlabs: "elevenlabs.io → Subscription",
};

export function describeError(e: unknown, service: Service, fallback: string): string {
  if (e instanceof UserFacingError) return e.message;

  const err = (e && typeof e === "object" ? e : {}) as ErrorLike;
  const message = typeof err.message === "string" ? err.message : "";
  const lower = message.toLowerCase();
  const status = typeof err.status === "number" ? err.status : undefined;
  const name = NAMES[service];
  const key = KEYS[service];

  if (lower.includes(`falta ${key.toLowerCase()}`)) {
    return `Falta la clave ${key} en Vercel. Añádela en Settings → Environment Variables y vuelve a desplegar (Redeploy).`;
  }

  // Sin respuesta del servidor (red, tiempo agotado)
  if (
    String(err.name).includes("Timeout") ||
    (status === undefined && String(err.name).includes("Connection"))
  ) {
    return `No se ha podido conectar con ${name} o ha tardado demasiado. Inténtalo de nuevo en un momento.`;
  }

  const outOfCredit =
    lower.includes("credit balance") ||
    lower.includes("quota") ||
    lower.includes("insufficient") ||
    lower.includes("billing");

  if (outOfCredit || status === 402) {
    return `No hay saldo o cuota suficiente en la cuenta de ${name} (${CONSOLES[service]}).`;
  }

  switch (status) {
    case 401:
      return `La clave ${key} no es válida. Revísala en Vercel (sin espacios) y vuelve a desplegar.`;
    case 403:
      return `La clave de ${name} no tiene permiso para esta operación.`;
    case 404:
      return service === "anthropic"
        ? "El modelo configurado no existe o no está disponible en tu cuenta. Revisa ANTHROPIC_MODEL en Vercel (o bórrala para usar el de por defecto)."
        : "ElevenLabs no reconoce el modelo de transcripción. Revisa ELEVENLABS_STT_MODEL en Vercel.";
    case 413:
      return `El contenido es demasiado grande para ${name}.`;
    case 429:
      return `${name} ha recibido demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo.`;
    case 529:
      return `${name} está saturado en este momento. Espera un minuto y vuelve a intentarlo.`;
  }

  if (status === 400 || status === 422) {
    // Detalle técnico recortado: útil en modo personal y sin datos sensibles.
    const detail = readableApiMessage(err)
      .replace(/sk[-_][A-Za-z0-9_-]{6,}/g, "[clave oculta]")
      .replace(/\s+/g, " ")
      .slice(0, 200);
    return `${name} rechazó la petición: ${detail || "petición no válida"}`;
  }

  if (status !== undefined && status >= 500) {
    return `${name} tiene un problema temporal (error ${status}). Inténtalo de nuevo en un momento.`;
  }

  return fallback;
}
