// ── Scheduling de líneas regulares ────────────────────────────────────
// Funciones puras (sin React ni Firestore) sobre la red de lineas-store.
//
// 1) Vehículos (vehicle scheduling): los viajes del tipo de día elegido se
//    recorren por hora de salida y cada uno va al autobús que está libre en
//    esa cabecera (llegada + regulación ≤ salida) y es de un tipo que admite
//    la línea; si no hay ninguno, se añade un autobús. De los libres se coge
//    el que quedó libre más tarde (menos tiempo parado). Las dos cabeceras de
//    una misma línea (llegada de la ida ↔ salida de la vuelta) cuentan como
//    el mismo sitio aunque en el GTFS sean paradas distintas. Si en la misma
//    cabecera no hay ninguno libre, puede venir en vacío uno de otra cabecera
//    cercana (hasta vacioMaxKm) que llegue a tiempo.
//    Con cocheras (Planning), cada bloque empieza saliendo de la cochera de
//    su línea (o la más cercana) y acaba volviendo a ella: esos vacíos son
//    "viajes" más del autobús (vacio: true), con sus km y su tiempo, y los
//    conduce el conductor como cualquier otro. Distancias: línea recta por
//    un factor de rodeo, a la velocidad en vacío.
//    Cada cadena de viajes es un "bloque". Después, los bloques se reparten
//    entre autobuses físicos: uno puede hacer un bloque de mañana y otro de
//    tarde si entre medias hay margen para el vacío (por cochera).
// 2) Turnos de conductor (crew scheduling): cada bloque se corta en piezas
//    (relevo en cabecera) y cada conductor va encadenando piezas de
//    cualquier autobús, con el tiempo de relevo o de desplazamiento entre
//    ellas, hasta llenar su jornada: tantas piezas como quepan. Solo se
//    corta entre viajes con viajeros (los vacíos van con su viaje: ninguna
//    pieza es solo un vacío) y no antes de la pieza mínima. Se cumplen
//    como obligación (no como aviso) la amplitud y la jornada máximas, la
//    conducción continua y diaria (UE 561/2006), el descanso de 15 min
//    (Estatuto, art. 34.4), las piezas y las jornadas partidas máximas. Los
//    huecos cortos entre piezas son trabajo pagado; los largos, jornada
//    partida. Al final se intenta deshacer los turnos más cortos repartiendo
//    sus piezas entre los demás. Con tipos de turno (mañana, tarde, partido,
//    refuerzo… con sus horas de inicio, trabajo mínimo y máximo y amplitud),
//    cada turno tiene que encajar en uno; el que no llega a ninguno se
//    intenta repartir y, si no se puede, queda con aviso.
// 3) Optimizar, en dos pasos como en Optibus o GoalSystem: primero los
//    vehículos (qué autobús coge cada viaje, hasta dónde se hacen vacíos entre
//    cabeceras) y después los turnos sobre esos bloques ya fijados (largo de
//    pieza, a qué conductor va cada una). Todas las estrategias cumplen las
//    restricciones; se queda la mejor para el objetivo de cada paso.


