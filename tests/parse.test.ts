import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  normalizeClaims,
  normalizeUrl,
  normalizeVerification,
  parseTranscriptText,
  renameSpeakers,
  scribeWordsToSegments,
  speakerLabel,
} from "@/lib/parse";
import { buildMarkdownReport, summarizeBySpeaker } from "@/lib/report";
import type { Claim, VerificationResult } from "@/lib/types";

describe("extractJsonObject", () => {
  it("lee JSON limpio", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("lee JSON dentro de un bloque ```json", () => {
    expect(extractJsonObject('Aquí va:\n```json\n{"verdict":"falso"}\n```\nFin')).toEqual({
      verdict: "falso",
    });
  });
  it("lee JSON rodeado de texto", () => {
    expect(extractJsonObject('Tras buscar... {"x": [1,2]} gracias')).toEqual({ x: [1, 2] });
  });
  it("lanza error si no hay JSON", () => {
    expect(() => extractJsonObject("sin datos")).toThrow();
  });
});

describe("parseTranscriptText", () => {
  it("separa por hablante y une líneas sueltas al anterior", () => {
    const segs = parseTranscriptText(
      "MODERADORA: Bienvenidos.\nAna López: El paro ha bajado.\nY mucho.\nLuis García: Falso.",
    );
    expect(segs).toEqual([
      { speaker: "Moderadora", text: "Bienvenidos." },
      { speaker: "Ana López", text: "El paro ha bajado. Y mucho." },
      { speaker: "Luis García", text: "Falso." },
    ]);
  });
  it("une intervenciones seguidas del mismo hablante", () => {
    const segs = parseTranscriptText("Ana: Uno.\nAna: Dos.");
    expect(segs).toEqual([{ speaker: "Ana", text: "Uno. Dos." }]);
  });
  it("usa 'Interviniente' si el texto no tiene nombres", () => {
    expect(parseTranscriptText("el paro ha bajado un 20 %")).toEqual([
      { speaker: "Interviniente", text: "el paro ha bajado un 20 %" },
    ]);
  });
  it("ignora líneas vacías", () => {
    expect(parseTranscriptText("\n\n  \n")).toEqual([]);
  });
});

describe("ElevenLabs Scribe", () => {
  it("nombra a los hablantes empezando por 1", () => {
    expect(speakerLabel("speaker_0")).toBe("Hablante 1");
    expect(speakerLabel("speaker_2")).toBe("Hablante 3");
    expect(speakerLabel(undefined)).toBe("Hablante");
  });

  it("agrupa palabras por hablante y descarta eventos de audio", () => {
    const segs = scribeWordsToSegments([
      { text: "Hola", type: "word", speaker_id: "speaker_0", start: 0 },
      { text: " ", type: "spacing", speaker_id: "speaker_0" },
      { text: "a", type: "word", speaker_id: "speaker_0" },
      { text: " ", type: "spacing", speaker_id: "speaker_0" },
      { text: "todos.", type: "word", speaker_id: "speaker_0" },
      { text: "(aplausos)", type: "audio_event", speaker_id: "speaker_1" },
      { text: " ", type: "spacing", speaker_id: "speaker_1" },
      { text: "Gracias.", type: "word", speaker_id: "speaker_1", start: 3.2 },
    ]);
    expect(segs).toEqual([
      { speaker: "Hablante 1", text: "Hola a todos.", start: 0 },
      { speaker: "Hablante 2", text: "Gracias.", start: 3.2 },
    ]);
  });

  it("renombra hablantes y deja los que quedan en blanco", () => {
    const out = renameSpeakers(
      [
        { speaker: "Hablante 1", text: "a" },
        { speaker: "Hablante 2", text: "b" },
      ],
      { "Hablante 1": "Ana López", "Hablante 2": "  " },
    );
    expect(out.map((s) => s.speaker)).toEqual(["Ana López", "Hablante 2"]);
  });
});

describe("normalizeClaims", () => {
  it("valida, asigna ids y corrige tipos desconocidos", () => {
    const claims = normalizeClaims({
      claims: [
        { speaker: "Ana", quote: "El paro bajó un 20 %", type: "hecho", checkable: "El paro registrado en España bajó un 20 %", topic: "empleo" },
        { speaker: "Luis", quote: "Es un desastre", type: "rarisimo" },
        { speaker: "Luis", quote: "" },
        "basura",
      ],
    });
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ id: "c1", type: "hecho", topic: "empleo" });
    expect(claims[1]).toMatchObject({ id: "c2", type: "opinion", checkable: "Es un desastre" });
  });
  it("devuelve lista vacía si la entrada no es válida", () => {
    expect(normalizeClaims(null)).toEqual([]);
    expect(normalizeClaims({ claims: "no" })).toEqual([]);
  });
  it("limita a 40 afirmaciones", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ quote: `dato ${i}`, type: "hecho" }));
    expect(normalizeClaims({ claims: many })).toHaveLength(40);
  });
});

