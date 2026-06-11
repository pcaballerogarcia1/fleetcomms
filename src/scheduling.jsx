import { useState, useRef, useEffect } from "react";
import { db } from "./firebase.js";
import { PlanningPage } from "./planning.jsx";
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg:"#0f1117", card:"#161b27", surface2:"#1c2333",
  border:"rgba(255,255,255,0.08)", border2:"rgba(255,255,255,0.13)",
  blue:"#4f8ef7", blueDim:"#0d2248", blueText:"#a3c4fc",
  green:"#34d399", greenDim:"#072015",
  orange:"#fb923c", red:"#f87171", amber:"#fbbf24",
  text:"#f0f4f8", muted:"#8b95a5", dim:"#3d4d63",
};
const font = "'Inter',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";

if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
    @keyframes sched-fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sched-spin{to{transform:rotate(360deg)}}
    .sched-block{transition:filter .1s,box-shadow .1s;}
    .sched-block:hover{filter:brightness(1.15);box-shadow:0 2px 8px rgba(0,0,0,.4);}
  `;
  document.head.appendChild(s);
}

// ── HELPERS ───────────────────────────────────────────────────────
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}
function minToTime(m) {
  if (m == null) return "--:--";
  const h = Math.floor(m / 60) % 24;
  const mn = m % 60;
  return `${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}`;
}

const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _barrioCache = {};
function barrioColor(b) {
  if (!b) return "#8b95a5";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

const VEHICLE_TYPES = ["Camión lateral","Camión trasero","Furgón","Barredora","Cisterna","Otro"];
const TURNO_TYPES   = ["Mañana (06-14)","Tarde (14-22)","Noche (22-06)","Jornada completa"];

// Parse "Mañana (06-14)" → { start: 360, end: 840 }
function turnoWindow(turno, fallbackStart, fallbackEnd) {
  if (!turno) return { start: fallbackStart, end: fallbackEnd };
  const m = turno.match(/\((\d{2})-(\d{2})\)/);
  if (!m) return { start: fallbackStart, end: fallbackEnd };
  const start = parseInt(m[1]) * 60;
  let   end   = parseInt(m[2]) * 60;
  if (end <= start) end += 24 * 60; // overnight
  return { start, end };
}

// Haversine distance in km — returns 0 for invalid/missing coordinates
function haversineKm(lat1, lng1, lat2, lng2) {
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
function hasCoords(lat, lng) {
  return isFinite(+lat) && isFinite(+lng) && (+lat !== 0 || +lng !== 0);
}

// ── VRP ALGORITHM HELPERS ─────────────────────────────────────────
const TRAVEL_SPEED_KMH = 30;

// Farthest-point sampling: deterministic k-means seed (no randomness)
function fpsSeed(pts, k) {
  if (!pts.length) return [];
  const cx = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  let seed0 = 0, minD = Infinity;
  pts.forEach((p, i) => { const d = haversineKm(p.lat, p.lng, cx, cy); if (d < minD) { minD = d; seed0 = i; } });
  const seeds = [seed0];
  while (seeds.length < k) {
    let far = -1, maxD = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (seeds.includes(i)) continue;
      const d = Math.min(...seeds.map(s => haversineKm(pts[i].lat, pts[i].lng, pts[s].lat, pts[s].lng)));
      if (d > maxD) { maxD = d; far = i; }
    }
    if (far === -1) break;
    seeds.push(far);
  }
  return seeds;
}

// K-means geographic clustering (deterministic)
function kMeansCluster(pts, k, maxIter = 15) {
  if (k <= 1 || !pts.length) return new Array(pts.length).fill(0);
  if (k >= pts.length) return pts.map((_, i) => i);
  const seeds = fpsSeed(pts, k);
  const C = seeds.map(i => ({ lat: pts[i].lat, lng: pts[i].lng }));
  let asgn = new Array(pts.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < C.length; j++) {
        const d = haversineKm(pts[i].lat, pts[i].lng, C[j].lat, C[j].lng);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (asgn[i] !== best) { asgn[i] = best; changed = true; }
    }
    if (!changed) break;
    for (let j = 0; j < k; j++) {
      const cl = pts.filter((_, i) => asgn[i] === j);
      if (cl.length) C[j] = { lat: cl.reduce((s, p) => s + p.lat, 0) / cl.length, lng: cl.reduce((s, p) => s + p.lng, 0) / cl.length };
    }
  }
  return asgn;
}

// Nearest-neighbor TSP
function nnTSP(stops) {
  if (stops.length <= 2) return [...stops];
  const rem = [...stops];
  const route = [rem.splice(0, 1)[0]];
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

// 2-opt improvement (open path, no depot return)
function twoOpt(route) {
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
  }
  return best;
}

// ── SCENARIO GENERATION ───────────────────────────────────────────
// Phase 1 — k-means geographic clustering (one compact zone per resource)
// Phase 2 — nearest-neighbor TSP + 2-opt per zone (minimize route km)
// Phase 3 — sequential time layout with travel blocks and shift constraints
const MAX_AUTO_DAYS = 60; // safety cap for auto-day expansion

async function generateScenario(tasks, resources, constraints) {
  const { maxShiftMin, maxStops, breakDur, breakAfter, startMin: winStart, endMin: winEnd } = constraints;

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
    return { ...r, assignments: [], shiftStart: tw.start, shiftEnd: tw.end, totalKm: 0 };
  });

  let remaining = [...tasks];
  let day = 0;

  while (remaining.length > 0 && day < MAX_AUTO_DAYS) {
    const tasksAtDayStart = remaining.length;
    const dayOffset = day * 1440;

    // ── Phase 1: re-cluster remaining tasks for this day ──────────
    const withCoords = remaining.filter(t => hasCoords(t.lat, t.lng));
    const noCoords   = remaining.filter(t => !hasCoords(t.lat, t.lng));
    const clusterForRes = Array.from({ length: k }, () => []);

    if (withCoords.length > 0) {
      const asgn = kMeansCluster(withCoords, k);
      const rawClusters = Array.from({ length: k }, () => []);
      withCoords.forEach((t, i) => rawClusters[asgn[i]].push(t));
      const centroids = rawClusters.map(cl => cl.length
        ? { lat: cl.reduce((s, t) => s + t.lat, 0) / cl.length, lng: cl.reduce((s, t) => s + t.lng, 0) / cl.length }
        : { lat: 0, lng: 0 });
      const clusterOrder = centroids.map((_, i) => i).sort((a, b) => centroids[a].lng - centroids[b].lng);
      for (let i = 0; i < k; i++) clusterForRes[resOrder[i]] = rawClusters[clusterOrder[i]];
    }
    noCoords.forEach((t, i) => clusterForRes[resOrder[i % k]].push(t));

    // ── Phase 2: TSP + 2-opt per cluster ─────────────────────────
    const routes = clusterForRes.map(cluster => {
      const withC = cluster.filter(t => hasCoords(t.lat, t.lng));
      const noC   = cluster.filter(t => !hasCoords(t.lat, t.lng));
      return [...twoOpt(nnTSP(withC)), ...noC];
    });

    // ── Phase 3: assign within today's shift window ───────────────
    const dayUnassigned = [];
    for (let i = 0; i < k; i++) {
      const res = state[i];
      let cursor     = res.shiftStart + dayOffset;
      const dayEnd   = res.shiftEnd   + dayOffset;
      let sinceBreak = 0;
      let lastLat = null, lastLng = null;

      for (const task of routes[i]) {
        const dur = task.duracion || 15;

        if (maxStops > 0) {
          const todayCount = res.assignments.filter(a => !a._break && !a._travel && Math.floor(a._start / 1440) === day).length;
          if (todayCount >= maxStops) { dayUnassigned.push(task); continue; }
        }

        if (breakAfter > 0 && breakDur > 0 && sinceBreak >= breakAfter && cursor + breakDur <= dayEnd) {
          res.assignments.push({ _break: true, _start: cursor, _end: cursor + breakDur, duracion: breakDur });
          cursor += breakDur; sinceBreak = 0;
        }

        let travelMin = 0, travelKm = 0;
        if (hasCoords(lastLat, lastLng) && hasCoords(task.lat, task.lng)) {
          travelKm = haversineKm(lastLat, lastLng, task.lat, task.lng);
          if (travelKm >= 0.05) { // ignore < 50m (GPS noise / same-block stops)
            travelMin = Math.max(1, Math.ceil(travelKm / TRAVEL_SPEED_KMH * 60));
          }
        }

        const workSoFar = cursor - (res.shiftStart + dayOffset);
        if (maxShiftMin > 0 && workSoFar + travelMin + dur > maxShiftMin) { dayUnassigned.push(task); continue; }
        if (cursor + travelMin + dur > dayEnd) { dayUnassigned.push(task); continue; }

        if (travelMin > 0) {
          res.assignments.push({ _travel: true, _start: cursor, _end: cursor + travelMin, duracion: travelMin, km: +travelKm.toFixed(3) });
          cursor += travelMin; res.totalKm += travelKm;
        }

        res.assignments.push({ ...task, _start: cursor, _end: cursor + dur });
        cursor += dur; sinceBreak += dur;
        if (hasCoords(task.lat, task.lng)) { lastLat = +task.lat; lastLng = +task.lng; }
      }
    }

    remaining = dayUnassigned;
    day++;
    if (remaining.length >= tasksAtDayStart) break; // nothing assigned this day — stop
    // Yield to the UI thread between days to prevent "not responding"
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const daysUsed = Math.max(1, day);
  return { schedule: state, unassigned: remaining, daysUsed };
}

// ── GANTT CHART ───────────────────────────────────────────────────
const ROW_H    = 52;
const HEADER_H = 44;
const LABEL_W  = 210;
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8];

const DAY_OPTIONS = [1, 2, 3, 5, 7, 14];

function GanttChart({ rows, startMin, endMin, days = 1, mode, allWorkers = [], allVehicles = [], onScheduleChange }) {
  const [tooltip,      setTooltip]      = useState(null);
  const [pxPerMin,     setPxPerMin]     = useState(2);
  const [legendOpen,   setLegendOpen]   = useState(false);
  const [selectedDay,  setSelectedDay]  = useState(0);
  const [dragging,     setDragging]     = useState(null); // { task, fromRowId }
  const [dropRowId,    setDropRowId]    = useState(null);
  const [stackPanel,   setStackPanel]   = useState(null); // { task, row }

  // Night-shift support: extend chart width beyond 24h if any row has shiftEnd > 1440
  const maxShiftEnd = Math.max(1440, ...rows.map(r => r.shiftEnd ?? 1440));
  const hasNightShift = maxShiftEnd > 1440;
  const chartW = maxShiftEnd * pxPerMin;

  // Hour ticks — density adapts to zoom, go up to maxShiftEnd
  const ticks = [];
  const tickStep = pxPerMin < 0.75 ? 2 : 1;
  const maxH = Math.ceil(maxShiftEnd / 60);
  for (let h = 0; h <= maxH; h += tickStep) {
    ticks.push({ h, x: h * 60 * pxPerMin });
  }

  // Sub-hour ticks
  const subTicks = [];
  const subMin = pxPerMin >= 4 ? 15 : 30;
  for (let m = 0; m < maxShiftEnd; m += subMin) {
    if (m % 60 === 0) continue;
    subTicks.push({ x: m * pxPerMin, quarter: m % 60 === 15 || m % 60 === 45 });
  }

  // Inactive-hour bands: left = before first shift, right = after all shifts (none if night-aware)
  const minShiftStart = rows.length > 0
    ? Math.min(...rows.map(r => r.shiftStart ?? startMin))
    : startMin;
  const inactiveBands = [
    minShiftStart > 0 ? { x: 0, w: minShiftStart * pxPerMin } : null,
    // Right inactive: only when no night shifts (night extends past midnight)
    !hasNightShift && endMin < 1440 ? { x: endMin * pxPerMin, w: (1440 - endMin) * pxPerMin } : null,
  ].filter(Boolean);

  // Collect unique barrios for legend
  const barrios = [...new Set(
    rows.flatMap(r => (r.assignments || []).map(a => a.barrio).filter(Boolean))
  )].sort();

  const zoomIn  = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i < ZOOM_STEPS.length - 1) setPxPerMin(ZOOM_STEPS[i + 1]); else setPxPerMin(Math.min(12, pxPerMin * 2)); };
  const zoomOut = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i > 0) setPxPerMin(ZOOM_STEPS[i - 1]); else setPxPerMin(Math.max(0.1, pxPerMin / 2)); };

  const zoomLabel = pxPerMin >= 1 ? `${pxPerMin}×` : `${pxPerMin}×`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 6, padding: "5px 16px", flexWrap: "wrap",
      }}>
        {/* Zoom */}
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 4 }}>Zoom</span>
        <button onClick={zoomOut} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <span style={{ fontSize: 11, color: C.text, fontFamily: mono, minWidth: 28, textAlign: "center" }}>{zoomLabel}</span>
        <button onClick={zoomIn}  style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }} />
        {ZOOM_STEPS.map(z => (
          <button key={z} onClick={() => setPxPerMin(z)} style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
            border: `1px solid ${pxPerMin === z ? C.blue : C.border}`,
            background: pxPerMin === z ? C.blueDim : "none",
            color: pxPerMin === z ? C.blueText : C.dim,
            transition: "all .1s",
          }}>{z}×</button>
        ))}

        {/* Day navigation */}
        {days > 1 && <>
          <div style={{ width: 1, height: 16, background: C.border, margin: "0 8px" }} />
          <button onClick={() => setSelectedDay(d => Math.max(0, d - 1))} disabled={selectedDay === 0}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === 0 ? C.dim : C.muted, cursor: selectedDay === 0 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
          {Array.from({ length: days }, (_, d) => (
            <button key={d} onClick={() => setSelectedDay(d)} style={{
              padding: "2px 10px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
              border: `1px solid ${selectedDay === d ? C.green : C.border}`,
              background: selectedDay === d ? C.greenDim : "none",
              color: selectedDay === d ? C.green : C.dim,
              fontWeight: selectedDay === d ? 700 : 400,
              transition: "all .1s",
            }}>Día {d + 1}</button>
          ))}
          <button onClick={() => setSelectedDay(d => Math.min(days - 1, d + 1))} disabled={selectedDay === days - 1}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === days - 1 ? C.dim : C.muted, cursor: selectedDay === days - 1 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        </>}
      </div>

      {/* ── Scrollable Gantt ── */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }} onClick={() => setStackPanel(null)}>
        <div style={{ display: "inline-block", minWidth: LABEL_W + chartW, minHeight: "100%" }}>

          {/* Time axis header */}
          <div style={{
            display: "flex", height: HEADER_H,
            position: "sticky", top: 0, zIndex: 10,
            background: C.card, borderBottom: `1px solid ${C.border2}`,
          }}>
            <div style={{
              width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 12,
              background: C.card, borderRight: `1px solid ${C.border}`,
              display: "flex", alignItems: "flex-end", padding: "0 16px 8px",
            }}>
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Recurso</span>
            </div>
            <div style={{ position: "relative", width: chartW, flexShrink: 0 }}>
              {/* Inactive-hours shading in header */}
              {inactiveBands.map(({ x, w }, i) => (
                <div key={i} style={{ position: "absolute", left: x, top: 0, width: w, height: "100%", background: "rgba(0,0,0,0.30)", pointerEvents: "none" }} />
              ))}
              {subTicks.map(({ x, quarter }, i) => (
                <div key={i} style={{ position: "absolute", left: x, top: "70%", bottom: 0, width: 1, background: C.border, opacity: quarter ? .3 : .2 }} />
              ))}
              {ticks.map(({ h, x }) => (
                <div key={h} style={{ position: "absolute", left: x, top: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 7 }}>
                  <div style={{ width: 1, height: 10, background: C.border2, marginLeft: -0.5 }} />
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginTop: 3, transform: "translateX(-50%)", display: "inline-block", whiteSpace: "nowrap" }}>
                    {String(h % 24).padStart(2,"0")}:00
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Resource rows */}
          {rows.map((row, ri) => (
            <div key={row._id || row.id || ri} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.border}` }}>
              {/* Label */}
              <div style={{
                width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 3,
                background: ri % 2 === 0 ? C.card : C.surface2,
                borderRight: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", padding: "0 14px", gap: 10,
              }}>
                {(() => {
                  const fullName = [row.nombre, row.apellidos].filter(Boolean).join(" ") || row.name || "?";
                  const letter = fullName[0].toUpperCase();
                  const stopCount = row.assignments?.filter(a => !a._break && !a._travel).length ?? 0;
                  return (
                    <>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.blueText }}>
                        {letter}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fullName}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim, fontFamily: mono, display: "flex", gap: 6, alignItems: "center", marginTop: 1 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.turno || row.matricula || ""}</span>
                          {stopCount > 0 && <span style={{ color: C.muted, flexShrink: 0 }}>{stopCount}p</span>}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Timeline */}
              <div
                style={{
                  position: "relative", width: chartW, flexShrink: 0,
                  background: dropRowId === (row._id || row.id) && dragging
                    ? `${C.blue}18`
                    : ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                  transition: "background .1s",
                }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropRowId(row._id || row.id); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropRowId(null); }}
                onDrop={e => {
                  e.preventDefault(); setDropRowId(null);
                  if (!dragging || !onScheduleChange) return;
                  const toRowId = row._id || row.id;
                  if (dragging.fromRowId === toRowId) return;
                  onScheduleChange({ task: dragging.task, fromRowId: dragging.fromRowId, toRowId });
                  setDragging(null);
                }}
              >
                {ticks.map(({ h, x }) => (
                  <div key={h} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .5 }} />
                ))}
                {subTicks.map(({ x }, i) => (
                  <div key={i} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .15 }} />
                ))}
                {/* Midnight marker for night shifts */}
                {hasNightShift && (
                  <div style={{ position: "absolute", left: (1440 - selectedDay * 1440 < 0 ? 0 : (1440 - selectedDay * 1440)) * pxPerMin, top: 0, bottom: 0, width: 2, background: `${C.blue}55`, pointerEvents: "none", zIndex: 2 }} />
                )}

                {/* Inactive-hours shading per row (based on row's own shift window if available) */}
                {(() => {
                  const rs = row.shiftStart ?? minShiftStart;
                  const re = row.shiftEnd   ?? (hasNightShift ? maxShiftEnd : endMin);
                  const bands = [
                    rs > 0           ? { x: 0,               w: rs * pxPerMin }               : null,
                    re < maxShiftEnd ? { x: re * pxPerMin,   w: (maxShiftEnd - re) * pxPerMin } : null,
                  ].filter(Boolean);
                  return bands.map(({ x, w: bw }, i) => (
                    <div key={i} style={{ position: "absolute", left: x, top: 0, width: bw, height: "100%", background: "rgba(0,0,0,0.18)", pointerEvents: "none", zIndex: 1 }} />
                  ));
                })()}

              {(row.assignments || []).filter(task => {
                  const dayOffset = selectedDay * 1440;
                  return task._start >= dayOffset && task._start < dayOffset + maxShiftEnd;
                }).map((task, ti) => {
                  const left = (task._start - selectedDay * 1440) * pxPerMin;
                  const dur  = task.duracion || 15;
                  const w    = Math.max(dur * pxPerMin - 2, 3);
                  if (left < 0 || left > chartW) return null;

                  // Break block
                  if (task._break) return (
                    <div key={`b${ti}`} title={`Pausa · ${dur} min`} style={{
                      position: "absolute", left, top: ROW_H * 0.3, width: w, height: ROW_H * 0.4, zIndex: 3,
                      background: "repeating-linear-gradient(45deg,rgba(251,146,60,0.15) 0,rgba(251,146,60,0.15) 4px,transparent 4px,transparent 8px)",
                      border: "1px dashed rgba(251,146,60,0.4)", borderRadius: 3,
                    }} />
                  );

                  // Travel block
                  if (task._travel) return (
                    <div key={`tr${ti}`}
                      title={`Km en vacío: ${task.km?.toFixed(2)} km · ${dur} min`}
                      style={{ position: "absolute", left, top: ROW_H * 0.43, width: Math.max(w, 3), height: ROW_H * 0.14, background: "rgba(139,149,165,0.3)", borderRadius: 2, display: "flex", alignItems: "center", overflow: "hidden", zIndex: 3 }}
                    >
                      {w > 30 && <span style={{ fontSize: 8, color: C.muted, paddingLeft: 3, whiteSpace: "nowrap" }}>{task.km?.toFixed(1)} km</span>}
                    </div>
                  );

                  // PA stop block — derive label: prefer nombre/IdSAP over barrio
                  const color = barrioColor(task.barrio);
                  const paCode = task.nombre
                    || Object.entries(task.campos || {}).find(([k]) =>
                         ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase())
                       )?.[1]
                    || "";
                  const label = paCode || task.barrio || "";
                  const isActive = stackPanel?.task === task;
                  return (
                    <div key={ti} className="sched-block"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragging({ task, fromRowId: row._id || row.id });
                        setTooltip(null);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={e => { e.stopPropagation(); setStackPanel(p => p?.task === task ? null : { task, row }); setTooltip(null); }}
                      onMouseEnter={e => !dragging && setTooltip({ task, row, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => !dragging && setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        position: "absolute", left, top: 5, height: ROW_H - 10, width: w, zIndex: 4,
                        background: isActive ? color : color + "d0",
                        border: `1px solid ${color}`,
                        boxShadow: isActive ? `0 0 0 2px ${color}, 0 4px 12px rgba(0,0,0,.5)` : "none",
                        borderRadius: 4, overflow: "hidden", cursor: "grab",
                        display: "flex", alignItems: "center", gap: 3, padding: "0 4px",
                        opacity: dragging?.task === task ? 0.4 : 1,
                        transition: "box-shadow .1s, opacity .1s",
                      }}
                    >
                      {w >= 14 && (
                        <>
                          <div style={{ width: 3, height: "60%", borderRadius: 2, background: "#fff", opacity: 0.5, flexShrink: 0 }} />
                          {w >= 22 && (
                            <span style={{ fontSize: Math.min(10, w / 5), color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: w >= 60 ? "ellipsis" : "clip", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                              {w >= 60 ? label : label.slice(0, Math.max(2, Math.floor(w / 7)))}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {rows.length === 0 && (
            <div style={{ padding: "48px 0", textAlign: "center", color: C.dim, fontSize: 13, width: LABEL_W + chartW }}>Sin recursos asignados</div>
          )}
        </div>

        {/* Hover Tooltip */}
        {tooltip && !dragging && !stackPanel && (
          <div style={{
            position: "fixed",
            left: Math.min(tooltip.x + 14, window.innerWidth - 270),
            top: Math.max(tooltip.y - 70, 8),
            background: C.card, border: `1px solid ${C.border2}`,
            borderRadius: 9, padding: "11px 14px", zIndex: 2000,
            boxShadow: "0 8px 28px rgba(0,0,0,.6)",
            fontSize: 12, color: C.text, minWidth: 190, maxWidth: 270,
            pointerEvents: "none", animation: "sched-fadein .1s ease both",
          }}>
            {tooltip.task.barrio && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: barrioColor(tooltip.task.barrio), flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: C.muted }}>{tooltip.task.barrio}</span>
              </div>
            )}
            <div style={{ fontWeight: 700, marginBottom: 4, color: C.text, fontSize: 13 }}>
              {tooltip.task.nombre
                || Object.entries(tooltip.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
                || tooltip.task.barrio || "Parada"}
            </div>
            <div style={{ color: C.muted, fontFamily: mono, fontSize: 11, marginBottom: 3 }}>
              {minToTime(tooltip.task._start % 1440)} → {minToTime(tooltip.task._end % 1440)}
              <span style={{ color: C.dim }}> · {tooltip.task.duracion || 15} min</span>
            </div>
            {(() => {
              const campos = tooltip.task.campos || {};
              const calle  = Object.entries(campos).find(([k]) => k.toLowerCase() === "calle")?.[1];
              const num    = Object.entries(campos).find(([k]) => ["num","num.","número","numero"].includes(k.toLowerCase()))?.[1];
              return calle ? <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{calle}{num ? ` ${num}` : ""}</div> : null;
            })()}
            {(() => {
              const row = tooltip.row;
              if (!row) return null;
              if (mode === "vehicles") {
                const linked = allWorkers.find(w => w.vehiculoId === (row._id || row.id));
                if (!linked) return null;
                const name = [linked.nombre, linked.apellidos].filter(Boolean).join(" ");
                return (
                  <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.green, fontWeight: 700, flexShrink: 0 }}>{name[0]}</div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Conductor asignado</div>
                      <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{name}</div>
                    </div>
                  </div>
                );
              }
              if (mode === "workers") {
                const vId = row.vehiculoId;
                if (!vId) return null;
                const v = allVehicles.find(v => (v._id || v.id) === vId);
                if (!v) return null;
                return (
                  <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blue, fontWeight: 700, flexShrink: 0 }}>🚛</div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Vehículo asignado</div>
                      <div style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` · ${v.matricula}` : ""}</div>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* Stack panel — click-open detail + reassign */}
        {stackPanel && (
          <div style={{
            position: "fixed", right: 0, top: 0, bottom: 0, width: 300,
            background: C.card, borderLeft: `1px solid ${C.border2}`,
            zIndex: 3000, overflowY: "auto",
            boxShadow: "-8px 0 40px rgba(0,0,0,.55)",
            animation: "sched-fadein .15s ease both",
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
              {stackPanel.task.barrio && (
                <div style={{ width: 12, height: 12, borderRadius: 3, background: barrioColor(stackPanel.task.barrio), flexShrink: 0, marginTop: 2 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                  {stackPanel.task.nombre
                    || Object.entries(stackPanel.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
                    || stackPanel.task.barrio || "Parada"}
                </div>
                {stackPanel.task.barrio && <div style={{ fontSize: 10, color: C.muted }}>{stackPanel.task.barrio}</div>}
              </div>
              <button onClick={() => setStackPanel(null)} style={{ background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
            </div>

            {/* Time + assigned resource */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                {minToTime(stackPanel.task._start % 1440)} → {minToTime(stackPanel.task._end % 1440)}
                <span style={{ color: C.dim }}> · {stackPanel.task.duracion || 15} min</span>
              </div>
              {stackPanel.task._start >= 1440 && (
                <div style={{ fontSize: 10, color: C.amber, marginTop: 3 }}>⏱ Turno de noche (continúa desde noche anterior)</div>
              )}
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blueText, fontWeight: 700, flexShrink: 0 }}>
                  {(stackPanel.row.nombre || "?")[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.dim }}>Asignado a</div>
                  <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                    {[stackPanel.row.nombre, stackPanel.row.apellidos].filter(Boolean).join(" ") || stackPanel.row.matricula || "?"}
                  </div>
                </div>
              </div>
            </div>

            {/* Reasignar */}
            {onScheduleChange && rows.length > 1 && (
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>Mover a</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {rows.filter(r => (r._id || r.id) !== (stackPanel.row._id || stackPanel.row.id)).map(r => (
                    <button key={r._id || r.id} onClick={() => {
                      onScheduleChange({ task: stackPanel.task, fromRowId: stackPanel.row._id || stackPanel.row.id, toRowId: r._id || r.id });
                      setStackPanel(null);
                    }} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                      background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7,
                      cursor: "pointer", textAlign: "left", transition: "border-color .1s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                    >
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.surface2, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.muted, fontWeight: 700 }}>
                        {(r.nombre || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                          {[r.nombre, r.apellidos].filter(Boolean).join(" ") || r.matricula || "?"}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim }}>{r.turno || r.matricula || ""}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* All campos */}
            {Object.keys(stackPanel.task.campos || {}).length > 0 && (
              <div style={{ padding: "10px 16px" }}>
                <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>Datos</div>
                {Object.entries(stackPanel.task.campos).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                    <span style={{ color: C.dim, minWidth: 80, flexShrink: 0, textOverflow: "ellipsis", overflow: "hidden" }}>{k}</span>
                    <span style={{ color: C.text, fontWeight: 500, wordBreak: "break-all" }}>{String(v)}</span>
                  </div>
                ))}
                {stackPanel.task.lat && stackPanel.task.lng && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                    <span style={{ color: C.dim, minWidth: 80 }}>Coords</span>
                    <span style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>{(+stackPanel.task.lat).toFixed(5)}, {(+stackPanel.task.lng).toFixed(5)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Barrio legend (collapsible) ── */}
      {barrios.length > 0 && (
        <div style={{ flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setLegendOpen(o => !o)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "6px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Barrios</span>
            <span style={{ fontSize: 10, color: C.muted, background: C.surface2, borderRadius: 10, padding: "1px 7px", border: `1px solid ${C.border}` }}>{barrios.length}</span>
            <span style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>{legendOpen ? "▲" : "▼"}</span>
          </button>
          {legendOpen && (
            <div style={{ padding: "6px 16px 10px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              {barrios.map(b => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: barrioColor(b), flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: C.muted }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CONSTRAINTS PANEL ─────────────────────────────────────────────
function ConstraintsPanel({ c, onChange }) {
  const set = (key, val) => onChange({ ...c, [key]: val });
  const row = (label, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: C.muted, width: 200, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
  const numInput = (key, min, max, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={min} max={max} value={c[key] || ""}
        onChange={e => set(key, parseInt(e.target.value) || 0)}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const timeInput = (key) => (
    <input type="time"
      value={minToTime(c[key])}
      onChange={e => { const m = timeToMin(e.target.value); if (m !== null) set(key, m); }}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.blueText, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
    />
  );

  return (
    <div style={{
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
      padding: "14px 20px", flexShrink: 0,
      animation: "sched-fadein .15s ease both",
    }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 14 }}>Restricciones</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
        {row("Duración máxima de turno (0 = sin límite)", numInput("maxShiftMin", 0, 1440, "min"))}
        {row("Máximo de paradas (0 = sin límite)", numInput("maxStops", 0, 500, "paradas"))}
        {row("Pausa automática cada", numInput("breakAfter", 0, 480, "min trabajo"))}
        {row("Duración de la pausa", numInput("breakDur", 0, 120, "min"))}
        {row("Ventana: hora de inicio", timeInput("startMin"))}
        {row("Ventana: hora de fin", timeInput("endMin"))}
        {/* días se computa automáticamente por el algoritmo, no se muestra aquí */}
      </div>
    </div>
  );
}

// ── VEHICLES TAB ──────────────────────────────────────────────────
export function TabVehiculos({ vehicles, loading }) {
  const empty = { nombre: "", matricula: "", tipo: "Camión lateral", capacidad: "", turno: "Jornada completa" };
  const [form,   setForm]   = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };
  const inpStyle = { ...selStyle };

  async function create() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    await addDoc(collection(db, "scheduling_vehicles"), {
      nombre: form.nombre.trim(), matricula: form.matricula.trim(),
      tipo: form.tipo, turno: form.turno,
      capacidad: parseInt(form.capacidad) || 0,
      activo: true, createdAt: serverTimestamp(),
    });
    setForm(empty); setAdding(false); setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    await updateDoc(doc(db, "scheduling_vehicles", id), {
      nombre: editForm.nombre.trim(), matricula: editForm.matricula.trim(),
      tipo: editForm.tipo, turno: editForm.turno,
      capacidad: parseInt(editForm.capacidad) || 0,
    });
    setEditId(null); setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este vehículo?")) return;
    await deleteDoc(doc(db, "scheduling_vehicles", id));
  }

  function startEdit(v) {
    setEditId(v._id);
    setEditForm({ nombre: v.nombre || "", matricula: v.matricula || "", tipo: v.tipo || "Camión lateral", turno: v.turno || "Jornada completa", capacidad: v.capacidad || "" });
    setAdding(false);
  }

  const inp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={inpStyle} />
  );

  const eInp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={inpStyle} />
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Vehículos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{vehicles.length} registrado{vehicles.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir vehículo"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {inp("nombre", "Nombre (p.ej. Vehículo 01)")}
            {inp("matricula", "Matrícula")}
            {inp("capacidad", "Capacidad (m³)", "number")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={selStyle}>
              {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : vehicles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay vehículos. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {vehicles.map(v => editId === v._id ? (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("matricula", "Matrícula")}
                {eInp("capacidad", "Capacidad (m³)", "number")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={editForm.tipo} onChange={e => setEditForm({ ...editForm, tipo: e.target.value })} style={selStyle}>
                  {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <button onClick={() => save(v._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.blueText, flexShrink: 0 }}>
                {v.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10 }}>
                  {v.matricula && <span style={{ fontFamily: mono }}>{v.matricula}</span>}
                  <span>{v.tipo}</span>
                  {v.capacidad > 0 && <span>{v.capacidad} m³</span>}
                  {v.turno && <span style={{ color: C.blueText }}>{v.turno}</span>}
                </div>
              </div>
              <button onClick={() => startEdit(v)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(v._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WORKERS TAB ───────────────────────────────────────────────────
export function TabTrabajadores({ workers, vehicles, loading }) {
  const empty = { nombre: "", apellidos: "", turno: "Mañana (06-14)", rol: "conductor", vehiculoId: "" };
  const [form,     setForm]     = useState(empty);
  const [adding,   setAdding]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };

  async function create() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    await addDoc(collection(db, "scheduling_workers"), {
      nombre: form.nombre.trim(), apellidos: form.apellidos.trim(),
      turno: form.turno, rol: form.rol,
      vehiculoId: form.vehiculoId || "",
      activo: true, createdAt: serverTimestamp(),
    });
    setForm(empty); setAdding(false); setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    await updateDoc(doc(db, "scheduling_workers", id), {
      nombre: editForm.nombre.trim(), apellidos: (editForm.apellidos || "").trim(),
      turno: editForm.turno, rol: editForm.rol,
      vehiculoId: editForm.vehiculoId || "",
    });
    setEditId(null); setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este trabajador?")) return;
    await deleteDoc(doc(db, "scheduling_workers", id));
  }

  function startEdit(w) {
    setEditId(w._id);
    setEditForm({ nombre: w.nombre || "", apellidos: w.apellidos || "", turno: w.turno || "Mañana (06-14)", rol: w.rol || "conductor", vehiculoId: w.vehiculoId || "" });
    setAdding(false);
  }

  const inp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={selStyle} />
  );

  const eInp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={selStyle} />
  );

  const VehicleSelect = ({ value, onChange }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...selStyle, color: value ? C.text : C.dim }}>
      <option value="">Sin vehículo asignado</option>
      {(vehicles || []).map(v => <option key={v._id} value={v._id}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` (${v.matricula})` : ""}</option>)}
    </select>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Trabajadores</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{workers.length} registrado{workers.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir trabajador"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {inp("nombre", "Nombre")}
            {inp("apellidos", "Apellidos")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
              {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, rol: v })} style={{
                  padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: form.rol === v ? C.blue : "none",
                  color: form.rol === v ? "#fff" : C.muted,
                  fontSize: 11, fontFamily: font, transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <VehicleSelect value={form.vehiculoId} onChange={v => setForm({ ...form, vehiculoId: v })} />
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : workers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay trabajadores. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workers.map(w => editId === w._id ? (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("apellidos", "Apellidos")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
                  {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                    <button key={v} onClick={() => setEditForm({ ...editForm, rol: v })} style={{
                      padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                      background: editForm.rol === v ? C.blue : "none",
                      color: editForm.rol === v ? "#fff" : C.muted,
                      fontSize: 11, fontFamily: font, transition: "all .12s",
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <VehicleSelect value={editForm.vehiculoId} onChange={v => setEditForm({ ...editForm, vehiculoId: v })} />
                <button onClick={() => save(w._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.green, flexShrink: 0, fontWeight: 700 }}>
                {w.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{w.nombre} {w.apellidos}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>{w.turno}</span>
                  <span style={{ color: w.rol === "supervisor" ? C.amber : C.dim }}>{w.rol}</span>
                  {(() => {
                    const v = (vehicles || []).find(v => v._id === w.vehiculoId);
                    return v
                      ? <span style={{ color: C.blue, background: C.blueDim, borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>🚛 {v.nombre || v.matricula}</span>
                      : <span style={{ color: C.red, fontSize: 10 }}>Sin vehículo</span>;
                  })()}
                </div>
              </div>
              <button onClick={() => startEdit(w)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(w._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PLANIFICACION TAB ─────────────────────────────────────────────
export function TabPlanificacion({ vehicles, workers, activeProject, onProjectUpdate }) {
  const tasks = activeProject?.planning?.tasks || [];

  const [importing,    setImporting]   = useState(false);
  const [mode,         setMode]        = useState("vehicles");
  const [showC,        setShowC]       = useState(false);
  const [constraints,  setConstraints] = useState({
    maxShiftMin: 0, maxStops: 0, breakAfter: 240, breakDur: 30,
    startMin: 360, endMin: 1320, days: 1,
  });
  const [schedules,    setSchedules]   = useState({ vehicles: null, workers: null });
  const [unassigneds,  setUnassigneds] = useState({ vehicles: [], workers: [] });
  const [generating,   setGenerating]  = useState(false);
  const [genError,     setGenError]    = useState(null);
  const [publishModal, setPublishModal] = useState(null);
  const [publishing,   setPublishing]  = useState(false);

  const schedule   = schedules[mode];
  const unassigned = unassigneds[mode];

  // When active project changes, restore its scheduling state
  useEffect(() => {
    if (!activeProject) {
      setSchedules({ vehicles: null, workers: null });
      return;
    }
    const sc = activeProject.scheduling;
    if (sc) {
      setSchedules({ vehicles: sc.vehicleSchedule || [], workers: sc.workerSchedule || [] });
      setConstraints(prev => ({ ...prev, ...(sc.constraints || {}), days: sc.daysUsed || 1 }));
    } else {
      setSchedules({ vehicles: null, workers: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?._id]);

  function importFromPlanning() {
    if (!activeProject) return;
    setImporting(true);
    const unsub = onSnapshot(collection(db, "planning_timetable"), snap => {
      unsub();
      const allTasks = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      const uniqueBarrios = [...new Set(allTasks.map(t => t.barrio).filter(Boolean))];
      onProjectUpdate({
        planning: {
          tasks: allTasks,
          importedAt: new Date().toISOString(),
          tasksCount: allTasks.length,
          uniqueBarrios: uniqueBarrios.slice(0, 30),
        },
        status: "con_planning",
      });
      setImporting(false);
    }, () => setImporting(false));
  }

  async function runGenerate() {
    if (!tasks.length) return;
    if (!vehicles.length && !workers.length) return;
    setGenerating(true);
    setGenError(null);
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      // ── Step 1: Vehicle VRP ──────────────────────────────────────
      // Vehicles always use their OWN turno — no override.
      // generateScenario preserves resource order: vr.schedule[i] ↔ vehicles[i]
      let vr = { schedule: [], unassigned: [...tasks], daysUsed: 1 };
      if (vehicles.length > 0) {
        vr = await generateScenario(tasks, vehicles, constraints);
      }
      const vehicleSchedule = vehicles.map((v, i) => ({
        ...v,
        assignments: vr.schedule[i]?.assignments || [],
        totalKm:     vr.schedule[i]?.totalKm     || 0,
        shiftStart:  vr.schedule[i]?.shiftStart,
        shiftEnd:    vr.schedule[i]?.shiftEnd,
      }));

      // ── Step 2: Worker schedule ──────────────────────────────────
      // Routes come ONLY from vehicles. Workers are human assignments
      // on top of a vehicle route — they never generate routes on their own.
      //
      // Each worker must be linked to a vehicle via vehiculoId.
      // Multiple workers can share one vehicle (e.g. morning + afternoon driver).
      // Each assignment belongs to EXACTLY ONE worker: the linked worker whose
      // turno window covers that time slot (earliest-start wins on overlap).
      // Workers without a valid vehiculoId appear with empty assignments.

      // Pre-compute turno window for every worker
      const workersWithTw = workers.map(w => ({
        ...w,
        _tw: turnoWindow(w.turno, constraints.startMin, constraints.endMin),
      }));

      // Group workers by vehiculoId so we can resolve ownership per vehicle
      const vehicleWorkerMap = {};
      for (const w of workersWithTw) {
        const vid = w.vehiculoId;
        if (!vid) continue;
        if (!vehicleWorkerMap[vid]) vehicleWorkerMap[vid] = [];
        vehicleWorkerMap[vid].push(w);
      }
      // Sort each vehicle's workers by turno start (earliest first → first-match wins)
      for (const list of Object.values(vehicleWorkerMap)) {
        list.sort((a, b) =>
          a._tw.start !== b._tw.start
            ? a._tw.start - b._tw.start
            : (a.nombre || "").localeCompare(b.nombre || "")
        );
      }

      const workerRows = workersWithTw.map(w => {
        const vehicleRow = vehicleSchedule.find(v => (v._id || v.id) === w.vehiculoId);
        if (!vehicleRow) return { ...w, assignments: [], totalKm: 0 };

        const peers = vehicleWorkerMap[w.vehiculoId] || [];
        const wId   = w._id || w.id;

        const myAssignments = vehicleRow.assignments.filter(a => {
          // Normalize _start to within-day minutes (repeats each day)
          const dayOffset = Math.floor((a._start - constraints.startMin) / 1440) * 1440;
          const t = a._start - dayOffset;
          // Owner = first peer whose window contains this time slot
          const owner = peers.find(p => t >= p._tw.start && t < p._tw.end);
          return owner && (owner._id || owner.id) === wId;
        });

        const myKm = myAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
        return { ...w, assignments: myAssignments, totalKm: myKm };
      });

      setSchedules({ vehicles: vehicleSchedule, workers: workerRows });
      setUnassigneds({ vehicles: vr.unassigned, workers: [] });
      const newDays = vr.daysUsed;
      setConstraints(prev => ({ ...prev, days: newDays }));

      // Auto-save scheduling result to active project
      if (activeProject && onProjectUpdate) {
        const totalKm    = vehicleSchedule.reduce((s, v) => s + (v.totalKm || 0), 0);
        const totalStops = vehicleSchedule.reduce((s, v) =>
          s + v.assignments.filter(a => !a._break && !a._travel).length, 0);
        await onProjectUpdate({
          scheduling: {
            vehicleSchedule: vehicleSchedule.map(v => ({
              _id: v._id, nombre: v.nombre, matricula: v.matricula,
              turno: v.turno, totalKm: v.totalKm,
              shiftStart: v.shiftStart, shiftEnd: v.shiftEnd,
              assignments: v.assignments.map(a => ({
                _start: a._start, _end: a._end, duracion: a.duracion,
                nombre: a.nombre, barrio: a.barrio, lat: a.lat, lng: a.lng,
                _break: a._break || undefined, _travel: a._travel || undefined, km: a.km,
              })).filter(a => a._start != null),
            })),
            workerSchedule: workerRows.map(w => ({
              _id: w._id, nombre: w.nombre, apellidos: w.apellidos,
              vehiculoId: w.vehiculoId, turno: w.turno,
              totalKm: w.totalKm, _tw: w._tw,
              assignments: w.assignments.map(a => ({
                _start: a._start, _end: a._end, duracion: a.duracion,
                nombre: a.nombre, barrio: a.barrio, lat: a.lat, lng: a.lng,
                _break: a._break || undefined, _travel: a._travel || undefined, km: a.km,
              })).filter(a => a._start != null),
            })),
            constraints: { ...constraints, days: newDays },
            daysUsed: newDays, totalKm, totalStops,
            generatedAt: new Date().toISOString(),
          },
          status: "schedulado",
        });
      }

    } catch (e) {
      console.error("generateScenario error:", e);
      setGenError(e.message || "Error al generar el escenario");
    }
    setGenerating(false);
  }

  function taskToUbicacion(task, idx) {
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

  async function publishToRoutes(tipo, mes) {
    const vehicleSchedule = schedules.vehicles;
    if (!vehicleSchedule) return;
    setPublishing(true);
    const startMin = constraints.startMin;
    try {
      for (const row of vehicleSchedule) {
        const allStops = row.assignments.filter(a => !a._break && !a._travel);
        if (allStops.length === 0) continue;

        // Group stops by day (same formula as Gantt)
        const byDay = {};
        for (const a of allStops) {
          const d = Math.floor((a._start - startMin) / 1440);
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(a);
        }

        // Primary conductor: earliest-shift worker linked to this vehicle
        const linkedWorkers = workers
          .filter(w => w.vehiculoId === (row._id || row.id))
          .sort((a, b) => {
            const ta = turnoWindow(a.turno, constraints.startMin, constraints.endMin);
            const tb = turnoWindow(b.turno, constraints.startMin, constraints.endMin);
            return ta.start - tb.start;
          });
        const conductor = linkedWorkers[0];
        const conductorLabel = conductor
          ? [conductor.nombre, conductor.apellidos].filter(Boolean).join(" ")
          : (row.nombre || row.matricula || "Vehículo");

        const daysList = Object.keys(byDay).map(Number).sort((a, b) => a - b);
        const totalDays = daysList.length;

        for (const d of daysList) {
          const stops = byDay[d];
          const ubicaciones = stops.map((a, i) => taskToUbicacion(a, i));
          const recorrido = stops
            .filter(a => hasCoords(a.lat, a.lng))
            .map(a => ({ lat: +a.lat, lng: +a.lng }));
          // Zero-pad day so alphabetical sort = chronological sort
          const dayLabel = `Día ${String(d + 1).padStart(2, "0")}`;
          const nombre = totalDays > 1
            ? `${conductorLabel} · ${dayLabel} · ${mes}`
            : `${conductorLabel} · ${mes}`;
          await addDoc(collection(db, "planes"), {
            tipo,
            nombre,
            archivo: "vrp-generado",
            turno: row.turno || "",
            conductorNombre: conductorLabel,
            vehiculoNombre: row.nombre || row.matricula || "",
            mes,
            diaServicio: dayLabel,
            ubicaciones,
            recorrido,
            fechaSubida: Date.now(),
            origenVRP: true,
          });
        }
      }
      setPublishModal(null);
    } catch (e) {
      console.error("publishToRoutes error:", e);
      alert("Error al publicar: " + (e.message || e));
    }
    setPublishing(false);
  }

  if (!activeProject) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.dim }}>
        <div style={{ fontSize: 32 }}>📋</div>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>Ningún proyecto activo</div>
        <div style={{ fontSize: 12, color: C.dim }}>Abre o crea un proyecto desde la pestaña Proyectos</div>
      </div>
    );
  }

  const canGenerate  = (vehicles.length > 0 || workers.length > 0) && tasks.length > 0 && !generating;
  const totalAssigned = schedule ? schedule.reduce((s, r) => s + r.assignments.filter(a => !a._break && !a._travel).length, 0) : 0;
  const totalKm       = schedule ? schedule.reduce((s, r) => s + (r.totalKm || 0), 0) : 0;
  const stopsPerDay   = schedule ? (() => {
    const counts = {};
    schedule.forEach(r => r.assignments.filter(a => !a._break && !a._travel).forEach(a => {
      const d = Math.floor((a._start - constraints.startMin) / 1440);
      counts[d] = (counts[d] || 0) + 1;
    }));
    return counts;
  })() : {};

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Toolbar */}
      <div style={{
        padding: "10px 20px", borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        {/* Import */}
        <button onClick={importFromPlanning} disabled={importing} style={{
          padding: "7px 13px", background: importing ? C.surface2 : !!tasks.length ? C.greenDim : C.surface2,
          border: `1px solid ${!!tasks.length ? C.green + "44" : C.border}`,
          color: !!tasks.length ? C.green : C.muted,
          borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: importing ? "wait" : "pointer",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 7,
        }}>
          {importing
            ? <><span style={{ display: "inline-block", width: 11, height: 11, border: "2px solid rgba(52,211,153,.2)", borderTopColor: C.green, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Importando…</>
            : !!tasks.length
              ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> {tasks.length} paradas importadas</>
              : "Importar desde Planning"
          }
        </button>

        <div style={{ width: 1, height: 22, background: C.border }} />

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 3, background: C.surface2, borderRadius: 7, padding: 3 }}>
          {[["vehicles","Vehículos"],["workers","Trabajadores"]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{
              padding: "5px 12px", borderRadius: 5, border: "none", cursor: "pointer",
              background: mode === v ? C.blue : "none",
              color: mode === v ? "#fff" : C.muted,
              fontSize: 11, fontWeight: mode === v ? 600 : 400, fontFamily: font,
              transition: "all .12s",
            }}>{l}</button>
          ))}
        </div>

        {/* Constraints toggle */}
        <button onClick={() => setShowC(!showC)} style={{
          padding: "7px 12px", background: showC ? C.surface2 : "none",
          border: `1px solid ${C.border}`, color: showC ? C.text : C.muted,
          borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font, transition: "all .12s",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          Restricciones
        </button>

        {/* Worker mode hint when no vehicle schedule yet */}
        {mode === "workers" && !schedules.vehicles && (
          <span style={{ fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 5 }}>
            <span>⚠</span> Genera primero el escenario de vehículos para vincular conductores
          </span>
        )}

        {/* Generate */}
        <button onClick={runGenerate} disabled={!canGenerate} style={{
          marginLeft: "auto",
          padding: "7px 16px", background: canGenerate ? C.blue : C.blueDim,
          border: "none", color: canGenerate ? "#fff" : C.blueText,
          borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: canGenerate ? "pointer" : "not-allowed",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 7,
          opacity: canGenerate ? 1 : .6,
        }}>
          {generating
            ? <><span style={{ display: "inline-block", width: 11, height: 11, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Generando…</>
            : "Generar escenario"
          }
        </button>
      </div>

      {/* Warnings */}
      {!!tasks.length && vehicles.length === 0 && workers.length === 0 && (
        <div style={{ padding: "8px 20px", background: "rgba(251,146,60,0.08)", borderBottom: `1px solid rgba(251,146,60,0.2)`, fontSize: 12, color: C.orange, flexShrink: 0 }}>
          No hay vehículos ni trabajadores registrados. Añade recursos en las pestañas correspondientes.
        </div>
      )}
      {mode === "workers" && schedules.workers && (() => {
        const sinVehiculo = workers.filter(w => !w.vehiculoId || !vehicles.some(v => (v._id || v.id) === w.vehiculoId));
        if (!sinVehiculo.length) return null;
        const nombres = sinVehiculo.map(w => w.nombre).join(", ");
        return (
          <div style={{ padding: "6px 20px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, fontSize: 11, color: C.red, flexShrink: 0 }}>
            <strong>Sin vehículo asignado (sin paradas):</strong> {nombres}.
            {" "}Ve a la pestaña Trabajadores y asigna un vehículo a cada uno.
          </div>
        );
      })()}

      {/* Constraints panel */}
      {showC && <ConstraintsPanel c={constraints} onChange={setConstraints} />}

      {/* Error banner */}
      {genError && (
        <div style={{ padding: "8px 20px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Stats bar (when schedule exists) */}
      {schedule && (
        <div style={{
          padding: "8px 20px", borderBottom: `1px solid ${C.border}`,
          background: C.card, flexShrink: 0,
          display: "flex", alignItems: "center", gap: 24,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{schedule.length}</span>
            <span style={{ fontSize: 11, color: C.muted }}>{mode === "vehicles" ? "vehículos" : "trabajadores"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{totalAssigned}</span>
            <span style={{ fontSize: 11, color: C.muted }}>asignadas</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: unassigned.length > 0 ? C.red : C.text }}>{unassigned.length}</span>
            <span style={{ fontSize: 11, color: C.muted }}>sin asignar</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span>
            <span style={{ fontSize: 11, color: C.muted }}>día{(constraints.days || 1) !== 1 ? "s" : ""} necesario{(constraints.days || 1) !== 1 ? "s" : ""}</span>
          </div>
          {totalKm > 0 && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.amber }}>{totalKm.toFixed(1)}</span>
              <span style={{ fontSize: 11, color: C.muted }}>km vacío</span>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>
              {minToTime(constraints.startMin)} – {minToTime(constraints.endMin)}
            </div>
            {schedules.vehicles && (<>
              {activeProject && (
                <div style={{ fontSize: 10, color: C.green, display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Guardado en proyecto
                </div>
              )}
              <button
                onClick={() => {
                  const now = new Date();
                  const mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
                  setPublishModal({ tipo: "prev", mes });
                }}
                style={{
                  padding: "5px 12px", background: C.greenDim, border: `1px solid ${C.green}44`,
                  color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Publicar en Rutas
              </button>
            </>)}
          </div>
        </div>
      )}

      {/* Per-day breakdown strip */}
      {schedule && (constraints.days || 1) > 1 && (
        <div style={{
          flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
          padding: "5px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 4 }}>Reparto por día</span>
          {Array.from({ length: constraints.days || 1 }, (_, d) => (
            <div key={d} style={{
              display: "flex", alignItems: "center", gap: 5,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "2px 10px",
            }}>
              <span style={{ fontSize: 10, color: C.blue, fontWeight: 700, fontFamily: mono }}>Día {d + 1}</span>
              <span style={{ fontSize: 10, color: C.muted }}>{stopsPerDay[d] || 0} paradas</span>
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      {!schedule ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: C.dim }}>
          {!!!tasks.length
            ? <>
                <div style={{ fontSize: 13, color: C.muted }}>Importa los datos desde Planning para empezar</div>
                <div style={{ fontSize: 11 }}>Planning → Timetable → Exportar a Scheduling</div>
              </>
            : <>
                <div style={{ fontSize: 13, color: C.muted }}>{tasks.length} paradas listas</div>
                <div style={{ fontSize: 11 }}>
                  {(vehicles.length > 0 || workers.length > 0)
                    ? "Pulsa «Generar escenario» para asignar paradas"
                    : "Añade vehículos o trabajadores en las pestañas correspondientes"}
                </div>
              </>
          }
        </div>
      ) : (
        <>
          <GanttChart
            rows={schedule}
            startMin={constraints.startMin}
            endMin={constraints.endMin}
            days={constraints.days || 1}
            mode={mode}
            allWorkers={workers}
            allVehicles={vehicles}
            onScheduleChange={({ task, fromRowId, toRowId }) => {
              setSchedules(prev => {
                const key = mode === "vehicles" ? "vehicles" : "workers";
                const rows = (prev[key] || []).map(r => {
                  const rid = r._id || r.id;
                  if (rid === fromRowId) return { ...r, assignments: r.assignments.filter(a => a !== task) };
                  if (rid === toRowId)   return { ...r, assignments: [...r.assignments, task] };
                  return r;
                });
                return { ...prev, [key]: rows };
              });
            }}
          />

          {/* Unassigned section */}
          {unassigned.length > 0 && (
            <div style={{
              flexShrink: 0, borderTop: `1px solid ${C.border}`,
              background: C.card, padding: "10px 20px", maxHeight: 140, overflowY: "auto",
            }}>
              <div style={{ fontSize: 10, color: C.red, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
                Sin asignar ({unassigned.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {unassigned.map((t, i) => (
                  <div key={i} style={{
                    background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
                    borderRadius: 5, padding: "3px 8px", fontSize: 10, color: C.red, fontFamily: mono,
                  }}>
                    {t.nombre || t.barrio || minToTime(timeToMin(t.horaInicio))} {t.horaInicio && `· ${t.horaInicio}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Publish modal */}
      {publishModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => !publishing && setPublishModal(null)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "28px 28px 24px",
            width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Publicar en Rutas</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>
              Se creará un plan por cada vehículo con sus paradas asignadas.
            </div>

            {/* Tipo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Tipo de plan</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["prev","Prev. Mantenimiento"],["ext","Limp. Exterior"],["int","Limp. Interior"]].map(([k, label]) => (
                  <button key={k} onClick={() => setPublishModal(m => ({ ...m, tipo: k }))} style={{
                    flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${publishModal.tipo === k ? C.blue : C.border}`,
                    background: publishModal.tipo === k ? C.blueDim : "none",
                    color: publishModal.tipo === k ? C.blueText : C.muted,
                    fontSize: 10, fontWeight: publishModal.tipo === k ? 700 : 400,
                    cursor: "pointer", fontFamily: font, textAlign: "center",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Mes */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Mes</div>
              <input
                type="month"
                value={publishModal.mes}
                onChange={e => setPublishModal(m => ({ ...m, mes: e.target.value }))}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "8px 10px", borderRadius: 7,
                  border: `1px solid ${C.border}`, background: C.surface2,
                  color: C.text, fontSize: 12, fontFamily: font,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPublishModal(null)} disabled={publishing} style={{
                flex: 1, padding: "9px 0", borderRadius: 7, border: `1px solid ${C.border}`,
                background: "none", color: C.muted, fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: font,
              }}>Cancelar</button>
              <button onClick={() => publishToRoutes(publishModal.tipo, publishModal.mes)} disabled={publishing} style={{
                flex: 2, padding: "9px 0", borderRadius: 7, border: "none",
                background: publishing ? C.blueDim : C.blue,
                color: publishing ? C.blueText : "#fff",
                fontSize: 13, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer",
                fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {publishing
                  ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Publicando…</>
                  : "Publicar planes"
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TAB PROYECTOS ─────────────────────────────────────────────────
const PROJECT_STATUS = {
  nuevo:        { label: "Nuevo",       color: C.muted },
  con_planning: { label: "Planning",    color: C.blue  },
  schedulado:   { label: "Schedulado",  color: C.green },
  publicado:    { label: "Publicado",   color: C.amber },
};

export function TabProyectos({ activeProject, onOpenProject }) {
  const [projects,   setProjects]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [newModal,   setNewModal]   = useState(null); // { nombre:"", descripcion:"", mes:"" }
  const [creating,   setCreating]   = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "scheduling_projects"), orderBy("updatedAt", "desc")),
      snap => { setProjects(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  async function createProject() {
    if (!newModal?.nombre?.trim()) return;
    setCreating(true);
    const now = serverTimestamp();
    const ref = await addDoc(collection(db, "scheduling_projects"), {
      nombre:      newModal.nombre.trim(),
      descripcion: newModal.descripcion?.trim() || "",
      mes:         newModal.mes || new Date().toISOString().slice(0, 7),
      status:      "nuevo",
      planning:    null,
      scheduling:  null,
      createdAt:   now,
      updatedAt:   now,
    });
    setNewModal(null);
    setCreating(false);
    // Auto-open after creating
    onOpenProject({ _id: ref.id, nombre: newModal.nombre.trim(), status: "nuevo", planning: null, scheduling: null });
  }

  async function removeProject(id) {
    if (!window.confirm("¿Eliminar este proyecto y todos sus datos?")) return;
    await deleteDoc(doc(db, "scheduling_projects", id));
  }

  const inpStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: font, outline: "none", marginBottom: 10 };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Proyectos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Cada proyecto contiene su propio planning (paradas) y scheduling (asignación VRP).
          </div>
        </div>
        <button onClick={() => setNewModal({ nombre: "", descripcion: "", mes: new Date().toISOString().slice(0, 7) })} style={{
          padding: "8px 16px", background: C.blue, border: "none", color: "#fff",
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font,
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nuevo proyecto
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.dim }}>Cargando…</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: 80, color: C.dim }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Sin proyectos todavía</div>
          <div style={{ fontSize: 12 }}>Crea tu primer proyecto para empezar.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
          {projects.map(p => {
            const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.nuevo;
            const isActive = activeProject?._id === p._id;
            const dateStr = p.updatedAt?.toDate?.().toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" }) || "—";
            return (
              <div key={p._id} style={{
                background: C.card,
                border: `1px solid ${isActive ? C.blue : C.border}`,
                borderRadius: 12, padding: 20,
                boxShadow: isActive ? `0 0 0 1px ${C.blue}` : "none",
                display: "flex", flexDirection: "column", gap: 14,
                animation: "sched-fadein .15s ease both",
              }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{p.nombre}</span>
                      {isActive && <span style={{ fontSize: 9, background: C.blueDim, color: C.blueText, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>ABIERTO</span>}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim }}>{p.mes} · {dateStr}</div>
                    {p.descripcion && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{p.descripcion}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.color + "22", borderRadius: 5, padding: "3px 8px", border: `1px solid ${st.color}44`, flexShrink: 0 }}>
                    {st.label}
                  </span>
                </div>

                {/* Planning section */}
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Planning</div>
                  {p.planning ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                        {p.planning.tasksCount} paradas
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {(p.planning.uniqueBarrios || []).slice(0, 8).map(b => (
                          <span key={b} style={{ fontSize: 9, background: barrioColor(b) + "28", border: `1px solid ${barrioColor(b)}55`, color: barrioColor(b), borderRadius: 4, padding: "1px 6px" }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin planning — importa desde Planning</div>
                  )}
                </div>

                {/* Scheduling section */}
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Scheduling</div>
                  {p.scheduling ? (
                    <div style={{ display: "flex", gap: 20 }}>
                      {[
                        [p.scheduling.daysUsed || 1, "días"],
                        [p.scheduling.totalStops || 0, "paradas"],
                        [`${(p.scheduling.totalKm || 0).toFixed(0)} km`, ""],
                        [p.scheduling.vehicleSchedule?.length || 0, "vehículos"],
                      ].map(([v, l]) => (
                        <div key={l}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{v}</div>
                          <div style={{ fontSize: 9, color: C.dim }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin schedule — genera el VRP</div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => onOpenProject(p)}
                    style={{
                      flex: 1, padding: "8px 0",
                      background: isActive ? C.blueDim : C.blue,
                      border: `1px solid ${C.blue}`,
                      color: isActive ? C.blueText : "#fff",
                      borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                      transition: "all .12s",
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#3a7de0"; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = C.blue; } }}
                  >{isActive ? "Ya abierto" : "Abrir proyecto"}</button>
                  <button
                    onClick={() => removeProject(p._id)}
                    style={{ width: 34, height: 34, background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New project modal */}
      {newModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={() => setNewModal(null)}>
          <div style={{ background: C.card, borderRadius: 14, padding: "28px 28px 22px", width: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: `1px solid ${C.border}` }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 18 }}>Nuevo proyecto</div>
            <input autoFocus placeholder="Nombre del proyecto *" value={newModal.nombre}
              onChange={e => setNewModal(p => ({ ...p, nombre: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && createProject()}
              style={inpStyle} />
            <input placeholder="Descripción (opcional)" value={newModal.descripcion}
              onChange={e => setNewModal(p => ({ ...p, descripcion: e.target.value }))}
              style={inpStyle} />
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Mes de servicio</label>
              <input type="month" value={newModal.mes}
                onChange={e => setNewModal(p => ({ ...p, mes: e.target.value }))}
                style={{ ...inpStyle, marginBottom: 0, width: "auto", colorScheme: "dark" }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setNewModal(null)} style={{ flex: 1, padding: "9px 0", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancelar</button>
              <button onClick={createProject} disabled={creating || !newModal.nombre.trim()} style={{
                flex: 2, padding: "9px 0", background: C.blue, border: "none", color: "#fff",
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: creating ? "wait" : "pointer",
                fontFamily: font, opacity: !newModal.nombre.trim() ? .5 : 1,
              }}>{creating ? "Creando…" : "Crear proyecto"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SCHEDULING PAGE ───────────────────────────────────────────────
export function SchedulingModuleWrapper({ vehicles, workers, loadingV, loadingW, activeProject, onProjectUpdate }) {
  const [subTab, setSubTab] = useState("vrp");
  const SUB_TABS = [
    { key: "vrp",          label: "VRP / Gantt" },
    { key: "vehiculos",    label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores", label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{
        height: 38, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2,
      }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 12, fontWeight: subTab === t.key ? 600 : 400,
            color: subTab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${subTab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1, transition: "color .12s",
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: subTab === "vrp" ? "flex" : "none", overflow: "hidden" }}>
          <TabPlanificacion
            vehicles={vehicles} workers={workers}
            activeProject={activeProject}
            onProjectUpdate={onProjectUpdate}
          />
        </div>
        {subTab === "vehiculos"    && <TabVehiculos vehicles={vehicles} loading={loadingV} />}
        {subTab === "trabajadores" && <TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} />}
      </div>
    </div>
  );
}

function SchedulingPage({ sesion, onLogout }) {
  const [tab,              setTab]              = useState("proyectos");
  const [vehicles,         setVehicles]         = useState([]);
  const [workers,          setWorkers]          = useState([]);
  const [loadingV,         setLoadingV]         = useState(true);
  const [loadingW,         setLoadingW]         = useState(true);
  const [activeProject,    setActiveProject]    = useState(null);
  const [planningEverOpen, setPlanningEverOpen] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "scheduling_vehicles"), snap => {
      setVehicles(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
      setLoadingV(false);
    }, () => setLoadingV(false));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "scheduling_workers"), snap => {
      setWorkers(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
      setLoadingW(false);
    }, () => setLoadingW(false));
    return () => unsub();
  }, []);

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

  async function handleProjectUpdate(updates) {
    if (!activeProject) return;
    const ref = doc(db, "scheduling_projects", activeProject._id);
    await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
    setActiveProject(prev => ({ ...prev, ...updates }));
  }

  function openProject(p) {
    setActiveProject(p);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function closeProject() {
    setActiveProject(null);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function goToTab(key) {
    if (key === "planning") setPlanningEverOpen(true);
    setTab(key);
  }

  const PROJECT_TABS = [
    { key: "planning",      label: "Planning" },
    { key: "planificacion", label: "Scheduling" },
    { key: "vehiculos",     label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores",  label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];

  const UserAvatar = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion.nombre}</div>
        <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion.rol}</div>
      </div>
      <button onClick={onLogout} title="Cerrar sesión" style={{
        width: 32, height: 32, borderRadius: "50%", background: C.surface2,
        border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
      >{initials}</button>
    </div>
  );

  /* ── PROJECTS LANDING (no active project) ─────────────────────── */
  if (!activeProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
        <div style={{
          height: 52, flexShrink: 0, background: C.card,
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/planning" style={{ fontSize: 11, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, textDecoration: "none", transition: "color .12s" }}
              onMouseEnter={e => e.currentTarget.style.color = C.muted}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}>
              FleetComms
            </a>
            <div style={{ width: 1, height: 16, background: C.border2 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Proyectos</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/planning" style={{
              fontSize: 12, color: C.muted, fontFamily: font, textDecoration: "none",
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.border}`,
              transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 3 9 21"/></svg>
              Planning
            </a>
            {UserAvatar}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <TabProyectos activeProject={null} onOpenProject={openProject} />
        </div>
      </div>
    );
  }

  /* ── PROJECT WORKSPACE (active project) ────────────────────────── */
  const STATUS_COLORS = { nuevo: C.dim, con_planning: C.blue, schedulado: C.green, publicado: "#f59e0b" };
  const STATUS_LABELS = { nuevo: "Nuevo", con_planning: "Con planning", schedulado: "Schedulado", publicado: "Publicado" };

  const IconPlanning = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
  const IconSchedule = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

  function RailBtn({ navKey, icon, label }) {
    const active = tab === navKey;
    return (
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }} className="rail-item">
        <button onClick={() => goToTab(navKey)} title={label} style={{
          width: 44, height: 44, borderRadius: 10,
          background: active ? `${C.blue}22` : "none",
          border: `1px solid ${active ? `${C.blue}55` : "transparent"}`,
          color: active ? C.blue : C.dim,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; } }}
          onMouseLeave={e => { if (!active) { e.currentTarget.style.background = active ? `${C.blue}22` : "none"; e.currentTarget.style.color = active ? C.blue : C.dim; } }}
        >
          {icon}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: font }}>

      {/* ── ICON RAIL (48px) ───────────────────────────────────────── */}
      <div style={{
        width: 56, flexShrink: 0,
        background: C.card, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 10, paddingBottom: 10, gap: 4, zIndex: 20,
      }}>
        {/* Back to projects */}
        <button onClick={closeProject} title="Todos los proyectos" style={{
          width: 44, height: 36, borderRadius: 8, background: "none",
          border: "none", color: C.dim, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", marginBottom: 6,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.dim; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        {/* Project initial */}
        <div title={activeProject.nombre} style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${C.blue}22`, border: `1px solid ${C.blue}44`,
          color: C.blue, fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 8, cursor: "default",
        }}>
          {(activeProject.nombre?.[0] ?? "P").toUpperCase()}
        </div>

        {/* Nav icons */}
        <RailBtn navKey="planning"      icon={IconPlanning} label="Planning"   />
        <RailBtn navKey="planificacion" icon={IconSchedule} label="Scheduling" />

        {/* User at bottom */}
        <div style={{ flex: 1 }} />
        <button onClick={onLogout} title={`${sesion.nombre} — Cerrar sesión`} style={{
          width: 32, height: 32, borderRadius: "50%", background: C.surface2,
          border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >{initials}</button>
      </div>

      {/* ── CONTENT AREA — position:relative so tabs stack with absolute inset ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Planning: always mounted once opened, visibility:hidden preserves
            Leaflet dimensions so tiles render correctly when tab is inactive */}
        {planningEverOpen && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", overflow: "hidden",
            visibility: tab === "planning" ? "visible" : "hidden",
            pointerEvents: tab === "planning" ? "auto" : "none",
          }}>
            <PlanningPage sesion={sesion} onLogout={() => {}} projectId={activeProject._id} embedded />
          </div>
        )}
        {/* Scheduling — standard display toggle, no Leaflet inside */}
        <div style={{
          position: "absolute", inset: 0, display: tab === "planificacion" ? "flex" : "none",
          flexDirection: "column", overflow: "hidden",
        }}>
          <SchedulingModuleWrapper
            vehicles={vehicles} workers={workers} loadingV={loadingV} loadingW={loadingW}
            activeProject={activeProject} onProjectUpdate={handleProjectUpdate}
          />
        </div>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
const USUARIOS_INIT = [
  { id:"1", nombre:"Admin", apellidos:"Sistema", usuario:"admin", password:"admin123", rol:"admin", activo:true },
];

export function LoginScheduling({ onLogin }) {
  const [usuario,  setUsuario]  = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [loading,  setLoading]  = useState(false);

  async function go() {
    if (!usuario || !password) { setErr("Introduce usuario y contraseña."); return; }
    setLoading(true); setErr("");
    let found = null;
    try {
      await new Promise((resolve, reject) => {
        const unsub = onSnapshot(collection(db, "usuarios"), snap => {
          unsub();
          const u = snap.docs.map(d => ({ ...d.data(), _id: d.id }))
            .find(u => u.usuario === usuario && u.password === password && u.activo !== false);
          if (u) found = u;
          resolve();
        }, reject);
      });
    } catch {}
    if (!found) found = USUARIOS_INIT.find(u => u.usuario === usuario && u.password === password);
    if (!found) { setErr("Credenciales incorrectas."); setLoading(false); return; }
    if (found.rol !== "admin") { setErr("Acceso restringido a administradores."); setLoading(false); return; }
    onLogin(found);
    setLoading(false);
  }

  const iStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`, color: C.text,
    padding: "10px 13px", borderRadius: 7, fontSize: 13,
    boxSizing: "border-box", fontFamily: font, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
      <div style={{ width: 360, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 28px", boxShadow: "0 16px 48px rgba(0,0,0,.5)", animation: "sched-fadein .3s ease both" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>FleetComms</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Planning & Scheduling</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Acceso para administradores</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Usuario</label>
          <input value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="usuario" autoComplete="username"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{ ...iStyle, borderColor: usuario ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = usuario ? `${C.blue}44` : C.border}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Contraseña</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{ ...iStyle, borderColor: password ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = password ? `${C.blue}44` : C.border}
          />
        </div>
        {err && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: C.red, borderRadius: 7, padding: "9px 13px", fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {err}
          </div>
        )}
        <button onClick={go} disabled={loading} style={{
          width: "100%", padding: "11px", fontSize: 13, fontWeight: 600,
          background: loading ? C.blueDim : C.blue, border: "none",
          color: loading ? C.blueText : "#fff",
          borderRadius: 8, cursor: loading ? "wait" : "pointer", fontFamily: font, transition: "all .15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#3a7ef5"; }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.blue; }}
        >
          {loading
            ? <><span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(163,196,252,.3)", borderTopColor: C.blueText, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Accediendo…</>
            : "Acceder"
          }
        </button>
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────
export default function SchedulingApp() {
  const [sesion, setSesion] = useState(() => {
    try { const s = localStorage.getItem("fc_session"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  function handleLogin(u)  { setSesion(u); localStorage.setItem("fc_session", JSON.stringify(u)); }
  function handleLogout()  { setSesion(null); localStorage.removeItem("fc_session"); }
  if (!sesion || sesion.rol !== "admin") return <LoginScheduling onLogin={handleLogin} />;
  return <SchedulingPage sesion={sesion} onLogout={handleLogout} />;
}
