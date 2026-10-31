// Tabla de clasificación del motor de rutas: problemas públicos con la mejor
// solución conocida (TSPLIB, Solomon con franjas y capacidad, colección X de
// Uchoa con capacidad) y, de referencia, PyVRP (bench/pyvrp_referencia.py).
// Cada problema se pasa por el motor como la app (motor + vehículos de más si
// hacen falta + mejora + «quitar y recolocar»), y se mide con la distancia
// oficial de cada colección.
//
//   node bench/clasificacion.mjs                 modo normal
//   A_FONDO=1 node bench/clasificacion.mjs        modo «a fondo»
//   SOLO=C101,R101 node bench/clasificacion.mjs   solo esos
//   AJUSTES='{"granular":30}' ...                otros ajustes del optimizador (sisr.js)
//   ETIQUETA="capacidad" ...                       guarda la pasada en bench/resultados/clasificacion.json
/* global process */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { autoScaleFleet, fijarCarretera, generateScenario } from "../src/vrp-engine.js";
import { conMejora } from "../src/scheduling/mejora-rutas.js";
import { SISR } from "../src/scheduling/sisr.js";

const DIR = new URL("./referencia/", import.meta.url);
const leerTxt = f => readFileSync(new URL(f, DIR), "utf8");
const aFondo = !!process.env.A_FONDO;
const solo = process.env.SOLO ? new Set(process.env.SOLO.split(",")) : null;
const esParada = a => !a._travel && !a._break && !a._wait;
// AJUSTES='{"granular":30}': cambia los ajustes del optimizador para probar
if (process.env.AJUSTES) Object.assign(SISR, JSON.parse(process.env.AJUSTES));

// ── Lectura de los problemas ──
function leerVrp(txt) {
  const d = { coord: {}, dem: {}, tw: {}, serv: {}, cab: {} };
  let sec = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.endsWith("SECTION")) { sec = l; continue; }
    if (l === "EOF") break;
    if (!sec && l.includes(":")) { const [k, ...v] = l.split(":"); d.cab[k.trim()] = v.join(":").trim(); continue; }
    const p = l.split(/\s+/).map(Number);
    if (sec === "NODE_COORD_SECTION") d.coord[p[0]] = [p[1], p[2]];
    else if (sec === "DEMAND_SECTION") d.dem[p[0]] = p[1];
    else if (sec === "TIME_WINDOW_SECTION") d.tw[p[0]] = [p[1], p[2]];
    else if (sec === "SERVICE_TIME_SECTION") d.serv[p[0]] = p[1];
    else if (sec === "DEPOT_SECTION" && p[0] !== -1) d.deposito = p[0];
  }
  d.deposito ??= 1;
  d.capacidad = Number(d.cab.CAPACITY) || Infinity;
  d.servicio = Number(d.cab.SERVICE_TIME) || 0;
  return d;
}
const mejorConocida = n => { const m = /Cost\s+([\d.]+)/.exec(leerTxt(`${n}.sol`)); return m ? +m[1] : null; };
const rutasConocidas = n => leerTxt(`${n}.sol`).split(/\r?\n/).filter(l => l.startsWith("Route")).length;
// Solomon con lo que pide el cliente: primero, los menos vehículos; después, los menos km
// (las mejores conocidas así, de la tabla de SINTEF, con la distancia sin recortar: casi la misma)
const POCOS_VEHICULOS = { C101: [10, 828.94], C105: [10, 828.94], R101: [19, 1650.80], R105: [14, 1377.11], R110: [10, 1118.84], R201: [4, 1252.37], RC101: [14, 1696.95], RC105: [13, 1629.44], RC201: [4, 1406.94] };
const OPT_TSP = { berlin52: 7542, eil51: 426, eil76: 538, kroA100: 21282, ch150: 6528, a280: 2579 };

// ── Distancia oficial ──
const euc = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const OFICIAL = { solomon: (a, b) => Math.floor(euc(a, b) * 10) / 10, uchoa: (a, b) => Math.round(euc(a, b)), tsp: (a, b) => Math.round(euc(a, b)) };

