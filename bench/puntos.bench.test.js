// Banco de pruebas del motor de rutas por puntos: ciudades sintéticas (barrios
// agrupados alrededor de un centro, como una ciudad real) de varios tamaños,
// siempre las mismas (semilla fija). Para cada una: km, vehículos usados,
// paradas sin asignar, días, la jornada más larga y la más corta (equilibrio)
// y el tiempo de cálculo.
//
//   npx vitest run -c bench/vitest.config.js bench/puntos.bench.test.js
//   BENCH_SIN_MEJORA=1 solo el motor · BENCH_TIEMPO=ms tiempo de la mejora
//   BENCH_ETIQUETA="nombre" para guardar la pasada en bench/resultados/puntos.json
/* global process */
import { expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateScenario } from "../src/vrp-engine.js";
import { RESTRICCIONES_DEFECTO } from "../src/scheduling/restricciones-defecto.js";
import { mejorarRutas } from "../src/scheduling/mejora-rutas.js";

// números pseudoaleatorios reproducibles
function azar(semilla) { let s = semilla >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function ciudad(n, barrios, semilla = 7) {
  const r = azar(semilla), centro = [40.42, -3.70];
  const cs = Array.from({ length: barrios }, () => [centro[0] + (r() - 0.5) * 0.12, centro[1] + (r() - 0.5) * 0.16]);
  return Array.from({ length: n }, (_, i) => {
    const b = i % barrios, [la, lo] = cs[b];
    return { _id: `p${i}`, nombre: `P${i}`, lat: la + (r() - 0.5) * 0.012, lng: lo + (r() - 0.5) * 0.016, duracion: 2 + Math.floor(r() * 4), barrio: `B${b}` };
  });
}
export const flota = (k, deposito = [40.40, -3.72]) => Array.from({ length: k }, (_, i) => ({ _id: `v${i}`, nombre: `Camión ${i + 1}`, turno: "Mañana (06-14)", depotLat: deposito[0], depotLng: deposito[1] }));

export async function medirPuntos(tareas, vehiculos, extra = {}) {
  const cons = { ...RESTRICCIONES_DEFECTO, days: 1, ...extra };
  const t0 = performance.now();
  // como en la app: el motor y, encima, la mejora (BENCH_SIN_MEJORA=1 para solo el motor)
  let r = await generateScenario(tareas, vehiculos, cons);
  if (!process.env.BENCH_SIN_MEJORA) r = await mejorarRutas(r, cons, process.env.BENCH_TIEMPO ? { tiempoMs: +process.env.BENCH_TIEMPO } : {});
  const seg = (performance.now() - t0) / 1000;
  const usados = r.schedule.filter(x => (x.assignments || []).some(a => !a._travel && !a._break && !a._wait));
  const km = r.schedule.reduce((s, x) => s + (x.totalKm || 0), 0);
  const jornadas = usados.flatMap(x => {
    const porDia = new Map();
    for (const a of x.assignments) { const d = Math.floor(a._start / 1440); const j = porDia.get(d) || [Infinity, -Infinity]; porDia.set(d, [Math.min(j[0], a._start), Math.max(j[1], a._end)]); }
    return [...porDia.values()].map(([a, b]) => b - a);
  });
  const todas = r.schedule.flatMap(x => x.assignments || []);
  // ninguna parada perdida ni repetida, y nada solapado en un mismo vehículo
  const ids = todas.filter(a => !a._travel && !a._break && !a._wait).map(a => a._id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length + r.unassigned.length).toBe(tareas.length);
  for (const x of r.schedule) {
    const as = [...(x.assignments || [])].sort((a, b) => a._start - b._start);
    for (let i = 1; i < as.length; i++) expect(as[i]._start).toBeGreaterThanOrEqual(as[i - 1]._end);
  }
  const suma = f => Math.round(todas.filter(f).reduce((s, a) => s + (a._end - a._start), 0));
  const servicio = suma(a => !a._travel && !a._break && !a._wait), viaje = suma(a => a._travel), espera = suma(a => a._wait);
  const turnos = jornadas.length;
  return {
    km: Math.round(km),
    turnos, servicioMin: servicio, viajeMin: viaje, esperaMin: espera,
    // qué parte de los turnos usados (8 h) se va en paradas
    aprovechamiento: turnos ? +(servicio / (turnos * 480)).toFixed(2) : 0,
    // lo mínimo posible: todo el servicio + lo que ya se viaja, en turnos llenos (menos la pausa)
    cotaTurnos: Math.ceil((servicio + viaje) / (480 - (cons.breakAfter > 0 ? cons.breakDur : 0))), vehiculos: usados.length, sinAsignar: r.unassigned.length, dias: r.daysUsed,
    jornadaMax: jornadas.length ? Math.round(Math.max(...jornadas)) : 0, jornadaMin: jornadas.length ? Math.round(Math.min(...jornadas)) : 0,
    seg: +seg.toFixed(1),
  };
}

export const CASOS = [
  ["pequeña", 500, 8, 4],
  ["mediana", 2000, 20, 10],
  ["grande", 8000, 60, 30],
];

test("motor de puntos con ciudades sintéticas", async () => {
  const filas = [];
  for (const [nombre, n, barrios, k] of CASOS) {
    const m = await medirPuntos(ciudad(n, barrios), flota(k), { maxDays: 0 });
    filas.push({ ciudad: nombre, paradas: n, camiones: k, ...m });
    console.log(JSON.stringify(filas.at(-1)));
  }
  console.table(filas);
  mkdirSync("bench/resultados", { recursive: true });
  const f = "bench/resultados/puntos.json";
  const hist = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  hist.push({ etiqueta: process.env.BENCH_ETIQUETA || "sin nombre", fecha: new Date().toISOString(), filas });
  writeFileSync(f, JSON.stringify(hist, null, 1));
});
