import { useState, useRef, useEffect } from "react";
import { db } from "./firebase.js";
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp,
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

function GanttChart({ rows, startMin, endMin, days = 1, mode, allWorkers = [], allVehicles = [] }) {
  const [tooltip,      setTooltip]      = useState(null);
  const [pxPerMin,     setPxPerMin]     = useState(2);
  const [legendOpen,   setLegendOpen]   = useState(false);
  const [selectedDay,  setSelectedDay]  = useState(0);

  // Always show full 24h per day
  const chartW = 1440 * pxPerMin;

  // Hour ticks — density adapts to zoom
  const ticks = [];
  const tickStep = pxPerMin < 0.75 ? 2 : 1;
  for (let h = 0; h <= 24; h += tickStep) {
    ticks.push({ h, x: h * 60 * pxPerMin });
  }

  // Sub-hour ticks
  const subTicks = [];
  const subMin = pxPerMin >= 4 ? 15 : 30;
  for (let m = 0; m < 1440; m += subMin) {
    if (m % 60 === 0) continue;
    subTicks.push({ x: m * pxPerMin, quarter: m % 60 === 15 || m % 60 === 45 });
  }

  // Inactive-hour bands (outside the shift window) within the 24h view
  const inactiveBands = [
    startMin > 0   ? { x: 0,                  w: startMin * pxPerMin }         : null,
    endMin   < 1440 ? { x: endMin * pxPerMin,  w: (1440 - endMin) * pxPerMin } : null,
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
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }}>
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
              <div style={{ position: "relative", width: chartW, flexShrink: 0, background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                {ticks.map(({ h, x }) => (
                  <div key={h} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .5 }} />
                ))}
                {subTicks.map(({ x }, i) => (
                  <div key={i} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .15 }} />
                ))}

                {/* Inactive-hours shading per row */}
                {inactiveBands.map(({ x, w: bw }, i) => (
                  <div key={i} style={{ position: "absolute", left: x, top: 0, width: bw, height: "100%", background: "rgba(0,0,0,0.18)", pointerEvents: "none", zIndex: 1 }} />
                ))}

              {(row.assignments || []).filter(task => {
                  const dayOffset = selectedDay * 1440;
                  return task._start >= dayOffset && task._start < dayOffset + 1440;
                }).map((task, ti) => {
                  const left = (task._start - selectedDay * 1440) * pxPerMin;
                  const dur  = task.duracion || 15;
                  const w    = Math.max(dur * pxPerMin - 2, 3);
                  if (left < 0 || left > chartW) return null;

                  // Break block
                  if (task._break) return (
                    <div key={`b${ti}`} title={`Pausa · ${dur} min`} style={{
                      position: "absolute", left, top: ROW_H * 0.3, width: w, height: ROW_H * 0.4,
                      background: "repeating-linear-gradient(45deg,rgba(251,146,60,0.15) 0,rgba(251,146,60,0.15) 4px,transparent 4px,transparent 8px)",
                      border: "1px dashed rgba(251,146,60,0.4)", borderRadius: 3,
                    }} />
                  );

                  // Travel block
                  if (task._travel) return (
                    <div key={`tr${ti}`}
                      title={`Km en vacío: ${task.km?.toFixed(2)} km · ${dur} min`}
                      style={{ position: "absolute", left, top: ROW_H * 0.43, width: Math.max(w, 3), height: ROW_H * 0.14, background: "rgba(139,149,165,0.3)", borderRadius: 2, display: "flex", alignItems: "center", overflow: "hidden" }}
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
                  return (
                    <div key={ti} className="sched-block"
                      onMouseEnter={e => setTooltip({ task, row, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        position: "absolute", left, top: 5, height: ROW_H - 10, width: w,
                        background: color + "d0",
                        border: `1px solid ${color}`,
                        borderRadius: 4, overflow: "hidden", cursor: "default",
                        display: "flex", alignItems: "center", gap: 3, padding: "0 4px",
                      }}
                    >
                      {w >= 14 && (
                        <>
                          {/* Barrio color stripe on left edge */}
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

        {/* Tooltip */}
        {tooltip && (
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
            {/* Linked worker (vehicle mode) or linked vehicle (worker mode) */}
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
function TabVehiculos({ vehicles, loading }) {
  const empty = { nombre: "", matricula: "", tipo: "Camión lateral", capacidad: "", turno: "Jornada completa" };
  const [form, setForm] = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    await addDoc(collection(db, "scheduling_vehicles"), {
      nombre: form.nombre.trim(),
      matricula: form.matricula.trim(),
      tipo: form.tipo,
      turno: form.turno,
      capacidad: parseInt(form.capacidad) || 0,
      activo: true,
      createdAt: serverTimestamp(),
    });
    setForm(empty);
    setAdding(false);
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este vehículo?")) return;
    await deleteDoc(doc(db, "scheduling_vehicles", id));
  }

  const inp = (key, placeholder, type = "text") => (
    <input
      type={type} placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}
    />
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Vehículos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{vehicles.length} registrado{vehicles.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => setAdding(!adding)} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>
          {adding ? "Cancelar" : "+ Añadir vehículo"}
        </button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {inp("nombre", "Nombre (p.ej. Vehículo 01)")}
            {inp("matricula", "Matrícula")}
            {inp("capacidad", "Capacidad (m³)", "number")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}
              style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}>
              {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })}
              style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer", fontFamily: font,
              opacity: !form.nombre.trim() ? .5 : 1, transition: "opacity .12s",
            }}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : vehicles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>
          No hay vehículos. Añade uno para empezar.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {vehicles.map(v => (
            <div key={v._id} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 9,
              padding: "11px 16px", display: "flex", alignItems: "center", gap: 14,
              animation: "sched-fadein .15s ease both",
            }}>
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
              <button onClick={() => remove(v._id)} style={{
                background: "none", border: `1px solid ${C.border}`, color: C.dim,
                width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WORKERS TAB ───────────────────────────────────────────────────
function TabTrabajadores({ workers, vehicles, loading }) {
  const empty = { nombre: "", apellidos: "", turno: "Mañana (06-14)", rol: "conductor", vehiculoId: "" };
  const [form, setForm] = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    await addDoc(collection(db, "scheduling_workers"), {
      nombre: form.nombre.trim(),
      apellidos: form.apellidos.trim(),
      turno: form.turno,
      rol: form.rol,
      vehiculoId: form.vehiculoId || "",
      activo: true,
      createdAt: serverTimestamp(),
    });
    setForm(empty);
    setAdding(false);
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este trabajador?")) return;
    await deleteDoc(doc(db, "scheduling_workers", id));
  }

  const inp = (key, placeholder) => (
    <input
      type="text" placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}
    />
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Trabajadores</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{workers.length} registrado{workers.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => setAdding(!adding)} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>
          {adding ? "Cancelar" : "+ Añadir trabajador"}
        </button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {inp("nombre", "Nombre")}
            {inp("apellidos", "Apellidos")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })}
              style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}>
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
            <select value={form.vehiculoId} onChange={e => setForm({ ...form, vehiculoId: e.target.value })}
              style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: form.vehiculoId ? C.text : C.dim, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" }}>
              <option value="">Sin vehículo asignado</option>
              {(vehicles || []).map(v => <option key={v._id} value={v._id}>{v.nombre || v.matricula} {v.matricula && v.nombre ? `(${v.matricula})` : ""}</option>)}
            </select>
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : workers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>
          No hay trabajadores. Añade uno para empezar.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workers.map(w => (
            <div key={w._id} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 9,
              padding: "11px 16px", display: "flex", alignItems: "center", gap: 14,
              animation: "sched-fadein .15s ease both",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.green, flexShrink: 0, fontWeight: 700 }}>
                {w.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{w.nombre} {w.apellidos}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>{w.turno}</span>
                  <span style={{ color: w.rol === "supervisor" ? C.amber : C.dim }}>{w.rol}</span>
                  {w.vehiculoId && (() => {
                    const v = (vehicles || []).find(v => v._id === w.vehiculoId);
                    return v ? <span style={{ color: C.blue, background: C.blueDim, borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>🚛 {v.nombre || v.matricula}</span> : null;
                  })()}
                </div>
              </div>
              <button onClick={() => remove(w._id)} style={{
                background: "none", border: `1px solid ${C.border}`, color: C.dim,
                width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PLANIFICACION TAB ─────────────────────────────────────────────
function TabPlanificacion({ vehicles, workers }) {
  const [tasks,       setTasks]       = useState([]);
  const [importing,   setImporting]   = useState(false);
  const [imported,    setImported]    = useState(false);
  const [mode,        setMode]        = useState("vehicles");
  const [showC,       setShowC]       = useState(false);
  const [constraints, setConstraints] = useState({
    maxShiftMin: 0,    // 0 = sin límite (el turno ya define la ventana)
    maxStops:    0,
    breakAfter:  240,
    breakDur:    30,
    startMin:    360,
    endMin:      1320,
    days:        1,
  });
  // Separate scenario per mode — switching tabs preserves each scenario
  const [schedules,   setSchedules]   = useState({ vehicles: null, workers: null });
  const [unassigneds, setUnassigneds] = useState({ vehicles: [], workers: [] });
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState(null);
  const [publishModal, setPublishModal] = useState(null); // null | { tipo, mes }
  const [publishing,   setPublishing]   = useState(false);

  const schedule   = schedules[mode];
  const unassigned = unassigneds[mode];

  function importFromPlanning() {
    setImporting(true);
    const unsub = onSnapshot(collection(db, "planning_timetable"), snap => {
      unsub();
      const all = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      setTasks(all);
      setImported(true);
      setImporting(false);
    }, () => setImporting(false));
  }

  useEffect(() => { importFromPlanning(); }, []);

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
      }));

      // ── Step 2: Worker schedule ──────────────────────────────────
      // Linked workers: copy their vehicle's route exactly (same km, same timing).
      //   vehiculoId on the worker must equal the vehicle's _id.
      // Unlinked workers: independent VRP over ALL tasks
      //   (they have no vehicle so they need a full independent route).
      const linkedWorkerIds = new Set();

      const linkedWorkerRows = vehicleSchedule
        .map((vRow, i) => {
          const v = vehicles[i];
          const w = workers.find(wr => wr.vehiculoId === (v._id || v.id));
          if (!w) return null;
          linkedWorkerIds.add(w._id || w.id);
          return { ...w, assignments: [...vRow.assignments], totalKm: vRow.totalKm };
        })
        .filter(Boolean);

      const unlinkedWorkers = workers.filter(w => !linkedWorkerIds.has(w._id || w.id));
      let unlinkedWorkerRows = [];
      let workerUnassigned   = vr.unassigned;

      if (unlinkedWorkers.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        const wr = await generateScenario(tasks, unlinkedWorkers, constraints);
        unlinkedWorkerRows = unlinkedWorkers.map((w, i) => ({
          ...w,
          assignments: wr.schedule[i]?.assignments || [],
          totalKm:     wr.schedule[i]?.totalKm     || 0,
        }));
        workerUnassigned = wr.unassigned;
      }

      setSchedules({
        vehicles: vehicleSchedule,
        workers:  [...linkedWorkerRows, ...unlinkedWorkerRows],
      });
      setUnassigneds({ vehicles: vr.unassigned, workers: workerUnassigned });
      setConstraints(prev => ({ ...prev, days: vr.daysUsed }));

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
    try {
      for (const row of vehicleSchedule) {
        const stops = row.assignments.filter(a => !a._break && !a._travel);
        if (stops.length === 0) continue;
        const ubicaciones = stops.map((a, i) => taskToUbicacion(a, i));
        // Firestore doesn't support nested arrays — store as objects
        const recorrido = stops
          .filter(a => hasCoords(a.lat, a.lng))
          .map(a => ({ lat: +a.lat, lng: +a.lng }));
        const vehicleLabel = row.nombre || row.matricula || "Vehículo";
        await addDoc(collection(db, "planes"), {
          tipo,
          nombre: `${vehicleLabel} · ${mes}`,
          archivo: "vrp-generado",
          turno: row.turno || "",
          mes,
          diaServicio: "",
          ubicaciones,
          recorrido,
          fechaSubida: Date.now(),
          origenVRP: true,
        });
      }
      setPublishModal(null);
    } catch (e) {
      console.error("publishToRoutes error:", e);
      alert("Error al publicar: " + (e.message || e));
    }
    setPublishing(false);
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
          padding: "7px 13px", background: importing ? C.surface2 : imported ? C.greenDim : C.surface2,
          border: `1px solid ${imported ? C.green + "44" : C.border}`,
          color: imported ? C.green : C.muted,
          borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: importing ? "wait" : "pointer",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 7,
        }}>
          {importing
            ? <><span style={{ display: "inline-block", width: 11, height: 11, border: "2px solid rgba(52,211,153,.2)", borderTopColor: C.green, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Importando…</>
            : imported
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
      {imported && vehicles.length === 0 && workers.length === 0 && (
        <div style={{ padding: "8px 20px", background: "rgba(251,146,60,0.08)", borderBottom: `1px solid rgba(251,146,60,0.2)`, fontSize: 12, color: C.orange, flexShrink: 0 }}>
          No hay vehículos ni trabajadores registrados. Añade recursos en las pestañas correspondientes.
        </div>
      )}

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
            {schedules.vehicles && (
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
            )}
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
          {!imported
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

// ── SCHEDULING PAGE ───────────────────────────────────────────────
function SchedulingPage({ sesion, onLogout }) {
  const [tab,      setTab]      = useState("planificacion");
  const [vehicles, setVehicles] = useState([]);
  const [workers,  setWorkers]  = useState([]);
  const [loadingV, setLoadingV] = useState(true);
  const [loadingW, setLoadingW] = useState(true);

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

  const TABS = [
    { key: "planificacion", label: "Planificación" },
    { key: "vehiculos",     label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores",  label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
      {/* Header */}
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
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Scheduling</div>
        </div>
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
      </div>

      {/* Tab bar */}
      <div style={{
        height: 40, flexShrink: 0, background: C.card,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2, zIndex: 5,
      }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1, transition: "color .12s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Body — TabPlanificacion stays mounted to preserve scenario state */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: tab === "planificacion" ? "flex" : "none", overflow: "hidden" }}>
          <TabPlanificacion vehicles={vehicles} workers={workers} />
        </div>
        {tab === "vehiculos"    && <TabVehiculos vehicles={vehicles} loading={loadingV} />}
        {tab === "trabajadores" && <TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} />}
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
const USUARIOS_INIT = [
  { id:"1", nombre:"Admin", apellidos:"Sistema", usuario:"admin", password:"admin123", rol:"admin", activo:true },
];

function LoginScheduling({ onLogin }) {
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
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Scheduling</div>
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
    try { const s = localStorage.getItem("fc_scheduling_session"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  function handleLogin(u)  { setSesion(u); localStorage.setItem("fc_scheduling_session", JSON.stringify(u)); }
  function handleLogout()  { setSesion(null); localStorage.removeItem("fc_scheduling_session"); }
  if (!sesion || sesion.rol !== "admin") return <LoginScheduling onLogin={handleLogin} />;
  return <SchedulingPage sesion={sesion} onLogout={handleLogout} />;
}
