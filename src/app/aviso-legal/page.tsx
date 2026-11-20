import type { Metadata } from "next";

export const metadata: Metadata = { title: "Aviso legal — Egiaztatu" };

// TODO(titular): rellenar antes de publicar. La LSSI exige identificar al titular.
const TITULAR = "[Nombre y apellidos del titular]";
const CONTACTO = "[correo@ejemplo.com]";

export default function AvisoLegal() {
  return (
    <article className="card prose">
      <h1>Aviso legal, privacidad y correcciones</h1>

      <h2>Titular</h2>
      <p>
        Este sitio web es un proyecto independiente de {TITULAR}. Contacto: {CONTACTO}.
        Egiaztatu no está vinculado a ningún partido político, medio de comunicación ni
        administración pública.
      </p>

      <h2>Naturaleza del servicio</h2>
      <p>
        Egiaztatu es una herramienta automática basada en inteligencia artificial. Los
        resultados son <strong>orientativos</strong>, pueden contener errores y no
        constituyen una afirmación de los hechos por parte del titular. Cada veredicto
        incluye las fuentes en las que se basa para que el usuario pueda comprobarlo por sí
        mismo. El usuario es responsable del uso que haga de los resultados.
      </p>

      <h2>Privacidad</h2>
      <ul>
        <li>No pedimos registro ni guardamos los textos ni los resultados de verificación.</li>
        <li>
          Los audios se almacenan temporalmente para transcribirlos y se borran
          automáticamente al terminar (como máximo en 24 horas).
        </li>
        <li>
          Para prestar el servicio, el contenido se envía a proveedores de inteligencia
          artificial que actúan como encargados del tratamiento: Anthropic (análisis y
          verificación), ElevenLabs (transcripción) y Vercel (alojamiento).
        </li>
        <li>
          Se usa un contador asociado a la dirección IP, que caduca en un día, solo para aplicar límites
          de uso y evitar abusos.
        </li>
        <li>
          No subas grabaciones privadas ni contenido con datos personales de particulares:
          la herramienta está pensada para debates y declaraciones públicas.
        </li>
      </ul>

      <h2>Correcciones</h2>
      <p>
        Si crees que un veredicto es erróneo, escríbenos a {CONTACTO} indicando la
        afirmación, el veredicto y la fuente que lo contradice. Revisaremos el criterio de
        verificación y, si procede, lo corregiremos y lo dejaremos indicado en la página de
        metodología.
      </p>
    </article>
  );
}
