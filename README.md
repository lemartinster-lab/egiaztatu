# Egiaztatu

**Verificación de afirmaciones de debates políticos con inteligencia artificial.**
*Egiaztatu* significa «verificar» en euskera.

Pegas la transcripción o subes el audio/vídeo de un debate. Egiaztatu:

1. Transcribe el audio separando a los hablantes (ElevenLabs Scribe).
2. Te deja poner nombre a cada voz.
3. Extrae las afirmaciones y las clasifica en *hecho comprobable*, *opinión* o *promesa* (Claude).
4. Verifica cada hecho **a ciegas** (sin saber quién lo dijo) con búsqueda web, priorizando fuentes oficiales (Claude + web search).
5. Muestra un semáforo por afirmación (Verdadero / Engañoso / Falso / No verificable), con explicación y fuentes.

### Regla de oro: sin fuente no hay veredicto

`src/lib/parse.ts → normalizeVerification` descarta cualquier URL que no haya
aparecido de verdad en los resultados del buscador. Si una afirmación se queda sin
fuentes válidas, pasa automáticamente a **No verificable**.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- `@anthropic-ai/sdk` (Claude, herramienta `web_search`)
- ElevenLabs Speech-to-Text (Scribe) con diarización
- Vercel Blob para subir audios grandes directamente desde el navegador
- Vitest

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # rellena las claves
npm run dev
```

Variables: ver `.env.example`. Obligatorias: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
`BLOB_READ_WRITE_TOKEN`.

## Despliegue en Vercel

1. Importa el repo en Vercel.
2. En **Storage**, crea un **Blob Store** y conéctalo al proyecto (añade `BLOB_READ_WRITE_TOKEN`).
3. Añade `ANTHROPIC_API_KEY` y `ELEVENLABS_API_KEY` en *Environment Variables*.
4. **Recomendado:** crea una base Upstash Redis (Marketplace de Vercel) para que los
   límites por IP funcionen entre todas las instancias (`UPSTASH_REDIS_REST_URL` y `_TOKEN`).
5. Rellena el titular y el correo de contacto en `src/app/aviso-legal/page.tsx`.

> Las funciones de transcripción, extracción y verificación usan `maxDuration = 300` s.

## Límites (app pública)

| Acción | Por IP y día (por defecto) | Variable |
|---|---|---|
| Subir archivo | 5 | `LIMIT_UPLOAD_PER_DAY` |
| Transcribir audio | 3 | `LIMIT_TRANSCRIBE_PER_DAY` |
| Extraer afirmaciones | 10 | `LIMIT_EXTRACT_PER_DAY` |
| Verificar una afirmación | 80 | `LIMIT_VERIFY_PER_DAY` |

Audio: máximo 300 MB y 90 minutos. Se borra en cuanto se transcribe (y, por seguridad, caduca a las 24 h).

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build
```

## Estructura

```
src/
  app/
    page.tsx                 Página principal
    metodologia/page.tsx     Cómo se verifica
    aviso-legal/page.tsx     Aviso legal, privacidad y correcciones
    api/upload/route.ts      Autoriza la subida a Vercel Blob
    api/transcribe/route.ts  ElevenLabs Scribe (diarización) + borrado del audio
    api/extract/route.ts     Extracción y clasificación de afirmaciones
    api/verify/route.ts      Verificación de una afirmación con búsqueda web
  components/                Interfaz (flujo, tarjetas, resumen)
  lib/
    prompts.ts               Prompts versionados (PROMPT_VERSION)
    claude.ts                Llamadas a Claude
    elevenlabs.ts            Transcripción
    parse.ts                 Validación de respuestas de la IA + regla de fuentes
    rateLimit.ts             Límites por IP (memoria o Upstash)
    report.ts                Resumen por interviniente e informe en Markdown
tests/                       Tests con Vitest
```

## Pendiente (próximas fases)

- Enlaces de YouTube (requiere una vía legal y estable para obtener el audio).
- Modo en directo (transcripción en streaming durante la emisión).
- Histórico público de verificaciones por debate.
