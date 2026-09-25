// ── Lanzar el motor de rutas en segundo plano (ver vrp-worker.js) ─────
// Misma interfaz que generateScenario / autoScaleFleet de vrp-engine.js,
// pero el cálculo corre en un Web Worker y la pantalla no se congela.
// Un worker por cálculo, que se cierra al terminar (libera su memoria).
// Sin soporte de Workers (entorno de pruebas), se ejecuta aquí mismo.
import { generateScenario, autoScaleFleet } from "./vrp-engine.js";

function runInWorker(op, args, onProgress) {
  if (typeof Worker === "undefined") {
    return op === "generate" ? generateScenario(...args) : autoScaleFleet(...args, onProgress);
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
