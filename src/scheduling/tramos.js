// Scheduling de puntos · trozos de ruta resumidos en unos pocos números
// (Vidal y otros, 2013: «A hybrid genetic algorithm with adaptive diversity
// management for a large class of vehicle routing problems with time-windows»).
// Cada trozo de ruta (una parada, el principio de una ruta, el final…) se
// resume en: lo que tarda (D), cuánto llega tarde a alguna franja (TW), la
// hora más temprana (E) y la más tardía (L) a la que puede empezar sin esperar
// de más ni llegar tarde, y lo que conduce, los km, la carga y las paradas.
// Dos trozos se juntan en un momento, sin rehacer la ruta: así, para saber si
// una parada cabe en un hueco, o si dos rutas pueden cambiarse sus colas, basta
// con juntar tres trozos ya calculados en vez de rehacer las horas de toda la
// ruta. Da lo mismo que rehacer la ruta parada a parada (simular de
// mejora-rutas.js) cuando no hay pausas ni relevos.
// Sin React ni Firebase.

/** Holgura con la que se aceptan las franjas (minutos): queda del lado seguro al rehacer las horas */
export const HOLGURA = 1e-3;
const CASI = 1e-7;

/**
 * Las herramientas para un juego de tiempos entre sitios.
 * @param tt (a, b) → minutos del sitio a al b (0 si alguno es -1 o son el mismo)
 * @param tk (a, b) → km
 */
export function crearTramos(tt, tk) {
  /** Junta dos trozos: primero a y después b */
  function unir(a, b) {
    const t = tt(a.l, b.f);
    const delta = a.D - a.TW + t;
    const espera = Math.max(b.E - delta - a.L, 0);
    const tarde = Math.max(a.E + delta - b.L, 0);
    return {
      f: a.f, l: b.l,
      D: a.D + b.D + t + espera,
      TW: a.TW + b.TW + tarde,
      E: Math.max(b.E - delta, a.E) - espera,
      L: Math.min(b.L - delta, a.L) + tarde,
      tr: a.tr + b.tr + t,
      km: a.km + b.km + tk(a.l, b.f),
      q: a.q + b.q,
      c: a.c + b.c,
    };
  }
  /** Una parada en el sitio s, que tarda dur, con su franja [desde, hasta] (o sin franja) */
  const parada = (s, dur, desde, hasta, q, c) => ({
    f: s, l: s, D: dur, TW: 0,
    E: desde == null ? -Infinity : desde, L: desde == null ? Infinity : hasta - HOLGURA,
    tr: 0, km: 0, q, c,
  });
  /** La salida: del sitio s a la hora ini en punto (se cuenta desde ahí) */
  const salida = (s, ini) => ({ f: s, l: s, D: 0, TW: 0, E: ini, L: ini, tr: 0, km: 0, q: 0, c: 0 });
  /** La llegada: al sitio s antes de la hora fin */
  const llegada = (s, fin) => ({ f: s, l: s, D: 0, TW: 0, E: -Infinity, L: fin - HOLGURA, tr: 0, km: 0, q: 0, c: 0 });
  /** ¿Llega a tiempo a todo? */
  const aTiempo = x => x.TW <= CASI;
  return { unir, parada, salida, llegada, aTiempo };
}
