import { describe, it, expect } from "vitest";
import { t } from "./i18n.js";

// t() se testea pasando `lang` explícito para no depender de localStorage/window,
// que no existen en el entorno de test (node, sin jsdom).
describe("t", () => {
  it("traduce una clave conocida en español", () => {
    expect(t("planning", "es")).toBe("Planning");
    expect(t("logout", "es")).toBe("Cerrar sesión");
  });
  it("traduce una clave conocida en inglés", () => {
    expect(t("logout", "en")).toBe("Log out");
    expect(t("vehiculos", "en")).toBe("Vehicles");
  });
  it("cae a español si el idioma no existe en el diccionario", () => {
    expect(t("planning", "fr")).toBe("Planning");
  });
  it("devuelve la propia key si no existe traducción en ningún idioma", () => {
    expect(t("clave_inexistente", "es")).toBe("clave_inexistente");
    expect(t("clave_inexistente", "en")).toBe("clave_inexistente");
  });
});
