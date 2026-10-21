import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cuentaExplotacion } from "./calculo.js";
import { estudioDeCostes } from "./estudio.js";
import { dimensionar, serviciosDelTecnico } from "./ficha.js";
import { minimoDePersonal, personalExigido, serviciosPorFrecuencia, serviciosPorMediciones, textoPersonal, vecesAlAnio } from "./tecnico.js";

const paginas = f => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n/).slice(1);

describe("frecuencias", () => {
  it("veces al año", () => {
    expect(vecesAlAnio("6 veces por semana").veces).toBe(312);
    expect(vecesAlAnio("dos veces al mes").veces).toBe(24);
    expect(vecesAlAnio("diariamente").veces).toBe(365);
    expect(vecesAlAnio("cada 15 días").veces).toBe(24);
    expect(vecesAlAnio("cuando haga falta")).toBeNull();
  });
  it("limpieza viaria de Santo Domingo: barrido manual y mecánico por zona", () => {
    const s = serviciosPorFrecuencia(paginas("viaria-ppt-frecuencias.txt"));
    expect(s).toHaveLength(8);
    expect(s[0]).toMatchObject({ nombre: "Barrido manual", zona: "Zona 1 · CASCO HISTÓRICO", cantidadAnual: 312 });
    expect(s.find(x => x.zona.startsWith("Zona 4") && x.nombre === "Barrido mecánico").cantidadAnual).toBe(104);
  });
  it("el personal que exige: jefe al 25 %, 4 peones especialistas y 4 peones", () => {
    const p = personalExigido(paginas("viaria-ppt-frecuencias.txt"));
    const texto = textoPersonal(p);
    expect(texto).toBe("1 Jefe de Servicio (25 %) · 4 Peones especialistas · 4 Peones");
    expect(minimoDePersonal(texto)).toEqual({ operarios: 8, encargados: 0, jefe: 0.25 });
  });
});

describe("mediciones del presupuesto", () => {
  it("transporte de lodos: 260 t, 130 t y 78 t con su precio", () => {
    const m = serviciosPorMediciones(paginas("lodos-mediciones.txt"));
    expect(m.map(x => [x.cantidad, x.unidad, x.precio])).toEqual([[260, "t", 21.08], [130, "t", 44.75], [78, "t", 31.28]]);
    expect(m[0].nombre).toMatch(/^Servicio de transporte de fangos EDAR Arguinegu/);
    const [prop] = serviciosDelTecnico({ mediciones: m }, "doc1");
    expect(prop.lineas[0]).toMatchObject({ nombre: "Transporte de residuos", cantidadAnual: 260, unidad: "t", precioUnitario: 21.08 });
  });
});

describe("de la ficha al coste", () => {
  it("los servicios por frecuencia se dimensionan y la plantilla no baja del mínimo del pliego", () => {
    const [prop] = serviciosDelTecnico({ frecuencias: serviciosPorFrecuencia(paginas("viaria-ppt-frecuencias.txt")) }, "d");
    const d = dimensionar(prop.lineas);
    expect(d.equipos.map(e => e.equipo).sort()).toEqual(["barredora", "carro de barrido manual"]);
    const c = cuentaExplotacion(d, { minimoPliego: { operarios: 8, encargados: 0, jefe: 0.25 } });
    expect(c.plantilla.servicio).toBeGreaterThanOrEqual(8);
    expect(c.plantilla.jefe).toBe(0.25);
  });
  it("estructura de costes con el total en la línea del título (Anexo II de Santo Domingo)", () => {
    const e = estudioDeCostes(paginas("viaria-estructura-costes.txt"));
    expect(e.partidas.map(p => [p.id, p.total])).toEqual([["personal", 260672.5], ["funcionamiento", 59444.91], ["otros", 38751.25], ["inversion", 61636.5]]);
    expect([e.costeEjecucion, e.ggbiPct, e.baseImponible, e.ivaPct, e.totalConIva, e.cuadra]).toEqual([420505.15, 8, 454145.57, 10, 499560.12, true]);
  });
});

