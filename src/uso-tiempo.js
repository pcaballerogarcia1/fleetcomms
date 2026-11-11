// Cuánto tiempo usa cada persona Operanzia (para el panel del superadmin ›
// Uso). Una ficha por persona y mes: uso_mes/{org}_{uid}_{AAAA-MM}
//   { org_id, uid, nombre, rol, mes, minutos, dias: { "11": min }, oficina, app, ultimo }
// Cuenta un minuto si la pantalla está a la vista y, en la oficina, si ha
// habido ratón o teclado en los últimos 5 minutos (una pestaña olvidada no
// suma). Se guarda cada 5 minutos y al salir: pocas escrituras (cuota).
import { doc, increment, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase.js";

export const INACTIVO_MS = 5 * 60_000;
export const GUARDAR_CADA_MIN = 5;

/** ¿Cuenta este minuto? */
export function cuentaMinuto({ visible, app, ahora, ultimaActividad }) {
  if (!visible) return false;
  if (app === "app") return true; // en el móvil, mirar la app ya es usarla
  return ahora - ultimaActividad < INACTIVO_MS;
}

const fecha = d => ({ mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, dia: String(d.getDate()) });

/** Lo que se suma a la ficha del mes (minutos de un día) */
export function sumaDeUso(sesion, app, minutos, cuando = new Date()) {
  const { mes, dia } = fecha(cuando);
  return {
    id: `${sesion.org_id}_${sesion.uid}_${mes}`,
    datos: {
      org_id: sesion.org_id, uid: sesion.uid, mes,
      nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") || sesion.email || "", rol: sesion.rol || "",
      minutos: increment(minutos), dias: { [dia]: increment(minutos) }, [app]: increment(minutos), ultimo: serverTimestamp(),
    },
  };
}

/** Empieza a contar (app: "oficina" | "app"). Devuelve la función para parar (guarda lo pendiente). */
export function contarUso(sesion, app) {
  if (!sesion?.uid || !sesion.org_id || sesion.rol === "superadmin" || typeof document === "undefined") return () => {};
  let ultimaActividad = Date.now();
  let pendientes = 0;
  const activo = () => { ultimaActividad = Date.now(); };
  const eventos = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"];
  eventos.forEach(e => window.addEventListener(e, activo, { passive: true }));
  const guardar = () => {
    if (!pendientes) return;
    const { id, datos } = sumaDeUso(sesion, app, pendientes);
    pendientes = 0;
    setDoc(doc(db, "uso_mes", id), datos, { merge: true }).catch(() => {});
  };
  const tic = setInterval(() => {
    if (cuentaMinuto({ visible: document.visibilityState === "visible", app, ahora: Date.now(), ultimaActividad })) pendientes++;
    if (pendientes >= GUARDAR_CADA_MIN) guardar();
  }, 60_000);
  const alOcultar = () => { if (document.visibilityState === "hidden") guardar(); };
  document.addEventListener("visibilitychange", alOcultar);
  window.addEventListener("pagehide", guardar);
  return () => {
    clearInterval(tic);
    eventos.forEach(e => window.removeEventListener(e, activo));
    document.removeEventListener("visibilitychange", alOcultar);
    window.removeEventListener("pagehide", guardar);
    guardar();
  };
}
