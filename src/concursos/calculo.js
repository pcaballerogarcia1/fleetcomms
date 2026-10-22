// Concursos → Cálculo: del dimensionamiento (Planning) a la cuenta de
// explotación del contrato y al precio.
//  1. Plantilla: personas de servicio (horas ÷ horas reales de un trabajador,
//     ya descontado el absentismo) + encargados + jefe de servicio.
//  2. Vehículos por tipo (más reserva): amortización con financiación,
//     combustible y consumibles por turno, mantenimiento y seguros por año.
//  3. Cuenta: costes directos, estructura, gastos generales y contingencias;
//     cada año del contrato con la subida salarial y el IPC.
//  4. Precios: el de no perder dinero (equilibrio), el del margen que se
//     quiere (coste ÷ (1 − margen)) y lo que da el presupuesto del pliego.
// Todo con valores orientativos que se cambian. Sin React ni Firebase.
import { dimensionar, entradaDimension } from "./ficha.js";
import { minimoDePersonal } from "./tecnico.js";
import { subidaAnio } from "./estudio.js";

export const PARAMETROS_CALCULO = {
  salarioOperario: 25000,   // € brutos al año de una persona de servicio (con pluses del convenio)
  ssPct: 33,                // Seguridad Social a cargo de la empresa, % del bruto
  personasPorEncargado: 15, // un encargado por cada tantas personas de servicio
  salarioEncargado: 34000,
  jefeDedicacion: 0.5,      // jefe de servicio: parte de su jornada en este contrato
  salarioJefe: 48000,
  uniformesPersona: 450,    // € al año de uniformes y EPIs por persona
  reservaPct: 10,           // vehículos de reserva, % de los necesarios (redondeado)
  residualPct: 10,          // valor que les queda a los vehículos al acabar
  interesPct: 5,            // interés de la financiación de los vehículos
  aniosAmortizacion: null,  // null = los años del contrato (en contratos cortos, la vida útil: el vehículo sigue en la empresa)
  vidaUtil: 8,              // años de vida de un vehículo, para contratos de menos de 3 años
  instalacionesAnio: 18000, // nave, vestuarios, punto de lavado…
  sistemasAnio: 6000,       // GPS, software, comunicaciones
  seguroRCAnio: 4000,       // responsabilidad civil y otros seguros del contrato
  gastosGeneralesPct: 6,    // estructura de la empresa (administración, dirección…)
  contingenciasPct: 3,      // imprevistos justificados
  margenPct: 8,             // beneficio que se quiere sobre lo que se cobra
  subidaSalarialPct: 2.5,   // cada año
  ipcPct: 2,                // cada año, para lo que no es personal
  diasCobro: 60,            // lo que tarda en cobrarse una factura
};

// Coste orientativo de cada tipo de vehículo (por el nombre)
const VEHICULOS = [
  [/ba[ñn]era|portacontenedor|volquete|cami[oó]n de transporte|bote|cuba/i, { precio: 140000, combustibleTurno: 60, combustibleKm: 0.55, consumiblesTurno: 5, mantenimientoAnio: 9000, seguroAnio: 3500 }],
  [/lavacontenedor|lava ?contenedor/i, { precio: 250000, combustibleTurno: 55, consumiblesTurno: 25, mantenimientoAnio: 12000, seguroAnio: 3000 }],
  [/recolector|recogida|compactador/i, { precio: 230000, combustibleTurno: 70, consumiblesTurno: 5, mantenimientoAnio: 14000, seguroAnio: 3500 }],
  [/carros?\b|carritos?|cubos? de barrido/i, { precio: 900, combustibleTurno: 0, consumiblesTurno: 1, mantenimientoAnio: 100, seguroAnio: 0 }],
  [/desbrozadora|soplador|sopladora|motosierra|cortac[eé]sped|cortasetos/i, { precio: 600, combustibleTurno: 2, consumiblesTurno: 1, mantenimientoAnio: 120, seguroAnio: 0 }],
  [/hidrolimpi|baldeadora|cisterna|agua a presi/i, { precio: 95000, combustibleTurno: 30, consumiblesTurno: 15, mantenimientoAnio: 6000, seguroAnio: 2000 }],
  [/barredora/i, { precio: 180000, combustibleTurno: 35, consumiblesTurno: 10, mantenimientoAnio: 10000, seguroAnio: 2500 }],
  [/fregadora/i, { precio: 70000, combustibleTurno: 20, consumiblesTurno: 10, mantenimientoAnio: 5000, seguroAnio: 1500 }],
  [/caja abierta|multiprop|auxiliar|pick.?up|volteo/i, { precio: 40000, combustibleTurno: 15, consumiblesTurno: 2, mantenimientoAnio: 2500, seguroAnio: 1200 }],
  [/gr[uú]a|pluma/i, { precio: 160000, combustibleTurno: 40, consumiblesTurno: 5, mantenimientoAnio: 8000, seguroAnio: 2500 }],
  [/autob|microb|minib/i, { precio: 300000, combustibleTurno: 90, consumiblesTurno: 5, mantenimientoAnio: 15000, seguroAnio: 4000 }],
  [/furgoneta|furg[oó]n|taller/i, { precio: 45000, combustibleTurno: 15, consumiblesTurno: 40, mantenimientoAnio: 3000, seguroAnio: 1200 }],
];
const VEHICULO_GENERICO = { precio: 100000, combustibleTurno: 30, consumiblesTurno: 10, mantenimientoAnio: 6000, seguroAnio: 2000 };
export const costeOrientativo = tipo => (VEHICULOS.find(([re]) => re.test(tipo || ""))?.[1]) || VEHICULO_GENERICO;
/** El tipo de vehículo o equipo (posición en la lista de costes), o -1 si no se reconoce */
export const categoriaDe = tipo => (/^contenedor|^papelera|^sistema\b/i.test(String(tipo || "").trim()) ? -1 : VEHICULOS.findIndex(([re]) => re.test(tipo || "")));

