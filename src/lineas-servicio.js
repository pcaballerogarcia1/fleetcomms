// ── Servicio del día de un proyecto de líneas (Scheduling → Control) ──
// Lo que se "publica" desde el Scheduling: los turnos de un día concreto,
// cada uno con sus viajes, el autobús de cada pieza y los trazados que
// necesita el móvil del conductor para saber por dónde va. Sin React ni
// Firebase: se usa en la oficina (Control), en el móvil y en los tests.
//
// Horas: minutos desde las 00:00 del día del servicio (25:10 = 1510, la
// salida de cochera de la víspera puede ser negativa), igual que en el
// Scheduling.

// (igual que en lineas-sched.js; repetido aquí para no cargar el motor en el móvil)
const ID_COCHERA = id => `cochera:${id}`;

// Puntualidad: una salida es puntual si sale como mucho ADELANTO_OK min antes
// y RETRASO_OK min después de su hora (el criterio habitual de los contratos).
export const ADELANTO_OK = 1;
export const RETRASO_OK = 3;
const R_SALIDA_M = 200;   // se considera que ha salido al alejarse esto de la cabecera
const R_LLEGADA_M = 150;  // y que ha llegado al acercarse esto a la de destino
const FUERA_LINEA_M = 400; // más lejos que esto de su recorrido: no se cuenta como avance

const pad = n => String(n).padStart(2, "0");
/** "YYYY-MM-DD" del día local */
export const fechaLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const sumarDias = (fecha, n) => { const d = new Date(fecha + "T12:00:00"); d.setDate(d.getDate() + n); return fechaLocal(d); };
/** Minutos desde las 00:00 (hora local) del día del servicio */
export const minutosDesde = (fecha, ms = Date.now()) => (ms - new Date(fecha + "T00:00:00").getTime()) / 60000;
export const hhmm = m => { if (m == null || !isFinite(m)) return "—"; const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
export const servicioId = (projectId, fecha) => `${projectId}_${fecha}`;
/** Los servicios que tocan ahora: los de hoy, y el de ayer si aún dura (madrugada) */
export function servicioVigente(servicios, ahoraMs = Date.now()) {
  const hoy = fechaLocal(new Date(ahoraMs));
  const deHoy = servicios.filter(s => s.fecha === hoy);
  const deAyer = servicios.filter(s => s.fecha < hoy && minutosDesde(s.fecha, ahoraMs) < (s.resumen?.fin ?? 0) + 60);
  return [...deAyer, ...deHoy];
}

// ── Geometría (metros, aproximación plana: sobra para una ciudad) ──
const M_LAT = 110540;
const mLng = lat => 111320 * Math.cos((lat * Math.PI) / 180);
export function distM([a, b], [c, d]) {
  const x = (d - b) * mLng((a + c) / 2), y = (c - a) * M_LAT;
  return Math.hypot(x, y);
}
/** Douglas-Peucker en metros: menos puntos con el mismo dibujo (para que quepa en el móvil) */
export function simplificar(puntos, tolM = 12) {
  if (!puntos || puntos.length <= 2) return puntos ? puntos.map(p => [+p[0], +p[1]]) : [];
  const lat0 = puntos[0][0], k = mLng(lat0);
  const xy = puntos.map(([la, ln]) => [ln * k, la * M_LAT]);
  const quedan = new Uint8Array(puntos.length);
  quedan[0] = quedan[puntos.length - 1] = 1;
  const pila = [[0, puntos.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    const [ax, ay] = xy[i], [bx, by] = xy[j];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let peor = -1, dmax = 0;
    for (let n = i + 1; n < j; n++) {
      const [px, py] = xy[n];
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > dmax) { dmax = d; peor = n; }
    }
    if (peor > 0 && dmax > tolM) { quedan[peor] = 1; pila.push([i, peor], [peor, j]); }
  }
  return puntos.filter((_, n) => quedan[n]).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}
/**
 * Dónde cae una posición sobre un recorrido: { frac (0–1 del recorrido),
 * dist (m hasta la línea), largo (m del recorrido) }.
 */
export function proyectar(trazado, pos) {
  if (!trazado?.length) return null;
  if (trazado.length === 1) return { frac: 0, dist: distM(trazado[0], pos), largo: 0 };
  const k = mLng(pos[0]);
  const P = [pos[1] * k, pos[0] * M_LAT];
  let acum = 0, mejor = { d: Infinity, en: 0 };
  for (let i = 0; i < trazado.length - 1; i++) {
    const A = [trazado[i][1] * k, trazado[i][0] * M_LAT], B = [trazado[i + 1][1] * k, trazado[i + 1][0] * M_LAT];
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    const t = L ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (L * L))) : 0;
    const d = Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
    if (d < mejor.d) mejor = { d, en: acum + t * L };
    acum += L;
  }
  return { frac: acum ? mejor.en / acum : 0, dist: mejor.d, largo: acum };
}
/** El punto que está a una fracción del recorrido (para el simulador y el mapa) */
export function puntoEn(trazado, frac) {
  if (!trazado?.length) return null;
  if (trazado.length === 1) return trazado[0];
  const tramos = [];
  let total = 0;
  for (let i = 0; i < trazado.length - 1; i++) { const l = distM(trazado[i], trazado[i + 1]); tramos.push(l); total += l; }
  let falta = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < tramos.length; i++) {
    if (falta <= tramos[i] || i === tramos.length - 1) {
      const t = tramos[i] ? Math.min(1, falta / tramos[i]) : 0;
      const [a, b] = trazado[i], [c, d] = trazado[i + 1];
      return [a + (c - a) * t, b + (d - b) * t];
    }
    falta -= tramos[i];
  }
  return trazado.at(-1);
}

