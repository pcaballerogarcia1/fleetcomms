// ── Aviso automático de errores ──────────────────────────────────────
// Los errores que ocurren en el navegador de cualquier usuario (oficina o
// app de Rutas) se guardan en  errores/{id}  para que el superadmin los vea
// sin que nadie tenga que avisar: excepciones sin capturar, promesas
// rechazadas, pantallas que se rompen (ErrorBoundary) y los avisos de
// Firestore que no llegan a ser excepción ("Uncaught Error in snapshot
// listener", permisos denegados…).
//
// Límites: cada error distinto se envía una sola vez por sesión, y como
// mucho MAX_POR_SESION por pestaña, así un bucle de errores no dispara el
// coste de Firestore.

import { auth, db } from "./firebase.js";
import { addDoc, collection, serverTimestamp, onSnapshot, query, orderBy, limit } from "firebase/firestore";

export const MAX_POR_SESION = 25;
/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

let user = null;
const enviados = new Set();
let total = 0;
let installed = false;

export function setErrorUser(sesion) {
  user = sesion?.uid ? {
    uid: sesion.uid, org_id: sesion.org_id ?? null, rol: sesion.rol ?? "",
    nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") || "Usuario",
  } : null;
}

// Clave para no repetir: mensaje sin números variables + primera línea de la pila
export function errorKey(mensaje, stack) {
  const m = String(mensaje || "").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "").replace(/\d+/g, "#").slice(0, 200);
  const s = String(stack || "").split("\n").map(l => l.trim()).find(l => l.startsWith("at ")) || "";
  return `${m}|${s.replace(/:\d+:\d+\)?$/, "")}`;
}

export function reportError({ tipo = "error", mensaje, stack = "" } = {}) {
  if (!user?.uid || !mensaje) return false;              // sin sesión no se puede escribir (reglas)
  const key = errorKey(mensaje, stack);
  if (enviados.has(key) || total >= MAX_POR_SESION) return false;
  enviados.add(key); total++;
  addDoc(collection(db, "errores"), {
    org_id: user.org_id, uid: user.uid, nombre: user.nombre, rol: user.rol,
    tipo, mensaje: String(mensaje).slice(0, 600), stack: String(stack || "").slice(0, 2500),
    pagina: typeof location !== "undefined" ? location.pathname : "",
    navegador: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
    version: VERSION, at: serverTimestamp(), atMs: Date.now(),
  }).then(ref => { if (tipo !== "lentitud") avisarAlServidor(ref.id); })
    .catch(() => { /* si no se puede guardar el error, no hay nada más que hacer */ });
  return true;
}

// El servidor decide si avisa al móvil del superadmin (api/alerta-error.js:
// un aviso por error cada 6 h, con tope diario). Sin cobertura o en local no
// pasa nada: el error ya está guardado.
const SIN_SERVIDOR = !!(import.meta.env?.VITE_EMULADORES) || import.meta.env?.MODE === "test";
async function avisarAlServidor(id) {
  if (SIN_SERVIDOR || typeof fetch === "undefined") return;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch("/api/alerta-error", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id }) });
  } catch { /* no es crítico */ }
}

