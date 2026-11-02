// Prueba de entrega (reparto y distribución): lo que guarda el conductor en
// cada parada al entregar —o al no poder entregar— y cómo se enseña.
// Sin React ni Firebase.
//
//   en la parada (planes/{id}.ubicaciones[i]):
//     entrega: { estado: "entregada" | "no_entregada", motivo, recibe, nota,
//                fotos: n, firma: bool, sinFirma: bool, lat, lng, precision, en }
//     (sinFirma: nadie puede firmar y se deja en un sitio acordado —portería,
//      buzón…—; entonces `recibe` dice dónde y hace falta al menos una foto)
//   fotos y firma, aparte (no caben en la ficha del plan):
//     entregas_pruebas/{planId}_{ubicId}_{tipo}{k}
//       { org_id, planId, ubicId, tipo: "firma" | "foto", k, mime, data: Bytes, uid, en }

export const MOTIVOS = [
  ["ausente", "No había nadie"],
  ["direccion", "Dirección incorrecta o no encontrada"],
  ["rechazado", "El cliente lo rechaza"],
  ["cerrado", "Cerrado"],
  ["danado", "Mercancía dañada"],
  ["otro", "Otro motivo"],
];
export const nombreMotivo = m => (MOTIVOS.find(x => x[0] === m) || [m, m || "Sin motivo"])[1];
export const MAX_FOTOS = 3;
/** Tamaño máximo de una foto o firma ya comprimida (una ficha de Firestore admite < 1 MB) */
export const MAX_BYTES_PRUEBA = 850_000;

/** El id de una foto o de la firma de una parada (el mismo al reenviarla: no se duplica) */
export const idPrueba = (planId, ubicId, tipo, k = 0) => `${planId}_${ubicId}_${tipo}${k}`;

/** ¿Este plan (por su sector) se hace con prueba de entrega? */
export const conEntrega = sector => !!sector?.ver?.entrega;

/** Minutos del día → «09:30» */
export const hhmm = m => (m == null || !Number.isFinite(+m) ? "" : `${String(Math.floor((+m % 1440) / 60)).padStart(2, "0")}:${String(Math.round(+m % 60)).padStart(2, "0")}`);

/** La franja prometida al cliente, para enseñarla: «09:00–11:00» (o «desde 9:00») */
export function franjaTexto(f) {
  if (!f || (f.desde == null && f.hasta == null)) return "";
  if (f.hasta == null || f.hasta === f.desde) return `a las ${hhmm(f.desde)}`;
  return `${hhmm(f.desde)}–${hhmm(f.hasta)}`;
}

/** Lo que se entrega en la parada, en una línea: «Pedido 4471 · 3 bultos · 120 kg» */
export function queSeEntrega(ub) {
  const p = [];
  if (ub?.pedido) p.push(`Pedido ${ub.pedido}`);
  if (ub?.bultos) p.push(`${ub.bultos} ${/^1$/.test(String(ub.bultos)) ? "bulto" : "bultos"}`);
  if (ub?.kg) p.push(`${ub.kg} kg`);
  return p.join(" · ");
}

/** El estado de la parada para pintarla: pendiente, entregada o no entregada */
export function estadoEntrega(ub) {
  if (ub?.entrega?.estado === "no_entregada") return "no_entregada";
  if (ub?.realizado) return "entregada";
  return "pendiente";
}

/**
 * Lo que se guarda en la parada al confirmar.
 * @param datos { estado, motivo, recibe, nota, fotos, firma, sinFirma }
 * @param pos { lat, lng, precision } o null (sin GPS)
 */
export function registroEntrega(datos, pos, ahora = Date.now()) {
  const entregada = datos.estado === "entregada";
  return {
    estado: entregada ? "entregada" : "no_entregada",
    motivo: entregada ? null : datos.motivo || "otro",
    recibe: entregada ? String(datos.recibe || "").trim() : "",
    nota: String(datos.nota || "").trim(),
    fotos: Math.max(0, Math.min(MAX_FOTOS, datos.fotos | 0)),
    firma: entregada && !datos.sinFirma && !!datos.firma,
    sinFirma: entregada && !!datos.sinFirma,
    lat: pos?.lat != null ? +(+pos.lat).toFixed(6) : null,
    lng: pos?.lng != null ? +(+pos.lng).toFixed(6) : null,
    precision: pos?.precision != null ? Math.round(pos.precision) : null,
    en: ahora,
  };
}

/** ¿Falta algo para poder confirmar? (texto del aviso, o "" si se puede) */
export function faltaParaConfirmar(datos, { firmaObligatoria = true } = {}) {
  if (datos.estado === "entregada") {
    if (datos.sinFirma) {
      if (!String(datos.recibe || "").trim()) return "Escribe dónde se deja";
      if (!(datos.fotos > 0)) return "Haz al menos una foto de dónde se deja";
      return "";
    }
    if (!String(datos.recibe || "").trim()) return "Escribe quién lo recibe";
    if (firmaObligatoria && !datos.firma) return "Falta la firma de quien lo recibe";
    return "";
  }
  if (datos.estado === "no_entregada") return datos.motivo ? "" : "Elige el motivo";
  return "Elige si se ha entregado o no";
}

/** Las paradas de un plan por estado: { entregadas, noEntregadas, pendientes } */
export function cuentaEntregas(ubicaciones) {
  const c = { entregadas: 0, noEntregadas: 0, pendientes: 0 };
  for (const u of ubicaciones || []) {
    const e = estadoEntrega(u);
    if (e === "entregada") c.entregadas++; else if (e === "no_entregada") c.noEntregadas++; else c.pendientes++;
  }
  return c;
}
