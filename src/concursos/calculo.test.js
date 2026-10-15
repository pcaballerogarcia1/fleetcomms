import { describe, expect, it } from "vitest";
import { cuentaExplotacion, cuotaAnual, PARAMETROS_CALCULO } from "./calculo.js";
import { dimensionar } from "./ficha.js";

describe("cuenta de explotación", () => {
  const d = dimensionar([{ id: "a", nombre: "Lavado interior", ubicacion: "Soterrado", cantidadAnual: 5000, porTurno: 25, vehiculo: "camión lavacontenedores", personas: 2 }], { jornadasAnio: 250, horasTurno: 7, horasAnualesConvenio: 1720, absentismoPct: 0 });
  it("cuota de un vehículo: sin interés, lo que pierde de valor entre los años", () => {
    expect(cuotaAnual(100000, 4, 0, 10)).toBe(22500);
    expect(cuotaAnual(100000, 4, 5, 0)).toBeCloseTo(28201.18, 1);
  });
  it("plantilla, vehículos, partidas y precio objetivo = coste ÷ (1 − margen)", () => {
    // 200 turnos × 7 h × 2 personas = 2.800 h ÷ 1.720 = 1,63 → 2 personas; 0,8 turnos al día → 1 camión
    const c = cuentaExplotacion(d, { ...PARAMETROS_CALCULO, reservaPct: 0, subidaSalarialPct: 0, ipcPct: 0, interesPct: 0, residualPct: 0 }, {}, 2);
    expect(c.plantilla).toMatchObject({ servicio: 2, encargados: 1, jefe: 0.5 });
    expect(c.vehiculos[0]).toMatchObject({ unidades: 1, reserva: 0, total: 1, amortizacion: 125000 });
    expect(c.porAnio).toHaveLength(2);
    expect(c.porAnio[0].total).toBeCloseTo(c.porAnio[1].total, 6);
    expect(c.precios.objetivo).toBeCloseTo(c.costeMedioAnual / 0.92, 6);
    const sumaPartidas = ["personal", "vehiculos", "operacion", "consumibles", "estructura", "gastosGenerales", "contingencias"].reduce((s, k) => s + c.anio1[k], 0);
    expect(sumaPartidas).toBeCloseTo(c.anio1.total, 6);
  });
  it("si se rinde menos, hacen falta más personas y turnos", () => {
    const base = cuentaExplotacion(d, PARAMETROS_CALCULO, {}, 1);
    const peor = cuentaExplotacion(d, PARAMETROS_CALCULO, {}, 1, { rendimiento: 0.5 });
    expect(peor.plantilla.servicio).toBeGreaterThan(base.plantilla.servicio);
    expect(peor.costeMedioAnual).toBeGreaterThan(base.costeMedioAnual);
  });
});