/**
 * La maquinaria mínima del pliego (el dato «maquinariaMinima»), por tipos:
 * «1 Barredora 5m3 · 1 Barredora V20 · 5 Carros (mín.)» → [{ cat, uds, conceptos }]
 * Lo que no es un vehículo o equipo conocido (contenedores, sistemas…) no cuenta.
 */
export function flotaDelPliego(texto) {
  const porCat = new Map();
  for (const parte of String(texto || "").split(/·|;|\n/)) {
    const m = /^\s*(\d{1,3})\s+(.+?)\s*$/.exec(parte);
    if (!m) continue;
    const cat = categoriaDe(m[2]);
    if (cat < 0) continue;
    const x = porCat.get(cat) || { cat, uds: 0, conceptos: [] };
    x.uds += Number(m[1]); x.conceptos.push(m[2].replace(/\s*\(m[ií]n\.\)$/, ""));
    porCat.set(cat, x);
  }
  return [...porCat.values()];
}

/** Cuota anual de un vehículo financiado: lo que pierde de valor más los intereses */
export function cuotaAnual(precio, anios, interesPct = 0, residualPct = 0) {
  const n = Math.max(1, anios || 1), i = (interesPct || 0) / 100, R = precio * (residualPct || 0) / 100;
  if (!i) return (precio - R) / n;
  return (precio - R) * i / (1 - (1 + i) ** -n) + R * i;
}

export const PARTIDAS = [
  ["personal", "Personal"],
  ["vehiculos", "Vehículos (amortización y financiación)"],
  ["operacion", "Combustible, mantenimiento y seguros de vehículos"],
  ["consumibles", "Materiales y consumibles"],
  ["estructura", "Instalaciones, sistemas, seguros y uniformes"],
  ["gastosGenerales", "Gastos generales"],
  ["contingencias", "Contingencias"],
];

/**
 * La cuenta de explotación de un año y la del contrato entero.
 * @param dim resultado de dimensionar()
 * @param p PARAMETROS_CALCULO (o los del concurso)
 * @param porVehiculo { [tipo]: { precio, combustibleTurno, consumiblesTurno, mantenimientoAnio, seguroAnio, reserva } } cambiados
 * @param anios años del contrato (sin prórrogas)
 * @param factores { personal, operacion, rendimiento, flotaFija } para escenarios: 1.1 = +10 %; rendimiento 0.9 = rinde un 10 % menos;
 *   flotaFija: los turnos de más se hacen con los mismos vehículos (horas extra, doble turno), no se compran otros
 */
