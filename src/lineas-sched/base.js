// Scheduling de líneas · base: parámetros por defecto, tipos de turno, horas de
// salida y tiempos de cada sentido, cabeceras, calendarios y geografía (km en vacío).
import { franjaDe, TIPOS_DIA } from "../gtfs-red.js";


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
  esperaMaxCabecera: null, // min: si un autobús va a esperar más en una cabecera, vuelve a cochera (si le da tiempo) · null = espera donde esté
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
  desplazamiento: 20,   // min como mínimo para ir a otra cabecera a coger otra pieza (si está lejos, lo que se tarde: distancia a la velocidad de los vacíos)
  maxCambiosBus: null,  // cambios de autobús por turno como mucho, sin tipos de turno (null = sin límite; 0 = todo el turno en el mismo). Con tipos: tipo.cambiosBus
  turnoUnaLinea: false,  // (= mezclaTurnos "linea")
  gruposLineas: [],      // [{ id, nombre, lineas: [nombre de línea] }]: las que no están en ninguno, cada una su grupo
  mezclaBuses: "libre",  // con entreLineas: "libre" (cualquier línea) · "grupo" (solo dentro de su grupo)
  mezclaTurnos: "libre", // "libre" · "grupo" (un conductor, solo líneas de un grupo) · "linea" (una sola línea; o turnoUnaLinea)  // cada turno, de una sola línea (no se mezclan líneas; las variantes de una línea cuentan como la misma)
  maxCambiosBusTotal: null, // cambios de autobús de todos los turnos del escenario, como mucho (null = sin límite)
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
  bloqueMax: null,      // min que un autobús está fuera de cochera, como mucho (null = lo que dé; ~ un turno: cada conductor hace el autobús entero)
  costeCambioBus: null, // € que se le pone a cada cambio de autobús de un conductor (Optimizar todo junto; null = el orientativo)
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
    // sin repetidas: el mismo viaje en dos servicios del calendario (error del GTFS) es uno
    return { lista: [...new Set(sentido.porServicio.filter(([k]) => set.has(k)).flatMap(([, l]) => l))].sort((a, b) => a - b), aproximado: false };
  }
  if (Array.isArray(sentido.salidas?.[dia])) return { lista: [...new Set(sentido.salidas[dia])], aproximado: false };
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

/**
 * Pasos por parada de una expedición que sale a las `salida`: minutos de paso
 * por cada parada del sentido. Se reparte el tiempo de recorrido de su franja
 * (el corregido a mano, si lo hay) como lo hacen los viajes del GTFS; si la
 * red no lo trae (dibujada a mano o importada antes), por la distancia entre
 * paradas (aproximado).
 * @returns { pasos: [min], aproximado }
 */
export function pasosPorParada(sentido, salida, red, cfgLinea) {
  const n = sentido.paradas?.length || 0;
  const dur = duracionViaje(sentido, salida, cfgLinea);
  let fr = Array.isArray(sentido.fracciones) && sentido.fracciones.length === n ? sentido.fracciones : null;
  const aproximado = !fr;
  if (!fr) fr = fraccionesPorDistancia(sentido, red);
  return { pasos: fr.map(f => Math.round(salida + f * dur)), aproximado };
}
const fracCache = new WeakMap();
function fraccionesPorDistancia(sentido, red) {
  if (fracCache.has(sentido)) return fracCache.get(sentido);
  const n = sentido.paradas.length;
  const coord = new Map((red?.paradas || []).map(p => [p.id, [p.lat, p.lng]]));
  const acum = [0];
  for (let i = 1; i < n; i++) {
    const a = coord.get(sentido.paradas[i - 1]), b = coord.get(sentido.paradas[i]);
    acum.push(acum[i - 1] + (a && b ? kmRecta(a, b) : 0));
  }
  const total = acum[n - 1];
  const fr = total > 0 ? acum.map(x => x / total) : acum.map((_, i) => (n > 1 ? i / (n - 1) : 0));
  fracCache.set(sentido, fr);
  return fr;
}

/** Une cabeceras: llegada de la ida = salida de la vuelta (y al revés) de cada línea */
/**
 * Las cabeceras de la red (las paradas donde empiezan y acaban los sentidos,
 * juntando las de la ida y la vuelta de cada línea), para elegir los puntos
 * de relevo en Planning. [{ id, paradas: [ids], nombre, lineas: [nombres] }]
 */
