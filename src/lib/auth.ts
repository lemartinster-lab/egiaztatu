/**
 * Protección por contraseña (autenticación básica HTTP) para el modo de uso
 * personal. Si APP_PASSWORD no está definida, la app queda abierta (modo público).
 *
 * Usa solo APIs estándar (atob, TextEncoder) para funcionar en cualquier runtime.
 */

export interface AuthConfig {
  user: string;
  password: string;
}

export function authConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthConfig | null {
  const password = env.APP_PASSWORD?.trim();
  if (!password) return null;
  return { user: env.APP_USER?.trim() || "egiaztatu", password };
}

/** Comparación en tiempo constante para no filtrar pistas por el tiempo de respuesta. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** true si la cabecera Authorization contiene el usuario y la contraseña correctos. */
export function isAuthorized(header: string | null, config: AuthConfig | null): boolean {
  if (!config) return true; // sin contraseña configurada: acceso libre
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Se evalúan ambas siempre (sin cortocircuito) para no dar pistas.
  const okUser = safeEqual(user, config.user);
  const okPass = safeEqual(pass, config.password);
  return okUser && okPass;
}
