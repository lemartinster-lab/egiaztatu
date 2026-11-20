import type { Metadata } from "next";
import { PROMPT_VERSION } from "@/lib/prompts";

export const metadata: Metadata = { title: "Metodología — Egiaztatu" };

export default function Metodologia() {
  return (
    <article className="card prose">
      <h1>Cómo funciona Egiaztatu</h1>

      <h2>1. Transcripción</h2>
      <p>
        Si subes un audio o vídeo, se transcribe automáticamente y se separan las voces de
        cada interviniente. Tú indicas quién es cada voz. El archivo se borra de nuestros
        servidores en cuanto termina la transcripción.
      </p>

      <h2>2. Extracción de afirmaciones</h2>
      <p>
        Una inteligencia artificial lee el debate y clasifica cada afirmación relevante en
        tres tipos. En los debates largos el texto se analiza por tramos y después se unen
        los resultados, quitando duplicados y repartiendo el cupo de forma equilibrada entre
        todos los intervinientes. Las obviedades sin contenido informativo se descartan.
      </p>
      <ul>
        <li>
          <strong>Hecho comprobable:</strong> cifras, estadísticas, leyes, votaciones o
          hechos ocurridos. Solo estos se verifican.
        </li>
        <li>
          <strong>Opinión:</strong> valoraciones y juicios. No se pueden verificar con datos.
        </li>
        <li>
          <strong>Promesa:</strong> compromisos sobre el futuro. No se pueden verificar hoy.
        </li>
      </ul>

      <h2>3. Verificación a ciegas</h2>
      <p>
        Cada hecho se verifica por separado <strong>sin decirle a la IA quién lo dijo</strong>{" "}
        ni a qué partido pertenece. Se juzga la frase, no a la persona. Todas las
        afirmaciones de todos los intervinientes pasan exactamente por el mismo proceso.
      </p>
      <p>
        La IA busca el dato en internet dando prioridad a fuentes oficiales y primarias
        (INE, Eurostat, BOE, Banco de España, ministerios, Seguridad Social, SEPE, AIReF,
        ISTAC, Eustat, Congreso…) y lo compara con los datos disponibles en la fecha del
        debate.
      </p>

      <h2>4. Veredictos</h2>
      <ul>
        <li>
          <span className="badge badge-verdadero">Verdadero</span> Los datos confirman la
          afirmación (se aceptan redondeos razonables).
        </li>
        <li>
          <span className="badge badge-enganoso">Engañoso</span> Parte de un dato real pero
          omite contexto clave, exagera o compara de forma tramposa.
        </li>
        <li>
          <span className="badge badge-falso">Falso</span> Los datos la contradicen
          claramente.
        </li>
        <li>
          <span className="badge badge-impreciso">Imprecisa</span> La frase es tan vaga
          (sin cifra, periodo ni comparación concreta) que no se puede contrastar de forma
          útil o es trivialmente cierta. No cuenta como verdadera en el resumen.
        </li>
        <li>
          <span className="badge badge-no_verificable">No verificable</span> La afirmación
          es concreta, pero no hay datos públicos suficientes para contrastarla.
        </li>
      </ul>

      <h2>5. Sin fuente no hay veredicto</h2>
      <p>
        Esta es la regla más importante. El sistema comprueba automáticamente que cada
        fuente citada haya aparecido de verdad en las búsquedas realizadas, y descarta
        cualquier enlace que no se pueda comprobar. Si una afirmación se queda sin fuentes
        válidas, se marca como <em>No verificable</em>, aunque la IA hubiera propuesto otro
        veredicto. La IA nunca puede usar «lo que sabe» como prueba.
      </p>

      <h2>6. Limitaciones</h2>
      <ul>
        <li>La IA puede equivocarse al interpretar una frase o un dato. Revisa las fuentes.</li>
        <li>La transcripción automática puede confundir palabras o voces.</li>
        <li>
          El resumen por interviniente solo cuenta las afirmaciones verificadas en este
          debate. No es una medida de la honestidad de nadie.
        </li>
      </ul>

      <p className="muted small">Versión del criterio de verificación: {PROMPT_VERSION}</p>
    </article>
  );
}