describe("normalizeVerification (regla: sin fuente no hay veredicto)", () => {
  const retrieved = [
    { url: "https://www.ine.es/prensa/epa_tabla.htm", title: "EPA - INE" },
    { url: "https://www.sepe.es/paro/", title: "Paro registrado - SEPE" },
  ];

  it("acepta fuentes que el buscador devolvió de verdad (normalizando la URL)", () => {
    const r = normalizeVerification(
      {
        verdict: "falso",
        confidence: "alta",
        explanation: "El dato real es otro.",
        sources: [{ url: "https://ine.es/prensa/epa_tabla.htm#t1" }, "https://www.sepe.es/paro"],
      },
      "c1",
      retrieved,
    );
    expect(r.verdict).toBe("falso");
    expect(r.downgraded).toBe(false);
    expect(r.sources).toEqual(retrieved);
  });

  it("descarta URLs inventadas y rebaja el veredicto a no verificable", () => {
    const r = normalizeVerification(
      { verdict: "verdadero", confidence: "alta", explanation: "x", sources: [{ url: "https://inventada.es/dato" }] },
      "c2",
      retrieved,
    );
    expect(r.sources).toEqual([]);
    expect(r.verdict).toBe("no_verificable");
    expect(r.confidence).toBe("baja");
    expect(r.downgraded).toBe(true);
  });

  it("corrige veredictos y confianzas desconocidos", () => {
    const r = normalizeVerification({ verdict: "medio cierto", confidence: "total" }, "c3", []);
    expect(r.verdict).toBe("no_verificable");
    expect(r.confidence).toBe("baja");
    expect(r.downgraded).toBe(false);
    expect(r.explanation.length).toBeGreaterThan(0);
  });

  it("no duplica fuentes", () => {
    const r = normalizeVerification(
      { verdict: "verdadero", sources: [retrieved[0].url, retrieved[0].url] },
      "c4",
      retrieved,
    );
    expect(r.sources).toHaveLength(1);
  });

  it("normalizeUrl ignora www, # y barra final", () => {
    expect(normalizeUrl("https://www.INE.es/a/#x")).toBe(normalizeUrl("https://ine.es/a"));
  });
});

describe("informe", () => {
  const claims: Claim[] = [
    { id: "c1", speaker: "Ana", quote: "dato 1", type: "hecho", checkable: "dato 1", topic: "" },
    { id: "c2", speaker: "Ana", quote: "dato 2", type: "hecho", checkable: "dato 2", topic: "" },
    { id: "c3", speaker: "Luis", quote: "opinión", type: "opinion", checkable: "opinión", topic: "" },
  ];
  const base = { confidence: "alta" as const, explanation: "e", context: "", downgraded: false };
  const results: Record<string, VerificationResult> = {
    c1: { ...base, claimId: "c1", verdict: "falso", sources: [{ url: "https://ine.es", title: "INE" }] },
    c2: { ...base, claimId: "c2", verdict: "verdadero", sources: [] },
  };

  it("resume solo hechos verificados por hablante", () => {
    const s = summarizeBySpeaker(claims, results);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ speaker: "Ana", total: 2 });
    expect(s[0].counts).toMatchObject({ falso: 1, verdadero: 1 });
  });

  it("genera Markdown con aviso, veredictos y fuentes", () => {
    const md = buildMarkdownReport({ title: "Debate de prueba", date: "2026-11-20" }, claims, results);
    expect(md).toContain("# Debate de prueba — Egiaztatu");
    expect(md).toContain("inteligencia artificial");
    expect(md).toContain("### Falso — Ana");
    expect(md).toContain("[INE](https://ine.es)");
    expect(md).toContain("### Opinión — Luis");
  });
});
