// Scheduling de puntos → cómo es la carretera en la zona.
// El motor de rutas mide en línea recta (rápido, sirve para miles de puntos).
// Antes de optimizar se miden con OSRM unos cientos de trayectos reales entre
// puntos de la propia zona (una sola petición) y se sacan:
//  · el factor de rodeo: cuánto más larga es la carretera que la línea recta;
//  · la velocidad: la de los trayectos cortos (de una parada a la siguiente),
//    un poco más lenta que la de un coche (un camión que para y arranca).
// El motor usa los dos (fijarCarretera): distancias y tiempos de carretera.
// Si OSRM no responde, sigue como antes (línea recta a 30 km/h) y se dice.
import { haversineKm, hasCoords } from "../vrp-engine.js";

const OSRM = "https://router.project-osrm.org/table/v1/driving";
export const CARRETERA = {
  muestra: 40,        // puntos medidos (40 × 40 = 1.560 trayectos en una petición)
  grupos: 8,          // en grupos de vecinos, para tener trayectos cortos como los de una ruta
  camion: 0.8,        // un camión de servicio va al 80 % de la velocidad de un coche
  cortoKm: 2,         // trayecto corto (de parada a parada), en línea recta
};
const mediana = xs => { const o = [...xs].sort((a, b) => a - b); return o.length ? (o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2) : null; };
const cache = new Map();

/**
 * Los puntos a medir: unos cuantos repartidos por la zona y, de cada uno, sus
 * vecinos más cercanos (para tener trayectos cortos, como los de una ruta).
 */
export function puntosDeMuestra(puntos, { muestra = CARRETERA.muestra, grupos = CARRETERA.grupos } = {}) {
  const pts = [];
  const vistos = new Set();
  for (const p of puntos || []) {
    if (!hasCoords(p.lat, p.lng)) continue;
    const k = `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`;
    if (!vistos.has(k)) { vistos.add(k); pts.push({ lat: +p.lat, lng: +p.lng }); }
  }
  if (pts.length <= muestra) return pts;
  // semillas repartidas: el más lejano a las ya elegidas (empezando por el primero)
  const semillas = [pts[0]];
  while (semillas.length < Math.min(grupos, pts.length)) {
    let mejor = null, d = -1;
    for (const p of pts) { const m = Math.min(...semillas.map(s => haversineKm(p.lat, p.lng, s.lat, s.lng))); if (m > d) { d = m; mejor = p; } }
    semillas.push(mejor);
  }
  const porGrupo = Math.max(2, Math.floor(muestra / semillas.length));
  const out = [];
  for (const s of semillas) {
    const cerca = pts.map(p => ({ p, d: haversineKm(s.lat, s.lng, p.lat, p.lng) })).sort((a, b) => a.d - b.d).slice(0, porGrupo).map(x => x.p);
    for (const p of cerca) if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, muestra);
}

/**
 * Mide la carretera de la zona de esos puntos.
 * @returns { factor, kmh, kmhLargo, pares, medido: true } | { medido: false, motivo }
 */
export async function medirCarretera(puntos, { fetchFn = (...a) => fetch(...a), camion = CARRETERA.camion } = {}) {
  const m = puntosDeMuestra(puntos);
  if (m.length < 3) return { medido: false, motivo: "pocos puntos con coordenadas" };
  const clave = m.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
  if (cache.has(clave)) return cache.get(clave);
  let j;
  try {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    const r = await fetchFn(`${OSRM}/${m.map(p => `${p.lng},${p.lat}`).join(";")}?annotations=distance,duration`, ctrl ? { signal: ctrl.signal } : undefined);
    if (t) clearTimeout(t);
    j = await r.json();
  } catch { return { medido: false, motivo: "el servicio de rutas no responde" }; }
  if (j?.code !== "Ok" || !j.distances || !j.durations) return { medido: false, motivo: "el servicio de rutas no dio distancias" };
  const rodeos = [], cortos = [], largos = [];
  let pares = 0;
  for (let a = 0; a < m.length; a++) for (let b = 0; b < m.length; b++) {
    if (a === b) continue;
    const recta = haversineKm(m[a].lat, m[a].lng, m[b].lat, m[b].lng), km = j.distances[a]?.[b] / 1000, h = j.durations[a]?.[b] / 3600;
    if (!(recta > 0.15) || !(km > 0) || !(h > 0)) continue;
    pares++;
    rodeos.push(km / recta);
    (recta < CARRETERA.cortoKm ? cortos : largos).push({ km, h });
  }
  if (pares < 10) return { medido: false, motivo: "pocos trayectos medidos" };
  // el rodeo de los trayectos cortos (de un punto a sus vecinos): es el que más pesa en una ruta
  const cortosVecinos = await rodeosCortos(puntos, { fetchFn }).catch(() => []);
  // la velocidad: la de los trayectos cortos si hay bastantes (son los de una ruta), si no la de todos
  const vel = xs => xs.reduce((s, x) => s + x.km, 0) / xs.reduce((s, x) => s + x.h, 0);
  const base = cortos.length >= 10 ? cortos : [...cortos, ...largos];
  const factor = Math.round(Math.min(2.5, Math.max(1, mediana(rodeos))) * 100) / 100;
  const largo = Math.max(2, mediana([...cortos, ...largos].map(x => x.km)) / factor || 2);
  const res = {
    medido: true, pares: pares + cortosVecinos.reduce((s, b) => s + b.n, 0), factor,
    // [[km en línea recta, rodeo]]: los cortos medidos con vecinos y, al final, el general
    rodeos: [...cortosVecinos.map(b => [b.d, b.f]), [largo, factor]].filter((x, i, a) => !i || x[0] > a[i - 1][0]),
    kmh: Math.round(Math.min(70, Math.max(10, vel(base) * camion)) * 10) / 10,
    kmhLargo: largos.length ? Math.round(vel(largos) * camion * 10) / 10 : null,
  };
  cache.set(clave, res);
  return res;
}