export function cabecerasDeRed(red) {
  const lineas = red?.lineas || [];
  const find = cabeceras(lineas);
  const nombre = new Map((red?.paradas || []).map(x => [x.id, x.nombre]));
  const grupos = new Map();
  for (const l of lineas) for (const s of l.sentidos) for (const id of [s.paradas[0], s.paradas.at(-1)]) {
    if (id == null) continue;
    const r = find(id);
    if (!grupos.has(r)) grupos.set(r, { id: r, paradas: new Set(), lineas: new Set() });
    grupos.get(r).paradas.add(id); grupos.get(r).lineas.add(l.nombre);
  }
  return [...grupos.values()].map(g => ({ id: g.id, paradas: [...g.paradas], nombre: nombre.get(g.id) || [...g.paradas].map(x => nombre.get(x)).find(Boolean) || g.id, lineas: [...g.lineas].sort((a, b) => a.localeCompare(b, "es", { numeric: true })) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function cabeceras(lineas) {
  const padre = new Map();
  const find = x => { while (padre.has(x) && padre.get(x) !== x) x = padre.get(x); return x; };
  const unir = (a, b) => { if (a == null || b == null) return; const ra = find(a), rb = find(b); if (ra !== rb) padre.set(ra, rb); };
  for (const l of lineas) {
    const [ida, vuelta] = l.sentidos;
    if (ida && vuelta) { unir(ida.paradas.at(-1), vuelta.paradas[0]); unir(vuelta.paradas.at(-1), ida.paradas[0]); }
  }
  return find;
}

export const tipoDeLinea = cfg => cfg?.preferente || cfg?.tipos?.[0] || null;

export const admite = (cfg, tipo) => !cfg?.tipos?.length || tipo == null || cfg.tipos.includes(tipo);

export function viajesDelDia(red, cfg, p) {
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

export const PEGADAS_KM = 0.3; // dos sitios a menos de esto son el mismo (sin vacío)

export function kmRecta([a, b], [c, d]) {
  const dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Coordenadas, distancias y cochera de cada línea (null si la red no tiene coordenadas)
export function geografia(red, cfg, cocheras, p) {
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
export const vacio = (desde, hasta, dep, minutos, km, tipo, hacia) => ({
  vacio: true, tipo, hacia: hacia || null, linea: null, nombre: "Vacío", color: COLOR_VACIO, dir: 0,
  sentido: tipo === "salida" ? "Salida de cochera" : tipo === "vuelta" ? "Vuelta a cochera" : `Vacío a cabecera${hacia ? ` de la ${hacia}` : ""}`,
  dep, arr: dep + minutos, o: desde, d: hasta, km,
});

// Grupo de cada línea (por nombre); las que no están en ninguno, cada una el suyo
const gruposCache = new WeakMap();
export function grupoDe(p) {
  const g = p.gruposLineas || [];
  if (gruposCache.has(g)) return gruposCache.get(g);
  const m = new Map();
  for (const gr of g) for (const n of gr.lineas || []) m.set(String(n), gr.id);
  const f = n => m.get(String(n)) ?? `linea:${n}`;
  gruposCache.set(g, f);
  return f;
}
/** ¿Puede un autobús que viene de la línea a seguir con la b en la cabecera (sin pasar por cochera)? (por nombre) */
export const autobusPuedeSeguir = p => (a, b) => a === b || (!!p.entreLineas && (p.mezclaBuses !== "grupo" || grupoDe(p)(a) === grupoDe(p)(b)));
/** Lo que no se puede mezclar en un turno: la línea, su grupo, o nada (null) */
export const claveMezclaTurno = p => (p.turnoUnaLinea || p.mezclaTurnos === "linea" ? n => String(n) : p.mezclaTurnos === "grupo" ? grupoDe(p) : null);

export const hm = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;

export const reloj = m => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

export const esCalendario = dia => typeof dia === "string" && dia.startsWith("cal:");

/** Nombre de un tipo de día o de un calendario de la red */
export const nombreDia = (id, red) => (esCalendario(id) ? red?.calendarios?.find(c => c.id === id)?.nombre || "Calendario que ya no está en la red" : TIPOS_DIA.find(t => t.id === id)?.nombre || id);

/** Viajes de un sentido ese día */
export const viajesDia = (sentido, dia, red, cfgLinea) => (cfgLinea?.salidas?.[claveSalidas(sentido.dir, dia)] || esCalendario(dia) ? salidasDe(sentido, dia, red, cfgLinea).lista.length : sentido.viajes?.[dia] || 0);
