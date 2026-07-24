import { initializeApp } from "firebase/app";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy, where, setDoc, getDoc, getDocFromServer,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDqzT7OqBTlNApkB_ERriA6Eag7MQLMQcM",
  authDomain: "fleetcomms-13d89.firebaseapp.com",
  projectId: "fleetcomms-13d89",
  storageBucket: "fleetcomms-13d89.firebasestorage.app",
  messagingSenderId: "724829938531",
  appId: "1:724829938531:web:9c426744e7be116589a956",
};

const app = initializeApp(firebaseConfig);
// Offline persistence: data loads from local IndexedDB cache instantly,
// syncs with Firestore in background — prevents disappearing data on slow mobile networks
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
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
