// /api/oauth?accion=… — el inicio de sesión estándar (OAuth 2.1) de «Conectar
// con IA», el que esperan ChatGPT, Claude, Gemini, Copilot, Grok…:
//  - meta-as / meta-rs: dónde está cada cosa (las direcciones /.well-known/…, ver vercel.json)
//  - register: cada IA se registra sola (sin que nadie le dé de alta)
//  - cliente: la página /conectar-ia comprueba la IA antes de pedir el permiso
//  - codigo: la página, con el usuario ya identificado y tras «Permitir», pide el código
//  - token: la IA canjea el código (o renueva) por sus claves; aquí nace la conexión
// Nada se guarda en el servidor: el client_id y las claves van firmados o
// cifrados (api/_ia/claves.js). La conexión sí queda en ia_conexiones, para
// que el usuario o un admin la vean y la desconecten.
import { AccesoError, comprobarAcceso } from "./_ia/acceso.js";
import { OAuthError, alcanceDe, cifrar, descifrar, leerCliente, nuevoCliente, pkceValido, redireccionValida, secretoDeCliente, secretoValido } from "./_ia/claves.js";
import { firebaseDelEntorno, origenDe } from "./_ia/entorno.js";
import { cors } from "./mcp.js";

export const DURACION = { codigo: 5 * 60, acceso: 60 * 60, renovar: 90 * 24 * 60 * 60 };
const METODOS = ["none", "client_secret_post", "client_secret_basic"];