// ── Publicar: del escenario del Scheduling al servicio del día ──
/**
 * res: el escenario con turnos (lo que se ve en el Scheduling).
 * → { turnos: [turno], lista: [resumen de cada turno], resumen }
 * turno = { id, num, tipo, inicio, fin, buses, lineas, viajes: [{ k, lid, l, color, dir, s, dep, arr, o, d, on, dn, v, bus, km, t }], trazados, coords }
 * (v: 1 si es un vacío; t: clave del trazado del viaje)
 */
export function servicioDesdeEscenario(res, red, { cocheras = [] } = {}) {
  if (!res?.turnos?.length) return { turnos: [], lista: [], resumen: { turnos: 0, viajes: 0, autobuses: 0 } };
  const parada = new Map((red?.paradas || []).map(p => [p.id, p]));
  for (const c of cocheras || []) if (isFinite(c.lat) && isFinite(c.lng)) parada.set(ID_COCHERA(c.id), { lat: c.lat, lng: c.lng, nombre: c.nombre || "Cochera" });
  const sentido = new Map((red?.lineas || []).flatMap(l => l.sentidos.map(s => [`${l.id}|${s.dir}`, s])));
  const trazadoDe = new Map();
  const trazadoDeSentido = clave => {
    if (!trazadoDe.has(clave)) {
      const s = sentido.get(clave);
      const base = s?.trazado?.length >= 2 ? s.trazado : (s?.paradas || []).map(id => parada.get(id)).filter(Boolean).map(p => [p.lat, p.lng]);
      trazadoDe.set(clave, simplificar(base, 12));
    }
    return trazadoDe.get(clave);
  };
  const autobusDe = new Map((res.vehiculos || []).map(v => [v.id, v.autobus ?? v.id]));
  const turnos = res.turnos.map(t => {
    const viajes = [], trazados = {}, coords = {};
    const anotar = id => { const p = parada.get(id); if (p && !coords[id]) coords[id] = [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5]; };
    for (const pz of t.piezas) {
      const bus = autobusDe.get(pz.vehiculo) ?? pz.vehiculo;
      for (const v of pz.viajes) {
        const clave = v.vacio ? null : `${v.linea}|${v.dir}`;
        if (clave && !trazados[clave]) trazados[clave] = trazadoDeSentido(clave).flat(); // plano: Firestore no admite listas dentro de listas
        anotar(v.o); anotar(v.d);
        viajes.push({
          k: viajes.length, lid: v.linea ?? null, l: v.vacio ? "Vacío" : v.nombre, color: v.color || "#64748b", dir: v.dir ?? 0, s: v.sentido || "",
          dep: v.dep, arr: v.arr, o: v.o, d: v.d, on: parada.get(v.o)?.nombre || "", dn: parada.get(v.d)?.nombre || "",
          v: v.vacio ? 1 : 0, bus, km: Math.round((v.km || 0) * 10) / 10, t: clave,
        });
      }
    }
    const conViajeros = viajes.filter(x => !x.v);
    return {
      id: `T${t.id}`, num: t.id, tipo: t.tipoNombre || null,
      inicio: viajes[0]?.dep ?? 0, fin: viajes.at(-1)?.arr ?? 0,
      buses: [...new Set(viajes.map(x => x.bus))], lineas: [...new Set(conViajeros.map(x => x.l))],
      viajes, trazados, coords,
    };
  });
  const lista = turnos.map(t => ({ id: t.id, num: t.num, tipo: t.tipo, inicio: t.inicio, fin: t.fin, buses: t.buses, lineas: t.lineas }));
  const resumen = {
    turnos: turnos.length,
    viajes: turnos.reduce((n, t) => n + t.viajes.filter(x => !x.v).length, 0),
    autobuses: new Set(turnos.flatMap(t => t.buses)).size,
    inicio: Math.min(...turnos.map(t => t.inicio)), fin: Math.max(...turnos.map(t => t.fin)),
  };
  return { turnos, lista, resumen };
}

