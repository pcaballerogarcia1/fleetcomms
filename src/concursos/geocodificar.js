// Concursos → situar en el mapa un listado de contenedores sin coordenadas.
// Cada dirección (calle + número + municipio) se busca UNA vez en CartoCiudad,
// el buscador oficial de direcciones de España (IGN, gratis, sin clave). Todos
// los contenedores del mismo punto comparten las coordenadas de su dirección.
// Cada resultado dice cómo de bien se ha encontrado: el portal exacto, solo
// la calle, o nada. Sin React ni Firebase.

const BASE = "https://www.cartociudad.es/geocoder/api/geocoder";
const NO_SIRVE = /^(poblacion|municipio|provincia|comunidad|expendeduria)$/i;
const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
// las palabras que identifican la calle (sin «calle», «de», «la»…)
const VACIAS = new Set(["CALLE", "CARRER", "AVENIDA", "AVINGUDA", "PLAZA", "PLACA", "PASEO", "PASSEIG", "CAMINO", "CAMI", "DE", "DEL", "LA", "LAS", "LOS", "EL", "ELS", "LES", "D", "L", "Y", "I"]);
const palabras = t => sinAcentos(t).split(/[^A-Z0-9]+/).filter(w => w.length > 2 && !VACIAS.has(w) && !/^\d+$/.test(w));
/** Letras distintas entre dos palabras (distancia de edición) */
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** ¿La calle encontrada es la que se buscaba? Las palabras largas, todas (admitiendo una
 *  letra distinta, o dos en las muy largas: «RAFALETES» = «RAFELETES»); si no hay largas, las cortas. */
export function mismaCalle(buscada, encontrada) {
  const b = palabras(buscada), e = palabras(encontrada);
  const clave = b.filter(w => w.length >= 5);
  const lista = clave.length ? clave : b;
  return lista.length > 0 && lista.every(w => e.some(x => x === w || (w.length >= 5 && distancia(w, x) <= (w.length >= 8 ? 2 : 1))));
}

/** Texto de búsqueda de un contenedor: «GABRIEL MAURA 15, Palma» */
export function direccionDe(c, municipio = "") {
  const calle = String(c.calle || "").replace(/\s+/g, " ").trim();
  if (!calle) return null;
  const num = String(c.numero || "").match(/\d+/)?.[0] || "";
  const muni = String(c.municipio || municipio || "").trim();
  return [`${calle}${num ? ` ${num}` : ""}`, muni].filter(Boolean).join(", ");
}

/** Las direcciones distintas del listado: Map<dirección, índices de contenedores> */
export function direccionesDe(contenedores, municipio) {
  const m = new Map();
  contenedores.forEach((c, i) => {
    if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) return; // ya tiene coordenadas
    const d = direccionDe(c, municipio);
    if (!d) return;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(i);
  });
  return m;
}

/** Respuesta de CartoCiudad → { lat, lng, calidad: "portal" | "calle" | "municipio", texto } o null */
export function leerRespuesta(r) {
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lng) || (r.state != null && r.state > 10)) return null;
  const calidad = r.type === "portal" && !r.noNumber ? "portal" : r.type === "callejero" || r.type === "portal" ? "calle" : "municipio";
  return { lat: r.lat, lng: r.lng, calidad, texto: [r.tip_via, r.address, r.portalNumber, r.muni].filter(Boolean).join(" ") };
}

/** El centro de una geometría en texto (POINT, LINESTRING, MULTILINESTRING…): la media de sus vértices */
export function centroDe(geom) {
  const pares = [...String(geom || "").matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]);
  if (!pares.length) return null;
  return { lng: pares.reduce((s, p) => s + p[0], 0) / pares.length, lat: pares.reduce((s, p) => s + p[1], 0) / pares.length };
}

async function json(url, fetchFn) {
  const res = await fetchFn(url);
  if (!res.ok) return null;
  const t = await res.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

async function buscar(texto, fetchFn) {
  // 1) la dirección tal cual: el portal exacto
  const sinNumero = texto.replace(/\s\d+(?=,|$)/, "");
  const calle = sinNumero.split(",")[0];
  const r = leerRespuesta(await json(`${BASE}/find?q=${encodeURIComponent(texto)}`, fetchFn));
  if (r && r.calidad !== "municipio" && mismaCalle(calle, r.texto)) return r;
  // 2) si no, la calle (sin número): su centro, aproximado
  const cands = (await json(`${BASE}/candidates?limit=3&q=${encodeURIComponent(sinNumero)}`, fetchFn)) || [];
  for (const c of Array.isArray(cands) ? cands : []) {
    if (NO_SIRVE.test(c.type || "") || !mismaCalle(calle, c.address)) continue;
    if (c.lat && c.lng) return { lat: c.lat, lng: c.lng, calidad: "calle", texto: c.address };
    if (c.type === "callejero" && c.id) {
      const f = await json(`${BASE}/find?id=${encodeURIComponent(c.id)}&type=callejero`, fetchFn);
      const p = f && ((f.lat && f.lng) ? { lat: f.lat, lng: f.lng } : centroDe(f.geom));
      if (p) return { ...p, calidad: "calle", texto: c.address };
    }
  }
  return null;
}

/**
 * Busca las coordenadas de cada dirección (varias a la vez, sin pasarse).
 * @returns { porDireccion: Map<dirección, resultado|null>, encontradas, aproximadas, sinEncontrar }
 */
export async function geocodificar(direcciones, { fetchFn = (...a) => fetch(...a), aLaVez = 4, onProgreso } = {}) {
  const lista = [...direcciones];
  const porDireccion = new Map();
  let i = 0, hechas = 0;
  async function trabajador() {
    while (i < lista.length) {
      const d = lista[i++];
      let r = null;
      for (let intento = 0; intento < 2 && !r; intento++) {
        try { r = await buscar(d, fetchFn); } catch { r = null; }
      }
      porDireccion.set(d, r);
      onProgreso?.(++hechas, lista.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(aLaVez, lista.length) }, trabajador));
  const vals = [...porDireccion.values()];
  return {
    porDireccion,
    encontradas: vals.filter(r => r?.calidad === "portal").length,
    aproximadas: vals.filter(r => r && r.calidad !== "portal").length,
    sinEncontrar: vals.filter(r => !r).length,
  };
}

/** Los contenedores con las coordenadas de su dirección (los que no se encuentran, sin tocar) */
export function aplicarCoordenadas(contenedores, municipio, porDireccion) {
  return contenedores.map(c => {
    if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) return c;
    const r = porDireccion.get(direccionDe(c, municipio));
    return r ? { ...c, lat: r.lat, lng: r.lng, geo: r.calidad } : c;
  });
}

/** Contenedores → puntos de una capa del Planning (con los nombres de campo que entiende el Planning) */
export function marcadoresDe(contenedores) {
  return contenedores.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map((c, k) => {
    const m = {
      lat: c.lat, lng: c.lng,
      nombre: [c.calle, c.numero].filter(Boolean).join(" ") || c.punto || `Contenedor ${k + 1}`,
      id: c.codigo ? String(c.codigo) : `inv_${k}`,
      calle: c.calle, numero: c.numero, barrio: c.barrio, distrito: c.distrito, municipio: c.municipio,
      fraccion: c.fraccionPliego || c.fraccion, contenedor: c.ubicacion, capacidad: c.capacidad, punto: c.punto, codigo: c.codigo,
      situado: c.geo === "portal" ? "en el portal" : c.geo === "calle" ? "en la calle (aproximado)" : c.geo === "municipio" ? "en el municipio (revisar)" : undefined,
    };
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v != null && v !== ""));
  });
}
