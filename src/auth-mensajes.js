// Entrada a la app: el email tal como lo escribe (o pega) la gente y los
// errores de Firebase Auth en palabras que se entienden. Lo usan las tres
// pantallas de entrada (oficina, Rutas y superadmin).

import { correoDeUsuario } from "./acceso-app.js";

/** Sin espacios, en minúsculas y sin el punto final que se cuela al copiarlo de un texto; un usuario sin «@» (el de un trabajador) se completa con su dominio */
export const limpiarEmail = correoDeUsuario;

const MENSAJES = {
  "auth/invalid-credential": "Usuario o contraseña incorrectos.",
  "auth/wrong-password": "Usuario o contraseña incorrectos.",
  "auth/user-not-found": "Usuario o contraseña incorrectos.",
  "auth/invalid-email": "Ese email no es válido: revisa que esté bien escrito.",
  "auth/user-disabled": "Esta cuenta está desactivada.",
  "auth/too-many-requests": "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.",
  "auth/network-request-failed": "Sin conexión. Revisa internet y vuelve a probar.",
};

export const mensajeAuth = e => MENSAJES[e?.code] || "No se ha podido entrar. Vuelve a probar en un momento.";