import { PARAMS_DEFECTO, geografia, nombreDia, viajesDelDia } from "./lineas-sched/base.js";
import { kpisServicio, perfilVehiculos } from "./lineas-sched/kpis.js";
import { programarTurnos } from "./lineas-sched/turnos.js";
import { seguirConductores } from "./lineas-sched/seguir.js";
import { asignarFlota, flotaDe } from "./lineas-sched/flota.js";
export { asignarFlota, flotaDe } from "./lineas-sched/flota.js";
import { minutosCoste, costeDeMinutos, hayPrecios } from "./lineas-sched/costes.js";
export { minutosCoste, costeDeMinutos, hayPrecios, CAMPOS_PRECIO } from "./lineas-sched/costes.js";
import { vehiculosYAutobuses } from "./lineas-sched/vehiculos.js";
// Lo de cada paso vive en src/lineas-sched/; desde aquí se sigue ofreciendo todo
export { ID_COCHERA, PARAMS_DEFECTO, TIPOS_TURNO_DEFECTO, cabecerasDeRed, claveSalidas, duracionViaje, esCalendario, nombreDia, pasosPorParada, salidasDe, viajesDia } from "./lineas-sched/base.js";
export { asignarTipos, encajaTipo, gruposTurnos, tipoDeTurno, validar } from "./lineas-sched/turnos.js";
export { aplicarCambios, clavePieza, claveViaje, esCambioTurnos, esCambioVehiculos, moverPieza, moverViaje, moverViajes, moverViajesTurno } from "./lineas-sched/manual.js";
export { kpisServicio, perfilVehiculos } from "./lineas-sched/kpis.js";
export { porQueSinTipo } from "./lineas-sched/sin-tipo.js";

/**
 * @param red      { lineas: [...] } (lineas-store)
 * @param cfg      { [lineaId]: { tipos, preferente, regulacion, tiempos } }
 * @param opciones { dia, lineas: [ids] | null (todas), regulacion, jornadaMax, entreLineas, … }
 */
export function generarServicio(red, cfg = {}, opciones = {}, extra = {}) {
  return generarTurnos(generarVehiculos(red, cfg, opciones, extra));
}

/** Paso 1: vehículos (bloques, autobuses y vacíos), sin turnos (turnos: null) */
export function generarVehiculos(red, cfg = {}, opciones = {}, { cocheras = [] } = {}) {
  const p = { ...PARAMS_DEFECTO, ...opciones, noRelevo: cfg?._relevos?.no || [] };
  const { viajes, find, aproximado } = viajesDelDia(red, cfg, p);
  const geo = geografia(red, cfg, cocheras, p);
  const { vehiculos, autobuses } = vehiculosYAutobuses(viajes, cfg, find, p, geo);
  for (const v of vehiculos) v.relevos = [];
  // la flota real (Planning → Flota): un vehículo para cada autobús del escenario
  const flota = asignarFlota(vehiculos, autobuses, flotaDe(cfg), { cargaEntreSalidas: p.cargaEntreSalidas !== false });
  if (flota) for (const b of autobuses) { const f = flota.porAutobus[b.id]; b.matricula = f?.matricula || null; b.flota = f || null; }
  return {
    viajes, vehiculos, autobuses, flota, turnos: null, find, ctx: { geo, cfg }, kpis: kpisServicio(viajes, vehiculos, null, autobuses), perfil: perfilVehiculos(vehiculos),
    aproximado, params: p, diaNombre: nombreDia(p.dia, red), conCocheras: !!geo?.hayCocheras,
  };
}

/** Paso 2: turnos de conductor sobre los bloques del paso 1 (no los cambia) */
export function generarTurnos(resVehiculos, opciones = {}, { grupos = null } = {}) {
  const r = resVehiculos;
  const p = { ...r.params, ...opciones, ...(r.ctx?.geo?.tramo ? { _tramo: r.ctx.geo.tramo } : {}) };
  // los turnos se hacen siempre sobre los autobuses del paso 1 tal cual (si r ya
  // trae turnos, sus autobuses pueden venir intercambiados: se usan los de antes)
  const base = r.vehiculosBase || r.vehiculos;
  const prog = programarTurnos(base, p, r.find, grupos, r.ctx?.geo);
  // los autobuses siguen a los conductores (intercambios en cabecera; los turnos no cambian)
  const { vehiculos, turnos, intercambios } = seguirConductores(base, r.autobuses, prog.turnos, p, r.ctx?.cfg);
  const porVehiculo = new Map(vehiculos.map(v => [v.id, (v.relevos = [])]));
  for (const pz of [...prog.piezas].sort((a, b) => a.inicio - b.inicio)) porVehiculo.get(pz.vehiculo).push({ inicio: pz.inicio, fin: pz.fin, turno: pz.turno });
  return { ...r, vehiculos, vehiculosBase: base, turnos, intercambiosBus: intercambios, params: p, kpis: kpisServicio(r.viajes, vehiculos, turnos, r.autobuses) };
}

