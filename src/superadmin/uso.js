// Panel del superadmin · el uso de una empresa. Casi todo con «contar»
// (Firestore cuenta sin leer los documentos: 1 lectura por cada 1000), para
// no gastar la cuota diaria aunque la empresa sea grande.
import { collection, getCountFromServer, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase.js";

const contar = async (col, filtros) => {
  try { return (await getCountFromServer(query(collection(db, col), ...filtros.map(([c, op, v]) => where(c, op, v))))).data().count; }
  catch { return null; } // sin índice o sin permiso: no se enseña
};
const mesDe = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const ms = x => (x?.toMillis ? x.toMillis() : typeof x === "number" ? x : Date.parse(x || "") || null);

/** Las cifras de uso de una empresa → { … } (null en lo que no se pudo contar) */
export async function usoDeEmpresa(org, ahora = new Date()) {
  const mes = mesDe(ahora);
  const [proyectos, vehiculos, trabajadores, rutasMes, fichajesMes, incidenciasAbiertas, pedidos, ia, documentos, pendientes, presencia, actividad] = await Promise.all([
    contar("scheduling_projects", [["org_id", "==", org]]),
    contar("scheduling_vehicles", [["org_id", "==", org]]),
    contar("scheduling_workers", [["org_id", "==", org]]),
    contar("planes", [["org_id", "==", org], ["mes", "==", mes]]),
    contar("fichajes", [["org_id", "==", org], ["fecha", ">=", `${mes}-01`]]),
    contar("incidencias", [["org_id", "==", org], ["estado", "==", "abierta"]]),
    contar("pedidos", [["org_id", "==", org]]),
    contar("ia_conexiones", [["org_id", "==", org], ["activa", "==", true]]),
    contar("documentos", [["org_id", "==", org]]),
    contar("solicitudes_ausencia", [["org_id", "==", org], ["estado", "==", "pendiente"]]),
    getDocs(query(collection(db, "presencia"), where("org_id", "==", org))).then(s => s.docs.map(d => d.data())).catch(() => []),
    getDocs(query(collection(db, "auditoria"), where("org_id", "==", org), orderBy("atMs", "desc"), limit(15))).then(s => s.docs.map(d => d.data())).catch(() => []),
  ]);
  const conectados = presencia.filter(p => p.online !== false && ahora.getTime() - (ms(p.lastSeen) || 0) < 3 * 60_000);
  const ultimaPresencia = Math.max(0, ...presencia.map(p => ms(p.lastSeen) || 0));
  return {
    mes, proyectos, vehiculos, trabajadores, rutasMes, fichajesMes, incidenciasAbiertas, pedidos, ia, documentos, pendientes,
    conectados: conectados.map(p => p.nombre || p.email || "—"),
    ultimaActividad: Math.max(ultimaPresencia, ms(actividad[0]?.atMs) || 0) || null,
    acciones: actividad.map(a => ({ cuando: ms(a.atMs), quien: a.nombre || "—", modulo: a.modulo || "", accion: a.accion || "", detalle: a.detalle || "" })),
  };
}

/**
 * Las horas de uso de cada persona: hoy, últimos 7 días y este mes (de uso_mes).
 * → [{ uid, nombre, rol, hoy, semana, mes, oficina, app, ultimo }] en minutos, de más a menos
 */
export async function horasPorPersona(org, ahora = new Date()) {
  const mes = mesDe(ahora);
  const antes = new Date(ahora.getFullYear(), ahora.getMonth(), 0); // último día del mes anterior
  const mesAntes = mesDe(antes);
  const docs = (await getDocs(query(collection(db, "uso_mes"), where("org_id", "==", org), where("mes", "in", [mes, mesAntes])))).docs.map(d => d.data());
  // los 7 días, con su mes
  const semana = Array.from({ length: 7 }, (_, i) => { const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - i); return [mesDe(d), String(d.getDate())]; });
  const porPersona = new Map();
  for (const u of docs) {
    const p = porPersona.get(u.uid) || { uid: u.uid, nombre: u.nombre || "—", rol: u.rol || "", hoy: 0, semana: 0, mes: 0, oficina: 0, app: 0, ultimo: null };
    p.nombre = u.nombre || p.nombre; p.rol = u.rol || p.rol;
    for (const [m, d] of semana) if (m === u.mes) p.semana += +(u.dias?.[d] || 0);
    if (u.mes === mes) {
      p.mes += +(u.minutos || 0); p.oficina += +(u.oficina || 0); p.app += +(u.app || 0);
      p.hoy += +(u.dias?.[String(ahora.getDate())] || 0);
    }
    p.ultimo = Math.max(p.ultimo || 0, ms(u.ultimo) || 0) || null;
    porPersona.set(u.uid, p);
  }
  return [...porPersona.values()].sort((a, b) => b.mes - a.mes || b.semana - a.semana);
}

/** 135 → «2 h 15 min» */
export const horas = min => (!min ? "—" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

/** Última actividad de cada empresa (para la lista): Map<org, ms|null> — 1 lectura por empresa */
export async function ultimaActividad(orgs) {
  const pares = await Promise.all(orgs.map(async org => {
    try {
      const s = await getDocs(query(collection(db, "auditoria"), where("org_id", "==", org), orderBy("atMs", "desc"), limit(1)));
      return [org, s.empty ? null : ms(s.docs[0].data().atMs)];
    } catch { return [org, null]; }
  }));
  return new Map(pares);
}

/** «hace 5 min», «hace 3 días», «nunca» */
export function haceCuanto(t, ahora = Date.now()) {
  if (!t) return "nunca";
  const min = Math.round((ahora - t) / 60000);
  if (min < 2) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : d < 60 ? `hace ${d} días` : `hace ${Math.round(d / 30)} meses`;
}
