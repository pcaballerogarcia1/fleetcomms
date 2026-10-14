// Cuándo un error de un navegador merece un aviso al móvil del superadmin.
//  · Solo errores (no las pantallas lentas, que se miran en el panel).
//  · El mismo error, como mucho un aviso cada 6 horas (aunque le pase a
//    muchos usuarios a la vez); y como mucho 30 avisos al día en total.
import { createHash } from "node:crypto";

export const CADA_MS = 6 * 3600_000;
export const MAX_DIA = 30;

/** La misma clave que agrupa errores en el panel (error-report.js → errorKey) */
export function claveError(mensaje, stack) {
  const m = String(mensaje || "").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "").replace(/\d+/g, "#").slice(0, 200);
  const s = String(stack || "").split("\n").map(l => l.trim()).find(l => l.startsWith("at ")) || "";
  return `${m}|${s.replace(/:\d+:\d+\)?$/, "")}`;
}
export const idDeClave = k => createHash("sha1").update(k).digest("hex").slice(0, 24);
export const diaDe = ms => new Date(ms).toISOString().slice(0, 10);

/**
 * @param estado  { ultimo, veces } de ese error (o null)
 * @param dia     { n } avisos enviados hoy (o null)
 * @returns { avisar, motivo }
 */
export function decidir(error, estado, dia, ahora = Date.now()) {
  if (!error) return { avisar: false, motivo: "no existe" };
  if (error.tipo === "lentitud") return { avisar: false, motivo: "lentitud: solo en el panel" };
  if (estado?.ultimo && ahora - estado.ultimo < CADA_MS) return { avisar: false, motivo: "ya avisado hace poco" };
  if ((dia?.n || 0) >= MAX_DIA) return { avisar: false, motivo: "tope diario" };
  return { avisar: true };
}

export function mensajeAlerta(error, orgNombre, vecesAntes = 0) {
  const quien = [error.nombre, orgNombre || error.org_id].filter(Boolean).join(" · ");
  return {
    titulo: `⚠️ Error en Operanzia${error.pagina ? ` (${error.pagina})` : ""}`.slice(0, 80),
    cuerpo: `${quien ? `${quien}: ` : ""}${String(error.mensaje || "").slice(0, 200)}${vecesAntes ? ` · ya había pasado ${vecesAntes} vez/veces` : ""}`,
    url: "/superadmin",
    etiqueta: "error",
  };
}
