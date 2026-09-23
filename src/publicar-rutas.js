// ── Publicar a Rutas por trabajador (desde Rostering) ────────────────
// Cada trabajador vinculado a un usuario de la app (scheduling_workers.uid)
// recibe en Rutas:
//   - sus planes, uno por día trabajado, con conductorUid = su usuario
//     (Rutas le enseña solo los suyos + los que no tienen conductor);
//   - su cuadrante del mes, en `cuadrantes/{org}_{YYYY-MM}_{uid}` — una
//     colección aparte porque los conductores no pueden leer `rostering`.
//
// Las paradas salen del escenario de Scheduling guardado en IndexedDB en
// este navegador (vrp_cache → vrp_{projectId}): en modo libre, las del
// vehículo y horario que le asignó Optimizar; en modo cuadrante, las suyas
// propias del escenario.

import { db } from "./firebase.js";
import {
  collection, doc, setDoc, addDoc, deleteDoc, getDocs, query, where,
} from "firebase/firestore";
import { hasCoords } from "./vrp-engine.js";

// Mismo IndexedDB que usa scheduling.jsx para el escenario completo
export function loadScenario(projectId) {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open("vrp_cache", 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore("schedules");
      r.onerror = () => resolve(null);
      r.onsuccess = e => {
        try {
          const req = e.target.result.transaction("schedules", "readonly").objectStore("schedules").get(`vrp_${projectId}`);
          req.onsuccess = ev => resolve(ev.target.result ?? null);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}

// Parada del escenario → ubicación de un plan de Rutas
export function taskToUbicacion(task, idx) {
  const campos = task.campos || {};
  const field = (...keys) => {
    for (const k of keys) {
      const e = Object.entries(campos).find(([fk]) => fk.toLowerCase().trim() === k);
      if (e?.[1] != null && String(e[1]).trim()) return String(e[1]).trim();
    }
    return "";
  };
  return {
    id: "u" + idx,
    pa: task.nombre || field("pa","idsap","id_sap","codigopoint","codigo","codi") || ("PA-" + (idx + 1)),
    orden: idx + 1,
    calle: field("calle","carrer","street","via"),
    num: field("num","num.","número","numero"),
    comentari: field("comentari","comentario","comment"),
    barri: task.barrio || field("barri","barrio","neighbourhood","neighborhood","sector","zona"),
    districte: field("districte","distrito","district"),
    turno: field("turno","turn","shift"),
    dia: field("día","dia","day"),
    lat: +task.lat || 0,
    lng: +task.lng || 0,
    elementos: [],
    realizado: false,
    realizadoPor: null,
    realizadoEn: null,
    nota: "",
  };
}

const isStop = a => !a._travel && !a._break && !a._wait;

// Paradas por día (1-based) de un trabajador en el escenario.
//   asignWorker: { [día]: { v, vn, s, e } } de Optimizar (modo libre)
//   workerRow:   su fila de conductor en el escenario (modo cuadrante)
export function workerStopsByDay({ scenario, startMin, asignWorker, workerRow }) {
  const out = {}; // día → { stops, vehiculo }
  const vehicles = scenario?.vehicles || [];
  for (const [dStr, a] of Object.entries(asignWorker || {})) {
    const d = Number(dStr);
    const v = vehicles.find(x => (x._id || x.id) === a.v);
    if (!v) continue;
    const off = (d - 1) * 1440;
    const stops = (v.assignments || []).filter(x => {
      if (!isStop(x)) return false;
      if (Math.floor((x._start - startMin) / 1440) + 1 !== d) return false;
      const t = x._start - off;
      return t >= a.s && t < a.e;
    });
    if (stops.length) out[d] = { stops, vehiculo: a.vn || v.nombre || v.matricula || "" };
  }
  if (workerRow) {
    const vRow = vehicles.find(x => (x._id || x.id) === workerRow.vehiculoId);
    for (const x of (workerRow.assignments || []).filter(isStop)) {
      const d = Math.floor((x._start - startMin) / 1440) + 1;
      if (out[d] && !out[d].fromRow) continue; // ya lo cubre una asignación de Optimizar
      (out[d] || (out[d] = { stops: [], vehiculo: vRow?.nombre || vRow?.matricula || "", fromRow: true })).stops.push(x);
    }
  }
  for (const v of Object.values(out)) v.stops.sort((a, b) => a._start - b._start);
  return out;
}

/**
 * Publica a Rutas los planes y el cuadrante de un trabajador para un mes.
 * Sustituye lo que se le publicó antes de ese mismo proyecto y mes, salvo
 * los planes en los que ya ha marcado alguna parada (no se pierde trabajo
 * hecho: esos días se dejan como estaban y se informan en `kept`).
 */
export async function publishWorker({
  orgId, projectId, worker, year, month, tipo, scenario, startMin,
  gridWorker, asignWorker, dailyDetailWorker, schedDayOffset = 0,
}) {
  const mes = `${year}-${String(month).padStart(2, "0")}`;
  const nombre = [worker.nombre, worker.apellidos].filter(Boolean).join(" ") || "Trabajador";
  const uid = worker.uid;

  // 1) Cuadrante del mes
  const dias = {};
  for (const [dStr, code] of Object.entries(gridWorker || {})) {
    if (!code) continue;
    const a = asignWorker?.[dStr];
    const det = dailyDetailWorker?.[String(Number(dStr) + schedDayOffset)];
    const off = (Number(dStr) + schedDayOffset - 1) * 1440;
    dias[dStr] = {
      c: code,
      ...(a ? { v: a.vn || "", s: a.s, e: a.e } : det ? { v: det.vehiculo || "", s: det.start - off, e: det.end - off } : {}),
    };
  }
  await setDoc(doc(db, "cuadrantes", `${orgId}_${mes}_${uid}`), {
    org_id: orgId, uid, workerId: worker._id, nombre, year, month, mes, dias,
    projectId: projectId || null, publicadoEn: Date.now(),
  });

  // 2) Planes por día
  let created = 0;
  const kept = [];
  if (scenario) {
    const byDay = workerStopsByDay({
      scenario, startMin,
      asignWorker,
      workerRow: (scenario.workers || []).find(w => (w._id || w.id) === worker._id),
    });

    const prev = await getDocs(query(collection(db, "planes"),
      where("org_id", "==", orgId), where("conductorUid", "==", uid), where("mes", "==", mes)));
    const keptDays = new Set();
    for (const p of prev.docs) {
      const data = p.data();
      if (!data.origenRostering || data.projectId !== projectId) continue;
      if ((data.ubicaciones || []).some(u => u.realizado)) { keptDays.add(data.diaNum); kept.push(data.diaNum); continue; }
      await deleteDoc(p.ref);
    }

    for (const [dStr, { stops, vehiculo }] of Object.entries(byDay)) {
      const d = Number(dStr);
      if (keptDays.has(d)) continue;
      const code = gridWorker?.[dStr];
      if (code === "L" || code === "B") continue; // de libre/baja ese día: no se le publica
      const dayLabel = `Día ${String(d).padStart(2, "0")}`;
      await addDoc(collection(db, "planes"), {
        tipo, nombre: `${nombre} · ${dayLabel} · ${mes}`, archivo: "vrp-generado",
        turno: code || "", conductorNombre: nombre, conductorUid: uid, workerId: worker._id,
        vehiculoNombre: vehiculo, mes, diaServicio: dayLabel, diaNum: d,
        ubicaciones: stops.map((a, i) => taskToUbicacion(a, i)),
        recorrido: stops.filter(a => hasCoords(a.lat, a.lng)).map(a => ({ lat: +a.lat, lng: +a.lng })),
        fechaSubida: Date.now(), origenVRP: true, origenRostering: true,
        projectId: projectId || null, org_id: orgId,
      });
      created++;
    }
  }
  return { created, kept };
}
