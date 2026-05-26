import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDqzT7OqBTlNApkB_ERriA6Eag7MQLMQcM",
  authDomain: "fleetcomms-13d89.firebaseapp.com",
  projectId: "fleetcomms-13d89",
  storageBucket: "fleetcomms-13d89.firebasestorage.app",
  messagingSenderId: "724829938531",
  appId: "1:724829938531:web:9c426744e7be116589a956",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ── COLECCIONES ───────────────────────────────────────────────────
export const COL = {
  incidencias: "incidencias",
  planes:      "planes",
  inventario:  "inventario",
  movimientos: "movimientos",
  usuarios:    "usuarios",
};

// ── HELPERS ───────────────────────────────────────────────────────

// Escuchar cambios en tiempo real
export function listenCol(colName, callback, orderField = "fecha") {
  const q = query(collection(db, colName), orderBy(orderField, "desc"));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ ...d.data(), _id: d.id })));
  });
}

// Añadir documento
export async function addItem(colName, data) {
  return await addDoc(collection(db, colName), {
    ...data,
    fecha: serverTimestamp(),
  });
}

// Actualizar documento
export async function updateItem(colName, id, data) {
  return await updateDoc(doc(db, colName, id), data);
}

// Eliminar documento
export async function deleteItem(colName, id) {
  return await deleteDoc(doc(db, colName, id));
}
