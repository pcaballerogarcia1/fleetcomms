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

import { franjaDe, TIPOS_DIA } from "./gtfs-red.js";

// Tipos de turno (duty types): cada turno tiene que encajar en uno de los
// activos. Horas de inicio (desde–hasta, en minutos del día; si desde > hasta
// cruza la medianoche), trabajo mínimo y máximo, amplitud máxima y si puede
// ser partido. Se prueban en este orden: el turno es del primero que encaja.
export const TIPOS_TURNO_DEFECTO = [
  { id: "manana", nombre: "Mañana", activo: true, desde: 240, hasta: 600, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "tarde", nombre: "Tarde", activo: true, desde: 600, hasta: 1020, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "noche", nombre: "Noche", activo: true, desde: 1020, hasta: 240, trabajoMin: 300, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "partido", nombre: "Partido", activo: true, desde: 240, hasta: 720, trabajoMin: 360, trabajoMax: 480, amplitudMax: 720, partido: true },
  { id: "refuerzo", nombre: "Refuerzo", activo: true, desde: 0, hasta: 1439, trabajoMin: 180, trabajoMax: 360, amplitudMax: 420, partido: false },
];

export const PARAMS_DEFECTO = {
  dia: "laborable",
  regulacion: 5,        // min, si la línea no tiene la suya
  jornadaMax: 480,      // min de trabajo por turno (piezas + huecos cortos entre ellas)
  piezaMax: 240,        // min de una pieza (de relevo a relevo)
  piezaMin: 60,         // min: una pieza más corta no se corta por estrategia (relevos con sentido operativo)
  amplitudMax: 540,     // min de la primera salida a la última llegada del turno (pausa incluida)
  entreLineas: true,    // un autobús puede seguir con otra línea en la misma cabecera
  margenVacio: 30,      // min entre dos bloques del mismo autobús, sin cocheras (ir y volver incluido)
  margenCochera: 10,    // min parado en cochera entre dos bloques del mismo autobús (con cocheras)
  vacioMaxKm: 20,       // km como mucho de un vacío entre cabeceras (0 = no se hacen)
  factorRodeo: 1.35,    // km por carretera / km en línea recta
  velocidadVacio: 25,   // km/h de los vacíos
  conduccionContinuaMax: 270, pausaConduccionMin: 45, conduccionDiariaMax: 540,
  jornadaSinPausaMax: 360, pausaJornadaMin: 15,
  maxPiezas: 4,         // piezas por turno como mucho (más relevos no tienen sentido operativo)
  maxPartidos: 1,       // huecos largos (jornada partida) por turno
  tiposTurno: TIPOS_TURNO_DEFECTO, // si hay alguno activo, sus límites mandan sobre amplitudMax, jornadaMax y maxPartidos
  huecoNoPagado: 60,    // min: un hueco entre piezas desde este largo no se paga (jornada partida)
  relevoMin: 5,         // min para relevar en la misma cabecera
  desplazamiento: 20,   // min para ir a otra cabecera a coger otra pieza
  aplicar561: true,     // avisos de conducción UE 561/2006
  costeHora: null, costeKm: null, costeVehiculoDia: null, // € para el coste estimado
  flotaMax: null,       // autobuses disponibles (límite del optimizador)
  conductoresMax: null, // conductores disponibles ese día
  // Estrategia (la cambia Optimizar; todas cumplen las restricciones)
  eleccion: "ultimo",   // "ultimo": el autobús que quedó libre más tarde · "primero": el que lleva más esperando
  corte: 120,           // "max": piezas lo más largas posible · "equilibrado" · número: pieza objetivo en min
  emparejar: "primera", // "primera": el conductor que menos espera · "llena": el que lleva más horas
  vacios: true,         // vacíos entre cabeceras
  vacioKm: null,        // radio de los vacíos entre cabeceras (null = vacioMaxKm; nunca más)
};

const hhmmAMin = s => {
  const m = /^(\d+):(\d\d)(?:\s*\(\+(\d+)\))?/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) * 1440 : 0) : null;
};

/**
 * Salidas de un sentido ese día: un tipo de día (laborable/sabado/festivo, su
 * día de referencia) o un calendario del GTFS ("cal:3", necesita la red).
 * Si la red es antigua (sin horas), repartidas entre la primera y la última.
 */
export function salidasDe(sentido, dia, red) {
  if (esCalendario(dia)) {
    const cal = red?.calendarios?.find(c => c.id === dia);
    if (!cal || !sentido.porServicio) return { lista: [], aproximado: !sentido.porServicio };
    const set = new Set(cal.servicios);
    return { lista: sentido.porServicio.filter(([k]) => set.has(k)).flatMap(([, l]) => l).sort((a, b) => a - b), aproximado: false };
  }
  if (Array.isArray(sentido.salidas?.[dia])) return { lista: sentido.salidas[dia], aproximado: false };
  const n = sentido.viajes?.[dia] || 0;
  const a = hhmmAMin(sentido.primera), b = hhmmAMin(sentido.ultima);
  if (!n || a == null) return { lista: [], aproximado: true };
  if (n === 1 || b == null || b <= a) return { lista: [a], aproximado: true };
  return { lista: Array.from({ length: n }, (_, k) => Math.round(a + (k * (b - a)) / (n - 1))), aproximado: true };
}

/** Minutos de cabecera a cabecera para una salida (corregido a mano si lo hay) */
export function duracionViaje(sentido, salida, cfgLinea) {
  const f = franjaDe(salida);
  const manual = cfgLinea?.tiempos?.[`${sentido.dir}|${f}`];
  if (manual != null) return manual;
  const t = sentido.tiempos?.find(x => x.franja === f)?.min;
  if (t != null) return t;
  // franja sin viajes en el GTFS: la mediana de las demás
  const otros = (sentido.tiempos || []).map(x => x.min).filter(x => x != null).sort((x, y) => x - y);
  return otros.length ? otros[otros.length >> 1] : 30;
}

/** Une cabeceras: llegada de la ida = salida de la vuelta (y al revés) de cada línea */
function cabeceras(lineas) {
  const padre = new Map();
  const find = x => { while (padre.has(x) && padre.get(x) !== x) x = padre.get(x); return x; };
  const unir = (a, b) => { if (a == null || b == null) return; const ra = find(a), rb = find(b); if (ra !== rb) padre.set(ra, rb); };
  for (const l of lineas) {
    const [ida, vuelta] = l.sentidos;
    if (ida && vuelta) { unir(ida.paradas.at(-1), vuelta.paradas[0]); unir(vuelta.paradas.at(-1), ida.paradas[0]); }
  }
  return find;
}

