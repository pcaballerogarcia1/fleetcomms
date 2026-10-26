import { C } from "./tema.js";
// Planning → Trabajos: lo que se hace en cada punto. Un punto se sube una vez
// y puede llevar varios trabajos (recogida, lavado exterior, lavado interior,
// mantenimiento preventivo…), cada uno con su frecuencia, su duración y el
// tipo de vehículo que lo hace.
//  · El catálogo del proyecto se empieza con la plantilla de su sector.
//  · Por defecto un trabajo se hace en todos los puntos; las reglas en bloque
//    lo quitan o lo ponen según una columna («Fracción = VIDRIO»), y pueden
//    cambiarle la frecuencia o la duración en esos puntos.
//  · Las excepciones de un punto concreto van en su fila del Timetable.
// Se guarda en el proyecto: trabajos, reglasTrabajos y vehiculosTrabajos
// ({ idVehículo: [idTrabajo] }: qué trabajos puede hacer cada vehículo).
// Sin React ni Firebase.

/** Las frecuencias que se ofrecen (se puede escribir otra: «L-X-V», «3/semana»…) */
export const FRECUENCIAS = [
  "diaria", "L-X-V", "3/semana", "2/semana", "semanal", "quincenal", "2/mes", "mensual",
  "bimestral", "trimestral", "semestral", "anual", "a demanda",
];

/** Visitas al año de una frecuencia (para el resumen); null si no se entiende */
export function visitasAnio(frecuencia, diasServicioSemana = 6) {
  const x = String(frecuencia || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!x) return null;
  if (/demanda|aviso/.test(x)) return 0;
  if (/diari|todos los dias|cada dia/.test(x)) return diasServicioSemana * 52;
  if (/^l ?- ?v$|laborable|lunes a viernes/.test(x)) return 5 * 52;
  if (/quincenal|cada 2 semanas|cada dos semanas/.test(x)) return 26;
  if (/bimestral|cada 2 meses|cada dos meses/.test(x)) return 6;
  if (/trimestral|cada 3 meses/.test(x)) return 4;
  if (/semestral|cada 6 meses/.test(x)) return 2;
  if (/anual|1 ?vez al ano|cada ano/.test(x)) return 1;
  const mes = /^(\d+)\s*(?:\/|x|veces)?\s*(?:al |por |\/)?mes/.exec(x);
  if (mes) return +mes[1] * 12;
  if (/mensual|1 ?vez al mes/.test(x)) return 12;
  const sem = /^(\d+)\s*(?:\/|x|veces)?\s*(?:a la |por |\/)?semana/.exec(x);
  if (sem) return Math.min(+sem[1], diasServicioSemana) * 52;
  if (/semanal|1 ?vez/.test(x)) return 52;
  const letras = x.toUpperCase().replace(/[^LMXJVSD]/g, "");
  if (letras && /^[lmxjvsd,;\s/-]+$/.test(x)) return new Set(letras).size * 52;
  const dias = /^cada (\d+) dias$/.exec(x);
  if (dias) return Math.round(365 / Math.max(1, +dias[1]));
  return null;
}

// ── Plantillas por sector ──
const T = (id, nombre, frecuencia, duracion, vehiculo, personas, color) => ({ id, nombre, frecuencia, duracion, vehiculo, personas, color, todos: true });
export const PLANTILLAS = {
  residuos: [
    T("recogida", "Recogida", "diaria", 2, "Camión recolector", 1, C.blue),
    T("lavado-ext", "Lavado exterior", "quincenal", 8, "Hidrolimpiadora", 1, C.green),
    T("lavado-int", "Lavado interior", "mensual", 12, "Camión lavacontenedores", 2, C.violet),
    T("preventivo", "Mantenimiento preventivo", "trimestral", 20, "Furgoneta de taller", 2, C.orange),
  ],
  contadores: [
    T("lectura", "Lectura", "bimestral", 3, "Furgoneta", 1, C.blue),
    T("inspeccion", "Inspección", "anual", 10, "Furgoneta", 1, C.green),
    T("cambio", "Cambio de contador", "a demanda", 30, "Furgoneta de taller", 1, C.orange),
  ],
  mantenimiento: [
    T("revision", "Revisión preventiva", "mensual", 15, "Furgoneta de taller", 2, C.blue),
    T("limpieza", "Limpieza", "trimestral", 20, "Furgoneta", 1, C.green),
    T("reparacion", "Reparación", "a demanda", 45, "Furgoneta de taller", 2, C.orange),
  ],
  otros: [
    T("visita", "Visita", "semanal", 15, "Furgoneta", 1, C.blue),
  ],
};
export const plantillaDe = sector => (PLANTILLAS[sector] || PLANTILLAS.residuos).map(t => ({ ...t }));

