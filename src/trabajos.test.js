import { describe, expect, it } from "vitest";
import { columnasDe, idNuevo, plantillaDe, resumenTrabajos, trabajosDePunto, visitasAnio } from "./trabajos.js";

const P = (id, campos) => ({ lat: 39.5, lng: 2.6, id, ...campos });
const puntos = [
  P("a", { Fraccion: "VIDRIO", Barrio: "Centro" }),
  P("b", { Fraccion: "RESTO", Barrio: "Centro" }),
  P("c", { Fraccion: "RESTO", Barrio: "Norte" }),
];

describe("trabajos de cada punto", () => {
  it("frecuencias a visitas al año", () => {
    expect([visitasAnio("diaria"), visitasAnio("L-X-V"), visitasAnio("quincenal"), visitasAnio("2/mes"), visitasAnio("mensual"), visitasAnio("trimestral"), visitasAnio("semestral"), visitasAnio("anual"), visitasAnio("a demanda"), visitasAnio("cada 14 días")])
      .toEqual([312, 156, 26, 24, 12, 4, 2, 1, 0, 26]);
    expect(visitasAnio("algo raro")).toBe(null);
  });
  it("plantilla del sector, en todos los puntos por defecto", () => {
    const t = plantillaDe("residuos");
    expect(t.map(x => x.nombre)).toEqual(["Recogida", "Lavado exterior", "Lavado interior", "Mantenimiento preventivo"]);
    expect(Object.keys(trabajosDePunto(puntos[0], t))).toHaveLength(4);
    expect(plantillaDe("inventado")[0].id).toBe("recogida");
  });
  it("reglas en bloque: quitar en el vidrio, cambiar la frecuencia en un barrio, y la excepción de un punto manda", () => {
    const t = plantillaDe("residuos");
    const reglas = [
      { trabajoId: "lavado-int", accion: "quitar", campo: "Fraccion", valor: "vidrio" },
      { trabajoId: "lavado-ext", accion: "poner", campo: "Barrio", valor: "Centro", frecuencia: "semanal" },
    ];
    expect(trabajosDePunto(puntos[0], t, reglas)["lavado-int"]).toBeUndefined();
    expect(trabajosDePunto(puntos[1], t, reglas)["lavado-ext"].frecuencia).toBe("semanal");
    expect(trabajosDePunto(puntos[2], t, reglas)["lavado-ext"].frecuencia).toBe("quincenal");
    const exc = { "lavado-int": { activo: true, frecuencia: "quincenal" }, preventivo: { activo: false } };
    const a = trabajosDePunto(puntos[0], t, reglas, exc);
    expect(a["lavado-int"].frecuencia).toBe("quincenal");
    expect(a.preventivo).toBeUndefined();
  });
  it("un trabajo que no es de todos solo va donde lo ponen las reglas", () => {
    const t = [{ id: "x", nombre: "X", frecuencia: "mensual", duracion: 10, todos: false }];
    const reglas = [{ trabajoId: "x", accion: "poner", campo: "Barrio", valor: "Norte" }];
    expect(puntos.map(p => !!trabajosDePunto(p, t, reglas).x)).toEqual([false, false, true]);
  });
  it("resumen, columnas para las reglas e ids", () => {
    const t = [{ id: "lav", nombre: "Lavado", frecuencia: "mensual", duracion: 10, todos: true }];
    expect(resumenTrabajos(puntos, t, [])).toEqual({ lav: { puntos: 3, visitas: 36, horas: 6 } });
    expect(columnasDe(puntos).map(c => c.campo)).toEqual(["Barrio", "Fraccion"]);
    expect(idNuevo("Lavado interior", [{ id: "lavado-interior" }])).toBe("lavado-interior-2");
  });
});