const tipoDeLinea = cfg => cfg?.preferente || cfg?.tipos?.[0] || null;
const admite = (cfg, tipo) => !cfg?.tipos?.length || tipo == null || cfg.tipos.includes(tipo);

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
  const p = { ...PARAMS_DEFECTO, ...opciones };
  const { viajes, find, aproximado } = viajesDelDia(red, cfg, p);
  const geo = geografia(red, cfg, cocheras, p);
  const vehiculos = programarVehiculos(viajes, cfg, find, p, geo);
  const autobuses = repartirAutobuses(vehiculos, p);
  for (const v of vehiculos) v.relevos = [];
  return {
    viajes, vehiculos, autobuses, turnos: null, find, ctx: { geo, cfg }, kpis: kpisServicio(viajes, vehiculos, null, autobuses), perfil: perfilVehiculos(vehiculos),
    aproximado, params: p, diaNombre: nombreDia(p.dia, red), conCocheras: !!geo?.hayCocheras,
  };
}

/** Paso 2: turnos de conductor sobre los bloques del paso 1 (no los cambia) */
export function generarTurnos(resVehiculos, opciones = {}) {
  const r = resVehiculos;
  const p = { ...r.params, ...opciones };
  const { turnos, piezas } = programarTurnos(r.vehiculos, p, r.find);
  const porVehiculo = new Map(r.vehiculos.map(v => [v.id, (v.relevos = [])]));
  for (const pz of [...piezas].sort((a, b) => a.inicio - b.inicio)) porVehiculo.get(pz.vehiculo).push({ inicio: pz.inicio, fin: pz.fin, turno: pz.turno });
  return { ...r, turnos, params: p, kpis: kpisServicio(r.viajes, r.vehiculos, turnos, r.autobuses) };
}

function viajesDelDia(red, cfg, p) {
  const elegidas = (red?.lineas || []).filter(l => !p.lineas || p.lineas.includes(l.id));
  const find = cabeceras(elegidas);
  let aproximado = false;

  // Viajes del día
  const viajes = [];
  for (const l of elegidas) {
    const c = cfg[l.id];
    for (const s of l.sentidos) {
      if (!s.paradas.length) continue;
      const { lista, aproximado: ap } = salidasDe(s, p.dia, red);
      if (ap && lista.length) aproximado = true;
      for (const dep of lista) {
        const dur = duracionViaje(s, dep, c);
        viajes.push({
          linea: l.id, nombre: l.nombre, color: l.color, dir: s.dir, sentido: s.nombre,
          dep, arr: dep + dur, o: s.paradas[0], d: s.paradas.at(-1), km: s.km || 0,
        });
      }
    }
  }
  viajes.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  return { viajes, find, aproximado };
}