export function cuentaExplotacion(dim, p = PARAMETROS_CALCULO, porVehiculo = {}, anios = 1, factores = {}) {
  const q = { ...PARAMETROS_CALCULO, ...p };
  const f = { personal: 1, operacion: 1, rendimiento: 1, ...factores };
  const masTrabajo = 1 / Math.max(0.1, f.rendimiento); // si rinde menos, hacen falta más turnos

  // ── plantilla ──
  const servicioETC = (dim?.resumen?.personasExactas || 0) * masTrabajo;
  // el personal mínimo que exige el pliego (minimoDePersonal): nunca por debajo
  const min = q.minimoPliego || null;
  // a demanda (se pide cuando hace falta y se paga por unidad): las horas que se usan, sin equipo fijo ni mandos propios
  const demanda = !!q.aDemanda;
  const servicio = demanda ? Math.max(servicioETC, min?.operarios || 0) : Math.max(Math.ceil(servicioETC - 1e-9), Math.ceil((min?.operarios || 0) - 1e-9));
  const encargados = demanda ? (min?.encargados || 0) : servicio ? Math.max(min?.encargados || 0, min ? 0 : Math.max(1, Math.ceil(servicio / Math.max(1, q.personasPorEncargado) - 1e-9))) : 0;
  const jefe = demanda ? (min?.jefe || 0) : servicio ? (min?.jefe || q.jefeDedicacion) : 0;
  const plantilla = {
    servicioETC, servicio, encargados, jefe, total: servicio + encargados + jefe, minimoPliego: min,
    costeServicio: servicio * q.salarioOperario * (1 + q.ssPct / 100),
    costeEncargados: encargados * q.salarioEncargado * (1 + q.ssPct / 100),
    costeJefe: jefe * q.salarioJefe * (1 + q.ssPct / 100),
  };

  // ── vehículos ──
  // contratos de menos de 3 años: el vehículo sigue en la empresa al acabar, se reparte en su vida útil
  // (salvo que pase al Ayuntamiento); si no, en los años del contrato con su valor residual
  const corto = !q.aniosAmortizacion && (anios || 0) < 3 && !q.revierte;
  const aniosAm = q.aniosAmortizacion || (corto ? q.vidaUtil : anios || 1);
  const residual = corto ? 0 : q.residualPct;
  // la maquinaria mínima del pliego manda en lo que la exige: el Ayuntamiento ya ha
  // dimensionado el servicio (lo que el pliego pide y no hace ningún servicio, se añade)
  const flota = demanda ? [] : (q.flotaPliego || []);
  const usadas = new Set();
  const equipos = [...(dim?.equipos || []).map(e => {
    const cat = categoriaDe(e.equipo), p = flota.find(x => x.cat === cat && !usadas.has(x.cat));
    if (!p) return e;
    usadas.add(p.cat);
    return { ...e, pliego: p.uds, conceptosPliego: p.conceptos };
  }), ...flota.filter(p => !usadas.has(p.cat)).map(p => ({
    equipo: p.conceptos[0], servicios: [], porDia: 0, turnosAnio: p.uds * (q.jornadasAnio || 0), pliego: p.uds, conceptosPliego: p.conceptos, soloPliego: true,
  }))];
  const vehiculos = equipos.map(e => {
    const o = { ...costeOrientativo(e.equipo), ...(porVehiculo[e.equipo] || {}) };
    const turnosAnio = e.turnosAnio * masTrabajo;
    // a demanda: la parte del vehículo que se usa (el resto del tiempo trabaja en otros contratos)
    const calculadas = demanda ? Math.min(1, e.porDia * masTrabajo) || 0 : Math.max(1, Math.ceil(e.porDia * (f.flotaFija ? 1 : masTrabajo) - 1e-9));
    const unidades = o.unidades != null && o.unidades !== "" ? Number(o.unidades) : e.pliego ?? calculadas;
    const reserva = demanda ? 0 : o.reserva != null && o.reserva !== "" ? Number(o.reserva) : Math.round(unidades * q.reservaPct / 100);
    const total = unidades + reserva;
    const cuota = cuotaAnual(Number(o.precio) || 0, aniosAm, q.interesPct, residual);
    // combustible: por km si se saben (transporte), si no por turno
    const kmAnio = (e.kmAnio || 0) * masTrabajo;
    const combustible = kmAnio && Number(o.combustibleKm) > 0 ? kmAnio * Number(o.combustibleKm) : turnosAnio * (Number(o.combustibleTurno) || 0);
    return {
      tipo: e.equipo, servicios: e.servicios, turnosAnio, unidades, reserva, total,
      ...(e.pliego != null ? { pliego: e.pliego, calculadas: e.soloPliego ? null : calculadas, conceptosPliego: e.conceptosPliego } : {}),
      precio: Number(o.precio) || 0, combustibleTurno: Number(o.combustibleTurno) || 0, consumiblesTurno: Number(o.consumiblesTurno) || 0,
      mantenimientoAnio: Number(o.mantenimientoAnio) || 0, seguroAnio: Number(o.seguroAnio) || 0,
      amortizacion: cuota * total,
      kmAnio, combustibleKm: Number(o.combustibleKm) || 0, combustible,
      operacion: combustible * f.operacion + total * ((Number(o.mantenimientoAnio) || 0) + (Number(o.seguroAnio) || 0)),
      consumibles: turnosAnio * (Number(o.consumiblesTurno) || 0) * f.operacion,
    };
  });

  // ── un año (el primero) ──
  const personas = plantilla.servicio + plantilla.encargados + (plantilla.jefe ? 1 : 0);
  const base = {
    personal: (plantilla.costeServicio + plantilla.costeEncargados + plantilla.costeJefe) * f.personal,
    vehiculos: vehiculos.reduce((s, v) => s + v.amortizacion, 0),
    operacion: vehiculos.reduce((s, v) => s + v.operacion, 0),
    consumibles: vehiculos.reduce((s, v) => s + v.consumibles, 0),
    // a demanda no hay nave, sistemas ni seguros propios del contrato: la parte de lo que se usa
    estructura: (q.instalacionesAnio + q.sistemasAnio + q.seguroRCAnio) * (demanda ? Math.min(1, plantilla.total) : 1) + Math.ceil(personas - 1e-9) * q.uniformesPersona,
  };
  const conIndirectos = b => {
    const directos = b.personal + b.vehiculos + b.operacion + b.consumibles + b.estructura;
    const gastosGenerales = directos * q.gastosGeneralesPct / 100;
    const contingencias = (directos + gastosGenerales) * q.contingenciasPct / 100;
    return { ...b, gastosGenerales, contingencias, total: directos + gastosGenerales + contingencias };
  };
  const anio1 = conIndirectos(base);

  // ── cada año del contrato: el personal sube con el convenio, lo demás con el IPC ──
  const porAnio = Array.from({ length: Math.max(1, Math.ceil(anios || 1)) }, (_, k) => {
    const s = (1 + q.subidaSalarialPct / 100) ** k, c = (1 + q.ipcPct / 100) ** k;
    const parte = anios && k === Math.ceil(anios) - 1 && anios % 1 ? anios % 1 : 1; // último año partido (contratos de 18 meses…)
    const a = conIndirectos({ personal: base.personal * s * parte, vehiculos: base.vehiculos * parte, operacion: base.operacion * c * parte, consumibles: base.consumibles * c * parte, estructura: base.estructura * c * parte });
    return { anio: k + 1, parte, ...a };
  });
  const totalContrato = porAnio.reduce((s, a) => s + a.total, 0);
  const aniosReales = porAnio.reduce((s, a) => s + a.parte, 0);
  const costeMedioAnual = totalContrato / aniosReales;

  // ── precios (anuales, sin IVA; el precio de la oferta es el mismo todos los años) ──
  const margen = Math.min(0.9, Math.max(0, q.margenPct / 100));
  const precios = { equilibrio: costeMedioAnual, objetivo: costeMedioAnual / (1 - margen) };
  // caja que hay que adelantar: lo que se gasta mientras se espera a cobrar
  const caja = costeMedioAnual / 365 * q.diasCobro;

  return { modo: "rendimientos", partidas: PARTIDAS, plantilla, vehiculos, anio1, porAnio, totalContrato, costeMedioAnual, precios, caja, anios: aniosReales, parametros: q, aDemanda: demanda, amortizacionCorta: corto ? aniosAm : null };
}

