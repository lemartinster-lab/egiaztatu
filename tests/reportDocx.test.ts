import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocxReport, VERDICT_COLOR } from "@/lib/reportDocx";
import { reportFileName } from "@/lib/storage";
import type { Claim, VerificationResult } from "@/lib/types";

const claims: Claim[] = [
  { id: "c1", speaker: "Ana López", quote: "El Senado tiene 400 senadores", type: "hecho", checkable: "El Senado de España tiene 400 senadores", topic: "instituciones" },
  { id: "c2", speaker: "Luis García", quote: "No se ha ejecutado parte del presupuesto", type: "hecho", checkable: "No se ha ejecutado parte del presupuesto", topic: "vivienda" },
  { id: "c3", speaker: "Luis García", quote: "Bajaremos el IVA", type: "promesa", checkable: "Bajaremos el IVA", topic: "impuestos" },
];

const results: Record<string, VerificationResult> = {
  c1: {
    claimId: "c1",
    verdict: "falso",
    confidence: "alta",
    explanation: "El Senado tiene unos 265 senadores.",
    context: "208 elegidos y el resto designados.",
    sources: [{ url: "https://www.senado.es/web/composicion", title: "Composición del Senado" }],
    downgraded: false,
  },
  c2: {
    claimId: "c2",
    verdict: "impreciso",
    confidence: "media",
    explanation: "No concreta cifra ni periodo.",
    context: "",
    sources: [],
    downgraded: false,
  },
};

async function documentXml(): Promise<{ xml: string; rels: string; bytes: number }> {
  const doc = buildDocxReport({ title: "Debate a cuatro", date: "2026-11-25" }, claims, results);
  const buf = await Packer.toBuffer(doc);
  const files = unzipSync(new Uint8Array(buf));
  return {
    xml: strFromU8(files["word/document.xml"]),
    rels: strFromU8(files["word/_rels/document.xml.rels"]),
    bytes: buf.length,
  };
}

describe("informe en Word (.docx)", () => {
  it("genera un .docx válido (zip con document.xml)", async () => {
    const { xml, bytes } = await documentXml();
    expect(bytes).toBeGreaterThan(1000);
    expect(xml).toContain("<w:document");
  });

  it("incluye título, fecha, aviso de IA y afirmaciones", async () => {
    const { xml } = await documentXml();
    expect(xml).toContain("Debate a cuatro");
    expect(xml).toContain("2026-11-25");
    expect(xml).toContain("inteligencia artificial");
    expect(xml).toContain("El Senado tiene 400 senadores");
    expect(xml).toContain("208 elegidos y el resto designados.");
    expect(xml).toContain("Es una promesa sobre el futuro");
  });

  it("pinta los veredictos con sus colores y resume por interviniente", async () => {
    const { xml } = await documentXml();
    expect(xml).toContain(" Falso ");
    expect(xml).toContain(" Imprecisa ");
    expect(xml).toContain(VERDICT_COLOR.falso);
    expect(xml).toContain(VERDICT_COLOR.impreciso);
    expect(xml).toContain("Resumen por interviniente");
    expect(xml).toContain("<w:tbl>");
  });

  it("las fuentes son enlaces que se pueden pulsar", async () => {
    const { xml, rels } = await documentXml();
    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("Composición del Senado");
    expect(rels).toContain("https://www.senado.es/web/composicion");
  });

  it("nombre de archivo con extensión .docx", () => {
    expect(reportFileName("Debate a cuatro", "2026-11-25", "docx")).toBe(
      "egiaztatu-debate-a-cuatro-2026-11-25.docx",
    );
  });
});