export const ID_COCHERA = id => `cochera:${id}`;
const COLOR_VACIO = "#64748b";
const PEGADAS_KM = 0.3; // dos sitios a menos de esto son el mismo (sin vacío)
function kmRecta([a, b], [c, d]) {
  const dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// Coordenadas, distancias y cochera de cada línea (null si la red no tiene coordenadas)
function geografia(red, cfg, cocheras, p) {
  if (!red?.paradas?.length) return null;
  const coord = new Map(red.paradas.map(x => [x.id, [x.lat, x.lng]]));
  const lista = (cocheras || []).filter(c => isFinite(c.lat) && isFinite(c.lng));
  for (const c of lista) coord.set(ID_COCHERA(c.id), [c.lat, c.lng]);
  const km = (a, b) => { const x = coord.get(a), y = coord.get(b); return x && y ? Math.round(kmRecta(x, y) * p.factorRodeo * 10) / 10 : null; };
  const min = k => Math.max(1, Math.round((k / Math.max(1, p.velocidadVacio)) * 60));
  // la más cercana se mide siempre desde la primera cabecera de la línea (la
  // misma en todas las estrategias, para que Optimizar y Generar cuadren)
  const inicioLinea = new Map((red.lineas || []).map(l => [l.id, l.sentidos[0]?.paradas[0]]));
  const cocheraLinea = new Map();
  const cocheraDe = (lineaId, paradaRespaldo) => {
    const paradaInicio = inicioLinea.get(lineaId) ?? paradaRespaldo;
    if (!lista.length) return null;
    const fija = cfg[lineaId]?.cochera;
    if (fija != null && lista.some(c => String(c.id) === String(fija))) return ID_COCHERA(lista.find(c => String(c.id) === String(fija)).id);
    if (!cocheraLinea.has(lineaId)) {
      let mejor = null, d = Infinity;
      for (const c of lista) { const k = km(ID_COCHERA(c.id), paradaInicio); if (k != null && k < d) { d = k; mejor = ID_COCHERA(c.id); } }
      cocheraLinea.set(lineaId, mejor);
    }
    return cocheraLinea.get(lineaId);
  };
  return { coord, km, min, cocheraDe, hayCocheras: lista.length > 0, nombres: new Map(lista.map(c => [ID_COCHERA(c.id), c.nombre || "Cochera"])) };
}
// tipo: "salida" (de cochera), "vuelta" (a cochera) o "cabecera" (entre cabeceras); hacia: línea que va a hacer
const vacio = (desde, hasta, dep, minutos, km, tipo, hacia) => ({
  vacio: true, tipo, hacia: hacia || null, linea: null, nombre: "Vacío", color: COLOR_VACIO, dir: 0,
  sentido: tipo === "salida" ? "Salida de cochera" : tipo === "vuelta" ? "Vuelta a cochera" : `Vacío a cabecera${hacia ? ` de la ${hacia}` : ""}`,
  dep, arr: dep + minutos, o: desde, d: hasta, km,
});

// 1) Vehículos: bloques de viajes encadenados en cabecera
function programarVehiculos(viajes, cfg, find, p, geo) {
  const vehiculos = [];
  const esperando = new Map(); // cabecera → [vehículo]
  const vmax = p.vacios === false || !geo ? 0 : Math.min(p.vacioMaxKm || 0, p.vacioKm ?? Infinity);
  const raices = [...new Set(viajes.flatMap(v => [find(v.o), find(v.d)]))];
  const vecinos = new Map(); // cabecera → [[otra, km, min]] a menos de vmax km
  const vecinosDe = r => {
    if (!vecinos.has(r)) {
      const l = [];
      for (const x of raices) {
        if (x === r) continue;
        const k = geo.km(r, x);
        if (k != null && k <= vmax) l.push([x, k, k < PEGADAS_KM ? 0 : geo.min(k)]); // paradas pegadas: es la misma cabecera
      }
      vecinos.set(r, l.sort((a, b) => a[1] - b[1]).slice(0, 30));
    }
    return vecinos.get(r);
  };
  const vale = (veh, v, c) => (p.entreLineas || veh.linea === v.linea) && admite(c, veh.tipo);
  for (const v of viajes) {
    const c = cfg[v.linea];
    const donde = find(v.o);
    const cola = esperando.get(donde) || [];
    let mejor = -1;
    for (let k = 0; k < cola.length; k++) {
      const veh = cola[k];
      if (veh.libre > v.dep || !vale(veh, v, c)) continue;
      if (mejor < 0 || (p.eleccion === "primero" ? veh.libre < cola[mejor].libre : veh.libre > cola[mejor].libre)) mejor = k;
    }
    let veh = null;
    if (mejor >= 0) { veh = cola[mejor]; cola.splice(mejor, 1); }
    else if (vmax > 0) {
      // nadie libre aquí: uno de una cabecera cercana que llegue en vacío
      let elegido = null;
      for (const [otra, km, minutos] of vecinosDe(donde)) {
        const q = esperando.get(otra);
        if (!q?.length) continue;
        for (let k = 0; k < q.length; k++) {
          const x = q[k];
          if (x.libre + minutos > v.dep || !vale(x, v, c)) continue;
          if (!elegido || km < elegido.km || (km === elegido.km && x.libre > elegido.x.libre)) elegido = { x, q, k, km, minutos, otra };
        }
        if (elegido) break; // los vecinos van por distancia: el primero que tiene alguno es el más cerca
      }
      if (elegido) {
        veh = elegido.x; elegido.q.splice(elegido.k, 1);
        if (elegido.km >= PEGADAS_KM) veh.viajes.push(vacio(veh.viajes.at(-1).d, v.o, veh.libre, elegido.minutos, elegido.km, "cabecera", v.nombre));
      }
    }
    if (!veh) { veh = { id: vehiculos.length + 1, tipo: tipoDeLinea(c), viajes: [], libre: 0, linea: v.linea }; vehiculos.push(veh); }
    veh.viajes.push(v);
    veh.linea = v.linea;
    veh.libre = v.arr + (c?.regulacion ?? p.regulacion);
    const fin = find(v.d);
    if (!esperando.has(fin)) esperando.set(fin, []);
    esperando.get(fin).push(veh);
  }
  for (const veh of vehiculos) {
    const reales = veh.viajes.filter(x => !x.vacio);
    // salida de cochera y vuelta a cochera
    if (geo?.hayCocheras) {
      const primero = reales[0], ultimo = reales.at(-1);
      veh.cochera = geo.cocheraDe(primero.linea, primero.o);
      const ida = geo.km(veh.cochera, primero.o), vuelta = geo.km(ultimo.d, veh.cochera);
      if (ida != null && ida >= PEGADAS_KM) { const m = geo.min(ida); veh.viajes.unshift(vacio(veh.cochera, primero.o, primero.dep - m, m, ida, "salida", primero.nombre)); }
      if (vuelta != null && vuelta >= PEGADAS_KM) veh.viajes.push(vacio(ultimo.d, veh.cochera, ultimo.arr, geo.min(vuelta), vuelta, "vuelta"));
    }
    veh.inicio = veh.viajes[0].dep;
    veh.fin = veh.viajes.at(-1).arr;
    veh.lineas = [...new Set(reales.map(x => x.nombre))];
    veh.kmVacio = Math.round(veh.viajes.reduce((s, x) => s + (x.vacio ? x.km : 0), 0) * 10) / 10;
    delete veh.libre; delete veh.linea;
  }
  return vehiculos;
}

// Autobuses físicos: bloques sin solaparse (con el margen del vacío)
function repartirAutobuses(vehiculos, p) {
  const autobuses = [];
  for (const veh of [...vehiculos].sort((x, y) => x.inicio - y.inicio)) {
    let mejor = null;
    for (const bus of autobuses) {
      // con cocheras los bloques ya llevan la ida y la vuelta: solo el rato en cochera
      if (bus.libre + (veh.cochera ? p.margenCochera : p.margenVacio) > veh.inicio) continue;
      if (veh.cochera && bus.cochera !== veh.cochera) continue;
      if (bus.tipo != null && veh.tipo != null && bus.tipo !== veh.tipo) continue;
      if (!mejor || bus.libre > mejor.libre) mejor = bus;
    }
    if (!mejor) { mejor = { id: autobuses.length + 1, tipo: veh.tipo, bloques: [], libre: 0, cochera: veh.cochera || null }; autobuses.push(mejor); }
    mejor.bloques.push(veh.id);
    mejor.libre = veh.fin;
    if (mejor.tipo == null) mejor.tipo = veh.tipo;
    veh.autobus = mejor.id;
  }
  autobuses.forEach(b => { delete b.libre; });
  return autobuses;
}

// 2) Turnos de conductor
function cortarPiezas(vehiculos, p, find) {
  const piezas = [];
  for (const veh of vehiculos) {
    let lim = p.piezaMax;
    if (p.corte === "equilibrado") {
      // piezas de largo parecido (las muy cortas se aprovechan peor)
      const n = Math.ceil((veh.fin - veh.inicio) / p.piezaMax);
      lim = Math.min(p.piezaMax, Math.ceil((veh.fin - veh.inicio) / n) + 20);
    } else if (typeof p.corte === "number") lim = Math.min(p.piezaMax, p.corte);
    const minima = Math.min(p.piezaMin ?? 0, lim);
    // Se corta solo entre viajes con viajeros: cada viaje va con los vacíos que
    // lleva delante (salida de cochera, paso a otra cabecera) y la vuelta a
    // cochera va con el último. Así ninguna pieza es solo un vacío.
    const tramos = [];
    let sueltos = [];
    for (const v of veh.viajes) { sueltos.push(v); if (!v.vacio) { tramos.push(sueltos); sueltos = []; } }
    if (sueltos.length) { if (tramos.length) tramos.at(-1).push(...sueltos); else tramos.push(sueltos); }
    let pz = null, previa = null;
    for (const tramo of tramos) {
      const dur = tramo.reduce((s, v) => s + v.arr - v.dep, 0), fin = tramo.at(-1).arr;
      if (pz) {
        // obligatorio: conducción continua o pieza máxima; por estrategia, solo si la pieza ya tiene el mínimo
        const obligado = pz.conduccion + dur > p.conduccionContinuaMax || fin - pz.inicio > p.piezaMax;
        if (obligado || (fin - pz.inicio > lim && pz.fin - pz.inicio >= minima)) { piezas.push(pz); previa = pz; pz = null; }
      }
      if (!pz) pz = { vehiculo: veh.id, inicio: tramo[0].dep, fin, conduccion: 0, viajes: [], previa, o: find ? find(tramo[0].o) : tramo[0].o };
      for (const v of tramo) { pz.viajes.push(v); pz.fin = v.arr; pz.conduccion += v.arr - v.dep; pz.d = find ? find(v.d) : v.d; }
    }
    if (pz) {
      // el final del autobús, si es más corto que el mínimo, se queda con la pieza anterior si cabe
      const ant = pz.previa;
      if (ant && pz.fin - pz.inicio < minima && pz.fin - ant.inicio <= p.piezaMax && ant.conduccion + pz.conduccion <= p.conduccionContinuaMax) {
        ant.viajes.push(...pz.viajes); ant.fin = pz.fin; ant.conduccion += pz.conduccion; ant.d = pz.d;
      } else piezas.push(pz);
    }
  }
  return piezas;
}

// ── Tipos de turno ──
const enFranja = (min, desde, hasta) => { const m = ((min % 1440) + 1440) % 1440; return desde <= hasta ? m >= desde && m <= hasta : m >= desde || m <= hasta; };
/** ¿Cabe el turno (inicio, fin, trabajo, partidos) en el tipo? final: además llega al trabajo mínimo */
export function encajaTipo(t, tipo, final = false) {
  if (!enFranja(t.inicio, tipo.desde, tipo.hasta)) return false;
  if (t.fin - t.inicio > tipo.amplitudMax || t.trabajo > tipo.trabajoMax) return false;
  if (t.partidos > (tipo.partido ? 1 : 0)) return false;
  return !final || t.trabajo >= tipo.trabajoMin;
}
const tiposActivos = p => (p.tiposTurno || []).filter(x => x.activo !== false);
/** El tipo de un turno ya cerrado (el primero que encaja), o null */
export const tipoDeTurno = (t, p) => tiposActivos(p).find(x => encajaTipo(t, x, true)) || null;
// Con tipos de turno, los límites generales pasan a ser los más amplios de los
// tipos (para no descartar nada que algún tipo admita) y cada estado se
// comprueba contra los tipos.
const efectivosCache = new WeakMap();
function efectivos(p) {
  if (p._tipos) return p;
  if (efectivosCache.has(p)) return efectivosCache.get(p);
  const tipos = tiposActivos(p);
  const e = tipos.length ? {
    ...p, _tipos: tipos,
    amplitudMax: Math.max(...tipos.map(x => x.amplitudMax)),
    jornadaMax: Math.max(...tipos.map(x => x.trabajoMax)),
    maxPartidos: tipos.some(x => x.partido) ? 1 : 0,
  } : p;
  efectivosCache.set(p, e);
  return e;
}

// Estado de un turno al añadirle una pieza (null si no cabe)
function anadir(t, pz, p) {
  let hueco = 0, partido = false;
  if (t) {
    const ultima = t.piezas[t.piezas.length - 1];
    hueco = pz.inicio - t.fin;
    const sigue = pz.previa === ultima; // sigue en el mismo autobús: no hay relevo
    if (hueco < (sigue ? 0 : t.d === pz.o ? p.relevoMin : p.desplazamiento)) return null;
    if (t.piezas.length >= p.maxPiezas) return null;
    partido = hueco >= p.huecoNoPagado;
    if (partido && t.partidos >= p.maxPartidos) return null;
  }
  const inicio = t ? t.inicio : pz.inicio;
  if (pz.fin - inicio > p.amplitudMax) return null;
  const trabajo = (t ? t.trabajo : 0) + (partido ? 0 : hueco) + (pz.fin - pz.inicio);
  if (trabajo > p.jornadaMax) return null;
  const conduccion = (t ? t.conduccion : 0) + pz.conduccion;
  if (p.aplicar561 && conduccion > p.conduccionDiariaMax) return null;
  // conducción continua: se acumula hasta juntar la pausa (puede partirse en 15 + 30)
  let seguido = t ? t.seguido : 0, pausaAcum = t ? t.pausaAcum : 0, hay15 = t ? t.hay15 : false, finPrev = t ? t.fin : null;
  for (const v of pz.viajes) {
    if (finPrev != null) {
      const h = v.dep - finPrev;
      if (h >= 15) { pausaAcum += h; hay15 = true; }
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    if (p.aplicar561 && seguido > p.conduccionContinuaMax) return null;
    finPrev = v.arr;
  }
  if (pz.fin - inicio > p.jornadaSinPausaMax && !hay15) return null; // Estatuto: 15 min si pasa de 6 h
  const estado = { inicio, fin: pz.fin, d: pz.d, trabajo, conduccion, seguido, pausaAcum, hay15, partidos: (t ? t.partidos : 0) + (partido ? 1 : 0) };
  if (p._tipos && !p._tipos.some(x => encajaTipo(estado, x))) return null; // ningún tipo de turno lo admite
  return estado;
}
// Rehace un turno desde cero con sus piezas en orden (null si no vale)
function validar(piezas, p) {
  const orden = [...piezas].sort((a, b) => a.inicio - b.inicio);
  let t = null;
  for (let i = 0; i < orden.length; i++) {
    const x = anadir(t, orden[i], p);
    if (!x) return null;
    t = { ...x, piezas: orden.slice(0, i + 1) };
  }
  return t;
}

function programarTurnos(vehiculos, pOriginal, find) {
  const p = efectivos(pOriginal);
  const piezas = cortarPiezas(vehiculos, p, find);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  // Cada pieza va al conductor que mejor la aprovecha: el que sigue en ese
  // autobús, si no el que menos espera ("primera") o el que lleva más horas
  // ("llena"); si no cabe en ninguno, entra un conductor nuevo.
  const turnos = [];
  let activos = [];
  const deLaPieza = new Map(); // pieza → turno (para seguir en el mismo autobús)
  for (let i = 0; i < piezas.length; i++) {
    const pz = piezas[i];
    if (i % 200 === 0) activos = activos.filter(t => t.inicio + p.amplitudMax > pz.inicio);
    let mejor = null, nuevo = null, nota = -Infinity;
    const previo = pz.previa && deLaPieza.get(pz.previa);
    if (previo) { const x = anadir(previo, pz, p); if (x) { mejor = previo; nuevo = x; nota = Infinity; } }
    if (!mejor) {
      for (const t of activos) {
        if (t.fin > pz.inicio || t.inicio + p.amplitudMax < pz.fin) continue;
        const x = anadir(t, pz, p);
        if (!x) continue;
        const n = p.emparejar === "llena" ? x.trabajo * 1000 - (pz.inicio - t.fin) : -(pz.inicio - t.fin) * 1000 + x.trabajo;
        if (n > nota) { nota = n; mejor = t; nuevo = x; }
      }
    }
    if (mejor) { Object.assign(mejor, nuevo); mejor.piezas.push(pz); deLaPieza.set(pz, mejor); continue; }
    const t0 = anadir(null, pz, p);
    const t = t0 ? { ...t0, piezas: [pz] } : { piezas: [pz], inicio: pz.inicio, fin: pz.fin, d: pz.d, trabajo: pz.fin - pz.inicio, conduccion: pz.conduccion, seguido: 0, pausaAcum: 0, hay15: true, partidos: 0 };
    turnos.push(t); activos.push(t); deLaPieza.set(pz, t);
  }
  // Repaso: deshacer los turnos cortos metiendo sus piezas en otros
  const porInicio = () => [...turnos].sort((a, b) => a.inicio - b.inicio);
  let lista = porInicio();
  // cortos: los que no llegan a ningún tipo de turno, y los de poco trabajo
  const cortos = [...turnos].filter(t => t.trabajo < p.jornadaMax * 0.6 || (p._tipos && !tipoDeTurno(t, p))).sort((a, b) => a.trabajo - b.trabajo);
  const quitados = new Set();
  let intentos = 0;
  for (const c of cortos) {
    if (quitados.has(c) || intentos > 400000) continue;
    const cambios = []; // [turno, estado anterior]
    let ok = true;
    for (const pz of c.piezas) {
      let destino = null, estado = null;
      for (const t of lista) {
        // en las dos direcciones: también turnos que empiezan después (así salen los partidos de mañana + tarde)
        if (t.inicio - pz.inicio > p.amplitudMax) break;
        if (t === c || quitados.has(t) || t.fin + p.amplitudMax < pz.inicio || Math.max(t.fin, pz.fin) - Math.min(t.inicio, pz.inicio) > p.amplitudMax) continue;
        if (t.piezas.some(x => x.inicio < pz.fin && pz.inicio < x.fin)) continue;
        intentos++;
        const x = validar([...t.piezas, pz], p);
        if (x && (!estado || x.trabajo > estado.trabajo)) { destino = t; estado = x; }
      }
      if (!destino) { ok = false; break; }
      cambios.push([destino, { ...destino }]);
      Object.assign(destino, estado);
    }
    if (ok) quitados.add(c);
    else for (const [t, antes] of cambios.reverse()) Object.assign(t, antes);
    if (ok) lista = lista.filter(t => t !== c);
  }
  const finales = turnos.filter(t => !quitados.has(t)).map(t => cerrarTurno({ piezas: [...t.piezas].sort((a, b) => a.inicio - b.inicio) }, p));
  finales.sort((x, y) => x.inicio - y.inicio);
  finales.forEach((t, i) => { t.id = i + 1; for (const pz of t.piezas) pz.turno = t.id; });
  for (const pz of piezas) { delete pz.previa; }
  return { turnos: finales, piezas };
}

// Campos de la estrategia: cada calendario guarda la suya (la elige Optimizar)
export const CAMPOS_VEHICULOS = ["eleccion", "entreLineas", "vacios", "vacioKm"];
export const CAMPOS_TURNOS = ["corte", "emparejar"];
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
  };
}