// Campos de la estrategia: cada calendario guarda la suya (la elige Optimizar)
export const CAMPOS_VEHICULOS = ["eleccion", "entreLineas", "vacios", "vacioKm", "bloqueMax"];

export const CAMPOS_TURNOS = ["corte", "emparejar", "metodo"];

export const CAMPOS_ESTRATEGIA = [...CAMPOS_VEHICULOS, ...CAMPOS_TURNOS];

/** Indicadores de un escenario, pequeños para guardarlos por calendario */
export function resumenServicio(res) {
  const k = res.kpis;
  const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
  return {
    viajes: k.viajes, autobuses: k.autobuses, pico: k.pico, bloques: k.bloques, turnos: k.turnos, turnosDosPiezas: k.turnosDosPiezas,
    piezasMedias: Math.round((k.piezasMedias || 0) * 10) / 10,
    horasPagadas: k.horasPagadas == null ? null : r1(k.horasPagadas), horasServicio: r1(k.horasServicio), km: r1(k.km), kmVacio: r1(k.kmVacio || 0), avisos: k.turnosConAviso,
    eficienciaPersonal: k.eficienciaPersonal == null ? null : Math.round(k.eficienciaPersonal * 1000) / 1000,
    // minutos que se pagan por concepto (el coste se saca con los precios de ahora)
    costeMin: res.turnos ? minutosCoste(res.turnos, res.params) : null,
  };
}

/** Coste del día con los precios de Restricciones (null si no hay ninguno). Con costeMin, según el convenio */
export function costeDia({ horasPagadas, km, autobuses, costeMin }, p) {
  if (!hayPrecios(p)) return null;
  const personal = costeMin ? costeDeMinutos(costeMin, p).total : (horasPagadas || 0) * (p.costeHora || 0);
  return personal + (km || 0) * (p.costeKm || 0) + (autobuses || 0) * (p.costeVehiculoDia || 0);
}

export const OBJETIVOS_VEHICULOS = [
  { id: "autobuses", nombre: "Menos autobuses", ayuda: "Primero la flota; a igualdad, menos km en vacío." },
  { id: "kmVacio", nombre: "Menos km en vacío", ayuda: "Primero los km en vacío; a igualdad, menos autobuses." },
  { id: "coste", nombre: "Menor coste", ayuda: "Autobuses × €/autobús·día + km × €/km, con los precios de Restricciones.", precios: ["costeVehiculoDia", "costeKm"] },
];

export const OBJETIVOS_TURNOS = [
  { id: "conductores", nombre: "Menos conductores", ayuda: "Primero los turnos; a igualdad, menos horas pagadas." },
  { id: "horas", nombre: "Menos horas pagadas", ayuda: "Primero las horas pagadas (el coste de personal); a igualdad, menos turnos." },
  { id: "coste", nombre: "Menor coste", ayuda: "El coste de personal según el convenio de Restricciones (horas, pluses, extras, mínimo pagado).", precios: ["costeHora"] },
];

export const OBJETIVOS = [...OBJETIVOS_VEHICULOS, ...OBJETIVOS_TURNOS, { id: "total", nombre: "Menor coste total", ayuda: "Autobuses, conductores, km y cambios de autobús juntos." }];

// Precios orientativos para «Optimizar todo junto» cuando no se han puesto los
// de Restricciones (solo sirven para comparar unas formas con otras)
export const PRECIOS_ORIENTATIVOS = { costeVehiculoDia: 250, costeHora: 22, costeKm: 0.9, costeCambioBus: 5 };
export const preciosTotal = p => Object.fromEntries(Object.entries(PRECIOS_ORIENTATIVOS).map(([k, v]) => [k, p[k] > 0 || (k === "costeCambioBus" && p[k] === 0) ? p[k] : v]));

