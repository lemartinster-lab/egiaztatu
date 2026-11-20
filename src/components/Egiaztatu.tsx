"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClaimCard, type ClaimStatus } from "./ClaimCard";
import { SpeakerSummary } from "./SpeakerSummary";
import { MAX_AUDIO_MINUTES, MAX_AUDIO_PARTS, MAX_UPLOAD_BYTES } from "@/lib/limits";
import {
  chunkSegments,
  claimsPerChunk,
  mergeClaimLists,
  parseTranscriptText,
  renameSpeakers,
} from "@/lib/parse";
import { buildMarkdownReport, summarizeBySpeaker } from "@/lib/report";
import {
  clearSession,
  loadSession,
  reportFileName,
  saveSession,
} from "@/lib/storage";
import type { Claim, NewsMeta, Segment, VerificationResult } from "@/lib/types";

type Mode = "texto" | "audio" | "noticia";
type NewsMode = "url" | "text" | "image";
const MAX_SCREENSHOTS = 3;
type Phase =
  | "entrada"
  | "subiendo"
  | "transcribiendo"
  | "nombres"
  | "extrayendo"
  | "resultados";

const CONCURRENCY = 3;
const EXTRACT_CONCURRENCY = 2;

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

/**
 * Reduce una captura a JPEG de tamaño razonable antes de enviarla: las fotos
 * del móvil pesan mucho y la IA no necesita más de ~2000 px de lado.
 */
async function screenshotToBase64(file: File): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se ha podido procesar la imagen.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

