// El acceso a la app de cada trabajador: su usuario y su contraseña. Un
// usuario sin «@» (p. ej. «juan.perez») se guarda en Firebase como
// «juan.perez@usuarios.operanzia.com», y al entrar basta con escribir
// «juan.perez». Sin React ni Firebase.

export const DOMINIO_USUARIOS = "usuarios.operanzia.com";

/** Lo que se escribe al entrar (usuario o correo) → el correo de Firebase */
export function correoDeUsuario(u) {
  const t = String(u || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!t) return "";
  return t.includes("@") ? t : `${t}@${DOMINIO_USUARIOS}`;
}

/** El correo de Firebase → lo que se enseña (el usuario corto si es de los nuestros) */
export function usuarioDeCorreo(email) {
  const t = String(email || "").toLowerCase();
  const fin = `@${DOMINIO_USUARIOS}`;
  return t.endsWith(fin) ? t.slice(0, -fin.length) : t;
}

const limpio = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, " ").trim();

/** Usuario propuesto: «nombre.apellido» (primer nombre y primer apellido, sin tildes) */
export function sugerirUsuario(t) {
  const n = limpio(t?.nombre).split(" ")[0] || "";
  const a = limpio(t?.apellidos).split(" ")[0] || "";
  return [n, a].filter(Boolean).join(".");
}

/** ¿Vale como usuario? Letras, números, punto, guion y guion bajo; o un correo */
export function usuarioValido(u) {
  const t = String(u || "").trim().toLowerCase();
  if (t.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(t);
}

/** Una contraseña fácil de dictar: 8 caracteres sin letras que se confundan (l/1, O/0) */
export function generarClave(azar = Math.random) {
  const letras = "abcdefghjkmnpqrstuvwxyz", nums = "23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += letras[Math.floor(azar() * letras.length)];
  for (let i = 0; i < 3; i++) s += nums[Math.floor(azar() * nums.length)];
  return s[0].toUpperCase() + s.slice(1);
}

/** El rol en la app: un supervisor entra como «intermedio» si quien lo da de alta es admin; el resto, conductor (Field) */
export function rolAppDe(trabajador, miRol) {
  return trabajador?.rol === "supervisor" && (miRol === "admin" || miRol === "superadmin") ? "intermedio" : "conductor";
}

const MENSAJES = {
  "auth/email-already-in-use": "Ese usuario ya existe: prueba con otro (por ejemplo, añade un número).",
  "auth/invalid-email": "Ese usuario no vale: usa letras, números y puntos, sin espacios.",
  "auth/weak-password": "La contraseña es demasiado corta: al menos 6 caracteres.",
  "auth/network-request-failed": "Sin conexión. Revisa internet y vuelve a probar.",
};
export const mensajeAlta = e => MENSAJES[e?.code] || `No se pudo crear el acceso: ${e?.message || e}`;
