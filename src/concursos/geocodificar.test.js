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
      if (url.includes("/candidates") && q.startsWith("SOL")) return respuesta([{ id: "7", type: "callejero", address: "CALLE SOL, Palma", lat: 0, lng: 0 }]);
      if (url.includes("/find?id=7")) return respuesta({ type: "callejero", geom: "MULTILINESTRING((2 39,4 41))" });
      return respuesta([]);
    };
    const r = await geocodificar(["MAYOR 1, Palma", "SOL 7, Palma", "NADA 2, Palma"], { fetchFn, aLaVez: 2 });
    expect([r.encontradas, r.aproximadas, r.sinEncontrar]).toEqual([1, 1, 1]);
    const cs = aplicarCoordenadas([{ calle: "MAYOR", numero: "1", fraccionPliego: "Resto", ubicacion: "Soterrado", codigo: "9001" }, { calle: "NADA", numero: "2" }], "Palma", r.porDireccion);
    expect(cs[0]).toMatchObject({ lat: 39.57, lng: 2.65, geo: "portal" });
    expect(marcadoresDe(cs)).toEqual([{ lat: 39.57, lng: 2.65, nombre: "MAYOR 1", id: "9001", calle: "MAYOR", numero: "1", fraccion: "Resto", contenedor: "Soterrado", codigo: "9001", situado: "en el portal" }]);
  });
});
