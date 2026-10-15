import { describe, expect, it } from "vitest";
import { dimensionar, fraccionDe, rendimientoOrientativo, serviciosDeDatos, tablasParaServicios } from "./ficha.js";

describe("ficha de requisitos", () => {
  it("fracciones como las llaman los pliegos", () => {
    expect(fraccionDe("RSU")).toBe("Resto");
    expect(fraccionDe("ENVASOS")).toBe("Envases");
    expect(fraccionDe("ORGANICA")).toBe("Orgánica");
    expect(fraccionDe("PAPEL")).toBe("Papel y cartón");
  });

  it("tablas del anexo → servicios al año; las repetidas y las de periodo, sin marcar", () => {
    const tablas = [
      { titulo: "LIMPIEZA EXTERIOR Temporada UD Nº VECES/", pagina: 10, filas: [{ grupo: "SOTERRADOS", concepto: "Baja (oct-abril)", valores: [543, 2, 7602] }, { grupo: "SOTERRADOS", concepto: "Alta (mayo-sept)", valores: [543, 4, 10860] }] },
      { titulo: "SOTERRADO", cabecera: null, pagina: 3, filas: [{ grupo: "SOTERRADO", concepto: "RSU 166 TRIMESTRAL", valores: [166, 166, 166, 166] }, { grupo: "SOTERRADO", concepto: "PAPEL 115 TRIMESTRAL", valores: [115, 115, 115, 115] }] },
      { titulo: "LAVADO FRACCIÓN 1r AÑO 2ndo AÑO 3r AÑO", pagina: 22, filas: [{ grupo: "SOTERRADO", concepto: "RSU", valores: [1992, 1992, 1992, 1992] }, { grupo: "SUPERFICIE", concepto: "ORGANICA", valores: [552, 552, 552, 552] }] },
      { titulo: "LIMPIEZA EXTERIOR 1r AÑO 2ndo AÑO 3r AÑO", pagina: 23, filas: [{ grupo: null, concepto: "SOTERRADO", valores: [14675, 14675, 14675, 14675] }, { grupo: null, concepto: "SUPERFICIE", valores: [11424, 11424, 11424, 11424] }] },
    ];
    const t = tablasParaServicios(tablas, "doc1");
    const exterior = t.find(x => x.pagina === 10);
    expect(exterior.usar).toBe(true);
    expect(exterior.lineas.map(l => l.cantidadAnual)).toEqual([7602, 10860]); // 543 × 2 × 7 meses: la columna anual
    expect(t.find(x => x.pagina === 3).usar).toBe(false); // por trimestre
    const lavado = t.find(x => x.pagina === 22);
    expect(lavado.usar).toBe(true);
    expect(lavado.lineas[0]).toMatchObject({ nombre: "Lavado interior", fraccion: "Resto", ubicacion: "Soterrado", cantidadAnual: 1992 });
    const repetida = t.find(x => x.pagina === 23);
    expect(repetida.usar).toBe(false);
    expect(repetida.motivo).toMatch(/repite «Limpieza exterior» de la pág\. 10 con otra cifra/);
  });

  it("servicio del texto: contenedores × veces al año", () => {
    const datos = [
      { id: "contenedores", valor: 6037, pagina: 2, frase: "contenedores … 6.037 unidades" },
      { id: "vecesAnio", valor: "4 operaciones de lavado al año", pagina: 2, frase: "cuatro (4) operaciones de lavado por unidad de contenedor y año" },
    ];
    const [s] = serviciosDeDatos(datos, "d");
    expect(s.lineas[0]).toMatchObject({ nombre: "Lavado interior", cantidadAnual: 24148, unidades: 6037 });
  });

  it("dimensionar por rendimientos: turnos, vehículos y personas", () => {
    // 24.148 lavados al año a 70 por turno = 345 turnos; en 357 días → 1 vehículo al 97 %
    const r = dimensionar([{ id: "a", nombre: "Lavado interior", ubicacion: null, cantidadAnual: 24148 }], { jornadasAnio: 357, horasTurno: 7, personasPorEquipo: 1, horasAnualesConvenio: 1720, absentismoPct: 6 });
    expect(r.lineas[0].porTurno).toBe(70);
    expect(Math.round(r.lineas[0].turnosAnio)).toBe(345);
    expect(r.equipos[0]).toMatchObject({ unidades: 1 });
    expect(Math.round(r.equipos[0].ocupacion * 100)).toBe(97);
    expect(r.resumen).toMatchObject({ vehiculos: 1, personas: 2 }); // 2.415 h / (1.720 × 0,94)
    // dos servicios en el mismo equipo comparten vehículo
    const dos = dimensionar([{ id: "a", nombre: "Correctivo", cantidadAnual: 300, porTurno: 10, equipo: "Taller" }, { id: "b", nombre: "Achiques", cantidadAnual: 144, porTurno: 10, equipo: "Taller" }]);
    expect(dos.equipos).toHaveLength(1);
    expect(dos.resumen.vehiculos).toBe(1);
  });

  it("rendimiento orientativo según servicio y ubicación", () => {
    expect(rendimientoOrientativo({ nombre: "Lavado interior", ubicacion: "Soterrado" }).porTurno).toBe(25);
    expect(rendimientoOrientativo({ nombre: "Lavado interior", ubicacion: "Superficie" }).porTurno).toBe(70);
    expect(rendimientoOrientativo({ nombre: "Algo raro" }).porTurno).toBe(50);
  });
});