// Tramos de distancia de los trayectos cortos (en línea recta, km)
const TRAMOS = [[0, 0.1], [0.1, 0.3], [0.3, 1]];
/**
 * El rodeo de los trayectos cortos: de unos cuantos puntos a sus vecinos
 * (el 1.º, el 5.º y el 20.º más cercanos), medidos por carretera.
 * @returns [{ d: km típico del tramo, f: rodeo, n }] (solo los tramos con bastantes trayectos)
 */
export async function rodeosCortos(puntos, { fetchFn = (...a) => fetch(...a), cuantos = 150 } = {}) {
  const pts = (puntos || []).filter(p => hasCoords(p.lat, p.lng)).map(p => ({ lat: +p.lat, lng: +p.lng }));
  if (pts.length < 25) return [];
  const pares = [];
  for (let i = 0; i < cuantos; i++) {
    const p = pts[Math.floor((i * 7919) % pts.length)];
    const v = pts.map(q => ({ q, d: haversineKm(p.lat, p.lng, q.lat, q.lng) })).filter(x => x.d > 0.005).sort((a, b) => a.d - b.d);
    for (const k of [0, 4, 20]) if (v[k]) pares.push([p, v[k].q, v[k].d]);
  }
  const porTramo = TRAMOS.map(() => []);
  for (let i = 0; i < pares.length; i += 25) {
    const lote = pares.slice(i, i + 25);
    const coords = lote.flatMap(([a, b]) => [a, b]).map(p => `${p.lng},${p.lat}`).join(";");
    const r = await fetchFn(`${OSRM}/${coords}?sources=${lote.map((_, k) => 2 * k).join(";")}&destinations=${lote.map((_, k) => 2 * k + 1).join(";")}&annotations=distance`);
    const j = await r.json();
    if (j?.code !== "Ok") continue;
    lote.forEach(([, , d], k) => {
      const km = j.distances?.[k]?.[k] / 1000, t = TRAMOS.findIndex(([a, b]) => d >= a && d < b);
      if (km > 0 && t >= 0) porTramo[t].push({ d, km });
    });
  }
  // el rodeo del tramo: lo típico por carretera entre lo típico en línea recta (más estable que
  // dividir trayecto a trayecto: en distancias de pocos metros cualquier rodeo se dispara)
  return porTramo.map(xs => {
    if (xs.length < 8) return null;
    const d = mediana(xs.map(x => x.d)), km = mediana(xs.map(x => x.km));
    return { d, f: Math.round(Math.min(5, Math.max(1, km / d)) * 100) / 100, n: xs.length };
  }).filter(Boolean);
}

/** Para enseñar lo medido, en una frase */
const coma = n => String(n).replace(".", ",");
export const textoCarretera = c => (!c?.medido ? `en línea recta a 30 km/h${c?.motivo ? ` (${c.motivo})` : ""}`
  : `por carretera (medido con ${c.pares.toLocaleString("es-ES")} trayectos de la zona): de parada a parada ${c.rodeos?.length > 1 ? `${coma(c.rodeos[0][1])} veces la línea recta` : `${coma(c.factor)} veces la línea recta`}, en trayectos largos ${coma(c.factor)}; a ${coma(c.kmh)} km/h entre paradas${c.kmhLargo ? ` y ${coma(c.kmhLargo)} km/h en los largos` : ""}`);
