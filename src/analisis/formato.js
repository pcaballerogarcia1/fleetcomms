// Formatos y estilos de tabla comunes de Análisis (Realizado, Cierre del mes)
import { C } from "../tema.js";

export const hora = m => (m == null ? "—" : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`);
export const horas = m => (m == null ? "—" : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`);
export const num = (n, dec = 0) => (n == null ? "—" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
export const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: C.card, zIndex: 1 };
export const td = { padding: "8px 10px", fontSize: 12, color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
