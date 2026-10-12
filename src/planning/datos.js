// Planning de rutas por puntos: datos sin pantalla — caché local (IndexedDB), cocheras,
// barrios, fracciones y contenedores, calidad de coordenadas y distancias.

import { db } from "../firebase.js";
import { doc, serverTimestamp } from "firebase/firestore";
import { cambiarDocumento } from "../concurrencia.js";


// La librería de Excel (~430 KB) se descarga solo cuando se usa (importar o
// exportar un Excel), no al abrir cualquier proyecto.
export const loadXLSX = () => import("xlsx");

// ── IndexedDB para markers grandes (evita límite 1MB de Firestore) ──
const _IDB_NAME = 'operanzia_v1';

const _IDB_STORE = 'layer_markers';

let _idbConn = null;

// Depots del proyecto: cada cambio se aplica sobre la lista del servidor
// (concurrencia.js) — antes se guardaba la lista de la pantalla entera.
export const cambiarDepots = (projectId, orgId, cambio) => cambiarDocumento(doc(db, "planning_depots", projectId), datos => ({
  depots: cambio(datos?.depots || []), projectId, orgId: orgId || datos?.orgId || null, updatedAt: serverTimestamp(),
}));

function _idbOpen() {
  if (!_idbConn) _idbConn = new Promise((res, rej) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => { _idbConn = null; rej(req.error); };
  });
  return _idbConn;
}

export async function idbGet(key) {
  const db = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readonly');
    const r = tx.objectStore(_IDB_STORE).get(key);
    r.onsuccess = () => res(r.result ?? []); r.onerror = () => rej(r.error);
  });
}

export async function idbDel(key) {
  try {
    const db = await _idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      const r = tx.objectStore(_IDB_STORE).delete(key);
      r.onsuccess = res; r.onerror = () => rej(r.error);
    });
  } catch {}
}

// Misma paleta y función que scheduling — colores deterministas por barrio
const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];

const _barrioCache = {};

