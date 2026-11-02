// Fotos y firmas de las entregas: se guardan primero EN EL MÓVIL (IndexedDB,
// que aguanta fotos; el almacén pequeño del navegador no) y se envían solas a
// la base de datos en cuanto hay cobertura, aunque se cierre la app. Volver a
// enviar una no duplica nada: cada una tiene su id fijo (datos.js idPrueba).
// La oficina las lee de entregas_pruebas.
import { Bytes, collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { MAX_BYTES_PRUEBA, idPrueba } from "./datos.js";

const BD = "operanzia_entregas", ALMACEN = "pendientes";
const REINTENTO_MS = 20_000;

function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(ALMACEN, { keyPath: "id" });
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}
async function conAlmacen(modo, f) {
  const bd = await abrir();
  return new Promise((res, rej) => {
    const tx = bd.transaction(ALMACEN, modo);
    const r = f(tx.objectStore(ALMACEN));
    tx.oncomplete = () => res(r?.result);
    tx.onerror = e => rej(e.target.error);
  });
}
const poner = p => conAlmacen("readwrite", s => s.put(p));
const quitar = id => conAlmacen("readwrite", s => s.delete(id));
const todas = () => conAlmacen("readonly", s => s.getAll());

// ── Enviar ──
const oyentes = new Set();
let enviando = false, otraVez = false, timer = null, pendientesN = 0;
const avisar = () => oyentes.forEach(f => f(pendientesN));
/** Escucha cuántas fotos/firmas quedan por enviar */
export function escucharPendientes(f) { oyentes.add(f); f(pendientesN); return () => oyentes.delete(f); }

async function enviarUna(p) {
  await setDoc(doc(db, "entregas_pruebas", p.id), {
    org_id: p.org_id, planId: p.planId, ubicId: String(p.ubicId), tipo: p.tipo, k: p.k, mime: p.mime,
    data: Bytes.fromUint8Array(new Uint8Array(p.bytes)), uid: p.uid, en: p.en,
  });
}

/** Envía todo lo pendiente (se llama sola; también al volver la red) */
export async function enviarPendientes() {
  if (enviando) { otraVez = true; return; } // lo que llegue mientras se envía, en cuanto acabe
  enviando = true; otraVez = false;
  try {
    const lista = (await todas()).sort((a, b) => a.en - b.en);
    pendientesN = lista.length; avisar();
    for (const p of lista) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      try { await enviarUna(p); }
      catch (e) {
        if (e?.code === "permission-denied") { /* no se podrá nunca (otra empresa, sesión cambiada): se descarta */ }
        else break; // sin cobertura: más tarde
      }
      await quitar(p.id);
      pendientesN = Math.max(0, pendientesN - 1); avisar();
    }
  } catch { /* sin IndexedDB: nada que enviar */ }
  finally {
    enviando = false;
    clearTimeout(timer);
    if (otraVez) setTimeout(enviarPendientes, 0);
    else if (pendientesN > 0) timer = setTimeout(enviarPendientes, REINTENTO_MS);
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => enviarPendientes());
  setTimeout(() => enviarPendientes(), 1500); // lo que quedó de otra vez
}

/**
 * Guarda una foto o la firma de una parada en el móvil y la envía en cuanto se pueda.
 * @param blob la imagen ya comprimida (comprimirFoto / la firma en JPEG)
 */
export async function guardarPrueba({ orgId, planId, ubicId, tipo, k = 0, blob, uid }) {
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES_PRUEBA) throw new Error("La imagen es demasiado grande");
  const p = { id: idPrueba(planId, ubicId, tipo, k), org_id: orgId, planId, ubicId: String(ubicId), tipo, k, mime: blob.type || "image/jpeg", bytes, uid, en: Date.now() };
  try { await poner(p); }
  catch { await enviarUna(p); return; } // sin IndexedDB (navegador privado): directo
  enviarPendientes();
}

/** Las fotos y la firma de una parada, para la oficina: [{ id, tipo, k, url }] (url: blob:) */
export async function leerPruebas(orgId, planId, ubicId) {
  const s = await getDocs(query(collection(db, "entregas_pruebas"), where("org_id", "==", orgId), where("planId", "==", planId), where("ubicId", "==", String(ubicId))));
  return s.docs.map(d => {
    const x = d.data();
    const bytes = x.data?.toUint8Array ? x.data.toUint8Array() : new Uint8Array();
    return { id: d.id, tipo: x.tipo, k: x.k || 0, en: x.en, url: URL.createObjectURL(new Blob([bytes], { type: x.mime || "image/jpeg" })) };
  }).sort((a, b) => (a.tipo === b.tipo ? a.k - b.k : a.tipo === "firma" ? 1 : -1));
}

// ── Imágenes ──
/** Achica una foto del móvil (hasta 1280 px de lado, JPEG): de 4 MB a unos 150 KB */
export async function comprimirFoto(file, lado = 1280, calidad = 0.6) {
  const img = await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = () => { URL.revokeObjectURL(url); rej(new Error("No se puede leer la foto")); };
    i.src = url;
  });
  const f = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let q = calidad, blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  while (blob && blob.size > MAX_BYTES_PRUEBA && q > 0.25) { q -= 0.15; blob = await new Promise(r => c.toBlob(r, "image/jpeg", q)); }
  return blob;
}

/** La posición del móvil ahora (o null en 6 s si no hay GPS o no deja) */
export function posicionAhora(esperaMs = 6000) {
  return new Promise(res => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    const reloj = setTimeout(() => res(null), esperaMs + 500);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(reloj); res({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }); },
      () => { clearTimeout(reloj); res(null); },
      { enableHighAccuracy: true, timeout: esperaMs, maximumAge: 60_000 },
    );
  });
}
