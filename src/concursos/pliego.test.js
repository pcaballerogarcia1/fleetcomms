import { describe, expect, it } from "vitest";
import { buscarEnPliego, frecuenciasDelServicio, leerPliego, mediosMinimosDe, numeroEs, tablasDeCantidades } from "./pliego.js";

// Trozos con la forma de pliegos reales (técnico, anuncio de la Plataforma de Contratación y anexo)
const TECNICO = [
  "Expte. CE. 26/2026 PPTP\nPLIEGO DE PRESCRIPCIONES TÉCNICAS PARTICULARES PARA EL SERVICIO DE\nLAVADO DE CONTENEDORES DE LAS FRACCIONES “ORGÁNICA” Y “RESTO”",
  "1. OBJETO DEL CONTRATO\nContrato de servicio, para el lavado interior y exterior de contenedores de carga lateral, de las fracciones Orgánica y Resto, en la ciudad de Sevilla.\nPara ello se establecen dos (2) lotes:\n• Lote 1. Lavado de contenedores de carga lateral, de superficie.\n• Lote 2.- Lavado de contendores de carga superior bilateral, de superficie y\nsoterrados.\nEl total estimado de contenedores sujetos a tratamiento de limpieza alcanzan las 6.037\nunidades, con cuatro (4) operaciones de lavado por unidad de contenedor y año,\nalcanzándose, por tanto, 24.148 operaciones de lavado al año.\nLa duración del contrato será de tres años (3), con posibilidad de una prórroga adicionales de un\n(1) año.",
  "El servicio se realizará de lunes a domingo, tanto en horario diurno como en horario\nnocturno.\nTURNO MAÑANA De 06:30h a 13:30h TURNO NOCHE De 23:00h a 06:00h\nSuma contenedores 2.709 1.327 1.877 5.913\nSuma lavados (4 lav./año) 10.836 5.308 7.508 23.652\nLos equipos a utilizar deberán tener una antigüedad máxima de 15 años. Se valorará la puesta a disposición de equipos más nuevos.\nlos adjudicatarios deberán estar en condiciones de iniciar la actividad en un plazo no superior a 30 días tras la firma del contrato.\nPor lo tanto, el número de jornadas computables al año alcanzan las 357.",
];
const ANUNCIO = [
  "Contacto\nValor estimado del contrato 800.342,8 EUR.\nImporte 484.207,39 EUR.\nImporte (sin impuestos) 400.171,4 EUR.\nPlazo de Ejecución\n12 Mes(es)\nDocumento de Pliegos\nNúmero de Expediente C.E. 26/2026\nPublicado en la Plataforma de Contratación del Sector Público\nClasificación CPV\n90918000 - Servicio de limpieza de cubos de basura.\nProcedimiento Abierto\nNº de Lotes: 2\nEntidad Adjudicadora\nComisión Ejecutiva de la Limpieza Pública (LIPASAM)\nTipo de Administración Organismo de Derecho público",
  "Plazo de Presentación de Oferta\nHasta el 05/11/2026 a las 23:59",
];
const ANEXO = [
  "ANEXO I - Unidades estimadas anuales:\nLAVADO FRACCIÓN 1r AÑO 2ndo AÑO 3r AÑO\n1ra\nPrórroga\nSOTERRADO\nRSU 1.992 1.992 1.992 1.992\nPAPEL 230 230 230 230\nSUPERFICIE\nRSU 1.476 1.476 1.476 1.476 Firmado por: ALGUIEN\nPAPEL 118 118 118 118",
];
const dato = (r, id) => r.datos.find(d => d.id === id)?.valor;

