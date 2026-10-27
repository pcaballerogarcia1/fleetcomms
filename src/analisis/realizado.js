// Análisis → Realizado: lo planificado de cada ruta publicada frente a lo que
// se hizo (paradas marcadas en la app del conductor y su fichaje del día).
//
// Planificado: el plan (planes/{id}): paradas, hora prevista de cada una
// (ubicaciones[].horaPlan) y la jornada y km previstos (plan.plan).
// Realizado: ubicaciones[].realizado/realizadoEn y los fichajes del conductor
// ese día (horaEntrada, horaSalida, kmRecorridos).
import { diaDelPlan } from "../publicar-rutas.js";

const ms = t => (typeof t === "number" ? t : t?.toMillis?.() ?? (t?.seconds != null ? t.seconds * 1000 : null));
const minDelDia = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const pad = n => String(n).padStart(2, "0");

/** La fecha (YYYY-MM-DD) de un plan */
export function fechaDelPlan(p) {
  const d = diaDelPlan(p);
  return p?.mes && d ? `${p.mes}-${pad(d)}` : null;
}

/**
 * Una fila por ruta publicada.
 * @returns [{ id, fecha, ruta, conductor, paradas, hechas, pct, pendientes, primera, ultima,
 *             retrasoMedio, plan: { inicio, fin, minutos, km }, real: { inicio, fin, minutos, km, abierto } }]
 */
export function filasRealizado(planes = [], fichajes = []) {
  const fichDe = new Map(); // uid|fecha → fichajes
  for (const f of fichajes) {
    if (!f?.uid || !f.fecha) continue;
    const k = `${f.uid}|${f.fecha}`;
    (fichDe.get(k) || fichDe.set(k, []).get(k)).push(f);
  }
  return planes.filter(p => p && p.tipo !== "corr").map(p => {
    const us = p.ubicaciones || [];
    const hechas = us.filter(u => u.realizado);
    const tiempos = hechas.map(u => ms(u.realizadoEn)).filter(Boolean).sort((a, b) => a - b);
    const desfases = hechas.filter(u => u.horaPlan != null && ms(u.realizadoEn)).map(u => minDelDia(ms(u.realizadoEn)) - u.horaPlan);
    const fecha = fechaDelPlan(p);
    const uids = p.conductorUid ? [p.conductorUid] : [...new Set(hechas.map(u => u.realizadoPor).filter(Boolean))];
    const fs = uids.flatMap(uid => fichDe.get(`${uid}|${fecha}`) || []);
    const entradas = fs.map(f => ms(f.horaEntrada)).filter(Boolean), salidas = fs.map(f => ms(f.horaSalida)).filter(Boolean);
    const real = fs.length ? {
      inicio: entradas.length ? minDelDia(Math.min(...entradas)) : null,
      fin: salidas.length ? minDelDia(Math.max(...salidas)) : null,
      minutos: entradas.length && salidas.length ? Math.round((Math.max(...salidas) - Math.min(...entradas)) / 60000) : null,
      km: fs.some(f => f.kmRecorridos != null) ? fs.reduce((x, f) => x + (+f.kmRecorridos || 0), 0) : null,
      abierto: fs.some(f => f.estado === "abierto"),
    } : null;
    return {
      id: p._id || p.id, fecha,
      ruta: p.vehiculoNombre || p.nombre || "Ruta",
      conductor: p.conductorNombre || "",
      paradas: us.length, hechas: hechas.length,
      pct: us.length ? Math.round((hechas.length / us.length) * 100) : 0,
      pendientes: us.filter(u => !u.realizado).map(u => [u.pa, [u.calle, u.num].filter(Boolean).join(" ")].filter(Boolean).join(" · ")),
      primera: tiempos.length ? minDelDia(tiempos[0]) : null,
      ultima: tiempos.length ? minDelDia(tiempos[tiempos.length - 1]) : null,
      retrasoMedio: desfases.length ? Math.round(desfases.reduce((a, b) => a + b, 0) / desfases.length) : null,
      plan: p.plan || null,
      real,
    };
  }).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || a.ruta.localeCompare(b.ruta));
}

/** Totales de unas filas. Los km y las horas solo cuentan donde hay plan y real a la vez. */
export function totalesRealizado(filas) {
  const t = { rutas: filas.length, paradas: 0, hechas: 0, kmPlan: 0, kmReal: 0, minPlan: 0, minReal: 0, conKm: 0, conHoras: 0, sinFichaje: 0, incompletas: 0 };
  for (const f of filas) {
    t.paradas += f.paradas; t.hechas += f.hechas;
    if (f.hechas < f.paradas) t.incompletas++;
    if (!f.real) { t.sinFichaje++; continue; }
    if (f.plan?.km != null && f.real.km != null) { t.kmPlan += f.plan.km; t.kmReal += f.real.km; t.conKm++; }
    if (f.plan?.minutos != null && f.real.minutos != null) { t.minPlan += f.plan.minutos; t.minReal += f.real.minutos; t.conHoras++; }
  }
  t.pct = t.paradas ? Math.round((t.hechas / t.paradas) * 100) : 0;
  return t;
}
