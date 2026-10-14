// Avisos al móvil · la parte del servidor, sin Vercel (se prueba sola).
//  · verificarToken: el que pide enviar tiene sesión en Operanzia (token de
//    Firebase Auth firmado por Google, de este proyecto de Firebase).
//  · parsePeticion: suscripciones (de los móviles) y el mensaje, con topes.
//  · enviarATodos: un aviso por suscripción; devuelve las caducadas (el móvil
//    ya no existe o quitó el permiso) para que se borren.
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URL = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
let jwks = null;

export class AvisoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** uid de quien llama, o AvisoError(401) */
export async function verificarToken(token, proyectos, { claves } = {}) {
  if (!token) throw new AvisoError(401, "Falta la sesión");
  const lista = [].concat(proyectos).filter(Boolean);
  jwks ??= createRemoteJWKSet(JWKS_URL);
  for (const p of lista) {
    try {
      const { payload } = await jwtVerify(token, claves || jwks, { issuer: `https://securetoken.google.com/${p}`, audience: p });
      if (payload.sub) return payload.sub;
    } catch { /* probar con el siguiente proyecto */ }
  }
  throw new AvisoError(401, "Sesión no válida");
}

const MAX_SUBS = 500;
const corta = (s, n) => String(s ?? "").slice(0, n);

export function parsePeticion(body) {
  const b = typeof body === "string" ? (() => { try { return JSON.parse(body); } catch { return null; } })() : body;
  if (!b || typeof b !== "object") return { error: "Petición vacía" };
  const subs = Array.isArray(b.subs) ? b.subs.filter(s => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth) : [];
  if (!subs.length) return { error: "No hay móviles a los que avisar" };
  if (subs.length > MAX_SUBS) return { error: `Como mucho ${MAX_SUBS} móviles por envío` };
  const titulo = corta(b.titulo, 80).trim();
  if (!titulo) return { error: "Falta el título del aviso" };
  const url = typeof b.url === "string" && b.url.startsWith("/") ? corta(b.url, 200) : "/rutas";
  return { subs: subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })), mensaje: { titulo, cuerpo: corta(b.cuerpo, 300), url, etiqueta: corta(b.etiqueta, 60) || undefined } };
}

/**
 * @param enviar (sub, payloadTexto) → promesa (web-push.sendNotification)
 * @returns { enviados, fallidos, caducados: [endpoint] }
 */
export async function enviarATodos(subs, mensaje, enviar) {
  const texto = JSON.stringify(mensaje);
  const r = await Promise.allSettled(subs.map(s => enviar(s, texto)));
  const caducados = [];
  let enviados = 0, fallidos = 0;
  r.forEach((x, i) => {
    if (x.status === "fulfilled") { enviados++; return; }
    fallidos++;
    if ([404, 410].includes(x.reason?.statusCode)) caducados.push(subs[i].endpoint);
  });
  return { enviados, fallidos, caducados };
}
