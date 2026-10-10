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
import { particionTurnos } from "./lineas-particion.js";

// Tipos de turno (duty types): cada turno tiene que encajar en uno de los
// activos. Horas de inicio (desde–hasta, en minutos del día; si desde > hasta
// cruza la medianoche), trabajo mínimo y máximo, amplitud máxima, si puede
// ser partido y su split máximo (hueco sin pagar, null = sin límite), y el
// máximo de turnos de ese tipo al día (null = sin límite). Se prueban en
// este orden: el turno es del primero que encaja y aún tiene sitio.
export const TIPOS_TURNO_DEFECTO = [
  { id: "manana", nombre: "Mañana", activo: true, desde: 240, hasta: 600, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "tarde", nombre: "Tarde", activo: true, desde: 600, hasta: 1020, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "noche", nombre: "Noche", activo: true, desde: 1020, hasta: 240, trabajoMin: 300, trabajoMax: 480, amplitudMax: 540, partido: false },
  { id: "partido", nombre: "Partido", activo: true, desde: 240, hasta: 720, trabajoMin: 360, trabajoMax: 480, amplitudMax: 720, partido: true, splitMax: null, maximo: null },
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
  amplitudBusMax: null, // min de un autobús desde que sale de cochera hasta que vuelve (null = sin límite)
  vacioMaxKm: 20,       // km como mucho de un vacío entre cabeceras (0 = no se hacen)
  factorRodeo: 1.35,    // km por carretera / km en línea recta
  velocidadVacio: 25,   // km/h de los vacíos
  conduccionContinuaMax: 270, pausaConduccionMin: 45, conduccionDiariaMax: 540,
  jornadaSinPausaMax: 360, pausaJornadaMin: 15, // descanso si la jornada continuada pasa de (null = no se exige) · de cuántos min
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
  eleccion: "optimo",   // "optimo": el mínimo de autobuses (emparejamiento) · "ultimo": el autobús que quedó libre más tarde · "primero": el que lleva más esperando
  corte: 150,           // "max": piezas lo más largas posible · "equilibrado" · número: pieza objetivo en min (150: el mejor con la partición en redes grandes)
  emparejar: "primera", // "primera": el conductor que menos espera · "llena": el que lleva más horas (solo "voraz")
  metodo: "particion",  // "particion": muchos turnos posibles y se elige la mejor combinación (como Optibus/GoalSystem) · "voraz": pieza a pieza
  objetivoTurnos: "conductores", // a qué da prioridad la partición: "conductores" o "horas" (pagadas)
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
export const claveSalidas = (dir, dia) => `${dir}|${dia}`;
export function salidasDe(sentido, dia, red, cfgLinea) {
  // horas cambiadas a mano en Planning para ese sentido y día: mandan sobre el GTFS
  const editadas = cfgLinea?.salidas?.[claveSalidas(sentido.dir, dia)];
  if (Array.isArray(editadas)) return { lista: [...editadas].sort((a, b) => a - b), aproximado: false, editado: true };
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
  const { vehiculos, autobuses } = vehiculosYAutobuses(viajes, cfg, find, p, geo);
  for (const v of vehiculos) v.relevos = [];
  return {
    viajes, vehiculos, autobuses, turnos: null, find, ctx: { geo, cfg }, kpis: kpisServicio(viajes, vehiculos, null, autobuses), perfil: perfilVehiculos(vehiculos),
    aproximado, params: p, diaNombre: nombreDia(p.dia, red), conCocheras: !!geo?.hayCocheras,
  };
}

/** Paso 2: turnos de conductor sobre los bloques del paso 1 (no los cambia) */
export function generarTurnos(resVehiculos, opciones = {}, { grupos = null } = {}) {
  const r = resVehiculos;
  const p = { ...r.params, ...opciones };
  const { turnos, piezas } = programarTurnos(r.vehiculos, p, r.find, grupos);
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
      const { lista, aproximado: ap } = salidasDe(s, p.dia, red, c);
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
  // Amplitud máxima del autobús: desde que sale de cochera (o del primer
  // viaje, sin cocheras) hasta que vuelve tras el último viaje
  const ampMax = p.amplitudBusMax > 0 ? p.amplitudBusMax : Infinity;
  const minCochera = (a, b) => { const k = geo?.hayCocheras ? geo.km(a, b) : null; return k != null && k >= PEGADAS_KM ? geo.min(k) : 0; };
  const cocheraDe = v => (geo?.hayCocheras ? geo.cocheraDe(v.linea, v.o) : null);
  const cabe = (veh, v) => ampMax === Infinity || v.arr + (veh.cocheraEst ? minCochera(v.d, veh.cocheraEst) : 0) - veh.salida0 <= ampMax;
  const vale = (veh, v, c) => (p.entreLineas || veh.linea === v.linea) && admite(c, veh.tipo) && cabe(veh, v);
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
    if (!veh) {
      const cochera = ampMax < Infinity ? cocheraDe(v) : null;
      veh = { id: vehiculos.length + 1, tipo: tipoDeLinea(c), viajes: [], libre: 0, linea: v.linea, cocheraEst: cochera, salida0: v.dep - (cochera ? minCochera(cochera, v.o) : 0) };
      vehiculos.push(veh);
    }
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
    // un solo viaje (con la salida y la vuelta) ya más largo que el máximo: no se puede partir, se avisa
    if (ampMax < Infinity && veh.fin - veh.inicio > ampMax) veh.avisos = [`Amplitud del autobús de ${hm(veh.fin - veh.inicio)}: supera ${hm(ampMax)}`];
    delete veh.libre; delete veh.linea; delete veh.cocheraEst; delete veh.salida0;
  }
  return vehiculos;
}

