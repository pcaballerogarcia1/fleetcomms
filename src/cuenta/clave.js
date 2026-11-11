// Contraseñas: qué se considera segura (la misma regla en todas las
// pantallas: poner una nueva, cambiarla desde el menú y dar de alta a
// alguien) y lo que trae el enlace de los correos de Firebase.

// las más usadas (y sus variantes obvias): nunca valen
const COMUNES = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344",
  "password", "password1", "password123", "contraseña", "contrasena", "contrasena1", "qwerty123", "qwertyuiop",
  "abc12345", "abcd1234", "1q2w3e4r", "1qaz2wsx", "iloveyou", "admin123", "administrador", "bienvenido",
  "operanzia", "operanzia1", "operanzia123", "fleetcomms", "conductor", "conductor1", "madrid123", "barcelona",
  "españa123", "espana123", "futbol123", "realmadrid", "barcelona1", "teamo123", "hola1234", "holahola",
]);

export const MINIMO = 8;
const sinTildes = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * ¿Vale esta contraseña? → { ok, falta: [lo que le falta], puntos 0-4, nivel }
 * @param datos { email, nombre, apellidos }: no puede contenerlos
 */
export function valorarClave(clave, datos = {}) {
  const c = String(clave || "");
  const n = sinTildes(c);
  const falta = [];
  if (c.length < MINIMO) falta.push(`Al menos ${MINIMO} caracteres`);
  if (!/\p{L}/u.test(c) || !/\d/.test(c)) falta.push("Letras y números");
  const usuario = sinTildes(String(datos.email || "").split("@")[0]);
  const propios = [usuario, sinTildes(datos.nombre), sinTildes(datos.apellidos)].flatMap(s => s.split(/[\s._-]+/)).filter(s => s.length >= 4);
  if (COMUNES.has(n) || COMUNES.has(n.replace(/\d+$/, "")) || /^(.)\1+$/.test(c) || /^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(n) && c.length <= 10) falta.push("Que no sea una de las típicas (12345678, password…)");
  else if (propios.some(p => n.includes(p))) falta.push("Que no lleve tu nombre ni tu usuario");
  let puntos = 0;
  if (c.length >= MINIMO) puntos++;
  if (c.length >= 12) puntos++;
  if (/[a-z]/.test(c) && /[A-Z]/.test(c)) puntos++;
  if (/[^\p{L}\d]/u.test(c) || c.length >= 16) puntos++;
  if (falta.length) puntos = Math.min(puntos, 1);
  return { ok: falta.length === 0, falta, puntos, nivel: ["Muy débil", "Débil", "Aceptable", "Buena", "Muy buena"][puntos] };
}

/** El primer motivo por el que no vale, para un mensaje de error (null si vale) */
export const motivoClave = (clave, datos) => {
  const v = valorarClave(clave, datos);
  return v.ok ? null : `La contraseña no es segura: ${v.falta.map(f => f.toLowerCase()).join("; ")}.`;
};

/** Lo que trae el enlace de un correo de Firebase (/cuenta/clave?mode=…&oobCode=…&continueUrl=…) */
export function leerAccion(buscar) {
  const q = new URLSearchParams(buscar);
  return { modo: q.get("mode") || "", codigo: q.get("oobCode") || "", continuar: q.get("continueUrl") || "" };
}

/** A dónde ir después: la pantalla de la que vino (si es de aquí) o la de su rol */
export function destinoTras(continuar, rol, origen) {
  try {
    const u = new URL(continuar);
    if (u.origin === origen && !["/cuenta/clave", "/login", "/"].includes(u.pathname)) return u.pathname + u.search;
  } catch { /* sin dirección de vuelta */ }
  return rol === "conductor" ? "/rutas" : "/projects";
}
