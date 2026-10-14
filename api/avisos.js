/* global process */
// POST /api/avisos — envía un aviso a los móviles de unos conductores
// (ver _avisos/core.js y src/avisos.js). Claves en las variables de entorno
// de Vercel: VAPID_PUBLICA y VAPID_PRIVADA.
import webpush from "web-push";
import { AvisoError, enviarATodos, parsePeticion, verificarToken } from "./_avisos/core.js";

// producción y pruebas (cada token solo vale para su proyecto)
const PROYECTOS = [process.env.FIREBASE_PROJECT_ID, process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { VAPID_PUBLICA, VAPID_PRIVADA } = process.env;
    if (!VAPID_PUBLICA || !VAPID_PRIVADA) throw new AvisoError(503, "Los avisos al móvil no están configurados en el servidor");
    await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const p = parsePeticion(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    webpush.setVapidDetails("mailto:avisos@operanzia.com", VAPID_PUBLICA, VAPID_PRIVADA);
    const r = await enviarATodos(p.subs, p.mensaje, (s, texto) => webpush.sendNotification(s, texto, { TTL: 60 * 60 * 12, urgency: "high" }));
    return res.status(200).json(r);
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Avisos:", e);
    return res.status(500).json({ error: "Error interno al enviar los avisos" });
  }
}