// ── Desde el estudio de costes del Ayuntamiento ──────────────────────────
export const PARTIDAS_ESTUDIO_CUENTA = [
  ["personal", "Personal"],
  ["inversion", "Vehículos, contenedores e instalaciones (amortización y financiación)"],
  ["funcionamiento", "Combustible y mantenimiento"],
  ["seguros", "Seguros"],
  ["otros", "Otros gastos (nave, mando, alquileres de temporada…)"],
  ["mejoras", "Mejoras ofertadas"],
  ["gastosGenerales", "Gastos generales de la empresa"],
  ["contingencias", "Contingencias"],
];
const VEHICULO = /veh[ií]culo|cami[oó]n|recolector|barredora|baldeadora|furg[oó]n|furgoneta|tractor|cribadora|autob|lavacontenedor|gr[uú]a/i;

/**
 * La cuenta del contrato partiendo del estudio del Ayuntamiento: sus partidas
 * (con el ajuste que se quiera, en % o con un importe propio), lo que sube cada
 * año (el del pliego: mano de obra y resto), nuestras mejoras, nuestros gastos
 * generales (no su «gastos generales y beneficio») y contingencias.
 * @param estudio estudioDeCostes()
 * @param o { ajustes: { [partida]: { pct, importe } }, personalPropio (€ año 1, p. ej. de la plantilla a subrogar),
 *            mejorasAnio, gastosGeneralesPct, contingenciasPct, margenPct, diasCobro, anios, factores }
 */
