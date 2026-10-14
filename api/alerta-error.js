// POST /api/alerta-error { id } — el navegador que acaba de registrar un
// error (errores/{id}) pide que se avise al móvil del superadmin. El servidor
// lee el error él mismo (no se fía del texto que le manden), comprueba que es
// de quien llama, decide si toca avisar (ver _salud/alertas.js) y lo envía.
// Necesita FIREBASE_CUENTA_SERVICIO, VAPID_PUBLICA y VAPID_PRIVADA.
import webpush from "web-push";
import { verificarToken, enviarATodos, AvisoError } from "./_avisos/core.js";
import { cuentaServicio, firestore } from "./_salud/google.js";
import { claveError, decidir, diaDe, idDeClave, mensajeAlerta } from "./_salud/alertas.js";

const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const uid = await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const sa = cuentaServicio();
    const { VAPID_PUBLICA, VAPID_PRIVADA } = globalThis.process.env;
    if (!sa || !VAPID_PUBLICA || !VAPID_PRIVADA) return res.status(200).json({ avisado: false, motivo: "sin configurar" });
    const id = String((typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}).id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new AvisoError(400, "id no válido");
    const fs = firestore(sa);
    const error = await fs.leer(`errores/${id}`);
    if (!error || error.uid !== uid) return res.status(200).json({ avisado: false, motivo: "no es suyo" });
    const ahora = Date.now();
    const clave = idDeClave(claveError(error.mensaje, error.stack));
    const [estado, dia] = await Promise.all([fs.leer(`alertas_estado/${clave}`), fs.leer(`alertas_estado/dia_${diaDe(ahora)}`)]);
    const d = decidir(error, estado, dia, ahora);
    await fs.escribir(`alertas_estado/${clave}`, { ultimo: d.avisar ? ahora : estado?.ultimo || 0, veces: (estado?.veces || 0) + 1, mensaje: String(error.mensaje || "").slice(0, 200) });
    if (!d.avisar) return res.status(200).json({ avisado: false, motivo: d.motivo });
    // los superadmin y sus móviles
    const admins = await fs.buscar("usuarios", "rol", "superadmin");
    const subs = (await Promise.all(admins.map(a => fs.leer(`avisos_suscripciones/${a._id}`)))).flatMap(s => s?.subs || []).filter(s => s?.endpoint && s?.keys);
    if (!subs.length) return res.status(200).json({ avisado: false, motivo: "ningún superadmin con avisos activados" });
    const org = error.org_id ? await fs.leer(`orgs/${error.org_id}`).catch(() => null) : null;
    webpush.setVapidDetails("mailto:avisos@operanzia.com", VAPID_PUBLICA, VAPID_PRIVADA);
    const r = await enviarATodos(subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })), mensajeAlerta(error, org?.nombre, estado?.veces || 0),
      (s, texto) => webpush.sendNotification(s, texto, { TTL: 60 * 60 * 24, urgency: "high" }));
    await fs.escribir(`alertas_estado/dia_${diaDe(ahora)}`, { n: (dia?.n || 0) + 1 });
    return res.status(200).json({ avisado: r.enviados > 0, ...r });
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Alerta de error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
}
