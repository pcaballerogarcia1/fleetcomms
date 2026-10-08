import { describe, it, expect } from "vitest";
import { limpiarEmail, mensajeAuth } from "./auth-mensajes.js";

describe("entrada a la app", () => {
  it("limpia el email: espacios, mayúsculas y el punto final que se cuela al copiarlo", () => {
    expect(limpiarEmail("  Admin@Operanzia-Pruebas.test. ")).toBe("admin@operanzia-pruebas.test");
    expect(limpiarEmail("ana@empresa.es")).toBe("ana@empresa.es");
    expect(limpiarEmail(undefined)).toBe("");
  });
  it("explica los errores en palabras que se entienden, sin códigos de Firebase", () => {
    expect(mensajeAuth({ code: "auth/invalid-credential" })).toBe("Email o contraseña incorrectos.");
    expect(mensajeAuth({ code: "auth/invalid-email" })).toMatch(/no es válido/);
    expect(mensajeAuth({ code: "auth/raro", message: "Firebase: Error (auth/raro)." })).not.toMatch(/Firebase|auth\//);
  });
});
