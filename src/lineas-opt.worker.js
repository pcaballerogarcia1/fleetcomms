// Cálculos largos del Scheduling de líneas fuera del hilo de la pantalla: con
// redes grandes (Roma: ~39.000 viajes) son decenas de pasadas del cálculo.
//  · { tipo: "vehiculos" | "turnos", red, cfg, cocheras, params, objetivo } → optimiza un paso de un calendario
//  · { tipo: "grupos", red, cfg, cocheras, params, opsV } → la partición de turnos de un
//    calendario (grupos de claves de pieza): «Generar turnos» sin congelar la pantalla
//  · { tipo: "lote", red, cfg, cocheras, params, dias: [{ dia, estrategia }], optimizar, objetivoVehiculos, objetivoTurnos }
//    → calcula (u optimiza, los dos pasos) varios calendarios y manda el
//      resumen de cada uno según termina
import { optimizarVehiculos, optimizarTurnos, generarVehiculos, generarTurnos, gruposTurnos, aplicarCambios, resumenServicio, CAMPOS_ESTRATEGIA, PARAMS_DEFECTO, esCambioVehiculos, esCambioTurnos } from "./lineas-sched.js";

self.onmessage = e => {
  const { tipo, red, cfg, params, objetivo, cocheras = [] } = e.data;
  try {
    if (tipo === "grupos") {
      // los mismos vehículos que en la pantalla (con sus cambios a mano) y su partición
      const veh = aplicarCambios(generarVehiculos(red, cfg, params, { cocheras }), e.data.opsV || []).res;
      self.postMessage({ ok: gruposTurnos(veh, params) });
      return;
    }
    if (tipo === "lote") {
      const { dias, optimizar, objetivoVehiculos, objetivoTurnos } = e.data;
      // params.entreLineas es la restricción; la estrategia de cada calendario solo puede quitarlo
      dias.forEach(({ dia, estrategia = {}, manuales = [] }, i) => {
        self.postMessage({ progreso: [i, dias.length], dia });
        let q = { ...params, ...estrategia, dia, entreLineas: params.entreLineas && (estrategia.entreLineas ?? true) };
        let optimizado = false;
        if (optimizar) {
          const v = optimizarVehiculos(red, cfg, { ...params, dia }, { objetivo: objetivoVehiculos, cocheras }).probadas[0];
          q = { ...params, dia, ...(v?.estrategia || {}) };
          const t = optimizarTurnos(red, cfg, q, { objetivo: objetivoTurnos, cocheras }).probadas[0];
          q = { ...q, ...(t?.estrategia || {}) };
          optimizado = true;
        }
        // los cambios a mano del calendario (si no se optimiza), en su paso
        const ops = optimizar ? [] : manuales;
        const v = aplicarCambios(generarVehiculos(red, cfg, q, { cocheras }), ops.filter(esCambioVehiculos));
        const t = aplicarCambios(generarTurnos(v.res), ops.filter(esCambioTurnos));
        const fallidos = [...v.fallidos, ...t.fallidos];
        const est = Object.fromEntries(CAMPOS_ESTRATEGIA.map(k => [k, q[k] ?? PARAMS_DEFECTO[k]]));
        const aplicados = ops.filter(o => !fallidos.some(f => f.clave === o.clave && f.tipo === o.tipo && f.destino === o.destino));
        self.postMessage({ hecho: { dia, estrategia: est, resumen: resumenServicio(t.res), optimizado, manuales: aplicados } });
      });
      self.postMessage({ fin: true });
      return;
    }
    let ultimo = 0;
    const onProgreso = (k, n) => { const ahora = Date.now(); if (k === n || ahora - ultimo > 150) { ultimo = ahora; self.postMessage({ progreso: [k, n] }); } };
    const r = tipo === "turnos"
      ? optimizarTurnos(red, cfg, params, { objetivo, cocheras, onProgreso })
      : optimizarVehiculos(red, cfg, params, { objetivo, cocheras, onProgreso });
    self.postMessage({ ok: r });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
