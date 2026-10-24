// Cambiar la contraseña uno mismo: Firebase le manda a su correo un enlace
// para poner una nueva. Lo usan las pantallas de entrada («¿Has olvidado tu
// contraseña?») y el menú del perfil («Cambiar mi contraseña»).
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase.js";
import { DOMINIO_USUARIOS, correoDeUsuario } from "./acceso-app.js";

/** ¿Es un correo de verdad (al que puede llegar el enlace)? */
export const esCorreoReal = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")) && !String(email).toLowerCase().endsWith(`@${DOMINIO_USUARIOS}`);

/** Manda el enlace al correo escrito; devuelve el correo, o lanza un Error con un mensaje para la persona */
export async function enviarCambioClave(texto) {
  const email = correoDeUsuario(texto);
  if (!email) throw new Error("Escribe tu correo arriba y vuelve a pulsar.");
  if (!esCorreoReal(email)) throw new Error("Con un usuario sin correo no se puede: pide a tu empresa que te ponga tu correo.");
  auth.languageCode = "es";
  try { await sendPasswordResetEmail(auth, email); }
  catch (e) {
    if (e?.code === "auth/user-not-found") return email; // no se dice si existe o no
    if (e?.code === "auth/invalid-email") throw new Error("Ese correo no es válido: revisa que esté bien escrito.", { cause: e });
    if (e?.code === "auth/too-many-requests") throw new Error("Demasiados intentos seguidos. Espera unos minutos.", { cause: e });
    if (e?.code === "auth/network-request-failed") throw new Error("Sin conexión. Revisa internet y vuelve a probar.", { cause: e });
    throw new Error("No se ha podido enviar. Vuelve a probar en un momento.", { cause: e });
  }
  return email;
}
