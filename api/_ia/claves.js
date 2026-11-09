// Conectar con IA (MCP) · las claves del inicio de sesión (OAuth 2.1).
// Todo va cifrado con el secreto del servidor (variable MCP_SECRETO), sin
// guardar nada en la base de datos:
//  - client_id: la IA que se registró (su nombre y sus direcciones de vuelta), firmado.
//  - código de un solo uso (5 min), clave de acceso (1 h) y clave para renovar (90 días):
//    cifrados; dentro va la sesión de Firebase del usuario, con la que el servidor
//    lee como él (las reglas de siempre deciden qué ve).
import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from "jose";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export class OAuthError extends Error {
  constructor(error, descripcion, status = 400) { super(descripcion); this.error = error; this.status = status; }
}

function secreto(env = globalThis.process?.env || {}) {
  const s = env.MCP_SECRETO;
  if (!s || s.length < 32) throw new OAuthError("server_error", "Falta configurar MCP_SECRETO en el servidor", 500);
  return s;
}
// dos claves distintas a partir del mismo secreto: una para firmar y otra para cifrar
const derivar = (s, uso) => createHash("sha256").update(`${uso}:${s}`).digest();

const EMISOR = "operanzia";

/** El client_id de una IA registrada: { n: nombre, r: [direcciones de vuelta], m: cómo se identifica al pedir claves } firmado */
export async function nuevoCliente({ nombre, redirecciones, metodo = "none" }, env) {
  return new SignJWT({ n: String(nombre || "IA").slice(0, 80), r: redirecciones, m: metodo })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(EMISOR).setSubject("cliente").setIssuedAt().sign(derivar(secreto(env), "cliente"));
}
/** { nombre, redirecciones, metodo } de un client_id, o error si no es nuestro */
export async function leerCliente(clientId, env) {
  try {
    const { payload } = await jwtVerify(String(clientId || ""), derivar(secreto(env), "cliente"), { issuer: EMISOR, subject: "cliente" });
    return { nombre: payload.n, redirecciones: payload.r || [], metodo: payload.m || "none" };
  } catch {
    throw new OAuthError("invalid_client", "Cliente desconocido: vuelve a añadir el conector", 401);
  }
}
/** La contraseña de una IA que se registró con contraseña (sale del client_id: no se guarda) */
export const secretoDeCliente = (clientId, env) => createHmac("sha256", derivar(secreto(env), "secreto-cliente")).update(String(clientId)).digest("base64url");
export function secretoValido(clientId, dado, env) {
  const a = Buffer.from(secretoDeCliente(clientId, env)), b = Buffer.from(String(dado || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Una clave cifrada de un tipo ("codigo", "acceso", "renovar") que caduca en `segundos` */
export async function cifrar(tipo, datos, segundos, env) {
  return new EncryptJWT({ ...datos, t: tipo }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(EMISOR).setIssuedAt().setExpirationTime(`${segundos}s`).encrypt(derivar(secreto(env), "cifrar"));
}
/** Lo de dentro de una clave cifrada de ese tipo, o error si no vale o ha caducado */
export async function descifrar(tipo, clave, env) {
  try {
    const { payload } = await jwtDecrypt(String(clave || ""), derivar(secreto(env), "cifrar"), { issuer: EMISOR });
    if (payload.t !== tipo) throw new Error("tipo");
    return payload;
  } catch (e) {
    if (e instanceof OAuthError) throw e;
    throw new OAuthError("invalid_grant", "Clave no válida o caducada");
  }
}

/** PKCE (S256): ¿el verificador corresponde al reto? */
export function pkceValido(verificador, reto) {
  if (!verificador || !reto) return false;
  const calculado = createHash("sha256").update(String(verificador)).digest("base64url");
  const a = Buffer.from(calculado), b = Buffer.from(String(reto));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ¿Es una dirección de vuelta aceptable? https, o el propio ordenador (Claude Code, aplicaciones de escritorio) */
export function redireccionValida(u) {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

/** Los permisos según el nivel que dejó la empresa */
export const ALCANCES = { leer: "operanzia.leer", actuar: "operanzia.actuar" };
export const alcanceDe = nivel => (nivel === "actuar" ? `${ALCANCES.leer} ${ALCANCES.actuar}` : ALCANCES.leer);
