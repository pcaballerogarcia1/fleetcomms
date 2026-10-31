// Scheduling de puntos · optimizador de rutas «quitar tramos y recolocar»
// (SISR, Christiaens y Vanden Berghe, 2020: «Slack Induction by String
// Removals», de los mejores métodos publicados para rutas de vehículos).
// Parte de las rutas del motor y, durante unos segundos, repite:
//  1. Quitar: elige una parada al azar y quita tramos seguidos de paradas
//     de varias rutas vecinas (las de alrededor de esa parada).
//  2. Recolocar: mete cada parada quitada donde menos tiempo añade, en
//     cualquier ruta del mismo día que tenga hueco (o en un vehículo que ese
//     día no trabajaba).
//  3. Aceptar: si sale mejor, siempre; si sale un poco peor, a veces (cada
//     vez menos: «recocido simulado»), para no quedarse atascado.
// Y de vez en cuando intenta vaciar la ruta más corta (un turno menos).
// Lo que cuenta, por este orden: paradas sin recoger, turnos, minutos de
// conducción (al segundo: sin redondear cada trayecto). Cada ruta se comprueba igual que el motor (simular de
// mejora-rutas.js: fin de turno, duración máxima, tope de paradas, franjas
// horarias, pausas): nunca deja una ruta que el motor no aceptaría.
// Sin React ni Firebase.
import { autonomiaDe, cargaMaxDe, demandaDe, diaJornada, hasCoords, kmRuta, shiftForDay, tiempoRuta } from "../vrp-engine.js";
import { margenDe, simular } from "./mejora-rutas.js";
import { crearTramos } from "./tramos.js";

const DIA = 1440;
const esParada = a => !a._travel && !a._break && !a._wait;
const sinHora = a => { const t = { ...a }; delete t._start; delete t._end; return t; };
// minutos exactos de un trayecto (al segundo; los reales de la tabla si están), igual que simular de mejora-rutas.js
const minutos = (km, a, b) => (km >= 0.05 ? tiempoRuta(a.lat, a.lng, b.lat, b.lng) : 0);

export const SISR = {
  costeTurno: 100_000,     // un turno (vehículo-día) más pesa más que cualquier ahorro de conducción
  costeSinRecoger: 10_000_000,
  quitarMedia: 10,         // paradas quitadas de media en cada vuelta
  tramoMax: 10,            // largo máximo de un tramo quitado
  saltarHueco: 0.01,       // a veces se salta un hueco al recolocar (da variedad)
  tempIni: 6, tempFin: 0.05, // «temperatura» en minutos de conducción
  vecinos: 60,             // paradas vecinas que se miran alrededor de la elegida
  parteFlota: 0.4,         // parte del tiempo para intentar quitar turnos
  pulir: true,             // pulir cada solución nueva (sin paradas pendientes) antes de decidir si se queda
  pulirMargen: Infinity,   // (solo las que salgan, como mucho, estos minutos peores que la actual)
  granular: 20,            // al pulir, cada parada se prueba junto a sus 20 vecinas más cercanas
  costePendiente: 120,     // mientras se busca quitar un turno: lo que «pesa» una parada pendiente (en minutos)
};

// generador de números al azar con semilla (mismos datos → mismo resultado)
function azar(semilla = 12345) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Optimiza un escenario ya generado (y mejorado) del motor.
 * @param resultado { schedule, unassigned, daysUsed }
 * @param constraints las del escenario
 * @param opciones { tiempoMs, semilla }
 * @returns el resultado con las rutas optimizadas + sisr { antes, despues, vueltas, seg }
 */