function metaLine(m: NewsMeta): string {
  return [m.outlet, m.author, m.published && `publicado el ${m.published}`]
    .filter(Boolean)
    .join(" · ");
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/** localStorage solo existe en el navegador y puede estar bloqueado. */
function browserStore() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function Egiaztatu() {
  const [mode, setMode] = useState<Mode>("texto");
  const [phase, setPhase] = useState<Phase>("entrada");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [newsMode, setNewsMode] = useState<NewsMode>("url");
  const [newsUrl, setNewsUrl] = useState("");
  const [newsText, setNewsText] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const [segments, setSegments] = useState<Segment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const [claims, setClaims] = useState<Claim[]>([]);
  const [results, setResults] = useState<Record<string, VerificationResult>>({});
  const [statuses, setStatuses] = useState<Record<string, ClaimStatus>>({});
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [makingDocx, setMakingDocx] = useState(false);
  const [restored, setRestored] = useState(false);

  const runId = useRef(0);
  const dateRef = useRef(date);
  dateRef.current = date;
  /** Partes de audio ya transcritas: si una falla, al reintentar no se repiten (ni se pagan) las anteriores. */
  const doneParts = useRef(new Map<File, Segment[]>());

  const busy = phase === "subiendo" || phase === "transcribiendo" || phase === "extrayendo";

  /* ---------------- verificación en paralelo (máx. 3 a la vez) ---------------- */

  const verifyOne = useCallback(async (c: Claim, run: number) => {
    setStatuses((s) => ({ ...s, [c.id]: "verificando" }));
    try {
      const r = await postJson<VerificationResult>("/api/verify", {
        id: c.id,
        checkable: c.checkable,
        quote: c.quote,
        date: dateRef.current || undefined,
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
  }, []);

  /** Verifica los hechos de la lista; `skip` permite reanudar sin repetir los ya hechos. */
  const verifyAll = useCallback(
    async (list: Claim[], skip: (c: Claim) => boolean = () => false) => {
      const run = ++runId.current;
      const queue = list.filter((c) => c.type === "hecho" && !skip(c));
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

  /* ---------------- guardar y recuperar la sesión ---------------- */

  // Al abrir la página: recuperar el último debate y reanudar lo pendiente.
  const restoreOnce = useRef(false);
  useEffect(() => {
    if (restoreOnce.current) return; // evita doble ejecución en modo desarrollo
    restoreOnce.current = true;
    const store = browserStore();
    const saved = store ? loadSession(store) : null;
    setRestored(true);
    if (!saved) return;
    setTitle(saved.title);
    setSubtitle(saved.subtitle ?? "");
    setDate(saved.date);
    dateRef.current = saved.date;
    setSegments(saved.segments);
    setNames(saved.names);
    setClaims(saved.claims);
    setResults(saved.results);
    setStatuses(saved.statuses);
    setPhase(saved.phase);
    const when = saved.savedAt ? new Date(saved.savedAt).toLocaleString("es-ES") : "";
    setNotice(`Se ha recuperado el último debate${when ? ` (guardado el ${when})` : ""}.`);
    if (saved.phase === "resultados") {
      void verifyAll(saved.claims, (c) => saved.statuses[c.id] === "hecho" || saved.statuses[c.id] === "error");
    }
  }, [verifyAll]);

  // Guardado automático cada vez que cambia algo importante.
  useEffect(() => {
    if (!restored) return;
    if (phase !== "nombres" && phase !== "resultados") return;
    const store = browserStore();
    if (!store) return;
    saveSession(store, { phase, title, subtitle, date, segments, names, claims, results, statuses });
  }, [restored, phase, title, subtitle, date, segments, names, claims, results, statuses]);

  /* ---------------- flujo principal ---------------- */

  async function extract(segs: Segment[]) {
    setPhase("extrayendo");
    const chunks = chunkSegments(segs);
    const per = claimsPerChunk(chunks.length);
    const lists: Claim[][] = new Array(chunks.length);
    let done = 0;
    setProgress(
      chunks.length > 1
        ? `Analizando el debate por partes (0 de ${chunks.length})…`
        : "Leyendo el debate y localizando las afirmaciones comprobables…",
    );

    const queue = chunks.map((chunk, i) => ({ chunk, i }));
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift();
        if (!job) return;
        const { claims: found } = await postJson<{ claims: Claim[] }>("/api/extract", {
          segments: job.chunk,
          maxClaims: per,
        });
        lists[job.i] = found;
        done++;
        if (chunks.length > 1) {
          setProgress(`Analizando el debate por partes (${done} de ${chunks.length})…`);
        }
      }
    };
    await Promise.all(Array.from({ length: EXTRACT_CONCURRENCY }, worker));

    const merged = mergeClaimLists(lists);
    if (merged.length === 0) {
      throw new Error("No se han encontrado afirmaciones en el texto.");
    }
    showClaims(merged);
  }

  function showClaims(merged: Claim[]) {
    setClaims(merged);
    setResults({});
    setClaimErrors({});
    setStatuses(
      Object.fromEntries(
        merged.map((c) => [c.id, (c.type === "hecho" ? "pendiente" : "hecho") as ClaimStatus]),
      ),
    );
    setSegments([]);
    setPhase("resultados");
    void verifyAll(merged);
  }

  async function analyzeNews() {
    let body: unknown;
    if (newsMode === "url") {
      if (!newsUrl.trim()) throw new Error("Pega primero el enlace de la noticia o publicación.");
      body = { mode: "url", url: newsUrl.trim() };
    } else if (newsMode === "text") {
      body = { mode: "text", text: newsText };
    } else {
      if (shots.length === 0) throw new Error("Sube primero una captura de pantalla.");
      setPhase("extrayendo");
      setProgress("Preparando las capturas…");
      body = { mode: "image", images: await Promise.all(shots.map(screenshotToBase64)) };
    }

    setPhase("extrayendo");
    setProgress(
      newsMode === "url"
        ? "Leyendo la noticia y localizando las afirmaciones…"
        : "Analizando el contenido y localizando las afirmaciones…",
    );
    const r = await postJson<{ meta: NewsMeta; claims: Claim[] }>("/api/extract-news", body);

    // El titular y la fecha de publicación se rellenan solos si no los has puesto.
    if (!title.trim() && r.meta.title) setTitle(r.meta.title);
    if (!date && r.meta.published) {
      setDate(r.meta.published);
      dateRef.current = r.meta.published;
    }
    setSubtitle(metaLine(r.meta));
    showClaims(r.claims);
  }

  async function transcribeParts(): Promise<Segment[]> {
    const all: Segment[] = [];
    let offset = 0;
    const multi = files.length > 1;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const label = multi ? `Parte ${i + 1} de ${files.length}: ` : "";
      const secs = await mediaDuration(file);

      let segs = doneParts.current.get(file);
      if (!segs) {
        setPhase("subiendo");
        setProgress(`${label}subiendo… 0 %`);
        const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const blob = await upload(`debates/${safeName}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          multipart: file.size > 50 * 1024 * 1024,
          onUploadProgress: (p) => setProgress(`${label}subiendo… ${Math.round(p.percentage)} %`),
        });

        setPhase("transcribiendo");
        setProgress(`${label}transcribiendo y separando voces… puede tardar unos minutos.`);
        let t: { segments: Segment[] };
        try {
          t = await postJson<{ segments: Segment[] }>("/api/transcribe", { url: blob.url });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error desconocido";
          throw new Error(multi ? `Parte ${i + 1}: ${msg}` : msg);
        }
        segs = t.segments;
        doneParts.current.set(file, segs);
      }

      for (const s of segs) {
        all.push({
          ...s,
          // Las voces de cada parte se numeran por separado en la transcripción.
          speaker: multi ? `Parte ${i + 1} · ${s.speaker}` : s.speaker,
          start: s.start !== undefined ? s.start + offset : undefined,
        });
      }
      offset += secs ?? 0;
    }
    return all;
  }

  async function start() {
    setError(null);
    setNotice(null);
    try {
      if (mode === "noticia") {
        await analyzeNews();
        return;
      }
      if (mode === "texto") {
        setSubtitle("");
        const segs = parseTranscriptText(text);
        if (segs.length === 0) throw new Error("Pega primero la transcripción del debate.");
        await extract(segs);
        return;
      }

      if (files.length === 0) throw new Error("Elige primero un archivo de audio o vídeo.");
      for (const [i, file] of files.entries()) {
        const name = files.length > 1 ? `La parte ${i + 1}` : "El archivo";
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`${name} supera los 300 MB. Prueba con un audio comprimido (MP3 o M4A).`);
        }
        const secs = await mediaDuration(file);
        if (secs && secs > MAX_AUDIO_MINUTES * 60) {
          throw new Error(
            `${name} dura más de ${MAX_AUDIO_MINUTES} minutos. Divídela en partes más cortas.`,
          );
        }
      }

      const all = await transcribeParts();
      if (all.length === 0) throw new Error("No se ha detectado voz en el audio.");
      setSegments(all);
      const speakers = [...new Set(all.map((s) => s.speaker))];
      setNames(Object.fromEntries(speakers.map((s) => [s, ""])));
      setPhase("nombres");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ha ocurrido un error inesperado.");
      setPhase((p) => (p === "nombres" || p === "resultados" ? p : "entrada"));
    } finally {
      setProgress("");
    }
  }

  async function confirmNames() {
    setError(null);
    try {
      await extract(renameSpeakers(segments, names));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ha ocurrido un error inesperado.");
      setPhase("nombres");
    } finally {
      setProgress("");
    }
  }

  function reset() {
    if (
      phase === "resultados" &&
      !window.confirm(
        "¿Borrar este debate y empezar otro? Si quieres conservarlo, descarga antes el informe.",
      )
    ) {
      return;
    }
    runId.current++;
    const store = browserStore();
    if (store) clearSession(store);
    doneParts.current.clear();
    setPhase("entrada");
    setClaims([]);
    setResults({});
    setStatuses({});
    setClaimErrors({});
    setSegments([]);
    setNames({});
    setFiles([]);
    setShots([]);
    setSubtitle("");
    setError(null);
    setNotice(null);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_AUDIO_PARTS));
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  }

  function moveFile(i: number, dir: -1 | 1) {
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /* ---------------- datos derivados ---------------- */

  const summary = useMemo(() => summarizeBySpeaker(claims, results), [claims, results]);
  const facts = claims.filter((c) => c.type === "hecho");
  const doneCount = facts.filter((c) => statuses[c.id] === "hecho" || statuses[c.id] === "error").length;
  const failed = facts.filter((c) => statuses[c.id] === "error");
  const visible = showAll ? claims : facts;

  function report(): string {
    return buildMarkdownReport({ title, date, source: subtitle || undefined }, claims, results);
  }

  async function copyReport() {
    await navigator.clipboard.writeText(report());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function saveBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadReport() {
    saveBlob(
      new Blob([report()], { type: "text/markdown;charset=utf-8" }),
      reportFileName(title, date, "md"),
    );
  }

  async function downloadDocx() {
    setMakingDocx(true);
    try {
      // Se carga solo al pulsar, para no hacer más pesada la página.
      const [{ Packer }, { buildDocxReport }] = await Promise.all([
        import("docx"),
        import("@/lib/reportDocx"),
      ]);
      const blob = await Packer.toBlob(buildDocxReport({ title, date, source: subtitle || undefined }, claims, results));
      saveBlob(blob, reportFileName(title, date, "docx"));
    } catch (e) {
      console.error(e);
      setError("No se ha podido generar el documento Word.");
    } finally {
      setMakingDocx(false);
    }
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
      {notice && <div className="card notice">{notice}</div>}
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
            <button
              role="tab"
              aria-selected={mode === "noticia"}
              className={mode === "noticia" ? "tab active" : "tab"}
              onClick={() => setMode("noticia")}
              disabled={busy}
            >
              Noticia o red social
            </button>
          </div>

          <div className="row">
            <label className="field grow">
              <span>{mode === "noticia" ? "Título (opcional, se detecta solo)" : "Título del debate (opcional)"}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Debate electoral en RTVE"
                maxLength={120}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>{mode === "noticia" ? "Fecha de publicación" : "Fecha del debate"}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </label>
          </div>
          <p className="muted small">
            La fecha es importante: las cifras se comparan con los datos que existían ese día.
          </p>

          {mode === "noticia" ? (
            <div className="field">
              <div className="row subtabs">
                {(
                  [
                    ["url", "Enlace"],
                    ["text", "Texto"],
                    ["image", "Captura"],
                  ] as const
                ).map(([m, label]) => (
                  <label key={m} className="check">
                    <input
                      type="radio"
                      name="newsMode"
                      checked={newsMode === m}
                      onChange={() => setNewsMode(m)}
                      disabled={busy}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {newsMode === "url" && (
                <>
                  <input
                    type="url"
                    inputMode="url"
                    value={newsUrl}
                    onChange={(e) => setNewsUrl(e.target.value)}
                    placeholder="https://www.periodico.es/noticia…"
                    disabled={busy}
                  />
                  <span className="muted small">
                    Funciona bien con prensa digital. Muchas redes sociales (X, Instagram,
                    Facebook) y webs de pago bloquean la lectura: en ese caso, usa una captura.
                  </span>
                </>
              )}
              {newsMode === "text" && (
                <textarea
                  rows={10}
                  value={newsText}
                  onChange={(e) => setNewsText(e.target.value)}
                  disabled={busy}
                  placeholder="Pega aquí el titular y el texto de la noticia o publicación."
                />
              )}
              {newsMode === "image" && (
                <>
                  {shots.length > 0 && (
                    <ol className="parts">
                      {shots.map((f, i) => (
                        <li key={`${f.name}-${f.size}-${i}`}>
                          <span className="part-name">{f.name}</span>
                          <span className="part-actions">
                            <button
                              type="button"
                              className="link"
                              onClick={() => setShots((p) => p.filter((_, j) => j !== i))}
                              disabled={busy}
                              aria-label="Quitar"
                            >
                              ✕
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {shots.length < MAX_SCREENSHOTS && (
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const list = e.target.files;
                        if (list) setShots((p) => [...p, ...Array.from(list)].slice(0, MAX_SCREENSHOTS));
                        e.target.value = "";
                      }}
                      disabled={busy}
                    />
                  )}
                  <span className="muted small">
                    Hasta {MAX_SCREENSHOTS} capturas de la misma noticia o hilo, en orden. Se
                    analizan y no se guardan.
                  </span>
                </>
              )}
            </div>
          ) : mode === "texto" ? (
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
            <div className="field">
              <span>
                Audio o vídeo (hasta {MAX_AUDIO_PARTS} partes de máx. 300 MB y {MAX_AUDIO_MINUTES} min cada una)
              </span>
              {files.length > 0 && (
                <ol className="parts">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${i}`}>
                      <span className="part-name">
                        {f.name} <span className="muted small">({fmtMB(f.size)})</span>
                      </span>
                      <span className="part-actions">
                        <button type="button" className="link" onClick={() => moveFile(i, -1)} disabled={busy || i === 0} aria-label="Subir">
                          ↑
                        </button>
                        <button type="button" className="link" onClick={() => moveFile(i, 1)} disabled={busy || i === files.length - 1} aria-label="Bajar">
                          ↓
                        </button>
                        <button type="button" className="link" onClick={() => removeFile(i)} disabled={busy} aria-label="Quitar">
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {files.length < MAX_AUDIO_PARTS && (
                <input
                  type="file"
                  multiple
                  accept="audio/*,video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={busy}
                />
              )}
              <span className="muted small">
                Para un debate largo, súbelo en partes y ordénalas con las flechas. Los archivos se
                borran en cuanto termina la transcripción.
              </span>
            </div>
          )}

          {progress && <p className="status">{progress}</p>}

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
          {Object.keys(names).some((n) => n.startsWith("Parte ")) && (
            <p className="muted small">
              Cada parte numera sus voces por separado: si la misma persona aparece en varias
              partes, escribe exactamente el mismo nombre en todas.
            </p>
          )}
          {Object.keys(names).map((sp) => (
            <label key={sp} className="field">
              <span>{sp}</span>
              <span className="sample">“{speakerSamples[sp]}…”</span>
              <input
                value={names[sp]}
                onChange={(e) => setNames((n) => ({ ...n, [sp]: e.target.value }))}
                placeholder="Nombre del interviniente"
                maxLength={60}
                list="speaker-names"
              />
            </label>
          ))}
          <datalist id="speaker-names">
            {[...new Set(Object.values(names).map((n) => n.trim()).filter(Boolean))].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
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
          <p className="status">{progress || "Leyendo el debate…"}</p>
          <div className="progress" />
        </section>
      )}

      {phase === "resultados" && (
        <>
          <section className="card">
            <h2>{title || "Resultados"}</h2>
            {subtitle && <p className="muted small">{subtitle}</p>}
            <p>
              {claims.length} afirmaciones encontradas, {facts.length} con datos comprobables.
              {facts.length > 0 && ` Verificadas: ${doneCount} de ${facts.length}.`}
            </p>
            <p className="muted small">
              Se guarda automáticamente en este dispositivo: si se recarga la página, el trabajo
              no se pierde.
            </p>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Mostrar también opiniones y promesas
              </label>
            </div>
            <div className="row">
              <button
                className="secondary"
                onClick={() => void downloadDocx()}
                disabled={doneCount < facts.length || makingDocx}
              >
                {makingDocx ? "Generando…" : "Descargar en Word"}
              </button>
              <button className="secondary" onClick={downloadReport} disabled={doneCount < facts.length}>
                Descargar en Markdown
              </button>
              <button className="secondary" onClick={copyReport} disabled={doneCount < facts.length}>
                {copied ? "¡Copiado!" : "Copiar informe"}
              </button>
              {failed.length > 0 && doneCount === facts.length && (
                <button
                  className="secondary"
                  onClick={() => void verifyAll(failed)}
                >
                  Reintentar fallidas ({failed.length})
                </button>
              )}
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
