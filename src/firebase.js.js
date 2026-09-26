import { initializeApp } from "firebase/app";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy, where, setDoc, getDoc, getDocFromServer,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Producción por defecto. Un entorno de pruebas (otro proyecto de
// Firebase, p. ej. en los despliegues de vista previa de Vercel) se
// configura con las variables VITE_FIREBASE_* — ver ENTORNO_PRUEBAS.md.
const env = import.meta.env || {};
const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY             || "AIzaSyDqzT7OqBTlNApkB_ERriA6Eag7MQLMQcM",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN         || "fleetcomms-13d89.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID          || "fleetcomms-13d89",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET      || "fleetcomms-13d89.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "724829938531",
  appId:             env.VITE_FIREBASE_APP_ID              || "1:724829938531:web:9c426744e7be116589a956",
};

const app = initializeApp(firebaseConfig);
// Caché de Firestore según qué parte de la app se carga (main.jsx elige el
// árbol por la URL inicial, y el paso a /rutas recarga la página):
//  - App del conductor (/rutas, /incidencias, /inventario): caché persistente
//    en IndexedDB — abre al instante y funciona sin cobertura.
//  - Oficina (Planning, Scheduling, Rostering, Control, Analytics, Superadmin):
//    caché en memoria. La persistente escribía en IndexedDB, en el hilo
//    principal, todo lo descargado — con planes grandes era la mayor parte
//    del bloqueo medido al entrar en Control (4,5 s en un PC normal, "la
//    página no responde"), y en la oficina no hace falta trabajar offline.
const _path = typeof window !== "undefined" ? window.location.pathname : "";
const _isFleetApp = ["/rutas", "/incidencias", "/inventario"].some(p => _path.startsWith(p));
export const db = initializeFirestore(app, {
  localCache: _isFleetApp
    ? persistentLocalCache({ tabManager: persistentSingleTabManager() })
    : memoryLocalCache(),
});
export const auth = getAuth(app);

// Secondary app for admin user-creation (avoids signing out current session)
const secondaryApp = initializeApp(firebaseConfig, "secondary");
export const secondaryAuth = getAuth(secondaryApp);
export const secondaryDb   = getFirestore(secondaryApp);

// ── COLECCIONES ───────────────────────────────────────────────────
export const COL = {
  orgs:             "orgs",
  incidencias:      "incidencias",
  planes:           "planes",
  inventario:       "inventario",
  movimientos:      "movimientos",
  usuarios:         "usuarios",
  planningLayers:   "planning_layers",
  planningDepots:   "planning_depots",
  planningSettings: "planning_settings",
};

// getDocFromServer fuerza ida y vuelta al servidor (evita leer de una caché
// local que aún no ha sincronizado justo tras iniciar sesión, que cerraba
// la sesión recién abierta creyendo que no había perfil). Pero sin límite
// de tiempo, en una conexión mala (muy típica de un conductor en la calle)
// esa promesa puede quedarse colgada para siempre — la pantalla de login se
// queda "cargando" sin entrar nunca. Con timeout: si el servidor no
// responde a tiempo, cae a getDoc (caché local si existe, o lo que
// Firestore consiga) en vez de colgarse.
export async function getUserProfileSafe(uid, timeoutMs = 8000) {
  const ref = doc(db, "usuarios", uid);
  try {
    return await Promise.race([
      getDocFromServer(ref),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
  } catch {
    return await getDoc(ref);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────

// Escuchar colección filtrada por org_id (sin orderBy → no requiere índice compuesto)
export function listenCol(colName, callback, orderField = "fecha", orgId = null) {
  const constraints = orgId ? [where("org_id", "==", orgId)] : [];
  const q = query(collection(db, colName), ...constraints);
  return onSnapshot(q, snap => {
    const docs = snap.docs
      .map(d => ({ ...d.data(), _id: d.id }))
      .sort((a, b) => {
        const av = a[orderField], bv = b[orderField];
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        const am = av?.toMillis ? av.toMillis() : (typeof av === "number" ? av : 0);
        const bm = bv?.toMillis ? bv.toMillis() : (typeof bv === "number" ? bv : 0);
        return bm - am; // desc
      });
    callback(docs);
  });
}

export async function addItem(colName, data) {
  return await addDoc(collection(db, colName), { ...data, fecha: serverTimestamp() });
}
export async function updateItem(colName, id, data) {
  return await updateDoc(doc(db, colName, id), data);
}
export async function deleteItem(colName, id) {
  return await deleteDoc(doc(db, colName, id));
}
export async function setItem(colName, id, data) {
  return await setDoc(doc(db, colName, id), data, { merge: true });
}
