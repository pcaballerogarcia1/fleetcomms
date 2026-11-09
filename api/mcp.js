// POST /mcp (→ /api/mcp) — la dirección MCP de Operanzia: la que se pega en
// ChatGPT, Claude, Gemini, Copilot, Grok… para «Conectar con IA». Habla MCP
// por HTTP (JSON-RPC, sin sesión). Cada petición trae la clave de acceso que
// dio el inicio de sesión (api/oauth.js); sin ella, 401 y la IA abre el
// inicio de sesión de Operanzia. Ver api/_ia/.
import { AccesoError, comprobarAcceso } from "./_ia/acceso.js";
import { descifrar, OAuthError } from "./_ia/claves.js";
import { firebaseDelEntorno, origenDe } from "./_ia/entorno.js";
import { ejecutarHerramienta, herramientasPara } from "./_ia/herramientas.js";

export const VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCCIONES = "Operanzia es el programa de rutas, turnos y reparto de esta empresa. Con estas herramientas consultas cómo van las rutas del día, las entregas y no entregas, los pedidos, las incidencias y la flota. Las fechas van en AAAA-MM-DD y las horas en hora de España. Antes de usar una herramienta que cambia datos, confirma con el usuario.";

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
}

/** 401: la IA tiene que (volver a) iniciar sesión; le decimos dónde */
function sinAutorizar(req, res, error = null, descripcion = null) {
  const extra = error ? `, error="${error}", error_description="${String(descripcion || "").replace(/["\\]/g, "")}"` : "";
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${origenDe(req)}/.well-known/oauth-protected-resource"${extra}`);
  return res.status(401).json({ error: error || "unauthorized", error_description: descripcion || "Inicia sesión en Operanzia para conectar tu IA." });
}

const respuesta = (id, result) => ({ jsonrpc: "2.0", id, result });
const fallo = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// la empresa no lo permite ahora: se le explica a la IA (lo demás sigue hacia arriba: 401 o error)
const sinPermisoDeEmpresa = e => { if (e instanceof AccesoError && !e.reconectar) return null; throw e; };

/** Las herramientas tal y como las ve la IA (sin el código) */
export const listaHerramientas = nivel => herramientasPara(nivel).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));

/**
 * Atiende un mensaje JSON-RPC. `acceso()` comprueba el permiso (solo cuando
 * hace falta leer Operanzia). Devuelve la respuesta, o null si era un aviso.
 */
export async function atender(msg, acceso, ahora = new Date()) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fallo(msg?.id, -32600, "Petición no válida");
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // aviso (notifications/initialized…): no lleva respuesta
  switch (method) {
    case "initialize": {
      const pedida = params?.protocolVersion;
      return respuesta(id, {
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "operanzia", title: "Operanzia", version: "1.0.0" },
        instructions: INSTRUCCIONES,
      });
    }
    case "ping": return respuesta(id, {});
    case "tools/list": {
      const a = await acceso().catch(sinPermisoDeEmpresa);
      return respuesta(id, { tools: listaHerramientas(a?.nivel || "leer") });
    }
    case "tools/call": {
      if (typeof params?.name !== "string") return fallo(id, -32602, "Falta el nombre de la herramienta");
      let a;
      try { a = await acceso(); }
      catch (e) { sinPermisoDeEmpresa(e); return respuesta(id, { isError: true, content: [{ type: "text", text: e.message }] }); }
      return respuesta(id, await ejecutarHerramienta(params.name, params.arguments, { ...a, nombre: a.perfil?.nombre || a.perfil?.email || "Usuario", ahora }));
    }
    case "resources/list": return respuesta(id, { resources: [] });
    case "prompts/list": return respuesta(id, { prompts: [] });
    default: return fallo(id, -32601, `Método no disponible: ${method}`);
  }
}

// la última vez que se usó cada conexión se apunta como mucho cada 15 min
const ULTIMO_USO_CADA = 15 * 60_000;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ error: "Usa POST (MCP por HTTP, sin canal de eventos)" }); }

  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return sinAutorizar(req, res);
  let clave;
  try { clave = await descifrar("acceso", bearer); }
  catch (e) {
    if (e instanceof OAuthError && e.status === 500) return res.status(500).json({ error: e.message });
    return sinAutorizar(req, res, "invalid_token", "Clave caducada o no válida");
  }

  const firebase = firebaseDelEntorno();
  let comprobado = null;
  const acceso = async () => {
    if (!comprobado) {
      comprobado = await comprobarAcceso({ sesion: clave.s, conexionId: clave.c, firebase });
      const ultimo = Date.parse(comprobado.conexion?.ultimoUso || "") || 0;
      if (Date.now() - ultimo > ULTIMO_USO_CADA) await comprobado.fs.actualizar(`ia_conexiones/${clave.c}`, { ultimoUso: new Date().toISOString() }).catch(() => {});
    }
    return comprobado;
  };

  let cuerpo = req.body;
  if (typeof cuerpo === "string") { try { cuerpo = JSON.parse(cuerpo); } catch { return res.status(400).json(fallo(null, -32700, "JSON no válido")); } }
  const lote = Array.isArray(cuerpo);
  try {
    const salidas = [];
    for (const m of lote ? cuerpo : [cuerpo]) {
      const r = await atender(m, acceso);
      if (r) salidas.push(r);
    }
    if (!salidas.length) return res.status(202).end();
    return res.status(200).json(lote ? salidas : salidas[0]);
  } catch (e) {
    if (e instanceof AccesoError) return sinAutorizar(req, res, "invalid_token", e.message);
    console.error("MCP:", e);
    return res.status(500).json(fallo(lote ? null : cuerpo?.id, -32603, "Error interno de Operanzia"));
  }
}