// 1-bis) Vehículos con el mínimo de autobuses (como Optibus / GoalSystem).
// Cada viaje se puede enlazar con uno posterior que haga el mismo autobús:
// en la misma cabecera (tras la regulación), con un vacío a una cabecera
// cercana, o pasando por cochera (huecos largos; sin cocheras, con el
// margen del vacío). El mínimo de autobuses es el número de viajes menos el
// emparejamiento máximo de esos enlaces (cobertura mínima por caminos,
// Hopcroft–Karp). Los enlaces se prueban de más barato a más caro (misma
// cabecera y poca espera primero), así que entre las soluciones con el
// mínimo de autobuses salen pocos vacíos.
function programarVehiculosOptimo(viajes, cfg, find, p, geo) {
  const n = viajes.length;
  const vmax = p.vacios === false || !geo ? 0 : Math.min(p.vacioMaxKm || 0, p.vacioKm ?? Infinity);
  const reg = v => cfg[v.linea]?.regulacion ?? p.regulacion;
  const tipoDe = v => tipoDeLinea(cfg[v.linea]);
  const compatibles = (a, b) => { const ta = tipoDe(a), tb = tipoDe(b); return admite(cfg[b.linea], ta) && admite(cfg[a.linea], tb) && (ta == null || tb == null || ta === tb); };
  const cocheraDe = v => (geo?.hayCocheras ? geo.cocheraDe(v.linea, v.o) : null);
  const minK = (a, b) => { const k = geo ? geo.km(a, b) : null; return k != null && k >= PEGADAS_KM ? geo.min(k) : 0; };
  const deps = viajes.map(v => v.dep); // ya vienen por hora de salida
  const desde = (lista, t, dep) => { let lo = 0, hi = lista.length; while (lo < hi) { const mm = (lo + hi) >> 1; if (dep(lista[mm]) < t) lo = mm + 1; else hi = mm; } return lo; };
  const porLugar = new Map();
  viajes.forEach((v, i) => { const r = find(v.o); if (!porLugar.has(r)) porLugar.set(r, []); porLugar.get(r).push(i); });
  const raices = [...porLugar.keys()];
  const vecinos = new Map();
  const vecinosDe = r => {
    if (!vecinos.has(r)) {
      const l = [];
      if (vmax > 0) for (const x of raices) { if (x === r) continue; const k = geo.km(r, x); if (k != null && k <= vmax) l.push([x, k, k < PEGADAS_KM ? 0 : geo.min(k)]); }
      vecinos.set(r, l.sort((a, b) => a[1] - b[1]).slice(0, 12));
    }
    return vecinos.get(r);
  };
  const K = 10;
  const adyA = new Array(n), adyB = new Array(n), adyC = new Array(n); // misma cabecera · vacío · cochera
  for (let i = 0; i < n; i++) {
    const a = viajes[i], t0 = a.arr + reg(a), puesto = new Set();
    let l = adyA[i] = [];
    const poner = j => { if (!puesto.has(j)) { puesto.add(j); l.push(j); } };
    const mismaLinea = b => p.entreLineas || b.linea === a.linea;
    // 1) en la misma cabecera, la siguiente que sale
    const aqui = porLugar.get(find(a.d)) || [];
    // (en cabeceras con mucho tráfico, las siguientes K salen en minutos: se mira una ventana de 2 h)
    for (let k = desde(aqui, t0, j => deps[j]), c = 0; k < aqui.length && c < 40 && (c < K || deps[aqui[k]] <= t0 + 120); k++) { const j = aqui[k]; if (compatibles(a, viajes[j]) && mismaLinea(viajes[j])) { poner(j); c++; } }
    // 2) con un vacío a una cabecera cercana
    l = adyB[i] = [];
    let cv = 0;
    for (const [r2, , mins] of vecinosDe(find(a.d))) {
      const alli = porLugar.get(r2) || [];
      for (let k = desde(alli, t0 + mins, j => deps[j]), c = 0; k < alli.length && c < 2; k++) { const j = alli[k]; if (compatibles(a, viajes[j]) && mismaLinea(viajes[j])) { poner(j); c++; cv++; } }
      if (cv >= K) break;
    }
    // 3) pasando por cochera (o un descanso largo, sin cocheras): cualquier viaje que dé tiempo
    l = adyC[i] = [];
    const ci = cocheraDe(a);
    const tmin = ci ? a.arr + minK(a.d, ci) + p.margenCochera : a.arr + p.margenVacio;
    for (let k = desde(deps, tmin, x => x), c = 0, mirados = 0; k < n && c < K && mirados < 400; k++, mirados++) {
      const b = viajes[k];
      if (!compatibles(a, b)) continue;
      if (ci && (cocheraDe(b) !== ci || b.dep - minK(ci, b.o) < tmin)) continue;
      poner(k); c++;
    }
  }
  // Los enlaces de la solución voraz también son candidatos: así el
  // emparejamiento trabaja sobre algo que la contiene y nunca da más autobuses
  {
    const idx = new Map(viajes.map((v, i) => [v, i]));
    const voraz = programarVehiculos(viajes, cfg, find, { ...p, eleccion: "ultimo" }, geo);
    const buses = repartirAutobuses(voraz, p);
    const porId = new Map(voraz.map(v => [v.id, v]));
    for (const b of buses) {
      const l = b.bloques.map(id => porId.get(id)).sort((x, y) => x.inicio - y.inicio).flatMap(v => v.viajes.filter(x => !x.vacio)).map(x => idx.get(x));
      l.slice(1).forEach((j, k) => {
        const i = l[k], a = viajes[i], b2 = viajes[j];
        const lista = find(a.d) === find(b2.o) && b2.dep >= a.arr + reg(a) ? adyA : vmax > 0 && geo.km(a.d, b2.o) != null && geo.km(a.d, b2.o) <= vmax ? adyB : adyC;
        if (!adyA[i].includes(j) && !adyB[i].includes(j) && !adyC[i].includes(j)) lista[i].push(j);
      });
    }
  }
  // Hopcroft–Karp sin recursión (con decenas de miles de viajes la pila no da)
  const mL = new Int32Array(n).fill(-1), mR = new Int32Array(n).fill(-1), dist = new Int32Array(n), it = new Int32Array(n);
  const INF = 1 << 30;
  const bfs = () => {
    const cola = [];
    for (let i = 0; i < n; i++) { if (mL[i] < 0) { dist[i] = 0; cola.push(i); } else dist[i] = INF; }
    let libre = false;
    for (let h = 0; h < cola.length; h++) {
      const u = cola[h];
      for (const v of ady[u]) { const w = mR[v]; if (w < 0) libre = true; else if (dist[w] === INF) { dist[w] = dist[u] + 1; cola.push(w); } }
    }
    return libre;
  };
  const aumentar = raiz => {
    const pila = [raiz], via = [];
    while (pila.length) {
      const u = pila[pila.length - 1];
      let bajo = false;
      while (it[u] < ady[u].length) {
        const v = ady[u][it[u]++], w = mR[v];
        if (w < 0) {
          via.push(v);
          for (let k = pila.length - 1; k >= 0; k--) { mL[pila[k]] = via[k]; mR[via[k]] = pila[k]; }
          return true;
        }
        if (dist[w] === dist[u] + 1) { via.push(v); pila.push(w); bajo = true; break; }
      }
      if (!bajo) { dist[u] = INF; pila.pop(); via.pop(); }
    }
    return false;
  };
  // Por fases: primero solo los enlaces baratos; los vacíos y las idas a cochera
  // entran después, solo si hacen falta para quitar autobuses (el resultado es
  // el mismo mínimo de autobuses, con menos km en vacío)
  let ady = adyA;
  for (const fase of [[adyA], [adyA, adyC], [adyA, adyC, adyB]]) {
    ady = fase.length === 1 ? adyA : Array.from({ length: n }, (_, i) => fase.flatMap(x => x[i]));
    while (bfs()) { it.fill(0); for (let i = 0; i < n; i++) if (mL[i] < 0) aumentar(i); }
  }
  // Repaso de intercambios: con el mismo número de autobuses, cambiar quién
  // hace el viaje siguiente si así se ahorran km en vacío (a→b y c→d pasan a
  // a→d y c→b). El emparejamiento da el mínimo de autobuses, pero no mira
  // los km; sin esto, en redes grandes metía muchos vacíos innecesarios.
  const costeEnlace = (a, b) => {
    if (b.dep < a.arr + reg(a) || !compatibles(a, b)) return Infinity;
    const misma = p.entreLineas || b.linea === a.linea;
    if (misma && find(a.d) === find(b.o)) return 0;
    if (misma && vmax > 0) { const k = geo.km(a.d, b.o); if (k != null && k <= vmax && b.dep >= a.arr + reg(a) + (k < PEGADAS_KM ? 0 : geo.min(k))) return k; }
    const ci = cocheraDe(a);
    if (ci) {
      if (cocheraDe(b) !== ci) return Infinity;
      const kv = geo.km(a.d, ci) ?? 0, ks = geo.km(ci, b.o) ?? 0;
      return b.dep - minK(ci, b.o) >= a.arr + minK(a.d, ci) + p.margenCochera ? kv + ks : Infinity;
    }
    return b.dep >= a.arr + p.margenVacio ? 0.5 : Infinity; // descanso largo sin cocheras: casi gratis
  };
  for (let pasada = 0; pasada < 12; pasada++) {
    let mejoras = 0;
    for (let a = 0; a < n; a++) {
      const b = mL[a];
      if (b < 0) continue;
      const cab = costeEnlace(viajes[a], viajes[b]);
      if (cab === 0) continue;
      // candidatos d: los de la misma cabecera donde acaba a y los de cabeceras más cerca que b
      for (const d of adyA[a].concat(adyB[a])) {
        if (d === b) continue;
        const c = mR[d];
        const cad = costeEnlace(viajes[a], viajes[d]);
        if (cad === Infinity) continue;
        if (c < 0) {
          // d empieza un autobús: a se queda d y b pasa a empezar autobús (mismo número)
          if (cad < cab) { mL[a] = d; mR[d] = a; mR[b] = -1; mejoras++; break; }
          continue;
        }
        const ccd = costeEnlace(viajes[c], viajes[d]), ccb = costeEnlace(viajes[c], viajes[b]);
        if (ccb === Infinity || cad + ccb >= cab + ccd - 1e-9) continue;
        mL[a] = d; mR[d] = a; mL[c] = b; mR[b] = c; mejoras++;
        break;
      }
    }
    if (!mejoras) break;
  }

  // Caminos = autobuses; se parten en bloques donde el enlace pasa por cochera
  const enLinea = (a, b) => {
    if (b.dep < a.arr + reg(a)) return false;
    if (!p.entreLineas && b.linea !== a.linea) return false; // cambiar de línea sin pasar por cochera no se permite
    if (find(a.d) === find(b.o)) return true;
    const k = vmax > 0 ? geo.km(a.d, b.o) : null;
    return k != null && k <= vmax && b.dep >= a.arr + reg(a) + (k < PEGADAS_KM ? 0 : geo.min(k));
  };
  const ampMax = p.amplitudBusMax > 0 ? p.amplitudBusMax : Infinity;
  const caminos = [];
  for (let i = 0; i < n; i++) {
    if (mR[i] >= 0) continue;
    let actual = [];
    for (let j = i; j >= 0; j = mL[j]) {
      const v = viajes[j];
      // amplitud máxima del autobús: si el siguiente viaje la pasa, empieza otro autobús
      if (actual.length && ampMax < Infinity) {
        const ci = cocheraDe(viajes[actual[0]]);
        const ini = viajes[actual[0]].dep - (ci ? minK(ci, viajes[actual[0]].o) : 0);
        if (v.arr + (ci ? minK(v.d, ci) : 0) - ini > ampMax) { caminos.push(actual); actual = []; }
      }
      actual.push(j);
    }
    caminos.push(actual);
  }
  caminos.sort((x, y) => viajes[x[0]].dep - viajes[y[0]].dep);
  const ctx = { ctx: { geo, cfg }, params: p, find };
  const vehiculos = [], autobuses = [];
  for (const c of caminos) {
    const bus = { id: autobuses.length + 1, tipo: tipoDe(viajes[c[0]]), bloques: [], cochera: null };
    let bloque = [];
    const cerrar = () => {
      if (!bloque.length) return;
      const veh = montarBloque({ id: vehiculos.length + 1, tipo: bus.tipo, autobus: bus.id, relevos: [] }, bloque.map(j => viajes[j]), ctx);
      veh.manual = false;
      if (!veh.avisos.length) delete veh.avisos;
      vehiculos.push(veh); bus.bloques.push(veh.id);
      if (bus.cochera == null) bus.cochera = veh.cochera || null;
      bloque = [];
    };
    c.forEach((j, k) => { if (k && !enLinea(viajes[c[k - 1]], viajes[j])) cerrar(); bloque.push(j); });
    cerrar();
    autobuses.push(bus);
  }
  return { vehiculos, autobuses };
}
// Los dos pasos del paso 1 según la estrategia: el óptimo o el voraz de siempre
function vehiculosYAutobuses(viajes, cfg, find, p, geo) {
  if (p.eleccion === "optimo") return programarVehiculosOptimo(viajes, cfg, find, p, geo);
  const vehiculos = programarVehiculos(viajes, cfg, find, p, geo);
  return { vehiculos, autobuses: repartirAutobuses(vehiculos, p) };
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
      if (p.amplitudBusMax > 0 && veh.fin - bus.inicio > p.amplitudBusMax) continue; // amplitud máxima del autobús
      if (!mejor || bus.libre > mejor.libre) mejor = bus;
    }
    if (!mejor) { mejor = { id: autobuses.length + 1, tipo: veh.tipo, bloques: [], libre: 0, inicio: veh.inicio, cochera: veh.cochera || null }; autobuses.push(mejor); }
    mejor.bloques.push(veh.id);
    mejor.libre = veh.fin;
    if (mejor.tipo == null) mejor.tipo = veh.tipo;
    veh.autobus = mejor.id;
  }
  autobuses.forEach(b => { delete b.libre; delete b.inicio; });
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
        const obligado = (p.aplicar561 && pz.conduccion + dur > p.conduccionContinuaMax) || fin - pz.inicio > p.piezaMax;
        if (obligado || (fin - pz.inicio > lim && pz.fin - pz.inicio >= minima)) { piezas.push(pz); previa = pz; pz = null; }
      }
      if (!pz) pz = { vehiculo: veh.id, inicio: tramo[0].dep, fin, conduccion: 0, viajes: [], previa, o: find ? find(tramo[0].o) : tramo[0].o };
      for (const v of tramo) { pz.viajes.push(v); pz.fin = v.arr; pz.conduccion += v.arr - v.dep; pz.d = find ? find(v.d) : v.d; }
    }
    if (pz) {
      // el final del autobús, si es más corto que el mínimo, se queda con la pieza anterior si cabe
      const ant = pz.previa;
      if (ant && pz.fin - pz.inicio < minima && pz.fin - ant.inicio <= p.piezaMax && (!p.aplicar561 || ant.conduccion + pz.conduccion <= p.conduccionContinuaMax)) {
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
  if (t.partidos && tipo.splitMax > 0 && (t.split || 0) > tipo.splitMax) return false; // hueco del partido demasiado largo
  if (final && tipo.partido && !t.partidos) return false; // un partido tiene que tener su hueco (sin él, es otro tipo)
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
      if (h >= 15) pausaAcum += h; // la pausa de conducción se puede partir 15 + 30
      if (h >= (p.pausaJornadaMin || 15)) hay15 = true; // descanso de jornada (Estatuto / convenio)
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    if (p.aplicar561 && seguido > p.conduccionContinuaMax) return null;
    finPrev = v.arr;
  }
  if (p.jornadaSinPausaMax > 0 && pz.fin - inicio > p.jornadaSinPausaMax && !hay15) return null; // descanso si la jornada pasa de X (sin valor: no se exige)
  const estado = { inicio, fin: pz.fin, d: pz.d, trabajo, conduccion, seguido, pausaAcum, hay15, partidos: (t ? t.partidos : 0) + (partido ? 1 : 0), split: Math.max(t ? t.split || 0 : 0, partido ? hueco : 0) };
  if (p._tipos && !p._tipos.some(x => encajaTipo(estado, x))) return null; // ningún tipo de turno lo admite
  return estado;
}
/**
 * Pone el tipo a cada turno respetando el máximo de cada tipo: primero los
 * turnos que encajan en menos tipos (los que menos alternativas tienen), cada
 * uno en el primer tipo de la lista en el que encaja y aún queda sitio. El que
 * no encaja en ninguno, o solo en tipos ya llenos, queda sin tipo y con aviso.
 */
