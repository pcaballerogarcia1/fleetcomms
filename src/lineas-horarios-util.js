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