/** Nombre corto de una estrategia para enseñarla */
export function nombreEstrategia(v, piezaMax = PARAMS_DEFECTO.piezaMax) {
  const corte = v.corte === "flexible" ? "cortes flexibles" : v.corte === "equilibrado" ? "piezas equilibradas"
    : typeof v.corte === "number" && v.corte < piezaMax ? `piezas de hasta ${Math.floor(v.corte / 60)}h${String(v.corte % 60).padStart(2, "0")}` : "piezas largas";
  return [
    v.eleccion != null && (v.eleccion === "optimo" ? "mínimo de autobuses (óptimo)" : v.eleccion === "primero" ? "reparte la regulación" : "menos espera en cabecera"),
    v.vacios != null && (v.vacios === false || v.vacioKm === 0 ? "sin vacíos entre cabeceras" : v.vacioKm != null ? `vacíos de hasta ${String(v.vacioKm).replace(".", ",")} km` : "vacíos hasta el máximo"),
    v.entreLineas === false ? "sin cambiar de línea" : null,
    v.bloqueMax > 0 && `autobuses de hasta ${Math.floor(v.bloqueMax / 60)}h${String(v.bloqueMax % 60).padStart(2, "0")} fuera de cochera`,
    v.corte != null && corte,
    v.metodo === "particion" ? "turnos por partición (la mejor combinación)" : v.emparejar != null && (v.emparejar === "llena" ? "llenar turnos" : "menos espera entre piezas"),
  ].filter(Boolean).join(" · ");
}

