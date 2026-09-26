// ── Quién está conectado ─────────────────────────────────────────────
// Cada sesión abierta (workspace de oficina o app de Rutas) escribe su
// ficha en  presencia/{uid}  al entrar y luego cada minuto ("latido").
// Se considera conectado a quien tiene online:true y un latido de hace
// menos de 2,5 min — así, si se cierra el navegador de golpe o el móvil
// suspende la app, desaparece solo sin necesidad de avisar al salir.
//
// Cada uno ve solo a los de su organización (reglas de Firestore); el
// superadmin ve a todos.

import { db } from "./firebase.js";
import { doc, setDoc, updateDoc, onSnapshot, query, collection, where, getDocs, serverTimestamp } from "firebase/firestore";

export const HEARTBEAT_MS = 60_000;
export const ONLINE_WINDOW_MS = 150_000;

const ref = uid => doc(db, "presencia", uid);

export function presenceData(sesion, app, pagina) {
  return {
    uid: sesion.uid,
    org_id: sesion.org_id ?? null,
    nombre: sesion.nombre ?? "",
    apellidos: sesion.apellidos ?? "",
    rol: sesion.rol ?? "",
    app, pagina: pagina ?? "",
    online: true,
    lastSeen: serverTimestamp(),
  };
}

/** Empieza a latir. Devuelve la función para parar (y marcar desconectado). */
export function startPresence(sesion, app, getPagina = () => window.location.pathname) {
  if (!sesion?.uid) return () => {};
  const beat = () => setDoc(ref(sesion.uid), presenceData(sesion, app, getPagina())).catch(() => {});
  beat();
  const id = setInterval(beat, HEARTBEAT_MS);
  const onHide = () => markOffline(sesion.uid);
  // Al volver a la pestaña/app, latido inmediato (los temporizadores de
  // una pestaña en segundo plano o de un móvil suspendido van con retraso)
  const onVisible = () => { if (document.visibilityState === "visible") beat(); };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export const markOffline = uid =>
  uid ? updateDoc(ref(uid), { online: false, lastSeen: serverTimestamp() }).catch(() => {}) : Promise.resolve();

export const updatePresencePage = (uid, pagina) =>
  uid ? updateDoc(ref(uid), { pagina }).catch(() => {}) : Promise.resolve();

const millis = t => (t?.toMillis ? t.toMillis() : null);

/** Conectados según las fichas (función pura, para los tests) */
export function onlineFrom(docs, now = Date.now(), selfUid = null) {
  return docs
    .filter(d => d.online && d.uid !== selfUid)
    .filter(d => { const m = millis(d.lastSeen); return m != null && now - m < ONLINE_WINDOW_MS; })
    .sort((a, b) =>
      (a.app === "oficina" ? 0 : 1) - (b.app === "oficina" ? 0 : 1) ||
      `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`));
}

/** Escucha las fichas visibles para esta sesión: las de su organización,
 *  o todas si es superadmin. */
export function watchPresence(sesion, cb) {
  if (!sesion?.uid) return () => {};
  const base = collection(db, "presencia");
  const q = sesion.rol === "superadmin"
    ? query(base, where("online", "==", true))
    : sesion.org_id
      ? query(base, where("org_id", "==", sesion.org_id), where("online", "==", true))
      : null;
  if (!q) return () => {};
  return onSnapshot(q,
    snap => cb(snap.docs.map(d => d.data({ serverTimestamps: "estimate" }))),
    err => console.warn("presencia:", err.code || err));
}

/** Nombres de las organizaciones (solo para el superadmin) */
export async function orgNames() {
  const snap = await getDocs(collection(db, "orgs"));
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data().nombre || d.id]));
}

export const initialsOf = p =>
  (((p?.nombre || "")[0] || "") + ((p?.apellidos || "")[0] || "")).toUpperCase() || "?";

export function haceCuanto(ts, now = Date.now()) {
  const m = millis(ts);
  if (m == null) return "";
  const s = Math.max(0, Math.round((now - m) / 1000));
  return s < 60 ? "ahora" : `hace ${Math.round(s / 60)} min`;
}
