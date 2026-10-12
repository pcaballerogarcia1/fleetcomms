// Rostering: las acciones largas de la pantalla (publicar a Rutas y optimizar el
// cuadrante). Reciben de la pantalla (ctx) el estado y las funciones que usan.


import { optimizeRoster } from "../roster-optimizer.js";
import { turnoWindow, shiftCodeFromStart } from "../vrp-engine.js";
import { publishWorker, escenarioParaPublicar, planesPublicados, planEmpezado } from "../publicar-rutas.js";
import { logAudit } from "../audit.js";
import { saveShiftMoves } from "../roster-store.js";
import { deleteDoc } from "firebase/firestore";
import { MONTH_NAMES, isVehicleUnavailable } from "./datos.js";



export async function doPublish(ctx, targets, tipo) {
  const { activeProject, asign, grid, month, orgId, schedRoster, setPublishModal, setPublishing, viewMes, year } = ctx;
  setPublishModal(null);
  const projectId = activeProject?._id || null;
  const sameMonth = schedRoster?.mes === viewMes;
  let scenario = null, porQueNo = !projectId ? "no hay proyecto abierto" : !sameMonth ? "el escenario de Scheduling es de otro mes" : null;
  if (!porQueNo) {
    const { data } = await escenarioParaPublicar(projectId);
    if (!data) porQueNo = "no se encuentra el escenario de Scheduling (ni en la nube ni en este navegador)";
    // el cuadrante es de una generación del escenario: si se ha vuelto a
    // generar después, sus turnos ya no casan con las paradas
    else if (schedRoster?.generatedAt && data.stamp && data.stamp !== schedRoster.generatedAt) porQueNo = "el escenario guardado es de otra generación que este cuadrante — vuelve a generar en Scheduling";
    else scenario = data;
  }
  // Rutas ya publicadas desde Scheduling para este mes: se duplicarían
  if (scenario) {
    try {
      const deScheduling = (await planesPublicados(orgId, projectId, viewMes)).filter(d => !d.data().origenRostering && !planEmpezado(d.data()));
      if (deScheduling.length) {
        if (!window.confirm(`Hay ${deScheduling.length} ruta(s) de ${viewMes} publicadas desde Scheduling (por vehículo). Si publicas también por trabajador, los conductores las verían repetidas.\n\n¿Quitar las de Scheduling (las no empezadas) y publicar por trabajador?`)) { setPublishModal(null); return; }
        for (const d of deScheduling) await deleteDoc(d.ref);
      }
    } catch (e) { alert("No se pudieron revisar las rutas ya publicadas: " + (e.message || e)); return; }
  }
  const startMin = activeProject?.scheduling?.constraints?.startMin ?? 360;
  const lines = [];
  let i = 0;
  for (const w of targets) {
    setPublishing(`Publicando ${++i}/${targets.length}…`);
    try {
      const r = await publishWorker({
        orgId, projectId, worker: w, year, month, tipo, scenario, startMin,
        gridWorker: grid[w._id] || {}, asignWorker: asign[w._id] || {},
        dailyDetailWorker: schedRoster?.dailyDetail?.[w._id],
      });
      const name = [w.nombre, w.apellidos].filter(Boolean).join(" ");
      lines.push(`• ${name}: ${r.created} ruta(s)${r.kept.length ? ` · días ${r.kept.join(", ")} ya empezados, no se tocan` : ""}`);
    } catch (e) {
      lines.push(`• ${w.nombre}: error — ${e.message || e}`);
    }
  }
  setPublishing(null);
  logAudit({ modulo: "Rostering", accion: "Publicó el cuadrante en Rutas", detalle: `${targets.length} trabajador(es) · ${viewMes}` });
  alert(
    `Publicado en Rutas (${viewMes}):\n\n${lines.join("\n")}` +
    (scenario ? "" : `\n\nSolo se ha publicado el cuadrante: ${porQueNo}.`)
  );
}

