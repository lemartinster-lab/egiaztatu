import { describe, expect, it } from "vitest";
import { authConfigFromEnv, isAuthorized, safeEqual } from "@/lib/auth";

const basic = (user: string, pass: string) =>
  "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");

describe("protección por contraseña", () => {
  const config = { user: "lemarrero", password: "Kaixo-2026:ñ" };

  it("sin APP_PASSWORD la app queda abierta", () => {
    expect(authConfigFromEnv({})).toBeNull();
    expect(authConfigFromEnv({ APP_PASSWORD: "   " })).toBeNull();
    expect(isAuthorized(null, null)).toBe(true);
  });

  it("usa 'egiaztatu' como usuario por defecto", () => {
    expect(authConfigFromEnv({ APP_PASSWORD: "x" })).toEqual({ user: "egiaztatu", password: "x" });
  });

  it("deja pasar con usuario y contraseña correctos (incluidos ':' y acentos)", () => {
    expect(isAuthorized(basic("lemarrero", "Kaixo-2026:ñ"), config)).toBe(true);
  });

  it("bloquea sin cabecera, con contraseña mala o usuario malo", () => {
    expect(isAuthorized(null, config)).toBe(false);
    expect(isAuthorized(basic("lemarrero", "otra"), config)).toBe(false);
    expect(isAuthorized(basic("otro", "Kaixo-2026:ñ"), config)).toBe(false);
  });

  it("bloquea cabeceras mal formadas", () => {
    expect(isAuthorized("Bearer abc", config)).toBe(false);
    expect(isAuthorized("Basic %%%no-base64", config)).toBe(false);
    expect(isAuthorized("Basic " + btoa("sin-dos-puntos"), config)).toBe(false);
  });

  it("safeEqual compara correctamente", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
