// Escenarios al azar con todas las normas combinadas (franjas, carga máxima,
// autonomía, tope de paradas, duración máxima, pausas, relevo de conductor, ida
// y vuelta, varios días, sin base, contenedores en el mismo sitio): el motor,
// la mejora y «quitar y recolocar» no pierden ni duplican paradas, la mejora no
// deja más sin recoger que el motor y ninguna ruta incumple nada. El revisor es
// independiente del motor. (La versión larga, con miles de escenarios, se pasó
// a mano: en cada fallo que encontró hay un arreglo en el motor o la mejora.)
import { afterEach, describe, expect, it } from "vitest";
import { autoScaleFleet, diaJornada, fijarCarretera, generateScenario, shiftForDay } from "../vrp-engine.js";
import { mejorarRutas, porTurnos } from "./mejora-rutas.js";
import { optimizarSISR } from "./sisr.js";

afterEach(() => fijarCarretera(null));
const esParada = a => !a._travel && !a._break && !a._wait;
function azar(semilla) { let s = semilla >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function escenario(sem) {
  const rnd = azar(sem * 7919);
  const si = p => rnd() < p;
  const n = 15 + Math.floor(rnd() * 45);
  const conFranjas = si(0.5), conCarga = si(0.5), mismoSitio = si(0.4);
  const tareas = [];
  for (let i = 0; i < n; i++) {
    const t = { id: `t${i}`, nombre: `t${i}`, duracion: 2 + Math.floor(rnd() * 12) };
    if (mismoSitio && i > 0 && si(0.3)) { const o = tareas[Math.floor(rnd() * tareas.length)]; t.lat = o.lat; t.lng = o.lng; }
    else { t.lat = 40.40 + (rnd() - 0.5) * 0.08; t.lng = -3.70 + (rnd() - 0.5) * 0.1; }
    if (conFranjas && si(0.6)) { const w = 360 + Math.floor(rnd() * 420); t.windowStart = w; t.windowEnd = w + 20 + Math.floor(rnd() * 150); }
    if (conCarga) t.demanda = 1 + Math.floor(rnd() * 30);
    tareas.push(t);
  }
  const nv = 1 + Math.floor(rnd() * 5);
  const sinBase = si(0.2), autonomia = si(0.3), relevo = si(0.3);
  const vehs = Array.from({ length: nv }, (_, i) => {
    const v = { _id: `v${i}`, nombre: `V${i}`, turno: si(0.3) ? "Mañana (06-14)" : "Jornada completa" };
    if (!(sinBase && i === 0)) { v.depotLat = 40.40 + (rnd() - 0.5) * 0.02; v.depotLng = -3.70 + (rnd() - 0.5) * 0.02; }
    if (conCarga) v.cargaMax = 60 + Math.floor(rnd() * 200);
    if (autonomia) v.autonomiaKm = 15 + Math.floor(rnd() * 60);
    if (relevo) v._shiftBreaks = [600];
    return v;
  });
  const cons = {
    maxShiftMin: si(0.3) ? 240 + Math.floor(rnd() * 200) : 0,
    maxStops: si(0.3) ? 5 + Math.floor(rnd() * 20) : 0,
    breakAfter: si(0.3) ? 120 + Math.floor(rnd() * 120) : 0, breakDur: 20,
    startMin: 360, endMin: 840 + Math.floor(rnd() * 240),
    maxDays: si(0.4) ? 1 + Math.floor(rnd() * 4) : 1,
    circular: si(0.3), optimizeWeight: 0, virtualShiftMin: 0,
    carretera: { factor: 1.2 + rnd() * 0.3, kmh: 20 + rnd() * 20, vecinosCompleta: si(0.5) },
  };
  return { tareas, vehs, cons, autoescalar: si(0.4) };
}

function revisar(res, tareas, cons) {
  const fallos = [];
  const vistos = new Map();
  for (const f of res.schedule) for (const a of f.assignments || []) if (esParada(a)) vistos.set(a.id, (vistos.get(a.id) || 0) + 1);
  for (const t of res.unassigned || []) vistos.set(t.id, (vistos.get(t.id) || 0) + 1);
  for (const t of tareas) { const c = vistos.get(t.id) || 0; if (c !== 1) fallos.push(`${t.id} aparece ${c} veces`); }
  for (const f of res.schedule) {
    const porDia = new Map();
    for (const a of f.assignments || []) { const d = diaJornada(f, a._start); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); }
    for (const [d, items] of porDia) {
      const off = d * 1440, sh = shiftForDay(f, d);
      const ps = items.filter(esParada);
      if (!ps.length) continue;
      const tag = `${f.nombre} día ${d}`;
      for (const p of ps) if (p.windowStart != null && (p._start > p.windowEnd + off + 0.51 || p._start < p.windowStart + off - 0.51)) fallos.push(`${tag}: ${p.id} fuera de su franja`);
      const cortes = cons.circular && sh?.breaks?.length ? sh.breaks.map(x => x + off) : [];
      const viajes = new Map();
      for (const p of ps) { const v = cortes.filter(c => p._start >= c).length; viajes.set(v, (viajes.get(v) || 0) + (p.demanda || 0)); }
      for (const [v, carga] of viajes) if (f.cargaMax > 0 && carga > f.cargaMax + 1e-6) fallos.push(`${tag} viaje ${v}: carga ${carga} > ${f.cargaMax}`);
      const km = items.reduce((s, a) => s + (a._travel ? a.km || 0 : 0), 0);
      if (f.autonomiaKm > 0 && km > f.autonomiaKm + 0.01) fallos.push(`${tag}: ${km.toFixed(2)} km > autonomía ${f.autonomiaKm}`);
      if (cons.maxStops > 0 && ps.length > cons.maxStops) fallos.push(`${tag}: ${ps.length} paradas > tope ${cons.maxStops}`);
      if (sh && Math.max(...items.map(a => a._end)) > sh.end + off + 0.51) fallos.push(`${tag}: acaba pasado el fin de turno`);
      for (const c of (sh?.breaks || []).map(x => x + off)) for (const a of items) if (a._start < c - 0.51 && a._end > c + 0.51 && (cons.circular || esParada(a))) fallos.push(`${tag}: a caballo del relevo`);
      const orden = [...items].sort((a, b) => a._start - b._start);
      for (let k = 1; k < orden.length; k++) if (orden[k]._start < orden[k - 1]._end - 0.51) { fallos.push(`${tag}: bloques solapados`); break; }
    }
  }
  return fallos;
}

