// Analytics de líneas · análisis de tiempos reales («runtime analysis»): con
// lo que Control ha anotado de cada expedición (salida y llegada reales), el
// tiempo de verdad por línea, sentido y franja, frente al previsto, y la
// puntualidad de salida. Sin React ni Firebase.
import { franjaDe, FRANJAS } from "./gtfs-red.js";

const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const percentil = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

export const PUNTUAL = { antes: 1, despues: 3 }; // sale como mucho 1 min antes o 3 después

/**
 * @param turnos [{ viajes: [{ k, lid, l, dir, s, dep, arr, v }], real: { salidas, llegadas } }] (de varios días)
 * @returns { filas: [{ clave, lid, linea, dir, sentido, franja, n, salidas, previsto, real, p85, diferencia, puntualidad, retrasoMedio }], totales }
 */
export function analizarTiempos(turnos) {
  const grupos = new Map();
  let viajesMedidos = 0, salidasMedidas = 0, puntuales = 0;
  for (const t of turnos || []) {
    const sal = t.real?.salidas || {}, lle = t.real?.llegadas || {};
    for (const v of t.viajes || []) {
      if (v.v) continue; // los vacíos no
      const s = sal[v.k], l = lle[v.k];
      if (s == null) continue;
      const clave = `${v.lid}|${v.dir}|${franjaDe(v.dep)}`;
      if (!grupos.has(clave)) grupos.set(clave, { clave, lid: v.lid, linea: v.l, dir: v.dir, sentido: v.s || (v.dir ? "Vuelta" : "Ida"), franja: franjaDe(v.dep), previstos: [], reales: [], retrasos: [] });
      const g = grupos.get(clave);
      const retraso = s - v.dep;
      g.retrasos.push(retraso); salidasMedidas++;
      if (retraso >= -PUNTUAL.antes && retraso <= PUNTUAL.despues) puntuales++;
      if (l != null && l > s) { g.reales.push(l - s); g.previstos.push(v.arr - v.dep); viajesMedidos++; }
    }
  }
  const orden = new Map(FRANJAS.map((f, i) => [f.id, i]));
  const filas = [...grupos.values()].map(g => {
    const real = mediana(g.reales), previsto = mediana(g.previstos);
    const enHora = g.retrasos.filter(r => r >= -PUNTUAL.antes && r <= PUNTUAL.despues).length;
    return {
      clave: g.clave, lid: g.lid, linea: g.linea, dir: g.dir, sentido: g.sentido, franja: g.franja,
      n: g.reales.length, salidas: g.retrasos.length,
      previsto: previsto == null ? null : Math.round(previsto), real: real == null ? null : Math.round(real), p85: percentil(g.reales, 85),
      diferencia: real == null || previsto == null ? null : Math.round(real - previsto),
      puntualidad: g.retrasos.length ? enHora / g.retrasos.length : null,
      retrasoMedio: g.retrasos.length ? Math.round((g.retrasos.reduce((a, b) => a + b, 0) / g.retrasos.length) * 10) / 10 : null,
    };
  }).sort((a, b) => String(a.linea).localeCompare(String(b.linea), "es", { numeric: true }) || a.dir - b.dir || orden.get(a.franja) - orden.get(b.franja));
  return { filas, totales: { viajesMedidos, salidasMedidas, puntualidad: salidasMedidas ? puntuales / salidasMedidas : null } };
}
