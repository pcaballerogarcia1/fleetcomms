// ── Lanzar el motor de rutas en segundo plano (ver vrp-worker.js) ─────
// Misma interfaz que generateScenario / autoScaleFleet de vrp-engine.js,
// pero el cálculo corre en un Web Worker y la pantalla no se congela.
// Un worker por cálculo, que se cierra al terminar (libera su memoria).
// Sin soporte de Workers (entorno de pruebas), se ejecuta aquí mismo.
import { generateScenario, autoScaleFleet, fijarCarretera } from "./vrp-engine.js";
import { medirCarretera } from "./scheduling/carretera.js";
import { generarRutaMaestra } from "./scheduling/frecuencias.js";
import { conMejora } from "./scheduling/mejora-rutas.js";

// Si quien llama no ha medido la carretera de la zona, se mide aquí (no en las pruebas)
async function conCarretera(args) {
  const c = args[2] || {};
  if (c.carretera !== undefined || import.meta.env?.MODE === "test") return args;
  const m = await medirCarretera([...(args[0] || []), ...(args[1] || []).map(v => ({ lat: v.depotLat, lng: v.depotLng }))]).catch(() => null);
  return [args[0], args[1], { ...c, carretera: m?.medido ? m : null }, ...args.slice(3)];
}

async function runInWorker(op, argsSinCarretera, onProgress) {
  const args = await conCarretera(argsSinCarretera);
  fijarCarretera(args[2]?.carretera); // la pantalla (capacidad, cambios a mano) con el mismo modelo
  if (typeof Worker === "undefined") {
    if (op === "maestra") return generarRutaMaestra(...args, generateScenario);
    return (op === "generate" ? generateScenario(...args) : autoScaleFleet(...args, onProgress)).then(r => conMejora(op, r, args[2]));
  }
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./vrp-worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.progress) { onProgress?.(data.progress); return; }
      w.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    w.onerror = e => {
      w.terminate();
      reject(new Error(e.message || "Error en el cálculo del escenario"));
    };
    w.postMessage({ op, args });
  });
}

export const generateScenarioBg = (tasks, resources, constraints) =>
  runInWorker("generate", [tasks, resources, constraints]);
export const autoScaleFleetBg = (tasks, resources, constraints, onProgress) =>
  runInWorker("autoscale", [tasks, resources, constraints], onProgress);
// Ruta maestra semanal (scheduling/frecuencias.js): cada vehículo en su zona, día a día
export const rutaMaestraBg = (tasks, resources, constraints) =>
  runInWorker("maestra", [tasks, resources, constraints]);
