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
// conducción. Cada ruta se comprueba igual que el motor (simular de
// mejora-rutas.js: fin de turno, duración máxima, tope de paradas, franjas
// horarias, pausas): nunca deja una ruta que el motor no aceptaría.
// Sin React ni Firebase.
import { hasCoords, kmRuta, minutosRuta, shiftForDay } from "../vrp-engine.js";
import { simular } from "./mejora-rutas.js";

const DIA = 1440;
const esParada = a => !a._travel && !a._break && !a._wait;
const sinHora = a => { const t = { ...a }; delete t._start; delete t._end; return t; };
const minutos = km => (km >= 0.05 ? Math.max(1, Math.ceil(minutosRuta(km))) : 0);

export const SISR = {
  costeTurno: 100_000,     // un turno (vehículo-día) más pesa más que cualquier ahorro de conducción
  costeSinRecoger: 10_000_000,
  quitarMedia: 10,         // paradas quitadas de media en cada vuelta
  tramoMax: 10,            // largo máximo de un tramo quitado
  saltarHueco: 0.01,       // a veces se salta un hueco al recolocar (da variedad)
  tempIni: 6, tempFin: 0.05, // «temperatura» en minutos de conducción
  vecinos: 60,             // paradas vecinas que se miran alrededor de la elegida
  parteFlota: 0.4,         // parte del tiempo para intentar quitar turnos
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
      if (ultimo && !fr && !ultimo.franja && ultimo.sitio === s && s >= 0) { ultimo.miembros.push(t); ultimo.dur += t.duracion || 15; continue; }
      ultimo = { t, miembros: [t], dia, sitio: s, dur: t.duracion || 15, franja: fr };
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
    for (const a of f.assignments || []) if (esParada(a)) { const d = Math.floor(a._start / DIA); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); }
    for (const [d, ps] of porDia) {
      diasConTrabajo.add(d);
      const sh = shiftForDay(f, d);
      if (!sh || (circular && sh.breaks?.length)) {
        // ruta que no se toca: sus paradas se quedan como están
        rutas.push({ fi, d, fija: true, seq: [] });
        continue;
      }
      const seq = agrupar(ps.sort((a, b) => a._start - b._start), d);
      rutas.push({ fi, d, off: d * DIA, sh, depot: depotDe(f), circular, seq });
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
      rutas.push({ fi, d, off: d * DIA, sh, depot: depotDe(f), circular, seq: [] });
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
  const MIN = denso ? new Uint16Array(S * S) : null, KM = denso ? new Float32Array(S * S) : null;
  if (denso) for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    if (i === j) continue;
    const km = kmRuta(sitios[i].lat, sitios[i].lng, sitios[j].lat, sitios[j].lng);
    KM[i * S + j] = km; MIN[i * S + j] = minutos(km);
  }
  const memo = new Map();
  const par = (a, b) => { const k = a * S + b; let v = memo.get(k); if (!v) { const km = kmRuta(sitios[a].lat, sitios[a].lng, sitios[b].lat, sitios[b].lng); v = [minutos(km), km]; if (memo.size < 3_000_000) memo.set(k, v); } return v; };
  const tt = (a, b) => (a < 0 || b < 0 || a === b ? 0 : denso ? MIN[a * S + b] : par(a, b)[0]);
  const tk = (a, b) => (a < 0 || b < 0 || a === b ? 0 : denso ? KM[a * S + b] : par(a, b)[1]);
  const dur = i => tareas[i].dur;
  const conFranja = i => tareas[i].franja;
  const cuantas = seq => seq.reduce((n, i) => n + tareas[i].miembros.length, 0); // contenedores (para el tope de paradas)
  const paradasDe = seq => seq.flatMap(i => tareas[i].miembros);
  for (const r of vivas) r.lenta = conPausas; // con pausas, se comprueban con simular

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
    if (!seq.length) return { ok: true, travel: 0, km: 0, total: 0, lenta: false };
    if (cons.maxStops > 0 && cuantas(seq) > cons.maxStops) return { ok: false };
    const lenta = r.lenta || seq.some(conFranja);
    if (lenta) {
      const s = simular({ off: r.off, sh: r.sh, depot: r.depot, circular: r.circular, paradas: paradasDe(seq) }, cons);
      if (!s.ok) return { ok: false };
      return { ok: true, travel: s.items.reduce((m, a) => m + (a._travel ? a.duracion : 0), 0), km: s.km, lenta: true };
    }
    let prev = r.depotSitio, travel = 0, km = 0, serv = 0;
    for (const i of seq) { const s = tareas[i].sitio; travel += tt(prev, s); km += tk(prev, s); serv += dur(i); if (s >= 0) prev = s; }
    const ancla = r.depotSitio >= 0 ? r.depotSitio : r.circular ? tareas[seq[0]].sitio : -1;
    if (ancla >= 0 && prev !== ancla) { travel += tt(prev, ancla); km += tk(prev, ancla); }
    const total = travel + serv;
    const ini = r.sh.start + r.off, finDia = r.sh.end + r.off;
    if (ini + total > finDia) return { ok: false };
    if (cons.maxShiftMin > 0 && total > cons.maxShiftMin) return { ok: false };
    return { ok: true, travel, km, total, lenta: false };
  }
  const coste = st => st.sinRecoger.length * SISR.costeSinRecoger + st.turnos * SISR.costeTurno + st.travel;

  // estado: secuencias por ruta + sus medidas
  const medidas = new Map();
  for (const r of vivas) {
    const e = evaluar(r, r.seq);
    if (!e.ok) r.fija = true; // ya venía fuera de lo que admite (no se toca)
    else medidas.set(r, e);
  }
  const libres = vivas.filter(r => !r.fija);
  const totales = st => ({ ...st, turnos: libres.filter(r => st.seqs.get(r).length).length, travel: libres.reduce((s, r) => s + (st.med.get(r)?.travel || 0), 0) });
  let actual = totales({ seqs: new Map(libres.map(r => [r, r.seq])), med: new Map(libres.map(r => [r, medidas.get(r)])), sinRecoger: sinRecoger0 });
  const antes = { sinRecoger: actual.sinRecoger.length, turnos: actual.turnos, conduccion: actual.travel };
  let mejor = actual;
  const rutaDe = st => { const m = new Map(); for (const r of libres) for (const i of st.seqs.get(r)) m.set(i, r); return m; };

  let cerradas = new Set(), abrir = true; // rutas que no se pueden usar / si se pueden abrir rutas vacías

  // ── Recolocar las paradas quitadas (la mejor posición de todas, saltándose alguna) ──
  function recolocar(st0, quitadas, prohibida = null) {
    const st = { ...st0, seqs: new Map(st0.seqs), med: new Map(st0.med) }; // sin tocar la solución de la que parte
    const orden = [...quitadas];
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
        const s = tareas[i].sitio, di = dur(i);
        const extraTurno = n ? 0 : SISR.costeTurno;
        // rápido: con cochera, sin franjas ni pausas, lo que añade cada hueco se sabe al momento
        if (!r.lenta && r.depotSitio >= 0 && !conFranja(i) && m && !m.lenta && m.total != null) {
          if (cons.maxStops > 0 && cuantas(seq) + tareas[i].miembros.length > cons.maxStops) continue;
          const ini = r.sh.start + r.off, finDia = r.sh.end + r.off;
          for (let p = 0; p <= n; p++) {
            if (rnd() < SISR.saltarHueco) continue;
            const a = p === 0 ? r.depotSitio : tareas[seq[p - 1]].sitio;
            const b = p === n ? r.depotSitio : tareas[seq[p]].sitio;
            const delta = tt(a, s) + tt(s, b) - tt(a, b);
            if (elegido && delta + extraTurno >= elegido.delta) continue;
            const total = m.total + delta + di;
            if (ini + total > finDia || (cons.maxShiftMin > 0 && total > cons.maxShiftMin)) continue;
            elegido = { r, p, delta: delta + extraTurno, rapido: { travel: m.travel + delta, km: m.km + tk(a, s) + tk(s, b) - tk(a, b), total } };
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
        elegido.e = { ok: true, ...elegido.rapido, lenta: false };
      }
      if (elegido) { st.seqs.set(elegido.r, elegido.seq); st.med.set(elegido.r, elegido.e); if (tareas[i].dia == null) tareas[i].diaNuevo = elegido.r.d; }
      else sinRecoger.push(i);
    }
    return totales({ ...st, sinRecoger });
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
      quitadas.push(...seq.slice(ini, ini + l));
      const nueva = [...seq.slice(0, ini), ...seq.slice(ini + l)];
      seqs.set(r, nueva); med.set(r, evaluar(r, nueva));
      tocadas.add(r);
    }
    return { st: { ...st, seqs, med }, quitadas };
  }

  // ── Recocido ──
  let vueltas = 0;
  const ceder = () => new Promise(res => setTimeout(res, 0));
  // primero, lo que el motor dejó sin recoger
  if (actual.sinRecoger.length) { actual = recolocar(actual, actual.sinRecoger); if (coste(actual) < coste(mejor)) mejor = actual; }

  // ── 1. Menos turnos: quitar una ruta y recolocar sus paradas poco a poco ──
  // (se aceptan soluciones con paradas pendientes mientras se busca; si al
  // final no queda ninguna, ese turno sobraba y se prueba con otro)
  const tFlota = t0 + tiempoMs * SISR.parteFlota;
  const costePend = st => st.sinRecoger.length * SISR.costePendiente + st.travel;
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
    while (st.sinRecoger.length && Date.now() < limite) {
      const temp = SISR.tempIni * Math.pow(SISR.tempFin / SISR.tempIni, (Date.now() - t0) / tiempoMs);
      const q = quitar(st);
      if (!q) break;
      const nuevo = recolocar(q.st, [...q.quitadas, ...st.sinRecoger]);
      vueltas++;
      const dc = costePend(nuevo) - costePend(st);
      if (dc < 0 || rnd() < Math.exp(-dc / temp)) st = nuevo;
      if (vueltas % 50 === 0) await ceder();
    }
    if (st.sinRecoger.length) break; // no se pudo: esa es la flota
    flota = st;
  }
  cerradas = new Set(); abrir = false; // con la flota conseguida, solo se mejora la conducción
  if (coste(flota) < coste(mejor)) mejor = flota;
  actual = mejor;

  // ── 2. Menos conducción con esa flota ──
  // (para antes si lleva un buen rato sin encontrar nada mejor)
  let ultimaMejora = Date.now();
  while (Date.now() - t0 < tiempoMs && Date.now() - ultimaMejora < Math.max(2_000, tiempoMs * 0.35)) {
    const frac = (Date.now() - t0) / tiempoMs;
    const temp = SISR.tempIni * Math.pow(SISR.tempFin / SISR.tempIni, frac);
    let nuevo;
    const q = quitar(actual); nuevo = q ? recolocar(q.st, q.quitadas) : null;
    vueltas++;
    if (nuevo) {
      const dc = coste(nuevo) - coste(actual);
      if (dc < 0 || rnd() < Math.exp(-dc / temp)) actual = nuevo;
      if (coste(actual) < coste(mejor)) { mejor = actual; ultimaMejora = Date.now(); }
    }
    if (vueltas % 50 === 0) await ceder();
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
    const s = simular({ off: r.off, sh: r.sh, depot: r.depot, circular: r.circular, paradas: paradasDe(seq) }, cons);
    if (!s.ok) return { ...resultado, sisr: { antes, despues: antes, vueltas, seg: +((Date.now() - t0) / 1000).toFixed(1), sinCambios: true, motivo: "una ruta no cuadró al rehacer las horas" } };
    nuevasItems.set(r, s.items);
  }
  const porFila = new Map();
  for (const [r, items] of nuevasItems) { if (!porFila.has(r.fi)) porFila.set(r.fi, []); porFila.get(r.fi).push({ d: r.d, items }); }
  const schedule = filas.map((f, fi) => {
    const cambios = porFila.get(fi);
    if (!cambios) return f;
    const diasC = new Set(cambios.map(c => c.d));
    const assignments = (f.assignments || []).filter(a => !diasC.has(Math.floor(a._start / DIA))).concat(cambios.flatMap(c => c.items)).sort((a, b) => a._start - b._start);
    return { ...f, assignments, totalKm: assignments.reduce((s, a) => s + (a._travel ? a.km || 0 : 0), 0) };
  });
  const recogidas = new Set(libres.flatMap(r => mejor.seqs.get(r)));
  const unassigned = paradasDe(sinRecoger0.filter(i => !recogidas.has(i))).concat(paradasDe(mejor.sinRecoger.filter(i => !sinRecoger0.includes(i))));
  const despues = { sinRecoger: unassigned.length, turnos: mejor.turnos, conduccion: mejor.travel };
  return { ...resultado, schedule, unassigned, sisr: { antes, despues, vueltas, seg: +((Date.now() - t0) / 1000).toFixed(1) } };
}