const ordenarPor = (lista, clave) => lista.sort((a, b) => { const x = clave(a), y = clave(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });

/**
 * Paso 1: prueba formas de encadenar los autobuses (qué autobús coge cada
 * viaje, radio de los vacíos entre cabeceras, cambiar o no de línea).
 * @returns { probadas: [{ estrategia, autobuses, bloques, kmVacio, km, vacios, coste, cumple, nombre }], objetivo }
 */
export function optimizarVehiculos(red, cfg = {}, opciones = {}, { objetivo = "autobuses", onProgreso, cocheras = [] } = {}) {
  const p = { ...PARAMS_DEFECTO, ...opciones };
  const { viajes, find } = viajesDelDia(red, cfg, p);
  const geo = geografia(red, cfg, cocheras, p);
  const kmReales = viajes.reduce((s, v) => s + v.km, 0);
  const radios = geo && p.vacioMaxKm > 0 ? [...new Set([0, 3, 8, p.vacioMaxKm].filter(k => k <= p.vacioMaxKm))] : [0];
  const variantes = [];
  for (const vacioKm of radios) for (const eleccion of ["optimo", "ultimo", "primero"]) for (const entreLineas of p.entreLineas ? [true, false] : [false]) {
    variantes.push({ eleccion, entreLineas, vacios: vacioKm > 0, vacioKm });
  }
  const probadas = [];
  for (const dv of variantes) {
    const q = { ...p, ...dv };
    const { vehiculos, autobuses: buses } = vehiculosYAutobuses(viajes, cfg, find, q, geo);
    const autobuses = buses.length;
    const kmVacio = vehiculos.reduce((s, v) => s + (v.kmVacio || 0), 0);
    const r = {
      estrategia: dv, autobuses, bloques: vehiculos.length, kmVacio, km: kmReales + kmVacio,
      vacios: vehiculos.reduce((s, v) => s + v.viajes.filter(x => x.vacio).length, 0),
      coste: p.costeVehiculoDia > 0 || p.costeKm > 0 ? autobuses * (p.costeVehiculoDia || 0) + (kmReales + kmVacio) * (p.costeKm || 0) : null,
    };
    r.cumple = !(p.flotaMax > 0 && autobuses > p.flotaMax);
    r.nombre = nombreEstrategia(dv, p.piezaMax);
    probadas.push(r);
    onProgreso?.(probadas.length, variantes.length);
  }
  const exceso = r => Math.max(0, p.flotaMax > 0 ? r.autobuses - p.flotaMax : 0);
  ordenarPor(probadas, r => [exceso(r), ...(objetivo === "kmVacio" ? [r.kmVacio, r.autobuses] : objetivo === "coste" && r.coste != null ? [r.coste, r.autobuses] : [r.autobuses, r.kmVacio])]);
  return { probadas, objetivo };
}

/**
 * Paso 2: con los vehículos fijados (los de `opciones`), prueba formas de
 * hacer los turnos: largo de pieza y a qué conductor va cada una.
 * @returns { probadas: [{ estrategia, turnos, horasPagadas, avisos, piezasMedias, coste, cumple, nombre }], objetivo }
 */
export function optimizarTurnos(red, cfg = {}, opciones = {}, { objetivo = "conductores", onProgreso, cocheras = [], resVehiculos = null } = {}) {
  const base = resVehiculos || generarVehiculos(red, cfg, opciones, { cocheras });
  const p = { ...base.params, ...opciones };
  // 3h30–3h45: dos piezas + la pausa de 45 min caben en 8 h (dos de 4 h no)
  const cortes = ["max", 225, 210, 180, 150, 120].filter(c => typeof c !== "number" || c < p.piezaMax);
  // por cada corte: la partición (como Optibus/GoalSystem) y las dos voraces de antes; y los cortes
  // flexibles (la partición elige también dónde relevar); se queda la mejor
  const variantes = [...cortes.flatMap(corte => [{ corte, metodo: "particion" }, ...["primera", "llena"].map(emparejar => ({ corte, emparejar, metodo: "voraz" }))]), { corte: "flexible", metodo: "particion" }];
  const probadas = [];
  for (const dt of variantes) {
    const { turnos } = programarTurnos(base.vehiculos, { ...p, objetivoTurnos: objetivo === "horas" || objetivo === "coste" ? objetivo : "conductores", ...dt }, base.find, null, base.ctx?.geo);
    const horasPagadas = turnos.reduce((s, t) => s + t.trabajo, 0) / 60;
    const r = {
      estrategia: dt, turnos: turnos.length, horasPagadas,
      avisos: turnos.filter(t => t.avisos.length).length,
      piezasMedias: turnos.length ? turnos.reduce((s, t) => s + t.piezas.length, 0) / turnos.length : 0,
      coste: hayPrecios(p) ? costeDeMinutos(minutosCoste(turnos, p), p).total : null,
    };
    r.cumple = !(p.conductoresMax > 0 && r.turnos > p.conductoresMax);
    r.nombre = nombreEstrategia(dt, p.piezaMax);
    probadas.push(r);
    onProgreso?.(probadas.length, variantes.length);
  }
  const exceso = r => Math.max(0, p.conductoresMax > 0 ? r.turnos - p.conductoresMax : 0);
  ordenarPor(probadas, r => [exceso(r), r.avisos, ...(objetivo === "horas" ? [r.horasPagadas, r.turnos] : objetivo === "coste" && r.coste != null ? [r.coste, r.turnos] : [r.turnos, r.horasPagadas])]);
  return { probadas, objetivo };
}

/**
 * Optimizar todo junto: los vehículos ya no se eligen solo por tener menos
 * autobuses, sino por lo que cuesta el día entero con sus turnos. Prueba
 * formas de hacer los autobuses (entre ellas, autobuses que vuelven a cochera
 * al largo de un turno, para que el conductor no tenga que cambiar de
 * autobús) y, para cada una, formas de hacer los turnos; se queda con la de
 * menor coste: autobuses + horas de conductor + km + cambios de autobús.
 * @returns { probadas: [{ estrategia, autobuses, turnos, horasPagadas, km, kmVacio, cambiosBus, desplazamientos, avisos, coste, cumple, nombre }], objetivo: "total", precios }
 */
export function optimizarConjunto(red, cfg = {}, opciones = {}, { onProgreso, cocheras = [] } = {}) {
  const p = { ...PARAMS_DEFECTO, ...opciones };
  const precios = preciosTotal(p);
  const { viajes, find } = viajesDelDia(red, cfg, p);
  const geo = geografia(red, cfg, cocheras, p);
  const kmReales = viajes.reduce((s, v) => s + v.km, 0);
  // largos de autobús parecidos a un turno: la jornada (y la amplitud) de los tipos de turno
  const tipos = (p.tiposTurno || []).filter(x => x.activo !== false && !x.partido);
  const jornadas = [...new Set((tipos.length ? tipos.map(x => x.trabajoMax) : [p.jornadaMax]).filter(x => x > 0))];
  const bloques = [null, ...new Set(jornadas.flatMap(j => [j, j + 60]))].slice(0, 4);
  const radios = geo && p.vacioMaxKm > 0 ? [0, p.vacioMaxKm] : [0];
  const variantesV = [];
  // con turnos de una sola línea, también autobuses que no cambian de línea (menos piezas sueltas)
  const entre = p.entreLineas && (p.turnoUnaLinea || (p.mezclaTurnos && p.mezclaTurnos !== "libre")) ? [true, false] : [p.entreLineas];
  for (const bloqueMax of bloques) for (const vacioKm of radios) for (const eleccion of ["optimo", "ultimo"]) for (const entreLineas of entre) {
    variantesV.push({ eleccion, entreLineas, vacios: vacioKm > 0, vacioKm, bloqueMax });
  }
  const variantesT = [{ corte: 150, metodo: "particion" }, { corte: 210, metodo: "particion" }, { corte: "max", metodo: "particion" }, { corte: "flexible", metodo: "particion" }];
  const total = variantesV.length * variantesT.length;
  const probadas = [];
  for (const dv of variantesV) {
    const q = { ...p, ...dv };
    const { vehiculos, autobuses: buses } = vehiculosYAutobuses(viajes, cfg, find, q, geo);
    const kmVacio = vehiculos.reduce((s, v) => s + (v.kmVacio || 0), 0);
    for (const dt of variantesT) {
      const prog = programarTurnos(vehiculos, { ...q, ...dt }, find, null, geo);
      const { turnos } = seguirConductores(vehiculos, buses, prog.turnos, { ...q, ...dt }, cfg);
      const horasPagadas = turnos.reduce((s, t) => s + t.trabajo, 0) / 60;
      const cambiosBus = turnos.reduce((s, t) => s + (t.cambiosBus || 0), 0);
      const r = {
        estrategia: { ...dv, ...dt }, autobuses: buses.length, turnos: turnos.length, horasPagadas, km: kmReales + kmVacio, kmVacio, cambiosBus,
        desplazamientos: turnos.reduce((s, t) => s + (t.desplazamientos?.length || 0), 0),
        avisos: turnos.filter(t => t.avisos.length).length,
        coste: buses.length * precios.costeVehiculoDia + costeDeMinutos(minutosCoste(turnos, q), { ...q, ...precios }).total + (kmReales + kmVacio) * precios.costeKm + cambiosBus * precios.costeCambioBus,
      };
      r.cumple = !(p.flotaMax > 0 && r.autobuses > p.flotaMax) && !(p.conductoresMax > 0 && r.turnos > p.conductoresMax);
      r.nombre = nombreEstrategia(r.estrategia, p.piezaMax);
      probadas.push(r);
      onProgreso?.(probadas.length, total);
    }
  }
  ordenarPor(probadas, r => [r.cumple ? 0 : 1, r.avisos > 0 ? 1 : 0, r.coste]);
  return { probadas, objetivo: "total", precios };
}

/** Los dos pasos seguidos: los mejores vehículos y, sobre ellos, los mejores turnos */
export function optimizarServicio(red, cfg = {}, opciones = {}, { objetivoVehiculos = "autobuses", objetivoTurnos = "conductores", cocheras = [] } = {}) {
  const v = optimizarVehiculos(red, cfg, opciones, { objetivo: objetivoVehiculos, cocheras }).probadas[0];
  const q = { ...opciones, ...(v?.estrategia || {}) };
  const t = optimizarTurnos(red, cfg, q, { objetivo: objetivoTurnos, cocheras }).probadas[0];
  return { estrategia: { ...(v?.estrategia || {}), ...(t?.estrategia || {}) }, vehiculos: v, turnos: t };
}

/**
 * Restricciones que no tienen sentido o que dejan el resultado sin turnos
 * buenos (p. ej. un campo borrado que quedó a 0). Para avisar en pantalla.
 * Devuelve [{ texto, grave }].
 */
export function revisarRestricciones(p) {
  const r = [];
  const tipos = (p.tiposTurno || []).filter(x => x.activo !== false);
  const jornada = tipos.length ? Math.max(...tipos.map(x => x.trabajoMax || 0)) : p.jornadaMax;
  if (!(p.maxPiezas >= 2)) r.push({ grave: true, texto: `Piezas por turno: ${p.maxPiezas ?? 0}. Ningún turno puede juntar dos piezas: no habrá partidos y saldrán muchos turnos cortos.` });
  if (p.huecoNoPagado != null && p.huecoNoPagado < 30) r.push({ grave: true, texto: `Hueco que ya no se paga: ${p.huecoNoPagado} min. Cualquier hueco de ${p.huecoNoPagado} min o más entre dos piezas cuenta como partido (sin pagar).` });
  if (p.piezaMin > 0 && p.piezaMax > 0 && p.piezaMin > p.piezaMax) r.push({ grave: true, texto: `La pieza mínima (${p.piezaMin} min) es mayor que la máxima (${p.piezaMax} min).` });
  if (p.piezaMax > 0 && p.piezaMax < 90) r.push({ grave: true, texto: `Pieza máxima de ${p.piezaMax} min: habrá relevo de conductor cada ${p.piezaMax} min como mucho y los turnos se llenan de piezas sueltas. ¿Querías ${p.piezaMax * 10}?` });
  if (p.maxPiezas > 6) r.push({ grave: false, texto: `${p.maxPiezas} piezas por turno: un conductor podría cambiar de autobús ${p.maxPiezas - 1} veces en su jornada. Lo habitual es 2–4.` });
  if (p.piezaMax >= jornada) r.push({ grave: false, texto: `Pieza máxima de ${p.piezaMax} min: una sola pieza puede ocupar el turno entero (${jornada} min), así que casi no habrá relevos ni partidos.` });
  if (p.aplicar561 !== false && (p.conduccionContinuaMax > 270 || p.pausaConduccionMin < 45)) r.push({ grave: false, texto: `Conducción continua de ${p.conduccionContinuaMax} min con pausa de ${p.pausaConduccionMin} min: no es lo de la UE 561/2006 (270 y 45). Si es a propósito, marca «No aplicar la UE 561/2006».` });
  if (p.regulacion === 0) r.push({ grave: false, texto: "Regulación en cabecera de 0 min: los autobuses salen en cuanto llegan." });
  for (const t of tipos) {
    if (t.trabajoMin > t.trabajoMax) r.push({ grave: true, texto: `Tipo «${t.nombre}»: el trabajo mínimo es mayor que el máximo.` });
    if (t.partido && !(p.maxPiezas >= 2)) r.push({ grave: true, texto: `Tipo «${t.nombre}» es partido, pero con ${p.maxPiezas ?? 0} pieza(s) por turno no puede haber partidos.` });
  }
  return r;
}