export function cuentaDesdeEstudio(estudio, o = {}) {
  const { ajustes = {}, personalPropio = null, mejorasAnio = 0, gastosGeneralesPct = 6, contingenciasPct = 3, margenPct = 8, diasCobro = 60, anios = 1, factores = {}, subidaPorDefecto } = o;
  const f = { personal: 1, operacion: 1, rendimiento: 1, ...factores };
  const masTrabajo = 1 / Math.max(0.1, f.rendimiento);
  const del = id => estudio.partidas.find(p => p.id === id)?.total || 0;
  const ajustado = (id, v) => {
    const a = ajustes[id] || {};
    if (a.importe != null && a.importe !== "" && Number.isFinite(Number(a.importe))) return Number(a.importe);
    return v * (1 + (Number(a.pct) || 0) / 100);
  };
  const base = {
    personal: (personalPropio != null ? personalPropio : ajustado("personal", del("personal"))) * f.personal * masTrabajo,
    inversion: ajustado("inversion", del("inversion")),
    funcionamiento: ajustado("funcionamiento", del("funcionamiento")) * f.operacion * masTrabajo,
    seguros: ajustado("seguros", del("seguros")),
    otros: ajustado("otros", del("otros")),
    mejoras: Number(mejorasAnio) || 0,
  };
  const n = Math.max(1, Math.ceil(anios || 1));
  let mo = 1, re = 1;
  const porAnio = [];
  for (let k = 1; k <= n; k++) {
    if (k > 1) { const s = subidaAnio(estudio, k - 1, subidaPorDefecto); mo *= 1 + s.manoObra / 100; re *= 1 + s.resto / 100; }
    const parte = anios % 1 && k === n ? anios % 1 : 1;
    const a = { personal: base.personal * mo * parte, inversion: base.inversion * parte, funcionamiento: base.funcionamiento * re * parte, seguros: base.seguros * re * parte, otros: base.otros * re * parte, mejoras: base.mejoras * re * parte };
    const directos = a.personal + a.inversion + a.funcionamiento + a.seguros + a.otros + a.mejoras;
    a.gastosGenerales = directos * gastosGeneralesPct / 100;
    a.contingencias = (directos + a.gastosGenerales) * contingenciasPct / 100;
    a.total = directos + a.gastosGenerales + a.contingencias;
    porAnio.push({ anio: k, parte, ...a });
  }
  const totalContrato = porAnio.reduce((s, a) => s + a.total, 0);
  const aniosReales = porAnio.reduce((s, a) => s + a.parte, 0);
  const costeMedioAnual = totalContrato / aniosReales;
  // plantilla y medios del estudio, para enseñarlos
  const lineasPersonal = estudio.partidas.find(p => p.id === "personal")?.lineas || [];
  const etc = lineasPersonal.filter(l => !/plus|antig[uü]edad|absentismo/i.test(l.concepto)).reduce((s, l) => s + (l.uds || 0), 0);
  const vehiculos = (estudio.partidas.find(p => p.id === "inversion")?.lineas || []).filter(l => VEHICULO.test(l.concepto)).map(l => ({ tipo: l.concepto, total: l.uds, reserva: 0, unidades: l.uds, amortizacion: l.total }));
  return {
    modo: "estudio", partidas: PARTIDAS_ESTUDIO_CUENTA, porAnio, anio1: porAnio[0], totalContrato, costeMedioAnual, anios: aniosReales,
    plantilla: { total: etc, servicio: Math.round(etc * 100) / 100, encargados: 0, jefe: 0, desdeEstudio: true },
    vehiculos, caja: costeMedioAnual / 365 * diasCobro,
    parametros: { margenPct, diasCobro, gastosGeneralesPct, contingenciasPct },
  };
}