// ── Optimizar: auto-assign scheduled shifts respecting availability ──
export function optimizar(ctx) {
  const { activeProject, days, gridRef, month, optimizarLibre, pendingRef, persistMonth, schedDayFor, schedRoster, updateGrid, workers, year } = ctx;
  // Antes esto no avisaba de nada si no había escenario generado para
  // este proyecto/mes — el botón "no hacía nada" en silencio y parecía
  // roto. Ahora explica por qué, en vez de quedarse callado.
  if (!activeProject) {
    alert("Abre un proyecto con un escenario generado en Scheduling primero.");
    return;
  }
  if (!schedRoster) {
    alert("Este proyecto todavía no tiene un escenario generado en Scheduling — no hay turnos que asignar.");
    return;
  }
  if (schedRoster.mes && schedRoster.mes !== `${year}-${String(month).padStart(2, "0")}`) {
    alert(`El escenario generado es de ${schedRoster.mes}, pero estás viendo ${year}-${String(month).padStart(2, "0")} — cambia el mes del calendario para verlo.`);
    return;
  }

  if (schedRoster.modo === "libre") { optimizarLibre(); return; }

  const BLOCKED = new Set(["L", "B"]);     // can't override
  const MANUAL  = new Set(["M","T","N","G"]); // already manually set, skip

  const newGrid = { ...gridRef.current };
  let assignedCount = 0, skippedNoCode = 0;
  for (const w of workers) {
    const wId  = w._id;
    const code = schedRoster.turnoByWorker?.[wId];
    const scheduledDays = new Set(schedRoster.daysWorked?.[wId] ?? []);
    if (!code) { if (scheduledDays.size) skippedNoCode++; continue; }
    const wGrid = { ...(newGrid[wId] ?? {}) };
    for (const d of days) {
      const dayNum = schedDayFor(d);
      if (!dayNum || !scheduledDays.has(dayNum)) continue;
      const cur = wGrid[String(d)] ?? "";
      if (BLOCKED.has(cur) || MANUAL.has(cur)) continue;
      wGrid[String(d)] = code;
      assignedCount++;
    }
    newGrid[wId] = wGrid;
  }
  updateGrid(newGrid);
  pendingRef.current = newGrid;
  persistMonth(newGrid);

  if (assignedCount > 0) logAudit({ modulo: "Rostering", accion: "Optimizó el cuadrante", detalle: `${assignedCount} turno(s) asignados · ${MONTH_NAMES[month - 1]} ${year}` });
  if (assignedCount === 0) {
    alert(skippedNoCode > 0
      ? "No se ha asignado ningún turno nuevo — las celdas ya estaban marcadas manualmente (M/T/N/G), libres o de baja."
      : "No se ha asignado ningún turno — regenera el escenario en Scheduling para este proyecto/mes.");
  } else {
    alert(`Se han asignado ${assignedCount} turno(s).${skippedNoCode > 0 ? ` ${skippedNoCode} trabajador(es) con paradas asignadas no tenían un turno reconocible.` : ""}`);
  }
}