export function asignarTipos(turnos, pOriginal) {
  const p = efectivos(pOriginal);
  if (!p._tipos) return turnos;
  const usados = new Map();
  const encajan = new Map(turnos.map(t => [t, p._tipos.filter(x => encajaTipo(t, x, true))]));
  const orden = [...turnos].sort((a, b) => encajan.get(a).length - encajan.get(b).length || a.inicio - b.inicio);
  for (const t of orden) {
    t.avisos = (t.avisos || []).filter(a => !/^No encaja en ningún tipo|^Ya hay el máximo de turnos/.test(a));
    const posibles = encajan.get(t);
    const tipo = posibles.find(x => !(x.maximo > 0) || (usados.get(x.id) || 0) < x.maximo);
    t.tipo = tipo?.id || null; t.tipoNombre = tipo?.nombre || null;
    if (tipo) usados.set(tipo.id, (usados.get(tipo.id) || 0) + 1);
    else if (posibles.length) t.avisos.push(`Ya hay el máximo de turnos de tipo ${posibles.map(x => `${x.nombre} (${x.maximo})`).join(" / ")}`);
    else t.avisos.push(`No encaja en ningún tipo de turno: ${hm(t.trabajo)} de trabajo, de ${reloj(t.inicio)} a ${reloj(t.fin)}${t.partidos ? `, partido con ${hm(t.split || 0)} de hueco` : ""}`);
  }
  return turnos;
}