/**
 * Lo que cobra cada año el contrato antes de la baja (sin IVA): la tabla de
 * años del estudio si la trae (el precio sube cada año); si no, el mismo
 * presupuesto todos los años.
 */
export function ingresosBaseDe(presupuestoAnual, anios, estudio) {
  const n = Math.max(1, Math.ceil(anios || 1));
  const tabla = estudio?.anios?.base || [];
  if (tabla.length >= n && presupuestoAnual) {
    const escala = presupuestoAnual / tabla[0]; // por si el presupuesto se ha corregido a mano
    return tabla.slice(0, n).map(v => v * escala);
  }
  return Array.from({ length: n }, () => presupuestoAnual || 0);
}

/** Los años del contrato que figuran en el concurso */
export const aniosDelConcurso = c => (c?.duracionMeses ? c.duracionMeses / 12 : Number(c?.duracionAnios) || 1);

/** El presupuesto anual sin IVA (el del pliego es del contrato entero, sin prórrogas) */
export const presupuestoAnualDe = c => (c?.presupuestoSinIva ? c.presupuestoSinIva / aniosDelConcurso(c) : null);

const valorDato = (ficha, clave) => { const d = ficha?.datos?.[clave]; return d && d.estado !== "descartado" ? d.valor : null; };
const pctDe = v => (v == null ? null : Number(String(v).replace(",", ".").replace(/[^\d.]/g, "")) || null);

/**
 * El presupuesto del PRIMER año, sin IVA, y de dónde sale (lo más fiable primero):
 * escrito a mano > estudio de costes > precio del primer año del pliego (sin el IVA) >
 * importe anual > presupuesto total ÷ años.
 */
export function presupuestoPrimerAnio({ calc, ficha, concurso }) {
  if (Number(calc?.presupuestoAnual) > 0) return { valor: Number(calc.presupuestoAnual), fuente: "escrito a mano" };
  if (ficha?.estudio?.baseImponible) return { valor: ficha.estudio.baseImponible, fuente: "estudio de costes del pliego (año 1)" };
  const iva = pctDe(valorDato(ficha, "ivaPct")) ?? ficha?.estudio?.ivaPct ?? null;
  const primer = Number(valorDato(ficha, "precioPrimerAnio"));
  if (primer > 0 && iva != null) return { valor: primer / (1 + iva / 100), fuente: `precio del primer año del pliego, sin el ${iva} % de IVA` };
  if (primer > 0) return { valor: primer, fuente: "precio del primer año del pliego (¿lleva IVA? compruébalo)", dudoso: true };
  const anual = Number(valorDato(ficha, "importeAnual"));
  if (anual > 0) return /sin IVA/i.test(ficha?.datos?.importeAnual?.nombre || "") ? { valor: anual, fuente: "presupuesto de un año del pliego" } : { valor: anual, fuente: "importe anual del pliego", dudoso: true };
  const p = presupuestoAnualDe(concurso);
  if (p) return { valor: p, fuente: "presupuesto total sin IVA ÷ años del contrato", dudoso: true };
  // solo el presupuesto base de licitación, que lleva el IVA
  if (concurso?.presupuestoConIva) {
    const t = iva ?? 21;
    return { valor: concurso.presupuestoConIva / (1 + t / 100) / aniosDelConcurso(concurso), fuente: `presupuesto base con IVA, sin el ${t} %${iva == null ? " (el pliego no dice el tipo: supuesto)" : ""}, ÷ años`, dudoso: true };
  }
  return { valor: null, fuente: null };
}

/**
 * El precio por unidad de cada servicio que tiene precio máximo en el pliego
 * (€/t, €/servicio…): su parte del coste (por el tiempo de equipo que se lleva)
 * entre su cantidad, con el margen; y la baja que supone sobre el máximo.
 * @returns [{ id, nombre, ubicacion, unidad, cantidadAnual, coste, objetivo, maximo, bajaPct }]
 */
