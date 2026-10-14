// GET /api/salud — para el panel «Salud» del superadmin: el consumo de
// Firestore de hoy frente al límite diario del plan gratuito (Cloud
// Monitoring). Solo para superadmin. Necesita FIREBASE_CUENTA_SERVICIO.
import { verificarToken, AvisoError } from "./_avisos/core.js";
import { consumoHoy, cuentaServicio, firestore } from "./_salud/google.js";

const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];

export default async function handler(req, res) {
  try {
    const uid = await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const sa = cuentaServicio();
    if (!sa) return res.status(200).json({ configurado: false });
    const yo = await firestore(sa).leer(`usuarios/${uid}`);
    if (yo?.rol !== "superadmin") throw new AvisoError(403, "Solo para superadmin");
    try {
      return res.status(200).json({ configurado: true, proyecto: sa.project_id, consumo: await consumoHoy(sa) });
    } catch (e) {
      return res.status(200).json({ configurado: true, proyecto: sa.project_id, consumo: null, errorConsumo: e.status === 403 ? "La cuenta de servicio no tiene permiso para leer el consumo (rol «Monitoring Viewer»)" : e.message });
    }
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Salud:", e);
    return res.status(500).json({ error: "Error interno" });
  }
}
