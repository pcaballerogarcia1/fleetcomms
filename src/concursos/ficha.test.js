import { describe, expect, it } from "vitest";
import { equiposDelPliego, tablasDeCantidades } from "./pliego.js";
import { dimensionar, equipoDe, fraccionDe, precioDe, preciosDelPliego, rendimientoOrientativo, serviciosDeDatos, tablasParaServicios } from "./ficha.js";

// Con la forma del pliego de EMAYA (Palma): tablas con cabecera, anexo de
// cantidades por año, anexo de precios y los equipos de cada servicio
const PLIEGO = [
  "2.1. Mantenimiento Preventivo.\nSe ejecutarán, como mínimo, con una periodicidad trimestral.\nTabla 2 Planificación preventiva mínima anual\nMANTEN.\nPREVENTIVO FRACCIÓN UD FRECUENCIA\nMes 1\nMes 2\nSOTERRADO\nRSU 166 TRIMESTRAL 166 166 166 166\nPAPEL 115 TRIMESTRAL 115 115 115 115",
  "2.4. Lavado de contenedores\nLa empresa adjudicataria deberá realizar las labores de lavado interno y desinfección de los\ncontenedores de carga bilateral mediante un equipo formado por dos operarios y un camión\nlavacontenedores con una frecuencia establecida según la fracción del contenedor:\nTabla 3 Cantidades y frecuencias lavados anuales\nLAVADO FRACCIÓN UD FRECUENCIA\nCantidades\nprevistas\nanuales\nSOTERRADO\nRSU 166 MENSUAL 1.992\nPAPEL 115 SEMESTRAL 230\nSUPERFICIE\nRSU 123 MENSUAL 1.476 Firmado por: ALGUIEN",
  "2.5.1. Limpieza exterior con hidrolimpiadora\nLas tareas de limpieza exterior, realizadas por un equipo formado por un operario y un vehículo\nequipado con hidrolimpiadora, incluirán: la retirada de residuos.\nTabla 4 Cantidades y frecuencias limpieza exterior anual\nLIMPIEZA EXTERIOR Temporada UD Nº VECES/\nMES\nCantidades\nprevistas\nanuales\nSOTERRADOS\nBaja (oct-abril) 543 2 7602\nAlta (mayo-sept) 543 4 10860",
  "ANEXO I - Unidades estimadas anuales:\nMANTENIMIENTO\nPREVENTIVO FRACCIÓN 1r AÑO 2ndo AÑO 3r AÑO\nSOTERRADO\nRSU 664 664 664 664\nPAPEL 460 460 460 460\nLIMPIEZA EXTERIOR 1r AÑO 2ndo AÑO 3r AÑO\nSOTERRADO 14.675 14.675 14.675 14.675",
  "ANEXO II - Costes unitarios y partidas anuales\nLAVADO FRACCIÓN 1r AÑO 2ndo AÑO 3r AÑO 1ra prórroga\nSOTERRADO\nRSU 21,14 € 21,56 € 21,99 € 22,43 €\nPAPEL 21,14 € 21,56 € 21,99 € 22,43 €\nLIMPIEZA\nEXTERIOR 1r AÑO 2ndo AÑO 3r AÑO 1ra prórroga\nSOTERRADO 3,34 € 3,41 € 3,48 € 3,55 €",
];

