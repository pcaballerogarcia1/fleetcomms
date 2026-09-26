// ── Métricas, avisos e indicadores del escenario ─────────────────────
// Funciones puras (sin React ni Firestore) sobre las filas del Gantt de
// Scheduling: vehículos o conductores, cada uno con `assignments` (paradas,
// viajes `_travel`, salida/vuelta a cochera `_depot_exit`/`_depot_return`,
// pausas `_break` y esperas `_wait`, en minutos desde el día 1 a las 00:00).

export const REGLAS_DEFAULT = {
  // Reglamento (CE) 561/2006: conducción continua máx. 4h30 → pausa 45 min
  // (o 15 + 30); conducción diaria máx. 9h. Aplica a camiones > 3,5 t y
  // autobuses; la recogida de residuos puede estar exenta → configurable.
  aplicar561: true,
  conduccionContinuaMax: 270,
  pausaConduccionMin: 45,
  conduccionDiariaMax: 540,
  // Estatuto de los Trabajadores, art. 34.4: jornada continuada > 6h →
  // descanso mínimo de 15 min.
  jornadaSinPausaMax: 360,
  pausaJornadaMin: 15,
};

const dur = a => Math.max(0, (a._end ?? a._start) - a._start);

/** Métricas de una fila en un día (0 = primer día del escenario). */
export function dayMetrics(row, day) {
  const off = day * 1440;
  const list = (row?.assignments || [])
    .filter(a => a._start >= off && a._start < off + 1440)
    .sort((a, b) => a._start - b._start);
  const m = {
    activo: list.length > 0, inicio: null, fin: null, amplitud: 0,
    conduccion: 0, trabajo: 0, pausas: 0, espera: 0,
    km: 0, kmVacio: 0, paradas: 0, fueraFranja: 0, list,
  };
  if (!list.length) return m;
  m.inicio = list[0]._start;
  m.fin = Math.max(...list.map(a => a._end ?? a._start));
  m.amplitud = m.fin - m.inicio;
  for (const a of list) {
    const d = dur(a);
    if (a._travel) {
      m.conduccion += d; m.km += a.km || 0;
      if (a._depot_exit || a._depot_return) m.kmVacio += a.km || 0;
    } else if (a._break) m.pausas += d;
    else if (a._wait) m.espera += d;
    else {
      m.trabajo += d; m.paradas++;
      if (a.windowEnd != null && a._start % 1440 > a.windowEnd % 1440 + 0.5) m.fueraFranja++;
      if (a.windowStart != null && a._start % 1440 < a.windowStart % 1440 - 0.5) m.fueraFranja++;
    }
  }
  return m;
}

const hm = min => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;

/** Avisos de reglas de una fila en un día → [{ nivel: "error"|"aviso", texto }] */
export function dayIssues(m, { maxShiftMin = 0, reglas = REGLAS_DEFAULT } = {}) {
  const out = [];
  if (!m?.activo) return out;
  const r = { ...REGLAS_DEFAULT, ...(reglas || {}) };
  if (maxShiftMin > 0 && m.amplitud > maxShiftMin) {
    out.push({ nivel: "error", texto: `Jornada de ${hm(m.amplitud)}: supera el máximo de ${hm(maxShiftMin)}` });
  }
  if (m.fueraFranja > 0) {
    out.push({ nivel: "error", texto: `${m.fueraFranja} parada(s) fuera de su franja horaria` });
  }
  if (r.aplicar561) {
    if (m.conduccion > r.conduccionDiariaMax) {
      out.push({ nivel: "error", texto: `Conducción diaria de ${hm(m.conduccion)}: supera ${hm(r.conduccionDiariaMax)} (UE 561/2006)` });
    }
    // Conducción continua: se acumula hasta una pausa de al menos
    // pausaConduccionMin, que puede partirse (15 + 30): las partes de 15 min
    // o más se van sumando aunque entre ellas se vuelva a conducir.
    let seguido = 0, pausaAcum = 0, peor = 0;
    for (const a of m.list) {
      if (a._travel) { seguido += dur(a); peor = Math.max(peor, seguido); }
      else if (a._break || a._wait) {
        const d = dur(a);
        if (d >= 15) pausaAcum += d;
        if (pausaAcum >= r.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
      }
    }
    if (peor > r.conduccionContinuaMax) {
      out.push({ nivel: "error", texto: `${hm(peor)} de conducción sin la pausa de ${r.pausaConduccionMin} min (máx. ${hm(r.conduccionContinuaMax)}, UE 561/2006)` });
    }
  }
  // Estatuto: jornada continuada > 6h sin al menos 15 min de descanso
  if (m.amplitud > r.jornadaSinPausaMax) {
    const tienePausa = m.list.some(a => (a._break || a._wait) && dur(a) >= r.pausaJornadaMin);
    if (!tienePausa) out.push({ nivel: "aviso", texto: `Jornada de ${hm(m.amplitud)} sin descanso de ${r.pausaJornadaMin} min (Estatuto, art. 34.4)` });
  }
  return out;
}

/** Vehículos activos a la vez en el peor momento de cada día (PVR). */
export function pvr(vehicleRows, days) {
  let best = 0;
  for (let d = 0; d < days; d++) {
    const ev = [];
    for (const r of vehicleRows || []) {
      const m = dayMetrics(r, d);
      if (m.activo) { ev.push([m.inicio, 1]); ev.push([m.fin, -1]); }
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    for (const [, s] of ev) { cur += s; best = Math.max(best, cur); }
  }
  return best;
}

/** Indicadores del escenario completo (todos los días). */
export function scenarioKpis({ vehicles = [], workers = [], unassigned = 0, days = 1, maxShiftMin = 0, reglas, costeHora = 0, costeKm = 0 } = {}) {
  const k = {
    vehiculos: 0, pvr: pvr(vehicles, days), turnos: 0, paradas: 0,
    km: 0, kmVacio: 0, conduccion: 0, trabajo: 0, pagado: 0,
    avisos: 0, filasConAviso: 0, sinAsignar: unassigned,
  };
  for (const v of vehicles) {
    let usado = false;
    for (let d = 0; d < days; d++) {
      const m = dayMetrics(v, d);
      if (!m.activo) continue;
      usado = true;
      k.km += m.km; k.kmVacio += m.kmVacio; k.paradas += m.paradas;
    }
    if (usado) k.vehiculos++;
  }
  // Tiempo pagado y reglas: por conductor si hay conductores; si no, por vehículo
  const personas = workers.length ? workers : vehicles;
  for (const w of personas) {
    let conAviso = false;
    for (let d = 0; d < days; d++) {
      const m = dayMetrics(w, d);
      if (!m.activo) continue;
      k.turnos++;
      k.pagado += m.amplitud; k.conduccion += m.conduccion; k.trabajo += m.trabajo;
      const iss = dayIssues(m, { maxShiftMin, reglas });
      if (iss.length) { k.avisos += iss.length; conAviso = true; }
    }
    if (conAviso) k.filasConAviso++;
  }
  k.eficVehiculo = k.km > 0 ? (k.km - k.kmVacio) / k.km : null;          // km en ruta / km totales
  k.eficPersonal = k.pagado > 0 ? (k.conduccion + k.trabajo) / k.pagado : null; // tiempo productivo / pagado
  k.coste = (costeHora > 0 || costeKm > 0) ? (k.pagado / 60) * costeHora + k.km * costeKm : null;
  return k;
}
