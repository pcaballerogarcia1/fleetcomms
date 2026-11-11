// Rutas › indicador «Margen»: lo que se facturaría si se hacen todas las
// paradas asignadas del escenario (la facturación máxima), frente al coste
// estimado. Los precios son los de Planificación (solo administradores): el
// del punto o el de por defecto; si no hay ninguno y el proyecto tiene un
// único trabajo con precio por visita, ese.
import { effectivePrice, puntoKeyOf } from "../price-store.js";

const esParada = a => !a._travel && !a._break && !a._wait && a.lat != null && a.lng != null;

/** El precio por visita de un trabajo, si el proyecto tiene exactamente uno con precio */
export function precioUnicoDeTrabajo(trabajos = [], precios) {
  const con = trabajos.map(t => precios?.porTrabajo?.[t.id]).filter(v => typeof v === "number");
  return con.length === 1 ? con[0] : null;
}

/** → { total, conPrecio, sinPrecio } de las paradas asignadas */
export function facturacionEscenario(vehicles = [], precios, precioTrabajo = null) {
  let total = 0, conPrecio = 0, sinPrecio = 0;
  for (const v of vehicles) {
    for (const a of v.assignments || []) {
      if (!esParada(a)) continue;
      const p = effectivePrice(precios, puntoKeyOf(a.lat, a.lng)) ?? precioTrabajo;
      if (p == null) { sinPrecio++; continue; }
      total += p; conPrecio++;
    }
  }
  return { total, conPrecio, sinPrecio };
}

/** El margen: (facturación − coste) / facturación; null si falta algo */
export const margen = (facturacion, coste) => (facturacion > 0 && coste != null ? (facturacion - coste) / facturacion : null);
