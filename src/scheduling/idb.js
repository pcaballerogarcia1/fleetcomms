// Guardado del escenario completo en IndexedDB (sobrevive a recargar).
// (Separado de scheduling.jsx sin cambiar su comportamiento.)

// ── IndexedDB: persist full VRP schedule across page reloads ─────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("vrp_cache", 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore("schedules");
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  });
}
export async function idbSave(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("schedules", "readwrite");
      tx.objectStore("schedules").put(value, key);
      tx.oncomplete = () => res();
      tx.onerror    = e => rej(e);
    });
  } catch { /* non-critical */ }
}
export async function idbLoad(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const tx  = db.transaction("schedules", "readonly");
      const req = tx.objectStore("schedules").get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror   = e => rej(e);
    });
  } catch { return null; }
}
