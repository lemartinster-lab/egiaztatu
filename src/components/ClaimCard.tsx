"use client";

import {
  CLAIM_TYPE_LABEL,
  VERDICT_LABEL,
  type Claim,
  type VerificationResult,
} from "@/lib/types";

export type ClaimStatus = "pendiente" | "verificando" | "hecho" | "error";

const CONFIDENCE_LABEL = { alta: "Confianza alta", media: "Confianza media", baja: "Confianza baja" };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ClaimCard({
  claim,
  status,
  result,
  onRetry,
}: {
  claim: Claim;
  status: ClaimStatus;
  result?: VerificationResult;
  onRetry?: () => void;
}) {
  const isFact = claim.type === "hecho";
  const tone = isFact ? (result ? result.verdict : "pendiente") : "neutro";
  const badge = !isFact
    ? CLAIM_TYPE_LABEL[claim.type]
    : result
      ? VERDICT_LABEL[result.verdict]
      : status === "verificando"
        ? "Verificando…"
        : status === "error"
          ? "Error"
          : "En cola";

  return (
    <article className={`card claim tone-${tone}`}>
      <header className="claim-head">
        <span className={`badge badge-${tone}`}>{badge}</span>
        <span className="speaker">{claim.speaker}</span>
        {claim.topic && <span className="topic">{claim.topic}</span>}
      </header>

      <blockquote>“{claim.quote}”</blockquote>

      {isFact && claim.checkable !== claim.quote && (
        <p className="checkable">
          <strong>Lo que se comprueba:</strong> {claim.checkable}
        </p>
      )}

      {!isFact && (
        <p className="muted small">
          {claim.type === "opinion"
            ? "Es una opinión o valoración: no se verifica con datos."
            : "Es una promesa sobre el futuro: no se puede verificar hoy."}
        </p>
      )}

      {status === "verificando" && <div className="progress" aria-label="Verificando" />}

      {status === "error" && (
        <p className="error small">
          No se pudo verificar.{" "}
          {onRetry && (
            <button type="button" className="link" onClick={onRetry}>
              Reintentar
            </button>
          )}
        </p>
      )}

      {result && (
        <div className="result">
          <p>{result.explanation}</p>
          {result.context && (
            <p className="context">
              <strong>Contexto:</strong> {result.context}
            </p>
          )}
          <p className="muted small">
            {CONFIDENCE_LABEL[result.confidence]}
            {result.downgraded &&
              " · La IA propuso un veredicto, pero no aportó fuentes comprobables, así que se marca como no verificable."}
          </p>
          {result.sources.length > 0 && (
            <ul className="sources">
              {result.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>{" "}
                  <span className="muted small">({hostOf(s.url)})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