/** ¿Este día (tipo de día o calendario del GTFS) presta servicio en esa fecha? */
export function diaValeParaFecha(dia, red, fecha) {
  if (typeof dia === "string" && dia.startsWith("cal:")) {
    const cal = red?.calendarios?.find(c => c.id === dia);
    return !!cal?.fechas?.includes(fecha);
  }
  const wd = new Date(fecha + "T12:00:00").getDay(); // 0 domingo
  if (dia === "laborable") return wd >= 1 && wd <= 5;
  if (dia === "sabado") return wd === 6;
  if (dia === "domingo") return wd === 0;
  return true;
}
/** La primera fecha desde `desde` (incluida) en la que vale ese día; null si no hay en 400 días */
export function proximaFecha(dia, red, desde = fechaLocal()) {
  for (let i = 0; i < 400; i++) { const f = sumarDias(desde, i); if (diaValeParaFecha(dia, red, f)) return f; }
  return null;
}

// ── En la calle: qué viaje va haciendo el conductor y con cuánto retraso ──
// Los trazados se guardan planos [lat, lng, lat, lng…]: aquí vuelven a pares
const pares = new WeakMap();
export function trazadoDe(turno, clave) {
  const plano = clave && turno.trazados?.[clave];
  if (!plano?.length) return null;
  if (Array.isArray(plano[0])) return plano;
  if (!pares.has(plano)) { const l = []; for (let i = 0; i + 1 < plano.length; i += 2) l.push([plano[i], plano[i + 1]]); pares.set(plano, l); }
  return pares.get(plano);
}
export const geoDe = (turno, v) => {
  const tr = trazadoDe(turno, v.t);
  if (tr?.length >= 2) return tr;
  const a = turno.coords?.[v.o], b = turno.coords?.[v.d];
  return a && b ? [a, b] : null;
};
/** Índice del primer viaje con viajeros que aún no ha terminado (según lo real) */
export function viajeActual(turno, real = {}) {
  const llegadas = real.llegadas || {}, saltados = real.saltados || [];
  return turno.viajes.findIndex(v => !v.v && llegadas[v.k] == null && !saltados.includes(v.k));
}
/**
 * Avanza el estado real del turno con una posición GPS.
 * real = { salidas: { k: min }, llegadas: { k: min }, saltados: [k] } (no se modifica: devuelve uno nuevo)
 * → { real, cambios: [{ tipo: "salida"|"llegada"|"saltado", k, min }], actual: índice, frac, fuera }
 */