// Coste de un turno para la partición: un conductor pesa mucho (o poco si el
// objetivo son las horas), más las horas pagadas; un turno que no encaja en
// ningún tipo, muchísimo (solo se usa si no hay otra forma de cubrir la pieza).
function costeTurno(e, piezas, p) {
  const porConductor = p.objetivoTurnos === "horas" ? 60 : 600;
  let c = porConductor + e.trabajo + piezas.length * 5;
  if (e.sinValidar) c += 5000;
  else if (p._tipos && !tipoDeTurno(e, p)) c += 900;
  return c;
}
function estadoSuelto(pz) {
  return { piezas: [pz], inicio: pz.inicio, fin: pz.fin, d: pz.d, trabajo: pz.fin - pz.inicio, conduccion: pz.conduccion, seguido: 0, pausaAcum: 0, hay15: true, partidos: 0 };
}
function turnosPorParticion(piezas, p) {
  const topes = p._tipos ? p._tipos.map(x => (x.maximo > 0 ? x.maximo : Infinity)) : [];
  const conTope = topes.some(Number.isFinite);
  const partidos = (p._tipos || []).filter(x => x.partido);
  const splitMax = partidos.length && partidos.every(x => x.splitMax > 0) ? Math.max(...partidos.map(x => x.splitMax)) : Infinity;
  const grupos = particionTurnos(piezas, {
    valida: l => validar(l, p), coste: (e, l) => costeTurno(e, l, p),
    ...(conTope ? { topes, tipoDe: e => p._tipos.findIndex(x => encajaTipo(e, x, true)) } : {}),
    huecoMax: splitMax,
    extiende: (e, pz) => { const x = anadir(e, pz, p); return x && { ...x, piezas: [...e.piezas, pz] }; },
    desplazamiento: p.desplazamiento, amplitudMax: p.amplitudMax, huecoNoPagado: p.huecoNoPagado, jornadaMax: p.jornadaMax,
    maxPiezas: Math.min(4, p.maxPiezas),
  });
  return grupos.map(g => { const l = g.map(i => piezas[i]); return validar(l, p) || estadoSuelto(l[0]); });
}