describe("lector de pliegos", () => {
  it("números en español", () => {
    expect(numeroEs("1.234.567,89")).toBe(1234567.89);
    expect(numeroEs("800.342,8")).toBe(800342.8);
    expect(numeroEs("357")).toBe(357);
  });

  it("pliego técnico: objeto, lotes, contenedores, frecuencia, horarios y exigencias", () => {
    const r = leerPliego(TECNICO);
    expect(r.clase).toBe("tecnico");
    expect(r.tipo).toBe("residuos");
    expect(dato(r, "expediente")).toBe("CE. 26/2026");
    expect(dato(r, "objeto")).toMatch(/^Contrato de servicio, para el lavado/);
    expect(dato(r, "lote1")).toBe("Lavado de contenedores de carga lateral, de superficie");
    expect(dato(r, "contenedores")).toBe(6037);
    expect(dato(r, "operacionesAnio")).toBe(24148);
    expect(dato(r, "vecesAnio")).toMatch(/^4 /);
    expect(dato(r, "duracion")).toBe("3 años");
    expect(dato(r, "prorroga")).toBe("1 año");
    expect(dato(r, "antiguedad")).toBe("15 años");
    expect(dato(r, "inicio")).toBe("30 días");
    expect(dato(r, "jornadasAnio")).toBe(357);
    expect(dato(r, "dias")).toBe("De lunes a domingo");
    expect(r.datos.filter(d => d.id.startsWith("horario")).map(d => d.valor)).toEqual(["06:30 – 13:30", "23:00 – 06:00"]);
    expect(r.listas.fracciones.map(f => f.nombre)).toEqual(expect.arrayContaining(["Resto", "Orgánica / biorresiduo"]));
    expect(r.requisitos.some(q => /antigüedad máxima de 15 años/.test(q.texto))).toBe(true);
    // cada dato, con su página y su frase
    const c = r.datos.find(d => d.id === "contenedores");
    expect(c.pagina).toBe(2);
    expect(c.frase).toMatch(/6\.037/);
  });

  it("anuncio de la Plataforma de Contratación: importes, plazo, fecha límite, entidad", () => {
    const r = leerPliego(ANUNCIO);
    expect(r.clase).toBe("anuncio");
    expect(dato(r, "valorEstimado")).toBe(800342.8);
    expect(dato(r, "importeSinIva")).toBe(400171.4);
    expect(dato(r, "importeConIva")).toBe(484207.39);
    expect(dato(r, "duracion")).toBe("12 meses");
    expect(dato(r, "fechaLimite")).toBe("2026-11-05");
    expect(dato(r, "lotes")).toBe(2);
    expect(dato(r, "organismo")).toBe("Comisión Ejecutiva de la Limpieza Pública (LIPASAM)");
    expect(dato(r, "cpv")).toMatch(/^90918000/);
  });

  it("tablas de cantidades de los anexos (sin el pie de firma)", () => {
    const t = tablasDeCantidades(ANEXO);
    expect(t).toHaveLength(1);
    expect(t[0].titulo).toMatch(/^LAVADO FRACCIÓN|ANEXO I/);
    expect(t[0].filas.map(({ grupo, concepto, valores }) => ({ grupo, concepto, valores }))).toEqual([
      { grupo: "SOTERRADO", concepto: "RSU", valores: [1992, 1992, 1992, 1992] },
      { grupo: "SOTERRADO", concepto: "PAPEL", valores: [230, 230, 230, 230] },
      { grupo: "SUPERFICIE", concepto: "RSU", valores: [1476, 1476, 1476, 1476] },
      { grupo: "SUPERFICIE", concepto: "PAPEL", valores: [118, 118, 118, 118] },
    ]);
  });

  it("buscar sin acentos ni mayúsculas, con la página", () => {
    expect(buscarEnPliego(TECNICO, "ANTIGUEDAD")[0].pagina).toBe(3);
    expect(buscarEnPliego(TECNICO, "xy")).toEqual([]);
  });

  it("un PDF escaneado (sin texto) no se inventa nada", () => {
    const r = leerPliego(["", " ", ""]);
    expect(r.conTexto).toBe(false);
    expect(r.datos).toEqual([]);
  });
  it("frecuencias: la frase de qué se hace y cada cuánto, no informes ni pagos", () => {
    const f = frecuenciasDelServicio([
      "El adjudicatario deberá entregar a EMAYA un informe mensual con todas las actuaciones. Averías diarias Son las averías comunicadas por el servicio.",
      "Limpieza exterior con hidrolimpiadora Se prestará un servicio de lavado exterior de los contenedores con una frecuencia de cuatro veces al mes durante el período de mayo a septiembre. - Frecuencia trimestral para contenedores de envases y vidrio - Frecuencia mensual para contenedores de RSU y FORM La limpieza de los contenedores incluye el barrido.",
      "El servicio de limpieza exterior se abonará mensualmente en función del número de limpiezas. Tabla 5 Cantidades y frecuencia LIMPIEZA BAJOS SUPERFICIE TODAS 336 MENSUAL 4.032",
    ]).map(x => x.texto);
    expect(f).toEqual([
      "Se prestará un servicio de lavado exterior de los contenedores con una frecuencia de cuatro veces al mes durante el período de mayo a septiembre.",
      "Frecuencia trimestral para contenedores de envases y vidrio",
      "Frecuencia mensual para contenedores de RSU y FORM",
    ]);
  });
});

