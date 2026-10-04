// ── Scheduling de líneas regulares ────────────────────────────────────
// Funciones puras (sin React ni Firestore) sobre la red de lineas-store.
//
// 1) Vehículos (vehicle scheduling): los viajes del tipo de día elegido se
//    recorren por hora de salida y cada uno va al autobús que está libre en
//    esa cabecera (llegada + regulación ≤ salida) y es de un tipo que admite
//    la línea; si no hay ninguno, se añade un autobús. De los libres se coge
//    el que quedó libre más tarde (menos tiempo parado). Las dos cabeceras de
//    una misma línea (llegada de la ida ↔ salida de la vuelta) cuentan como
//    el mismo sitio aunque en el GTFS sean paradas distintas. Sin vacíos
//    entre cabeceras distintas.
//    Cada cadena de viajes es un "bloque". Después, los bloques se reparten
//    entre autobuses físicos: uno puede hacer un bloque de mañana y otro de
//    tarde si entre medias hay margen para el vacío (por cochera).
// 2) Turnos de conductor (crew scheduling), como se hace en el sector:
//    cada bloque se corta en piezas de como mucho 4h30 de conducción (relevo
//    en cabecera) y las piezas se emparejan en turnos de dos piezas con una
//    pausa de al menos 45 min entre ellas y sin pasar de la jornada máxima.
//    Así se cumple la conducción UE 561/2006 y el descanso del Estatuto; lo
//    que aun así no cuadra queda como aviso del turno.
// 3) Optimizar: prueba varias estrategias (qué autobús coge cada viaje, dónde
//    se corta la pieza, cómo se emparejan) que cumplen todas las
//    restricciones y se queda con la mejor para el objetivo elegido.

import { franjaDe, TIPOS_DIA } from "./gtfs-red.js";

