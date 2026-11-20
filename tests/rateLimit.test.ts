import { describe, expect, it } from "vitest";
import { MemoryStore, checkLimit, clientIp, limitFor } from "@/lib/rateLimit";

describe("límite de uso por IP", () => {
  it("deja pasar hasta el límite y bloquea después", async () => {
    const store = new MemoryStore();
    const now = new Date("2026-11-20T10:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkLimit("1.2.3.4", "transcribe", { store, limit: 3, now }));
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[3].remaining).toBe(0);
  });

  it("cuenta por separado cada IP y cada acción", async () => {
    const store = new MemoryStore();
    const now = new Date("2026-11-20T10:00:00Z");
    await checkLimit("1.1.1.1", "verify", { store, limit: 1, now });
    expect((await checkLimit("2.2.2.2", "verify", { store, limit: 1, now })).ok).toBe(true);
    expect((await checkLimit("1.1.1.1", "extract", { store, limit: 1, now })).ok).toBe(true);
    expect((await checkLimit("1.1.1.1", "verify", { store, limit: 1, now })).ok).toBe(false);
  });

  it("reinicia el contador al día siguiente", async () => {
    const store = new MemoryStore();
    await checkLimit("1.1.1.1", "verify", { store, limit: 1, now: new Date("2026-11-20T23:00:00Z") });
    const next = await checkLimit("1.1.1.1", "verify", { store, limit: 1, now: new Date("2026-11-21T01:00:00Z") });
    expect(next.ok).toBe(true);
  });

  it("MemoryStore caduca las claves", async () => {
    let t = 0;
    const store = new MemoryStore(() => t);
    expect(await store.incr("k", 10)).toBe(1);
    expect(await store.incr("k", 10)).toBe(2);
    t = 11_000;
    expect(await store.incr("k", 10)).toBe(1);
  });

  it("lee los límites de las variables de entorno con valores por defecto", () => {
    expect(limitFor("verify", { LIMIT_VERIFY_PER_DAY: "120" })).toBe(120);
    expect(limitFor("verify", { LIMIT_VERIFY_PER_DAY: "abc" })).toBe(150);
    expect(limitFor("transcribe", {})).toBe(8);
    expect(limitFor("upload", {})).toBe(12);
  });

  it("obtiene la IP del cliente detrás del proxy", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
