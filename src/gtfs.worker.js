// Lee un GTFS en segundo plano (ver gtfs-parse.js): la red de Roma son 235 MB
// de horarios sin comprimir; en el hilo principal congelaría la página.
import { parseGtfs } from "./gtfs-parse.js";

self.onmessage = async e => {
  try {
    const resultado = await parseGtfs(e.data, {
      onProgress: (f, texto) => self.postMessage({ tipo: "progreso", f, texto }),
    });
    self.postMessage({ tipo: "ok", resultado });
  } catch (err) {
    self.postMessage({ tipo: "error", error: err?.message || String(err) });
  }
};