describe("transporte a demanda (UT4, lodos de Gran Canaria)", () => {
  it("a demanda, de dónde y a dónde, y las mediciones de un mes pasadas al año", async () => {
    const { aDemanda, destinoDelTransporte, lugaresDeRealizacion, origenDe, periodoDeMediciones } = await import("./tecnico.js");
    const texto = ["El servicio se prestará de manera discrecional, en función de las necesidades de cada una de las plantas. Tragsa no tendrá obligación de solicitar un determinado número de unidades. Los fangos serán transportados hasta el vertedero de Salto del Negro en la isla de Gran Canaria.\n- EDAR Arguineguín: Lomo Las Casas, Carretera GC-505, Cercados de Espinos s/n (San Bartolomé de\nTirajana) CP: 35128\n- EDAR La Aldea: C/ Las Marciégas no2 (San Nicolás de Tolentino) CP: 35470"];
    expect(aDemanda(texto)).toBeTruthy();
    expect(aDemanda(["Se prestará en función de las necesidades del servicio."])).toBeNull();
    expect(destinoDelTransporte(texto)).toMatchObject({ tipo: "vertedero", nombre: "Salto del Negro" });
    expect(lugaresDeRealizacion(texto)).toEqual([
      { nombre: "EDAR Arguineguín", direccion: "Lomo Las Casas, Carretera GC-505, Cercados de Espinos s/n", municipio: "San Bartolomé de Tirajana" },
      { nombre: "EDAR La Aldea", direccion: "C/ Las Marciégas no2", municipio: "San Nicolás de Tolentino" },
    ]);
    expect(origenDe("Servicio de transporte de fangos EDAR La Aldea a instalación autorizada")).toBe("EDAR La Aldea");
    const m = serviciosPorMediciones(paginas("lodos-mediciones.txt"));
    expect(periodoDeMediciones(m, { presupuestoSinIva: 13738.14, meses: 1 }).factorAnual).toBe(12);
    expect(periodoDeMediciones(m, { presupuestoSinIva: 13738.14, meses: 12 }).factorAnual).toBe(1);
    expect(periodoDeMediciones(m, { presupuestoSinIva: 50000, meses: 1 }).factorAnual).toBe(1); // no suman el presupuesto: no se toca
  });

  it("servicios guardados con las cantidades del mes: se detecta y se dice cuánto multiplicar", async () => {
    const { revisarPeriodo, contextoDelConcurso } = await import("./ficha.js");
    const servicios = [{ id: "a", cantidadAnual: 260, precioUnitario: 21.08 }, { id: "b", cantidadAnual: 130, precioUnitario: 44.75 }, { id: "c", cantidadAnual: 78, precioUnitario: 31.28 }];
    const ctx = contextoDelConcurso({ datos: { importeSinIva: { valor: 13738.14, estado: "confirmado" }, duracion: { valor: "1 meses", estado: "confirmado" } } }, {});
    expect(revisarPeriodo(servicios, ctx)).toMatchObject({ factor: 12, meses: 1, ids: ["a", "b", "c"] });
    expect(revisarPeriodo(servicios.map(s => ({ ...s, periodoMeses: 1 })), ctx)).toBeNull(); // ya pasadas
  });

  it("por viajes: km, carga y horas; a demanda solo cuenta lo que se usa; el camión no se amortiza en un mes", async () => {
    const { viajesDe } = await import("./ficha.js");
    const v = viajesDe({ nombre: "Transporte de residuos", unidad: "t", cantidadAnual: 3120, kmIda: 61.2, minutosIda: 50 });
    expect(v.viajesAnio).toBe(156);
    expect(v.horasViaje).toBeCloseTo((100 / 60) * 1.15 + 1, 6);
    expect(v.kmAnio).toBeCloseTo(156 * 2 * 61.2, 6);
    expect(viajesDe({ nombre: "Transporte de residuos", unidad: "t", cantidadAnual: 100 })).toBeNull(); // sin km: no se inventa
    const lineas = [{ id: "a", nombre: "Transporte de residuos", unidad: "t", cantidadAnual: 3120, kmIda: 61.2, minutosIda: 50, vehiculo: "camión bañera", precioUnitario: 21.08 }];
    const d = dimensionar(lineas);
    expect(d.lineas[0].sinKm).toBeUndefined();
    const fijo = cuentaExplotacion(d, {}, {}, 1 / 12);
    const dem = cuentaExplotacion(d, { aDemanda: true }, {}, 1 / 12);
    expect(fijo.plantilla.encargados).toBe(1);
    expect(dem.plantilla).toMatchObject({ encargados: 0, jefe: 0 });
    expect(dem.plantilla.servicio).toBeLessThan(1);
    expect(dem.vehiculos[0].unidades).toBeLessThan(1);
    expect(dem.vehiculos[0].combustible).toBeCloseTo(v.kmAnio * 0.55, 6); // por km
    // un contrato de un mes no paga el camión entero: se reparte en su vida útil
    expect(fijo.amortizacionCorta).toBe(8);
    expect(fijo.vehiculos[0].amortizacion).toBeLessThan(140000 / 5);
    expect(dem.anio1.total).toBeLessThan(fijo.anio1.total);
  });
});

describe("clase del documento", () => {
  it("un pliego técnico que nombra el administrativo sigue siendo técnico", async () => {
    const { leerPliego } = await import("./pliego.js");
    expect(leerPliego(["PLIEGO DE PRESCRIPCIONES TÉCNICAS PARTICULARES PARA LA CONTRATACIÓN DEL SERVICIO. Este pliego, junto con el Pliego de Cláusulas Administrativas Particulares, rigen la adjudicación."]).clase).toBe("tecnico");
    expect(leerPliego(["PLIEGO DE CLÁUSULAS ADMINISTRATIVAS PARTICULARES. El pliego de prescripciones técnicas define el servicio."]).clase).toBe("administrativo");
  });
  it("la subrogación de verdad, no la cláusula de impagos", async () => {
    const { leerPliego } = await import("./pliego.js");
    const impagos = leerPliego(["Resolución por impago de salarios a trabajadores en los que procediera la subrogación de conformidad con el artículo 130 de la LCSP."]);
    expect(impagos.datos.find(d => d.id === "subrogacion")).toBeUndefined();
    const si = leerPliego(["El adjudicatario deberá subrogar al personal que presta actualmente el servicio, según el anexo."]);
    expect(si.datos.find(d => d.id === "subrogacion")).toBeTruthy();
  });
});
