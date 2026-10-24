// POST /api/usuario-clave — un admin (o intermedio, para conductores) de una
// empresa cambia la contraseña del acceso a la app de uno de sus
// trabajadores, o lo bloquea/desbloquea. Desde el navegador no se puede
// cambiar la contraseña de otra persona: hace falta la cuenta de servicio
// (FIREBASE_CUENTA_SERVICIO). Sin ella responde { configurado: false }.
import { verificarToken, AvisoError } from "./_avisos/core.js";
import { cuentaServicio, firestore, tokenGoogle } from "./_salud/google.js";

const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];

/** ¿Puede `yo` gestionar el acceso de `otro`? (misma empresa; intermedio solo conductores) */
export function puedeGestionar(yo, otro) {
  if (!yo || !otro) return false;
  if (yo.activo === false) return false;
  if (yo.rol === "superadmin") return otro.rol !== "superadmin";
  if (!yo.org_id || yo.org_id !== otro.org_id) return false;
  if (yo.rol === "admin") return otro.rol !== "superadmin";
  if (yo.rol === "intermedio") return otro.rol === "conductor";
  return false;
}

/** Lo que se pide: { uid, clave?, bloquear? } */
export function leerPeticion(body) {
  const b = typeof body === "string" ? JSON.parse(body || "{}") : (body || {});
  const uid = String(b.uid || "");
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new AvisoError(400, "Falta el usuario");
  const out = { uid };
  if (b.clave != null) {
    const clave = String(b.clave);
    if (clave.length < 6 || clave.length > 128) throw new AvisoError(400, "La contraseña tiene que tener al menos 6 caracteres");
    out.clave = clave;
  }
  if (b.bloquear != null) out.bloquear = !!b.bloquear;
  if (out.clave == null && out.bloquear == null) throw new AvisoError(400, "No se pide nada");
  return out;
}

/** El cambio en Firebase Auth (Identity Toolkit, como administrador) */
export async function actualizarCuenta(sa, { uid, clave, bloquear }, f = fetch) {
  const token = await tokenGoogle(sa, "https://www.googleapis.com/auth/cloud-platform", f);
  const cuerpo = { localId: uid };
  if (clave != null) cuerpo.password = clave;
  if (bloquear != null) cuerpo.disableUser = bloquear;
  const r = await f(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new AvisoError(r.status === 400 ? 400 : 502, `No se pudo cambiar: ${j.error?.message || r.status}`);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new AvisoError(405, "Solo POST");
    const yoUid = await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const sa = cuentaServicio();
    if (!sa) return res.status(200).json({ configurado: false });
    const pet = leerPeticion(req.body);
    const fs = firestore(sa);
    const [yo, otro] = await Promise.all([fs.leer(`usuarios/${yoUid}`), fs.leer(`usuarios/${pet.uid}`)]);
    if (!puedeGestionar(yo, otro)) throw new AvisoError(403, "No puedes gestionar el acceso de este usuario");
    await actualizarCuenta(sa, pet);
    return res.status(200).json({ configurado: true, ok: true });
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Usuario-clave:", e);
    return res.status(500).json({ error: "Error interno" });
  }
}
