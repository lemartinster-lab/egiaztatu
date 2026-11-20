import { Egiaztatu } from "@/components/Egiaztatu";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>¿Es verdad lo que dicen en el debate?</h1>
        <p>
          Pega la transcripción o sube el audio de un debate político. Egiaztatu localiza
          las afirmaciones con datos, las busca en fuentes oficiales y te dice si son
          verdaderas, engañosas o falsas, con los enlaces para que lo compruebes tú.
        </p>
        <p className="muted small">
          <em>Egiaztatu</em> significa «verificar» en euskera.
        </p>
      </section>
      <Egiaztatu />
    </>
  );
}
