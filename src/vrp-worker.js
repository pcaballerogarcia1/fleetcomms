// ── Motor de rutas en un hilo aparte (Web Worker) ────────────────────
// El cálculo de un escenario grande dura minutos y, en el hilo de la
// pantalla, la congelaba a tramos (medido: hasta ~0,6 s seguidos en un PC
// rápido con 44.000 paradas y 1 día; varios segundos en uno normal → "la
// página no responde"). Aquí corre el MISMO motor (vrp-engine.js, sin
// cambios) y la pantalla sigue respondiendo mientras tanto.
// Mensajes: { op: "generate" | "autoscale", args } → { progress } * → { result } | { error }
import { generateScenario, autoScaleFleet } from "./vrp-engine.js";

self.onmessage = async ({ data }) => {
  const { op, args } = data;
  try {
    let result;
    if (op === "generate") result = await generateScenario(...args);
    else if (op === "autoscale") result = await autoScaleFleet(...args, progress => self.postMessage({ progress }));
    else throw new Error(`operación desconocida: ${op}`);
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
