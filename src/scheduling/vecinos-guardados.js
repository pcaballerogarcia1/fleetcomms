// La tabla de la carretera real entre paradas vecinas (vecinos.js), guardada en
// este ordenador (IndexedDB): se calcula una vez por conjunto de puntos.
import { hasCoords } from "../vrp-engine.js";
import { localGet, localPut } from "../layer-store.js";
import { huellaPuntos, vecinosPorCarretera } from "./vecinos.js";

/**
 * La tabla de vecinos de esos puntos: la guardada en este ordenador o, si no
 * hay, la calcula y la guarda. @returns { vecinos, pares, maxKm, huella } | null
 */
export async function cargarVecinos(puntos, onProgreso) {
  const pts = (puntos || []).filter(p => hasCoords(p.lat, p.lng));
  if (pts.length < 3) return null;
  const huella = huellaPuntos(pts);
  const guardada = await leerVecinos(huella);
  if (guardada) return guardada;
  try {
    const r = await vecinosPorCarretera(pts, { onProgreso });
    if (!r.pares) return null;
    await localPut(`vecinos_${huella}`, { vecinos: r.vecinos, pares: r.pares, maxKm: r.maxKm });
    return { ...r, huella };
  } catch { return null; }
}
/** La tabla guardada en este ordenador (por la huella de los puntos) o null */
export async function leerVecinos(huella) {
  if (!huella) return null;
  const g = await localGet(`vecinos_${huella}`).catch(() => null);
  return g?.vecinos instanceof Map && g.vecinos.size ? { ...g, huella } : null;
}
