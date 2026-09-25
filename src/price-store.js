// ── Precios por punto (solo administradores) ─────────────────────────
// Colección aparte de todo lo demás para que las reglas de Firestore
// permitan leerla y escribirla SOLO a administradores (ni intermedio ni
// conductores), no solo ocultarla en pantalla:
//
//   precios/{projectId}              { org_id, projectId, defaultPrecio }
//   precios/{projectId}/trozos/{0..7} { org_id, projectId, map: { puntoKey: € } }
//
// Los puntos se reparten en 8 trozos por un hash de su clave: cambiar el
// precio de un punto escribe solo en su trozo, y 44.000 puntos caben de
// sobra (≈ 5.500 por trozo, muy lejos del límite de 1 MB).
// puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}` (la misma clave que
// Timetable y las paradas publicadas en Rutas).

import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot, deleteField, serverTimestamp } from "firebase/firestore";

export const PRICE_PARTS = 8;

export const puntoKeyOf = (lat, lng) => `${(+lat).toFixed(5)}_${(+lng).toFixed(5)}`;

export function partOf(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PRICE_PARTS;
}

// Precio que aplica a un punto: el suyo propio o, si no tiene, el de por defecto
export function effectivePrice(prices, key) {
  const own = prices?.byKey?.get(key);
  if (own != null) return own;
  return prices?.defaultPrecio ?? null;
}

// Escucha en vivo los precios de un proyecto → cb({ defaultPrecio, byKey: Map, ready })
export function listenPrices(projectId, cb) {
  let defaultPrecio = null;
  const parts = Array.from({ length: PRICE_PARTS }, () => ({}));
  let got = 0;
  const seen = new Set();
  const emit = () => {
    const byKey = new Map();
    for (const p of parts) for (const [k, v] of Object.entries(p)) if (typeof v === "number") byKey.set(k, v);
    cb({ defaultPrecio, byKey, ready: got >= PRICE_PARTS + 1 });
  };
  const mark = id => { if (!seen.has(id)) { seen.add(id); got++; } };
  const unsubs = [
    onSnapshot(doc(db, "precios", projectId), s => {
      defaultPrecio = s.exists() && typeof s.data().defaultPrecio === "number" ? s.data().defaultPrecio : null;
      mark("main"); emit();
    }, () => { mark("main"); emit(); }),
    ...parts.map((_, i) => onSnapshot(doc(db, "precios", projectId, "trozos", String(i)), s => {
      parts[i] = s.exists() ? (s.data().map || {}) : {};
      mark(i); emit();
    }, () => { mark(i); emit(); })),
  ];
  return () => unsubs.forEach(u => u());
}

export async function saveDefaultPrice(projectId, orgId, precio) {
  await setDoc(doc(db, "precios", projectId), {
    org_id: orgId, projectId, defaultPrecio: precio == null ? deleteField() : precio, updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Fija (o borra, con null) el precio de uno o varios puntos: { puntoKey: € | null }
export async function savePointPrices(projectId, orgId, changes) {
  const byPart = new Map();
  for (const [key, precio] of Object.entries(changes)) {
    const p = partOf(key);
    if (!byPart.has(p)) byPart.set(p, {});
    byPart.get(p)[key] = precio == null ? deleteField() : precio;
  }
  await Promise.all([...byPart].map(([p, map]) =>
    setDoc(doc(db, "precios", projectId, "trozos", String(p)), { org_id: orgId, projectId, map }, { merge: true })));
}

export const fmtEur = n => (n ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
