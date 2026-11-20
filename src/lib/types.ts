/** Un tramo continuo de discurso de un mismo hablante. */
export interface Segment {
  speaker: string;
  text: string;
  /** Segundo de inicio en el audio (solo si viene de una transcripción). */
  start?: number;
}

/** Tipo de afirmación según lo que se puede comprobar. */
export type ClaimType = "hecho" | "opinion" | "promesa";

export interface Claim {
  id: string;
  speaker: string;
  /** Frase literal (o casi literal) del interviniente. */
  quote: string;
  type: ClaimType;
  /** Reformulación neutra y comprobable de la afirmación (solo para hechos). */
  checkable: string;
  topic: string;
}

export type Verdict =
  | "verdadero"
  | "enganoso"
  | "falso"
  | "impreciso"
  | "no_verificable";

export type Confidence = "alta" | "media" | "baja";

export interface Source {
  url: string;
  title: string;
}

export interface VerificationResult {
  claimId: string;
  verdict: Verdict;
  confidence: Confidence;
  /** Explicación breve en español. */
  explanation: string;
  /** El dato correcto o el contexto que falta, si lo hay. */
  context: string;
  sources: Source[];
  /** Si el sistema rebajó el veredicto por falta de fuentes reales. */
  downgraded: boolean;
}

/** Datos opcionales del debate que ayudan a fechar las cifras. */
export interface DebateContext {
  title?: string;
  /** Fecha del debate en formato AAAA-MM-DD. */
  date?: string;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  verdadero: "Verdadero",
  enganoso: "Engañoso",
  falso: "Falso",
  impreciso: "Imprecisa",
  no_verificable: "No verificable",
};

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  hecho: "Hecho comprobable",
  opinion: "Opinión",
  promesa: "Promesa",
};
