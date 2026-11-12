// Prueba de carga de líneas: una red real de unos 450 autobuses (corredores
// del GTFS interurbano de Madrid, M89) para probar la app entera con el
// tamaño de un operador grande. Elige corredores hasta llegar a ~450
// autobuses, mide el motor y escribe un GTFS recortado con solo esas líneas.
//
//   node bench/red450.mjs   →  bench/resultados/red450.zip (+ resumen)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { parseGtfsRed } from "../src/gtfs-red.js";
import { generarVehiculos, generarTurnos, gruposTurnos, resumenServicio, PARAMS_DEFECTO } from "../src/lineas-sched.js";

const ORIGEN = "C:/Users/Usuario/Downloads/google_transit_M89.zip";
const OBJETIVO = Number(process.env.AUTOBUSES || 450);

const zip = readFileSync(ORIGEN);
const t0 = performance.now();
const red = await parseGtfsRed(new Blob([zip]));
console.log(`GTFS leído: ${red.lineas.length} líneas en ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const medir = ids => {
  const p = { ...PARAMS_DEFECTO, lineas: ids };
  const a = performance.now();
  const veh = generarVehiculos(red, {}, p);
  const b = performance.now();
  const r = generarTurnos(veh, p, { grupos: gruposTurnos(veh, p) });
  const c = performance.now();
  const res = resumenServicio(r);
  return { viajes: res.viajes, autobuses: res.autobuses, turnos: res.turnos, segVehiculos: +((b - a) / 1000).toFixed(1), segTurnos: +((c - b) / 1000).toFixed(1) };
};

// corredores (dos primeras cifras del nombre), de más a menos líneas, hasta ~450 autobuses
const porCorredor = new Map();
for (const l of red.lineas) { const k = String(l.nombre).slice(0, 2); porCorredor.set(k, [...(porCorredor.get(k) || []), l.id]); }
const corredores = [...porCorredor.entries()].sort((a, b) => b[1].length - a[1].length);
let ids = [], m = null;
for (const [k, lineas] of corredores) {
  const prueba = [...ids, ...lineas];
  const mp = medir(prueba);
  if (mp.autobuses > OBJETIVO * 1.08) continue;
  ids = prueba; m = mp;
  console.log(`+ corredor ${k}x (${lineas.length} líneas) → ${mp.autobuses} autobuses, ${mp.viajes} viajes`);
  if (mp.autobuses >= OBJETIVO * 0.95) break;
}
console.log("Motor (Node):", m);

// GTFS recortado: solo esas líneas (rutas, viajes, horarios, paradas y trazados que usan)
const f = unzipSync(new Uint8Array(zip));
const csv = n => (f[n] ? strFromU8(f[n]) : null);
const filtrar = (texto, col, vale) => {
  const lineas = texto.split(/\r?\n/);
  const cab = lineas[0].replace(/^\uFEFF/, "").split(",").map(s => s.trim().replace(/"/g, ""));
  const i = cab.indexOf(col);
  const quedan = [lineas[0]];
  for (const l of lineas.slice(1)) {
    if (!l) continue;
    const v = l.split(",")[i]?.replace(/"/g, "").trim();
    if (vale(v)) quedan.push(l);
  }
  return { texto: quedan.join("\n") + "\n", valores: new Set(quedan.slice(1).map(l => l.split(",")[i]?.replace(/"/g, "").trim())) };
};
const rutas = new Set(ids.map(String));
const routes = filtrar(csv("routes.txt"), "route_id", v => rutas.has(v));
const trips = filtrar(csv("trips.txt"), "route_id", v => rutas.has(v));
const idsViaje = new Set(trips.texto.split("\n").slice(1).filter(Boolean).map(l => { const cab = csv("trips.txt").split(/\r?\n/)[0].replace(/^\uFEFF/, "").split(",").map(s => s.replace(/"/g, "").trim()); return l.split(",")[cab.indexOf("trip_id")].replace(/"/g, "").trim(); }));
const stopTimes = filtrar(csv("stop_times.txt"), "trip_id", v => idsViaje.has(v));
const cabST = csv("stop_times.txt").split(/\r?\n/)[0].replace(/^\uFEFF/, "").split(",").map(s => s.replace(/"/g, "").trim());
const paradas = new Set(stopTimes.texto.split("\n").slice(1).filter(Boolean).map(l => l.split(",")[cabST.indexOf("stop_id")].replace(/"/g, "").trim()));
const stops = filtrar(csv("stops.txt"), "stop_id", v => paradas.has(v));
const cabT = csv("trips.txt").split(/\r?\n/)[0].replace(/^\uFEFF/, "").split(",").map(s => s.replace(/"/g, "").trim());
const formas = new Set(trips.texto.split("\n").slice(1).filter(Boolean).map(l => l.split(",")[cabT.indexOf("shape_id")]?.replace(/"/g, "").trim()).filter(Boolean));
const salida = {
  "agency.txt": strToU8(csv("agency.txt")),
  "routes.txt": strToU8(routes.texto), "trips.txt": strToU8(trips.texto),
  "stop_times.txt": strToU8(stopTimes.texto), "stops.txt": strToU8(stops.texto),
};
for (const n of ["calendar.txt", "calendar_dates.txt", "feed_info.txt"]) if (f[n]) salida[n] = f[n];
if (f["shapes.txt"]) salida["shapes.txt"] = strToU8(filtrar(csv("shapes.txt"), "shape_id", v => formas.has(v)).texto);
mkdirSync("bench/resultados", { recursive: true });
const out = zipSync(salida, { level: 6 });
writeFileSync("bench/resultados/red450.zip", out);
writeFileSync("bench/resultados/red450.json", JSON.stringify({ lineas: ids.length, ...m, zipMB: +(out.length / 1e6).toFixed(1) }, null, 1));
console.log(`GTFS recortado: ${ids.length} líneas, ${(out.length / 1e6).toFixed(1)} MB → bench/resultados/red450.zip`);
