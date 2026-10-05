// Cálculos largos del Scheduling de líneas fuera del hilo de la pantalla: con
// redes grandes (Roma: ~39.000 viajes) son decenas de pasadas del cálculo.
//  · { red, cfg, params, objetivo } → optimiza un calendario
//  · { tipo: "lote", red, cfg, params, dias: [{ dia, estrategia }], optimizar, objetivo }
//    → calcula (u optimiza) varios calendarios, uno detrás de otro, y manda
//      el resumen de cada uno según termina
import { optimizarServicio, generarServicio, resumenServicio, CAMPOS_ESTRATEGIA, PARAMS_DEFECTO } from "./lineas-sched.js";

self.onmessage = e => {
  const { tipo, red, cfg, params, objetivo, cocheras = [] } = e.data;
  try {
    if (tipo === "lote") {
      const { dias, optimizar } = e.data;
      // params.entreLineas es la restricción; la estrategia de cada calendario solo puede quitarlo
      dias.forEach(({ dia, estrategia = {} }, i) => {
        self.postMessage({ progreso: [i, dias.length], dia });
        let q = { ...params, ...estrategia, dia, entreLineas: params.entreLineas && (estrategia.entreLineas ?? true) };
        let optimizado = false;
        if (optimizar) {
          const mejor = optimizarServicio(red, cfg, { ...params, dia }, { objetivo, cocheras }).probadas[0];
          if (mejor) { q = { ...params, dia, ...mejor.estrategia }; optimizado = true; }
        }
        const res = generarServicio(red, cfg, q, { cocheras });
        const est = Object.fromEntries(CAMPOS_ESTRATEGIA.map(k => [k, q[k] ?? PARAMS_DEFECTO[k]]));
        self.postMessage({ hecho: { dia, estrategia: est, resumen: resumenServicio(res), optimizado } });
      });
      self.postMessage({ fin: true });
      return;
    }
    let ultimo = 0;
    const r = optimizarServicio(red, cfg, params, {
      objetivo, cocheras,
      onProgreso: (k, n) => { const ahora = Date.now(); if (k === n || ahora - ultimo > 150) { ultimo = ahora; self.postMessage({ progreso: [k, n] }); } },
    });
    self.postMessage({ ok: r });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