describe("tabla de maquinaria con la cantidad al final", () => {
  it("lee las unidades sin confundir «Ver Anexo 5»", () => {
    const p = ["23 MÁQUINARIA Caracteristicas Finalidad Cantidad\nBarredora CityCat V20 o similar Ver Anexo 5 Servicio de limpieza 1\nSistema quitanieves Ver Anexo 5\nVehiculo hidrolimpiador agua caliente Ver Anexo 5 Servicio de limpieza 1\nCarros limpieza manual Servicio M in. 5\nPROPUESTA MINIMA"];
    expect(mediosMinimosDe(p).map(m => [m.uds, m.concepto])).toEqual([[1, "Barredora CityCat V20 o similar"], [1, "Vehiculo hidrolimpiador agua caliente"], [5, "Carros limpieza manual (mín.)"]]);
  });
});

describe("prórroga del art. 29.4 LCSP", () => {
  it("los 9 meses mientras se adjudica el nuevo contrato no son una prórroga", () => {
    const p = ["La duración del contrato será de DIEZ (10) años, sin que esté contemplada la posibilidad de prórrogas.", "Por otro lado, y de conformidad con el articulo 29.4 LCSP, cuando al vencimiento de un contrato no se hubiera formalizado el nuevo contrato, se podrá prorrogar el contrato originario hasta que comience la ejecución del nuevo contrato y en todo caso por un periodo máximo de nueve meses."];
    expect(leerPliego(p).datos.find(d => d.id === "prorroga").valor).toBe("Sin prórroga");
  });
});

describe("memoria justificativa, objeto y tipo", () => {
  it("la memoria no es el anuncio, el objeto sale del «Asunto:» y el título manda en el tipo", () => {
    const p = ["Expediente n.º: 376/2025 Procedimiento: Contrataciones Asunto: Contratación del servicio de limpieza viaria, Punto Limpio y prestaciones accesorias en el municipio de Santo Domingo A la vista de lo dispuesto se expide la presente, MEMORIA JUSTIFICATIVA. Publicado en la Plataforma de Contratación del Sector Público.",
      "Cuestión que podría verse imposibilitada por su división en lotes. El objeto del contrato es la recogida de contenedores, contenedores, contenedores del punto limpio, residuos, residuos, contenedor. Barrido manual, barrido mecánico, baldeo y papeleras."];
    const l = leerPliego(p);
    expect(l.clase).toBe("memoria");
    expect(l.tipo).toBe("limpieza");
    expect(l.datos.find(d => d.id === "objeto").valor).toMatch(/^Contratación del servicio de limpieza viaria/);
  });
});