/** Un id corto y legible para un trabajo nuevo */
export function idNuevo(nombre, existentes = []) {
  const base = String(nombre || "trabajo").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trabajo";
  let id = base, n = 2;
  const usados = new Set(existentes.map(t => t.id));
  while (usados.has(id)) id = `${base}-${n++}`;
  return id;
}

// ── Puntos y columnas ──
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** Las columnas de un punto (las capas guardan unas en «campos» y otras sueltas) */
export function camposDe(m) {
  const c = m?.campos || m?.fields || m || {};
  return Object.fromEntries(Object.entries(c).filter(([k]) => !/^(_|lat$|lng$|id$|lon$)/i.test(k)));
}
/** Las columnas que hay en los puntos, con sus valores (para las reglas): [{ campo, valores: [[valor, nº]] }] */
export function columnasDe(puntos, maxValores = 60) {
  const mapa = new Map();
  for (const p of puntos) for (const [k, v] of Object.entries(camposDe(p))) {
    const t = String(v ?? "").trim();
    if (!t) continue;
    if (!mapa.has(k)) mapa.set(k, new Map());
    const vals = mapa.get(k);
    vals.set(t, (vals.get(t) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([campo, vals]) => ({ campo, valores: [...vals.entries()].sort((a, b) => b[1] - a[1]) }))
    // columnas útiles para agrupar: con algún valor repetido y no demasiados distintos
    .filter(c => c.valores.length <= maxValores && c.valores.some(([, n]) => n > 1))
    .sort((a, b) => a.campo.localeCompare(b.campo, "es"));
}
/** ¿Cumple el punto la condición de la regla? (campo «*» = todos) */
export function cumple(punto, regla) {
  if (!regla.campo || regla.campo === "*") return true;
  const c = camposDe(punto);
  const k = Object.keys(c).find(x => norm(x) === norm(regla.campo));
  return k != null && norm(c[k]) === norm(regla.valor);
}

/**
 * Los trabajos de un punto, con su frecuencia y duración.
 * @param excepciones { [idTrabajo]: { activo?, frecuencia?, duracion? } } (las del Timetable)
 * @returns { [idTrabajo]: { frecuencia, duracion } }
 */
export function trabajosDePunto(punto, trabajos = [], reglas = [], excepciones = {}) {
  const out = {};
  for (const t of trabajos) if (t.todos !== false) out[t.id] = { frecuencia: t.frecuencia, duracion: Number(t.duracion) || 15 };
  for (const r of reglas) {
    const t = trabajos.find(x => x.id === r.trabajoId);
    if (!t || !cumple(punto, r)) continue;
    if (r.accion === "quitar") { delete out[t.id]; continue; }
    out[t.id] = {
      frecuencia: r.frecuencia || out[t.id]?.frecuencia || t.frecuencia,
      duracion: Number(r.duracion) || out[t.id]?.duracion || Number(t.duracion) || 15,
    };
  }
  for (const [id, e] of Object.entries(excepciones || {})) {
    const t = trabajos.find(x => x.id === id);
    if (!t) continue;
    if (e.activo === false) { delete out[id]; continue; }
    if (e.activo === true || out[id]) {
      out[id] = { frecuencia: e.frecuencia || out[id]?.frecuencia || t.frecuencia, duracion: Number(e.duracion) || out[id]?.duracion || Number(t.duracion) || 15 };
    }
  }
  return out;
}

/**
 * Resumen por trabajo: puntos que lo llevan, visitas al año y horas al año.
 * @returns { [idTrabajo]: { puntos, visitas, horas } } (visitas y horas null si alguna frecuencia no se entiende)
 */
export function resumenTrabajos(puntos, trabajos, reglas, diasServicioSemana = 6) {
  const out = Object.fromEntries(trabajos.map(t => [t.id, { puntos: 0, visitas: 0, horas: 0 }]));
  for (const p of puntos) {
    for (const [id, x] of Object.entries(trabajosDePunto(p, trabajos, reglas))) {
      const r = out[id];
      if (!r) continue;
      r.puntos++;
      const v = visitasAnio(x.frecuencia, diasServicioSemana);
      if (v == null || r.visitas == null) { r.visitas = null; r.horas = null; continue; }
      r.visitas += v; r.horas += (v * x.duracion) / 60;
    }
  }
  return out;
}
