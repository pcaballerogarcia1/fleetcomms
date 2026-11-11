// Cambiar la contraseña de quien tiene la sesión abierta (con la actual) y sus mensajes de error
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "../firebase.js";

const MENSAJES = {
  "auth/wrong-password": "La contraseña actual no es correcta.",
  "auth/invalid-credential": "La contraseña actual no es correcta.",
  "auth/invalid-login-credentials": "La contraseña actual no es correcta.",
  "auth/too-many-requests": "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.",
  "auth/network-request-failed": "Sin conexión. Revisa internet y vuelve a probar.",
  "auth/weak-password": "La contraseña nueva no es segura: prueba con otra más larga.",
  "auth/requires-recent-login": "Por seguridad, cierra sesión, vuelve a entrar y cámbiala otra vez.",
};
export const mensajeCambio = e => MENSAJES[e?.code] || "No se ha podido cambiar. Vuelve a probar en un momento.";

/** Cambia la contraseña de quien tiene la sesión abierta, comprobando antes la actual */
export async function cambiarMiClave(actual, nueva) {
  const u = auth.currentUser;
  if (!u?.email) throw Object.assign(new Error("Sin sesión"), { code: "auth/requires-recent-login" });
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, actual));
  await updatePassword(u, nueva);
}
