// Optimizar el Scheduling de líneas fuera del hilo de la pantalla: con
// redes grandes (Roma: ~39.000 viajes) son decenas de pasadas del cálculo.
import { optimizarServicio } from "./lineas-sched.js";

self.onmessage = e => {
  const { red, cfg, params, objetivo } = e.data;
  try {
    let ultimo = 0;
    const r = optimizarServicio(red, cfg, params, {
      objetivo,
      onProgreso: (k, n) => { const ahora = Date.now(); if (k === n || ahora - ultimo > 150) { ultimo = ahora; self.postMessage({ progreso: [k, n] }); } },
    });
    self.postMessage({ ok: r });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
