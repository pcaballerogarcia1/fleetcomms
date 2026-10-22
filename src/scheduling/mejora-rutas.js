// Scheduling de puntos · mejora de las rutas después del motor.
// El motor (vrp-engine.js) reparte la ciudad en zonas fijas, una por
// vehículo, y cada uno recorre la suya día tras día: si una zona tiene el
// doble de trabajo, ese vehículo tarda el doble de días mientras los demás
// ya han terminado. Aquí se parte del resultado del motor y se mejora:
//  1. Adelantar: una ruta de los últimos días pasa a un vehículo que ese día
//     anterior no tenía nada (menos días de escenario).
//  2. Vaciar: las rutas más cortas se reparten entre las demás que tienen
//     hueco (menos turnos).
//  3. Pulir: cada parada se prueba en otro sitio de su ruta o de una ruta
//     vecina, y se dan la vuelta tramos (2-opt) si ahorran km.
// Cada cambio se comprueba rehaciendo las horas de la ruta igual que el
// motor (pausas, franjas horarias, fin de turno, duración máxima, tope de
// paradas), así que nunca se acepta una ruta que el motor no aceptaría.
// Los días con relevo de conductor y vuelta obligatoria a mitad de turno
// (circular + turno partido) se dejan como están.
// Sin React ni Firebase.
import { hasCoords, kmRuta, minutosRuta, shiftForDay, windowWait } from "../vrp-engine.js";
import { optimizarSISR } from "./sisr.js";

const esParada = a => !a._travel && !a._break && !a._wait;
const DIA = 1440;
const sinHora = a => { const t = { ...a }; delete t._start; delete t._end; return t; };

/** Opciones de mejora: «a fondo» busca bastante más tiempo */
export const tiempoMejora = constraints => (constraints?.optimizarAFondo ? 90_000 : 6_000);

/** Parte del turno que se deja de margen al ajustar las rutas al segundo */
export const MARGEN = 0.02;

/**
 * Rehace las horas de una ruta de un día.
 * El tiempo se lleva al segundo (cada trayecto con sus minutos exactos por
 * carretera) y solo se redondea la hora que se enseña: cada bloque empieza y
 * acaba en el minuto entero más cercano a su hora exacta. Así la duración de
 * la ruta es la de verdad (antes, redondear cada trayecto hacia arriba y con
 * un mínimo de 1 minuto inflaba mucho las rutas de contenedores seguidos).
 * @returns { ok, items, km, fin, conduccion } — ok=false si no cabe (franja, turno, tope);
 *   fin y conduccion, exactos (minutos con decimales)
 */
export function simular(ruta, cons) {
  const { breakAfter = 0, breakDur = 0, maxShiftMin = 0, maxStops = 0 } = cons;
  const { off, sh, depot, circular } = ruta;
  const paradas = ruta.paradas;
  if (maxStops > 0 && paradas.length > maxStops) return { ok: false };
  const ini = sh.start + off;
  // margen de seguridad: la carretera estimada acierta en conjunto pero no al minuto; al ajustar
  // las rutas al segundo, se deja un 2 % del turno (unos 8 min en 7 h) para no pasarse de verdad
  const finDia = sh.end + off - MARGEN * (sh.end - sh.start);
  const M = Math.round; // la hora que se enseña
  let x = ini, desde = 0, km = 0, conduccion = 0; // x: la hora exacta
  let lat = depot?.lat ?? null, lng = depot?.lng ?? null, salida = !!depot;
  let ancla = depot;
  const items = [];
  const bloque = (extra, d) => { const b = { ...extra, _start: M(x), _end: M(x + d), duracion: M(x + d) - M(x) }; x += d; return b; };
  for (const t of paradas) {
    const dur = t.duracion || 15;
    if (breakAfter > 0 && breakDur > 0 && desde >= breakAfter && x + breakDur <= finDia) {
      items.push(bloque({ _break: true }, breakDur));
      desde = 0;
    }
    let vk = 0, vm = 0;
    if (hasCoords(lat, lng) && hasCoords(t.lat, t.lng)) { vk = kmRuta(lat, lng, t.lat, t.lng); vm = vk >= 0.05 ? minutosRuta(vk) : 0; }
    const espera = windowWait(t, x + vm, off);
    if (espera == null) return { ok: false };
    if (vk >= 0.05) {
      items.push(bloque({ _travel: true, km: +vk.toFixed(3), ...(salida ? { _depot_exit: true } : {}) }, vm));
      km += vk; conduccion += vm;
    }
    salida = false;
    if (espera > 0) items.push(bloque({ _wait: true }, espera));
    const p = bloque({}, dur);
    items.push({ ...t, _start: p._start, _end: p._end });
    desde += dur;
    if (hasCoords(t.lat, t.lng)) { lat = +t.lat; lng = +t.lng; }
    if (circular && !ancla) ancla = { lat, lng };
  }
  if (ancla && hasCoords(lat, lng) && (lat !== ancla.lat || lng !== ancla.lng)) {
    const rk = kmRuta(lat, lng, ancla.lat, ancla.lng);
    if (rk >= 0.05) { const rm = minutosRuta(rk); items.push(bloque({ _travel: true, _depot_return: true, km: +rk.toFixed(3) }, rm)); km += rk; conduccion += rm; }
  }
  if (x > finDia + 1e-9) return { ok: false };
  if (maxShiftMin > 0 && x - ini > maxShiftMin * (1 - MARGEN) + 1e-9) return { ok: false };
  return { ok: true, items, km, fin: x, conduccion };
}

