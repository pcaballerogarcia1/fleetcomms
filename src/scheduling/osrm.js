// Kilómetros por carretera (OSRM) para los recorridos del escenario.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { hasCoords } from "../vrp-engine.js";

// ── OSRM ROAD ENRICHMENT ──────────────────────────────────────────
// After VRP generation (which uses fast Haversine), replace travel block km
// with real road distances from OSRM. Time layout stays unchanged.
export async function enrichWithOSRM(schedule) {
  // Skip OSRM entirely when routes are too large — the URL would exceed 100KB,
  // causing fetch to hang regardless of the timeout signal in some environments.
  const OSRM_MAX_STOPS = 80;
  const maxStopsAny = Math.max(0, ...schedule.map(row =>
    row.assignments.filter(a => !a._travel && !a._break && !a._wait).length
  ));
  if (maxStopsAny > OSRM_MAX_STOPS) return schedule;

  return Promise.all(schedule.map(async (row) => {
    const depot = (row.depotLat && row.depotLng)
      ? { lat: +row.depotLat, lng: +row.depotLng } : null;

    // Build ordered waypoints: [depot?] + stops + [depot?]
    const waypoints = []; // {lng, lat, assignmentIdx | null}
    if (depot) waypoints.push({ lng: depot.lng, lat: depot.lat, idx: null, isDepot: true });
    row.assignments.forEach((a, i) => {
      if (!a._travel && !a._break && !a._wait && hasCoords(a.lat, a.lng))
        waypoints.push({ lng: +a.lng, lat: +a.lat, idx: i, isDepot: false });
    });
    if (depot) waypoints.push({ lng: depot.lng, lat: depot.lat, idx: null, isDepot: true, isReturn: true });

    if (waypoints.filter(w => !w.isDepot).length < 1) return row;
    if (waypoints.length < 2) return row;

    // Manual timeout via AbortController — more reliable than AbortSignal.timeout
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    try {
      const resp = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
        { signal: ctrl.signal }
      );
      clearTimeout(tid);
      const data = await resp.json();
      if (data.code !== 'Ok' || !data.routes?.[0]?.legs) return row;

      const legs = data.routes[0].legs;
      const newAssignments = [...row.assignments];

      // Each leg[i] = waypoints[i] → waypoints[i+1]
      // Find travel blocks between consecutive waypoints and update their km
      for (let i = 0; i < waypoints.length - 1 && i < legs.length; i++) {
        const roadKm = legs[i].distance / 1000;
        const fromIdx = waypoints[i].idx;     // null = depot
        const toIdx   = waypoints[i + 1].idx; // null = depot

        // Find the travel block between fromIdx and toIdx in assignments array
        const searchFrom = fromIdx !== null ? fromIdx + 1 : 0;
        const searchTo   = toIdx   !== null ? toIdx       : newAssignments.length;
        for (let j = searchFrom; j < searchTo; j++) {
          if (newAssignments[j]?._travel) {
            newAssignments[j] = { ...newAssignments[j], km: +roadKm.toFixed(3) };
            break;
          }
        }
      }

      const totalKm = newAssignments
        .filter(a => a._travel)
        .reduce((s, a) => s + (a.km || 0), 0);

      return { ...row, assignments: newAssignments, totalKm: +totalKm.toFixed(2) };
    } catch {
      clearTimeout(tid);
      return row;
    }
  }));
}