export async function optimizarSISR(resultado, constraints = {}, opciones = {}) {
  const t0 = Date.now();
  let tiempoMs = opciones.tiempoMs ?? null; // si no se dice: según el tamaño (abajo)
  const rnd = azar(opciones.semilla ?? 12345);
  const cons = constraints;
  const circular = !!cons.circular;
  const margen = margenDe(cons); // margen de seguridad del turno (0 con la tabla completa de tiempos reales)
  const filas = resultado.schedule || [];
  if (!filas.length) return resultado;

  // ── Las paradas (todas, con su día) y los sitios (coordenadas distintas) ──
  const tareas = [];           // { t: la parada, dia: número o null (sin recoger), sitio }
  const sitios = [];           // { lat, lng }
  const sitioDe = new Map();
  const sitio = (lat, lng) => {
    if (!hasCoords(lat, lng)) return -1;
    const k = `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`;
    if (!sitioDe.has(k)) { sitioDe.set(k, sitios.length); sitios.push({ lat: +lat, lng: +lng }); }
    return sitioDe.get(k);
  };

  // Las paradas seguidas en el mismo sitio (contenedores de la misma dirección)
  // van juntas: una sola parada con la suma de sus minutos. Así quitar un
  // tramo mueve sitios de verdad, no contenedores pegados (0 m entre ellos).
  const franjaDe = t => t.windowStart != null || !!t._dayWindows;
  function agrupar(lista, dia) {
    const idx = [];
    let ultimo = null;
    for (const a of lista) {
      const t = sinHora(a), s = sitio(a.lat, a.lng), fr = franjaDe(t);
      if (ultimo && !fr && !ultimo.franja && ultimo.sitio === s && s >= 0) { ultimo.miembros.push(t); ultimo.dur += t.duracion || 15; ultimo.q += demandaDe(t); continue; }
      ultimo = { t, miembros: [t], dia, sitio: s, dur: t.duracion || 15, franja: fr, q: demandaDe(t) };
      tareas.push(ultimo); idx.push(tareas.length - 1);
    }
    return idx;
  }

  // ── Las rutas: una por vehículo y día que trabaja ──
  const depotDe = f => (hasCoords(f.depotLat, f.depotLng) ? { lat: +f.depotLat, lng: +f.depotLng } : null);
  const rutas = [];            // { fi, d, off, sh, depot, depotSitio, circular, seq: [índices de tareas], lenta, travel, km, ok }
  const diasConTrabajo = new Set();
  const conPausas = cons.breakAfter > 0 && cons.breakDur > 0;
  filas.forEach((f, fi) => {
    const porDia = new Map();
    for (const a of f.assignments || []) if (esParada(a)) { const d = diaJornada(f, a._start); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); }
    for (const [d, ps] of porDia) {
      diasConTrabajo.add(d);
      const sh = shiftForDay(f, d);
      if (!sh || (circular && sh.breaks?.length)) {
        // ruta que no se toca: sus paradas se quedan como están
        rutas.push({ fi, d, fija: true, seq: [] });
        continue;
      }
      const seq = agrupar(ps.sort((a, b) => a._start - b._start), d);
      rutas.push({ fi, d, off: d * DIA, sh, depot: depotDe(f), circular, aut: autonomiaDe(f), cap: cargaMaxDe(f), seq });
    }
  });
  // las sin recoger: también juntas por sitio
  const porSitio = new Map();
  for (const t of resultado.unassigned || []) { const k = franjaDe(t) ? Symbol("franja") : sitio(t.lat, t.lng); if (!porSitio.has(k)) porSitio.set(k, []); porSitio.get(k).push(t); }
  const sinRecoger0 = [...porSitio.values()].flatMap(g => agrupar(g, null));
  // vehículos que un día con trabajo no salen: rutas vacías que se pueden abrir
  const dias = [...diasConTrabajo].sort((a, b) => a - b);
  if (!dias.length && sinRecoger0.length) dias.push(0);
  filas.forEach((f, fi) => {
    for (const d of dias) {
      if (rutas.some(r => r.fi === fi && r.d === d)) continue;
      const sh = shiftForDay(f, d);
      if (!sh || (circular && sh.breaks?.length)) continue;
      rutas.push({ fi, d, off: d * DIA, sh, depot: depotDe(f), circular, aut: autonomiaDe(f), cap: cargaMaxDe(f), seq: [] });
    }
  });
  const vivas = rutas.filter(r => !r.fija);
  for (const r of vivas) r.depotSitio = r.depot ? sitio(r.depot.lat, r.depot.lng) : -1;
  const S = sitios.length;
  if (!tareas.length) return resultado;
  // el tiempo: unos 30 ms por parada (juntas por sitio), entre 1,5 y 12 s; «a fondo», 90 s
  if (tiempoMs == null) tiempoMs = constraints?.optimizarAFondo ? 90_000 : Math.min(12_000, Math.max(1_500, tareas.length * 30));

  // ── Tiempos entre sitios (minutos enteros, como el motor) ──
  // hasta 2.500 sitios, tabla completa; con más, se calculan al pedirlos y se guardan
  const denso = S <= 2500;
  const MIN = denso ? new Float32Array(S * S) : null, KM = denso ? new Float32Array(S * S) : null;
  if (denso) for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    if (i === j) continue;
    const km = kmRuta(sitios[i].lat, sitios[i].lng, sitios[j].lat, sitios[j].lng);
    KM[i * S + j] = km; MIN[i * S + j] = minutos(km, sitios[i], sitios[j]);
  }
  const memo = new Map();
  const par = (a, b) => { const k = a * S + b; let v = memo.get(k); if (!v) { const km = kmRuta(sitios[a].lat, sitios[a].lng, sitios[b].lat, sitios[b].lng); v = [minutos(km, sitios[a], sitios[b]), km]; if (memo.size < 3_000_000) memo.set(k, v); } return v; };
  const tt = (a, b) => (a < 0 || b < 0 || a === b ? 0 : denso ? MIN[a * S + b] : par(a, b)[0]);
  const tk = (a, b) => (a < 0 || b < 0 || a === b ? 0 : denso ? KM[a * S + b] : par(a, b)[1]);
  const dur = i => tareas[i].dur;
  const cuantas = seq => seq.reduce((n, i) => n + tareas[i].miembros.length, 0); // contenedores (para el tope de paradas)
  const paradasDe = seq => seq.flatMap(i => tareas[i].miembros);
  for (const r of vivas) r.lenta = conPausas || !!r.sh?.breaks?.length; // con pausas o relevos, se comprueban con simular

  // Trozos de ruta (tramos.js): sin pausas ni relevos, cada hueco o cambio entre
  // rutas se comprueba juntando trozos ya calculados, sin rehacer la ruta
  const { unir, parada: trozoParada, salida, llegada, aTiempo } = crearTramos(tt, tk);
  for (const r of vivas) {
    const ini = r.sh.start + r.off;
    const fin = Math.min(r.sh.end + r.off - margen * (r.sh.end - r.sh.start), cons.maxShiftMin > 0 ? ini + cons.maxShiftMin * (1 - margen) : Infinity);
    r.rapida = !r.lenta && !(r.circular && r.depotSitio < 0); // circular sin base: vuelve a la primera parada (con simular)
    r.inicio = salida(r.depotSitio, ini);
    r.final = llegada(r.depotSitio, fin);
  }
  for (const x of tareas) x.rara = x.sitio < 0 || !!x.t._dayWindows; // sin coordenadas o con franjas por día: con simular
  const nodos = new Map(); // el trozo de cada parada en cada día (no cambia)
  const nodo = (i, off) => {
    const k = off * 1e6 + i;
    let n = nodos.get(k);
    if (!n) {
      const x = tareas[i], t = x.t;
      n = t.windowStart != null
        ? trozoParada(x.sitio, x.dur, t.windowStart + off, (t.windowEnd ?? t.windowStart) + off, x.q, x.miembros.length)
        : trozoParada(x.sitio, x.dur, null, null, x.q, x.miembros.length);
      nodos.set(k, n);
    }
    return n;
  };
  const rapida = (r, seq) => r.rapida && !seq.some(i => tareas[i].rara);

  // vecinas de cada tarea (por tiempo, del mismo día), para elegir qué tramos quitar
  const porDia = new Map();
  tareas.forEach((x, i) => { const k = x.dia ?? "sin"; if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(i); });
  const vecinas = tareas.map((x, i) => {
    const grupo = x.dia == null ? porDia.get(dias[0]) || [] : porDia.get(x.dia);
    return grupo.filter(j => j !== i).map(j => [tt(x.sitio, tareas[j].sitio) + tt(tareas[j].sitio, x.sitio), j]).sort((a, b) => a[0] - b[0]).slice(0, SISR.vecinos).map(p => p[1]);
  });

  // ── Evaluar una ruta ──
  // rápido (sin franjas ni pausas): conducción + servicio ≤ turno; si no, como el motor (simular)
  function evaluar(r, seq) {
    if (!seq.length) return { ok: true, travel: 0, km: 0, total: 0, carga: 0, lenta: false, ...(r.rapida ? { P: [r.inicio], Q: [r.final] } : {}) };
    if (cons.maxStops > 0 && cuantas(seq) > cons.maxStops) return { ok: false };
    const carga = seq.reduce((s, i) => s + tareas[i].q, 0);
    if (carga > r.cap + 1e-9) return { ok: false }; // carga máxima del vehículo
    if (rapida(r, seq)) {
      // con trozos: lo de antes de cada parada (P) y lo de después (Q), para probar huecos y cambios al momento
      const n = seq.length, P = new Array(n + 1), Q = new Array(n + 1);
      P[0] = r.inicio; Q[n] = r.final;
      for (let k = 0; k < n; k++) P[k + 1] = unir(P[k], nodo(seq[k], r.off));
      for (let k = n - 1; k >= 0; k--) Q[k] = unir(nodo(seq[k], r.off), Q[k + 1]);
      const tot = unir(P[n], r.final);
      if (!aTiempo(tot) || tot.km > r.aut + 1e-9) return { ok: false };
      return { ok: true, travel: tot.tr, km: tot.km, total: tot.D, carga, lenta: false, P, Q };
    }
    // con pausas, relevos o paradas raras: como el motor
    const s = simular({ off: r.off, sh: r.sh, depot: r.depot, circular: r.circular, aut: r.aut, cap: r.cap, paradas: paradasDe(seq) }, cons);
    if (!s.ok) return { ok: false };
    return { ok: true, travel: s.conduccion, km: s.km, carga, lenta: true };
  }
  // las sin recoger se cuentan por contenedores, no por grupos: dejar un grupo de 3 por meter dos sueltos es peor
  const pendientes = lista => lista.reduce((n, i) => n + tareas[i].miembros.length, 0);
  const coste = st => pendientes(st.sinRecoger) * SISR.costeSinRecoger + st.turnos * SISR.costeTurno + st.travel;

  // estado: secuencias por ruta + sus medidas
  const medidas = new Map();
  for (const r of vivas) {
    const e = evaluar(r, r.seq);
    if (!e.ok) r.fija = true; // ya venía fuera de lo que admite (no se toca)
    else medidas.set(r, e);
  }
  const libres = vivas.filter(r => !r.fija);
  // (una ruta que no cuadra pesa muchísimo: nunca puede parecer la mejor)
  const totales = st => ({ ...st, turnos: libres.filter(r => st.seqs.get(r).length).length, travel: libres.reduce((s, r) => { const m = st.med.get(r); return s + (m?.ok === false ? SISR.costeSinRecoger : m?.travel || 0); }, 0) });
  let actual = totales({ seqs: new Map(libres.map(r => [r, r.seq])), med: new Map(libres.map(r => [r, medidas.get(r)])), sinRecoger: sinRecoger0 });
  const antes = { sinRecoger: pendientes(actual.sinRecoger), turnos: actual.turnos, conduccion: actual.travel };
  let mejor = actual;
  const rutaDe = st => { const m = new Map(); for (const r of libres) for (const i of st.seqs.get(r)) m.set(i, r); return m; };

  let cerradas = new Set(), abrir = true; // rutas que no se pueden usar / si se pueden abrir rutas vacías

  // ── Recolocar las paradas quitadas (la mejor posición de todas, saltándose alguna) ──
  function recolocar(st0, quitadas, prohibida = null) {
    const st = { ...st0, seqs: new Map(st0.seqs), med: new Map(st0.med) }; // sin tocar la solución de la que parte
    const orden = [...quitadas];
    if (!orden.length) return totales(st);
    const modo = rnd();
    if (modo < 0.4) orden.sort(() => rnd() - 0.5);
    else if (modo < 0.7) orden.sort((a, b) => dur(b) - dur(a));
    else if (modo < 0.9) { const c = tareas[orden[0]].sitio; orden.sort((a, b) => tk(tareas[b].sitio, c) - tk(tareas[a].sitio, c)); } // de lejos a cerca
    else { const c = tareas[orden[0]].sitio; orden.sort((a, b) => tk(tareas[a].sitio, c) - tk(tareas[b].sitio, c)); } // de cerca a lejos
    const sinRecoger = [...st.sinRecoger.filter(i => !quitadas.includes(i))];
    for (const i of orden) {
      const d = tareas[i].dia;
      let elegido = null;
      for (const r of libres) {
        if (r === prohibida || cerradas.has(r) || (d != null && r.d !== d)) continue;
        const seq = st.seqs.get(r), m = st.med.get(r);
        if (!abrir && !seq.length) continue; // con la flota fija no se abren rutas nuevas
        const n = seq.length;
        const s = tareas[i].sitio;
        const extraTurno = n ? 0 : SISR.costeTurno;
        // rápido (sin pausas ni relevos): cada hueco se comprueba juntando trozos (tramos.js)
        let mm = m;
        if (r.rapida && !mm?.P && !mm?.lenta) { mm = evaluar(r, seq); if (mm.ok) st.med.set(r, mm); }
        if (mm?.P && !tareas[i].rara) {
          if (!mm.ok) continue;
          if (cons.maxStops > 0 && cuantas(seq) + tareas[i].miembros.length > cons.maxStops) continue;
          if ((mm.carga || 0) + tareas[i].q > r.cap + 1e-9) continue; // no cabe en el camión
          const nd = nodo(i, r.off);
          for (let p = 0; p <= n; p++) {
            if (rnd() < SISR.saltarHueco) continue;
            const a = mm.P[p].l, b = mm.Q[p].f;
            const delta = tt(a, s) + tt(s, b) - tt(a, b);
            if (elegido && delta + extraTurno >= elegido.delta) continue;
            const x = unir(unir(mm.P[p], nd), mm.Q[p]);
            if (!aTiempo(x) || x.km > r.aut + 1e-9) continue;
            elegido = { r, p, delta: delta + extraTurno, rapido: true };
          }
          continue;
        }
        // lento (franjas, pausas, sin cochera): los mejores huecos aproximados, comprobados como el motor
        const cand = [];
        for (let p = 0; p <= n; p++) {
          if (rnd() < SISR.saltarHueco) continue;
          const a = p === 0 ? r.depotSitio : tareas[seq[p - 1]].sitio;
          const b = p === n ? (r.depotSitio >= 0 ? r.depotSitio : r.circular && n ? tareas[seq[0]].sitio : -1) : tareas[seq[p]].sitio;
          const delta = tt(a, s) + tt(s, b) - tt(a, b);
          if (elegido && delta + extraTurno >= elegido.delta) continue;
          cand.push([delta, p]);
        }
        cand.sort((x, y) => x[0] - y[0]);
        for (const [, p] of cand.slice(0, 4)) {
          const nueva = [...seq.slice(0, p), i, ...seq.slice(p)];
          const e = evaluar(r, nueva);
          if (!e.ok) continue;
          const delta = e.travel - (m?.travel || 0) + extraTurno;
          if (!elegido || delta < elegido.delta) elegido = { r, seq: nueva, e, delta };
          break;
        }
      }
      if (elegido?.rapido) {
        const seq = st.seqs.get(elegido.r);
        elegido.seq = [...seq.slice(0, elegido.p), i, ...seq.slice(elegido.p)];
        elegido.e = evaluar(elegido.r, elegido.seq);
        if (!elegido.e.ok) elegido = null;
      }
      if (elegido) { st.seqs.set(elegido.r, elegido.seq); st.med.set(elegido.r, elegido.e); if (tareas[i].dia == null) tareas[i].diaNuevo = elegido.r.d; }
      else sinRecoger.push(i);
    }
    return totales({ ...st, sinRecoger });
  }

  // ── Pulir: cambios pequeños entre paradas vecinas ──
  // Cada parada se prueba junto a sus vecinas más cercanas: ponerla detrás o
  // delante de la vecina (en su ruta o en otra), intercambiarlas, llevarse dos
  // seguidas, cambiar las colas de dos rutas o dar la vuelta a un trozo. Cada
  // cambio entre rutas se comprueba juntando trozos (tramos.js): miles en
  // milisegundos. Se queda con el primero que ahorra y sigue hasta que ninguno ahorra.
  // Con `foco` (las paradas que se acaban de recolocar), solo alrededor de
  // ellas: pulirlo todo en cada vuelta deja dar muy pocas vueltas (con miles de
  // paradas, o tras quitar un turno) y la búsqueda se queda atascada.
  function pulir(st0, foco = null, hasta = t0 + tiempoMs) {
    const st = { ...st0, seqs: new Map(st0.seqs), med: new Map(st0.med) };
    const donde = new Map(), pos = new Map(); // la ruta de cada parada y su posición en ella
    for (const r of libres) st.seqs.get(r).forEach((i, k) => { donde.set(i, r); pos.set(i, k); });
    const medDe = r => { let m = st.med.get(r); if (!m?.P && !m?.lenta) { m = evaluar(r, st.seqs.get(r)); st.med.set(r, m); } return m; };
    const usable = r => !cerradas.has(r) && !!medDe(r).P;
    const cabe = (r, x) => aTiempo(x) && x.km <= r.aut + 1e-9 && x.q <= r.cap + 1e-9 && !(cons.maxStops > 0 && x.c > cons.maxStops);
    const poner = (r, seq) => { const e = evaluar(r, seq); if (!e.ok) return false; st.seqs.set(r, seq); st.med.set(r, e); seq.forEach((i, k) => { donde.set(i, r); pos.set(i, k); }); return true; };
    // dos rutas a la vez: si la segunda no cuadra al rehacerla, se deja la primera como estaba
    const ponerDos = (ru, nu, rv, nv) => {
      const su = st.seqs.get(ru), mu = st.med.get(ru);
      if (!poner(ru, nu)) return false;
      if (poner(rv, nv)) return true;
      st.seqs.set(ru, su); st.med.set(ru, mu); su.forEach((i, k) => { donde.set(i, ru); pos.set(i, k); });
      return false;
    };
    const sitioDe = i => tareas[i].sitio;
    const vale = (ru, rv, d, hacer) => {
      if (d >= -1e-6) return false;
      const [U, V] = hacer();
      return cabe(ru, U) && cabe(rv, V);
    };

    // entre dos rutas: con los trozos de antes (P) y de después (Q) de cada parada
    function entre(u, v, ru, rv) {
      const su = st.seqs.get(ru), sv = st.seqs.get(rv);
      const a = pos.get(u), b = pos.get(v);
      const mu = medDe(ru), mv = medDe(rv);
      if (!mu.ok || !mv.ok) return false;
      const { P: Pu, Q: Qu } = mu, { P: Pv, Q: Qv } = mv;
      const us = sitioDe(u), vs = sitioDe(v), pu = Pu[a].l, nu = Qu[a + 1].f, pv = Pv[b].l, nv = Qv[b + 1].f;
      const vaciaU = su.length === 1 ? -SISR.costeTurno : 0;
      const tu = nodo(u, ru.off), tv = nodo(v, rv.off);
      const quitarU = tt(pu, nu) - tt(pu, us) - tt(us, nu);
      const sinU = () => [...su.slice(0, a), ...su.slice(a + 1)];
      // 1. u detrás de v
      if (vale(ru, rv, quitarU + vaciaU + tt(vs, us) + tt(us, nv) - tt(vs, nv), () => [unir(Pu[a], Qu[a + 1]), unir(unir(Pv[b + 1], tu), Qv[b + 1])]))
        return ponerDos(ru, sinU(), rv, [...sv.slice(0, b + 1), u, ...sv.slice(b + 1)]);
      // 2. u delante de v
      if (vale(ru, rv, quitarU + vaciaU + tt(pv, us) + tt(us, vs) - tt(pv, vs), () => [unir(Pu[a], Qu[a + 1]), unir(unir(Pv[b], tu), Qv[b])]))
        return ponerDos(ru, sinU(), rv, [...sv.slice(0, b), u, ...sv.slice(b)]);
      // 3. intercambiar u y v
      if (vale(ru, rv, tt(pu, vs) + tt(vs, nu) - tt(pu, us) - tt(us, nu) + tt(pv, us) + tt(us, nv) - tt(pv, vs) - tt(vs, nv),
        () => [unir(unir(Pu[a], tv), Qu[a + 1]), unir(unir(Pv[b], tu), Qv[b + 1])])) {
        const nuevaU = [...su], nuevaV = [...sv]; nuevaU[a] = v; nuevaV[b] = u;
        return ponerDos(ru, nuevaU, rv, nuevaV);
      }
      // 4 y 5. cambiar las colas (si las dos rutas acaban en el mismo sitio a la misma hora)
      if (ru.depotSitio === rv.depotSitio && ru.final.L === rv.final.L && ru.off === rv.off) {
        // u sigue con lo de detrás de v, y v con lo de detrás de u
        if (vale(ru, rv, tt(us, nv) + tt(vs, nu) - tt(us, nu) - tt(vs, nv), () => [unir(Pu[a + 1], Qv[b + 1]), unir(Pv[b + 1], Qu[a + 1])]))
          return ponerDos(ru, [...su.slice(0, a + 1), ...sv.slice(b + 1)], rv, [...sv.slice(0, b + 1), ...su.slice(a + 1)]);
        // u sigue con v y lo de detrás; lo de delante de v sigue con lo de detrás de u
        const vaciaV = b === 0 && a === su.length - 1 ? -SISR.costeTurno : 0;
        if (vale(ru, rv, tt(us, vs) + tt(pv, nu) - tt(us, nu) - tt(pv, vs) + vaciaV, () => [unir(Pu[a + 1], Qv[b]), unir(Pv[b], Qu[a + 1])]))
          return ponerDos(ru, [...su.slice(0, a + 1), ...sv.slice(b)], rv, [...sv.slice(0, b), ...su.slice(a + 1)]);
      }
      // 6. u y la siguiente, juntas, detrás de v
      if (a + 1 < su.length) {
        const u2 = su[a + 1], u2s = sitioDe(u2), nn = Qu[a + 2].f;
        const vacia2 = su.length === 2 ? -SISR.costeTurno : 0;
        if (vale(ru, rv, tt(pu, nn) - tt(pu, us) - tt(u2s, nn) + vacia2 + tt(vs, us) + tt(u2s, nv) - tt(vs, nv),
          () => [unir(Pu[a], Qu[a + 2]), unir(unir(Pv[b + 1], unir(tu, nodo(u2, rv.off))), Qv[b + 1])]))
          return ponerDos(ru, [...su.slice(0, a), ...su.slice(a + 2)], rv, [...sv.slice(0, b + 1), u, u2, ...sv.slice(b + 1)]);
      }
      return false;
    }

    // dentro de la misma ruta: se rehace la secuencia
    const conducir = (r, seq) => { let prev = r.depotSitio, t = 0; for (const i of seq) { t += tt(prev, tareas[i].sitio); prev = tareas[i].sitio; } return t + tt(prev, r.depotSitio); };
    function dentro(u, v, r) {
      const s = st.seqs.get(r), m = medDe(r);
      const a = pos.get(u), b = pos.get(v);
      if (!m.ok) return false;
      // lo que ahorra cada cambio se sabe al momento (solo se rehace la ruta si ahorra)
      const us = sitioDe(u), vs = sitioDe(v), pu = m.P[a].l, nu = m.Q[a + 1].f, pv = m.P[b].l, nv = m.Q[b + 1].f;
      const quitarU = tt(pu, nu) - tt(pu, us) - tt(us, nu);
      const sinU = () => [...s.slice(0, a), ...s.slice(a + 1)];
      // u detrás de v
      if (b + 1 !== a && quitarU + tt(vs, us) + tt(us, nv) - tt(vs, nv) < -1e-6) {
        const x = sinU(), bb = b > a ? b - 1 : b;
        if (poner(r, [...x.slice(0, bb + 1), u, ...x.slice(bb + 1)])) return true;
      }
      // u delante de v
      if (b - 1 !== a && quitarU + tt(pv, us) + tt(us, vs) - tt(pv, vs) < -1e-6) {
        const x = sinU(), bb = b > a ? b - 1 : b;
        if (poner(r, [...x.slice(0, bb), u, ...x.slice(bb)])) return true;
      }
      // dar la vuelta al trozo entre las dos, para que u siga con v (o v con u)
      const [i, j] = a < b ? [a, b] : [b, a];
      if (j - i >= 2) {
        const si = sitioDe(s[i]), si1 = sitioDe(s[i + 1]), sj = sitioDe(s[j]), sj1 = m.Q[j + 1].f;
        if (tt(si, sj) + tt(si1, sj1) - tt(si, si1) - tt(sj, sj1) < -1e-6) {
          const nueva = [...s.slice(0, i + 1), ...s.slice(i + 1, j + 1).reverse(), ...s.slice(j + 1)];
          if (conducir(r, nueva) < m.travel - 1e-6 && poner(r, nueva)) return true; // (con ida y vuelta distintas, el trozo cambia)
        }
      }
      return false;
    }

    let orden = [...donde.keys()];
    if (foco) {
      const zona = new Set();
      for (const i of foco) { zona.add(i); for (let k = 0; k < Math.min(5, vecinas[i].length); k++) zona.add(vecinas[i][k]); }
      orden = [...zona].filter(i => donde.has(i));
    }
    for (let k = orden.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [orden[k], orden[j]] = [orden[j], orden[k]]; }
    let algo = true, pasadas = 0;
    while (algo && pasadas++ < 50 && Date.now() < hasta) {
      algo = false;
      for (const u of orden) {
        const ru = donde.get(u);
        if (!ru || !usable(ru) || tareas[u].rara) continue;
        const vs = vecinas[u];
        for (let k = 0; k < Math.min(SISR.granular, vs.length); k++) {
          const v = vs[k], rv = donde.get(v);
          if (!rv || rv.d !== ru.d || tareas[v].rara || !usable(rv)) continue;
          if (rv === ru ? dentro(u, v, ru) : entre(u, v, ru, rv)) { algo = true; break; }
        }
      }
    }
    return totales(st);
  }

  // ── Quitar tramos alrededor de una parada al azar ──
  function quitar(st) {
    const donde = rutaDe(st);
    const asignadas = [...donde.keys()];
    if (!asignadas.length) return null;
    const semilla = asignadas[Math.floor(rnd() * asignadas.length)];
    const ls = Math.min(SISR.tramoMax, Math.max(1, Math.round(asignadas.length / Math.max(1, libres.filter(r => st.seqs.get(r).length).length))));
    const ks = Math.floor(rnd() * ((4 * SISR.quitarMedia) / (1 + ls) - 1)) + 1;
    const seqs = new Map(st.seqs), med = new Map(st.med), tocadas = new Set();
    const quitadas = [];
    for (const c of [semilla, ...vecinas[semilla]]) {
      if (tocadas.size >= ks) break;
      const r = donde.get(c);
      if (!r || tocadas.has(r)) continue;
      const seq = seqs.get(r);
      const pos = seq.indexOf(c);
      if (pos < 0) continue;
      const l = Math.max(1, Math.floor(rnd() * Math.min(ls, seq.length)) + 1);
      const ini = Math.max(0, Math.min(seq.length - l, pos - Math.floor(rnd() * l)));
      const nueva = [...seq.slice(0, ini), ...seq.slice(ini + l)];
      // sin esas paradas la ruta casi siempre cuadra, pero no siempre (la carretera estimada no
      // cumple que ir directo sea lo más corto): entonces esa ruta no se toca
      const e = evaluar(r, nueva);
      tocadas.add(r);
      if (!e.ok) continue;
      quitadas.push(...seq.slice(ini, ini + l));
      seqs.set(r, nueva); med.set(r, e);
    }
    if (!quitadas.length) return null; // ninguna ruta se dejaba quitar nada
    return { st: { ...st, seqs, med }, quitadas };
  }

  // ── Recocido ──
  let vueltas = 0;
  let cedido = Date.now();
  const ceder = async () => { if (Date.now() - cedido < 50) return; await new Promise(res => setTimeout(res, 0)); cedido = Date.now(); };
  // primero, lo que el motor dejó sin recoger
  if (actual.sinRecoger.length) { actual = recolocar(actual, actual.sinRecoger); if (coste(actual) < coste(mejor)) mejor = actual; }

  // ── 1. Menos turnos: quitar una ruta y recolocar sus paradas poco a poco ──
  // (se aceptan soluciones con paradas pendientes mientras se busca; si al
  // final no queda ninguna, ese turno sobraba y se prueba con otro)
  const tFlota = t0 + tiempoMs * SISR.parteFlota;
  const costePend = st => pendientes(st.sinRecoger) * SISR.costePendiente + st.travel;
  let flota = mejor;
  while (Date.now() < tFlota && !mejor.sinRecoger.length) {
    const conTrabajo = libres.filter(r => flota.seqs.get(r).length).sort((a, b) => flota.seqs.get(a).length - flota.seqs.get(b).length);
    if (conTrabajo.length < 2) break;
    const quitada = conTrabajo[Math.floor(rnd() * Math.min(2, conTrabajo.length))];
    cerradas = new Set([quitada]); abrir = false;
    const seqs = new Map(flota.seqs), med = new Map(flota.med);
    const pend = seqs.get(quitada);
    seqs.set(quitada, []); med.set(quitada, { ok: true, travel: 0, km: 0 });
    let st = recolocar({ ...flota, seqs, med }, pend);
    const limite = Math.min(tFlota, Date.now() + Math.max(1500, (tFlota - Date.now()) / 2));
    let sinQuitar = 0;
    while (st.sinRecoger.length && Date.now() < limite) {
      const temp = SISR.tempIni * Math.pow(SISR.tempFin / SISR.tempIni, (Date.now() - t0) / tiempoMs);
      const q = quitar(st);
      if (!q) { if (++sinQuitar > 50) break; continue; } // esta vez no se pudo quitar nada: se prueba con otra parada
      const nuevo = recolocar(q.st, [...q.quitadas, ...st.sinRecoger]);
      vueltas++;
      const dc = costePend(nuevo) - costePend(st);
      if (dc < 0 || rnd() < Math.exp(-dc / temp)) st = nuevo;
      if (vueltas % 8 === 0) await ceder();
    }
    if (st.sinRecoger.length) break; // no se pudo: esa es la flota
    flota = st;
  }
  cerradas = new Set(); abrir = false; // con la flota conseguida, solo se mejora la conducción
  if (SISR.pulir) { flota = pulir(flota); if (flota.sinRecoger.length) flota = recolocar(flota, flota.sinRecoger); }
  if (coste(flota) < coste(mejor)) mejor = flota;
  actual = mejor;

  // ── 2. Menos conducción con esa flota ──
  // (para antes si lleva un buen rato sin encontrar nada mejor)
  let ultimaMejora = Date.now();
  while (Date.now() - t0 < tiempoMs && Date.now() - ultimaMejora < Math.max(2_000, tiempoMs * 0.35)) {
    const frac = (Date.now() - t0) / tiempoMs;
    const temp = SISR.tempIni * Math.pow(SISR.tempFin / SISR.tempIni, frac);
    let nuevo;
    // lo quitado y lo que sigue sin recoger (cada vuelta puede haber hecho hueco)
    const q = quitar(actual); nuevo = q ? recolocar(q.st, [...q.quitadas, ...actual.sinRecoger]) : null;
    if (nuevo && SISR.pulir && coste(nuevo) < coste(actual) + SISR.pulirMargen) {
      nuevo = pulir(nuevo, q.quitadas);
      if (nuevo.sinRecoger.length) nuevo = recolocar(nuevo, nuevo.sinRecoger); // pulir ahorra tiempo: quizá ya caben
    }
    vueltas++;
    if (nuevo) {
      const dc = coste(nuevo) - coste(actual);
      if (dc < 0 || rnd() < Math.exp(-dc / temp)) actual = nuevo;
      if (coste(actual) < coste(mejor)) { mejor = actual; ultimaMejora = Date.now(); }
    }
    if (vueltas % 8 === 0) await ceder();
  }

  // ── Volver a montar el escenario con la mejor solución ──
  const costeAntes = antes.sinRecoger * SISR.costeSinRecoger + antes.turnos * SISR.costeTurno + antes.conduccion;
  if (coste(mejor) >= costeAntes) {
    return { ...resultado, sisr: { antes, despues: antes, vueltas, seg: +((Date.now() - t0) / 1000).toFixed(1), sinCambios: true } };
  }
  const nuevasItems = new Map(); // ruta → items
  for (const r of libres) {
    const seq = mejor.seqs.get(r);
    if (seq === r.seq) continue;
    if (!seq.length) { nuevasItems.set(r, []); continue; }
    const s = simular({ off: r.off, sh: r.sh, depot: r.depot, circular: r.circular, aut: r.aut, cap: r.cap, paradas: paradasDe(seq) }, cons);
    if (!s.ok) return { ...resultado, sisr: { antes, despues: antes, vueltas, seg: +((Date.now() - t0) / 1000).toFixed(1), sinCambios: true, motivo: "una ruta no cuadró al rehacer las horas" } };
    nuevasItems.set(r, s.items);
  }
  const porFila = new Map();
  for (const [r, items] of nuevasItems) { if (!porFila.has(r.fi)) porFila.set(r.fi, []); porFila.get(r.fi).push({ d: r.d, items }); }
  const schedule = filas.map((f, fi) => {
    const cambios = porFila.get(fi);
    if (!cambios) return f;
    const diasC = new Set(cambios.map(c => c.d));
    const assignments = (f.assignments || []).filter(a => !diasC.has(diaJornada(f, a._start))).concat(cambios.flatMap(c => c.items)).sort((a, b) => a._start - b._start);
    return { ...f, assignments, totalKm: assignments.reduce((s, a) => s + (a._travel ? a.km || 0 : 0), 0) };
  });
  const recogidas = new Set(libres.flatMap(r => mejor.seqs.get(r)));
  const unassigned = paradasDe(sinRecoger0.filter(i => !recogidas.has(i))).concat(paradasDe(mejor.sinRecoger.filter(i => !sinRecoger0.includes(i))));
  const despues = { sinRecoger: unassigned.length, turnos: mejor.turnos, conduccion: mejor.travel };
  return { ...resultado, schedule, unassigned, sisr: { antes, despues, vueltas, seg: +((Date.now() - t0) / 1000).toFixed(1) } };
}