// La partición calculada en otro sitio (el worker) llega como grupos de
// claves de pieza; aquí se montan los turnos con las piezas de este cálculo.
function turnosDeGrupos(piezas, grupos, p) {
  const porClave = new Map(piezas.map(pz => [clavePieza(pz), pz]));
  const puestas = new Set();
  const turnos = [];
  for (const g of grupos) {
    const l = g.map(k => porClave.get(k)).filter(pz => pz && !puestas.has(pz));
    if (!l.length) continue;
    l.forEach(pz => puestas.add(pz));
    turnos.push(validar(l, p) || estadoSuelto(l[0]));
    if (!validar(l, p)) for (const pz of l.slice(1)) turnos.push(estadoSuelto(pz)); // no debería pasar
  }
  for (const pz of piezas) if (!puestas.has(pz)) turnos.push(validar([pz], p) || estadoSuelto(pz));
  return turnos;
}
/** Solo la partición (lo pesado), para hacerla en el worker: grupos de claves de pieza */
export function gruposTurnos(resVehiculos, opciones = {}) {
  const r = resVehiculos;
  const p = efectivos({ ...r.params, ...opciones });
  const piezas = cortarPiezas(r.vehiculos, p, r.find);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  return turnosPorParticion(piezas, p).map(t => t.piezas.map(clavePieza));
}