const distancia = (a, b) => (a && b && hasCoords(a.lat, a.lng) && hasCoords(b.lat, b.lng) ? kmRuta(a.lat, a.lng, b.lat, b.lng) : 0);

/**
 * Mejora un escenario ya generado.
 * @param resultado { schedule, unassigned, daysUsed } de generateScenario
 * @param constraints las restricciones del escenario
 * @param opciones { tiempoMs, maxDia } — maxDia: no crear rutas a partir de ese día (días máximos)
 * @returns el mismo resultado con las rutas mejoradas + resumen { antes, despues }
 */
export async function mejorarRutas(resultado, constraints = {}, opciones = {}) {
  const t0 = Date.now();
  const tiempoMs = opciones.tiempoMs ?? tiempoMejora(constraints);
  const fuera = () => Date.now() - t0 > tiempoMs;
  const circular = !!constraints.circular;
  const filas = resultado.schedule || [];
  const cons = constraints;
  const ceder = () => new Promise(r => setTimeout(r, 0));

  // ── Las rutas: una por vehículo y día ──
  const depotDe = f => (hasCoords(f.depotLat, f.depotLng) ? { lat: +f.depotLat, lng: +f.depotLng } : null);
  const turnoDe = (f, d) => {
    const sh = shiftForDay(f, d);
    if (!sh) return null;
    if (circular && sh.breaks?.length) return null; // relevo con vuelta obligatoria: no se toca
    return sh;
  };
  const rutas = [];          // { fila, d, off, sh, depot, circular, paradas, km, fin, items, tocada }
  const fijas = new Set();   // "fila|día" que no se tocan
  const ocupado = new Map(); // "fila|día" → ruta
  filas.forEach((f, fi) => {
    const dias = new Map();
    for (const a of f.assignments || []) {
      const d = Math.floor(a._start / DIA);
      if (!dias.has(d)) dias.set(d, []);
      dias.get(d).push(a);
    }
    for (const [d, items] of dias) {
      const sh = turnoDe(f, d);
      const paradas = items.filter(esParada).sort((a, b) => a._start - b._start);
      if (!sh || !paradas.length) { fijas.add(`${fi}|${d}`); continue; }
      const ruta = { fi, d, off: d * DIA, sh, depot: depotDe(f), circular, paradas: paradas.map(sinHora), items, tocada: false };
      ruta.km = items.reduce((s, a) => s + (a._travel ? a.km || 0 : 0), 0);
      ruta.fin = Math.max(...items.map(a => a._end));
      rutas.push(ruta);
      ocupado.set(`${fi}|${d}`, ruta);
    }
  });
  const medir = () => {
    const vivas = rutas.filter(r => r.paradas.length);
    return {
      turnos: vivas.length,
      dias: vivas.length ? Math.max(...vivas.map(r => r.d)) + 1 : 1,
      km: Math.round(vivas.reduce((s, r) => s + r.km, 0)),
    };
  };
  const antes = medir();
  if (rutas.length < 1) return { ...resultado, mejora: { antes, despues: antes } };

  // Prueba una secuencia nueva para una ruta; si cabe, la deja puesta
  const probar = (ruta, paradas) => {
    const s = simular({ ...ruta, paradas }, cons);
    return s.ok ? s : null;
  };
  const poner = (ruta, paradas, s) => {
    ruta.paradas = paradas; ruta.items = s.items; ruta.km = s.km; ruta.fin = s.fin; ruta.tocada = true;
  };
  const vaciar = ruta => { ruta.paradas = []; ruta.items = []; ruta.km = 0; ruta.fin = 0; ruta.tocada = true; };

  // Mejor sitio donde meter una parada en una ruta (o null). Los huecos se
  // ordenan por km añadidos y solo se simulan los mejores.
  const PRUEBAS_HUECO = 6;
  function mejorHueco(ruta, t) {
    const ps = ruta.paradas, n = ps.length;
    const cands = [];
    for (let g = 0; g <= n; g++) {
      const a = g === 0 ? ruta.depot : ps[g - 1];
      const b = g === n ? (ruta.depot || (ruta.circular ? ps[0] : null)) : ps[g];
      const delta = distancia(a, t) + distancia(t, b) - distancia(a, b);
      cands.push([delta, g]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    for (let c = 0; c < Math.min(PRUEBAS_HUECO, cands.length); c++) {
      const g = cands[c][1];
      const nuevas = [...ps.slice(0, g), t, ...ps.slice(g)];
      const s = probar(ruta, nuevas);
      if (s) return { paradas: nuevas, s, delta: s.km - ruta.km };
    }
    return null;
  }
  const centro = ruta => {
    const cs = ruta.paradas.filter(t => hasCoords(t.lat, t.lng));
    if (!cs.length) return ruta.depot;
    return { lat: cs.reduce((s, t) => s + +t.lat, 0) / cs.length, lng: cs.reduce((s, t) => s + +t.lng, 0) / cs.length };
  };

  // Una ruta nueva (vacía) para el vehículo fi el día d, si ese día trabaja
  const maxDia = opciones.maxDia ?? Infinity;
  function rutaLibre(fi, d) {
    if (d >= maxDia) return null;
    const k = `${fi}|${d}`;
    if (fijas.has(k)) return null;
    const r = ocupado.get(k);
    if (r) return r.paradas.length ? null : r;
    const sh = turnoDe(filas[fi], d);
    if (!sh) return null;
    const nueva = { fi, d, off: d * DIA, sh, depot: depotDe(filas[fi]), circular, paradas: [], items: [], km: 0, fin: 0, tocada: true };
    rutas.push(nueva); ocupado.set(k, nueva);
    return nueva;
  }

  // ── 1. Adelantar rutas de los últimos días a huecos de días anteriores ──
  {
    let movido = true;
    while (movido && !fuera()) {
      movido = false;
      const vivas = rutas.filter(r => r.paradas.length).sort((a, b) => b.d - a.d || a.paradas.length - b.paradas.length);
      for (const r of vivas) {
        if (fuera()) break;
        let hecho = false;
        for (let d = 0; d < r.d && !hecho; d++) {
          for (let fi = 0; fi < filas.length && !hecho; fi++) {
            const libre = rutaLibre(fi, d);
            if (!libre) continue;
            // la misma secuencia, en el otro vehículo/día (rehaciendo las horas)
            const s = probar(libre, r.paradas);
            if (s) { poner(libre, r.paradas, s); vaciar(r); hecho = movido = true; }
          }
        }
      }
      await ceder();
    }
  }

  // ── 2. Vaciar las rutas más cortas repartiendo sus paradas ──
  // Se prueban de la más corta a la más larga; si alguna parada no cabe en
  // ningún sitio, se deshace todo lo de esa ruta.
  const VECINAS = 8;
  {
    const orden = rutas.filter(r => r.paradas.length).sort((a, b) => b.d - a.d || (a.fin - a.off - a.sh.start) - (b.fin - b.off - b.sh.start));
    let probadas = 0;
    for (const r of orden) {
      if (fuera()) break;
      if (!r.paradas.length) continue;
      const c = centro(r);
      const otras = rutas.filter(o => o !== r && o.paradas.length && o.d <= r.d)
        .map(o => [distancia(c, centro(o)), o]).sort((a, b) => a[0] - b[0]).slice(0, VECINAS).map(x => x[1]);
      if (!otras.length) continue;
      const guardado = otras.map(o => [o, o.paradas, o.items, o.km, o.fin, o.tocada]);
      let todo = true;
      for (const t of r.paradas) {
        let mejor = null, dest = null;
        for (const o of otras) {
          const h = mejorHueco(o, t);
          if (h && (!mejor || h.delta < mejor.delta)) { mejor = h; dest = o; }
        }
        if (!mejor) { todo = false; break; }
        poner(dest, mejor.paradas, mejor.s);
      }
      if (todo) vaciar(r);
      else for (const [o, p, it, km, fin, toc] of guardado) Object.assign(o, { paradas: p, items: it, km, fin, tocada: toc });
      if (++probadas % 4 === 0) await ceder();
    }
  }

  // ── 3. Pulir: mover paradas sueltas y dar la vuelta a tramos ──
  function dosOpt(r) {
    let mejora = false;
    const n = r.paradas.length;
    if (n < 4) return false;
    for (let i = 0; i < n - 2 && !fuera(); i++) {
      for (let j = i + 2; j < n; j++) {
        const a = i === 0 ? r.depot : r.paradas[i - 1], b = r.paradas[i];
        const c = r.paradas[j], e = j === n - 1 ? r.depot : r.paradas[j + 1];
        if (!a || !e) continue;
        const delta = distancia(a, c) + distancia(b, e) - distancia(a, b) - distancia(c, e);
        if (delta > -0.01) continue;
        const nuevas = [...r.paradas.slice(0, i), ...r.paradas.slice(i, j + 1).reverse(), ...r.paradas.slice(j + 1)];
        const s = probar(r, nuevas);
        if (s && s.km < r.km - 0.01) { poner(r, nuevas, s); mejora = true; }
      }
    }
    return mejora;
  }
  function moverParadas(r) {
    let mejora = false;
    const c = centro(r);
    const vecinas = rutas.filter(o => o.paradas.length && o.d === r.d)
      .map(o => [distancia(c, centro(o)), o]).sort((a, b) => a[0] - b[0]).slice(0, 4).map(x => x[1]);
    for (let i = 0; i < r.paradas.length && !fuera(); i++) {
      const t = r.paradas[i];
      const sin = [...r.paradas.slice(0, i), ...r.paradas.slice(i + 1)];
      const sSin = sin.length ? probar(r, sin) : { ok: true, items: [], km: 0, fin: 0 };
      if (!sSin) continue;
      const ahorro = r.km - sSin.km;
      let mejor = null, dest = null;
      for (const o of vecinas) {
        const base = o === r ? { ...r, paradas: sin, km: sSin.km } : o;
        const h = mejorHueco(base, t);
        if (h && h.delta < ahorro - 0.01 && (!mejor || h.delta < mejor.delta)) { mejor = h; dest = o; }
      }
      if (!mejor) continue;
      if (dest === r) poner(r, mejor.paradas, mejor.s);
      else { if (sin.length) poner(r, sin, sSin); else vaciar(r); poner(dest, mejor.paradas, mejor.s); }
      mejora = true; i--;
    }
    return mejora;
  }
  {
    let ronda = 0, algo = true;
    while (algo && ronda++ < 20 && !fuera()) {
      algo = false;
      for (const r of rutas) {
        if (fuera()) break;
        if (!r.paradas.length) continue;
        if (dosOpt(r)) algo = true;
        if (moverParadas(r)) algo = true;
        await ceder();
      }
    }
  }

  // ── Volver a montar el escenario ──
  const porFila = new Map();
  for (const r of rutas) if (r.tocada) { if (!porFila.has(r.fi)) porFila.set(r.fi, []); porFila.get(r.fi).push(r); }
  const schedule = filas.map((f, fi) => {
    const cambiadas = porFila.get(fi);
    if (!cambiadas) return f;
    const dias = new Set(cambiadas.map(r => r.d));
    const assignments = (f.assignments || []).filter(a => !dias.has(Math.floor(a._start / DIA)))
      .concat(cambiadas.flatMap(r => r.items))
      .sort((a, b) => a._start - b._start);
    return { ...f, assignments, totalKm: assignments.reduce((s, a) => s + (a._travel ? a.km || 0 : 0), 0) };
  });
  const despues = medir();
  const diasUsados = Math.max(1, ...schedule.flatMap(f => (f.assignments || []).filter(esParada).map(a => Math.floor(a._start / DIA) + 1)));
  return { ...resultado, schedule, daysUsed: Math.min(resultado.daysUsed ?? diasUsados, diasUsados), mejora: { antes, despues, seg: +((Date.now() - t0) / 1000).toFixed(1) } };
}

/**
 * La mejora aplicada a lo que devuelve el motor (vrp-worker / vrp-client).
 * «generate» → el escenario; «autoscale» → su escenario y, si algún vehículo
 * añadido («Vehículo necesario N») se queda sin nada, se quita.
 * La ruta maestra (frecuencias) no pasa por aquí: cada parada tiene sus días.
 */
export async function conMejora(op, salida, constraints) {
  if (constraints?.mejorarRutas === false) return salida;
  // primero la mejora de siempre y después el optimizador «quitar tramos y recolocar» (sisr.js)
  const mejorar = async r => optimizarSISR(await mejorarRutas(r, constraints), constraints);
  if (op === "generate") return mejorar(salida);
  if (op !== "autoscale" || !salida?.result) return salida;
  const result = await mejorar(salida.result);
  const quedan = salida.resources.map((r, i) => !r._virtual || (result.schedule[i]?.assignments || []).some(esParada));
  return {
    ...salida,
    resources: salida.resources.filter((_, i) => quedan[i]),
    result: { ...result, schedule: result.schedule.filter((_, i) => quedan[i]) },
    addedCount: salida.resources.filter((r, i) => r._virtual && quedan[i]).length,
  };
}
