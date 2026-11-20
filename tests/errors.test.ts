import { describe, expect, it } from "vitest";
import { describeError, ElevenLabsError, UserFacingError } from "@/lib/errors";

const FB = "fallback";
const apiErr = (status: number, message = "") => Object.assign(new Error(message), { status });

describe("describeError — Anthropic", () => {
  it("clave ausente", () => {
    expect(describeError(new Error("Falta ANTHROPIC_API_KEY en el servidor"), "anthropic", FB)).toMatch(
      /Falta la clave ANTHROPIC_API_KEY/,
    );
  });
  it("clave no válida (401)", () => {
    expect(describeError(apiErr(401, "invalid x-api-key"), "anthropic", FB)).toMatch(/no es válida/);
  });
  it("sin saldo (400 credit balance)", () => {
    const msg = describeError(
      apiErr(400, "Your credit balance is too low to access the Anthropic API."),
      "anthropic",
      FB,
    );
    expect(msg).toMatch(/No hay saldo/);
    expect(msg).toMatch(/console\.anthropic\.com/);
  });
  it("modelo inexistente (404)", () => {
    expect(describeError(apiErr(404, "model: claude-x"), "anthropic", FB)).toMatch(/ANTHROPIC_MODEL/);
  });
  it("saturado (529) y demasiadas peticiones (429)", () => {
    expect(describeError(apiErr(529), "anthropic", FB)).toMatch(/saturado/);
    expect(describeError(apiErr(429), "anthropic", FB)).toMatch(/demasiadas peticiones/);
  });
  it("otros 400 muestran el detalle recortado", () => {
    expect(describeError(apiErr(400, "tools.0: bad"), "anthropic", FB)).toBe(
      "Anthropic rechazó la petición: tools.0: bad",
    );
  });
  it("errores 5xx", () => {
    expect(describeError(apiErr(503), "anthropic", FB)).toMatch(/error 503/);
  });
  it("tiempo agotado / sin conexión", () => {
    const t = Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" });
    expect(describeError(t, "anthropic", FB)).toMatch(/No se ha podido conectar/);
  });
  it("errores ya redactados pasan tal cual", () => {
    expect(describeError(new UserFacingError("Texto largo"), "anthropic", FB)).toBe("Texto largo");
  });
  it("lo desconocido usa el mensaje por defecto", () => {
    expect(describeError(new Error("algo raro"), "anthropic", FB)).toBe(FB);
    expect(describeError(null, "anthropic", FB)).toBe(FB);
  });
});

describe("describeError — ElevenLabs", () => {
  it("clave ausente y no válida", () => {
    expect(describeError(new Error("Falta ELEVENLABS_API_KEY en el servidor"), "elevenlabs", FB)).toMatch(
      /ELEVENLABS_API_KEY/,
    );
    expect(describeError(new ElevenLabsError(401, "invalid_api_key"), "elevenlabs", FB)).toMatch(
      /ELEVENLABS_API_KEY no es válida/,
    );
  });
  it("cuota agotada", () => {
    expect(
      describeError(new ElevenLabsError(401, '{"detail":{"status":"quota_exceeded"}}'), "elevenlabs", FB),
    ).toMatch(/No hay saldo o cuota/);
  });
  it("no muestra nunca la clave aunque venga en el mensaje", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secreto";
    const msg = describeError(apiErr(401, "bad key sk-ant-secreto"), "anthropic", FB);
    expect(msg).not.toContain("sk-ant-secreto");
  });
});

describe("describeError — seguridad", () => {
  it("oculta cualquier clave que aparezca en un detalle 400", () => {
    const msg = describeError(apiErr(400, "bad request sk-ant-api03-abcdef123456"), "anthropic", FB);
    expect(msg).not.toContain("abcdef123456");
    expect(msg).toContain("[clave oculta]");
  });
});
