// Scheduling de puntos → la carretera REAL entre paradas vecinas.
// Lo que decide el orden de una ruta son los trayectos cortos: de cada parada
// a sus vecinas. Se piden a OSRM (el callejero de OpenStreetMap, con sus
// sentidos únicos; gratis) en tablas de hasta 90 puntos cercanos, dos veces
// con grupos distintos para cubrir los bordes, y de cada punto se guardan los
// km por carretera a sus 30 vecinos más cercanos. El motor los usa tal cual
// (fijarCarretera) y, para lo demás, la medida de la zona (carretera.js).
// Se guarda en este ordenador: la segunda vez es inmediata.
import { claveCoord, haversineKm, hasCoords } from "../vrp-engine.js";

const OSRM = "https://router.project-osrm.org/table/v1/driving";
export const VECINOS = { k: 30, grupo: 90, pausaMs: 1100 };

/** Grupos de puntos cercanos de hasta `tam` (partiendo por la mitad por el lado más largo) */
export function gruposCercanos(pts, tam = VECINOS.grupo, empezarPorLng = true) {
  const out = [];
  const partir = (lista, porLng) => {
    if (lista.length <= tam) { out.push(lista); return; }
    const lats = lista.map(p => p.lat), lngs = lista.map(p => p.lng);
    const anchoLng = (Math.max(...lngs) - Math.min(...lngs)) * Math.cos((lats[0] * Math.PI) / 180), altoLat = Math.max(...lats) - Math.min(...lats);
    const eje = porLng === null ? (anchoLng >= altoLat ? "lng" : "lat") : porLng ? "lng" : "lat";
    const o = [...lista].sort((a, b) => a[eje] - b[eje]);
    const m = Math.floor(o.length / 2);
    partir(o.slice(0, m), null); partir(o.slice(m), null);
  };
  partir(pts, empezarPorLng);
  return out;
}

/** Huella de un conjunto de puntos (para guardarlo en este ordenador) */
export function huellaPuntos(pts) {
  let h = 2166136261;
  for (const k of pts.map(p => claveCoord(p.lat, p.lng)).sort((a, b) => a - b)) { h ^= k % 4294967291; h = Math.imul(h, 16777619) >>> 0; }
  return `${pts.length}_${h.toString(36)}`;
}

/**
 * Los km por carretera de cada punto a sus vecinos más cercanos.
 * @returns { vecinos: Map<clave, Map<clave, km>>, pares, peticiones, maxKm } (maxKm: hasta dónde llegan, en línea recta)
 */
export async function vecinosPorCarretera(puntos, { fetchFn = (...a) => fetch(...a), k = VECINOS.k, grupo = VECINOS.grupo, pausaMs = VECINOS.pausaMs, onProgreso } = {}) {
  const vistos = new Set(), pts = [];
  for (const p of puntos || []) {
    if (!hasCoords(p.lat, p.lng)) continue;
    const c = claveCoord(p.lat, p.lng);
    if (!vistos.has(c)) { vistos.add(c); pts.push({ lat: +p.lat, lng: +p.lng, c }); }
  }
  // las distancias por carretera conseguidas: de cada punto, a los de sus grupos (y solo
  // las de sus k vecinos más cercanos, para no llenar la memoria con miles de puntos)
  const road = new Map(pts.map(p => [p.c, new Map()]));
  const porClave = new Map(pts.map(p => [p.c, p]));
  const recortar = () => {
    for (const p of pts) {
      const m = road.get(p.c);
      if (m.size <= k) continue;
      const quedan = [...m.entries()].map(([c, km]) => ({ c, km, d: haversineKm(p.lat, p.lng, porClave.get(c).lat, porClave.get(c).lng) })).sort((a, b) => a.d - b.d).slice(0, k);
      road.set(p.c, new Map(quedan.map(x => [x.c, x.km])));
    }
  };
  const pasadas = [gruposCercanos(pts, grupo, true), gruposCercanos(pts, grupo, false)].map(gs => gs.filter(g => g.length > 1));
  const total = pasadas.reduce((s, gs) => s + gs.length, 0);
  let peticiones = 0, n = 0;
  for (const [pasada, gs] of pasadas.entries()) {
    if (pasada) recortar();
    for (const g of gs) {
      onProgreso?.(++n, total);
      if (n > 1 && pausaMs) await new Promise(r => setTimeout(r, pausaMs)); // el servicio gratuito pide calma
      let j = null;
      for (let intento = 0; intento < 3 && !j; intento++) {
        try {
          const r = await fetchFn(`${OSRM}/${g.map(p => `${p.lng},${p.lat}`).join(";")}?annotations=distance`);
          const x = await r.json();
          if (x?.code === "Ok" && x.distances) j = x;
          else await new Promise(res => setTimeout(res, 2000 * (intento + 1)));
        } catch { await new Promise(res => setTimeout(res, 2000 * (intento + 1))); }
      }
      peticiones++;
      if (!j) continue;
      g.forEach((a, i) => g.forEach((b, q) => { const km = j.distances[i]?.[q]; if (i !== q && km != null) road.get(a.c).set(b.c, km / 1000); }));
    }
  }
  // de cada punto, sus k vecinos más cercanos (en línea recta) que tengan carretera medida
  const vecinos = new Map();
  let pares = 0, maxKm = 0;
  for (const p of pts) {
    const cand = [...road.get(p.c).entries()].map(([c, km]) => ({ c, km, d: haversineKm(p.lat, p.lng, porClave.get(c).lat, porClave.get(c).lng) })).sort((a, b) => a.d - b.d).slice(0, k);
    if (!cand.length) continue;
    vecinos.set(p.c, new Map(cand.map(x => [x.c, Math.round(x.km * 1000) / 1000])));
    pares += cand.length;
    maxKm = Math.max(maxKm, cand[cand.length - 1].d);
  }
  return { vecinos, pares, peticiones, maxKm };
}

