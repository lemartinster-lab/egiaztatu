import {
  CLAIM_TYPE_LABEL,
  VERDICT_LABEL,
  type Claim,
  type DebateContext,
  type VerificationResult,
  type Verdict,
} from "./types";

export interface SpeakerSummary {
  speaker: string;
  total: number;
  counts: Record<Verdict, number>;
}

/** Recuento de veredictos por interviniente (solo hechos verificados). */
export function summarizeBySpeaker(
  claims: Claim[],
  results: Record<string, VerificationResult | undefined>,
): SpeakerSummary[] {
  const map = new Map<string, SpeakerSummary>();
  for (const c of claims) {
    if (c.type !== "hecho") continue;
    const r = results[c.id];
    if (!r) continue;
    let s = map.get(c.speaker);
    if (!s) {
      s = {
        speaker: c.speaker,
        total: 0,
        counts: { verdadero: 0, enganoso: 0, falso: 0, impreciso: 0, no_verificable: 0 },
      };
      map.set(c.speaker, s);
    }
    s.total += 1;
    s.counts[r.verdict] += 1;
  }
  return [...map.values()].sort((a, b) => a.speaker.localeCompare(b.speaker, "es"));
}

/** Informe en Markdown para copiar y compartir. */
export function buildMarkdownReport(
  ctx: DebateContext,
  claims: Claim[],
  results: Record<string, VerificationResult | undefined>,
): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.title?.trim() || "Verificación de debate"} — Egiaztatu`);
  if (ctx.date) lines.push(`Fecha del debate: ${ctx.date}`);
  lines.push(
    "",
    "> Verificación generada con inteligencia artificial. Es orientativa: revisa siempre las fuentes enlazadas.",
    "",
  );

  const summary = summarizeBySpeaker(claims, results);
  if (summary.length) {
    lines.push("## Resumen por interviniente", "");
    for (const s of summary) {
      const parts = (Object.keys(s.counts) as Verdict[])
        .filter((v) => s.counts[v] > 0)
        .map((v) => `${VERDICT_LABEL[v]}: ${s.counts[v]}`);
      lines.push(`- **${s.speaker}** (${s.total} datos): ${parts.join(" · ")}`);
    }
    lines.push("");
  }

  lines.push("## Afirmaciones", "");
  for (const c of claims) {
    const r = results[c.id];
    const label =
      c.type === "hecho" ? (r ? VERDICT_LABEL[r.verdict] : "Sin verificar") : CLAIM_TYPE_LABEL[c.type];
    lines.push(`### ${label} — ${c.speaker}`, `"${c.quote}"`, "");
    if (r) {
      lines.push(r.explanation);
      if (r.context) lines.push("", `Contexto: ${r.context}`);
      if (r.sources.length) {
        lines.push("", "Fuentes:");
        for (const s of r.sources) lines.push(`- [${s.title}](${s.url})`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