// ── Optimizar (escenario en modo libre) ───────────────────────
// Asigna trabajador + vehículo a cada turno a cubrir del escenario según
// las reglas. Lo escrito a mano (L/B, M/T/N, G, D) se respeta; lo que puso
// una optimización anterior se recalcula entero.
export function optimizarLibre(ctx) {
  const { activeProject, asignRef, daysInMonth, gridRef, horasPorTrabajador, month, pendingRef, persistMonth, rules, schedRoster, setAsign, setOptResult, updateGrid, vehicleGrid, workers, year } = ctx;
  // Turnos troceados en partes: si aún no han llegado todas, optimizar
  // ahora dejaría fuera turnos sin avisar.
  if (schedRoster._partsComplete === false) {
    alert("Todavía se están cargando los turnos del escenario — espera unos segundos y vuelve a pulsar Optimizar.");
    return;
  }
  const shiftsRaw = schedRoster.shifts || [];
  if (!shiftsRaw.length) {
    alert("El escenario no tiene turnos guardados — regenéralo en Scheduling (modo libre).");
    return;
  }
  if (Object.keys(asignRef.current).some(w => Object.keys(asignRef.current[w] || {}).length) &&
      !confirm("Se recalcularán los turnos que asignó la optimización anterior (lo escrito a mano se mantiene). ¿Continuar?")) return;

  // Celdas puestas por el optimizador → fuera; el resto son restricciones.
  const baseGrid = {};
  const fixed = {};
  for (const w of workers) {
    const wGrid = { ...(gridRef.current[w._id] ?? {}) };
    // Se restaura lo que había a mano antes (p. ej. G o D) en vez de
    // dejar la celda vacía.
    for (const [d, a] of Object.entries(asignRef.current[w._id] || {})) {
      if (a?.p) wGrid[d] = a.p; else delete wGrid[d];
    }
    baseGrid[w._id] = wGrid;
    fixed[w._id] = wGrid;
  }

  const shifts = shiftsRaw.map(sh => ({
    id: sh.id, day: sh.d, start: sh.s, end: sh.e,
    vehicleId: sh.v, vehicleName: sh.vn, stops: sh.st,
  }));
  const optWorkers = workers.map(w => ({
    id: w._id,
    name: [w.nombre, w.apellidos].filter(Boolean).join(" "),
    maxHoras: +horasPorTrabajador[w._id] || 0,
    prefStart: w.turno ? turnoWindow(w.turno, null, null).start : null,
  }));

  // Días en taller/avería/ITV de cada vehículo: no se mueve ningún turno a ellos
  const vehicleOff = {};
  for (const [vid, byDay] of Object.entries(vehicleGrid || {})) {
    vehicleOff[vid] = Object.entries(byDay || {}).filter(([, c]) => isVehicleUnavailable(c)).map(([d]) => Number(d));
  }

  // Líneas regulares: cada turno es del día de su calendario (el servicio del
  // lunes no se puede hacer el martes), así que no se mueve ninguno de día
  const reglas = schedRoster.lineas ? { ...rules, moverTurnos: false } : rules;
  const res = optimizeRoster({ shifts, workers: optWorkers, fixed, rules: reglas, year, month, daysInMonth, vehicleOff });

  const newGrid = { ...baseGrid };
  const newAsign = {};
  const byId = new Map(shifts.map(sh => [sh.id, sh]));
  const movedTo = new Map(res.moves.map(m => [m.id, m.toDay]));
  for (const [shiftId, wId] of Object.entries(res.assignments)) {
    const sh = byId.get(shiftId);
    const key = String(movedTo.get(shiftId) ?? sh.day);
    newGrid[wId] = { ...(newGrid[wId] ?? {}), [key]: shiftCodeFromStart(sh.start) };
    const prevCode = baseGrid[wId]?.[key];
    newAsign[wId] = { ...(newAsign[wId] ?? {}), [key]: {
      id: sh.id, v: sh.vehicleId, vn: sh.vehicleName, s: sh.start, e: sh.end,
      ...(prevCode ? { p: prevCode } : {}),
    } };
  }
  updateGrid(newGrid);
  pendingRef.current = newGrid;
  asignRef.current = newAsign;
  setAsign(newAsign);
  persistMonth(newGrid, newAsign);

  // Turnos movidos de día: se reflejan en el escenario (scheduling_roster)
  // para que Scheduling traslade esas rutas — manda el cuadrante. Los
  // movimientos se acumulan en orden; Scheduling aplica cada uno una sola vez.
  if (res.moves.length && activeProject?._id) {
    const newMoves = res.moves.map(m => {
      const sh = byId.get(m.id);
      return { id: m.id, v: sh.vehicleId, s: sh.start, e: sh.end, fromDay: m.fromDay, toDay: m.toDay };
    });
    saveShiftMoves(activeProject._id, schedRoster, movedTo, newMoves)
      .catch(e => alert("No se pudieron guardar los turnos movidos en el escenario: " + (e.message || e)));
  }

  logAudit({ modulo: "Rostering", accion: "Optimizó el cuadrante (modo libre)",
    detalle: `${Object.keys(res.assignments).length} de ${shifts.length - res.outOfMonth} turnos cubiertos · ${res.moves.length} movido(s) de día · ${MONTH_NAMES[month - 1]} ${year}` });
  setOptResult({
    moves: res.moves.map(m => ({ ...m, shift: byId.get(m.id) })),
    total: shifts.length - res.outOfMonth,
    covered: Object.keys(res.assignments).length,
    uncovered: res.uncovered,
    outOfMonth: res.outOfMonth,
    stats: res.stats,
  });
}