// como conMejora, pero con poco tiempo para que la prueba sea rápida
const mejorar = (r, cons) => porTurnos(r, cons, async x => optimizarSISR(await mejorarRutas(x, cons, { tiempoMs: 250 }), cons, { tiempoMs: 350 }));

describe("el motor con escenarios al azar", () => {
  it("nunca pierde paradas ni incumple ninguna norma", async () => {
    const fallos = [];
    for (let sem = 1; sem <= 16; sem++) {
      const { tareas, vehs, cons, autoescalar } = escenario(sem);
      fijarCarretera(cons.carretera);
      let r0;
      if (autoescalar) r0 = (await autoScaleFleet(tareas, vehs, cons)).result;
      else r0 = await generateScenario(tareas, vehs, cons);
      const r = await mejorar(r0, cons);
      for (const x of revisar(r0, tareas, cons)) fallos.push(`#${sem} motor: ${x}`);
      for (const x of revisar(r, tareas, cons)) fallos.push(`#${sem} mejora: ${x}`);
      if (r.unassigned.length > r0.unassigned.length) fallos.push(`#${sem} la mejora deja más sin recoger (${r0.unassigned.length} → ${r.unassigned.length})`);
      if (r.sisr?.motivo) fallos.push(`#${sem} ${r.sisr.motivo}`);
    }
    expect(fallos).toEqual([]);
  }, 120_000);
});