/** Coste del día con los precios de Restricciones (null si no hay ninguno) */
export function costeDia({ horasPagadas, km, autobuses }, p) {
  if (!(p.costeHora > 0 || p.costeKm > 0 || p.costeVehiculoDia > 0)) return null;
  return horasPagadas * (p.costeHora || 0) + km * (p.costeKm || 0) + autobuses * (p.costeVehiculoDia || 0);
}

export const OBJETIVOS_VEHICULOS = [
  { id: "autobuses", nombre: "Menos autobuses", ayuda: "Primero la flota; a igualdad, menos km en vacío." },
  { id: "kmVacio", nombre: "Menos km en vacío", ayuda: "Primero los km en vacío; a igualdad, menos autobuses." },
  { id: "coste", nombre: "Menor coste", ayuda: "Autobuses × €/autobús·día + km × €/km, con los precios de Restricciones.", precios: ["costeVehiculoDia", "costeKm"] },
];
export const OBJETIVOS_TURNOS = [
  { id: "conductores", nombre: "Menos conductores", ayuda: "Primero los turnos; a igualdad, menos horas pagadas." },
  { id: "horas", nombre: "Menos horas pagadas", ayuda: "Primero las horas pagadas (el coste de personal); a igualdad, menos turnos." },
];
export const OBJETIVOS = [...OBJETIVOS_VEHICULOS, ...OBJETIVOS_TURNOS];

