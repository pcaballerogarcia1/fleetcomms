// Lee un GTFS en segundo plano: la red de Roma son 235 MB de horarios sin
// comprimir; en el hilo principal congelaría la página.
//   modo "red": red de líneas regulares (gtfs-red.js)
//   modo "paradas": paradas y líneas para el mapa de puntos (gtfs-parse.js)
import { parseGtfs } from "./gtfs-parse.js";
import { parseGtfsRed } from "./gtfs-red.js";

self.onmessage = async e => {
  const { file, modo = "paradas" } = e.data instanceof Blob ? { file: e.data } : e.data;
  try {
    const leer = modo === "red" ? parseGtfsRed : parseGtfs;
    const resultado = await leer(file, {
      onProgress: (f, texto) => self.postMessage({ tipo: "progreso", f, texto }),
    });
    self.postMessage({ tipo: "ok", resultado });
  } catch (err) {
    self.postMessage({ tipo: "error", error: err?.message || String(err) });
  }
};