// ── Un problema en el motor ──
async function resolver({ coords, deposito, clientes, capacidad, ventanas, servicio, inicio, fin, kmPorUnidad, kmh, vehiculosBase }) {
  // los puntos, en una zona pequeña (la Tierra es casi plana en 20 km)
  const geo = id => ({ lat: 40 + (coords[id][1] * kmPorUnidad) / 111.32, lng: -3 + (coords[id][0] * kmPorUnidad) / (111.32 * Math.cos((40 * Math.PI) / 180)) });
  const clave = p => `${(+p.lat).toFixed(7)},${(+p.lng).toFixed(7)}`;
  const deVuelta = new Map(clientes.map(id => [clave(geo(id)), id]));
  const dep = geo(deposito);
  const tareas = clientes.map(id => ({ id: `n${id}`, nombre: `n${id}`, ...geo(id), duracion: Math.max(servicio(id), 0.001),
    ...(capacidad(id) ? { demanda: capacidad(id) } : {}), ...(ventanas ? { windowStart: ventanas[id][0], windowEnd: ventanas[id][1] } : {}) }));
  const cons = { maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, startMin: inicio, endMin: fin, maxDays: 1, circular: false, optimizeWeight: 0, virtualShiftMin: 0, optimizarAFondo: aFondo, carretera: { factor: 1, kmh, vecinosCompleta: true /* tiempos exactos: sin el margen de seguridad del turno */ } };
  fijarCarretera(cons.carretera);
  const vehs = Array.from({ length: vehiculosBase.n }, (_, i) => ({ _id: `v${i}`, nombre: `V${i}`, turno: "Jornada completa", depotLat: dep.lat, depotLng: dep.lng, ...(vehiculosBase.q < Infinity ? { cargaMax: vehiculosBase.q } : {}) }));
  const t0 = Date.now();
  const r0 = await generateScenario(tareas, vehs, cons);
  const salida = r0.unassigned.length ? await conMejora("autoscale", await autoScaleFleet(tareas, vehs, cons), cons) : { result: await conMejora("generate", r0, cons) };
  const r = salida.result;
  const rutas = r.schedule.map(f => f.assignments.filter(esParada).sort((a, b) => a._start - b._start).map(a => deVuelta.get(clave(a)))).filter(x => x.length);
  return { rutas, sinAsignar: r.unassigned.length, segundos: (Date.now() - t0) / 1000, fases: `mejora ${r.mejora?.seg ?? "-"} s · sisr ${r.sisr?.seg ?? "-"} s (${r.sisr?.vueltas ?? 0} vueltas)` };
}

function medir(rutas, coords, deposito, dist) {
  let total = 0;
  for (const r of rutas) { let prev = deposito; for (const id of [...r, deposito]) { total += dist(coords[prev], coords[id]); prev = id; } }
  return Math.round(total * 10) / 10;
}

/** ¿Cumple la capacidad y las franjas con los tiempos oficiales (trayecto = distancia oficial)? */
function incumplimientos(rutas, d, dist) {
  let n = 0;
  for (const r of rutas) {
    if (d.capacidad < Infinity && r.reduce((s, id) => s + (d.dem[id] || 0), 0) > d.capacidad) n++;
    if (!Object.keys(d.tw).length) continue;
    let t = d.tw[d.deposito][0], prev = d.deposito;
    for (const id of r) {
      t = Math.max(t + dist(d.coord[prev], d.coord[id]), d.tw[id][0]);
      if (t > d.tw[id][1] + 1e-6) { n++; break; }
      t += d.serv[id] ?? d.servicio; prev = id;
    }
  }
  return n;
}

