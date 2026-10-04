// Lanza la lectura de un GTFS en un Web Worker (gtfs.worker.js).
// modo "red" → { paradas, lineas (con sentidos), dias, agencias }
// modo "paradas" → { paradas, lineas, agencias }
export function leerGtfs(file, onProgress = () => {}, modo = "paradas") {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./gtfs.worker.js", import.meta.url), { type: "module" });
    w.onmessage = e => {
      const m = e.data;
      if (m.tipo === "progreso") return onProgress(m.f, m.texto);
      w.terminate();
      if (m.tipo === "ok") resolve(m.resultado);
      else reject(new Error(m.error));
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || "No se ha podido leer el GTFS")); };
    w.postMessage({ file, modo });
  });
}
