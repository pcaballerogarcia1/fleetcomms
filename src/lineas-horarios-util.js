// Utilidades de los horarios de líneas (sin React: se comparten entre pantallas)
export const COLORES_CAL = ["#5c9bff", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171", "#a3e635", "#e879f9", "#2dd4bf", "#facc15"];
export const MESES_L = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const fechaLarga = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
export const hhmmTxt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// "7:05", "07.05", "0705", "25:10" (después de medianoche) → minutos
export const leerHora = t => {
  const m = /^\s*(\d{1,2})\s*[:.h]?\s*(\d{2})\s*$/.exec(String(t || ""));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 29 && mi < 60 ? h * 60 + mi : null;
};

/**
 * Junta las variantes de una misma línea (en muchos GTFS cada recorrido
 * distinto — M01_A, M01_B… — viene como una línea aparte con el mismo nombre).
 * Agrupa por operador + nombre corto, respetando el orden de la lista.
 * → [{ clave, nombre, lineas: [variantes] }]
 */
export function agruparVariantes(lineas) {
  const grupos = new Map();
  for (const l of lineas || []) {
    const clave = `${l.agencia || ""}|${String(l.nombre ?? "").trim() || l.id}`;
    if (!grupos.has(clave)) grupos.set(clave, { clave, nombre: l.nombre, lineas: [] });
    grupos.get(clave).lineas.push(l);
  }
  return [...grupos.values()];
}
// Texto corto de una variante: su nombre largo o sus cabeceras
export const textoVariante = l => l.largo || (l.sentidos || []).map(s => s.cabecera).filter(Boolean).join(" ↔ ") || l.tipo || "—";