/** Nombre corto de una estrategia para enseñarla */
export function nombreEstrategia(v, piezaMax = PARAMS_DEFECTO.piezaMax) {
  const corte = v.corte === "equilibrado" ? "piezas equilibradas"
    : typeof v.corte === "number" && v.corte < piezaMax ? `piezas de hasta ${Math.floor(v.corte / 60)}h${String(v.corte % 60).padStart(2, "0")}` : "piezas largas";
  return [
    v.eleccion != null && (v.eleccion === "primero" ? "reparte la regulación" : "menos espera en cabecera"),
    v.vacios != null && (v.vacios === false || v.vacioKm === 0 ? "sin vacíos entre cabeceras" : v.vacioKm != null ? `vacíos de hasta ${String(v.vacioKm).replace(".", ",")} km` : "vacíos hasta el máximo"),
    v.entreLineas === false ? "sin cambiar de línea" : null,
    v.corte != null && corte,
    v.emparejar != null && (v.emparejar === "llena" ? "llenar turnos" : "menos espera entre piezas"),
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
  for (const vacioKm of radios) for (const eleccion of ["ultimo", "primero"]) for (const entreLineas of p.entreLineas ? [true, false] : [false]) {
    variantes.push({ eleccion, entreLineas, vacios: vacioKm > 0, vacioKm });
  }
  const probadas = [];
  for (const dv of variantes) {
    const q = { ...p, ...dv };
    const vehiculos = programarVehiculos(viajes, cfg, find, q, geo);
    const autobuses = repartirAutobuses(vehiculos, q).length;
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
  const cortes = ["max", 180, 150, 120, 90].filter(c => typeof c !== "number" || c < p.piezaMax);
  const variantes = cortes.flatMap(corte => ["primera", "llena"].map(emparejar => ({ corte, emparejar })));
  const probadas = [];
  for (const dt of variantes) {
    const { turnos } = programarTurnos(base.vehiculos, { ...p, ...dt }, base.find);
    const horasPagadas = turnos.reduce((s, t) => s + t.trabajo, 0) / 60;
    const r = {
      estrategia: dt, turnos: turnos.length, horasPagadas,
      avisos: turnos.filter(t => t.avisos.length).length,
      piezasMedias: turnos.length ? turnos.reduce((s, t) => s + t.piezas.length, 0) / turnos.length : 0,
      coste: p.costeHora > 0 ? horasPagadas * p.costeHora : null,
    };
    r.cumple = !(p.conductoresMax > 0 && r.turnos > p.conductoresMax);
    r.nombre = nombreEstrategia(dt, p.piezaMax);
    probadas.push(r);
    onProgreso?.(probadas.length, variantes.length);
  }
  const exceso = r => Math.max(0, p.conductoresMax > 0 ? r.turnos - p.conductoresMax : 0);
  ordenarPor(probadas, r => [exceso(r), r.avisos, ...(objetivo === "horas" ? [r.horasPagadas, r.turnos] : [r.turnos, r.horasPagadas])]);
  return { probadas, objetivo };
}

/** Los dos pasos seguidos: los mejores vehículos y, sobre ellos, los mejores turnos */
export function optimizarServicio(red, cfg = {}, opciones = {}, { objetivoVehiculos = "autobuses", objetivoTurnos = "conductores", cocheras = [] } = {}) {
  const v = optimizarVehiculos(red, cfg, opciones, { objetivo: objetivoVehiculos, cocheras }).probadas[0];
  const q = { ...opciones, ...(v?.estrategia || {}) };
  const t = optimizarTurnos(red, cfg, q, { objetivo: objetivoTurnos, cocheras }).probadas[0];
  return { estrategia: { ...(v?.estrategia || {}), ...(t?.estrategia || {}) }, vehiculos: v, turnos: t };
}

const hm = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
const reloj = m => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

function cerrarTurno(t, pOriginal) {
  const p = efectivos(pOriginal);
  const viajes = t.piezas.flatMap(pz => pz.viajes);
  t.inicio = t.piezas[0].inicio;
  t.fin = t.piezas.at(-1).fin;
  t.duracion = t.fin - t.inicio; // amplitud
  t.trabajo = t.duracion - t.piezas.slice(1).reduce((s, pz, i) => { const h = pz.inicio - t.piezas[i].fin; return s + (h >= p.huecoNoPagado ? h : 0); }, 0);
  t.partidos = t.piezas.slice(1).filter((pz, i) => pz.inicio - t.piezas[i].fin >= p.huecoNoPagado).length;
  t.conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  t.vehiculos = [...new Set(t.piezas.map(pz => pz.vehiculo))];
  // Conducción continua: se acumula hasta una pausa de pausaConduccionMin
  // (puede partirse en 15 + 30); la pausa entre piezas y las esperas largas cuentan
  let seguido = 0, peor = 0, pausaAcum = 0, hayPausa15 = false;
  viajes.forEach((v, i) => {
    if (i > 0) {
      const hueco = v.dep - viajes[i - 1].arr;
      if (hueco >= 15) { pausaAcum += hueco; hayPausa15 = true; }
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    peor = Math.max(peor, seguido);
  });
  t.avisos = [];
  if (p.aplicar561 && peor > p.conduccionContinuaMax) t.avisos.push(`${hm(peor)} de conducción sin la pausa de ${p.pausaConduccionMin} min (máx. ${hm(p.conduccionContinuaMax)}, UE 561/2006)`);
  if (p.aplicar561 && t.conduccion > p.conduccionDiariaMax) t.avisos.push(`Conducción de ${hm(t.conduccion)}: supera ${hm(p.conduccionDiariaMax)} (UE 561/2006)`);
  if (t.duracion > p.jornadaSinPausaMax && !hayPausa15) t.avisos.push(`Jornada de ${hm(t.duracion)} sin descanso de ${p.pausaJornadaMin} min (Estatuto, art. 34.4)`);
  // lo que el cálculo automático ya cumple siempre, pero un cambio a mano puede romper
  if (p._tipos) {
    const tipo = tipoDeTurno(t, p);
    t.tipo = tipo?.id || null; t.tipoNombre = tipo?.nombre || null;
    if (!tipo) t.avisos.push(`No encaja en ningún tipo de turno: ${hm(t.trabajo)} de trabajo, de ${reloj(t.inicio)} a ${reloj(t.fin)}${t.partidos ? ", partido" : ""}`);
  } else {
    if (t.duracion > p.amplitudMax) t.avisos.push(`Amplitud de ${hm(t.duracion)}: supera ${hm(p.amplitudMax)}`);
    if (t.trabajo > p.jornadaMax) t.avisos.push(`Jornada de trabajo de ${hm(t.trabajo)}: supera ${hm(p.jornadaMax)}`);
    if (t.partidos > p.maxPartidos) t.avisos.push(`${t.partidos} jornadas partidas: más de ${p.maxPartidos}`);
  }
  if (t.piezas.length > p.maxPiezas) t.avisos.push(`${t.piezas.length} piezas: más de ${p.maxPiezas}`);
  t.piezas.slice(1).forEach((pz, i) => {
    const a = t.piezas[i], hueco = pz.inicio - a.fin;
    if (hueco < 0) { t.avisos.push(`Las piezas de las ${reloj(a.inicio)} y las ${reloj(pz.inicio)} se solapan`); return; }
    const sigue = a.vehiculo === pz.vehiculo; // sigue en el mismo autobús: no hay relevo
    const hace = sigue ? 0 : a.d != null && a.d === pz.o ? p.relevoMin : p.desplazamiento;
    if (hueco < hace) t.avisos.push(`Solo ${hueco} min para ${a.d === pz.o ? "relevar" : "ir a otra cabecera"} a las ${reloj(pz.inicio)} (hacen falta ${hace})`);
  });
  return t;
}

/** Vehículos en servicio a la vez cada 15 minutos (el pico es la flota necesaria) */
export function perfilVehiculos(vehiculos, paso = 15) {
  if (!vehiculos.length) return [];
  const ini = Math.floor(Math.min(...vehiculos.map(v => v.inicio)) / paso) * paso;
  const fin = Math.ceil(Math.max(...vehiculos.map(v => v.fin)) / paso) * paso;
  const n = Math.max(1, (fin - ini) / paso);
  const cuenta = new Int32Array(n + 1);
  for (const v of vehiculos) {
    cuenta[Math.floor((v.inicio - ini) / paso)]++;
    cuenta[Math.min(n, Math.ceil((v.fin - ini) / paso))]--;
  }
  const out = [];
  let c = 0;
  for (let k = 0; k < n; k++) { c += cuenta[k]; out.push({ min: ini + k * paso, vehiculos: c }); }
  return out;
}

export function kpisServicio(viajes, vehiculos, turnosODeNull, autobuses = []) {
  const sinTurnos = turnosODeNull == null;
  const turnos = turnosODeNull || [];
  const kmVacio = vehiculos.reduce((s, v) => s + (v.kmVacio || 0), 0);
  const servicio = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  const enLinea = vehiculos.reduce((s, v) => s + (v.fin - v.inicio), 0);
  const pagado = turnos.reduce((s, t) => s + t.trabajo, 0);
  const conduccion = turnos.reduce((s, t) => s + t.conduccion, 0);
  const porTipo = {};
  for (const b of autobuses) porTipo[b.tipo || "sin tipo"] = (porTipo[b.tipo || "sin tipo"] || 0) + 1;
  return {
    viajes: viajes.length,
    bloques: vehiculos.length,
    autobuses: autobuses.length,
    pico: Math.max(0, ...perfilVehiculos(vehiculos).map(x => x.vehiculos)),
    horasServicio: servicio / 60,
    horasVehiculo: enLinea / 60,
    eficiencia: enLinea ? servicio / enLinea : null, // tiempo con viajeros / tiempo del autobús en línea
    km: viajes.reduce((s, v) => s + v.km, 0) + kmVacio, // con los vacíos
    kmVacio,
    vacios: vehiculos.reduce((s, v) => s + v.viajes.filter(x => x.vacio).length, 0),
    turnos: sinTurnos ? null : turnos.length,
    turnosDosPiezas: turnos.filter(t => t.piezas.length >= 2).length, // con relevo (dos o más piezas)
    piezasMedias: turnos.length ? turnos.reduce((s, t) => s + t.piezas.length, 0) / turnos.length : 0,
    turnosPartidos: turnos.filter(t => t.partidos > 0).length,
    turnosConAviso: sinTurnos ? null : turnos.filter(t => t.avisos.length).length,
    turnosPorTipo: turnos.reduce((o, t) => { const k = t.tipoNombre || (t.tipo === null ? "Sin tipo" : null); if (k) o[k] = (o[k] || 0) + 1; return o; }, {}),
    horasPagadas: sinTurnos ? null : pagado / 60,
    eficienciaPersonal: pagado ? conduccion / pagado : null, // conducción / tiempo de trabajo
    porTipo,
  };
}

export const esCalendario = dia => typeof dia === "string" && dia.startsWith("cal:");
/** Nombre de un tipo de día o de un calendario de la red */
export const nombreDia = (id, red) => (esCalendario(id) ? red?.calendarios?.find(c => c.id === id)?.nombre || "Calendario que ya no está en la red" : TIPOS_DIA.find(t => t.id === id)?.nombre || id);
/** Viajes de un sentido ese día */
export const viajesDia = (sentido, dia, red) => (esCalendario(dia) ? salidasDe(sentido, dia, red).lista.length : sentido.viajes?.[dia] || 0);

// ── Cambios a mano ─────────────────────────────────────────────────────
// Mover una expedición de un autobús a otro (paso 1) o una pieza de un turno
// a otro (paso 2). Devuelven un escenario nuevo (no tocan el de entrada) o
// { error } si no se puede (se solapa). Lo que se puede hacer pero incumple
// algo (no llega a tiempo, amplitud…) se deja y queda como aviso.
// Las claves no dependen de la estrategia, así que los cambios se pueden
// guardar y volver a aplicar sobre el mismo escenario recalculado.
export const claveViaje = v => `${v.linea}|${v.dir}|${v.dep}`;
export const clavePieza = pz => `${pz.vehiculo}|${pz.inicio}`;

// Rehace un bloque con sus expediciones: vacíos entre cabeceras, salida y vuelta a cochera
function montarBloque(veh, reales, r) {
  const { geo, cfg = {} } = r.ctx || {};
  const p = r.params, find = r.find || (x => x);
  const ord = [...reales].sort((a, b) => a.dep - b.dep);
  const viajes = [], avisos = [];
  ord.forEach((v, i) => {
    if (i > 0) {
      const a = ord[i - 1];
      const reg = cfg[a.linea]?.regulacion ?? p.regulacion;
      const km = find(a.d) === find(v.o) ? 0 : geo ? geo.km(a.d, v.o) : null;
      if (km == null) avisos.push(`De la ${a.nombre} a la ${v.nombre}: cabeceras distintas sin coordenadas para el vacío`);
      else if (km >= PEGADAS_KM) {
        const m = geo.min(km);
        viajes.push(vacio(a.d, v.o, Math.max(a.arr, Math.min(a.arr + reg, v.dep - m)), m, km, "cabecera", v.nombre));
        if (a.arr + reg + m > v.dep) avisos.push(`No llega a tiempo a la ${v.nombre} de las ${reloj(v.dep)}: vacío de ${String(km).replace(".", ",")} km (${m} min) y ${reg} min de regulación`);
      } else if (a.arr + reg > v.dep) avisos.push(`Solo ${v.dep - a.arr} min de regulación antes de la ${v.nombre} de las ${reloj(v.dep)} (mín. ${reg})`);
    }
    viajes.push(v);
  });
  veh.cochera = null;
  if (geo?.hayCocheras && ord.length) {
    const primero = ord[0], ultimo = ord.at(-1);
    veh.cochera = geo.cocheraDe(primero.linea, primero.o);
    const ida = geo.km(veh.cochera, primero.o), vuelta = geo.km(ultimo.d, veh.cochera);
    if (ida != null && ida >= PEGADAS_KM) { const m = geo.min(ida); viajes.unshift(vacio(veh.cochera, primero.o, primero.dep - m, m, ida, "salida", primero.nombre)); }
    if (vuelta != null && vuelta >= PEGADAS_KM) viajes.push(vacio(ultimo.d, veh.cochera, ultimo.arr, geo.min(vuelta), vuelta, "vuelta"));
  }
  veh.viajes = viajes;
  veh.inicio = viajes[0].dep;
  veh.fin = viajes.at(-1).arr;
  veh.lineas = [...new Set(ord.map(x => x.nombre))];
  veh.kmVacio = Math.round(viajes.reduce((t, x) => t + (x.vacio ? x.km : 0), 0) * 10) / 10;
  veh.avisos = avisos;
  veh.manual = true;
  return veh;
}

export function moverViaje(res, clave, busDestino) {
  const origen = res.vehiculos.find(b => b.viajes.some(v => !v.vacio && claveViaje(v) === clave));
  if (!origen) return { error: "No se encuentra esa expedición" };
  const viaje = origen.viajes.find(v => !v.vacio && claveViaje(v) === clave);
  if (busDestino != null && origen.autobus === busDestino) return { error: "Ya está en ese autobús" };
  let vehiculos = [...res.vehiculos];
  let autobuses = res.autobuses.map(b => ({ ...b, bloques: [...b.bloques] }));
  const bloque = id => vehiculos.find(v => v.id === id);
  let destino = null, bus = null;
  if (busDestino != null) {
    bus = autobuses.find(b => b.id === busDestino);
    if (!bus) return { error: `No existe el autobús ${busDestino}` };
    for (const b of bus.bloques.map(bloque)) for (const x of b.viajes) {
      if (!x.vacio && x.dep < viaje.arr && viaje.dep < x.arr) return { error: `Se solapa con la ${x.nombre} de las ${reloj(x.dep)}–${reloj(x.arr)} del autobús ${busDestino}` };
    }
    // el bloque de ese autobús en el que cae (o el más cercano a menos de 1 h)
    let mejor = Infinity;
    for (const b of bus.bloques.map(bloque)) {
      const d = viaje.dep < b.inicio ? b.inicio - viaje.arr : viaje.dep > b.fin ? viaje.dep - b.fin : 0;
      if (d <= 60 && d < mejor) { mejor = d; destino = b; }
    }
  }
  // quitarla de su bloque
  const resto = origen.viajes.filter(v => !v.vacio && v !== viaje);
  if (resto.length) vehiculos = vehiculos.map(v => (v === origen ? montarBloque({ ...origen }, resto, res) : v));
  else {
    vehiculos = vehiculos.filter(v => v !== origen);
    autobuses = autobuses.map(b => ({ ...b, bloques: b.bloques.filter(id => id !== origen.id) })).filter(b => b.bloques.length);
    if (bus) bus = autobuses.find(b => b.id === bus.id) || null;
  }
  // ponerla en el destino
  if (destino) {
    const d = vehiculos.find(v => v.id === destino.id);
    vehiculos = vehiculos.map(v => (v === d ? montarBloque({ ...d }, [...d.viajes.filter(x => !x.vacio), viaje], res) : v));
  } else {
    const id = Math.max(0, ...res.vehiculos.map(v => v.id)) + 1;
    if (!bus) {
      bus = { id: Math.max(0, ...res.autobuses.map(b => b.id)) + 1, tipo: origen.tipo, bloques: [], cochera: null };
      autobuses.push(bus);
    }
    bus.bloques.push(id);
    vehiculos.push(montarBloque({ id, tipo: origen.tipo, autobus: bus.id, relevos: [] }, [viaje], res));
  }
  // bloques del mismo autobús que se pisan (falta tiempo en cochera)
  for (const b of autobuses) {
    b.bloques.sort((x, y) => bloque(x).inicio - bloque(y).inicio);
    const lista = b.bloques.map(bloque);
    lista.slice(1).forEach((x, i) => {
      const margen = x.cochera ? res.params.margenCochera : res.params.margenVacio;
      if (lista[i].fin + margen > x.inicio) {
        const nuevo = { ...x, avisos: [...(x.avisos || []), `Empieza a las ${reloj(x.inicio)} y el bloque anterior de este autobús acaba a las ${reloj(lista[i].fin)}`] };
        vehiculos = vehiculos.map(v => (v === x ? nuevo : v));
      }
    });
    if (b.cochera == null) b.cochera = bloque(b.bloques[0])?.cochera ?? null;
  }
  // los turnos eran de los vehículos de antes: hay que rehacerlos (paso 2)
  vehiculos = vehiculos.map(v => (v.relevos?.length ? { ...v, relevos: [] } : v));
  return { ...res, vehiculos, autobuses, turnos: null, kpis: kpisServicio(res.viajes, vehiculos, null, autobuses), perfil: perfilVehiculos(vehiculos) };
}

export function moverPieza(res, clave, turnoDestino) {
  if (!res.turnos) return { error: "Aún no hay turnos" };
  const origen = res.turnos.find(t => t.piezas.some(pz => clavePieza(pz) === clave));
  if (!origen) return { error: "No se encuentra esa pieza" };
  const pz = origen.piezas.find(x => clavePieza(x) === clave);
  if (turnoDestino === origen.id) return { error: "Ya está en ese turno" };
  const p = res.params;
  let destino = null;
  if (turnoDestino != null) {
    destino = res.turnos.find(t => t.id === turnoDestino);
    if (!destino) return { error: `No existe el turno T${turnoDestino}` };
    const choca = destino.piezas.find(x => x.inicio < pz.fin && pz.inicio < x.fin);
    if (choca) return { error: `Se solapa con la pieza de las ${reloj(choca.inicio)}–${reloj(choca.fin)} del turno T${turnoDestino}` };
  }
  const id = destino ? destino.id : Math.max(0, ...res.turnos.map(t => t.id)) + 1;
  const movida = { ...pz, turno: id };
  const orden = l => l.sort((a, b) => a.inicio - b.inicio);
  let turnos = [];
  for (const t of res.turnos) {
    if (t === origen) { const resto = t.piezas.filter(x => x !== pz); if (resto.length) turnos.push(cerrarTurno({ id: t.id, piezas: resto }, p)); }
    else if (t === destino) turnos.push(cerrarTurno({ id: t.id, piezas: orden([...t.piezas, movida]) }, p));
    else turnos.push(t);
  }
  if (!destino) turnos.push(cerrarTurno({ id, piezas: [movida] }, p));
  for (const t of turnos) t.manual = t.manual || t.id === id || t.id === origen.id;
  // relevos del autobús de la pieza
  const piezasBus = orden(turnos.flatMap(t => t.piezas.filter(x => x.vehiculo === pz.vehiculo)));
  const vehiculos = res.vehiculos.map(v => (v.id === pz.vehiculo ? { ...v, relevos: piezasBus.map(x => ({ inicio: x.inicio, fin: x.fin, turno: x.turno })) } : v));
  return { ...res, vehiculos, turnos, kpis: kpisServicio(res.viajes, vehiculos, turnos, res.autobuses) };
}

/** Vuelve a aplicar cambios guardados ([{ tipo: "viaje" | "pieza", clave, destino }]); los que ya no encajan se saltan */
export function aplicarCambios(res, cambios = []) {
  let r = res;
  const fallidos = [];
  for (const c of cambios) {
    const x = c.tipo === "viaje" ? moverViaje(r, c.clave, c.destino) : moverPieza(r, c.clave, c.destino);
    if (x.error) fallidos.push({ ...c, error: x.error }); else r = x;
  }
  return { res: r, fallidos };
}
