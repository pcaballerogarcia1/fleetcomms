// ── VRP ENGINE ────────────────────────────────────────────────────
// Algoritmo de scheduling puro: sin React, sin Firebase, sin DOM. Extraído
// de scheduling.jsx para poder testearlo de verdad (importando estas mismas
// funciones, no una copia) con Vitest — ver vrp-engine.test.js.

// ── HELPERS DE TIEMPO ─────────────────────────────────────────────
export function timeToMin(t) {
  if (!t) return null;
  const s = String(t).trim();
  // Red de seguridad: un valor sin ":" que sea un decimal entre 0 y 1 es casi
  // siempre un número de serie de Excel sin convertir (fracción del día —
  // 0.5 = 12:00), colado por alguna vía de importación que no pidió el texto
  // formateado. Sin esto se interpretaba como "0.41 minutos" en vez de las
  // 10:00 reales, generando franjas horarias absurdas agrupadas cerca de
  // medianoche.
  if (!s.includes(":") && /^0?\.\d+$/.test(s)) {
    const frac = Number(s);
    if (frac > 0 && frac < 1) return Math.round(frac * 1440);
  }
  const [h, m] = s.split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}
export function minToTime(m) {
  if (m == null) return "--:--";
  const h = Math.floor(m / 60) % 24;
  const mn = m % 60;
  return `${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}`;
}

// Parse "Mañana (06-14)" → { start: 360, end: 840 }
export function turnoWindow(turno, fallbackStart, fallbackEnd) {
  if (!turno) return { start: fallbackStart, end: fallbackEnd };
  const m = turno.match(/\((\d{2})-(\d{2})\)/);
  if (!m) return { start: fallbackStart, end: fallbackEnd };
  const start = parseInt(m[1]) * 60;
  let   end   = parseInt(m[2]) * 60;
  if (end <= start) end += 24 * 60; // overnight
  return { start, end };
}

// Ventana horaria de una tarea (task.windowStart/windowEnd, minuto del día,
// vienen del Timetable de Planning — "hora inicio" u "franja horaria")
// contra una hora de llegada dada (ya con dayOffset sumado). Sin ventana,
// libertad total (null → 0, nunca bloquea). Devuelve el tiempo de espera
// necesario si se llega pronto, o null si ya no se puede cumplir ese día
// (se llegaría tarde) — la tarea se deja para otro día/vehículo, igual que
// cualquier otra restricción de tiempo que ya existía.
export function windowWait(task, arrival, dayOffset) {
  if (task.windowStart == null) return 0;
  const winStart = task.windowStart + dayOffset;
  const winEnd   = (task.windowEnd ?? task.windowStart) + dayOffset;
  if (arrival > winEnd) return null;
  return arrival < winStart ? winStart - arrival : 0;
}

// Código de turno (M/T/N) a partir de la hora de inicio real de un
// trabajador — agnóstico al texto de "turno" (que en los conductores
// virtuales de autoScaleFleet siempre es "Jornada completa", nunca
// "Mañana (06-14)"). Compara contra los 3 arranques estándar (06/14/22h)
// en un reloj circular de 24h y se queda con el más cercano.
export function shiftCodeFromStart(startMin) {
  if (startMin == null) return null;
  const m = ((startMin % 1440) + 1440) % 1440;
  const anchors = [[360, "M"], [840, "T"], [1320, "N"]];
  let best = null, bestDist = Infinity;
  for (const [anchor, code] of anchors) {
    const d = Math.min(Math.abs(m - anchor), 1440 - Math.abs(m - anchor));
    if (d < bestDist) { bestDist = d; best = code; }
  }
  return best;
}

// Haversine distance in km — returns 0 for invalid/missing coordinates.
// null/undefined must be checked BEFORE the +x coercion: +null is 0 (a
// finite number), so without this a missing depot (depotLat/depotLng null,
// normal for a virtual vehicle with no fixed depot) would silently compute
// a real distance against lat=0,lng=0 instead of being treated as "no depot".
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0;
  lat1 = +lat1; lng1 = +lng1; lat2 = +lat2; lng2 = +lng2;
  if (!isFinite(lat1) || !isFinite(lat2) || !isFinite(lng1) || !isFinite(lng2)) return 0;
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Returns true only for valid numeric coordinates
export function hasCoords(lat, lng) {
  return isFinite(+lat) && isFinite(+lng) && (+lat !== 0 || +lng !== 0);
}

// ── Reasignación manual de paradas en el Gantt ────────────────────
// Al mover una parada de un vehículo/trabajador a otro (drag&drop o panel
// lateral), estas funciones calculan dónde encaja de verdad — sin retrasar
// la siguiente parada ya asignada (solape) y respetando su franja horaria
// si la tiene — y reconstruyen los bloques de viaje/espera del hueco
// afectado. No dependen de React: se reutilizan tanto para la vista previa
// (huecos resaltados al hacer clic) como para aplicar el movimiento.

// Huecos candidatos de `row` en el día que empieza en `dayOffset` (0, 1440,
// 2880...) donde `task` podría insertarse. Un hueco solo se ofrece si no
// empuja la siguiente parada real (evitaría solaparla) y si la propia
// tarea puede cumplir su franja horaria desde ahí. Los huecos que
// contienen una pausa programada se descartan para no partirla, y los que
// cruzan un relevo de conductor (row._shiftBreaks, turno partido) también
// — si no, el bloque de viaje que rellena el hueco quedaría a caballo
// entre los dos turnos (empieza antes del relevo, termina después), y al
// repartir esas paradas por conductor ese tramo de viaje se atribuiría al
// turno equivocado (o inflaría su jornada más allá de su propio horario).
export function computeCandidateSlots(task, row, dayOffset, maxShiftMin = 0) {
  const dayStart = dayOffset + (row._tw?.start ?? row.shiftStart ?? 0);
  const dayEnd   = dayOffset + (row._tw?.end   ?? row.shiftEnd   ?? 1440);

  const dayItems = (row.assignments || [])
    .filter(a => a._start >= dayOffset && a._start < dayOffset + 1440)
    .sort((a, b) => a._start - b._start);
  const stops = dayItems.filter(a => a !== task && !a._travel && !a._break && !a._wait);
  const hasBreakIn = (from, to) => dayItems.some(a => a._break && a._start >= from && a._start < to);
  const shiftBoundaries = (row._shiftBreaks || []).map(b => b + dayOffset).filter(b => b > dayStart && b < dayEnd);
  const crossesShiftBoundary = (from, to) => shiftBoundaries.some(b => b > from && b < to);

  const depotLat = row.depotLat, depotLng = row.depotLng;
  const slots = [];
  for (let g = 0; g <= stops.length; g++) {
    const prev = g === 0 ? null : stops[g - 1];
    const next = g === stops.length ? null : stops[g];
    const prevEnd    = prev ? prev._end   : dayStart;
    const prevLat    = prev ? prev.lat    : depotLat;
    const prevLng    = prev ? prev.lng    : depotLng;
    const nextStart  = next ? next._start : dayEnd;
    const nextLat    = next ? next.lat    : depotLat;
    const nextLng    = next ? next.lng    : depotLng;
    if (prevEnd > nextStart || hasBreakIn(prevEnd, nextStart) || crossesShiftBoundary(prevEnd, nextStart)) continue;

    const inKm  = haversineKm(prevLat, prevLng, task.lat, task.lng);
    const inMin = inKm >= 0.05 ? Math.max(1, Math.ceil(inKm / TRAVEL_SPEED_KMH * 60)) : 0;
    const earliestArrival = prevEnd + inMin;
    const wait = windowWait(task, earliestArrival, dayOffset);
    if (wait === null) continue; // se llegaría después de que cierre su franja
    const arrival = earliestArrival + wait;
    const taskEnd = arrival + (task.duracion || 15);

    const outKm  = haversineKm(task.lat, task.lng, nextLat, nextLng);
    const outMin = outKm >= 0.05 ? Math.max(1, Math.ceil(outKm / TRAVEL_SPEED_KMH * 60)) : 0;
    if (taskEnd + outMin > nextStart) continue; // solaparía la siguiente parada / fin de turno

    // "Duración máxima de turno" (maxShiftMin): el reparto principal la
    // respeta desde el primer día, pero esta función también la usan la
    // reparación de huérfanos y el reequilibrado de carga — sin este
    // control, cualquiera de los dos podía insertar una parada que alargara
    // el turno más allá del límite configurado, dejando jornadas de más de
    // 8h aunque el límite estuviera puesto.
    if (maxShiftMin > 0 && (taskEnd - dayStart) > maxShiftMin) continue;

    const originalDirectKm = haversineKm(prevLat, prevLng, nextLat, nextLng);
    slots.push({
      prevStop: prev, nextStop: next, prevEnd, nextStart,
      inKm, inMin, outKm, outMin, wait, arrival, taskEnd,
      kmDelta: +((inKm + outKm) - originalDirectKm).toFixed(3),
    });
  }
  return slots;
}

