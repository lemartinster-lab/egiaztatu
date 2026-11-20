import { NextResponse, type NextRequest } from "next/server";
import { authConfigFromEnv, isAuthorized } from "@/lib/auth";

/**
 * Modo personal: pide usuario y contraseña antes de mostrar cualquier página
 * o llamar a cualquier API. Se desactiva solo si se borra APP_PASSWORD.
 */
export function proxy(request: NextRequest) {
  if (isAuthorized(request.headers.get("authorization"), authConfigFromEnv())) {
    return NextResponse.next();
  }
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Egiaztatu", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // Todo excepto los recursos estáticos internos de Next.js.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
