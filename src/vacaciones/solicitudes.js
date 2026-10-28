// Vacaciones y permisos: lo que pide cada trabajador desde la app y la
// oficina aprueba o rechaza en el Cuadrante. Al aprobar, esos días quedan
// en el cuadrante con el código «V» (Vacaciones).
//
//   solicitudes_ausencia/{id}
//     { org_id, uid, nombre, tipo, desde, hasta, dias, comentario,
//       estado: "pendiente" | "aprobada" | "rechazada" | "cancelada",
//       creadaAt, resueltaPor: { uid, nombre }, resueltaAt, motivo }

export const TIPOS_AUSENCIA = [
  ["vacaciones", "Vacaciones"],
  ["asuntos", "Asuntos propios"],
  ["permiso", "Permiso (médico, mudanza, boda…)"],
];
export const nombreTipo = t => (TIPOS_AUSENCIA.find(x => x[0] === t) || [t, t])[1];
export const DIAS_VACACIONES_AÑO = 30; // naturales, Estatuto de los Trabajadores art. 38 (el convenio puede mejorarlo)
export const MAX_DIAS_SOLICITUD = 62;
const TRABAJA = new Set(["M", "T", "N"]);

const fecha = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Los días (YYYY-MM-DD) de desde a hasta, los dos incluidos */
export function diasDe(desde, hasta) {
  const out = [];
  const a = fecha(desde), b = fecha(hasta);
  if (!(a <= b)) return out;
  for (let d = new Date(a); d <= b && out.length <= 400; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

/** Comprueba una solicitud nueva; devuelve el texto del problema o null */
export function problemaSolicitud({ tipo, desde, hasta }, hoy = iso(new Date())) {
  if (!TIPOS_AUSENCIA.some(t => t[0] === tipo)) return "Elige el tipo";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || "") || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || "")) return "Elige las fechas";
  if (hasta < desde) return "La fecha de fin es anterior a la de inicio";
  if (desde < hoy) return "No se pueden pedir días ya pasados";
  if (diasDe(desde, hasta).length > MAX_DIAS_SOLICITUD) return `Como mucho ${MAX_DIAS_SOLICITUD} días seguidos por solicitud`;
  return null;
}

/** Días por mes: { "2026-11": [3, 4, 5], … } (para escribir el cuadrante de cada mes) */
export function diasPorMes(desde, hasta) {
  const out = {};
  for (const d of diasDe(desde, hasta)) (out[d.slice(0, 7)] ||= []).push(Number(d.slice(8)));
  return out;
}

/** Días de vacaciones de un año: aprobados y pendientes (solo las de tipo vacaciones, contados en ese año) */
export function resumenAño(solicitudes = [], año) {
  const r = { aprobados: 0, pendientes: 0 };
  for (const s of solicitudes) {
    if (s.tipo !== "vacaciones") continue;
    const n = diasDe(s.desde, s.hasta).filter(d => d.startsWith(`${año}-`)).length;
    if (s.estado === "aprobada") r.aprobados += n;
    else if (s.estado === "pendiente") r.pendientes += n;
  }
  return r;
}

/**
 * Cuántos compañeros trabajan cada día de la solicitud, según el cuadrante.
 * @param grids  { "YYYY-MM": { workerId: { día: código } } }
 * @returns { minimo, dia, porDia: { "YYYY-MM-DD": n } } (minimo: el día con menos gente)
 */
export function companerosTrabajando(grids, workerId, desde, hasta) {
  const porDia = {};
  let minimo = Infinity, diaMin = null;
  for (const d of diasDe(desde, hasta)) {
    const g = grids[d.slice(0, 7)] || {};
    const dd = Number(d.slice(8));
    const n = Object.entries(g).filter(([w, cel]) => w !== workerId && TRABAJA.has(cel?.[dd])).length;
    porDia[d] = n;
    if (n < minimo) { minimo = n; diaMin = d; }
  }
  return { minimo: minimo === Infinity ? null : minimo, dia: diaMin, porDia };
}

/** Las solicitudes en orden: pendientes primero (las más antiguas antes), luego el resto por fecha */
export const ordenarSolicitudes = lista => [...lista].sort((a, b) =>
  (a.estado === "pendiente" ? 0 : 1) - (b.estado === "pendiente" ? 0 : 1)
  || (a.estado === "pendiente" ? (a.creadaAt || 0) - (b.creadaAt || 0) : (b.desde || "").localeCompare(a.desde || "")));
