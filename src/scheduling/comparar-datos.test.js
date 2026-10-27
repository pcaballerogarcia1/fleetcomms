import { describe, it, expect } from "vitest";
import { filasComparacion } from "./comparar-datos.js";

describe("filasComparacion", () => {
  it("marca en verde lo que el actual hace mejor y en rojo lo que hace peor", () => {
    const f = filasComparacion(
      { vehiculos: 5, paradas: 900, km: 300, sinAsignar: 0, coste: null },
      { vehiculos: 6, paradas: 950, km: 300.2, sinAsignar: 3, coste: null });
    const de = c => f.find(x => x.clave === c);
    expect(de("vehiculos")).toMatchObject({ dif: -1, mejor: true });
    expect(de("paradas")).toMatchObject({ dif: -50, mejor: false });
    expect(de("km").mejor).toBeNull();            // 0,2 km: igual
    expect(de("sinAsignar").mejor).toBe(true);
    expect(de("coste")).toBeUndefined();          // sin costes, no sale
    expect(filasComparacion({ avisos: 0, km: 0 }, { avisos: 0, km: 0 }).map(x => x.clave)).toEqual(["km"]);
  });
});
