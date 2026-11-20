import { describe, expect, it } from "vitest";
import {
  clearSession,
  loadSession,
  parseSession,
  reportFileName,
  saveSession,
  serializeSession,
  STORAGE_KEY,
  type KeyValueStore,
  type Session,
} from "@/lib/storage";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const base: Session = {
  phase: "resultados",
  title: "Debate a cuatro",
  date: "2026-11-25",
  segments: [{ speaker: "Ana", text: "texto largo" }],
  names: {},
  claims: [
    { id: "c1", speaker: "Ana", quote: "dato", type: "hecho", checkable: "dato", topic: "" },
    { id: "c2", speaker: "Luis", quote: "otro", type: "hecho", checkable: "otro", topic: "" },
    { id: "c3", speaker: "Eva", quote: "más", type: "hecho", checkable: "más", topic: "" },
  ],
  results: {
    c1: {
      claimId: "c1",
      verdict: "falso",
      confidence: "alta",
      explanation: "e",
      context: "",
      sources: [],
      downgraded: false,
    },
  },
  statuses: { c1: "hecho", c2: "verificando", c3: "error" },
};

describe("guardar y recuperar la sesión", () => {
  it("ida y vuelta conserva los datos", () => {
    const store = memoryStore();
    expect(saveSession(store, base)).toBe(true);
    const back = loadSession(store);
    expect(back?.title).toBe("Debate a cuatro");
    expect(back?.claims).toHaveLength(3);
    expect(back?.results.c1.verdict).toBe("falso");
    expect(back?.savedAt).toMatch(/^\d{4}-/);
  });

  it("las verificaciones en curso vuelven a 'pendiente' para reanudarse", () => {
    const back = parseSession(serializeSession(base));
    expect(back?.statuses).toEqual({ c1: "hecho", c2: "pendiente", c3: "error" });
  });

  it("en resultados no guarda la transcripción (ahorra espacio)", () => {
    expect(parseSession(serializeSession(base))?.segments).toEqual([]);
    const naming = parseSession(serializeSession({ ...base, phase: "nombres" }));
    expect(naming?.segments).toHaveLength(1);
  });

  it("ignora datos dañados o de otra versión", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("{no es json")).toBeNull();
    expect(parseSession(JSON.stringify({ v: 99 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...base, v: 1, phase: "otra" }))).toBeNull();
  });

  it("no rompe si el almacenamiento está lleno o bloqueado", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(saveSession(broken, base)).toBe(false);
    expect(loadSession(broken)).toBeNull();
    expect(() => clearSession(broken)).not.toThrow();
  });

  it("clearSession borra el debate guardado", () => {
    const store = memoryStore();
    saveSession(store, base);
    clearSession(store);
    expect(store.data.has(STORAGE_KEY)).toBe(false);
  });

  it("nombre de archivo del informe", () => {
    expect(reportFileName("Debate a 4 en RTVE: ¡Canarias!", "2026-11-25")).toBe(
      "egiaztatu-debate-a-4-en-rtve-canarias-2026-11-25.md",
    );
    expect(reportFileName("", "")).toBe("egiaztatu-debate.md");
  });
});
