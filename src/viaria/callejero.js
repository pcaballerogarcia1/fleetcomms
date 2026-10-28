// Limpieza viaria · el callejero: las calles de una zona (OpenStreetMap, por
// la API pública de Overpass) partidas en tramos, cada uno con su forma, su
// longitud, el tiempo que lleva barrerlo y cada cuánto toca.
//
// Cada tramo se guarda como un punto más de una capa de Planificación (en su
// punto medio) con su línea en `geom`: así el motor de rutas, la app, Control
// y Análisis trabajan con él igual que con un contenedor.

export const OVERPASS = "https://overpass-api.de/api/interpreter";
// otros servidores públicos de OpenStreetMap por si el primero no responde
export const OVERPASS_ESPEJOS = [OVERPASS, "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

// Tipos de vía de OpenStreetMap que se barren (y su nombre en español)
export const TIPOS_VIA = {
  primary: "Avenida principal", secondary: "Vía secundaria", tertiary: "Vía de barrio", residential: "Calle",
  living_street: "Calle de coexistencia", pedestrian: "Calle peatonal", unclassified: "Calle sin clasificar",
};
export const TIPOS_POR_DEFECTO = Object.keys(TIPOS_VIA);

// Frecuencia por defecto según el tipo de vía (se cambia luego en la tabla)
export const FRECUENCIA_POR_TIPO = {
  primary: "diaria", secondary: "diaria", pedestrian: "diaria", living_street: "diaria",
  tertiary: "L-X-V", residential: "L-X-V", unclassified: "1/semana",
};

/** El rectángulo [sur, oeste, norte, este] de un círculo de `km` alrededor de un punto */
export const rectanguloDe = (lat, lng, km) => {
  const dLat = km / 111.32, dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map(v => +v.toFixed(5));
};

/** Consulta de Overpass: las calles dentro de un rectángulo [sur, oeste, norte, este] */
export function consultaCalles([s, w, n, e], tipos = TIPOS_POR_DEFECTO) {
  const re = `^(${tipos.map(t => t.replace(/[^a-z_]/g, "")).join("|")})$`;
  return `[out:json][timeout:60];way["highway"~"${re}"](${s},${w},${n},${e});out tags geom;`;
}

const R = 6371000;
const rad = x => (x * Math.PI) / 180;
export function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const longitudM = pts => pts.slice(1).reduce((x, p, i) => x + distanciaM(pts[i], p), 0);

/** El punto que está a mitad de recorrido de la línea */
export function puntoMedio(pts) {
  const total = longitudM(pts);
  let acum = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distanciaM(pts[i - 1], pts[i]);
    if (acum + d >= total / 2 && d > 0) {
      const f = (total / 2 - acum) / d;
      return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f };
    }
    acum += d;
  }
  return pts[0];
}

/** La línea con como mucho `max` puntos (para que pese poco), sin perder los extremos */
export function simplificar(pts, max = 16) {
  if (pts.length <= max) return pts;
  const paso = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * paso)]);
}

/** Corta una línea en trozos de como mucho `maxM` metros (por sus vértices) */
export function partir(pts, maxM) {
  const trozos = [];
  let actual = [pts[0]], acum = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distanciaM(pts[i - 1], pts[i]);
    if (acum + d > maxM && actual.length > 1) { trozos.push(actual); actual = [pts[i - 1]]; acum = 0; }
    actual.push(pts[i]); acum += d;
  }
  if (actual.length > 1) trozos.push(actual);
  return trozos;
}

/**
 * Minutos que lleva barrer un tramo a mano.
 * @param mPorHora metros lineales de acera que barre un operario en una hora
 * @param aceras   aceras que se barren (2 en una calle normal)
 */
export function minutosBarrido(longitud, { mPorHora = 1200, aceras = 2 } = {}) {
  return Math.max(1, Math.round((longitud * aceras * 60) / Math.max(1, mPorHora)));
}

/**
 * Tramos de calle desde la respuesta de Overpass (`out tags geom`).
 * @returns [{ id, nombre, tipoVia, longitudM, lat, lng, geom: [lat, lng, lat, lng…], duracion, frecuencia, campos }]
 * (geom va plana: la base de datos no admite listas dentro de listas)
 */
