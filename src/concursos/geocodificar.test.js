import { describe, expect, it } from "vitest";
import { aplicarCoordenadas, centroDe, direccionDe, direccionesDe, geocodificar, marcadoresDe, mismaCalle } from "./geocodificar.js";

const respuesta = (cuerpo, ok = true) => ({ ok, text: async () => (cuerpo == null ? "" : JSON.stringify(cuerpo)) });

describe("situar el listado en el mapa", () => {
  it("una búsqueda por dirección distinta", () => {
    const cs = [{ calle: "GABRIEL MAURA", numero: "15" }, { calle: "GABRIEL MAURA", numero: "15" }, { calle: "OLMOS", numero: "3 bis" }, { calle: "SOL", lat: 39.5, lng: 2.6 }];
    expect(direccionDe(cs[2], "Palma")).toBe("OLMOS 3, Palma");
    expect([...direccionesDe(cs, "Palma")]).toEqual([["GABRIEL MAURA 15, Palma", [0, 1]], ["OLMOS 3, Palma", [2]]]);
  });
  it("la calle encontrada tiene que ser la buscada (con alguna letra distinta)", () => {
    expect(mismaCalle("RAFALETES", "CALLE LES RAFELETES 23 Palma")).toBe(true);
    expect(mismaCalle("MARIA CURIE", "CALLE MARÍE CURIE 4 Palma")).toBe(true);
    expect(mismaCalle("FRA FRANCESC CANTARELLAS", "CALLE FRA FRANCESC PALOU, Palma")).toBe(false);
  });
  it("centro de una calle", () => {
    expect(centroDe("MULTILINESTRING((2 39,4 41))")).toEqual({ lng: 3, lat: 40 });
  });
  it("portal exacto, y si no, el centro de la calle; lo demás, sin encontrar", async () => {
    const fetchFn = async url => {
      const q = decodeURIComponent(url.split("q=")[1] || "");
      if (url.includes("/find?q=") && q.startsWith("MAYOR 1")) return respuesta({ type: "portal", tip_via: "CALLE", address: "MAYOR", portalNumber: 1, muni: "Palma", lat: 39.57, lng: 2.65, state: 0 });
      if (url.includes("/find?q=")) return respuesta(null);
      if (url.includes("/candidates") && q.startsWith("SOL")) return respuesta([{ id: "7", type: "callejero", address: "CALLE SOL, Palma", muni: "Palma", lat: 0, lng: 0 }]);
      if (url.includes("/find?id=7")) return respuesta({ type: "callejero", muni: "Palma", geom: "MULTILINESTRING((2 39,4 41))" });
      return respuesta([]);
    };
    const r = await geocodificar(["MAYOR 1, Palma", "SOL 7, Palma", "NADA 2, Palma"], { fetchFn, aLaVez: 2 });
    expect([r.encontradas, r.aproximadas, r.sinEncontrar]).toEqual([1, 1, 1]);
    const cs = aplicarCoordenadas([{ calle: "MAYOR", numero: "1", fraccionPliego: "Resto", ubicacion: "Soterrado", codigo: "9001" }, { calle: "NADA", numero: "2" }], "Palma", r.porDireccion);
    expect(cs[0]).toMatchObject({ lat: 39.57, lng: 2.65, geo: "portal" });
    expect(marcadoresDe(cs)).toEqual([{ lat: 39.57, lng: 2.65, nombre: "MAYOR 1", id: "9001", calle: "MAYOR", numero: "1", fraccion: "Resto", contenedor: "Soterrado", codigo: "9001", situado: "en el portal" }]);
  });
});

describe("solo en el municipio pedido", () => {
  it("Palma no es Palma del Río ni La Palma de Cervelló", async () => {
    const { mismoMunicipio } = await import("./geocodificar.js");
    expect(mismoMunicipio("Palma", "Palma")).toBe(true);
    expect(mismoMunicipio("Palma de Mallorca", "Palma")).toBe(true);
    expect(mismoMunicipio("Palma", "Palma del Río")).toBe(false);
    expect(mismoMunicipio("Palma", "La Palma de Cervelló")).toBe(false);
  });
  it("si la primera respuesta es de otro municipio, busca entre los candidatos del suyo", async () => {
    const fetchFn = async url => {
      if (url.includes("/find?q=")) return respuesta({ type: "portal", tip_via: "AVENIDA", address: "REPUBLICA ARGENTINA", portalNumber: 26, muni: "Palma del Río", lat: 37.7, lng: -5.27, state: 0 });
      if (url.includes("/candidates")) return respuesta([
        { type: "portal", address: "AVENIDA REPUBLICA ARGENTINA 26, Palma del Río", muni: "Palma del Río", lat: 37.7, lng: -5.27 },
        { type: "portal", address: "AVINGUDA ARGENTINA 26, Palma", muni: "Palma", lat: 39.57, lng: 2.64 },
      ]);
      return respuesta(null);
    };
    const r = await geocodificar(["ARGENTINA 26, Palma"], { fetchFn });
    expect(r.porDireccion.get("ARGENTINA 26, Palma")).toMatchObject({ lat: 39.57, calidad: "portal" });
  });
  it("lo que cae a más de 25 km del resto no se da por bueno", async () => {
    const { quitarLejanos } = await import("./geocodificar.js");
    const m = new Map([["a", { lat: 39.57, lng: 2.65 }], ["b", { lat: 39.58, lng: 2.66 }], ["c", { lat: 39.56, lng: 2.64 }], ["lejos", { lat: 28.1, lng: -16.6 }]]);
    expect(quitarLejanos(m)).toEqual(["lejos"]);
    expect(m.get("lejos")).toBeNull();
  });
  it("al volver a situar, lo buscado antes se vuelve a buscar; lo del archivo, no", async () => {
    const { aplicarCoordenadas: aplicar } = await import("./geocodificar.js");
    const cs = aplicar([{ calle: "SOL", numero: "1", lat: 28, lng: -16, geo: "portal" }, { calle: "MAR", numero: "2", lat: 39.5, lng: 2.6 }], "Palma", new Map());
    expect(cs[0]).toEqual({ calle: "SOL", numero: "1" });
    expect(cs[1]).toMatchObject({ lat: 39.5 });
  });
});
