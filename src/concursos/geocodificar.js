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

/** ¿Las coordenadas vienen del archivo? (las buscadas aquí llevan `geo` y se vuelven a buscar) */
export const traeCoordenadas = c => Number.isFinite(c.lat) && Number.isFinite(c.lng) && !c.geo;

/** Las direcciones distintas del listado: Map<dirección, índices de contenedores> */
export function direccionesDe(contenedores, municipio) {
  const m = new Map();
  contenedores.forEach((c, i) => {
    if (traeCoordenadas(c)) return; // las coordenadas vienen en el archivo
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

/** ¿El municipio encontrado es el pedido? «Palma» = «Palma», pero no «Palma del Río» ni «La Palma de Cervelló».
 *  Si se pidió «Palma de Mallorca», vale «Palma». */
export function mismoMunicipio(pedido, encontrado) {
  const p = sinAcentos(pedido).replace(/\s+/g, " ").trim(), e = sinAcentos(encontrado).replace(/\s+/g, " ").trim();
  if (!p) return true;
  if (!e) return false;
  return p === e || p.startsWith(`${e} `) || e.split(/\s*\/\s*/).includes(p);
}

async function buscar(texto, fetchFn) {
  const partes = texto.split(",");
  const municipio = partes.length > 1 ? partes[partes.length - 1].trim() : "";
  const sinNumero = texto.replace(/\s\d+(?=,|$)/, "");
  const calle = sinNumero.split(",")[0];
  const num = (texto.match(/\s(\d+)(?=,|$)/) || [])[1];
  const vale = (c, muni) => !NO_SIRVE.test(c.type || "") && mismaCalle(calle, c.address) && mismoMunicipio(municipio, muni ?? c.muni);
  // 1) la dirección tal cual: el portal exacto, en ese municipio
  const crudo = await json(`${BASE}/find?q=${encodeURIComponent(texto)}`, fetchFn);
  const r = leerRespuesta(crudo);
  if (r && r.calidad !== "municipio" && mismaCalle(calle, r.texto) && mismoMunicipio(municipio, crudo.muni)) return r;
  // 2) si el primero era de otro municipio, entre más candidatos: el portal; si no, la calle (su centro, aproximado)
  for (const q of num ? [texto, sinNumero] : [sinNumero]) {
    const cands = (await json(`${BASE}/candidates?limit=15&q=${encodeURIComponent(q)}`, fetchFn)) || [];
    for (const c of (Array.isArray(cands) ? cands : []).filter(x => vale(x))) {
      if (c.lat && c.lng) return { lat: c.lat, lng: c.lng, calidad: c.type === "portal" && !c.noNumber ? "portal" : "calle", texto: c.address };
      if (c.type === "callejero" && c.id) {
        const f = await json(`${BASE}/find?id=${encodeURIComponent(c.id)}&type=callejero`, fetchFn);
        if (f && !mismoMunicipio(municipio, f.muni ?? c.muni)) continue;
        const p = f && ((f.lat && f.lng) ? { lat: f.lat, lng: f.lng } : centroDe(f.geom));
        if (p) return { ...p, calidad: "calle", texto: c.address };
      }
    }
  }
  return null;
}

const km = (a, b) => {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2));
};
const mediana = xs => { const o = [...xs].sort((a, b) => a - b); return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2; };

/** Por si acaso: lo que cae a más de `maxKm` del centro (la mediana) de lo encontrado no se da por bueno */
export function quitarLejanos(porDireccion, maxKm = 25) {
  const ok = [...porDireccion.values()].filter(Boolean);
  if (ok.length < 3) return [];
  const centro = { lat: mediana(ok.map(r => r.lat)), lng: mediana(ok.map(r => r.lng)) };
  const fuera = [];
  for (const [d, r] of porDireccion) if (r && km(centro, r) > maxKm) { porDireccion.set(d, null); fuera.push(d); }
  return fuera;
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
  const lejanos = quitarLejanos(porDireccion);
  const vals = [...porDireccion.values()];
  return {
    porDireccion,
    encontradas: vals.filter(r => r?.calidad === "portal").length,
    aproximadas: vals.filter(r => r && r.calidad !== "portal").length,
    sinEncontrar: vals.filter(r => !r).length,
    lejanos,
  };
}

/** Los contenedores con las coordenadas de su dirección (los que no se encuentran, sin tocar) */
export function aplicarCoordenadas(contenedores, municipio, porDireccion) {
  return contenedores.map(c => {
    if (traeCoordenadas(c)) return c;
    const { lat, lng, geo, ...resto } = c; // lo buscado antes, fuera
    void lat; void lng; void geo;
    const r = porDireccion.get(direccionDe(c, municipio));
    return r ? { ...resto, lat: r.lat, lng: r.lng, geo: r.calidad } : resto;
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