export function preciosUnitarios(d, cuenta, margen = 0) {
  const lineas = d?.lineas || [];
  const turnos = lineas.reduce((s, l) => s + (l.turnosAnio || 0), 0);
  const total = cuenta?.porAnio?.length ? cuenta.totalContrato / Math.max(0.01, cuenta.anios) : cuenta?.anio1?.total || 0;
  if (!turnos || !total) return [];
  return lineas.filter(l => Number(l.precioUnitario) > 0 && Number(l.cantidadAnual) > 0).map(l => {
    const coste = (total * (l.turnosAnio / turnos)) / l.cantidadAnual, objetivo = coste / (1 - margen), maximo = Number(l.precioUnitario);
    return { id: l.id, nombre: l.nombre, ubicacion: l.ubicacion || null, unidad: l.unidad || "ud", cantidadAnual: l.cantidadAnual, coste, objetivo, maximo, bajaPct: (1 - objetivo / maximo) * 100 };
  });
}

/** Todo a partir de lo guardado: dimensionamiento y cuenta */
// lo que está vacío no cambia el valor orientativo
const sinVacios = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== "" && !Number.isNaN(v)));

export function calcularConcurso({ ficha, dim, calc, concurso, factores, mejorasAnio } = {}) {
  const { entrada, parametros } = entradaDimension(ficha, dim);
  const d = dimensionar(entrada, parametros);
  const anios = aniosDelConcurso(concurso);
  const p = { ...PARAMETROS_CALCULO, ...sinVacios(calc?.parametros) };
  const estudio = ficha?.estudio || null;
  const modo = calc?.base === "rendimientos" || !estudio ? "rendimientos" : "estudio";
  const personalPropio = calc?.usarPlantilla && calc?.plantilla?.coste ? calc.plantilla.coste : null;
  const mejoras = mejorasAnio ?? (Number(calc?.mejorasAnio) || 0);
  let cuenta;
  if (modo === "estudio") {
    cuenta = cuentaDesdeEstudio(estudio, { ajustes: calc?.ajustes || {}, personalPropio, mejorasAnio: mejoras || 0, gastosGeneralesPct: p.gastosGeneralesPct, contingenciasPct: p.contingenciasPct, margenPct: p.margenPct, diasCobro: p.diasCobro, anios, factores, subidaPorDefecto: { manoObra: p.subidaSalarialPct, resto: p.ipcPct } });
  } else {
    const porVehiculo = Object.fromEntries(Object.entries(calc?.vehiculos || {}).map(([k, v]) => [k, sinVacios(v)]));
    // si la maquinaria pasa al Ayuntamiento, no le queda valor
    const revierte = valorDato(ficha, "revierte");
    const minimoPliego = minimoDePersonal(valorDato(ficha, "personalMinimo"));
    const demanda = calc?.aDemanda ?? !!valorDato(ficha, "aDemanda");
    const flotaPliego = calc?.sinFlotaPliego ? [] : flotaDelPliego(valorDato(ficha, "maquinariaMinima"));
    cuenta = cuentaExplotacion(d, { ...p, minimoPliego, flotaPliego, jornadasAnio: parametros.jornadasAnio, aDemanda: demanda, revierte: !!revierte, ...(revierte && calc?.parametros?.residualPct == null ? { residualPct: 0 } : {}) }, porVehiculo, anios, factores);
    if (mejoras) for (const a of cuenta.porAnio) { a.mejoras = mejoras * a.parte; a.total += mejoras * a.parte; }
    if (mejoras) { cuenta.totalContrato = cuenta.porAnio.reduce((s, a) => s + a.total, 0); cuenta.costeMedioAnual = cuenta.totalContrato / cuenta.anios; }
  }
  const pres = presupuestoPrimerAnio({ calc, ficha, concurso });
  const ingresosBase = ingresosBaseDe(pres.valor, anios, estudio);
  // lo que pesan los años en el precio del primero (si el precio sube cada año, más de un año por año)
  const factorIngresos = pres.valor ? ingresosBase.reduce((s, v, k) => s + v * (cuenta.porAnio[k]?.parte ?? 1), 0) / pres.valor : cuenta.anios;
  const margen = Math.min(0.9, Math.max(0, p.margenPct / 100));
  const equilibrio = cuenta.totalContrato / Math.max(0.01, factorIngresos);
  cuenta.precios = { equilibrio, objetivo: equilibrio / (1 - margen) };
  cuenta.factorIngresos = factorIngresos;
  cuenta.ingresosBase = ingresosBase;
  cuenta.preciosUnitarios = preciosUnitarios(d, cuenta, margen);
  return { dimension: d, parametrosDimension: parametros, cuenta, anios, modo, estudio, presupuestoAnual: pres.valor, fuentePresupuesto: pres, costeEquivalente: equilibrio };
}
