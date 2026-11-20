import { describe, expect, it } from "vitest";
import { normalizeClaims, normalizeNewsMeta, validateNewsInput } from "@/lib/parse";
import { buildMarkdownReport } from "@/lib/report";

describe("validateNewsInput", () => {
  it("acepta un enlace válido y lo normaliza", () => {
    const v = validateNewsInput({ mode: "url", url: "  https://www.ejemplo.es/noticia?id=1 " });
    expect(v).toEqual({ ok: true, input: { mode: "url", url: "https://www.ejemplo.es/noticia?id=1" } });
  });

  it("rechaza enlaces raros o peligrosos", () => {
    expect(validateNewsInput({ mode: "url", url: "no es un enlace" }).ok).toBe(false);
    expect(validateNewsInput({ mode: "url", url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateNewsInput({ mode: "url", url: "file:///etc/passwd" }).ok).toBe(false);
    expect(validateNewsInput({ mode: "url", url: "https://a.es/" + "x".repeat(2100) }).ok).toBe(false);
  });

  it("texto: exige contenido y limita el tamaño", () => {
    expect(validateNewsInput({ mode: "text", text: "corto" }).ok).toBe(false);
    expect(validateNewsInput({ mode: "text", text: "x".repeat(70_000) }).ok).toBe(false);
    expect(validateNewsInput({ mode: "text", text: "El paro bajó un 5 % en octubre según el SEPE." }).ok).toBe(true);
  });

  it("capturas: tipo, tamaño, número y base64 válido (quitando el prefijo data:)", () => {
    const ok = validateNewsInput({
      mode: "image",
      images: [{ mediaType: "image/jpeg", data: "data:image/jpeg;base64,QUJD" }],
    });
    expect(ok).toEqual({ ok: true, input: { mode: "image", images: [{ mediaType: "image/jpeg", data: "QUJD" }] } });

    expect(validateNewsInput({ mode: "image", images: [] }).ok).toBe(false);
    expect(validateNewsInput({ mode: "image", images: [{ mediaType: "image/bmp", data: "QUJD" }] }).ok).toBe(false);
    expect(validateNewsInput({ mode: "image", images: [{ mediaType: "image/png", data: "no<base64>" }] }).ok).toBe(false);
    expect(
      validateNewsInput({ mode: "image", images: [{ mediaType: "image/png", data: "A".repeat(4_000_001) }] }).ok,
    ).toBe(false);
    const four = Array.from({ length: 4 }, () => ({ mediaType: "image/png", data: "QUJD" }));
    expect(validateNewsInput({ mode: "image", images: four }).ok).toBe(false);
  });

  it("rechaza modos desconocidos o cuerpo vacío", () => {
    expect(validateNewsInput(null).ok).toBe(false);
    expect(validateNewsInput({ mode: "video" }).ok).toBe(false);
  });
});

describe("normalizeNewsMeta y origen de las afirmaciones", () => {
  it("limpia los metadatos y descarta fechas mal formadas", () => {
    expect(normalizeNewsMeta({ title: " Titular ", outlet: "El Diario", author: 3, published: "20/11/2026" })).toEqual({
      title: "Titular",
      outlet: "El Diario",
      author: "",
      published: "",
    });
    expect(normalizeNewsMeta({ published: "2026-11-20" }).published).toBe("2026-11-20");
    expect(normalizeNewsMeta(undefined).title).toBe("");
  });

  it("conserva el origen válido (titular, autor, cita) e ignora el resto", () => {
    const claims = normalizeClaims({
      claims: [
        { origin: "titular", speaker: "Titular", quote: "El paro se dispara", type: "hecho" },
        { origin: "cita", speaker: "Consejera de Empleo", quote: "Hemos creado 10.000 empleos", type: "hecho" },
        { origin: "rumor", speaker: "X", quote: "Algo", type: "hecho" },
      ],
    });
    expect(claims.map((c) => c.origin)).toEqual(["titular", "cita", undefined]);
    expect("origin" in claims[2]).toBe(false);
  });

  it("el informe muestra la fuente analizada", () => {
    const md = buildMarkdownReport({ title: "Noticia", source: "El Diario · publicado el 2026-11-20" }, [], {});
    expect(md).toContain("Fuente analizada: El Diario · publicado el 2026-11-20");
  });
});
