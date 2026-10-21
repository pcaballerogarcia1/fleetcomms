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
    const c = cuentaExplotacion(d, { ...PARAMETROS_CALCULO, reservaPct: 0, subidaSalarialPct: 0, ipcPct: 0, interesPct: 0, residualPct: 0, aniosAmortizacion: 2 }, {}, 2);
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

describe("desde el estudio de costes del Ayuntamiento (Gozón)", async () => {
  const { readFileSync } = await import("node:fs");
  const { estudioDeCostes } = await import("./estudio.js");
  const { cuentaDesdeEstudio, ingresosBaseDe, presupuestoPrimerAnio, calcularConcurso } = await import("./calculo.js");
  const estudio = estudioDeCostes(readFileSync(new URL("./__fixtures__/gozon-ppt-anexo.txt", import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n?/).slice(1));
  it("el año 1 es su coste más nuestros gastos generales y contingencias; luego sube como dice el pliego", () => {
    const c = cuentaDesdeEstudio(estudio, { anios: 10, gastosGeneralesPct: 6, contingenciasPct: 3 });
    expect(c.porAnio).toHaveLength(10);
    expect(c.anio1.total).toBeCloseTo(1111873.85 * 1.06 * 1.03, 0);
    expect(c.porAnio[1].personal).toBeCloseTo(612918.33 * 1.0325, 1); // mano de obra +3,25 %
    expect(c.porAnio[1].inversion).toBeCloseTo(229881.52, 1);        // la amortización no sube
    expect(c.plantilla.total).toBeCloseTo(23.16, 1);                  // personas a jornada completa del estudio
  });
  it("ajustes: en % o con un importe propio", () => {
    const c = cuentaDesdeEstudio(estudio, { anios: 1, gastosGeneralesPct: 0, contingenciasPct: 0, ajustes: { personal: { pct: -10 }, otros: { importe: 100000 } } });
    expect(c.anio1.personal).toBeCloseTo(612918.33 * 0.9, 1);
    expect(c.anio1.otros).toBe(100000);
  });
  it("los ingresos de cada año siguen la tabla del pliego", () => {
    const ing = ingresosBaseDe(1278654.93, 10, estudio);
    expect(ing[9]).toBeCloseTo(1586787.46, 1);
  });
  it("el presupuesto del primer año: el estudio manda sobre el total ÷ años", () => {
    const p = presupuestoPrimerAnio({ ficha: { estudio, datos: {} }, concurso: { presupuestoSinIva: 14301991.99, duracionAnios: 4 } });
    expect(p.valor).toBe(1278654.93);
    expect(presupuestoPrimerAnio({ ficha: { datos: { precioPrimerAnio: { valor: 1406520.42 }, ivaPct: { valor: "10 %" } } } }).valor).toBeCloseTo(1278654.93, 1);
  });
  it("Gozón, estudio tal cual: el margen sale pequeño y creíble (no un 50 %)", () => {
    const r = calcularConcurso({ ficha: { estudio, datos: {}, servicios: {} }, dim: {}, calc: {}, concurso: { duracionAnios: 10 } });
    const precioSinBaja = r.presupuestoAnual * r.cuenta.factorIngresos;
    const margen = (precioSinBaja - r.cuenta.totalContrato) / precioSinBaja * 100;
    expect(r.modo).toBe("estudio");
    expect(margen).toBeGreaterThan(2);
    expect(margen).toBeLessThan(8);
  });
});
