import { describe, expect, it } from "vitest";
import { columnasDireccion, conMunicipio, faltaMunicipio, situarPendientes, textoDireccion } from "./direcciones.js";

describe("importar con dirección", () => {
  it("reconoce las columnas de dirección", () => {
    expect(columnasDireccion(["Cliente", "Dirección", "Nº", "Población", "C.P.", "Teléfono"])).toEqual({ direccion: "Dirección", numero: "Nº", municipio: "Población", cp: "C.P." });
    expect(columnasDireccion(["Nombre", "Dirección de entrega", "Localidad"])).toMatchObject({ direccion: "Dirección de entrega", municipio: "Localidad" });
    expect(columnasDireccion(["Nombre", "Teléfono"])).toBe(null);
  });

  it("arma el texto de búsqueda con lo que venga", () => {
    const c = { direccion: "dir", numero: "num", municipio: "muni" };
    expect(textoDireccion({ dir: "C/ Mayor", num: "12", muni: "Madrid" }, c)).toBe("Calle Mayor 12, Madrid");
    expect(textoDireccion({ dir: "Avda. de la Constitución nº 5", muni: "Sevilla" }, c)).toBe("Avenida de la Constitución 5, Sevilla");
    expect(textoDireccion({ dir: "Calle Mayor, 12, 28013 Madrid" }, c)).toBe("Calle Mayor 12, Madrid");
    expect(textoDireccion({ dir: "Plaza España 3, 2º B, Madrid" }, c)).toBe("Plaza España 3, Madrid");
    expect(textoDireccion({ dir: "Calle 5 de Mayo", muni: "Palma" }, c)).toBe("Calle 5 de Mayo, Palma");
    expect(textoDireccion({ dir: "Calle 5 de Mayo 7 bajo", muni: "Palma" }, c)).toBe("Calle 5 de Mayo 7, Palma");
    expect(textoDireccion({ dir: "Pza. Mayor 1" }, c, "Salamanca")).toBe("Plaza Mayor 1, Salamanca");
    expect(textoDireccion({ dir: "" }, c)).toBe(null);
  });

  it("pide el municipio si ninguna fila lo trae, y sitúa lo encontrado", () => {
    const cols = { direccion: "dir" };
    const pend = [{ campos: { dir: "Calle Mayor 12", Cliente: "Bar" }, texto: "Calle Mayor 12" }, { campos: { dir: "Calle Luna 3" }, texto: "Calle Luna 3" }];
    expect(faltaMunicipio(pend)).toBe(true);
    const con = conMunicipio(pend, cols, "Madrid");
    expect(con.map(p => p.texto)).toEqual(["Calle Mayor 12, Madrid", "Calle Luna 3, Madrid"]);
    const r = situarPendientes(con, new Map([["Calle Mayor 12, Madrid", { lat: 40.4, lng: -3.7, calidad: "portal" }], ["Calle Luna 3, Madrid", null]]));
    expect(r.markers).toEqual([{ dir: "Calle Mayor 12", Cliente: "Bar", lat: 40.4, lng: -3.7, situado: "en el portal" }]);
    expect(r.sinSituar.map(p => p.texto)).toEqual(["Calle Luna 3, Madrid"]);
  });
});

describe("franja, duración y carga desde las columnas", async () => {
  const { franjaDeCampos, duracionDeCampos, demandaDeCampos } = await import("../scheduling/datos.js");
  it("lee la franja de dos columnas o de una", () => {
    expect(franjaDeCampos({ Desde: "9:00", Hasta: "11:30" })).toEqual({ desde: 540, hasta: 690 });
    expect(franjaDeCampos({ "Franja horaria": "de 9 a 11" })).toEqual({ desde: 540, hasta: 660 });
    expect(franjaDeCampos({ Horario: "08.30-10h" })).toEqual({ desde: 510, hasta: 600 });
    expect(franjaDeCampos({ "Hora inicio": "0.375" })).toEqual({ desde: 540, hasta: 540 }); // celda de hora de Excel sin formato
    expect(franjaDeCampos({ Cliente: "Bar" })).toBe(null);
  });
  it("la duración y, con kilos y bultos, los kilos", () => {
    expect(duracionDeCampos({ "Duración (min)": "12" })).toBe(12);
    expect(demandaDeCampos({ Bultos: "3", "Peso (kg)": "120" })).toBe(120);
  });
});
