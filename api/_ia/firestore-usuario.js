// Conectar con IA (MCP) · leer y escribir en Firestore COMO EL USUARIO: con su
// sesión de Firebase (la que autorizó al conectar su IA). Así las reglas de
// siempre deciden qué ve: lo mismo que en la app, solo de su empresa. El
// servidor no tiene ninguna llave maestra.
import { aValor, desdeCampos } from "../_salud/google.js";

const sesiones = new Map(); // sesión de Firebase → { idToken, uid, hasta }

/** Una clave de Firebase (1 h) a partir de la sesión del usuario; error si ya no vale (baja, contraseña cambiada…) */
export async function idTokenDe(sesion, apiKey, f = fetch) {
  const c = sesiones.get(sesion);
  if (c && c.hasta > Date.now() + 120_000) return c;
  const r = await f(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(sesion)}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw Object.assign(new Error("La sesión de Operanzia ya no es válida: vuelve a conectar"), { sesionCaducada: true });
  const v = { idToken: j.id_token, uid: j.user_id, hasta: Date.now() + Number(j.expires_in || 3600) * 1000 };
  if (sesiones.size > 500) sesiones.clear();
  sesiones.set(sesion, v);
  return v;
}

const OPS = { "==": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL", "in": "IN", "array-contains": "ARRAY_CONTAINS" };

/** Firestore por su API, con la clave del usuario */
export function firestoreUsuario(idToken, projectId, f = fetch) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const cab = { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
  const fallo = async (r, que) => {
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || j[0]?.error?.message || `error ${r.status}`;
    return Object.assign(new Error(`${que}: ${msg}`), { status: r.status, sinPermiso: r.status === 403 });
  };
  return {
    /** un documento, o null si no existe (o no se puede leer) */
    async leer(ruta) {
      const r = await f(`${base}/${ruta}`, { headers: cab });
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw await fallo(r, ruta);
      const j = await r.json();
      return { _id: j.name.split("/").pop(), ...desdeCampos(j.fields) };
    },
    /**
     * documentos de una colección con filtros [[campo, op, valor], …] (todos a la vez).
     * padre: la ruta del documento si es una subcolección; campos: solo esos campos (documentos pesados)
     */
    async consultar(coleccion, filtros = [], limite = 500, { padre = null, campos = null } = {}) {
      const ws = filtros.map(([campo, op, valor]) => ({ fieldFilter: { field: { fieldPath: campo }, op: OPS[op] || op, value: aValor(valor) } }));
      const where = ws.length === 0 ? undefined : ws.length === 1 ? ws[0] : { compositeFilter: { op: "AND", filters: ws } };
      const select = campos ? { select: { fields: campos.map(c => ({ fieldPath: c })) } } : {};
      const r = await f(`${base}${padre ? `/${padre}` : ""}:runQuery`, { method: "POST", headers: cab, body: JSON.stringify({ structuredQuery: { ...select, from: [{ collectionId: coleccion }], ...(where ? { where } : {}), limit: limite } }) });
      if (!r.ok) throw await fallo(r, coleccion);
      const j = await r.json();
      return j.filter(x => x.document).map(x => ({ _id: x.document.name.split("/").pop(), ...desdeCampos(x.document.fields) }));
    },
    /** crea un documento (con id propio, o el que ponga Firestore) y devuelve su id */
    async crear(coleccion, datos, id = null) {
      const url = `${base}/${coleccion}${id ? `?documentId=${encodeURIComponent(id)}` : ""}`;
      const r = await f(url, { method: "POST", headers: cab, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, aValor(v)])) }) });
      if (!r.ok) throw await fallo(r, coleccion);
      return (await r.json()).name.split("/").pop();
    },
    /** cambia solo esos campos de un documento */
    async actualizar(ruta, campos) {
      const mascara = Object.keys(campos).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      const r = await f(`${base}/${ruta}?${mascara}&currentDocument.exists=true`, { method: "PATCH", headers: cab, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, aValor(v)])) }) });
      if (!r.ok) throw await fallo(r, ruta);
    },
  };
}