export function avanzar(turno, real, pos, ahora) {
  const nuevo = { salidas: { ...(real?.salidas || {}) }, llegadas: { ...(real?.llegadas || {}) }, saltados: [...(real?.saltados || [])] };
  const cambios = [];
  let i = viajeActual(turno, nuevo);
  let frac = null, fuera = false;
  // Un viaje que nunca arrancó y cuya llegada prevista pasó hace mucho, si el
  // autobús ya está en el siguiente, se da por no registrado y se sigue
  for (let vuelta = 0; i >= 0 && vuelta < turno.viajes.length; vuelta++) {
    const v = turno.viajes[i];
    const geo = geoDe(turno, v);
    if (!geo) return { real: nuevo, cambios, actual: i, frac: null, fuera: true };
    const pr = proyectar(geo, pos);
    const dOrigen = distM(geo[0], pos), dDestino = distM(geo.at(-1), pos);
    frac = pr.frac; fuera = pr.dist > FUERA_LINEA_M;
    const salio = nuevo.salidas[v.k] != null;
    if (!salio) {
      // la ida y la vuelta suelen ir por la misma calle: antes de dar por
      // empezado un viaje que ya debía haber acabado, mirar si va en el siguiente
      if (ahora > v.arr + 10) {
        const sig = turno.viajes.slice(i + 1).find(x => !x.v);
        const gs = sig && geoDe(turno, sig);
        const enSiguiente = gs && (distM(gs[0], pos) <= R_SALIDA_M || proyectar(gs, pos).dist <= FUERA_LINEA_M / 2);
        if (enSiguiente) { nuevo.saltados.push(v.k); cambios.push({ tipo: "saltado", k: v.k }); i = viajeActual(turno, nuevo); continue; }
      }
      if (!fuera && dOrigen > R_SALIDA_M && pr.frac > 0.02 && dDestino > R_LLEGADA_M) {
        // ya en camino (si se empezó a mirar a mitad de viaje, la salida se estima)
        const est = pr.frac > 0.15 ? Math.round(ahora - pr.frac * (v.arr - v.dep)) : Math.round(ahora);
        nuevo.salidas[v.k] = est; cambios.push({ tipo: "salida", k: v.k, min: est });
      }
    }
    if (nuevo.salidas[v.k] != null && dDestino <= R_LLEGADA_M && (pr.frac > 0.6 || geo.length === 2)) {
      nuevo.llegadas[v.k] = Math.round(ahora); cambios.push({ tipo: "llegada", k: v.k, min: Math.round(ahora) });
      i = viajeActual(turno, nuevo);
      frac = 0;
      continue;
    }
    break;
  }
  return { real: nuevo, cambios, actual: i, frac, fuera };
}
/**
 * Retraso (min, positivo = tarde, negativo = adelantado) del viaje en curso.
 * Si aún no ha salido: lo que lleva pasado de su hora de salida (0 si no le toca).
 */
export function retrasoActual(turno, real, actual, frac, ahora) {
  const v = turno.viajes[actual];
  if (!v) return 0;
  const salida = real?.salidas?.[v.k];
  if (salida == null) return Math.max(0, Math.round(ahora - v.dep));
  const esperado = v.dep + Math.max(0, Math.min(1, frac ?? 0)) * (v.arr - v.dep);
  return Math.round(ahora - esperado);
}
export const estadoPuntualidad = r => (r == null ? "sin" : r < -ADELANTO_OK ? "adelantado" : r > 10 ? "muy" : r > RETRASO_OK ? "tarde" : "ok");
export const COLOR_PUNTUALIDAD = { ok: "#34d399", tarde: "#fbbf24", muy: "#f87171", adelantado: "#a78bfa", sin: "#8aa5cc" };
export const textoRetraso = r => (r == null ? "—" : r === 0 ? "en hora" : r > 0 ? `+${r} min` : `${r} min`);

// ── El día en cifras (Control y el informe) ──
/**
 * turnos: [{ ...turno publicado, real }] · ahora: min del día
 * → { programadas, realizadas, enCurso, puntuales, adelantadas, tarde, conSalida, kmProg, kmReal, porLinea: [{ linea, … }] }
 * "programadas" son las que ya deberían haber salido (dep ≤ ahora).
 */