// Con el código de Firestore delante (p. ej. "resource-exhausted: Quota exceeded.")
const texto = v => (v instanceof Error ? (v.code ? `${v.code}: ` : "") + v.message : typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

// Avisos de Firestore que solo salen por consola y hay que enterarse: listeners
// que fallan, permisos, consultas sin su índice compuesto (failed-precondition,
// pasa si se despliega la app antes que firestore.indexes.json) y la cuota
// diaria del plan gratuito agotada (resource-exhausted: la app deja de cargar).
const AVISO_FIRESTORE = /Uncaught Error in snapshot listener|FirebaseError|permission-denied|Missing or insufficient permissions|failed-precondition|requires an index|resource-exhausted|Quota exceeded/i;
export const esAvisoFirestore = msg => AVISO_FIRESTORE.test(String(msg || ""));

export function initErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", e => {
    if (!e.error && /ResizeObserver loop/.test(e.message || "")) return; // aviso inofensivo del navegador
    reportError({ tipo: "excepción", mensaje: e.message || texto(e.error), stack: e.error?.stack });
  });
  window.addEventListener("unhandledrejection", e => {
    reportError({ tipo: "promesa", mensaje: texto(e.reason), stack: e.reason?.stack });
  });
  vigilarLentitud();
  // Firestore avisa de ciertos fallos solo por consola (no lanzan excepción)
  const orig = console.error.bind(console);
  console.error = (...args) => {
    orig(...args);
    const msg = args.map(texto).join(" ");
    if (esAvisoFirestore(msg)) {
      reportError({ tipo: "firestore", mensaje: msg, stack: args.find(a => a instanceof Error)?.stack || new Error().stack });
    }
  };
}

// ── Pantallas lentas ─────────────────────────────────────────────────
// Se apuntan como tipo «lentitud» (no avisan al móvil, se ven en el panel
// Salud): una pantalla que se queda congelada más de 2 s seguidos, o una
// página que tarda más de 6 s en enseñar lo principal.
export const CONGELADA_MS = 2000, CARGA_LENTA_MS = 6000;
const seg = ms => (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 });
export const textoCongelada = (ms, pagina) => `Pantalla congelada ${seg(ms)} s en ${pagina || "/"}`;
export const textoCargaLenta = (ms, pagina) => `Carga lenta: ${seg(ms)} s hasta ver ${pagina || "/"}`;
function vigilarLentitud() {
  if (typeof PerformanceObserver === "undefined") return;
  const pagina = () => location.pathname.split("/").slice(0, 2).join("/") || "/";
  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) if (e.duration >= CONGELADA_MS) reportError({ tipo: "lentitud", mensaje: textoCongelada(e.duration, pagina()), stack: `duración ${Math.round(e.duration)} ms` });
    }).observe({ type: "longtask", buffered: true });
  } catch { /* navegador sin longtask (Safari, Firefox) */ }
  try {
    let ultima = 0;
    const po = new PerformanceObserver(l => { const e = l.getEntries().at(-1); if (e) ultima = e.startTime; });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => { if (ultima >= CARGA_LENTA_MS) { reportError({ tipo: "lentitud", mensaje: textoCargaLenta(ultima, pagina()), stack: `LCP ${Math.round(ultima)} ms` }); ultima = 0; } }, 20_000);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && ultima >= CARGA_LENTA_MS) { reportError({ tipo: "lentitud", mensaje: textoCargaLenta(ultima, pagina()), stack: `LCP ${Math.round(ultima)} ms` }); ultima = 0; }
    });
  } catch { /* sin LCP */ }
}

/** Últimos errores (solo superadmin puede leerlos). */
export function watchErrors(n, cb) {
  return onSnapshot(query(collection(db, "errores"), orderBy("atMs", "desc"), limit(n)),
    snap => cb(snap.docs.map(d => ({ _id: d.id, ...d.data() }))),
    err => cb(null, err));
}

/** Agrupa errores iguales: [{ key, mensaje, veces, usuarios, ultimo, ejemplo }] */
export function groupErrors(list) {
  const g = new Map();
  for (const e of list || []) {
    const key = errorKey(e.mensaje, e.stack);
    const cur = g.get(key) || { key, mensaje: e.mensaje, veces: 0, usuarios: new Set(), paginas: new Set(), ultimo: 0, ejemplo: e };
    cur.veces++; cur.usuarios.add(e.nombre || e.uid); if (e.pagina) cur.paginas.add(e.pagina);
    if ((e.atMs || 0) > cur.ultimo) { cur.ultimo = e.atMs || 0; cur.ejemplo = e; }
    g.set(key, cur);
  }
  return [...g.values()].sort((a, b) => b.ultimo - a.ultimo);
}