export const PARAMS_DEFECTO = {
  dia: "laborable",
  regulacion: 5,        // min, si la línea no tiene la suya
  jornadaMax: 480,      // min de trabajo por turno (suma de sus piezas)
  piezaMax: 240,        // min de una pieza (de relevo a relevo)
  amplitudMax: 540,     // min de la primera salida a la última llegada del turno (pausa incluida)
  entreLineas: true,    // un autobús puede seguir con otra línea en la misma cabecera
  margenVacio: 30,      // min entre dos bloques del mismo autobús (ir y volver de cochera)
  conduccionContinuaMax: 270, pausaConduccionMin: 45, conduccionDiariaMax: 540,
  jornadaSinPausaMax: 360, pausaJornadaMin: 15,
  aplicar561: true,     // avisos de conducción UE 561/2006
  costeHora: null, costeKm: null, costeVehiculoDia: null, // € para el coste estimado
  flotaMax: null,       // autobuses disponibles (límite del optimizador)
  conductoresMax: null, // conductores disponibles ese día
  // Estrategia (la cambia Optimizar; todas cumplen las restricciones)
  eleccion: "ultimo",   // "ultimo": el autobús que quedó libre más tarde · "primero": el que lleva más esperando
  corte: "max",         // "max": piezas lo más largas posible · "equilibrado" · número: pieza objetivo en min
  emparejar: "primera", // "primera": la pausa más corta · "llena": el turno más cerca de la jornada máxima
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
export function generarServicio(red, cfg = {}, opciones = {}) {
  const p = { ...PARAMS_DEFECTO, ...opciones };
  const { viajes, find, aproximado } = viajesDelDia(red, cfg, p);
  const vehiculos = programarVehiculos(viajes, cfg, find, p);
  const autobuses = repartirAutobuses(vehiculos, p);
  const { turnos, piezas } = programarTurnos(vehiculos, p);
  for (const veh of vehiculos) {
    veh.relevos = piezas.filter(pz => pz.vehiculo === veh.id).map(pz => ({ inicio: pz.inicio, fin: pz.fin, turno: pz.turno }));
  }
  return { viajes, vehiculos, autobuses, turnos, kpis: kpisServicio(viajes, vehiculos, turnos, autobuses), perfil: perfilVehiculos(vehiculos), aproximado, params: p, diaNombre: nombreDia(p.dia, red) };
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

// 1) Vehículos: bloques de viajes encadenados en cabecera
function programarVehiculos(viajes, cfg, find, p) {
  const vehiculos = [];
  const esperando = new Map(); // cabecera → [vehículo]
  for (const v of viajes) {
    const c = cfg[v.linea];
    const donde = find(v.o);
    const cola = esperando.get(donde) || [];
    let mejor = -1;
    for (let k = 0; k < cola.length; k++) {
      const veh = cola[k];
      if (veh.libre > v.dep) continue;
      if (!p.entreLineas && veh.linea !== v.linea) continue;
      if (!admite(c, veh.tipo)) continue;
      if (mejor < 0 || (p.eleccion === "primero" ? veh.libre < cola[mejor].libre : veh.libre > cola[mejor].libre)) mejor = k;
    }
    let veh;
    if (mejor >= 0) { veh = cola[mejor]; cola.splice(mejor, 1); }
    else { veh = { id: vehiculos.length + 1, tipo: tipoDeLinea(c), viajes: [], libre: 0, linea: v.linea }; vehiculos.push(veh); }
    veh.viajes.push(v);
    veh.linea = v.linea;
    veh.libre = v.arr + (c?.regulacion ?? p.regulacion);
    const fin = find(v.d);
    if (!esperando.has(fin)) esperando.set(fin, []);
    esperando.get(fin).push(veh);
  }
  for (const veh of vehiculos) {
    veh.inicio = veh.viajes[0].dep;
    veh.fin = veh.viajes.at(-1).arr;
    veh.lineas = [...new Set(veh.viajes.map(x => x.nombre))];
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
      if (bus.libre + p.margenVacio > veh.inicio) continue;
      if (bus.tipo != null && veh.tipo != null && bus.tipo !== veh.tipo) continue;
      if (!mejor || bus.libre > mejor.libre) mejor = bus;
    }
    if (!mejor) { mejor = { id: autobuses.length + 1, tipo: veh.tipo, bloques: [], libre: 0 }; autobuses.push(mejor); }
    mejor.bloques.push(veh.id);
    mejor.libre = veh.fin;
    if (mejor.tipo == null) mejor.tipo = veh.tipo;
    veh.autobus = mejor.id;
  }
  autobuses.forEach(b => { delete b.libre; });
  return autobuses;
}

// 2) Turnos de conductor
function programarTurnos(vehiculos, p) {
  // piezas de cada bloque…
  const piezas = [];
  for (const veh of vehiculos) {
    let lim = p.piezaMax;
    if (p.corte === "equilibrado") {
      // mismas piezas que con "max" pero de largo parecido (las muy cortas emparejan mal)
      const n = Math.ceil((veh.fin - veh.inicio) / p.piezaMax);
      lim = Math.min(p.piezaMax, Math.ceil((veh.fin - veh.inicio) / n) + 20);
    } else if (typeof p.corte === "number") lim = Math.min(p.piezaMax, p.corte);
    let pz = null;
    for (const v of veh.viajes) {
      const dur = v.arr - v.dep;
      if (pz && (pz.conduccion + dur > p.conduccionContinuaMax || v.arr - pz.inicio > lim)) { piezas.push(pz); pz = null; }
      if (!pz) pz = { vehiculo: veh.id, inicio: v.dep, fin: v.arr, conduccion: 0, viajes: [] };
      pz.viajes.push(v); pz.fin = v.arr; pz.conduccion += dur;
    }
    if (pz) piezas.push(pz);
  }
  // …emparejadas en turnos de dos piezas (pausa ≥ 45 min, amplitud y jornada máximas)
  piezas.sort((x, y) => x.inicio - y.inicio);
  const usada = new Uint8Array(piezas.length);
  const turnos = [];
  for (let i = 0; i < piezas.length; i++) {
    if (usada[i]) continue;
    usada[i] = 1;
    const a1 = piezas[i];
    let par = -1;
    for (let j = i + 1; j < piezas.length; j++) {
      const b1 = piezas[j];
      if (b1.inicio - a1.inicio > p.amplitudMax) break;
      if (usada[j] || b1.inicio < a1.fin + p.pausaConduccionMin) continue;
      if (b1.fin - a1.inicio > p.amplitudMax || (a1.fin - a1.inicio) + (b1.fin - b1.inicio) > p.jornadaMax) continue;
      if (a1.conduccion + b1.conduccion > p.conduccionDiariaMax) continue;
      if (p.emparejar !== "llena") { par = j; break; } // la primera que encaja: menos tiempo muerto entre piezas
      if (par < 0 || (b1.fin - b1.inicio) > (piezas[par].fin - piezas[par].inicio)) par = j; // la que más llena el turno
    }
    const pzs = [a1];
    if (par >= 0) { usada[par] = 1; pzs.push(piezas[par]); }
    turnos.push(cerrarTurno({ piezas: pzs }, p));
  }
  turnos.sort((x, y) => x.inicio - y.inicio);
  turnos.forEach((t, i) => { t.id = i + 1; for (const pz of t.piezas) pz.turno = t.id; });
  return { turnos, piezas };
}

/** Coste del día con los precios de Restricciones (null si no hay ninguno) */
export function costeDia({ horasPagadas, km, autobuses }, p) {
  if (!(p.costeHora > 0 || p.costeKm > 0 || p.costeVehiculoDia > 0)) return null;
  return horasPagadas * (p.costeHora || 0) + km * (p.costeKm || 0) + autobuses * (p.costeVehiculoDia || 0);
}

export const OBJETIVOS = [
  { id: "autobuses", nombre: "Menos autobuses", ayuda: "Primero la flota; a igualdad, menos turnos y menos horas pagadas." },
  { id: "conductores", nombre: "Menos conductores", ayuda: "Primero los turnos; a igualdad, menos horas pagadas y menos autobuses." },
  { id: "coste", nombre: "Menor coste", ayuda: "Horas pagadas × €/h + autobuses × €/autobús·día + km × €/km, con los precios de Restricciones." },
];

/** Nombre corto de una estrategia para enseñarla */
export function nombreEstrategia(v, piezaMax = PARAMS_DEFECTO.piezaMax) {
  const corte = v.corte === "equilibrado" ? "piezas equilibradas"
    : typeof v.corte === "number" && v.corte < piezaMax ? `piezas ≤ ${Math.floor(v.corte / 60)}h${String(v.corte % 60).padStart(2, "0")}` : "piezas largas";
  return [
    v.eleccion === "primero" ? "reparte la regulación" : "menos espera en cabecera",
    corte,
    v.emparejar === "llena" ? "turnos llenos" : "pausa corta",
    v.entreLineas === false ? "sin cambiar de línea" : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Prueba estrategias que cumplen las restricciones y las ordena de mejor a peor.
 * Mandan, por este orden: los límites (flotaMax, conductoresMax), los avisos
 * legales y después el objetivo.
 * @returns { probadas: [{ estrategia, autobuses, turnos, horasPagadas, avisos, coste, cumple, nombre }], objetivo }
 */
export function optimizarServicio(red, cfg = {}, opciones = {}, { objetivo = "autobuses", onProgreso } = {}) {
  const p = { ...PARAMS_DEFECTO, ...opciones };
  const { viajes, find } = viajesDelDia(red, cfg, p);
  const km = viajes.reduce((s, v) => s + v.km, 0);
  const deVehiculos = [];
  for (const eleccion of ["ultimo", "primero"]) for (const entreLineas of p.entreLineas ? [true, false] : [false]) deVehiculos.push({ eleccion, entreLineas });
  const cortes = ["max", "equilibrado", p.piezaMax - 30, p.piezaMax - 60].filter(c => typeof c !== "number" || c >= 90);
  const deTurnos = cortes.flatMap(corte => ["primera", "llena"].map(emparejar => ({ corte, emparejar })));
  const total = deVehiculos.length * deTurnos.length;
  const probadas = [];
  for (const dv of deVehiculos) {
    const q = { ...p, ...dv };
    const vehiculos = programarVehiculos(viajes, cfg, find, q);
    const autobuses = repartirAutobuses(vehiculos, q).length;
    for (const dt of deTurnos) {
      const { turnos } = programarTurnos(vehiculos, { ...q, ...dt });
      const horasPagadas = turnos.reduce((s, t) => s + t.trabajo, 0) / 60;
      const r = {
        estrategia: { ...dv, ...dt }, autobuses, turnos: turnos.length, horasPagadas,
        avisos: turnos.filter(t => t.avisos.length).length,
        coste: costeDia({ horasPagadas, km, autobuses }, p),
      };
      r.cumple = !(p.flotaMax > 0 && autobuses > p.flotaMax) && !(p.conductoresMax > 0 && r.turnos > p.conductoresMax);
      r.nombre = nombreEstrategia(r.estrategia, p.piezaMax);
      probadas.push(r);
      onProgreso?.(probadas.length, total);
    }
  }
  const exceso = r => Math.max(0, p.flotaMax > 0 ? r.autobuses - p.flotaMax : 0) + Math.max(0, p.conductoresMax > 0 ? r.turnos - p.conductoresMax : 0);
  const clave = r => [exceso(r), r.avisos, ...(objetivo === "conductores" ? [r.turnos, r.horasPagadas, r.autobuses]
    : objetivo === "coste" && r.coste != null ? [r.coste, r.autobuses] : [r.autobuses, r.turnos, r.horasPagadas])];
  probadas.sort((a, b) => { const x = clave(a), y = clave(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return { probadas, objetivo };
}

const hm = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;

function cerrarTurno(t, p) {
  const viajes = t.piezas.flatMap(pz => pz.viajes);
  t.inicio = t.piezas[0].inicio;
  t.fin = t.piezas.at(-1).fin;
  t.duracion = t.fin - t.inicio; // amplitud
  t.trabajo = t.piezas.reduce((s, pz) => s + (pz.fin - pz.inicio), 0);
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

export function kpisServicio(viajes, vehiculos, turnos, autobuses = []) {
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
    km: viajes.reduce((s, v) => s + v.km, 0),
    turnos: turnos.length,
    turnosDosPiezas: turnos.filter(t => t.piezas.length === 2).length,
    turnosConAviso: turnos.filter(t => t.avisos.length).length,
    horasPagadas: pagado / 60,
    eficienciaPersonal: pagado ? conduccion / pagado : null, // conducción / tiempo de trabajo
    porTipo,
  };
}

export const esCalendario = dia => typeof dia === "string" && dia.startsWith("cal:");
/** Nombre de un tipo de día o de un calendario de la red */
export const nombreDia = (id, red) => (esCalendario(id) ? red?.calendarios?.find(c => c.id === id)?.nombre || "Calendario que ya no está en la red" : TIPOS_DIA.find(t => t.id === id)?.nombre || id);
/** Viajes de un sentido ese día */
export const viajesDia = (sentido, dia, red) => (esCalendario(dia) ? salidasDe(sentido, dia, red).lista.length : sentido.viajes?.[dia] || 0);
