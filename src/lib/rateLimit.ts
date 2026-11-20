/**
 * Límite de uso diario por IP. Al ser una app pública, cada llamada cuesta
 * dinero (Claude + ElevenLabs), así que todas las rutas de la API pasan por aquí.
 *
 * - Con UPSTASH_REDIS_REST_URL/TOKEN: el contador se comparte entre todas las
 *   instancias de Vercel (recomendado en producción).
 * - Sin ellas: contador en memoria, válido para desarrollo y como red mínima.
 */

export type Action = "upload" | "transcribe" | "extract" | "verify";

export interface CounterStore {
  /** Incrementa y devuelve el nuevo valor; la clave caduca a los ttlSeconds. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryStore implements CounterStore {
  private map = new Map<string, { count: number; expires: number }>();
  constructor(private now: () => number = Date.now) {}

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const t = this.now();
    const entry = this.map.get(key);
    if (!entry || entry.expires <= t) {
      this.map.set(key, { count: 1, expires: t + ttlSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

class UpstashStore implements CounterStore {
  constructor(private url: string, private token: string) {}

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSeconds), "NX"],
      ]),
    });
    if (!res.ok) throw new Error(`Upstash respondió ${res.status}`);
    const data = (await res.json()) as Array<{ result?: number }>;
    return Number(data[0]?.result ?? 0);
  }
}

const DEFAULT_LIMITS: Record<Action, number> = {
  upload: 12,
  transcribe: 8,
  extract: 30,
  verify: 150,
};

const ENV_KEYS: Record<Action, string> = {
  upload: "LIMIT_UPLOAD_PER_DAY",
  transcribe: "LIMIT_TRANSCRIBE_PER_DAY",
  extract: "LIMIT_EXTRACT_PER_DAY",
  verify: "LIMIT_VERIFY_PER_DAY",
};

export function limitFor(action: Action, env: Record<string, string | undefined> = process.env): number {
  const n = Number(env[ENV_KEYS[action]]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LIMITS[action];
}

let store: CounterStore | null = null;
function defaultStore(): CounterStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? new UpstashStore(url, token) : new MemoryStore();
  return store;
}

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
}

export async function checkLimit(
  ip: string,
  action: Action,
  opts: { store?: CounterStore; limit?: number; now?: Date } = {},
): Promise<LimitResult> {
  const limit = opts.limit ?? limitFor(action);
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const key = `egiaztatu:${action}:${ip}:${day}`;
  const count = await (opts.store ?? defaultStore()).incr(key, 60 * 60 * 26);
  return { ok: count <= limit, limit, remaining: Math.max(0, limit - count) };
}

/** IP del cliente detrás del proxy de Vercel. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "desconocida";
}