// Aplica un movimiento ya validado por computeCandidateSlots. Devuelve los
// nuevos arrays de assignments para la fila origen y destino (quita la
// tarea y cierra su hueco antiguo con un viaje directo; la inserta en el
// hueco elegido con sus nuevos bloques de viaje/espera alrededor).
export function applyTaskMove(task, fromRow, toRow, slot, dayOffset) {
  const sameRow = (fromRow._id || fromRow.id) === (toRow._id || toRow.id);
  const dayS = a => a._start >= dayOffset && a._start < dayOffset + 1440;

  const fromItems = [...(fromRow.assignments || [])].sort((a, b) => a._start - b._start);
  const fromDayStops = fromItems.filter(a => a !== task && !a._travel && !a._break && !a._wait && dayS(a));
  const afterIdx  = fromDayStops.findIndex(a => a._start > task._start);
  const origPrev  = afterIdx === -1 ? (fromDayStops.length ? fromDayStops[fromDayStops.length - 1] : null) : (afterIdx > 0 ? fromDayStops[afterIdx - 1] : null);
  const origNext  = afterIdx === -1 ? null : fromDayStops[afterIdx];
  const origDayStart = dayOffset + (fromRow._tw?.start ?? fromRow.shiftStart ?? 0);
  const origDayEnd   = dayOffset + (fromRow._tw?.end   ?? fromRow.shiftEnd   ?? 1440);
  const gapStart = origPrev ? origPrev._end   : origDayStart;
  const gapEnd   = origNext ? origNext._start : origDayEnd;

  let closingBlock = null;
  if (origPrev && origNext) {
    const km = haversineKm(origPrev.lat, origPrev.lng, origNext.lat, origNext.lng);
    if (km >= 0.05) {
      const min = Math.max(1, Math.ceil(km / TRAVEL_SPEED_KMH * 60));
      closingBlock = { _travel: true, _start: origPrev._end, _end: origPrev._end + min, duracion: min, km: +km.toFixed(3) };
    }
  }
  const newFromAssignments = fromItems
    .filter(a => a !== task && !(dayS(a) && a._start >= gapStart && a._start < gapEnd))
    .concat(closingBlock ? [closingBlock] : []);

  const movedTask = { ...task, _start: slot.arrival, _end: slot.taskEnd };
  const newBlocks = [];
  if (slot.inKm >= 0.05) {
    newBlocks.push({ _travel: true, _start: slot.prevEnd, _end: slot.prevEnd + slot.inMin, duracion: slot.inMin, km: +slot.inKm.toFixed(3), ...(slot.prevStop ? {} : { _depot_exit: true }) });
  }
  if (slot.wait > 0) {
    newBlocks.push({ _wait: true, _start: slot.arrival - slot.wait, _end: slot.arrival, duracion: slot.wait });
  }
  newBlocks.push(movedTask);
  if (slot.outKm >= 0.05) {
    newBlocks.push({ _travel: true, _start: slot.taskEnd, _end: slot.taskEnd + slot.outMin, duracion: slot.outMin, km: +slot.outKm.toFixed(3), ...(slot.nextStop ? {} : { _depot_return: true }) });
  }

  const toItems = sameRow ? newFromAssignments : [...(toRow.assignments || [])].sort((a, b) => a._start - b._start);
  const newToAssignments = toItems
    .filter(a => !(dayS(a) && a._start >= slot.prevEnd && a._start < slot.nextStart))
    .concat(newBlocks)
    .sort((a, b) => a._start - b._start);

  return sameRow
    ? { newFromAssignments: newToAssignments, newToAssignments, movedTask }
    : { newFromAssignments, newToAssignments, movedTask };
}

// ── VRP ALGORITHM HELPERS ─────────────────────────────────────────
export const TRAVEL_SPEED_KMH = 30;

// Fast squared euclidean distance (no sqrt, no trig) — sufficient for clustering comparisons
export function distSq(a, b) {
  const dlat = a.lat - b.lat, dlng = a.lng - b.lng;
  return dlat * dlat + dlng * dlng;
}

export const _yield = () => new Promise(resolve => setTimeout(resolve, 0));

// Farthest-point sampling: deterministic k-means seed (no randomness).
// async + yields once per seed picked: for large fleets (autoScaleFleet can
// push k past 100) this loop alone can run tens of millions of comparisons
// with no chance for the browser to paint — since every module stays
// mounted in the background (see main.jsx), that froze the ENTIRE app, not
// just Scheduling, while a scenario was generating.
export async function fpsSeed(pts, k) {
  if (!pts.length) return [];
  const cx = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const center = { lat: cx, lng: cy };
  let seed0 = 0, minD = Infinity;
  pts.forEach((p, i) => { const d = distSq(p, center); if (d < minD) { minD = d; seed0 = i; } });
  const seeds = [seed0];
  while (seeds.length < k) {
    let far = -1, maxD = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (seeds.includes(i)) continue;
      let minSeedD = Infinity;
      for (const s of seeds) { const d = distSq(pts[i], pts[s]); if (d < minSeedD) minSeedD = d; }
      if (minSeedD > maxD) { maxD = minSeedD; far = i; }
    }
    if (far === -1) break;
    seeds.push(far);
    await _yield();
  }
  return seeds;
}

// K-means geographic clustering (deterministic, uses fast squared distance).
// async + yields once per iteration (max 20) for the same reason as fpsSeed.
export async function kMeansCluster(pts, k, maxIter = 20) {
  if (k <= 1 || !pts.length) return new Array(pts.length).fill(0);
  if (k >= pts.length) return pts.map((_, i) => i);
  const seeds = await fpsSeed(pts, k);
  const C = seeds.map(i => ({ lat: pts[i].lat, lng: pts[i].lng }));
  const asgn = new Int32Array(pts.length);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < C.length; j++) {
        const d = distSq(pts[i], C[j]);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (asgn[i] !== best) { asgn[i] = best; changed = true; }
    }
    if (!changed) break;
    const sumLat = new Float64Array(k), sumLng = new Float64Array(k), cnt = new Int32Array(k);
    for (let i = 0; i < pts.length; i++) { sumLat[asgn[i]] += pts[i].lat; sumLng[asgn[i]] += pts[i].lng; cnt[asgn[i]]++; }
    for (let j = 0; j < k; j++) if (cnt[j]) { C[j].lat = sumLat[j] / cnt[j]; C[j].lng = sumLng[j] / cnt[j]; }
    await _yield();
  }
  return Array.from(asgn);
}

// Nearest-neighbor TSP — optionally start from a depot point
export function nnTSP(stops, depotPt = null) {
  if (stops.length === 0) return [];
  if (stops.length === 1) return [...stops];
  const rem = [...stops];
  // Pick the first stop: nearest to depot if provided, otherwise first element
  let firstIdx = 0;
  if (depotPt && hasCoords(depotPt.lat, depotPt.lng)) {
    let bd = Infinity;
    rem.forEach((s, i) => {
      if (!hasCoords(s.lat, s.lng)) return;
      const d = haversineKm(depotPt.lat, depotPt.lng, s.lat, s.lng);
      if (d < bd) { bd = d; firstIdx = i; }
    });
  }
  const route = [rem.splice(firstIdx, 1)[0]];
  while (rem.length) {
    const last = route[route.length - 1];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const d = hasCoords(last.lat, last.lng) && hasCoords(rem[i].lat, rem[i].lng)
        ? haversineKm(last.lat, last.lng, rem[i].lat, rem[i].lng) : 999;
      if (d < bd) { bd = d; bi = i; }
    }
    route.push(rem.splice(bi, 1)[0]);
  }
  return route;
}

// Boustrophedon (strip) sort — O(n log n), used for large clusters instead of O(n²) TSP.
// Divides the bounding box into horizontal strips and zigzags through them,
// producing a geographically coherent route without quadratic distance calculations.
export function stripSort(stops, strips = 30) {
  if (stops.length < 2) return stops;
  const minLat = Math.min(...stops.map(s => s.lat));
  const maxLat = Math.max(...stops.map(s => s.lat));
  const range  = maxLat - minLat || 1e-9;
  return [...stops].sort((a, b) => {
    const sa = Math.floor((a.lat - minLat) / range * strips);
    const sb = Math.floor((b.lat - minLat) / range * strips);
    if (sa !== sb) return sa - sb;
    return sa % 2 === 0 ? a.lng - b.lng : b.lng - a.lng;
  });
}

// 2-opt improvement (open path, no depot return). async + yields once per
// pass — a single ~1500-stop cluster can otherwise run up to 20 passes over
// an O(n²) scan (tens of millions of haversine calls) with no yield at all.
export async function twoOpt(route) {
  if (route.length < 4) return route;
  const d = (a, b) => (!a || !b || !hasCoords(a.lat, a.lng) || !hasCoords(b.lat, b.lng)) ? 0
    : haversineKm(a.lat, a.lng, b.lat, b.lng);
  let best = [...route];
  let improved = true;
  let passes = 0;
  const maxPasses = Math.min(20, route.length);
  while (improved && passes++ < maxPasses) {
    improved = false;
    outer: for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const before = d(best[i-1], best[i]) + d(best[j], best[j+1]);
        const after  = d(best[i-1], best[j]) + d(best[i], best[j+1]);
        if (after < before - 0.005) {
          best = [...best.slice(0, i), ...best.slice(i, j+1).reverse(), ...best.slice(j+1)];
          improved = true;
          break outer;
        }
      }
    }
    await _yield();
  }
  return best;
}

// nnTSP/twoOpt/stripSort ordenan un clúster puramente por distancia — no
// saben nada de franjas horarias. Una parada con franja podía acabar a
// cientos de posiciones de donde hacía falta (el vecino más cercano no
// tiene motivo para visitarla pronto si geográficamente encaja mejor
// tarde), muy por encima de las 40 paradas que tryLookaheadSwap es capaz
// de mirar hacia delante — y quedarse sin asignar aunque el vehículo
// pasara físicamente al lado en algún otro momento del día (caso real:
// Palma de Mallorca, paradas a 100-300m de otra del mismo vehículo pero
// 5-9 horas más tarde).
//
// Reordena SOLO las paradas con franja dentro de la cola ya ordenada
// geográficamente, insertándolas en la posición cuya hora estimada
// (progreso lineal del turno a lo largo de la cola — una aproximación,
// no una simulación real) esté más cerca de su franja. Las paradas
// flexibles mantienen su orden geográfico entre sí; solo se les insertan
// las de franja delante en el punto adecuado.
export function reorderByWindowHint(queue, shiftStart, shiftEnd) {
  const windowed = [], flexible = [];
  for (const t of queue) (t.windowStart != null ? windowed : flexible).push(t);
  if (!windowed.length || !flexible.length) return queue;
  windowed.sort((a, b) => a.windowStart - b.windowStart);
  const span = Math.max(1, shiftEnd - shiftStart);
  const merged = [];
  let wi = 0;
  flexible.forEach((t, fi) => {
    const estMin = shiftStart + (fi / flexible.length) * span;
    while (wi < windowed.length && windowed[wi].windowStart <= estMin) {
      merged.push(windowed[wi]); wi++;
    }
    merged.push(t);
  });
  while (wi < windowed.length) { merged.push(windowed[wi]); wi++; }
  return merged;
}

