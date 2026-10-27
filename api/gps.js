// POST /api/gps — posiciones de la flota desde el GPS de la empresa (ver
// _gps/proveedores.js). Lo llama Control mientras está abierto: no se guarda
// nada en la base de datos (así no gasta cuota). Solo con sesión de Operanzia.
import { AvisoError, verificarToken } from "./_avisos/core.js";
import { GpsError, posiciones } from "./_gps/proveedores.js";

const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];
const ESPERA_MS = 15000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const fetchConEspera = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(ESPERA_MS) });
    const vehiculos = await posiciones(String(b.proveedor || ""), b.cred || {}, fetchConEspera);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ vehiculos, hora: Date.now() });
  } catch (e) {
    if (e instanceof AvisoError || e instanceof GpsError) return res.status(e.status).json({ error: e.message });
    if (e?.name === "TimeoutError") return res.status(504).json({ error: "El GPS tarda demasiado en responder" });
    console.error("GPS:", e?.message || e);
    return res.status(500).json({ error: "Error interno al leer el GPS" });
  }
}