// ── Los problemas ──
const fichas = readdirSync(DIR).filter(f => /\.(vrp|tsp)$/.test(f)).map(f => f.replace(/\.(vrp|tsp)$/, "")).filter(n => !solo || solo.has(n));
const pyvrp = existsSync(new URL("pyvrp.json", DIR)) ? JSON.parse(leerTxt("pyvrp.json")) : {};
const filas = [];
for (const n of fichas) {
  let fila;
  if (OPT_TSP[n]) {
    const txt = leerTxt(`${n}.tsp`);
    const pts = [...txt.split("NODE_COORD_SECTION")[1].matchAll(/^\s*(\d+)\s+([-\d.e+]+)\s+([-\d.e+]+)/gm)].map(m => [+m[2], +m[3]]);
    const coords = Object.fromEntries(pts.map((p, i) => [i + 1, p]));
    const span = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    const res = await resolver({ coords, deposito: 1, clientes: pts.map((_, i) => i + 1).slice(1), capacidad: () => 0, ventanas: null, servicio: () => 1, inicio: 0, fin: 1439, kmPorUnidad: 20 / span, kmh: 30, vehiculosBase: { n: 1, q: Infinity } });
    fila = { problema: n, coleccion: "TSPLIB (orden)", mejor: OPT_TSP[n], rutasMejor: 1, nuestro: medir(res.rutas, coords, 1, OFICIAL.tsp), rutas: res.rutas.length, sinAsignar: res.sinAsignar, incumple: 0, segundos: res.segundos };
  } else {
    const d = leerVrp(leerTxt(`${n}.vrp`));
    const solomon = !n.startsWith("X-");
    const dist = solomon ? OFICIAL.solomon : OFICIAL.uchoa;
    const clientes = Object.keys(d.coord).map(Number).filter(id => id !== d.deposito);
    const totalDem = clientes.reduce((s, id) => s + (d.dem[id] || 0), 0);
    const base = { n: Math.max(1, Math.ceil(totalDem / d.capacidad)), q: d.capacidad };
    const res = solomon
      // Solomon: 1 unidad = 1 minuto de viaje (0,2 km a 12 km/h); franjas y servicio en minutos
      ? await resolver({ coords: d.coord, deposito: d.deposito, clientes, capacidad: id => d.dem[id] || 0, ventanas: d.tw, servicio: id => d.serv[id] ?? d.servicio, inicio: d.tw[d.deposito][0], fin: d.tw[d.deposito][1], kmPorUnidad: 0.2, kmh: 12, vehiculosBase: base })
      // X: sin franjas ni tiempo; la jornada da de sobra
      : await resolver({ coords: d.coord, deposito: d.deposito, clientes, capacidad: id => d.dem[id] || 0, ventanas: null, servicio: () => 0.001, inicio: 0, fin: 1439, kmPorUnidad: 0.02, kmh: 60, vehiculosBase: base });
    fila = { problema: n, coleccion: solomon ? "Solomon (franjas y capacidad)" : "X de Uchoa (capacidad)", mejor: mejorConocida(n), rutasMejor: rutasConocidas(n), nuestro: medir(res.rutas, d.coord, d.deposito, dist), rutas: res.rutas.length, sinAsignar: res.sinAsignar, incumple: incumplimientos(res.rutas, d, dist), segundos: res.segundos, fases: res.fases, pyvrp: pyvrp[n] || null };
  }
  // con los mismos vehículos (o menos) que la mejor de pocos vehículos, se compara con esa
  const pocos = POCOS_VEHICULOS[n];
  fila.mejorKm = fila.mejor;
  if (pocos && fila.rutas <= pocos[0]) { fila.mejor = pocos[1]; fila.rutasMejor = pocos[0]; }
  fila.vehiculosDeMas = pocos ? fila.rutas - pocos[0] : 0;
  fila.gap = +(100 * (fila.nuestro / fila.mejor - 1)).toFixed(2);
  filas.push(fila);
  console.log(`${fila.problema.padEnd(12)} ${String(fila.nuestro).padStart(9)} vs ${String(fila.mejor).padStart(9)} · ${fila.gap >= 0 ? "+" : ""}${fila.gap} %  · ${fila.rutas} rutas (mejor ${fila.rutasMejor}${fila.vehiculosDeMas > 0 ? `; se puede con ${fila.rutas - fila.vehiculosDeMas}` : ""})${fila.sinAsignar ? ` · ${fila.sinAsignar} SIN ASIGNAR` : ""}${fila.incumple ? ` · ${fila.incumple} RUTAS INCUMPLEN` : ""}${fila.pyvrp ? ` · PyVRP ${fila.pyvrp.distancia} (${fila.pyvrp.rutas} rutas)` : ""} · ${fila.segundos.toFixed(1)} s${process.env.FASES && fila.fases ? ` [${fila.fases}]` : ""}`);
}

// ── Resumen por colección ──
const porColeccion = {};
for (const f of filas) (porColeccion[f.coleccion] ||= []).push(f);
console.log("\nMedia de la distancia a la mejor solución conocida:");
for (const [c, fs] of Object.entries(porColeccion)) {
  const media = fs.reduce((s, f) => s + f.gap, 0) / fs.length;
  const conPy = fs.filter(f => f.pyvrp);
  const py = conPy.length ? conPy.reduce((s, f) => s + 100 * (f.pyvrp.distancia / f.mejorKm - 1), 0) / conPy.length : null; // PyVRP busca los menos km, con los vehículos que hagan falta
  console.log(`  ${c}: Operanzia +${media.toFixed(2)} %${py != null ? ` · PyVRP (60 s) +${py.toFixed(2)} %` : ""} · ${fs.filter(f => f.sinAsignar || f.incumple).length} con problemas${fs.some(f => f.vehiculosDeMas > 0) ? ` · ${fs.reduce((s, f) => s + Math.max(0, f.vehiculosDeMas), 0)} vehículos de más en total` : ""}`);
}

if (process.env.ETIQUETA) {
  const dir = new URL("./resultados/", import.meta.url);
  if (!existsSync(dir)) mkdirSync(dir);
  const f = new URL("clasificacion.json", dir);
  const hist = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  hist.push({ etiqueta: process.env.ETIQUETA, fecha: new Date().toISOString(), aFondo, filas });
  writeFileSync(f, JSON.stringify(hist, null, 1));
}