// Rehace un turno desde cero con sus piezas en orden (null si no vale)
export function validar(piezas, p) {
  const orden = [...piezas].sort((a, b) => a.inicio - b.inicio);
  let t = null;
  for (let i = 0; i < orden.length; i++) {
    const x = anadir(t, orden[i], p);
    if (!x) return null;
    t = { ...x, piezas: orden.slice(0, i + 1) };
  }
  return t;
}

function programarTurnos(vehiculos, pOriginal, find, grupos = null) {
  const p = efectivos(pOriginal);
  const piezas = cortarPiezas(vehiculos, p, find);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  const turnos = p.metodo === "voraz" ? [] : grupos ? turnosDeGrupos(piezas, grupos, p) : turnosPorParticion(piezas, p);
  // Voraz: cada pieza va al conductor que mejor la aprovecha: el que sigue en
  // ese autobús, si no el que menos espera ("primera") o el que lleva más
  // horas ("llena"); si no cabe en ninguno, entra un conductor nuevo.
  let activos = [];
  const deLaPieza = new Map(); // pieza → turno (para seguir en el mismo autobús)
  for (let i = 0; i < (p.metodo === "voraz" ? piezas.length : 0); i++) {
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
        // con tipos de turno, el turno que recibe la pieza tiene que seguir encajando en uno
        if (x && p._tipos && !tipoDeTurno(x, p)) continue;
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
  const finales = asignarTipos(turnos.filter(t => !quitados.has(t)).map(t => cerrarTurno({ piezas: [...t.piezas].sort((a, b) => a.inicio - b.inicio) }, p)), p);
  finales.sort((x, y) => x.inicio - y.inicio);
  finales.forEach((t, i) => { t.id = i + 1; for (const pz of t.piezas) pz.turno = t.id; });
  for (const pz of piezas) { delete pz.previa; }
  return { turnos: finales, piezas };
}

// Campos de la estrategia: cada calendario guarda la suya (la elige Optimizar)
export const CAMPOS_VEHICULOS = ["eleccion", "entreLineas", "vacios", "vacioKm"];
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
    v.eleccion != null && (v.eleccion === "optimo" ? "mínimo de autobuses (óptimo)" : v.eleccion === "primero" ? "reparte la regulación" : "menos espera en cabecera"),
    v.vacios != null && (v.vacios === false || v.vacioKm === 0 ? "sin vacíos entre cabeceras" : v.vacioKm != null ? `vacíos de hasta ${String(v.vacioKm).replace(".", ",")} km` : "vacíos hasta el máximo"),
    v.entreLineas === false ? "sin cambiar de línea" : null,
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
  // por cada corte: la partición (como Optibus/GoalSystem) y las dos voraces de antes; se queda la mejor
  const variantes = cortes.flatMap(corte => [{ corte, metodo: "particion" }, ...["primera", "llena"].map(emparejar => ({ corte, emparejar, metodo: "voraz" }))]);
  const probadas = [];
  for (const dt of variantes) {
    const { turnos } = programarTurnos(base.vehiculos, { ...p, objetivoTurnos: objetivo === "horas" ? "horas" : "conductores", ...dt }, base.find);
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
  t.split = Math.max(0, ...t.piezas.slice(1).map((pz, i) => pz.inicio - t.piezas[i].fin).filter(h => h >= p.huecoNoPagado));
  t.conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  t.vehiculos = [...new Set(t.piezas.map(pz => pz.vehiculo))];
  // Conducción continua: se acumula hasta una pausa de pausaConduccionMin
  // (puede partirse en 15 + 30); la pausa entre piezas y las esperas largas cuentan
  let seguido = 0, peor = 0, pausaAcum = 0, hayPausa15 = false;
  viajes.forEach((v, i) => {
    if (i > 0) {
      const hueco = v.dep - viajes[i - 1].arr;
      if (hueco >= 15) pausaAcum += hueco;
      if (hueco >= (p.pausaJornadaMin || 15)) hayPausa15 = true;
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    peor = Math.max(peor, seguido);
  });
  t.avisos = [];
  if (p.aplicar561 && peor > p.conduccionContinuaMax) t.avisos.push(`${hm(peor)} de conducción sin la pausa de ${p.pausaConduccionMin} min (máx. ${hm(p.conduccionContinuaMax)}, UE 561/2006)`);
  if (p.aplicar561 && t.conduccion > p.conduccionDiariaMax) t.avisos.push(`Conducción de ${hm(t.conduccion)}: supera ${hm(p.conduccionDiariaMax)} (UE 561/2006)`);
  if (p.jornadaSinPausaMax > 0 && t.duracion > p.jornadaSinPausaMax && !hayPausa15) t.avisos.push(`Jornada de ${hm(t.duracion)} sin descanso de ${p.pausaJornadaMin} min (lo exige a partir de ${hm(p.jornadaSinPausaMax)})`);
  // lo que el cálculo automático ya cumple siempre, pero un cambio a mano puede romper
  if (p._tipos) {
    // el tipo: asignarTipos (con los máximos de cada tipo, que dependen de todos los turnos)
    const tipo = tipoDeTurno(t, p);
    t.tipo = tipo?.id || null; t.tipoNombre = tipo?.nombre || null;
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
export const viajesDia = (sentido, dia, red, cfgLinea) => (cfgLinea?.salidas?.[claveSalidas(sentido.dir, dia)] || esCalendario(dia) ? salidasDe(sentido, dia, red, cfgLinea).lista.length : sentido.viajes?.[dia] || 0);

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
  if (p.amplitudBusMax > 0 && veh.fin - veh.inicio > p.amplitudBusMax) avisos.push(`Amplitud del autobús de ${hm(veh.fin - veh.inicio)}: supera ${hm(p.amplitudBusMax)}`);
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
    // varios bloques en el mismo autobús: de la primera salida a la última vuelta
    const ampMax = res.params.amplitudBusMax;
    if (ampMax > 0 && lista.length > 1 && lista.at(-1).fin - lista[0].inicio > ampMax) {
      const ultimo = lista.at(-1);
      const aviso = `El autobús ${b.id} está fuera ${hm(ultimo.fin - lista[0].inicio)}: supera la amplitud máxima de ${hm(ampMax)}`;
      vehiculos = vehiculos.map(v => (v.id === ultimo.id && !(v.avisos || []).includes(aviso) ? { ...v, avisos: [...(v.avisos || []), aviso] } : v));
    }
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
    else turnos.push({ ...t }); // copia: asignarTipos no toca el escenario anterior
  }
  if (!destino) turnos.push(cerrarTurno({ id, piezas: [movida] }, p));
  asignarTipos(turnos, p); // los máximos por tipo dependen de todos los turnos
  for (const t of turnos) t.manual = t.manual || t.id === id || t.id === origen.id;
  // relevos del autobús de la pieza
  const piezasBus = orden(turnos.flatMap(t => t.piezas.filter(x => x.vehiculo === pz.vehiculo)));
  const vehiculos = res.vehiculos.map(v => (v.id === pz.vehiculo ? { ...v, relevos: piezasBus.map(x => ({ inicio: x.inicio, fin: x.fin, turno: x.turno })) } : v));
  return { ...res, vehiculos, turnos, kpis: kpisServicio(res.viajes, vehiculos, turnos, res.autobuses) };
}

/** Vuelve a aplicar cambios guardados ([{ tipo: "viaje" | "pieza", clave, destino }]); los que ya no encajan se saltan */
/**
 * Varias expediciones a la vez al mismo autobús (o a uno nuevo, el mismo para
 * todas). Todo o nada: si alguna no cabe, no se mueve ninguna.
 */
export function moverViajes(res, claves, busDestino) {
  let r = res, destino = busDestino;
  const orden = [...claves].sort((a, b) => Number(a.split("|")[2]) - Number(b.split("|")[2]));
  for (const clave of orden) {
    const antes = new Set(r.autobuses.map(b => b.id));
    const x = moverViaje(r, clave, destino);
    if (x.error) {
      if (/Ya está en ese autobús/.test(x.error)) continue;
      return { error: x.error };
    }
    // la primera crea el autobús nuevo: las demás van a ese mismo
    if (destino == null) destino = x.autobuses.find(b => !antes.has(b.id))?.id ?? x.vehiculos.find(v => v.viajes.some(y => !y.vacio && claveViaje(y) === clave))?.autobus;
    r = x;
  }
  return r;
}

// Una pieza en tramos: cada viaje con los vacíos que lleva delante; los del
// final (vuelta a cochera) con el último. Igual que al cortar piezas.
function tramosDe(viajes) {
  const tramos = [];
  let sueltos = [];
  for (const v of viajes) { sueltos.push(v); if (!v.vacio) { tramos.push(sueltos); sueltos = []; } }
  if (sueltos.length) { if (tramos.length) tramos.at(-1).push(...sueltos); else tramos.push(sueltos); }
  return tramos;
}

/**
 * Varios viajes (de uno o varios turnos) a otro turno, o a uno nuevo. Las
 * piezas de origen se parten donde empiezan y acaban los viajes elegidos
 * (relevos nuevos); cada vacío va con su viaje.
 */
export function moverViajesTurno(res, claves, turnoDestino) {
  if (!res.turnos) return { error: "Aún no hay turnos" };
  const elegidos = new Set(claves);
  const p = res.params, find = res.find || (x => x);
  const esElegido = tramo => tramo.some(v => !v.vacio && elegidos.has(claveViaje(v)));
  const afectadas = new Map(); // pieza → turno
  for (const t of res.turnos) for (const pz of t.piezas) if (pz.viajes.some(v => !v.vacio && elegidos.has(claveViaje(v)))) afectadas.set(pz, t);
  if (!afectadas.size) return { error: "No se encuentran esos viajes" };
  let destino = null;
  if (turnoDestino != null) {
    destino = res.turnos.find(t => t.id === turnoDestino);
    if (!destino) return { error: `No existe el turno T${turnoDestino}` };
    if ([...afectadas.values()].every(t => t === destino)) return { error: "Ya están en ese turno" };
  }
  const id = destino ? destino.id : Math.max(0, ...res.turnos.map(t => t.id)) + 1;
  const pieza = (vehiculo, viajes, turno) => ({
    vehiculo, turno, viajes, inicio: viajes[0].dep, fin: viajes.at(-1).arr,
    conduccion: viajes.reduce((s, v) => s + (v.arr - v.dep), 0), o: find(viajes[0].o), d: find(viajes.at(-1).d),
  });
  const quedan = new Map(), movidas = [];
  for (const [pz, t] of afectadas) {
    if (t === destino) continue; // los que ya están en el destino se quedan como están
    let grupo = [], marca = null;
    const cerrar = () => {
      if (!grupo.length) return;
      if (marca) movidas.push(pieza(pz.vehiculo, grupo, id));
      else { if (!quedan.has(t)) quedan.set(t, []); quedan.get(t).push(pieza(pz.vehiculo, grupo, t.id)); }
      grupo = [];
    };
    for (const tramo of tramosDe(pz.viajes)) {
      const e = esElegido(tramo);
      if (marca !== null && e !== marca) cerrar();
      marca = e; grupo.push(...tramo);
    }
    cerrar();
  }
  if (!movidas.length) return { error: "Ya están en ese turno" };
  if (destino) {
    for (const m of movidas) {
      const choca = destino.piezas.find(x => x.inicio < m.fin && m.inicio < x.fin);
      if (choca) return { error: `Se solapa con la pieza de las ${reloj(choca.inicio)}–${reloj(choca.fin)} del turno T${turnoDestino}` };
    }
  }
  const orden = l => l.sort((a, b) => a.inicio - b.inicio);
  const turnos = [];
  for (const t of res.turnos) {
    const origen = [...afectadas.values()].includes(t) && t !== destino;
    if (!origen && t !== destino) { turnos.push({ ...t }); continue; }
    const piezas = [...t.piezas.filter(x => !afectadas.has(x) || t === destino), ...(quedan.get(t) || []), ...(t === destino ? movidas : [])];
    if (piezas.length) turnos.push({ ...cerrarTurno({ id: t.id, piezas: orden(piezas) }, p), manual: true });
  }
  if (!destino) turnos.push({ ...cerrarTurno({ id, piezas: orden([...movidas]) }, p), manual: true });
  for (const t of turnos) for (const x of t.piezas) x.turno = t.id;
  asignarTipos(turnos, p);
  // relevos de los autobuses tocados
  const buses = new Set(movidas.map(x => x.vehiculo));
  const vehiculos = res.vehiculos.map(v => (buses.has(v.id)
    ? { ...v, relevos: orden(turnos.flatMap(t => t.piezas.filter(x => x.vehiculo === v.id))).map(x => ({ inicio: x.inicio, fin: x.fin, turno: x.turno })) }
    : v));
  return { ...res, vehiculos, turnos, kpis: kpisServicio(res.viajes, vehiculos, turnos, res.autobuses) };
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
  if (p.piezaMax >= jornada) r.push({ grave: false, texto: `Pieza máxima de ${p.piezaMax} min: una sola pieza puede ocupar el turno entero (${jornada} min), así que casi no habrá relevos ni partidos.` });
  if (p.aplicar561 !== false && (p.conduccionContinuaMax > 270 || p.pausaConduccionMin < 45)) r.push({ grave: false, texto: `Conducción continua de ${p.conduccionContinuaMax} min con pausa de ${p.pausaConduccionMin} min: no es lo de la UE 561/2006 (270 y 45). Si es a propósito, marca «No aplicar la UE 561/2006».` });
  if (p.regulacion === 0) r.push({ grave: false, texto: "Regulación en cabecera de 0 min: los autobuses salen en cuanto llegan." });
  for (const t of tipos) {
    if (t.trabajoMin > t.trabajoMax) r.push({ grave: true, texto: `Tipo «${t.nombre}»: el trabajo mínimo es mayor que el máximo.` });
    if (t.partido && !(p.maxPiezas >= 2)) r.push({ grave: true, texto: `Tipo «${t.nombre}» es partido, pero con ${p.maxPiezas ?? 0} pieza(s) por turno no puede haber partidos.` });
  }
  return r;
}

/** Cambios a mano: los de vehículos (paso 1) y los de turnos (paso 2) */
export const esCambioVehiculos = c => c.tipo === "viaje" || c.tipo === "viajes";
export const esCambioTurnos = c => c.tipo === "pieza" || c.tipo === "viajesTurno";

export function aplicarCambios(res, cambios = []) {
  let r = res;
  const fallidos = [];
  for (const c of cambios) {
    const x = c.tipo === "viaje" ? moverViaje(r, c.clave, c.destino)
      : c.tipo === "viajes" ? moverViajes(r, c.claves, c.destino)
        : c.tipo === "viajesTurno" ? moverViajesTurno(r, c.claves, c.destino)
          : moverPieza(r, c.clave, c.destino);
    if (x.error) fallidos.push({ ...c, error: x.error }); else r = x;
  }
  return { res: r, fallidos };
}