export function tramosDeOsm(osm, { maxM = 250, minM = 15, mPorHora = 1200, aceras = 2, frecuencias = FRECUENCIA_POR_TIPO } = {}) {
  const out = [];
  for (const el of osm?.elements || []) {
    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const tipo = el.tags?.highway;
    if (!TIPOS_VIA[tipo]) continue;
    const pts = el.geometry.map(g => ({ lat: +g.lat, lng: +g.lon })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length < 2) continue;
    const nombre = el.tags?.name || `${TIPOS_VIA[tipo]} sin nombre`;
    const acerasTramo = tipo === "pedestrian" || tipo === "living_street" ? 1 : aceras; // peatonal: una sola superficie
    partir(pts, maxM).forEach((tr, i, todos) => {
      const L = longitudM(tr);
      if (L < minM) return;
      const m = puntoMedio(tr);
      const frecuencia = frecuencias[tipo] || "1/semana";
      out.push({
        id: `osm-${el.id}-${i}`, nombre: todos.length > 1 ? `${nombre} (${i + 1})` : nombre, calle: nombre, tipoVia: tipo,
        longitudM: Math.round(L), lat: +m.lat.toFixed(6), lng: +m.lng.toFixed(6),
        geom: simplificar(tr).flatMap(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]),
        duracion: minutosBarrido(L, { mPorHora, aceras: acerasTramo }), frecuencia,
        campos: { calle: nombre, tipo: TIPOS_VIA[tipo], metros: Math.round(L), frecuencia, servicio: "Barrido manual" },
      });
    });
  }
  return out;
}

/** Los tramos como puntos de una capa de Planificación (planos: lat, lng y una columna por dato) */
export const marcadoresDeTramos = tramos => tramos.map(t => ({
  lat: t.lat, lng: t.lng, nombre: t.nombre, calle: t.calle || t.campos?.calle || t.nombre, tipo: TIPOS_VIA[t.tipoVia] || t.tipoVia || "", metros: t.longitudM,
  frecuencia: t.frecuencia, servicio: t.campos?.servicio || "Barrido manual", duracion: t.duracion, tramo: t.id, geom: t.geom,
}));

/** Lo que manda el servidor: sin `campos` (se rehacen aquí) para que pese menos */
export const compactarTramos = tramos => tramos.map(t => { const c = { ...t }; delete c.campos; return c; });

/** Comprueba un rectángulo [sur, oeste, norte, este]: números, en orden y de como mucho `maxKm` de lado */
export function rectanguloValido(b, maxKm = 12) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(+v))) return false;
  const [s, w, n, e] = b.map(Number);
  if (s >= n || w >= e || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) return false;
  return distanciaM({ lat: s, lng: w }, { lat: n, lng: w }) <= maxKm * 1000 && distanciaM({ lat: s, lng: w }, { lat: s, lng: e }) <= maxKm * 1000;
}

/** Pide a un servidor de Overpass las calles del rectángulo y las devuelve en tramos */
export async function descargarCallejero(bbox, opciones = {}, fetchFn = globalThis.fetch, url = OVERPASS) {
  const r = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(consultaCalles(bbox, opciones.tipos))}` });
  if (r.status === 429 || r.status === 504) throw new Error("El servidor de OpenStreetMap está ocupado; prueba en un minuto");
  if (!r.ok) throw new Error(`OpenStreetMap respondió con un error (${r.status})`);
  return tramosDeOsm(await r.json(), opciones);
}

/** Lo mismo probando varios servidores de OpenStreetMap seguidos (el primero que responda) */
export async function descargarConEspejos(bbox, opciones = {}, fetchFn = globalThis.fetch, espejos = OVERPASS_ESPEJOS) {
  let ultimo;
  for (const url of espejos) {
    try { return await descargarCallejero(bbox, opciones, fetchFn, url); } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error("No se pudo conectar con OpenStreetMap");
}

/** La línea de un tramo como [[lat, lng]…] (para Leaflet), desde su geom plana */
export function lineaDe(geom) {
  if (!Array.isArray(geom) || geom.length < 4) return null;
  const out = [];
  for (let i = 0; i + 1 < geom.length; i += 2) if (Number.isFinite(+geom[i]) && Number.isFinite(+geom[i + 1])) out.push([+geom[i], +geom[i + 1]]);
  return out.length > 1 ? out : null;
}
