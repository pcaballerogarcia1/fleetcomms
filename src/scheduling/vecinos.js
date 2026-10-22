// Scheduling de puntos → la carretera REAL entre paradas.
// Lo que decide el orden de una ruta son los trayectos cortos: de cada parada
// a sus vecinas. Se piden a OSRM (el callejero de OpenStreetMap, con sus
// sentidos únicos; gratis) los km y los minutos reales:
//  · zonas de hasta 350 sitios: la tabla completa (de cada sitio a todos);
//  · zonas mayores: en tablas de hasta 90 puntos cercanos, dos veces con
//    grupos distintos para cubrir los bordes, y de cada punto se guardan sus
//    30 vecinos más cercanos.
// El motor los usa tal cual (fijarCarretera: vecinos y tiempos) y, para lo
// demás, la medida de la zona (carretera.js). Se guarda en este ordenador: la
// segunda vez es inmediata.
import { claveCoord, haversineKm, hasCoords } from "../vrp-engine.js";

const OSRM = "https://router.project-osrm.org/table/v1/driving";
export const VECINOS = { k: 30, grupo: 90, pausaMs: 1100, completaHasta: 350, bloque: 50 };
const CAMION = 0.8; // un camión de servicio va al 80 % de la velocidad de un coche (como carretera.js)

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
 * Los km y los minutos (de camión) por carretera entre los puntos: todos con
 * todos si son pocos; si no, de cada uno a sus vecinos más cercanos.
 * @returns { vecinos: Map<clave, Map<clave, km>>, tiempos: Map<clave, Map<clave, min>>, pares, peticiones, maxKm, completa }
 *   (maxKm: hasta dónde llegan, en línea recta; Infinity si es completa)
 */
export async function vecinosPorCarretera(puntos, { fetchFn = (...a) => fetch(...a), k = VECINOS.k, grupo = VECINOS.grupo, pausaMs = VECINOS.pausaMs, completaHasta = VECINOS.completaHasta, onProgreso } = {}) {
  const vistos = new Set(), pts = [];
  for (const p of puntos || []) {
    if (!hasCoords(p.lat, p.lng)) continue;
    const c = claveCoord(p.lat, p.lng);
    if (!vistos.has(c)) { vistos.add(c); pts.push({ lat: +p.lat, lng: +p.lng, c }); }
  }
  const completa = pts.length <= completaHasta;
  // lo conseguido: de cada punto, [km, minutos] a otros
  const road = new Map(pts.map(p => [p.c, new Map()]));
  const porClave = new Map(pts.map(p => [p.c, p]));
  const recortar = () => {
    if (completa) return;
    for (const p of pts) {
      const m = road.get(p.c);
      if (m.size <= k) continue;
      const quedan = [...m.entries()].map(([c, v]) => ({ c, v, d: haversineKm(p.lat, p.lng, porClave.get(c).lat, porClave.get(c).lng) })).sort((a, b) => a.d - b.d).slice(0, k);
      road.set(p.c, new Map(quedan.map(x => [x.c, x.v])));
    }
  };
  // las peticiones: { origen: [puntos], destino: [puntos] }
  const pasadas = [];
  if (completa) {
    const B = VECINOS.bloque, bloques = [];
    for (let i = 0; i < pts.length; i += B) bloques.push(pts.slice(i, i + B));
    pasadas.push(bloques.flatMap(a => bloques.map(b => ({ origen: a, destino: b }))));
  } else {
    for (const g of [gruposCercanos(pts, grupo, true), gruposCercanos(pts, grupo, false)]) pasadas.push(g.filter(x => x.length > 1).map(x => ({ origen: x, destino: x })));
  }
  const total = pasadas.reduce((s, ps) => s + ps.length, 0);
  let peticiones = 0, n = 0;
  for (const [pasada, ps] of pasadas.entries()) {
    if (pasada) recortar();
    for (const { origen, destino } of ps) {
      onProgreso?.(++n, total);
      if (n > 1 && pausaMs) await new Promise(r => setTimeout(r, pausaMs)); // el servicio gratuito pide calma
      const todos = origen === destino ? origen : [...origen, ...destino.filter(p => !origen.includes(p))];
      const pos = new Map(todos.map((p, i) => [p, i]));
      const consulta = origen === destino ? "" : `&sources=${origen.map(p => pos.get(p)).join(";")}&destinations=${destino.map(p => pos.get(p)).join(";")}`;
      let j = null;
      for (let intento = 0; intento < 3 && !j; intento++) {
        try {
          const r = await fetchFn(`${OSRM}/${todos.map(p => `${p.lng},${p.lat}`).join(";")}?annotations=distance,duration${consulta}`);
          const x = await r.json();
          if (x?.code === "Ok" && x.distances && x.durations) j = x;
          else await new Promise(res => setTimeout(res, 2000 * (intento + 1)));
        } catch { await new Promise(res => setTimeout(res, 2000 * (intento + 1))); }
      }
      peticiones++;
      if (!j) continue;
      origen.forEach((a, i) => destino.forEach((b, q) => {
        const km = j.distances[i]?.[q], s = j.durations[i]?.[q];
        if (a !== b && km != null && s != null) road.get(a.c).set(b.c, [km / 1000, s / 60 / CAMION]);
      }));
    }
  }
  // de cada punto, sus vecinos (todos si es completa; si no, los k más cercanos en línea recta)
  const vecinos = new Map(), tiempos = new Map();
  let pares = 0, maxKm = 0;
  for (const p of pts) {
    let cand = [...road.get(p.c).entries()].map(([c, v]) => ({ c, v, d: haversineKm(p.lat, p.lng, porClave.get(c).lat, porClave.get(c).lng) }));
    if (!completa) cand = cand.sort((a, b) => a.d - b.d).slice(0, k);
    if (!cand.length) continue;
    vecinos.set(p.c, new Map(cand.map(x => [x.c, Math.round(x.v[0] * 1000) / 1000])));
    tiempos.set(p.c, new Map(cand.map(x => [x.c, Math.round(x.v[1] * 1000) / 1000])));
    pares += cand.length;
    for (const x of cand) if (x.d > maxKm) maxKm = x.d;
  }
  return { vecinos, tiempos, pares, peticiones, maxKm: completa ? Infinity : maxKm, completa };
}
