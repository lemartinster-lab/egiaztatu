import type { Claim, Segment, VerificationResult } from "./types";

/**
 * Guarda la sesión en el propio navegador (localStorage) para que una
 * recarga o un cierre de Chrome en el móvil no hagan perder el trabajo
 * (ni obliguen a pagar otra vez las verificaciones).
 */

export const STORAGE_KEY = "egiaztatu:sesion";
const VERSION = 1;

export type SavedStatus = "pendiente" | "verificando" | "hecho" | "error";

export interface Session {
  phase: "nombres" | "resultados";
  title: string;
  /** Medio, autor y fecha de publicación (solo en noticias). */
  subtitle?: string;
  date: string;
  /** Solo hace falta mientras se asignan nombres a las voces. */
  segments: Segment[];
  names: Record<string, string>;
  claims: Claim[];
  results: Record<string, VerificationResult>;
  statuses: Record<string, SavedStatus>;
}

interface Stored extends Session {
  v: number;
  savedAt: string;
}

/** Interfaz mínima de localStorage (permite probarlo sin navegador). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function serializeSession(s: Session, now = new Date()): string {
  const stored: Stored = {
    ...s,
    // En resultados ya no hace falta la transcripción completa: se ahorra espacio.
    segments: s.phase === "nombres" ? s.segments : [],
    v: VERSION,
    savedAt: now.toISOString(),
  };
  return JSON.stringify(stored);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Lee una sesión guardada. Devuelve null si no hay o está dañada.
 * Las verificaciones que estaban "en curso" pasan a "pendiente" para reanudarlas.
 */
export function parseSession(raw: string | null): (Session & { savedAt: string }) | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || data.v !== VERSION) return null;
  if (data.phase !== "nombres" && data.phase !== "resultados") return null;
  if (!Array.isArray(data.claims) || !Array.isArray(data.segments)) return null;
  if (!isObj(data.results) || !isObj(data.statuses) || !isObj(data.names)) return null;

  const statuses: Record<string, SavedStatus> = {};
  for (const [id, st] of Object.entries(data.statuses)) {
    statuses[id] =
      st === "hecho" || st === "error" ? st : "pendiente"; // "verificando" se reanuda
  }

  return {
    phase: data.phase,
    title: typeof data.title === "string" ? data.title : "",
    subtitle: typeof data.subtitle === "string" ? data.subtitle : "",
    date: typeof data.date === "string" ? data.date : "",
    segments: data.segments as Segment[],
    names: data.names as Record<string, string>,
    claims: data.claims as Claim[],
    results: data.results as Record<string, VerificationResult>,
    statuses,
    savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
  };
}

export function saveSession(store: KeyValueStore, s: Session): boolean {
  try {
    store.setItem(STORAGE_KEY, serializeSession(s));
    return true;
  } catch {
    return false; // almacenamiento lleno o bloqueado (modo incógnito)
  }
}

export function loadSession(store: KeyValueStore) {
  try {
    return parseSession(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearSession(store: KeyValueStore): void {
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nada que hacer */
  }
}

/** Nombre de archivo para el informe descargado. */
export function reportFileName(title: string, date: string, ext: "md" | "docx" = "md"): string {
  const slug = (title || "debate")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `egiaztatu-${slug || "debate"}${date ? "-" + date : ""}.${ext}`;
}
