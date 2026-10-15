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
  aniosAmortizacion: null,  // null = los años del contrato
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
  [/lavacontenedor|lava ?contenedor/i, { precio: 250000, combustibleTurno: 55, consumiblesTurno: 25, mantenimientoAnio: 12000, seguroAnio: 3000 }],
  [/recolector|recogida|compactador/i, { precio: 230000, combustibleTurno: 70, consumiblesTurno: 5, mantenimientoAnio: 14000, seguroAnio: 3500 }],
  [/hidrolimpiadora|baldeadora|cisterna|agua a presi/i, { precio: 95000, combustibleTurno: 30, consumiblesTurno: 15, mantenimientoAnio: 6000, seguroAnio: 2000 }],
  [/barredora/i, { precio: 180000, combustibleTurno: 35, consumiblesTurno: 10, mantenimientoAnio: 10000, seguroAnio: 2500 }],
  [/gr[uú]a|pluma/i, { precio: 160000, combustibleTurno: 40, consumiblesTurno: 5, mantenimientoAnio: 8000, seguroAnio: 2500 }],
  [/autob|microb|minib/i, { precio: 300000, combustibleTurno: 90, consumiblesTurno: 5, mantenimientoAnio: 15000, seguroAnio: 4000 }],
  [/furgoneta|furg[oó]n|taller/i, { precio: 45000, combustibleTurno: 15, consumiblesTurno: 40, mantenimientoAnio: 3000, seguroAnio: 1200 }],
];
const VEHICULO_GENERICO = { precio: 100000, combustibleTurno: 30, consumiblesTurno: 10, mantenimientoAnio: 6000, seguroAnio: 2000 };
export const costeOrientativo = tipo => (VEHICULOS.find(([re]) => re.test(tipo || ""))?.[1]) || VEHICULO_GENERICO;

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
  const servicio = Math.ceil(servicioETC - 1e-9);
  const encargados = servicio ? Math.max(1, Math.ceil(servicio / Math.max(1, q.personasPorEncargado) - 1e-9)) : 0;
  const jefe = servicio ? q.jefeDedicacion : 0;
  const plantilla = {
    servicioETC, servicio, encargados, jefe, total: servicio + encargados + jefe,
    costeServicio: servicio * q.salarioOperario * (1 + q.ssPct / 100),
    costeEncargados: encargados * q.salarioEncargado * (1 + q.ssPct / 100),
    costeJefe: jefe * q.salarioJefe * (1 + q.ssPct / 100),
  };

  // ── vehículos ──
  const aniosAm = q.aniosAmortizacion || anios || 1;
  const vehiculos = (dim?.equipos || []).map(e => {
    const o = { ...costeOrientativo(e.equipo), ...(porVehiculo[e.equipo] || {}) };
    const turnosAnio = e.turnosAnio * masTrabajo;
    const unidades = Math.max(1, Math.ceil(e.porDia * (f.flotaFija ? 1 : masTrabajo) - 1e-9));
    const reserva = o.reserva != null && o.reserva !== "" ? Number(o.reserva) : Math.round(unidades * q.reservaPct / 100);
    const total = unidades + reserva;
    const cuota = cuotaAnual(Number(o.precio) || 0, aniosAm, q.interesPct, q.residualPct);
    return {
      tipo: e.equipo, servicios: e.servicios, turnosAnio, unidades, reserva, total,
      precio: Number(o.precio) || 0, combustibleTurno: Number(o.combustibleTurno) || 0, consumiblesTurno: Number(o.consumiblesTurno) || 0,
      mantenimientoAnio: Number(o.mantenimientoAnio) || 0, seguroAnio: Number(o.seguroAnio) || 0,
      amortizacion: cuota * total,
      operacion: (turnosAnio * (Number(o.combustibleTurno) || 0)) * f.operacion + total * ((Number(o.mantenimientoAnio) || 0) + (Number(o.seguroAnio) || 0)),
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
    estructura: q.instalacionesAnio + q.sistemasAnio + q.seguroRCAnio + personas * q.uniformesPersona,
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

  return { plantilla, vehiculos, anio1, porAnio, totalContrato, costeMedioAnual, precios, caja, anios: aniosReales, parametros: q };
}

/** Los años del contrato que figuran en el concurso */
export const aniosDelConcurso = c => (c?.duracionMeses ? c.duracionMeses / 12 : Number(c?.duracionAnios) || 1);

/** El presupuesto anual sin IVA (el del pliego es del contrato entero, sin prórrogas) */
export const presupuestoAnualDe = c => (c?.presupuestoSinIva ? c.presupuestoSinIva / aniosDelConcurso(c) : null);

/** Todo a partir de lo guardado: dimensionamiento y cuenta */
// lo que está vacío no cambia el valor orientativo
const sinVacios = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== "" && !Number.isNaN(v)));

export function calcularConcurso({ ficha, dim, calc, concurso, factores } = {}) {
  const { entrada, parametros } = entradaDimension(ficha, dim);
  const d = dimensionar(entrada, parametros);
  const anios = aniosDelConcurso(concurso);
  const porVehiculo = Object.fromEntries(Object.entries(calc?.vehiculos || {}).map(([k, v]) => [k, sinVacios(v)]));
  const cuenta = cuentaExplotacion(d, { ...PARAMETROS_CALCULO, ...sinVacios(calc?.parametros) }, porVehiculo, anios, factores);
  return { dimension: d, parametrosDimension: parametros, cuenta, anios, presupuestoAnual: calc?.presupuestoAnual || presupuestoAnualDe(concurso) };
}