function barrioColorDefault(b) {
  if (!b) return "#8b95a5";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

export function barrioColor(b, overrides = {}) {
  return overrides[b] || barrioColorDefault(b);
}

// Detecta el campo de barrio comparando en lowercase (independiente de capitalización)
const BARRIO_KEYS = ["barri","barrio","barri_nom","sector","zona","zone","district",
                     "districte","municipio","area","neighbourhood","neighborhood"];

// Rendimiento: estas búsquedas se hacen por cada punto (44.249 en MADRID) y
// varias veces por pintado. Antes, por cada punto se recorrían todas sus
// columnas normalizando cada nombre — cientos de miles de operaciones de
// texto (medido: ~1 s bloqueando la pantalla al abrir Planning en un PC
// normal). Solo hay unas pocas columnas distintas, así que se decide UNA
// vez por nombre de columna si es la buscada (caché) y se recorre con
// for...in, sin crear arrays.
const _barrioKeySet = new Set(BARRIO_KEYS);

const _isBarrioKey = new Map();

export function getBarrio(m) {
  for (const k in m) {
    let is = _isBarrioKey.get(k);
    if (is === undefined) { is = _barrioKeySet.has(k.toLowerCase().trim()); _isBarrioKey.set(k, is); }
    if (is && m[k]) return String(m[k]);
  }
  return "";
}

// Quita acentos y normaliza para comparar nombres de columna con más tolerancia
// (los archivos subidos escriben "Fracción"/"Fraccion"/"FRACCIÓN" de formas distintas)
function _normKey(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function _fieldGetter(keys) {
  const normKeys = new Set(keys.map(_normKey));
  const isKey = new Map(); // nombre de columna tal cual → ¿es una de las buscadas?
  return function (m) {
    for (const k in m) {
      let is = isKey.get(k);
      if (is === undefined) { is = normKeys.has(_normKey(k)); isKey.set(k, is); }
      if (is && m[k]) return String(m[k]);
    }
    return "";
  };
}

const FRACCION_KEYS = [
  "fraccion", "tipo fraccion", "tipo_fraccion", "tipofraccion",
  "residuo", "tipo residuo", "tipo_residuo", "tiporesiduo",
  "material", "tipo material", "tipo_material",
];

export const getFraccion = _fieldGetter(FRACCION_KEYS);

const CONTENEDOR_KEYS = [
  "contenedor", "tipo contenedor", "tipo_contenedor", "tipocontenedor",
  "modelo contenedor", "modelo_contenedor",
];

export const getContenedor = _fieldGetter(CONTENEDOR_KEYS);

export const USUARIOS_INIT = [
  { id:"1", nombre:"Admin",  apellidos:"Sistema",  usuario:"admin",    password:"admin123", rol:"admin",     activo:true },
  { id:"2", nombre:"Carlos", apellidos:"Martín",   usuario:"cmartin",  password:"1234",     rol:"conductor", activo:true },
  { id:"3", nombre:"Laura",  apellidos:"Sánchez",  usuario:"lsanchez", password:"1234",     rol:"conductor", activo:true },
  { id:"4", nombre:"Pedro",  apellidos:"Ruiz",     usuario:"pruiz",    password:"1234",     rol:"conductor", activo:true },
];

// ── GLOBAL STYLES ─────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("planning-styles")) {
  const s = document.createElement("style");
  s.id = "planning-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px;}

    .planning-map .leaflet-popup-content-wrapper{
      background:#161b27;color:#f0f4f8;
      border:1px solid rgba(255,255,255,0.1);
      border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.6);padding:0;
    }
    .planning-map .leaflet-popup-content{margin:0;}
    .planning-map .leaflet-popup-tip{background:#161b27;}
    .planning-map .leaflet-popup-close-button{color:#8b95a5!important;font-size:18px!important;top:6px!important;right:10px!important;}
    .planning-map .leaflet-popup-close-button:hover{color:#f0f4f8!important;}
    .planning-map .leaflet-control-zoom a{
      background:#161b27!important;color:#f0f4f8!important;border-color:rgba(255,255,255,0.1)!important;
    }
    .planning-map .leaflet-control-zoom a:hover{background:#1c2333!important;}
    .planning-map .leaflet-bar{border-color:rgba(255,255,255,0.1)!important;box-shadow:0 2px 12px rgba(0,0,0,.4)!important;}
    @keyframes planning-spin{to{transform:rotate(360deg)}}
    @keyframes planning-fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  `;
  document.head.appendChild(s);
}

// ── Calidad de coordenadas de una capa ───────────────────────────
// Filas del Excel sin coordenadas acaban como 0/0 (o casi): se pintaban en el
// golfo de Guinea y el mapa se encuadraba para incluirlas, así que al abrir
// un proyecto se veía medio continente en vez de la ciudad. Aquí:
//  - "basura": no numérico, fuera de rango o a < ~50 km del punto 0,0
//    (ahí nunca hay un contenedor) → ni se pinta ni se importa;
//  - "lejos": a más de max(50 km, 4 × p95) del centro (mediana) de la capa
//    → se pinta, pero no cuenta para encuadrar el mapa.
// Se calcula una vez por array de puntos (WeakMap), no en cada render.
const _coordCache = new WeakMap();

export function isJunkCoord(lat, lng) {
  return !isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
    (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5);
}

export function coordQuality(markers) {
  if (!markers?.length) return { invalid: 0, far: 0, isFar: () => false };
  if (_coordCache.has(markers)) return _coordCache.get(markers);
  const lats = [], lngs = [];
  let invalid = 0;
  for (const m of markers) {
    const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
    if (isJunkCoord(lat, lng)) { invalid++; continue; }
    lats.push(lat); lngs.push(lng);
  }
  let res = { invalid, far: 0, isFar: () => false };
  if (lats.length) {
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const cLat = med(lats), cLng = med(lngs);
    const kx = 111.32 * Math.cos(cLat * Math.PI / 180);
    const dist = (lat, lng) => Math.hypot((lat - cLat) * 110.57, (lng - cLng) * kx);
    const ds = lats.map((lat, i) => dist(lat, lngs[i])).sort((x, y) => x - y);
    const limitKm = Math.max(50, 4 * ds[Math.floor((ds.length - 1) * 0.95)]);
    const isFar = (lat, lng) => dist(lat, lng) > limitKm;
    res = { invalid, far: ds.filter(d => d > limitKm).length, isFar, limitKm };
  }
  _coordCache.set(markers, res);
  return res;
}

// ── MAPA PLANNING ─────────────────────────────────────────────────
// Haversine distance in km between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export function routeStats(pts) {
  let km = 0;
  for (let i = 1; i < pts.length; i++)
    km += haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return { km, minAt30: Math.round(km / 30 * 60) };
}

// ── TIME HELPERS ─────────────────────────────────────────────────
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}

// ── TIMETABLE TAB ─────────────────────────────────────────────────
export const TT_PAGINA = 300;

export const normTxt = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
