// Análisis → Cierre del mes: horas de cada trabajador sacadas de sus fichajes,
// repartidas como las pide la nómina, y lo que no cuadra con el Cuadrante.
//
//   · Ordinarias y extra: extra lo que pase de la jornada máxima diaria
//     (reglas del cuadrante; si no hay, 9 h, ET art. 34.3) o del tope del mes
//     (monthlyCap), lo que salga mayor.
//   · Nocturnas: las trabajadas entre las 22:00 y las 06:00 (ET art. 36).
//   · En domingo o festivo: las de esos días (festivos de las reglas).
//   · Avisos: fichajes sin cerrar, días con turno en el cuadrante sin fichaje
//     y días que fichó estando de libre o de baja.
import { monthlyCap } from "../roster-optimizer.js";

const HORAS_DIA_ET = 9;
const TRABAJA = new Set(["M", "T", "N"]); // códigos del cuadrante que son turno de trabajo
const pad = n => String(n).padStart(2, "0");
const ms = t => (typeof t === "number" ? t : t?.toMillis?.() ?? (t?.seconds != null ? t.seconds * 1000 : null));

/** Minutos de [a, b] (ms) que caen entre las 22:00 y las 06:00 */
export function minutosNocturnos(a, b) {
  let total = 0;
  const d = new Date(a); d.setHours(0, 0, 0, 0);
  for (let dia = d.getTime() - 86400000; dia < b; dia += 86400000) {
    const ini = dia + 22 * 3600000, fin = dia + 30 * 3600000; // 22:00 → 06:00 del día siguiente
    total += Math.max(0, Math.min(b, fin) - Math.max(a, ini));
  }
  return Math.round(total / 60000);
}

/**
 * @param fichajes  los del mes ({ uid, nombre, fecha, horaEntrada, horaSalida, kmRecorridos, estado })
 * @param workers   scheduling_workers ({ _id, uid, nombre, apellidos })
 * @param grid      cuadrante del mes: workerId → { día: código }
 * @param rules     reglas del cuadrante (maxHorasDia, maxHorasMes, jornadaAnualH, festivos)
 * @param precios   { costeHora, costeHoraExtra, plusNocturnaHora, plusFestivoPct } (opcional)
 */
export function cierreDelMes({ fichajes = [], workers = [], grid = {}, rules = {}, precios = {}, year, month }) {
  const diasMes = new Date(year, month, 0).getDate();
  const limiteDia = (rules.maxHorasDia > 0 ? rules.maxHorasDia : HORAS_DIA_ET) * 60;
  const topeMes = monthlyCap(rules, diasMes) * 60;
  const festivos = new Set(rules.festivos || []);
  const esFestivo = fecha => festivos.has(fecha) || new Date(fecha + "T12:00").getDay() === 0;
  const workerDeUid = new Map(workers.filter(w => w.uid).map(w => [w.uid, w]));

  const personas = new Map(); // uid → acumulado
  const de = (uid, nombre) => {
    if (!personas.has(uid)) {
      const w = workerDeUid.get(uid);
      personas.set(uid, { uid, workerId: w?._id || null, nombre: w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") : (nombre || "Sin nombre"),
        porDia: {}, km: 0, abiertos: [], avisos: [] });
    }
    return personas.get(uid);
  };
  for (const f of fichajes) {
    if (!f?.uid || !f.fecha?.startsWith(`${year}-${pad(month)}`)) continue;
    const p = de(f.uid, f.nombre);
    const a = ms(f.horaEntrada), b = ms(f.horaSalida);
    if (!b || f.estado === "abierto") { p.abiertos.push(f.fecha); continue; }
    const dia = p.porDia[f.fecha] || (p.porDia[f.fecha] = { min: 0, noct: 0 });
    dia.min += Math.max(0, Math.round((b - a) / 60000));
    dia.noct += minutosNocturnos(a, b);
    p.km += +f.kmRecorridos || 0;
  }
  // los del cuadrante con turno que no ficharon nada en el mes también salen
  for (const w of workers) {
    if (!w.uid || personas.has(w.uid)) continue;
    if (Object.values(grid[w._id] || {}).some(c => TRABAJA.has(c))) de(w.uid);
  }

  const filas = [...personas.values()].map(p => {
    const dias = Object.entries(p.porDia);
    let total = 0, extraDiaria = 0, noct = 0, festivo = 0;
    for (const [fecha, d] of dias) {
      total += d.min; noct += d.noct;
      extraDiaria += Math.max(0, d.min - limiteDia);
      if (esFestivo(fecha)) festivo += d.min;
    }
    const extra = Math.max(extraDiaria, topeMes > 0 ? total - topeMes : 0);
    const g = grid[p.workerId] || {};
    const faltas = [], enLibre = [];
    for (let dd = 1; dd <= diasMes; dd++) {
      const fecha = `${year}-${pad(month)}-${pad(dd)}`, code = g[dd];
      const fichado = !!p.porDia[fecha] || p.abiertos.includes(fecha);
      if (TRABAJA.has(code) && !fichado) faltas.push(dd);
      if ((code === "L" || code === "B" || code === "V") && fichado) enLibre.push(dd);
    }
    const avisos = [];
    if (p.abiertos.length) avisos.push(`${p.abiertos.length} fichaje(s) sin cerrar: ${p.abiertos.map(f => +f.slice(8)).join(", ")}`);
    if (faltas.length) avisos.push(`Con turno sin fichaje: ${faltas.join(", ")}`);
    if (enLibre.length) avisos.push(`Fichó estando de libre, baja o vacaciones: ${enLibre.join(", ")}`);
    if (!p.workerId) avisos.push("No está vinculado a ningún trabajador de la plantilla");
    const ordinarias = total - extra;
    const ch = +precios.costeHora || 0;
    const importe = ch || +precios.costeHoraExtra || +precios.plusNocturnaHora
      ? Math.round(((ordinarias / 60) * ch + (extra / 60) * (+precios.costeHoraExtra || ch) + (noct / 60) * (+precios.plusNocturnaHora || 0)
        + (festivo / 60) * ch * ((+precios.plusFestivoPct || 0) / 100)) * 100) / 100
      : null;
    return { uid: p.uid, workerId: p.workerId, nombre: p.nombre, dias: dias.length, total, ordinarias, extra, nocturnas: noct, festivo,
      km: Math.round(p.km), abiertos: p.abiertos.length, faltas, enLibre, avisos, importe };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const suma = k => filas.reduce((x, f) => x + (f[k] || 0), 0);
  return {
    filas, limiteDia, topeMes,
    totales: { personas: filas.length, total: suma("total"), extra: suma("extra"), nocturnas: suma("nocturnas"), festivo: suma("festivo"),
      km: suma("km"), conAvisos: filas.filter(f => f.avisos.length).length,
      importe: filas.some(f => f.importe != null) ? Math.round(suma("importe") * 100) / 100 : null },
  };
}
