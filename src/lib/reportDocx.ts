import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { summarizeBySpeaker } from "./report";
import {
  CLAIM_TYPE_LABEL,
  VERDICT_LABEL,
  type Claim,
  type DebateContext,
  type VerificationResult,
  type Verdict,
} from "./types";

/** Mismos colores que la app (sin «#», como los pide Word). */
export const VERDICT_COLOR: Record<Verdict, string> = {
  verdadero: "1E7A46",
  enganoso: "B7791F",
  falso: "B42318",
  impreciso: "6D5BD0",
  no_verificable: "6B7280",
};
const NEUTRAL = "4B5563";
const MUTED = "5F6B67";
const ORDER: Verdict[] = ["verdadero", "enganoso", "falso", "impreciso", "no_verificable"];

const FONT = "Calibri";

function para(text: string, opts: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: opts.size ?? 22, ...opts })],
  });
}

/** Etiqueta de color tipo «semáforo»: texto blanco sobre fondo del veredicto. */
function badge(label: string, color: string) {
  return new TextRun({
    text: ` ${label} `,
    bold: true,
    color: "FFFFFF",
    font: FONT,
    size: 20,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: color },
  });
}

function cell(text: string, opts: { bold?: boolean; fill?: string; color?: string } = {}) {
  return new TableCell({
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, bold: opts.bold, color: opts.color, font: FONT, size: 20 }),
        ],
      }),
    ],
  });
}

function summaryTable(claims: Claim[], results: Record<string, VerificationResult | undefined>) {
  const summary = summarizeBySpeaker(claims, results);
  if (summary.length === 0) return [];
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell("Interviniente", { bold: true, fill: "E8ECE9" }),
      cell("Datos", { bold: true, fill: "E8ECE9" }),
      ...ORDER.map((v) => cell(VERDICT_LABEL[v], { bold: true, fill: VERDICT_COLOR[v], color: "FFFFFF" })),
    ],
  });
  const rows = summary.map(
    (s) =>
      new TableRow({
        children: [
          cell(s.speaker, { bold: true }),
          cell(String(s.total)),
          ...ORDER.map((v) => cell(s.counts[v] ? String(s.counts[v]) : "–")),
        ],
      }),
  );
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Resumen por interviniente", font: FONT })] }),
    para(
      "Solo cuenta los hechos comprobables ya verificados; las imprecisas no cuentan como verdaderas. Un número bajo de afirmaciones no permite sacar conclusiones sobre nadie.",
      { italics: true, color: MUTED, size: 20 },
    ),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }),
  ];
}

function claimBlock(c: Claim, r: VerificationResult | undefined) {
  const isFact = c.type === "hecho";
  const label = isFact ? (r ? VERDICT_LABEL[r.verdict] : "Sin verificar") : CLAIM_TYPE_LABEL[c.type];
  const color = isFact && r ? VERDICT_COLOR[r.verdict] : NEUTRAL;

  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 240, after: 80 },
      children: [
        badge(label, color),
        new TextRun({ text: `  ${c.speaker}`, bold: true, font: FONT }),
        ...(c.topic ? [new TextRun({ text: `  · ${c.topic}`, color: MUTED, font: FONT, size: 20 })] : []),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color, space: 8 } },
      children: [new TextRun({ text: `“${c.quote}”`, italics: true, font: FONT, size: 22 })],
    }),
  ];

  if (isFact && c.checkable && c.checkable !== c.quote) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: "Lo que se comprueba: ", bold: true, color: MUTED, font: FONT, size: 20 }),
          new TextRun({ text: c.checkable, color: MUTED, font: FONT, size: 20 }),
        ],
      }),
    );
  }

  if (!isFact) {
    out.push(
      para(
        c.type === "opinion"
          ? "Es una opinión o valoración: no se verifica con datos."
          : "Es una promesa sobre el futuro: no se puede verificar hoy.",
        { color: MUTED, size: 20 },
      ),
    );
    return out;
  }

  if (!r) return out;

  out.push(para(r.explanation));
  if (r.context) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: "Contexto: ", bold: true, font: FONT, size: 22 }),
          new TextRun({ text: r.context, font: FONT, size: 22 }),
        ],
      }),
    );
  }
  const conf = { alta: "Confianza alta", media: "Confianza media", baja: "Confianza baja" }[r.confidence];
  out.push(
    para(
      conf +
        (r.downgraded
          ? " · La IA propuso un veredicto, pero no aportó fuentes comprobables, así que se marca como no verificable."
          : ""),
      { color: MUTED, size: 18 },
    ),
  );
  if (r.sources.length) {
    out.push(para("Fuentes:", { bold: true, size: 20 }));
    for (const s of r.sources) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new ExternalHyperlink({
              link: s.url,
              children: [new TextRun({ text: s.title || s.url, style: "Hyperlink", font: FONT, size: 20 })],
            }),
          ],
        }),
      );
    }
  }
  return out;
}

/** Informe en formato Word (.docx), con los mismos contenidos que el Markdown. */
export function buildDocxReport(
  ctx: DebateContext,
  claims: Claim[],
  results: Record<string, VerificationResult | undefined>,
): Document {
  const facts = claims.filter((c) => c.type === "hecho");
  return new Document({
    creator: "Egiaztatu",
    title: ctx.title?.trim() || "Verificación de debate",
    description: "Verificación de afirmaciones generada con inteligencia artificial",
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: ctx.title?.trim() || "Verificación de debate", font: FONT })],
          }),
          para(
            ["Egiaztatu", ctx.date ? `Fecha del debate: ${ctx.date}` : ""].filter(Boolean).join(" · "),
            { color: MUTED },
          ),
          para(
            `${claims.length} afirmaciones analizadas, ${facts.length} con datos comprobables.`,
          ),
          para(
            "Verificación generada con inteligencia artificial. Es orientativa y puede contener errores: revisa siempre las fuentes enlazadas.",
            { italics: true, color: MUTED, size: 20 },
          ),
          ...summaryTable(claims, results),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 360 },
            children: [new TextRun({ text: "Afirmaciones", font: FONT })],
          }),
          ...claims.flatMap((c) => claimBlock(c, results[c.id])),
        ],
      },
    ],
  });
}
