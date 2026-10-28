import { describe, it, expect } from "vitest";
import { coberturaTramos, resumenCobertura } from "./cobertura.js";

const g = [40.1, -3.1, 40.1, -3.2];
const tramo = (lat, realizado, extra = {}) => ({ lat, lng: -3.15, geom: g, metros: 100, pa: `Calle ${lat}`, realizado, ...extra });

describe("cobertura de las calles del mes", () => {
  it("cuenta las pasadas previstas y hechas de cada tramo en todas las rutas", () => {
    const planes = [
      { tipo: "prev", ubicaciones: [tramo(40.1, true, { realizadoEn: 5 }), tramo(40.2, false), { lat: 1, lng: 1, realizado: true }] }, // el punto sin línea no cuenta
      { tipo: "prev", ubicaciones: [tramo(40.1, true, { realizadoEn: 9 }), tramo(40.2, true)] },
      { tipo: "corr", ubicaciones: [tramo(40.3, false)] },
    ];
    const t = coberturaTramos(planes);
    expect(t.length).toBe(2);
    expect(t.find(x => x.nombre === "Calle 40.1")).toMatchObject({ previstas: 2, hechas: 2, pct: 100, ultima: 9 });
    expect(t.find(x => x.nombre === "Calle 40.2")).toMatchObject({ previstas: 2, hechas: 1, pct: 50 });
    expect(resumenCobertura(t)).toMatchObject({ tramos: 2, completos: 1, aMedias: 1, nada: 0, metros: 200, metrosCompletos: 100, pct: 75 });
  });
});
