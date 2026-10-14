// Banco de pruebas del motor de líneas: redes reales del Consorcio de
// Transportes de Madrid (GTFS en Descargas), agrupadas por empresa como las
// tendría un cliente. Para cada una, el escenario del día laborable tal y como
// sale con «Generar» (vehículos + turnos por partición) y sus números:
// autobuses, km en vacío, turnos, horas pagadas, coste orientativo y tiempo.
// También unas cotas (lo mínimo posible) para saber cuánto margen queda.
//
//   npx vitest run -c bench/vitest.config.js bench/lineas.bench.test.js
//   BENCH_ETIQUETA="nombre" para guardar la pasada con nombre en bench/resultados/lineas.json
//   BENCH_A_FONDO=1 los turnos «a fondo» (tarda varios minutos con la red entera de M89)
/* global process */
import { test } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseGtfsRed } from "../src/gtfs-red.js";
import { generarVehiculos, generarTurnos, gruposTurnos, resumenServicio, costeDia, preciosTotal, PARAMS_DEFECTO } from "../src/lineas-sched.js";

const DESCARGAS = "C:/Users/Usuario/Downloads/";
const REDES = [["M9", "google_transit_M9.zip"], ["M89", "google_transit_M89.zip"]];

/** Grupos de líneas del tamaño de un operador: por empresa si el GTFS trae
 *  varias; si no (el Consorcio las publica todas juntas), por corredor (las
 *  dos primeras cifras: 48x = Leganés). Más la red entera, como prueba de carga. */
function grupos(red, prefijos) {
  const empresas = new Set(red.lineas.map(l => l.agencia));
  const out = [];
  if (empresas.size > 1) for (const a of empresas) out.push({ a, ids: red.lineas.filter(l => l.agencia === a).map(l => l.id) });
  for (const pre of prefijos) {
    const ids = red.lineas.filter(l => String(l.nombre).startsWith(pre)).map(l => l.id);
    if (ids.length) out.push({ a: `corredor ${pre}x`, ids });
  }
  out.push({ a: "red entera", ids: red.lineas.map(l => l.id) });
  return out;
}
const nombreAgencia = (red, a) => red.agencias?.find?.(x => x.id === a)?.nombre || red.agencias?.[a]?.nombre || a;

// cuántos viajes hay en marcha a la vez como mucho (ningún reparto baja de ahí)
function picoExacto(viajes) {
  const ev = viajes.flatMap(v => [[v.dep, 1], [v.arr, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, max = 0;
  for (const [, d] of ev) { c += d; if (c > max) max = c; }
  return max;
}

export function medir(red, ids, extra = {}) {
  const p = { ...PARAMS_DEFECTO, lineas: ids, ...extra };
  const t0 = performance.now();
  const veh = generarVehiculos(red, {}, p);
  const t1 = performance.now();
  const grupos = gruposTurnos(veh, p);
  const r = generarTurnos(veh, p, { grupos });
  const t2 = performance.now();
  const res = resumenServicio(r);
  const precios = { ...p, ...preciosTotal(p) };
  const picoViajes = picoExacto(r.viajes);
  const minEnLinea = r.vehiculos.reduce((s, v) => s + (v.fin - v.inicio), 0);
  return {
    viajes: res.viajes, autobuses: res.autobuses, cotaAutobuses: picoViajes,
    kmVacio: Math.round(res.kmVacio), turnos: res.turnos, cotaTurnos: Math.ceil(minEnLinea / (p.jornadaMax || 480)),
    horasPagadas: Math.round(res.horasPagadas), avisos: res.avisos,
    coste: Math.round(costeDia(res, precios) || 0),
    segVehiculos: +((t1 - t0) / 1000).toFixed(1), segTurnos: +((t2 - t1) / 1000).toFixed(1),
  };
}

test("motor de líneas con redes reales", async () => {
  const filas = [];
  for (const [nombre, archivo] of REDES) {
    if (!existsSync(DESCARGAS + archivo)) { console.log(`(sin ${archivo})`); continue; }
    const red = await parseGtfsRed(new Blob([readFileSync(DESCARGAS + archivo)]));
    for (const e of grupos(red, nombre === "M89" ? ["48", "46", "52", "62"] : [])) {
      const m = medir(red, e.ids, process.env.BENCH_A_FONDO ? { optimizarAFondo: true } : {});
      filas.push({ red: nombre, grupo: String(nombreAgencia(red, e.a)).slice(0, 28), lineas: e.ids.length, ...m });
      console.log(JSON.stringify(filas.at(-1)));
    }
  }
  console.table(filas);
  mkdirSync("bench/resultados", { recursive: true });
  const f = "bench/resultados/lineas.json";
  const hist = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  hist.push({ etiqueta: process.env.BENCH_ETIQUETA || "sin nombre", fecha: new Date().toISOString(), filas });
  writeFileSync(f, JSON.stringify(hist, null, 1));
});