describe("ficha de requisitos", () => {
  it("fracciones como las llaman los pliegos", () => {
    expect(fraccionDe("RSU")).toBe("Resto");
    expect(fraccionDe("ENVASOS")).toBe("Envases");
    expect(fraccionDe("ORGANICA")).toBe("Orgánica");
    expect(fraccionDe("PAPEL")).toBe("Papel y cartón");
  });

  it("los equipos que exige el pliego, por apartado", () => {
    const e = equiposDelPliego(PLIEGO);
    expect(e.map(x => [x.apartado, x.vehiculo, x.personas])).toEqual([
      ["2.4. Lavado de contenedores", "camión lavacontenedores", 2],
      ["2.5.1. Limpieza exterior con hidrolimpiadora", "vehículo equipado con hidrolimpiadora", 1],
    ]);
  });

  it("tablas → servicios al año, comprobando las cuentas del pliego", () => {
    const tablas = tablasDeCantidades(PLIEGO);
    const t = tablasParaServicios(tablas, "d");
    const lavado = t.find(x => x.pagina === 2);
    expect(lavado).toMatchObject({ clase: "anual", usar: true });
    expect(lavado.lineas[0]).toMatchObject({ nombre: "Lavado interior", fraccion: "Resto", ubicacion: "Soterrado", cantidadAnual: 1992, unidades: 166, frecuencia: "mensual", cuadra: true });
    expect(lavado.lineas.map(l => l.cantidadAnual)).toEqual([1992, 230, 1476]); // la fila con la firma pegada también
    const exterior = t.find(x => x.pagina === 3);
    expect(exterior.lineas.map(l => [l.cantidadAnual, l.cuadra])).toEqual([[7602, true], [10860, true]]); // 543 × 2 × 7 meses
    // la programación por trimestres repite el anexo: sin marcar
    expect(t.find(x => x.pagina === 1)).toMatchObject({ clase: "programa", usar: false });
    // el anexo dice otra cifra de limpieza exterior: se avisa
    const anexoExt = t.find(x => x.pagina === 4 && x.servicio === "Limpieza exterior");
    expect(anexoExt.usar).toBe(false);
    expect(anexoExt.motivo).toMatch(/repite «Limpieza exterior» de la pág\. 3 con otra cifra \(14\.675 frente a 18\.462\)/);
  });

  it("precio unitario y equipo de cada servicio", () => {
    const tablas = tablasDeCantidades(PLIEGO), precios = preciosDelPliego(tablas), equipos = equiposDelPliego(PLIEGO);
    const linea = { nombre: "Lavado interior", ubicacion: "Soterrado", fraccion: "Resto" };
    expect(precioDe(linea, precios)?.precio).toBe(21.14);
    expect(precioDe({ nombre: "Limpieza exterior", ubicacion: "Soterrado", fraccion: "Todas" }, precios)?.precio).toBe(3.34);
    expect(equipoDe(linea, equipos)).toMatchObject({ vehiculo: "camión lavacontenedores", personas: 2 });
    expect(equipoDe({ nombre: "Mantenimiento preventivo" }, equipos)).toBeNull(); // el pliego no lo dice
  });

  it("servicio del texto: contenedores × veces al año", () => {
    const datos = [
      { id: "contenedores", valor: 6037, pagina: 2, frase: "contenedores … 6.037 unidades" },
      { id: "vecesAnio", valor: "4 operaciones de lavado al año", pagina: 2, frase: "cuatro (4) operaciones de lavado por unidad de contenedor y año" },
    ];
    const [s] = serviciosDeDatos(datos, "d");
    expect(s.lineas[0]).toMatchObject({ nombre: "Lavado interior", cantidadAnual: 24148, unidades: 6037 });
  });

  it("dimensionar: por tipo de vehículo y con las personas de cada equipo", () => {
    // LIPASAM: 24.148 lavados al año a 70 por turno = 345 turnos; vehículo con conductor (1 persona)
    const r = dimensionar([{ id: "a", nombre: "Lavado interior", cantidadAnual: 24148, vehiculo: "vehículo lavador", personas: 1 }], { jornadasAnio: 357, horasTurno: 7, horasAnualesConvenio: 1720, absentismoPct: 6 });
    expect(Math.round(r.lineas[0].turnosAnio)).toBe(345);
    expect(r.equipos[0]).toMatchObject({ equipo: "vehículo lavador", unidades: 1, personas: 1 });
    expect(Math.round(r.equipos[0].ocupacion * 100)).toBe(97);
    expect(r.resumen).toMatchObject({ vehiculos: 1, personas: 2 }); // 2.415 h / (1.720 × 0,94) = 1,5
    // el mismo vehículo hace soterrado y superficie; el equipo de 2 personas cuenta el doble de horas
    const dos = dimensionar([
      { id: "s", nombre: "Lavado interior", ubicacion: "Soterrado", cantidadAnual: 2500, porTurno: 25, vehiculo: "camión lavacontenedores", personas: 2 },
      { id: "u", nombre: "Lavado interior", ubicacion: "Superficie", cantidadAnual: 2600, porTurno: 50, vehiculo: "camión lavacontenedores", personas: 2 },
      { id: "e", nombre: "Limpieza exterior", cantidadAnual: 18000, porTurno: 60, vehiculo: "vehículo con hidrolimpiadora", personas: 1 },
    ], { jornadasAnio: 300, horasTurno: 7 });
    expect(dos.equipos.map(e => [e.equipo, e.unidades])).toEqual([["camión lavacontenedores", 1], ["vehículo con hidrolimpiadora", 1]]);
    expect(Math.round(dos.resumen.horasAnio)).toBe(152 * 7 * 2 + 300 * 7); // (100 + 52) turnos × 2 personas + 300 × 1
  });

  it("rendimiento orientativo según servicio y ubicación", () => {
    expect(rendimientoOrientativo({ nombre: "Lavado interior", ubicacion: "Soterrado" }).porTurno).toBe(25);
    expect(rendimientoOrientativo({ nombre: "Lavado interior", ubicacion: "Superficie" }).porTurno).toBe(70);
    expect(rendimientoOrientativo({ nombre: "Algo raro" }).porTurno).toBe(50);
  });
});