export function cumplimiento(turnos, ahora = Infinity) {
  const lineas = new Map();
  const tot = { programadas: 0, realizadas: 0, enCurso: 0, sinHacer: 0, puntuales: 0, adelantadas: 0, tarde: 0, conSalida: 0, kmProg: 0, kmReal: 0, totalDia: 0, sumaRetraso: 0 };
  for (const t of turnos || []) {
    const sal = t.real?.salidas || {}, lle = t.real?.llegadas || {};
    for (const v of t.viajes || []) {
      if (v.v) continue;
      const L = lineas.get(v.l) || { linea: v.l, color: v.color, programadas: 0, realizadas: 0, enCurso: 0, sinHacer: 0, puntuales: 0, adelantadas: 0, tarde: 0, conSalida: 0, kmProg: 0, kmReal: 0, totalDia: 0, sumaRetraso: 0 };
      lineas.set(v.l, L);
      for (const x of [tot, L]) x.totalDia++;
      if (v.dep > ahora) continue;
      const s = sal[v.k], ll = lle[v.k];
      for (const x of [tot, L]) {
        x.programadas++; x.kmProg += v.km || 0;
        if (s != null) {
          x.conSalida++;
          const d = s - v.dep;
          x.sumaRetraso += d;
          if (d < -ADELANTO_OK) x.adelantadas++; else if (d > RETRASO_OK) x.tarde++; else x.puntuales++;
        }
        if (s != null && ll != null) { x.realizadas++; x.kmReal += v.km || 0; }
        else if (s != null) x.enCurso++;
        else if (ahora > v.arr) x.sinHacer++;
      }
    }
  }
  const fin = x => ({ ...x, kmProg: Math.round(x.kmProg), kmReal: Math.round(x.kmReal), puntualidad: x.conSalida ? x.puntuales / x.conSalida : null, retrasoMedio: x.conSalida ? x.sumaRetraso / x.conSalida : null });
  return { ...fin(tot), porLinea: [...lineas.values()].map(fin).sort((a, b) => String(a.linea).localeCompare(String(b.linea), "es", { numeric: true })) };
}

/**
 * Avisos de Control. turnos: [{ id, inicio, fin, conductorUid, conductorNombre, inicioReal, finReal }]
 * ubic: Map turnoId → { retraso, updatedAt, activo } · ahoraMs para la señal
 */
export function avisosControl(turnos, ubic, ahora, ahoraMs = Date.now(), { umbral = 5 } = {}) {
  const avisos = [];
  for (const t of turnos || []) {
    if (t.finReal) continue;
    const u = ubic.get(t.id);
    if (!t.inicioReal && ahora > t.inicio + 5 && ahora < t.fin) {
      avisos.push({ tipo: "sin_empezar", grave: true, turno: t.id, texto: t.conductorUid ? `${t.id} (${t.conductorNombre || "conductor"}) debía empezar a las ${hhmm(t.inicio)} y no ha empezado` : `${t.id} debía empezar a las ${hhmm(t.inicio)} y nadie lo ha cogido` });
      continue;
    }
    if (!t.inicioReal) continue;
    if (!u || !u.activo || ahoraMs - (u.updatedAt || 0) > 3 * 60000) {
      avisos.push({ tipo: "sin_senal", grave: false, turno: t.id, texto: `${t.id}: sin señal GPS desde ${u?.updatedAt ? new Date(u.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "que empezó"}` });
      continue;
    }
    if (u.retraso != null && u.retraso >= umbral) avisos.push({ tipo: "retraso", grave: u.retraso > 10, turno: t.id, retraso: u.retraso, texto: `${t.id} · Bus ${u.bus ?? "?"} · línea ${u.linea ?? "?"}: ${textoRetraso(u.retraso)}` });
    else if (u.retraso != null && u.retraso < -ADELANTO_OK - 1) avisos.push({ tipo: "adelantado", grave: false, turno: t.id, retraso: u.retraso, texto: `${t.id} · Bus ${u.bus ?? "?"} · línea ${u.linea ?? "?"}: va adelantado (${textoRetraso(u.retraso)})` });
  }
  const orden = { sin_empezar: 0, retraso: 1, adelantado: 2, sin_senal: 3 };
  return avisos.sort((a, b) => (b.grave - a.grave) || orden[a.tipo] - orden[b.tipo] || (b.retraso || 0) - (a.retraso || 0));
}
