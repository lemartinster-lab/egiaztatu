"use client";

import type { SpeakerSummary as Summary } from "@/lib/report";
import { VERDICT_LABEL, type Verdict } from "@/lib/types";

const ORDER: Verdict[] = ["verdadero", "enganoso", "falso", "no_verificable"];

export function SpeakerSummary({ data }: { data: Summary[] }) {
  if (data.length === 0) return null;
  return (
    <section className="card">
      <h2>Resumen por interviniente</h2>
      <p className="muted small">
        Solo cuenta los hechos comprobables ya verificados. Un número bajo de
        afirmaciones no permite sacar conclusiones sobre nadie.
      </p>
      <div className="summary-grid">
        {data.map((s) => (
          <div key={s.speaker} className="summary-row">
            <div className="summary-name">
              {s.speaker} <span className="muted small">({s.total})</span>
            </div>
            <div className="bar" role="img" aria-label={`Veredictos de ${s.speaker}`}>
              {ORDER.map((v) =>
                s.counts[v] > 0 ? (
                  <span
                    key={v}
                    className={`bar-seg badge-${v}`}
                    style={{ flexGrow: s.counts[v] }}
                    title={`${VERDICT_LABEL[v]}: ${s.counts[v]}`}
                  >
                    {s.counts[v]}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="legend small">
        {ORDER.map((v) => (
          <span key={v}>
            <i className={`dot badge-${v}`} /> {VERDICT_LABEL[v]}
          </span>
        ))}
      </div>
    </section>
  );
}
