import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Egiaztatu — Verificación de debates políticos con IA",
  description:
    "Sube o pega un debate político y Egiaztatu detecta las afirmaciones con datos y las contrasta con fuentes oficiales.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f3d3e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Egiaztatu
          </Link>
          <nav>
            <Link href="/metodologia">Metodología</Link>
            <Link href="/aviso-legal">Aviso legal</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <p>
            Egiaztatu usa inteligencia artificial. Sus veredictos son orientativos y pueden
            contener errores: comprueba siempre las fuentes enlazadas.
          </p>
          <p>
            <Link href="/metodologia">Cómo funciona</Link> ·{" "}
            <Link href="/aviso-legal">Aviso legal y correcciones</Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
