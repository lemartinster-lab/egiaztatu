"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useMemo, useRef, useState } from "react";
import { ClaimCard, type ClaimStatus } from "./ClaimCard";
import { SpeakerSummary } from "./SpeakerSummary";
import { MAX_AUDIO_MINUTES, MAX_UPLOAD_BYTES } from "@/lib/limits";
import { parseTranscriptText, renameSpeakers } from "@/lib/parse";
import { buildMarkdownReport, summarizeBySpeaker } from "@/lib/report";
import type { Claim, Segment, VerificationResult } from "@/lib/types";

type Mode = "texto" | "audio";
type Phase =
  | "entrada"
  | "subiendo"
  | "transcribiendo"
  | "nombres"
  | "extrayendo"
  | "resultados";

const CONCURRENCY = 3;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/** Duración de un audio/vídeo local, leyendo solo sus metadatos. */
function mediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) ? el.duration : null);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

export function Egiaztatu() {
  const [mode, setMode] = useState<Mode>("texto");
  const [phase, setPhase] = useState<Phase>("entrada");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const [claims, setClaims] = useState<Claim[]>([]);
  const [results, setResults] = useState<Record<string, VerificationResult>>({});
  const [statuses, setStatuses] = useState<Record<string, ClaimStatus>>({});
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(true);
  const [copied, setCopied] = useState(false);
  const runId = useRef(0);

  const busy = phase === "subiendo" || phase === "transcribiendo" || phase === "extrayendo";

  /* ---------------- verificación en paralelo (máx. 3 a la vez) ---------------- */

  const verifyOne = useCallback(
    async (c: Claim, run: number) => {
      setStatuses((s) => ({ ...s, [c.id]: "verificando" }));
      try {
        const r = await postJson<VerificationResult>("/api/verify", {
          id: c.id,
          checkable: c.checkable,
          quote: c.quote,
          date: date || undefined,
        });
        if (run !== runId.current) return;
        setResults((s) => ({ ...s, [c.id]: r }));
        setStatuses((s) => ({ ...s, [c.id]: "hecho" }));
      } catch (e) {
        if (run !== runId.current) return;
        const msg = e instanceof Error ? e.message : "Error desconocido";
        setStatuses((s) => ({ ...s, [c.id]: "error" }));
        setClaimErrors((s) => ({ ...s, [c.id]: msg }));
        // Errores de configuración o cuota afectan a todo: se muestran arriba.
        if (/clave|saldo|cuota|límite diario|modelo|permiso/i.test(msg)) setError(msg);
      }
    },
    [date],
  );

  const verifyAll = useCallback(
    async (list: Claim[]) => {
      const run = ++runId.current;
      const queue = list.filter((c) => c.type === "hecho");
      const worker = async () => {
        while (queue.length && run === runId.current) {
          const c = queue.shift();
          if (c) await verifyOne(c, run);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    },
    [verifyOne],
  );

  /* ---------------- flujo principal ---------------- */

  async function extract(segs: Segment[]) {
    setPhase("extrayendo");
    const { claims: found } = await postJson<{ claims: Claim[] }>("/api/extract", {
      segments: segs,
    });
    if (found.length === 0) {
      throw new Error("No se han encontrado afirmaciones en el texto.");
    }
    setClaims(found);
    setResults({});
    setStatuses(
      Object.fromEntries(
        found.map((c) => [c.id, (c.type === "hecho" ? "pendiente" : "hecho") as ClaimStatus]),
      ),
    );
    setPhase("resultados");
    void verifyAll(found);
  }

  async function start() {
    setError(null);
    try {
      if (mode === "texto") {
        const segs = parseTranscriptText(text);
        if (segs.length === 0) throw new Error("Pega primero la transcripción del debate.");
        setSegments(segs);
        await extract(segs);
        return;
      }

      if (!file) throw new Error("Elige primero un archivo de audio o vídeo.");
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error("El archivo supera los 300 MB. Prueba con un audio comprimido (MP3 o M4A).");
      }
      const secs = await mediaDuration(file);
      if (secs && secs > MAX_AUDIO_MINUTES * 60) {
        throw new Error(`El audio dura más de ${MAX_AUDIO_MINUTES} minutos. Recórtalo antes de subirlo.`);
      }

      setPhase("subiendo");
      setUploadPct(0);
      const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const blob = await upload(`debates/${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: file.size > 50 * 1024 * 1024,
        onUploadProgress: (p) => setUploadPct(Math.round(p.percentage)),
      });

      setPhase("transcribiendo");
      const t = await postJson<{ segments: Segment[] }>("/api/transcribe", { url: blob.url });
      setSegments(t.segments);
      const speakers = [...new Set(t.segments.map((s) => s.speaker))];
      setNames(Object.fromEntries(speakers.map((s) => [s, ""])));
      setPhase("nombres");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ha ocurrido un error inesperado.");
      setPhase((p) => (p === "nombres" ? p : "entrada"));
    }
  }

  async function confirmNames() {
    setError(null);
    try {
      await extract(renameSpeakers(segments, names));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ha ocurrido un error inesperado.");
      setPhase("nombres");
    }
  }

  function reset() {
    runId.current++;
    setPhase("entrada");
    setClaims([]);
    setResults({});
    setStatuses({});
    setClaimErrors({});
    setSegments([]);
    setNames({});
    setFile(null);
    setError(null);
  }

  /* ---------------- datos derivados ---------------- */

  const summary = useMemo(() => summarizeBySpeaker(claims, results), [claims, results]);
  const facts = claims.filter((c) => c.type === "hecho");
  const doneCount = facts.filter((c) => statuses[c.id] === "hecho" || statuses[c.id] === "error").length;
  const visible = showAll ? claims : facts;

  async function copyReport() {
    const md = buildMarkdownReport({ title, date }, claims, results);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const speakerSamples = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of segments) {
      if (!out[s.speaker]) out[s.speaker] = s.text.slice(0, 160);
    }
    return out;
  }, [segments]);

  /* ---------------- render ---------------- */

  return (
    <div className="stack">
      {error && (
        <div className="card error" role="alert">
          {error}
        </div>
      )}

      {(phase === "entrada" || busy) && phase !== "extrayendo" && (
        <section className="card">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "texto"}
              className={mode === "texto" ? "tab active" : "tab"}
              onClick={() => setMode("texto")}
              disabled={busy}
            >
              Pegar transcripción
            </button>
            <button
              role="tab"
              aria-selected={mode === "audio"}
              className={mode === "audio" ? "tab active" : "tab"}
              onClick={() => setMode("audio")}
              disabled={busy}
            >
              Subir audio o vídeo
            </button>
          </div>

          <div className="row">
            <label className="field grow">
              <span>Título del debate (opcional)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Debate electoral en RTVE"
                maxLength={120}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>Fecha del debate</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </label>
          </div>
          <p className="muted small">
            La fecha es importante: las cifras se comparan con los datos que existían ese día.
          </p>

          {mode === "texto" ? (
            <label className="field">
              <span>Transcripción</span>
              <textarea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                placeholder={
                  "Escribe cada intervención con el nombre delante, así:\n\nMODERADORA: Bienvenidos al debate…\nAna López: El paro ha bajado un 20 % en esta legislatura.\nLuis García: Eso no es cierto, hay más parados que nunca."
                }
              />
            </label>
          ) : (
            <label className="field">
              <span>
                Archivo de audio o vídeo (máx. 300 MB y {MAX_AUDIO_MINUTES} minutos)
              </span>
              <input
                type="file"
                accept="audio/*,video/mp4,video/webm,video/quicktime"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
              <span className="muted small">
                El archivo se borra en cuanto termina la transcripción.
              </span>
            </label>
          )}

          {phase === "subiendo" && (
            <p className="status">Subiendo archivo… {uploadPct} %</p>
          )}
          {phase === "transcribiendo" && (
            <p className="status">Transcribiendo y separando a los hablantes… puede tardar unos minutos.</p>
          )}

          <button className="primary" onClick={start} disabled={busy}>
            {busy ? "Procesando…" : "Verificar debate"}
          </button>
        </section>
      )}

      {phase === "nombres" && (
        <section className="card">
          <h2>¿Quién es quién?</h2>
          <p className="muted">
            Hemos detectado {Object.keys(names).length} voces. Escribe el nombre de cada una
            (puedes dejar en blanco las que no sepas).
          </p>
          {Object.keys(names).map((sp) => (
            <label key={sp} className="field">
              <span>{sp}</span>
              <span className="sample">“{speakerSamples[sp]}…”</span>
              <input
                value={names[sp]}
                onChange={(e) => setNames((n) => ({ ...n, [sp]: e.target.value }))}
                placeholder="Nombre del interviniente"
                maxLength={60}
              />
            </label>
          ))}
          <div className="row">
            <button className="primary" onClick={confirmNames}>
              Buscar afirmaciones
            </button>
            <button className="secondary" onClick={reset}>
              Empezar de nuevo
            </button>
          </div>
        </section>
      )}

      {phase === "extrayendo" && (
        <section className="card">
          <p className="status">Leyendo el debate y localizando las afirmaciones comprobables…</p>
          <div className="progress" />
        </section>
      )}

      {phase === "resultados" && (
        <>
          <section className="card">
            <h2>{title || "Resultados"}</h2>
            <p>
              {claims.length} afirmaciones encontradas, {facts.length} con datos comprobables.
              {facts.length > 0 && ` Verificadas: ${doneCount} de ${facts.length}.`}
            </p>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Mostrar también opiniones y promesas
              </label>
            </div>
            <div className="row">
              <button className="secondary" onClick={copyReport} disabled={doneCount < facts.length}>
                {copied ? "¡Copiado!" : "Copiar informe"}
              </button>
              <button className="secondary" onClick={reset}>
                Verificar otro debate
              </button>
            </div>
          </section>

          <SpeakerSummary data={summary} />

          {visible.map((c) => (
            <ClaimCard
              key={c.id}
              claim={c}
              status={statuses[c.id] ?? "pendiente"}
              result={results[c.id]}
              errorMessage={claimErrors[c.id]}
              onRetry={() => void verifyOne(c, runId.current)}
            />
          ))}
        </>
      )}
    </div>
  );
}
