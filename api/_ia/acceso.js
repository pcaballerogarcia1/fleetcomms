// Conectar con IA (MCP) · ¿puede este usuario usar su IA ahora mismo? Se mira
// en cada petición (no solo al conectar), así que quitar el permiso surte
// efecto al momento:
//  - su sesión de Operanzia sigue valiendo (no se ha dado de baja ni cambiado la contraseña),
//  - su empresa tiene «Conectar con IA» activado y su rol está entre los permitidos,
//  - y su conexión no se ha desconectado (él o un admin).
import { motivoSinAcceso, nivelDe } from "../../src/ia/datos.js";
import { idTokenDe, firestoreUsuario } from "./firestore-usuario.js";

/** Sin acceso. `reconectar`: la sesión o la conexión ya no valen (la IA tiene que volver a iniciar sesión);
 *  si no, es la empresa la que no lo permite ahora (se le explica a la IA, sin desconectarla). */
export class AccesoError extends Error {
  constructor(motivo, reconectar = false) { super(motivo); this.acceso = true; this.reconectar = reconectar; }
}

/**
 * Comprueba todo y devuelve { fs, uid, org, nivel, perfil, conexion }.
 * @param conexionId la conexión de esta IA (null al canjear el código, cuando aún no existe)
 */
export async function comprobarAcceso({ sesion, conexionId = null, firebase, f = fetch }) {
  let tk;
  try { tk = await idTokenDe(sesion, firebase.apiKey, f); }
  catch (e) { if (e.sesionCaducada) throw new AccesoError(e.message, true); throw e; }
  const fs = firestoreUsuario(tk.idToken, firebase.projectId, f);
  const perfil = await fs.leer(`usuarios/${tk.uid}`);
  const ajustes = perfil?.org_id ? await fs.leer(`ia_ajustes/${perfil.org_id}`) : null;
  let conexion = null;
  if (conexionId) {
    conexion = await fs.leer(`ia_conexiones/${conexionId}`);
    if (!conexion || conexion.uid !== tk.uid || conexion.activa !== true) throw new AccesoError("Esta conexión con la IA se ha desconectado en Operanzia. Vuelve a conectarla.", true);
  }
  const motivo = motivoSinAcceso(perfil, ajustes);
  if (motivo) throw new AccesoError(motivo);
  return { fs, uid: tk.uid, org: perfil.org_id, nivel: nivelDe(ajustes), ubicacion: ajustes?.ubicacion === true, perfil, conexion };
}
