import { describe, expect, it } from "vitest";
import { destinoTras, leerAccion, motivoClave, valorarClave } from "./clave.js";
import { generarClave } from "../acceso-app.js";

describe("contraseña segura", () => {
  it("al menos 8 caracteres, con letras y números", () => {
    expect(valorarClave("abc1").ok).toBe(false);
    expect(valorarClave("abcdefgh").falta).toContain("Letras y números");
    expect(valorarClave("12345679").falta).toContain("Letras y números");
    expect(valorarClave("Camion-azul-27").ok).toBe(true);
  });
  it("las típicas no valen, ni con números al final", () => {
    for (const c of ["password1", "Password123", "12345678", "abcd1234", "qwerty123", "Operanzia2026", "aaaaaaaa"]) expect(valorarClave(c).ok, c).toBe(false);
  });
  it("no puede llevar tu nombre ni tu usuario", () => {
    expect(valorarClave("carlos2026", { email: "carlos.perez@empresa.es" }).falta).toContain("Que no lleve tu nombre ni tu usuario");
    expect(valorarClave("Perez-1977", { nombre: "Ana", apellidos: "Pérez Gil" }).ok).toBe(false); // con o sin tilde
    expect(valorarClave("Banana-2026", { nombre: "Ana", apellidos: "Gil" }).ok).toBe(true); // nombres muy cortos no cuentan
  });
  it("cuanto más larga y variada, más segura", () => {
    expect(valorarClave("camion27").nivel).toBe("Débil");
    expect(valorarClave("Camion-azul-27").puntos).toBeGreaterThanOrEqual(3);
    expect(valorarClave("password").puntos).toBeLessThanOrEqual(1);
  });
  it("las que genera Operanzia al dar de alta valen", () => {
    for (let i = 0; i < 200; i++) expect(motivoClave(generarClave())).toBeNull();
  });
  it("el enlace del correo y a dónde volver", () => {
    expect(leerAccion("?mode=resetPassword&oobCode=XYZ&continueUrl=https%3A%2F%2Fapp.operanzia.com%2Frutas")).toEqual({ modo: "resetPassword", codigo: "XYZ", continuar: "https://app.operanzia.com/rutas" });
    expect(destinoTras("https://app.operanzia.com/rutas", "admin", "https://app.operanzia.com")).toBe("/rutas");
    expect(destinoTras("https://app.operanzia.com/login", "admin", "https://app.operanzia.com")).toBe("/projects");
    expect(destinoTras("https://malo.com/x", "conductor", "https://app.operanzia.com")).toBe("/rutas");
    expect(destinoTras("", null, "https://app.operanzia.com")).toBe("/projects");
  });
});