export const metadatosServidor = origen => ({
  issuer: origen,
  authorization_endpoint: `${origen}/conectar-ia`,
  token_endpoint: `${origen}/oauth/token`,
  registration_endpoint: `${origen}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: METODOS,
  scopes_supported: ["operanzia.leer", "operanzia.actuar"],
  service_documentation: "https://operanzia.com",
});
export const metadatosRecurso = origen => ({
  resource: `${origen}/mcp`,
  authorization_servers: [origen],
  scopes_supported: ["operanzia.leer", "operanzia.actuar"],
  bearer_methods_supported: ["header"],
  resource_name: "Operanzia",
});

/** Registro de una IA (RFC 7591) */
export async function registrar(cuerpo, env) {
  const redirecciones = Array.isArray(cuerpo?.redirect_uris) ? cuerpo.redirect_uris.map(String) : [];
  if (!redirecciones.length || redirecciones.length > 10) throw new OAuthError("invalid_redirect_uri", "Hacen falta entre 1 y 10 direcciones de vuelta");
  const mala = redirecciones.find(u => !redireccionValida(u));
  if (mala) throw new OAuthError("invalid_redirect_uri", `Dirección de vuelta no válida: ${mala}`);
  const metodo = cuerpo?.token_endpoint_auth_method || "none";
  if (!METODOS.includes(metodo)) throw new OAuthError("invalid_client_metadata", `Forma de identificarse no admitida: ${metodo}`);
  const nombre = String(cuerpo?.client_name || "IA").slice(0, 80);
  const client_id = await nuevoCliente({ nombre, redirecciones, metodo }, env);
  return {
    client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: nombre, redirect_uris: redirecciones,
    token_endpoint_auth_method: metodo, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    ...(metodo !== "none" ? { client_secret: secretoDeCliente(client_id, env), client_secret_expires_at: 0 } : {}),
  };
}

/** La IA y su dirección de vuelta, comprobadas (para la página y para el código) */
export async function clienteYVuelta(clientId, vuelta, env) {
  const c = await leerCliente(clientId, env);
  if (!vuelta || !c.redirecciones.includes(vuelta)) throw new OAuthError("invalid_request", "La dirección de vuelta no es la que registró esta IA");
  return c;
}

/** El código para la IA, tras «Permitir» (la sesión del usuario prueba quién es y que puede) */
export async function nuevoCodigo(p, { firebase, f, env }) {
  const c = await clienteYVuelta(p.client_id, p.redirect_uri, env);
  if (!p.code_challenge || (p.code_challenge_method && p.code_challenge_method !== "S256")) throw new OAuthError("invalid_request", "Falta el reto PKCE (S256)");
  if (!p.sesion) throw new OAuthError("invalid_request", "Falta la sesión de Operanzia");
  const a = await comprobarAcceso({ sesion: p.sesion, firebase, f });
  const code = await cifrar("codigo", { s: p.sesion, u: a.uid, k: p.client_id, r: p.redirect_uri, ch: p.code_challenge }, DURACION.codigo, env);
  const url = new URL(p.redirect_uri);
  url.searchParams.set("code", code);
  if (p.state) url.searchParams.set("state", p.state);
  return { redirect: url.toString(), cliente: c.nombre, nivel: a.nivel };
}

/** El client_id (y su contraseña, si la tiene) de la petición de claves */
export async function clienteDePeticion(cuerpo, autorizacion, env) {
  let id = cuerpo?.client_id, secreto = cuerpo?.client_secret;
  const basic = String(autorizacion || "").match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [u, s] = Buffer.from(basic, "base64").toString("utf8").split(":");
    id = decodeURIComponent(u || ""); secreto = decodeURIComponent(s || "");
  }
  if (!id) throw new OAuthError("invalid_client", "Falta client_id", 401);
  const c = await leerCliente(id, env);
  if (c.metodo !== "none" && !secretoValido(id, secreto, env)) throw new OAuthError("invalid_client", "Contraseña de la IA incorrecta", 401);
  return { id, ...c };
}

/** Canje del código o renovación: las claves de la IA */
export async function claves(cuerpo, autorizacion, { firebase, f, env, ahora = new Date() }) {
  const cliente = await clienteDePeticion(cuerpo, autorizacion, env);
  let sesion, conexionId;
  let a;
  if (cuerpo?.grant_type === "authorization_code") {
    const c = await descifrar("codigo", cuerpo.code, env);
    if (c.k !== cliente.id) throw new OAuthError("invalid_grant", "El código es de otra IA");
    if (cuerpo.redirect_uri && cuerpo.redirect_uri !== c.r) throw new OAuthError("invalid_grant", "La dirección de vuelta no coincide");
    if (!pkceValido(cuerpo.code_verifier, c.ch)) throw new OAuthError("invalid_grant", "PKCE no válido");
    sesion = c.s;
    a = await comprobarAcceso({ sesion, firebase, f }).catch(sinAcceso);
    // la conexión nace aquí (solo las que de verdad se completan)
    const momento = ahora.toISOString();
    conexionId = await a.fs.crear("ia_conexiones", {
      org_id: a.org, uid: a.uid, nombre: a.perfil.nombre || a.perfil.email || "", rol: a.perfil.rol || "",
      cliente: cliente.nombre, nivel: a.nivel, activa: true, creado: momento, ultimoUso: momento,
    });
  } else if (cuerpo?.grant_type === "refresh_token") {
    const r = await descifrar("renovar", cuerpo.refresh_token, env);
    if (r.k !== cliente.id) throw new OAuthError("invalid_grant", "La clave es de otra IA");
    sesion = r.s; conexionId = r.c;
    // si la empresa lo ha quitado por ahora, se renueva igual (la IA le explicará por qué no puede):
    // solo una sesión o conexión que ya no valen obligan a volver a conectar
    a = await comprobarAcceso({ sesion, conexionId, firebase, f }).catch(e => (e instanceof AccesoError && !e.reconectar ? { nivel: "leer" } : sinAcceso(e)));
  } else {
    throw new OAuthError("unsupported_grant_type", "Solo authorization_code y refresh_token");
  }
  const datos = { s: sesion, c: conexionId, k: cliente.id };
  return {
    access_token: await cifrar("acceso", datos, DURACION.acceso, env),
    token_type: "Bearer",
    expires_in: DURACION.acceso,
    refresh_token: await cifrar("renovar", datos, DURACION.renovar, env),
    scope: alcanceDe(a.nivel),
  };
}
const sinAcceso = e => { if (e instanceof AccesoError) throw new OAuthError("invalid_grant", e.message); throw e; };

/** El cuerpo, venga como JSON, como formulario ya leído o como texto de formulario */
function cuerpoDe(req) {
  const b = req.body;
  if (b && typeof b === "object") return b;
  const s = String(b || "");
  try { return JSON.parse(s); } catch { return Object.fromEntries(new URLSearchParams(s)); }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "no-store");
  const accion = String(req.query?.accion || "");
  const origen = origenDe(req);
  const ctx = { firebase: firebaseDelEntorno(), f: fetch, env: globalThis.process.env };
  try {
    if (accion === "meta-as") return res.status(200).json(metadatosServidor(origen));
    if (accion === "meta-rs") return res.status(200).json(metadatosRecurso(origen));
    if (accion === "cliente") {
      const c = await clienteYVuelta(req.query.client_id, req.query.redirect_uri, ctx.env);
      return res.status(200).json({ nombre: c.nombre });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "invalid_request", error_description: "Usa POST" });
    if (accion === "register") return res.status(201).json(await registrar(cuerpoDe(req), ctx.env));
    if (accion === "codigo") return res.status(200).json(await nuevoCodigo(cuerpoDe(req), ctx));
    if (accion === "token") return res.status(200).json(await claves(cuerpoDe(req), req.headers.authorization, ctx));
    return res.status(404).json({ error: "invalid_request", error_description: "Acción desconocida" });
  } catch (e) {
    if (e instanceof AccesoError) return res.status(403).json({ error: "access_denied", error_description: e.message });
    if (e instanceof OAuthError) {
      if (e.status === 401) res.setHeader("WWW-Authenticate", "Basic");
      return res.status(e.status).json({ error: e.error, error_description: e.message });
    }
    console.error("OAuth:", e);
    return res.status(500).json({ error: "server_error", error_description: "Error interno de Operanzia" });
  }
}