// ── SCENARIO GENERATION ───────────────────────────────────────────
// Phase 1 — k-means geographic clustering (one compact zone per resource)
// Phase 2 — nearest-neighbor TSP + 2-opt per zone (minimize route km)
// Phase 3 — sequential time layout with travel blocks and shift constraints
const MAX_AUTO_DAYS = 365; // safety cap for auto-day expansion

export async function generateScenario(tasks, resources, constraints) {
  const { maxShiftMin, maxStops, breakDur, breakAfter, startMin: winStart, endMin: winEnd, maxDays, circular, optimizeWeight, virtualShiftMin } = constraints;
  const dayCap = maxDays > 0 ? maxDays : MAX_AUTO_DAYS;

  if (!resources.length) return { schedule: [], unassigned: [...tasks], daysUsed: 1 };

  const k = resources.length;

  // Sort resources by shift start (morning→afternoon), stable across days
  const resOrder = resources.map((_, i) => i).sort((a, b) => {
    const wa = turnoWindow(resources[a].turno, winStart, winEnd);
    const wb = turnoWindow(resources[b].turno, winStart, winEnd);
    return wa.start !== wb.start ? wa.start - wb.start : (resources[a].nombre || "").localeCompare(resources[b].nombre || "");
  });

  // Persistent per-resource state (accumulates assignments across all days)
  const state = resources.map(r => {
    const tw = turnoWindow(r.turno, winStart, winEnd);
    const shiftStart = r._effectiveStart ?? tw.start;
    const shiftEnd   = r._effectiveEnd   ?? tw.end;
    return { ...r, assignments: [], shiftStart, shiftEnd, totalKm: 0 };
  });

  // ── ONE-TIME cluster + route ordering (key speedup vs. re-clustering every day) ──
  const withCoords = tasks.filter(t => hasCoords(t.lat, t.lng));
  const noCoords   = tasks.filter(t => !hasCoords(t.lat, t.lng));
  const clusterQueues = Array.from({ length: k }, () => []);

  if (withCoords.length > 0) {
    if (k === 1) {
      clusterQueues[0] = [...withCoords];
    } else {
      const asgn = await kMeansCluster(withCoords, k);
      const rawClusters = Array.from({ length: k }, () => []);
      withCoords.forEach((t, i) => rawClusters[asgn[i]].push(t));

      // Rebalance: fix both empty clusters AND severely undersized ones.
      // k-means can produce a cluster with only 70 tasks out of 44 000 when
      // data has fewer natural groups than k. We bring every cluster up to a
      // minimum load by stealing from the most loaded cluster.
      //
      // "Priorizar turnos" (optimizeWeight, 0=km · 100=turnos) blends the
      // balancing target between raw task COUNT (tight geographic clusters —
      // today's default, favors short routes even if some vehicles end up
      // with more work than others) and estimated WORK TIME (equalizes total
      // duration per vehicle so no single vehicle becomes the bottleneck that
      // drags out the whole scenario's day count, at the cost of handing some
      // tasks to a vehicle that isn't its closest geographic match). At
      // weight=0 this reproduces the exact previous behavior (count-only,
      // 50% floor) — zero change for existing scenarios.
      //
      // "Jornada máx. de los añadidos" (virtualShiftMin) implica lo mismo
      // aunque no se toque el otro slider: fijar cuántas horas debe durar
      // cada turno solo tiene sentido si los clusters llevan bastante
      // trabajo para llenarlos — un reparto solo por número de paradas puede
      // dejar clusters con apenas ~550 min (la mañana llena, la tarde con
      // las migajas). Probado con datos tipo ciudad real (zonas densas +
      // dispersas): con suelo 0.85 la media de uso se quedaba en 53% y 35 de
      // 44 vehículos por debajo del 50%; con reparto 100% por tiempo baja a
      // 40 vehículos, ninguno por debajo del 50% y máx 98%. Al pedir una
      // jornada máxima concreta ya se asume el coste en km de repartir así.
      const baseOptT = Math.max(0, Math.min(100, optimizeWeight || 0)) / 100;
      const optT = virtualShiftMin ? Math.max(baseOptT, 1) : baseOptT;
      const totalDur   = withCoords.reduce((s, t) => s + (t.duracion || 15), 0);
      const avgTaskDur = totalDur / withCoords.length;
      const clusterLoad = cl => {
        if (optT === 0) return cl.length;
        const dur = cl.reduce((s, t) => s + (t.duracion || 15), 0);
        return (1 - optT) * cl.length + optT * (dur / avgTaskDur);
      };
      const avgLoad     = withCoords.length / k;
      const minFraction = 0.5 + optT * 0.4; // 50% (solo evita clusters vacíos) → 90% (reparto casi igualado)
      const minLoad     = Math.max(1, avgLoad * minFraction);
      let rebalChanged = true;
      while (rebalChanged) {
        rebalChanged = false;
        for (let ci = 0; ci < k; ci++) {
          if (clusterLoad(rawClusters[ci]) >= minLoad) continue;  // big enough
          let maxCi = 0;
          for (let cj = 1; cj < k; cj++) {
            if (clusterLoad(rawClusters[cj]) > clusterLoad(rawClusters[maxCi])) maxCi = cj;
          }
          const donor = rawClusters[maxCi];
          if (clusterLoad(donor) > minLoad) {                      // donor has surplus
            const deficit = minLoad - clusterLoad(rawClusters[ci]);
            const take = Math.min(Math.max(1, Math.ceil(deficit)), Math.floor(donor.length / 2));
            if (take > 0) {
              rawClusters[ci].push(...donor.splice(donor.length - take, take));
              rebalChanged = true;
            }
          }
        }
      }

      const centroids = rawClusters.map(cl => cl.length
        ? { lat: cl.reduce((s, t) => s + t.lat, 0) / cl.length, lng: cl.reduce((s, t) => s + t.lng, 0) / cl.length }
        : { lat: 0, lng: 0 });
      const clusterOrder = centroids.map((_, i) => i).sort((a, b) => centroids[a].lng - centroids[b].lng);

      // Assign clusters to resources by longitude order (west→east).
      for (let pos = 0; pos < k; pos++) {
        clusterQueues[resOrder[pos]] = rawClusters[clusterOrder[pos]];
      }
    }
  }
  noCoords.forEach((t, i) => clusterQueues[resOrder[i % k]].push(t));

  // Sort each cluster once (strip-sort for large, TSP+2-opt for small).
  // A plain .map() here ran every cluster's O(n²) twoOpt/nnTSP back-to-back
  // with zero yields between them — for many vehicles this alone could
  // freeze the whole app for seconds. Now an async loop with a yield
  // between clusters, so the UI stays responsive throughout.
  const sortedQueues = [];
  for (let i = 0; i < clusterQueues.length; i++) {
    const cluster = clusterQueues[i];
    const depot = (resources[i]?.depotLat && resources[i]?.depotLng)
      ? { lat: +resources[i].depotLat, lng: +resources[i].depotLng } : null;
    const withC = cluster.filter(t => hasCoords(t.lat, t.lng));
    const noC   = cluster.filter(t => !hasCoords(t.lat, t.lng));
    const ordered = withC.length > 1500 ? stripSort(withC) : await twoOpt(nnTSP(withC, depot));
    const hinted = reorderByWindowHint(ordered, state[i].shiftStart, state[i].shiftEnd);
    sortedQueues.push([...hinted, ...noC]);
    await _yield();
  }

  // Pointer into each queue — advances as tasks are assigned (never reset between days)
  const queueIdx  = new Int32Array(k);
  // Per-resource counter of stops assigned today (reset each day, for maxStops)
  const dayStops  = new Int32Array(k);

  let day = 0;
  let anyAssignedThisDay = true;

  while (anyAssignedThisDay && day < dayCap) {
    anyAssignedThisDay = false;
    const dayOffset = day * 1440;
    dayStops.fill(0);

    for (let i = 0; i < k; i++) {
      // Con maxDays=1 este bucle es la ÚNICA pasada del día — el único yield
      // de abajo (una vez por día) no basta cuando k es grande (decenas de
      // vehículos, p.ej. por auto-escalado): todo el trabajo de ese día se
      // hacía de un tirón, y con suficientes vehículos eso solo ya podía
      // superar los segundos que el navegador tolera antes de avisar de que
      // la pestaña "no responde". Cede el hilo cada pocos vehículos.
      if (i > 0 && i % 5 === 0) await _yield();

      const res   = state[i];
      const queue = sortedQueues[i];
      if (queueIdx[i] >= queue.length) continue; // all tasks for this resource done

      const depot  = (res.depotLat && res.depotLng)
        ? { lat: +res.depotLat, lng: +res.depotLng } : null;
      const dayEnd = res.shiftEnd + dayOffset;

      // Circularidad: con depósito, cada conductor vinculado al vehículo
      // vuelve a él al final de SU turno, no solo al final del día (segEnds
      // = un límite por cada relevo + el fin de jornada). Sin depósito, el
      // punto de vuelta es la ubicación de la primera parada del propio día
      // (anchor se fija dinámicamente más abajo). Con circular=false,
      // segEnds=[dayEnd] reproduce exactamente el comportamiento anterior.
      const segEnds = circular && res._shiftBreaks?.length
        ? [...res._shiftBreaks.map(b => b + dayOffset), dayEnd]
        : [dayEnd];

      let cursor     = res.shiftStart + dayOffset;
      let sinceBreak = 0;
      let lastLat    = depot ? depot.lat : null;
      let lastLng    = depot ? depot.lng : null;
      let fromDepot  = !!depot;
      let anchor     = depot; // null hasta que circular fije la primera parada del día

      // Reparto proporcional de la jornada entre tramos (p.ej. mañana + tarde
      // con relevo de conductor a mitad de turno): sin esto, el primer tramo
      // consumía la cola vorazmente hasta llenarse del todo (llegaba a
      // usar 84-94% de sus horas) y el resto se quedaba con las migajas —
      // en datos reales, turnos de tarde con menos de un tercio de
      // ocupación mientras la mañana iba casi llena, aunque el trabajo
      // total del vehículo ni de lejos llenara los dos tramos completos.
      // Se estima el trabajo pendiente por la duración de servicio de las
      // tareas en cola (sin simular la ruta entera por adelantado) y se
      // reparte esa estimación entre los tramos según su peso.
      const dayStart0 = res.shiftStart + dayOffset;
      const segStarts = [dayStart0, ...segEnds.slice(0, -1)];
      let segTargets = null;
      if (segEnds.length > 1) {
        const segCaps   = segEnds.map((se, idx) => se - segStarts[idx]);
        const totalCap  = segCaps.reduce((s, c) => s + c, 0);
        const estService = queue.slice(queueIdx[i]).reduce((s, t) => s + (t.duracion || 15), 0);
        const estTotal = Math.min(totalCap, estService * 1.15); // +15% de margen para viajes
        segTargets = segCaps.map((cap, idx) => {
          if (idx === segCaps.length - 1) return segEnds[idx];
          return segStarts[idx] + Math.min(cap, estTotal * (cap / totalCap));
        });
      }

      for (let segIdx = 0; segIdx < segEnds.length; segIdx++) {
        const segEnd = segEnds[segIdx];
        // REVERTIDO (ver historial): se probó a poner un tope duro de
        // virtualShiftMin en el último tramo (primero para todos los
        // vehículos, luego solo para los virtuales) para que ningún turno
        // superara los minutos configurados ni por unos pocos minutos. En
        // datos reales de Madrid, incluso limitado solo a los conductores
        // virtuales, disparó la flota necesaria de 89 a más de 200
        // vehículos — un coste muchísimo mayor que el problema que
        // arreglaba (turnos ~8 minutos por encima del límite). Se vuelve al
        // comportamiento original: el último tramo no se limita, para no
        // perder trabajo real que sí cabía por una estimación de reparto
        // que se queda corta.
        const effSegEnd = segTargets ? segTargets[segIdx] : segEnd;
        // Si el head-of-queue es inviable para este tramo (p.ej. demasiado lejos
        // del anchor para volver a tiempo, o su franja horaria ya no se puede
        // cumplir), busca hasta 40 tareas por delante y adelanta la que MENOS
        // espera exija a la posición actual — no la primera que "encaje" a
        // secas. Antes se aceptaba la primera tarea viable en orden de cola,
        // aunque encajara solo porque el turno tenía margen de sobra para
        // absorber una espera de horas — así una parada con franja lejana en
        // cabeza de cola bloqueaba al vehículo en una espera larga aunque la
        // siguiente tarea de la cola fuera libre y se pudiera hacer ya mismo.
        // Ahora prioriza espera=0 (parar en cuanto la encuentra) y, si no hay
        // ninguna, la de menor espera. También se reintenta cada vez que la
        // cabeza de cola deja de ser viable, no solo al empezar el tramo. El
        // criterio de viabilidad es idéntico al del bucle de abajo (mismo
        // maxShiftMin/segEnd/ventana) para que, si encuentra una tarea, el
        // bucle la acepte siempre al re-evaluarla — si no, un desajuste entre
        // ambos criterios podría reintentar sin avanzar nunca.
        function tryLookaheadSwap() {
          if (queueIdx[i] >= queue.length) return false;
          const LOOK = Math.min(40, queue.length - queueIdx[i]);
          const tWorkSoFar = cursor - (res.shiftStart + dayOffset);
          let swapTo = -1, bestWait = Infinity;
          for (let li = 0; li < LOOK; li++) {
            const t = queue[queueIdx[i] + li];
            const tdur = t.duracion || 15;
            let ttMin = 0;
            if (hasCoords(lastLat, lastLng) && hasCoords(t.lat, t.lng)) {
              const tkm = haversineKm(lastLat, lastLng, t.lat, t.lng);
              if (tkm >= 0.05) ttMin = Math.max(1, Math.ceil(tkm / TRAVEL_SPEED_KMH * 60));
            }
            const tWait = windowWait(t, cursor + ttMin, dayOffset);
            if (tWait == null || tWait >= bestWait) continue; // inviable hoy, o ya hay algo igual o mejor
            let tRet = 0;
            if (anchor && hasCoords(t.lat, t.lng)) {
              const rkm = haversineKm(+t.lat, +t.lng, anchor.lat, anchor.lng);
              if (rkm >= 0.05) tRet = Math.max(1, Math.ceil(rkm / TRAVEL_SPEED_KMH * 60));
            }
            const fits = cursor + ttMin + tWait + tdur + tRet <= effSegEnd
              && !(maxShiftMin > 0 && tWorkSoFar + ttMin + tWait + tdur + tRet > maxShiftMin);
            if (fits) {
              swapTo = li; bestWait = tWait;
              if (tWait === 0) break; // no se puede mejorar una espera de 0
            }
          }
          if (swapTo > 0) {
            const [best] = queue.splice(queueIdx[i] + swapTo, 1);
            queue.splice(queueIdx[i], 0, best);
            return true;
          }
          return false; // la cabeza ya era la mejor opción disponible (o no hay ninguna) — nada que cambiar
        }

        tryLookaheadSwap();

        // Cesión de hilo dentro del bucle de UN vehículo, no solo entre
        // vehículos: con pocos recursos (p.ej. k=1, la primera pasada antes
        // de auto-escalar) toda la cola puede ser de cientos de tareas, y con
        // muchas de franja horaria cada una puede disparar tryLookaheadSwap
        // (hasta 40 candidatos) una o dos veces. Sin esto, un único vehículo
        // con una cola larga bloqueaba el hilo entero sin que la cesión
        // "cada 5 vehículos" de más arriba llegara siquiera a activarse.
        let taskIterations = 0;

        while (queueIdx[i] < queue.length) {
          if (++taskIterations % 25 === 0) await _yield();
          const task = queue[queueIdx[i]];
          const dur  = task.duracion || 15;

          if (maxStops > 0 && dayStops[i] >= maxStops) break; // tope duro — cambiar de tarea no ayuda

          if (breakAfter > 0 && breakDur > 0 && sinceBreak >= breakAfter && cursor + breakDur <= segEnd) {
            res.assignments.push({ _break: true, _start: cursor, _end: cursor + breakDur, duracion: breakDur });
            cursor += breakDur; sinceBreak = 0;
          }

          let travelMin = 0, travelKm = 0;
          if (hasCoords(lastLat, lastLng) && hasCoords(task.lat, task.lng)) {
            travelKm = haversineKm(lastLat, lastLng, task.lat, task.lng);
            if (travelKm >= 0.05) travelMin = Math.max(1, Math.ceil(travelKm / TRAVEL_SPEED_KMH * 60));
          }

          // Franja horaria (Timetable de Planning): si se llega antes de que
          // abra, espera; si ya no se puede llegar a tiempo, esta tarea en
          // concreto no es viable ahora mismo (se intenta otra más abajo).
          let wait = windowWait(task, cursor + travelMin, dayOffset);

          // Si esta tarea exige esperar (o directamente no es viable), antes
          // de comprometerse con esa espera comprueba si hay algo con menos
          // espera (o sin ninguna) un poco más adelante en la cola — si no,
          // una parada con franja lejana en cabeza de cola se aceptaba tal
          // cual con horas de espera aunque la siguiente tarea fuera libre y
          // se pudiera hacer ya mismo.
          if (wait == null || wait > 0) {
            if (tryLookaheadSwap()) continue; // encontró algo mejor — reevalúa con la cola reordenada
            if (wait == null) break;          // ni la cabeza ni ninguna alternativa son viables hoy
            // si no: wait > 0 pero es la mejor opción disponible — se acepta con esa espera
          }

          let retBuffer = 0;
          if (anchor) {
            const refLat = hasCoords(task.lat, task.lng) ? +task.lat : lastLat;
            const refLng = hasCoords(task.lat, task.lng) ? +task.lng : lastLng;
            if (hasCoords(refLat, refLng)) {
              const retKmEst = haversineKm(refLat, refLng, anchor.lat, anchor.lng);
              if (retKmEst >= 0.05) retBuffer = Math.max(1, Math.ceil(retKmEst / TRAVEL_SPEED_KMH * 60));
            }
          }

          const workSoFar = cursor - (res.shiftStart + dayOffset);
          const feasible = wait != null
            && !(maxShiftMin > 0 && workSoFar + travelMin + wait + dur + retBuffer > maxShiftMin)
            && (cursor + travelMin + wait + dur + retBuffer <= effSegEnd);

          if (!feasible) {
            // Antes de rendirse por el resto del día (o del tramo, si el
            // reparto proporcional de arriba cortó aquí), busca otra tarea de
            // las próximas 15 que sí encaje ahora mismo — si es el reparto
            // proporcional el que frena, la tarea actual sigue en cabeza de
            // cola y pasará al siguiente tramo (mañana → tarde) tal cual.
            if (tryLookaheadSwap()) continue;
            break;
          }

          if (travelMin > 0) {
            const block = { _travel: true, _start: cursor, _end: cursor + travelMin, duracion: travelMin, km: +travelKm.toFixed(3) };
            if (fromDepot) block._depot_exit = true;
            res.assignments.push(block);
            cursor += travelMin; res.totalKm += travelKm;
          }
          fromDepot = false;
          if (wait > 0) {
            res.assignments.push({ _wait: true, _start: cursor, _end: cursor + wait, duracion: wait });
            cursor += wait;
          }
          res.assignments.push({ ...task, _start: cursor, _end: cursor + dur });
          cursor += dur; sinceBreak += dur;
          if (hasCoords(task.lat, task.lng)) { lastLat = +task.lat; lastLng = +task.lng; }
          // Circularidad sin depósito: la primera parada del día fija el
          // punto de vuelta para el resto de la jornada (todos los tramos).
          if (circular && !depot && !anchor) anchor = { lat: lastLat, lng: lastLng };
          queueIdx[i]++;
          dayStops[i]++;
          anyAssignedThisDay = true;
        }

        // Vuelta al anchor (depósito, o primera parada del día si es circular sin depósito)
        if (anchor && hasCoords(lastLat, lastLng) && (lastLat !== anchor.lat || lastLng !== anchor.lng)) {
          const retKm = haversineKm(lastLat, lastLng, anchor.lat, anchor.lng);
          if (retKm >= 0.05) {
            const retMin = Math.max(1, Math.ceil(retKm / TRAVEL_SPEED_KMH * 60));
            res.assignments.push({
              _travel: true, _depot_return: true,
              _start: cursor, _end: cursor + retMin,
              duracion: retMin, km: +retKm.toFixed(3),
            });
            cursor += retMin; res.totalKm += retKm;
          }
        }

        // El siguiente tramo (relevo de conductor) empieza en su hora fija,
        // no antes aunque el anterior haya terminado con margen.
        if (anchor) { lastLat = anchor.lat; lastLng = anchor.lng; fromDepot = true; }
        cursor = Math.max(cursor, segEnd);
      }
    }

    day++;
    await new Promise(resolve => setTimeout(resolve, 0)); // yield to UI — timer updates
  }

  // ── Early backfill: vehicles with 0 assignments run mop-up-style on days 0..day-1 ──
  // The main loop breaks on the first infeasible queue task (retBuffer check), so a
  // vehicle whose very first cluster task is geometrically far from its depot gets
  // 0 stops for ALL days. This pass gives those vehicles a second chance on the same
  // days as the other vehicles, using continue (not break) so tasks are skipped
  // individually rather than killing the whole day.
  for (let i = 0; i < k; i++) {
    if (i > 0 && i % 5 === 0) await _yield(); // ver comentario del bucle principal — mismo riesgo con k grande
    if (state[i].assignments.length > 0) continue;          // already has work
    if (queueIdx[i] >= sortedQueues[i].length) continue;    // queue exhausted

    const res    = state[i];
    const eDepot = (res.depotLat && res.depotLng)
      ? { lat: +res.depotLat, lng: +res.depotLng } : null;

    for (let bDay = 0; bDay < day; bDay++) {
      const dOff = bDay * 1440;
      const dEnd = res.shiftEnd + dOff;
      if (res.shiftStart + dOff >= dEnd) continue;

      const segEnds = circular && res._shiftBreaks?.length
        ? [...res._shiftBreaks.map(b => b + dOff), dEnd]
        : [dEnd];

      let cur     = res.shiftStart + dOff;
      let lLat    = eDepot ? eDepot.lat : null;
      let lLng    = eDepot ? eDepot.lng : null;
      let fromDep = !!eDepot;
      let anchor  = eDepot;
      let sinceB  = 0;

      for (const segEnd of segEnds) {
        let pi = 0;
        let backfillIterations = 0;
        while (pi < sortedQueues[i].length) {
          if (++backfillIterations % 25 === 0) await _yield();
          const task = sortedQueues[i][pi];
          const dur  = task.duracion || 15;

          if (breakAfter > 0 && breakDur > 0 && sinceB >= breakAfter && cur + breakDur <= segEnd) {
            res.assignments.push({ _break: true, _start: cur, _end: cur + breakDur, duracion: breakDur });
            cur += breakDur; sinceB = 0;
          }

          let tMin = 0, tKm = 0;
          if (hasCoords(lLat, lLng) && hasCoords(task.lat, task.lng)) {
            tKm = haversineKm(lLat, lLng, task.lat, task.lng);
            if (tKm >= 0.05) tMin = Math.max(1, Math.ceil(tKm / TRAVEL_SPEED_KMH * 60));
          }

          const tWait = windowWait(task, cur + tMin, dOff);
          if (tWait == null) { pi++; continue; } // franja ya inviable — prueba otra tarea
          if (cur + tMin + tWait + dur > segEnd) { pi++; continue; }

          if (tMin > 0) {
            const blk = { _travel: true, _start: cur, _end: cur + tMin, duracion: tMin, km: +tKm.toFixed(3) };
            if (fromDep) blk._depot_exit = true;
            res.assignments.push(blk);
            cur += tMin; res.totalKm += tKm;
          }
          fromDep = false;
          if (tWait > 0) {
            res.assignments.push({ _wait: true, _start: cur, _end: cur + tWait, duracion: tWait });
            cur += tWait;
          }
          res.assignments.push({ ...task, _start: cur, _end: cur + dur });
          cur += dur; sinceB += dur;
          if (hasCoords(task.lat, task.lng)) { lLat = +task.lat; lLng = +task.lng; }
          if (circular && !eDepot && !anchor) anchor = { lat: lLat, lng: lLng };
          sortedQueues[i].splice(pi, 1); // remove assigned task; pi stays (next shifts down)
        }

        if (anchor && hasCoords(lLat, lLng) && (lLat !== anchor.lat || lLng !== anchor.lng)) {
          const rKm = haversineKm(lLat, lLng, anchor.lat, anchor.lng);
          if (rKm >= 0.05) {
            const rMin = Math.max(1, Math.ceil(rKm / TRAVEL_SPEED_KMH * 60));
            res.assignments.push({ _travel: true, _depot_return: true, _start: cur, _end: cur + rMin, duracion: rMin, km: +rKm.toFixed(3) });
            cur += rMin; res.totalKm += rKm;
          }
        }

        if (anchor) { lLat = anchor.lat; lLng = anchor.lng; fromDep = true; }
        cur = Math.max(cur, segEnd);
      }
    }
  }

  // Collect remaining unassigned tasks (queueIdx[i]=0 for backfilled vehicles, remaining tasks in sortedQueues[i])
  const leftover = [];
  for (let i = 0; i < k; i++) {
    for (let j = queueIdx[i]; j < sortedQueues[i].length; j++) leftover.push(sortedQueues[i][j]);
  }

  // ── Reequilibrado de carga entre vehículos ────────────────────────
  // El clustering geográfico intenta igualar la carga por tiempo estimado,
  // pero la geografía real no siempre coopera — algunos vehículos acaban
  // con mucho menos trabajo que otros aunque en teoría el reparto fuera
  // equilibrado. Busca, para cada vehículo por debajo del 75% de la media
  // del día, paradas de vehículos por encima de la media que estén cerca
  // de su zona y las reubica — mismo mecanismo que el movimiento manual
  // del Gantt (computeCandidateSlots/applyTaskMove), así que respeta
  // franjas horarias, turnos partidos y todo lo demás automáticamente.
  // Acotado en tiempo: es una búsqueda local (greedy, por rondas), no hace
  // falta encontrar el óptimo absoluto, solo acercarse tanto como el
  // presupuesto de tiempo permita.
  const REBALANCE_BUDGET_MS = 8000;
  let _rebalanceIter = 0;
  async function rebalanceLoad() {
    const start = Date.now();

    // La unidad de comparación es el TRAMO (turno: mañana o tarde), no el
    // día completo — un vehículo con mañana llena y tarde casi vacía tiene
    // un "día completo" que va de la primera parada de la mañana a la
    // última de la tarde, así que medido por día parece lleno aunque la
    // tarde esté prácticamente vacía. Se repite exactamente el mismo
    // cálculo de segEnds/segStarts que usa el reparto principal para que
    // "tramo" signifique lo mismo en los dos sitios.
    function vehicleSegments(res) {
      const dayOffsets = [...new Set((res.assignments || []).map(a => Math.floor(a._start / 1440) * 1440))];
      const segs = [];
      for (const dayOffset of dayOffsets) {
        const dayEnd = res.shiftEnd + dayOffset;
        const segEnds = circular && res._shiftBreaks?.length
          ? [...res._shiftBreaks.map(b => b + dayOffset), dayEnd]
          : [dayEnd];
        const segStarts = [res.shiftStart + dayOffset, ...segEnds.slice(0, -1)];
        segEnds.forEach((segEnd, idx) => segs.push({ dayOffset, segStart: segStarts[idx], segEnd }));
      }
      return segs;
    }
    function segItems(res, seg) {
      return (res.assignments || []).filter(a => a._start >= seg.segStart && a._start < seg.segEnd);
    }
    function segLoad(res, seg) {
      const items = segItems(res, seg);
      if (!items.length) return 0;
      return Math.max(...items.map(a => a._end)) - Math.min(...items.map(a => a._start));
    }
    function segRealStops(res, seg) {
      return segItems(res, seg).filter(a => !a._travel && !a._break && !a._wait);
    }

    // Todas las combinaciones (vehículo, tramo) con algo de trabajo — cada
    // una es una unidad independiente a igualar contra las demás.
    const units = [];
    for (const res of state) for (const seg of vehicleSegments(res)) units.push({ res, seg });
    if (units.length < 2) return;

    let rounds = 0, improved = true;
    while (improved && rounds++ < 40 && Date.now() - start < REBALANCE_BUDGET_MS) {
      improved = false;
      const loaded = units.map(u => ({ ...u, load: segLoad(u.res, u.seg) })).filter(u => u.load > 0);
      if (loaded.length < 2) break;
      const avgLoad = loaded.reduce((s, u) => s + u.load, 0) / loaded.length;
      const underLoaded = loaded.filter(u => u.load < avgLoad * 0.75);
      const overLoaded  = loaded.filter(u => u.load > avgLoad * 1.1);
      if (!underLoaded.length || !overLoaded.length) break;

      for (const under of underLoaded) {
        if (Date.now() - start > REBALANCE_BUDGET_MS) break;
        const underStops = segRealStops(under.res, under.seg);
        const centroid = underStops.length
          ? { lat: underStops.reduce((s, a) => s + a.lat, 0) / underStops.length, lng: underStops.reduce((s, a) => s + a.lng, 0) / underStops.length }
          : (hasCoords(under.res.depotLat, under.res.depotLng) ? { lat: +under.res.depotLat, lng: +under.res.depotLng } : null);
        if (!centroid) continue;

        let bestMove = null, bestKmDelta = Infinity;
        for (const over of overLoaded) {
          if (over.res === under.res && over.seg === under.seg) continue;
          if (over.seg.dayOffset !== under.seg.dayOffset) continue; // no mezclar días distintos
          const candidates = segRealStops(over.res, over.seg)
            .map(t => ({ t, d: haversineKm(centroid.lat, centroid.lng, t.lat, t.lng) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 8); // solo las más cercanas al hueco que se quiere llenar — acota el coste
          for (const { t } of candidates) {
            // computeCandidateSlots evalúa el día entero del vehículo
            // destino — se filtra a solo los huecos que caen DENTRO del
            // tramo infra-cargado, para no colar la tarea en otro tramo
            // (p.ej. la mañana) sin querer.
            const slots = computeCandidateSlots(t, under.res, under.seg.dayOffset, maxShiftMin)
              .filter(s => s.arrival >= under.seg.segStart && s.taskEnd <= under.seg.segEnd);
            if (!slots.length) continue;
            const slot = slots.reduce((a, b) => b.kmDelta < a.kmDelta ? b : a);
            if (slot.kmDelta < bestKmDelta) { bestKmDelta = slot.kmDelta; bestMove = { task: t, fromRow: over.res, slot }; }
          }
        }
        if (bestMove) {
          const { newFromAssignments, newToAssignments } = applyTaskMove(bestMove.task, bestMove.fromRow, under.res, bestMove.slot, under.seg.dayOffset);
          bestMove.fromRow.assignments = newFromAssignments;
          bestMove.fromRow.totalKm = newFromAssignments.reduce((s, a) => s + (a._travel ? (a.km || 0) : 0), 0);
          under.res.assignments = newToAssignments;
          under.res.totalKm = newToAssignments.reduce((s, a) => s + (a._travel ? (a.km || 0) : 0), 0);
          improved = true;
        }
        if (++_rebalanceIter % 20 === 0) await _yield();
      }
    }
  }

  // ── Mop-up pass: redistribute leftover tasks across ALL vehicles ──
  // Each vehicle scans the entire remaining pool and assigns what fits,
  // skipping tasks that don't fit (instead of breaking). This prevents
  // one outlier task from blocking all subsequent assignable tasks.
  if (leftover.length > 0) {
    const pool   = leftover.slice(); // mutable; tasks removed when assigned
    let mopDay   = day;
    let anyMop   = true;

    while (pool.length > 0 && anyMop && mopDay < dayCap) {
      anyMop = false;
      const dayOffset = mopDay * 1440;

      for (let i = 0; i < k && pool.length > 0; i++) {
        if (i > 0 && i % 5 === 0) await _yield(); // ver comentario del bucle principal — mismo riesgo con k grande
        const res   = state[i];
        const depot = (res.depotLat && res.depotLng)
          ? { lat: +res.depotLat, lng: +res.depotLng } : null;
        const dayEnd = res.shiftEnd + dayOffset;
        const segEnds = circular && res._shiftBreaks?.length
          ? [...res._shiftBreaks.map(b => b + dayOffset), dayEnd]
          : [dayEnd];

        let cursor     = res.shiftStart + dayOffset;
        let sinceBreak = 0;
        let lastLat    = depot ? depot.lat : null;
        let lastLng    = depot ? depot.lng : null;
        let fromDepot  = !!depot;
        let anchor     = depot;

        for (const segEnd of segEnds) {
          // Scan every remaining pool task; assign what fits, skip what doesn't.
          // No retBuffer check here — the return-to-anchor leg is appended after
          // the loop and may slightly overshoot segEnd, acceptable for the mop-up.
          let pi = 0;
          let mopIterations = 0;
          while (pi < pool.length) {
            if (++mopIterations % 25 === 0) await _yield();
            const task = pool[pi];
            const dur  = task.duracion || 15;

            if (breakAfter > 0 && breakDur > 0 && sinceBreak >= breakAfter && cursor + breakDur <= segEnd) {
              res.assignments.push({ _break: true, _start: cursor, _end: cursor + breakDur, duracion: breakDur });
              cursor += breakDur; sinceBreak = 0;
            }

            let travelMin = 0, travelKm = 0;
            if (hasCoords(lastLat, lastLng) && hasCoords(task.lat, task.lng)) {
              travelKm = haversineKm(lastLat, lastLng, task.lat, task.lng);
              if (travelKm >= 0.05) travelMin = Math.max(1, Math.ceil(travelKm / TRAVEL_SPEED_KMH * 60));
            }

            const wait = windowWait(task, cursor + travelMin, dayOffset);
            const workSoFar = cursor - (res.shiftStart + dayOffset);
            const fitsShift   = wait != null && (maxShiftMin <= 0 || workSoFar + travelMin + wait + dur <= maxShiftMin);
            const fitsSeg     = wait != null && cursor + travelMin + wait + dur <= segEnd;

            if (!fitsShift || !fitsSeg) {
              pi++; // skip this task for now; it stays in pool for later vehicles/days
              continue;
            }

            // Assign
            if (travelMin > 0) {
              const block = { _travel: true, _start: cursor, _end: cursor + travelMin, duracion: travelMin, km: +travelKm.toFixed(3) };
              if (fromDepot) block._depot_exit = true;
              res.assignments.push(block);
              cursor += travelMin; res.totalKm += travelKm;
            }
            fromDepot = false;
            if (wait > 0) {
              res.assignments.push({ _wait: true, _start: cursor, _end: cursor + wait, duracion: wait });
              cursor += wait;
            }
            res.assignments.push({ ...task, _start: cursor, _end: cursor + dur });
            cursor += dur; sinceBreak += dur;
            if (hasCoords(task.lat, task.lng)) { lastLat = +task.lat; lastLng = +task.lng; }
            if (circular && !depot && !anchor) anchor = { lat: lastLat, lng: lastLng };
            pool.splice(pi, 1); // remove from pool; pi now points to next element
            anyMop = true;
          }

          // Vuelta al anchor (depósito, o primera parada del día si es circular sin depósito)
          if (anchor && hasCoords(lastLat, lastLng) && (lastLat !== anchor.lat || lastLng !== anchor.lng)) {
            const retKm = haversineKm(lastLat, lastLng, anchor.lat, anchor.lng);
            if (retKm >= 0.05) {
              const retMin = Math.max(1, Math.ceil(retKm / TRAVEL_SPEED_KMH * 60));
              res.assignments.push({ _travel: true, _depot_return: true, _start: cursor, _end: cursor + retMin, duracion: retMin, km: +retKm.toFixed(3) });
              cursor += retMin; res.totalKm += retKm;
            }
          }

          if (anchor) { lastLat = anchor.lat; lastLng = anchor.lng; fromDepot = true; }
          cursor = Math.max(cursor, segEnd);
        }
      }

      mopDay++;
    }

    // ── Reparación de huérfanos ──────────────────────────────────────
    // El clustering es puramente geográfico: una tarea (con franja horaria
    // o sin ella) puede caer en el vehículo "equivocado" — uno cuya ruta
    // natural no le deja hueco — sin que añadir más flota arregle nada, es
    // cuestión de a qué vehículo le tocó, no de cuántos haya. En vez de
    // dejarla sin asignar, se prueba a insertarla en CUALQUIER hueco de
    // CUALQUIER otro vehículo/día (no solo al principio/final de la
    // jornada) con computeCandidateSlots/insertAtSlot — las mismas
    // funciones que usa el movimiento manual del Gantt, así que funcionan
    // igual de bien con turnos circulares con relevo (mañana+tarde) que
    // sin ellos, sin necesitar lógica aparte para cada caso. Se usa el
    // hueco que menos km añade.
    function insertAtSlot(res, task, slot, dayOffset) {
      const dayS = a => a._start >= dayOffset && a._start < dayOffset + 1440;
      const movedTask = { ...task, _start: slot.arrival, _end: slot.taskEnd };
      const newBlocks = [];
      if (slot.inKm >= 0.05) {
        newBlocks.push({ _travel: true, _start: slot.prevEnd, _end: slot.prevEnd + slot.inMin, duracion: slot.inMin, km: +slot.inKm.toFixed(3), ...(slot.prevStop ? {} : { _depot_exit: true }) });
      }
      if (slot.wait > 0) {
        newBlocks.push({ _wait: true, _start: slot.arrival - slot.wait, _end: slot.arrival, duracion: slot.wait });
      }
      newBlocks.push(movedTask);
      if (slot.outKm >= 0.05) {
        newBlocks.push({ _travel: true, _start: slot.taskEnd, _end: slot.taskEnd + slot.outMin, duracion: slot.outMin, km: +slot.outKm.toFixed(3), ...(slot.nextStop ? {} : { _depot_return: true }) });
      }
      const items = [...(res.assignments || [])].sort((a, b) => a._start - b._start);
      res.assignments = items
        .filter(a => !(dayS(a) && a._start >= slot.prevEnd && a._start < slot.nextStart))
        .concat(newBlocks)
        .sort((a, b) => a._start - b._start);
      res.totalKm = res.assignments.reduce((s, a) => s + (a._travel ? (a.km || 0) : 0), 0);
    }

    function tryInsertOrphan(task) {
      let best = null, bestKm = Infinity, bestDayOffset = null;
      for (let i = 0; i < k; i++) {
        const res = state[i];
        const daysUsedSet = new Set(res.assignments.map(a => Math.floor(a._start / 1440)));
        daysUsedSet.add(0);
        for (const d of daysUsedSet) {
          const dOff = d * 1440;
          for (const slot of computeCandidateSlots(task, res, dOff, maxShiftMin)) {
            if (slot.kmDelta < bestKm) { bestKm = slot.kmDelta; best = { i, slot }; bestDayOffset = dOff; }
          }
        }
      }
      if (!best) return false;
      insertAtSlot(state[best.i], task, best.slot, bestDayOffset);
      return true;
    }

    // Tope de tiempo real para toda la reparación, no solo cesión de hilo
    // entre intentos. tryInsertOrphan es O(vehículos × días) por huérfano, y
    // con cientos de paradas pendientes (no un puñado) puede haber cientos
    // de huérfanos a la vez — el total puede tardar minutos en vez de
    // milisegundos aunque cada intento individual sea rápido. Pasado el
    // tope, el resto se deja sin asignar en vez de seguir intentando.
    //
    // Con flotas grandes (cientos o miles de vehículos, p.ej. tras
    // auto-escalar un proyecto de decenas de miles de paradas) cada intento
    // individual ya es caro por sí solo — 5s bastaba para comprobar un
    // puñado de huérfanos contra una flota pequeña, pero contra 1000+
    // vehículos se agotaba casi al instante y dejaba cientos de huérfanos
    // SIN NI SIQUIERA INTENTARLO, no porque no cupieran de verdad. Esto se
    // ejecuta en CADA ronda de crecimiento (no solo en la final), así que
    // subirlo mucho (se probó con 5min) multiplica el coste de cada ronda
    // intermedia, no solo el de la que de verdad importa. 60s es un
    // término medio: 12x más margen que el original, sin volver cada ronda
    // intermedia carísima.
    const ORPHAN_REPAIR_BUDGET_MS = 60000;
    const orphanRepairStart = Date.now();
    const stillUnassigned = [];
    let orphanAttempts = 0;
    let orphanBudgetExceeded = false;
    for (const task of pool) {
      if (orphanBudgetExceeded || Date.now() - orphanRepairStart > ORPHAN_REPAIR_BUDGET_MS) {
        orphanBudgetExceeded = true;
        stillUnassigned.push(task);
        continue;
      }
      if (!tryInsertOrphan(task)) stillUnassigned.push(task);
      // tryInsertOrphan recorre todos los vehículos/días — con muchas paradas
      // de franja horaria esto suma bastante trabajo síncrono. Cede el hilo
      // cada pocos intentos para que la pestaña no se quede "sin responder".
      if (++orphanAttempts % 5 === 0) await _yield();
    }

    await rebalanceLoad();
    const daysUsed = Math.max(1, mopDay);
    return { schedule: state, unassigned: stillUnassigned, daysUsed };
  }

  await rebalanceLoad();
  const daysUsed = Math.max(1, day);
  return { schedule: state, unassigned: [], daysUsed };
}

// ── AUTO-SCALE FLEET ─────────────────────────────────────────────
// When "días máximos de escenario" is set and the base fleet can't clear all
// tasks within that many days, grow the fleet with virtual "Vehículo
// necesario N" units (cloned from the first real vehicle's depot/tipo, on a
// full-day "Jornada completa" turno) and re-run the VRP, until everything
// fits or a safety cap on extra vehicles is hit. Con proyectos grandes
// (p.ej. 44 000+ paradas) topes anteriores (200, luego 2000) se alcanzaban
// antes de cubrir todas las paradas — miles quedaban sin asignar no por
// falta de capacidad real, sino porque el propio tope lo impedía. El
// límite real de "cuándo parar" lo pone STAGNANT_ROUNDS_LIMIT (se ha
// dejado de mejorar de verdad) y el presupuesto de tiempo, no este número
// — este tope es solo una red de seguridad ante un bucle realmente
// descontrolado, no debería llegar a ser el motivo de que algo se quede
// sin asignar.
const MAX_VIRTUAL_VEHICLES = 5000;

// onProgress(info) opcional — se llama tras cada ronda de crecimiento y
// cada intento del afinado posterior, para que la interfaz pueda mostrar
// progreso real (ronda, vehículos, sin asignar, tiempo) en vez de una
// barra ciega. Sin esto, un cálculo largo en un proyecto grande es
// indistinguible de uno colgado — no hay forma de saber si sigue vivo,
// en qué ronda va, o cuánto le puede quedar.
export async function autoScaleFleet(tasks, baseResources, constraints, onProgress) {
  let resources = baseResources;
  let result = await generateScenario(tasks, resources, constraints);
  let added = 0;
  let roundNum = 0;
  onProgress?.({ stage: "growth", round: roundNum, vehicles: resources.length, unassigned: result.unassigned.length });

  // Jornada máxima de los conductores añadidos automáticamente
  // (constraints.virtualShiftMin, 0 = sin límite = un solo conductor
  // "Jornada completa" cubriendo toda la ventana, igual que antes). Cuando
  // se fija, el VEHÍCULO sigue cubriendo la ventana entera (no se reduce su
  // capacidad), pero se reparte en tantos turnos consecutivos de esa
  // duración como quepan — normalmente 2 (mañana + tarde) — sobre ese MISMO
  // vehículo, igual que un vehículo real con varios conductores vinculados.
  // Sin esto, cada vehículo nuevo solo tenía un conductor anclado a la
  // mañana y la tarde quedaba sin usar, obligando a añadir más vehículos de
  // los necesarios.
  const virtualShiftMin = constraints.virtualShiftMin > 0 ? constraints.virtualShiftMin : null;
  const winSpan          = constraints.endMin - constraints.startMin;
  const shiftsPerVehicle = virtualShiftMin ? Math.max(1, Math.floor(winSpan / virtualShiftMin)) : 1;

  // Cuántas rondas seguidas sin BATIR el mínimo de sin-asignar visto hasta
  // ahora toleramos antes de rendirnos. Una tarea con franja horaria muy
  // ajustada (p.ej. 5-15 min) puede caer, según cómo el clustering geográfico
  // la reparta, en un vehículo cuya ruta no llega a tiempo — y eso depende
  // del azar del reparto, no de cuántos vehículos haya. Sin este freno, el
  // bucle seguía añadiendo un vehículo por ronda durante 20+ rondas con la
  // esperanza de que el reparto "acertara" alguna vez, multiplicando la
  // flota final por 3-4x para intentar colar 1-2 tareas casi imposibles.
  //
  // Con proyectos grandes (decenas de miles de paradas) cada ronda
  // re-agrupa TODO desde cero con un k distinto, así que el reparto que le
  // toca a las tareas más difíciles varía de ronda en ronda — unas pocas
  // rondas seguidas sin mejorar puede ser solo ruido de ese re-agrupado, no
  // la señal real de "esto no tiene arreglo" que sí es fiable con pocas
  // tareas. Se pide algo más de paciencia que el original, pero SIN
  // pasarse: subirlo mucho (se probó con 25) no arregla nada por sí solo
  // si la estimación de cada ronda es mala — solo multiplica por 25 el
  // coste de estar equivocado. El arreglo real es la productividad
  // marginal de arriba; esto es solo el margen de seguridad.
  const STAGNANT_ROUNDS_LIMIT = 6;
  let bestUnassigned = result.unassigned.length;
  let roundsSinceImprovement = 0;
  // La ronda que se rinde por estancamiento puede ser PEOR que la mejor ya
  // vista (p.ej. 3 rondas probando distintos repartos con mala suerte) — hay
  // que quedarse con el mejor intento real, no con el último.
  let bestResources = resources;
  let bestResult = result;

  // Tope de tiempo real, no solo de rondas — con muchas paradas de franja
  // horaria (cientos, no un puñado) cada ronda es una simulación completa y
  // el nº de rondas necesarias para converger crece mucho; sin esto,
  // "Generar escenario" podía quedarse calculando varios minutos sin que el
  // usuario tuviera forma de saber si seguía vivo o se había colgado. Igual
  // que el shrink pass de más abajo: si se agota el tiempo, se queda con el
  // mejor resultado encontrado hasta ese momento en vez de seguir.
  //
  // Con proyectos de decenas de miles de paradas un solo intento de
  // clustering ya puede tardar 1-3 minutos (medido: ~60s a 100 vehículos,
  // ~150s a 400), así que 90s no llegaba ni para completar UNA ronda con
  // holgura, cortando el crecimiento mucho antes de converger. Prioridad
  // del usuario: asignar todo, el tiempo no es problema.
  const GROWTH_TIME_BUDGET_MS = 20 * 60 * 1000;
  const growthStart = Date.now();

  // Estimar cuántos vehículos añadir por ronda con la productividad MEDIA
  // desde el principio (incluye las rondas fáciles del inicio, con las
  // paradas más accesibles) se queda corta según el crecimiento avanza
  // hacia las paradas más difíciles — y como cada ronda vuelve a reagrupar
  // TODO desde cero, una mala estimación no cuesta una ronda de más, cuesta
  // una ronda de más A UN k CADA VEZ MAYOR. Verificado con MADRID (44 000
  // paradas): con la estimación por media histórica, el crecimiento seguía
  // sin converger pasadas 4 HORAS. Se usa en su lugar la productividad
  // MARGINAL de la última ronda (cuántas tareas rescató el último lote
  // añadido, no la flota entera desde el principio), que refleja la
  // dificultad ACTUAL, no la media de toda la historia.
  let marginalPerVehicle = null;
  // Tope al tamaño de un único salto — aunque la estimación (de cualquier
  // tipo) se equivoque por mucho, ninguna ronda debe poder dispararse a un
  // k enorme de golpe: eso es exactamente lo que dejó una sola ronda
  // calculando durante horas. Con esto, el coste de CADA ronda queda
  // acotado (medido: k≈400 tarda ~2.5min), y si hacen falta más vehículos
  // de los que caben en un salto, se consigue en varias rondas moderadas
  // en vez de una gigante.
  const ROUND_BATCH_CAP = 400;

  while (
    result.unassigned.length > 0 && added < MAX_VIRTUAL_VEHICLES &&
    Date.now() - growthStart < GROWTH_TIME_BUDGET_MS
  ) {
    await _yield(); // deja respirar al navegador entre rondas, aunque generateScenario tarde
    const assigned    = tasks.length - result.unassigned.length;
    const perVehicle   = marginalPerVehicle ?? Math.max(1, assigned / resources.length);
    const needed       = Math.max(1, Math.ceil(result.unassigned.length / perVehicle));
    const batch        = Math.min(needed, MAX_VIRTUAL_VEHICLES - added, ROUND_BATCH_CAP);
    const template      = baseResources[0] || {};

    const extra = Array.from({ length: batch }, (_, i) => {
      const n = added + i + 1;
      const veh = {
        _id: `virtual_veh_${n}`, id: `virtual_veh_${n}`,
        nombre: `Vehículo necesario ${n}`, matricula: "",
        tipo: template.tipo || "Camión lateral",
        turno: "Jornada completa",
        depotLat: template.depotLat ?? null, depotLng: template.depotLng ?? null,
        _virtual: true,
        _effectiveStart: constraints.startMin,
        _effectiveEnd: virtualShiftMin
          ? Math.min(constraints.endMin, constraints.startMin + shiftsPerVehicle * virtualShiftMin)
          : constraints.endMin,
      };
      if (virtualShiftMin && shiftsPerVehicle > 1) {
        veh._shiftBreaks = Array.from({ length: shiftsPerVehicle - 1 },
          (_, s) => constraints.startMin + (s + 1) * virtualShiftMin);
      }
      return veh;
    });

    resources = [...resources, ...extra];
    added += batch;
    roundNum++;
    const roundStart = Date.now();
    result = await generateScenario(tasks, resources, constraints);
    onProgress?.({
      stage: "growth", round: roundNum, batch, vehicles: resources.length,
      unassigned: result.unassigned.length, roundMs: Date.now() - roundStart,
      totalMs: Date.now() - growthStart,
    });

    // Productividad marginal de ESTE lote (no de la flota entera) para
    // afinar la estimación de la próxima ronda — cuántas tareas rescató
    // específicamente el lote que se acaba de añadir.
    const assignedAfter = tasks.length - result.unassigned.length;
    const marginalGain = Math.max(1, assignedAfter - assigned);
    marginalPerVehicle = Math.max(1, marginalGain / batch);

    // Se comprueba el resultado DE ESTA ronda (no el de antes de crecer) —
    // si se comprobara antes de intentar, la mejora de la última ronda antes
    // de salir del bucle nunca quedaría registrada en bestUnassigned.
    if (result.unassigned.length < bestUnassigned) {
      bestUnassigned = result.unassigned.length;
      bestResources = resources;
      bestResult = result;
      roundsSinceImprovement = 0;
    } else if (++roundsSinceImprovement >= STAGNANT_ROUNDS_LIMIT) {
      break; // probablemente franjas horarias imposibles de encajar, no falta de capacidad
    }
  }
  resources = bestResources;
  result = bestResult;

  // ── Shrink pass (búsqueda binaria) ──────────────────────────────
  // El bucle de arriba añade vehículos por lotes estimando la productividad
  // media hasta el momento, y con turnos emparejados (mañana+tarde) cada
  // vehículo tiene mucha más capacidad de la que el clustering geográfico
  // (un cluster por vehículo, de tamaño parecido) suele llenar del todo —
  // el resultado eran decenas de vehículos con la tarde casi vacía (1-2
  // paradas sueltas) en vez de menos vehículos usando esa tarde de verdad.
  //
  // Busca el menor tamaño de flota (entre la base y el resultado ya
  // encajado) que sigue asignando el 100% de las paradas. La versión previa
  // (ajuste fino quitando uno a uno) se quedaba a medias en flotas grandes;
  // la de después (búsqueda binaria pura desde el rango completo) siempre
  // llegaba al mínimo pero tardaba mucho — cada intento es una simulación
  // completa de 1400 paradas, y buscar en todo el rango [base, crecido]
  // cuando crecido es grande (90+) sigue siendo caro aunque sean pocos pasos.
  //
  // Combina las dos ideas: un salto inicial a la estimación por capacidad
  // (recorta el rango de búsqueda de entrada, así que hacen falta muchos
  // menos intentos en el caso normal) + un tope de tiempo real (no de
  // número de intentos) para que "Generar escenario" nunca se dispare por
  // mucho que crezca la flota — si se agota el tiempo, se queda con el
  // mejor tamaño encontrado hasta ese momento.
  //
  // El criterio de "vale" es sin-asignar <= bestUnassigned (lo mejor que
  // logró el crecimiento de arriba), no sin-asignar === 0: si ese bucle se
  // rindió con 1-2 tareas de franja horaria imposible, exigir aquí un 0
  // perfecto haría fallar TODOS los tamaños por la misma razón (esas tareas
  // no dependen del tamaño de flota, sino del azar del reparto geográfico) y
  // la búsqueda binaria acabaría quedándose con el tamaño más grande posible
  // en vez del más pequeño que ya logra el mismo resultado.
  if (added > 0) {
    const shrinkStart = Date.now();
    // Cada intento es una simulación completa (clustering + rutas de todas
    // las paradas) — con miles de paradas puede tardar varios segundos cada
    // una, y hacen falta ~7-9 intentos para converger en una flota grande.
    // Un tope bajo (15s) cortaba la búsqueda a medias antes de llegar al
    // mínimo real, dejando muchos más vehículos de los necesarios. Mejor
    // esperar más y llegar al número correcto que ser rápido con uno malo.
    // En proyectos de decenas de miles de paradas un solo intento ya puede
    // tardar minutos (ver GROWTH_TIME_BUDGET_MS) — el afinado (que solo
    // busca un tamaño MENOR sin perder cobertura real, gracias a
    // ELBOW_ABS_TOLERANCE) no debería cortarse antes de tiempo tampoco.
    const SHRINK_TIME_BUDGET_MS = 20 * 60 * 1000;
    const cache = new Map(); // tamaño de flota -> { result, resources } ya simulados
    cache.set(resources.length, { result, resources });

    async function tryFleetSize(size) {
      if (cache.has(size)) return cache.get(size);
      const trial = resources.slice(0, size);
      const trialStart = Date.now();
      const trialResult = await generateScenario(tasks, trial, constraints);
      onProgress?.({
        stage: "shrink", vehicles: size, unassigned: trialResult.unassigned.length,
        roundMs: Date.now() - trialStart, totalMs: Date.now() - shrinkStart,
      });
      const entry = { result: trialResult, resources: trial };
      cache.set(size, entry);
      return entry;
    }

    const totalWorkMin = result.schedule.reduce((s, r) =>
      s + r.assignments.reduce((ss, a) => ss + (a._break ? 0 : (a.duracion || 0)), 0), 0);
    const perVehicleCapacity = Math.max(1, virtualShiftMin ? shiftsPerVehicle * virtualShiftMin : winSpan);
    const estimate = Math.min(resources.length, Math.max(baseResources.length,
      Math.ceil((totalWorkMin / perVehicleCapacity) * 1.15)));

    let lo = baseResources.length;
    let hi = resources.length; // conocido: encaja todo (es el resultado ya crecido)
    if (estimate < hi) {
      const { result: estResult } = await tryFleetSize(estimate);
      if (estResult.unassigned.length <= bestUnassigned) hi = estimate; // la estimación ya vale — recorta el máximo
      else lo = estimate + 1;                                            // no llega — recorta el mínimo
    }

    while (lo < hi && Date.now() - shrinkStart < SHRINK_TIME_BUDGET_MS) {
      const mid = Math.floor((lo + hi) / 2);
      const { result: midResult } = await tryFleetSize(mid);
      if (midResult.unassigned.length <= bestUnassigned) hi = mid; // mid ya vale — busca algo aún menor
      else lo = mid + 1;                                            // mid no llega — hace falta más
    }

    // ── Afinado post-binaria: exigir sin-asignar <= bestUnassigned EXACTO es
    // un listón artificial. Con datos reales, el nº de sin-asignar frente al
    // tamaño de flota no es monótono — tiene MESETAS (25, 26 y 27 vehículos
    // pueden dejar exactamente los mismos huecos sin cubrir, casi siempre
    // franjas horarias geográficamente imposibles de por sí, no falta de
    // capacidad) seguidas de un salto real cuando de verdad falta capacidad.
    // La binaria de arriba, al exigir igualdad exacta con el mejor histórico,
    // aterriza en el extremo ALTO de la meseta (p. ej. 29 vehículos) en vez
    // del extremo bajo (25) — mismos huecos sin cubrir, pero con la jornada
    // de cada conductor diluida entre vehículos que apenas rescatan nada.
    //
    // Se afina con un barrido lineal hacia abajo desde `hi` (ya no vale la
    // binaria: la función no es monótona en esta zona) mientras el tamaño
    // siga siendo "casi igual de bueno". Sacrificar cobertura ya conseguida
    // a cambio de menos vehículos es un cambio de política que afecta a un
    // número que el usuario vigila directamente ("sin asignar") — pero la
    // tolerancia CERO (probada) tiene su propio problema: en Palma de
    // Mallorca hacía preferir 44 vehículos al 58% de uso medio (4h42) antes
    // que 27 vehículos al 92%+ (7h27), solo por dejar unas pocas tareas
    // menos sin asignar — carreras armamentísticas por 1-2 tareas a costa
    // de duplicar la flota necesaria. Vuelve una tolerancia ABSOLUTA
    // pequeña y con techo fijo (nunca más de 20 tareas, sea cual sea el
    // tamaño del proyecto): suficiente para saltar mesetas de clustering
    // (Palma: 25, 26 y 27 vehículos dejaban exactamente los mismos 23
    // huecos sin cubrir) sin que la flota se dispare persiguiendo una
    // mejora mínima en sin-asignar. Insignificante en proyectos grandes
    // (20 de 13 000+ tareas).
    const ELBOW_ABS_TOLERANCE = Math.min(20, Math.max(5, Math.ceil(tasks.length * 0.01)));
    const SHRINK_PATIENCE = 2;
    let floorUnassigned = cache.get(hi).result.unassigned.length;
    let refined = hi;
    let missesInARow = 0;
    // La binaria de arriba termina siempre con lo === hi (así converge
    // cualquier búsqueda binaria) — usar ese `lo` como suelo aquí haría que
    // este bucle nunca se ejecutara. El suelo real del afinado es el tamaño
    // de la flota base, no el punto de convergencia de la binaria.
    for (let s = hi - 1; s >= baseResources.length && Date.now() - shrinkStart < SHRINK_TIME_BUDGET_MS; s--) {
      const { result: sResult } = await tryFleetSize(s);
      const n = sResult.unassigned.length;
      if (n <= floorUnassigned + ELBOW_ABS_TOLERANCE) {
        refined = s;
        floorUnassigned = Math.min(floorUnassigned, n);
        missesInARow = 0;
      } else if (++missesInARow >= SHRINK_PATIENCE) {
        break;
      }
    }
    hi = refined;

    const best = cache.get(hi);
    resources = best.resources;
    result = best.result;
    added = resources.length - baseResources.length;
  }

  return { result, resources, addedCount: added };
}
