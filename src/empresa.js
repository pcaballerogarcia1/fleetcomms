// La ficha de la empresa de quien tiene la sesión (orgs/{org}), escuchada una
// sola vez para toda la app: qué módulos tiene y si está suspendida. La fijan
// la oficina (workspace.jsx) y la app del trabajador (App.jsx.jsx) al entrar.
import { useSyncExternalStore } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase.js";
import { moduloActivo } from "./modulos.js";

let estado = { org: null, datos: undefined }; // datos: undefined = cargando; null = sin ficha
let dejar = null;
const avisos = new Set();
const cambiar = e => { estado = e; avisos.forEach(f => f()); };

/** Empieza a escuchar la empresa (o deja de hacerlo con null) */
export function fijarEmpresa(orgId) {
  if (estado.org === (orgId || null)) return;
  dejar?.(); dejar = null;
  cambiar({ org: orgId || null, datos: orgId ? undefined : null });
  if (!orgId) return;
  dejar = onSnapshot(doc(db, "orgs", orgId),
    s => cambiar({ org: orgId, datos: s.exists() ? s.data() : null }),
    () => cambiar({ org: orgId, datos: null })); // sin permiso para leerla: como si no tuviera ficha (todo encendido)
}

const suscribir = f => { avisos.add(f); return () => avisos.delete(f); };
/** { org, datos } de la empresa actual */
export const useEmpresa = () => useSyncExternalStore(suscribir, () => estado, () => estado);
/** ¿Tiene la empresa esta parte? (mientras carga, sí: no se esconde nada de golpe) */
export const useModulo = clave => moduloActivo(useEmpresa().datos, clave);
