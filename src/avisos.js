// Avisos al móvil (notificaciones push) — la parte de la app.
//  · El conductor los activa una vez en su móvil (activarAvisos): el navegador
//    da una «suscripción» que se guarda en avisos_suscripciones/{uid}.
//  · La oficina, al publicar rutas o desde Control, llama a enviarAvisos con
//    los conductores; se leen sus suscripciones y /api/avisos las envía
//    (con las claves del servidor). Las caducadas se borran.
// En iPhone solo funcionan con la app instalada en la pantalla de inicio.
import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "./firebase.js";

// Clave pública del servidor de avisos (la privada está solo en Vercel)
export const VAPID_PUBLICA = import.meta.env?.VITE_VAPID_PUBLICA || "BPsPP0B82zF9H8FuWk8YkMnAHj29SiB_OJBDo_jDhlh11WxFr1imOtBSKS4QeDX1X4vn0ow96PoDgruPrBPdUHE";
const ref = uid => doc(db, "avisos_suscripciones", uid);

export const soportaAvisos = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const esIphoneSinInstalar = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent)
  && !(window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone);

function claveABytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/** «activos» | «sin-activar» | «bloqueados» | «no-soportado» */
export async function estadoAvisos() {
  if (!soportaAvisos()) return "no-soportado";
  if (Notification.permission === "denied") return "bloqueados";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "activos" : "sin-activar";
}

/** Pide permiso, se suscribe y guarda la suscripción de este móvil */
export async function activarAvisos(sesion) {
  if (!soportaAvisos()) throw new Error("Este navegador no admite avisos");
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error(permiso === "denied" ? "Has bloqueado los avisos: actívalos en los ajustes del navegador" : "No se ha dado permiso");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(VAPID_PUBLICA) });
  const j = sub.toJSON();
  const uid = sesion.id || sesion.uid;
  await setDoc(ref(uid), {
    uid, org_id: sesion.org_id ?? null, nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" "),
    subs: arrayUnion({ endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent.slice(0, 120), alta: Date.now() }),
    actualizado: Date.now(),
  }, { merge: true });
  return "activos";
}

/** Un aviso de prueba a uno mismo */
export async function avisoDePrueba(sesion) {
  return enviarAvisos(sesion.org_id, [sesion.id || sesion.uid], { titulo: "Avisos activados", cuerpo: "Así te llegarán las rutas nuevas y los mensajes de la oficina.", url: "/rutas" });
}

/**
 * Envía un aviso a unos conductores (uids) o a todos los de la organización ("todos").
 * @returns { enviados, sinAvisos, fallidos } — sinAvisos: a cuántos no les llega (no los han activado)
 */
export async function enviarAvisos(orgId, uids, mensaje) {
  let docs;
  if (uids === "todos") docs = (await getDocs(query(collection(db, "avisos_suscripciones"), where("org_id", "==", orgId)))).docs.map(d => d.data());
  else {
    const unicos = [...new Set(uids.filter(Boolean))];
    docs = (await Promise.all(unicos.map(u => getDoc(ref(u)).then(s => (s.exists() ? s.data() : { uid: u, subs: [] }), () => ({ uid: u, subs: [] })))));
  }
  const subs = docs.flatMap(d => (d.subs || []).map(s => ({ ...s, _uid: d.uid })));
  const sinAvisos = docs.filter(d => !(d.subs || []).length).length;
  if (!subs.length) return { enviados: 0, sinAvisos, fallidos: 0 };
  const token = await auth.currentUser?.getIdToken();
  let enviados = 0, fallidos = 0;
  for (let i = 0; i < subs.length; i += 500) {
    const lote = subs.slice(i, i + 500);
    const r = await fetch("/api/avisos", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subs: lote.map(({ endpoint, keys }) => ({ endpoint, keys })), ...mensaje }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `el servidor de avisos respondió ${r.status}`);
    enviados += j.enviados || 0; fallidos += j.fallidos || 0;
    // móviles que ya no existen o quitaron el permiso: fuera
    for (const endpoint of j.caducados || []) {
      const s = lote.find(x => x.endpoint === endpoint);
      if (s) updateDoc(ref(s._uid), { subs: arrayRemove({ endpoint: s.endpoint, keys: s.keys, ua: s.ua, alta: s.alta }) }).catch(() => {});
    }
  }
  return { enviados, sinAvisos, fallidos };
}

/** Texto corto del resultado para la oficina */
export const resumenEnvio = r => `${r.enviados} aviso(s) enviados${r.sinAvisos ? ` · ${r.sinAvisos} persona(s) sin avisos activados en su móvil` : ""}${r.fallidos ? ` · ${r.fallidos} no llegaron` : ""}`;
