// Posiciones del GPS de la empresa mientras el mapa de Control está abierto:
// se piden cada minuto (y no con la pestaña oculta). No se guardan.
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { escucharConexionGps, pedirPosicionesGps } from "./proveedores.js";

export const CADA_MS = 60_000;

export function useConexionGps(orgId) {
  const [conexion, setConexion] = useState(undefined); // undefined = cargando
  useEffect(() => escucharConexionGps(orgId, setConexion), [orgId]);
  return conexion;
}

export function useFlota(orgId) {
  const [flota, setFlota] = useState([]);
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(query(collection(db, "scheduling_vehicles"), where("org_id", "==", orgId)), s => setFlota(s.docs.map(d => ({ _id: d.id, ...d.data() }))), () => {});
  }, [orgId]);
  return flota;
}

export function usePosicionesGps(conexion) {
  const [estado, setEstado] = useState({ vehiculos: [], error: null, hora: null });
  const activa = !!(conexion?.activa && conexion?.proveedor);
  const clave = activa ? JSON.stringify([conexion.proveedor, conexion.cred]) : "";
  useEffect(() => {
    if (!clave) return;
    let vivo = true, t = null;
    const [proveedor, cred] = JSON.parse(clave);
    const pedir = async () => {
      if (typeof document !== "undefined" && document.hidden) { t = setTimeout(pedir, 5000); return; }
      try {
        const vehiculos = await pedirPosicionesGps({ proveedor, cred });
        if (vivo) setEstado({ vehiculos, error: null, hora: Date.now() });
      } catch (e) {
        if (vivo) setEstado(s => ({ ...s, error: e.message || String(e) }));
      }
      if (vivo) t = setTimeout(pedir, CADA_MS);
    };
    pedir();
    return () => { vivo = false; clearTimeout(t); };
  }, [clave]);
  return activa ? estado : { vehiculos: [], error: null, hora: null };
}
