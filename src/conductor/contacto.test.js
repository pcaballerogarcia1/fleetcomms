import { afterEach, describe, expect, it, vi } from "vitest";
import { NAVEGADORES, abrirNavegacion, elegirNavegador, enlacesContacto, navegadorElegido, telefonoDe } from "./contacto.js";
import { taskToUbicacion } from "../publicar-rutas.js";

afterEach(() => vi.unstubAllGlobals());

describe("contactar desde la parada", () => {
  it("teléfonos de España: WhatsApp con +34; los que ya traen prefijo, tal cual", () => {
    expect(telefonoDe({ telefono: "612 34 56 78" })).toEqual({ ver: "612 34 56 78", tel: "612345678", wa: "34612345678" });
    expect(telefonoDe({ telefono: "+351 912 345 678" })).toMatchObject({ tel: "+351912345678", wa: "351912345678" });
    expect(telefonoDe({ telefono: "0034 971 123 456" })).toMatchObject({ tel: "+34971123456", wa: "34971123456" });
    expect(telefonoDe({ telefono: "" })).toBeNull();
    expect(telefonoDe({ telefono: "s/n" })).toBeNull();
  });
  it("enlaces de llamada, WhatsApp y SMS", () => {
    expect(enlacesContacto(telefonoDe({ telefono: "612345678" }))).toEqual({ llamar: "tel:612345678", whatsapp: "https://wa.me/34612345678", sms: "sms:612345678" });
    expect(enlacesContacto(null)).toBeNull();
  });
  it("el teléfono y el contacto llegan del Excel de Planning al publicar", () => {
    const u = taskToUbicacion({ nombre: "P1", lat: 39.5, lng: 2.6, campos: { Teléfono: "612 345 678", "Persona de contacto": "Marta" } }, 0);
    expect(u).toMatchObject({ telefono: "612 345 678", contacto: "Marta" });
  });
});

describe("navegar con la app elegida", () => {
  it("Google Maps por defecto; se recuerda la elegida", () => {
    const guardado = new Map();
    vi.stubGlobal("localStorage", { getItem: k => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, String(v)) });
    const abrir = vi.fn();
    vi.stubGlobal("window", { open: abrir });
    expect(navegadorElegido().id).toBe("google");
    elegirNavegador("waze");
    expect(navegadorElegido().nombre).toBe("Waze");
    abrirNavegacion(39.5, 2.6);
    expect(abrir).toHaveBeenCalledWith("https://waze.com/ul?ll=39.5,2.6&navigate=yes", "_blank");
    expect(NAVEGADORES.map(n => n.id)).toEqual(["google", "waze", "apple"]);
  });
});
