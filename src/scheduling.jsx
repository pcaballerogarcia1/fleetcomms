import { useState, useRef, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { db, auth, secondaryAuth, secondaryDb } from "./firebase.js";
import { useRostering, workerCodeOnDay, isUnavailable, SHIFT_META } from "./rostering.jsx";
import { PlanningPage, idbGet } from "./planning.jsx";
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, where, getDoc, setDoc, getDocs, limit,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg:"#0f1623", card:"#172035", surface2:"#1e2d48",
  border:"rgba(88,130,225,0.22)", border2:"rgba(88,130,225,0.40)",
  blue:"#5c9bff", blueDim:"#0d2550", blueText:"#b0ccff",
  green:"#34d399", greenDim:"#082a18",
  orange:"#fb923c", red:"#f87171", amber:"#fbbf24",
  text:"#e2eeff", muted:"#8aa5cc", dim:"#4a5f82",
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
    @keyframes sched-shimmer{0%,100%{opacity:1}50%{opacity:.6}}
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

// ── IndexedDB: persist full VRP schedule across page reloads ─────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("vrp_cache", 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore("schedules");
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  });
}
async function idbSave(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("schedules", "readwrite");
      tx.objectStore("schedules").put(value, key);
      tx.oncomplete = () => res();
      tx.onerror    = e => rej(e);
    });
  } catch { /* non-critical */ }
}
async function idbLoad(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const tx  = db.transaction("schedules", "readonly");
      const req = tx.objectStore("schedules").get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror   = e => rej(e);
    });
  } catch { return null; }
}

// ── VRP ALGORITHM HELPERS ─────────────────────────────────────────
const TRAVEL_SPEED_KMH = 30;

// Fast squared euclidean distance (no sqrt, no trig) — sufficient for clustering comparisons
function distSq(a, b) {
  const dlat = a.lat - b.lat, dlng = a.lng - b.lng;
  return dlat * dlat + dlng * dlng;
}

// Farthest-point sampling: deterministic k-means seed (no randomness)
function fpsSeed(pts, k) {
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
  }
  return seeds;
}

// K-means geographic clustering (deterministic, uses fast squared distance)
function kMeansCluster(pts, k, maxIter = 20) {
  if (k <= 1 || !pts.length) return new Array(pts.length).fill(0);
  if (k >= pts.length) return pts.map((_, i) => i);
  const seeds = fpsSeed(pts, k);
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
  }
  return Array.from(asgn);
}

// Nearest-neighbor TSP — optionally start from a depot point
function nnTSP(stops, depotPt = null) {
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
function stripSort(stops, strips = 30) {
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

// ── OSRM ROAD ENRICHMENT ──────────────────────────────────────────
// After VRP generation (which uses fast Haversine), replace travel block km
// with real road distances from OSRM. Time layout stays unchanged.
async function enrichWithOSRM(schedule) {
  // Skip OSRM entirely when routes are too large — the URL would exceed 100KB,
  // causing fetch to hang regardless of the timeout signal in some environments.
  const OSRM_MAX_STOPS = 80;
  const maxStopsAny = Math.max(0, ...schedule.map(row =>
    row.assignments.filter(a => !a._travel && !a._break).length
  ));
  if (maxStopsAny > OSRM_MAX_STOPS) return schedule;

  return Promise.all(schedule.map(async (row) => {
    const depot = (row.depotLat && row.depotLng)
      ? { lat: +row.depotLat, lng: +row.depotLng } : null;

    // Build ordered waypoints: [depot?] + stops + [depot?]
    const waypoints = []; // {lng, lat, assignmentIdx | null}
    if (depot) waypoints.push({ lng: depot.lng, lat: depot.lat, idx: null, isDepot: true });
    row.assignments.forEach((a, i) => {
      if (!a._travel && !a._break && hasCoords(a.lat, a.lng))
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

// ── SCENARIO GENERATION ───────────────────────────────────────────
// Phase 1 — k-means geographic clustering (one compact zone per resource)
// Phase 2 — nearest-neighbor TSP + 2-opt per zone (minimize route km)
// Phase 3 — sequential time layout with travel blocks and shift constraints
const MAX_AUTO_DAYS = 365; // safety cap for auto-day expansion

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
      const asgn = kMeansCluster(withCoords, k);
      const rawClusters = Array.from({ length: k }, () => []);
      withCoords.forEach((t, i) => rawClusters[asgn[i]].push(t));

      // Rebalance: fix both empty clusters AND severely undersized ones.
      // k-means can produce a cluster with only 70 tasks out of 44 000 when
      // data has fewer natural groups than k. We bring every cluster up to at
      // least 50 % of the average size by stealing from the largest cluster.
      const avgSize = Math.floor(withCoords.length / k);
      const minSize = Math.max(1, Math.floor(avgSize * 0.5));
      let rebalChanged = true;
      while (rebalChanged) {
        rebalChanged = false;
        for (let ci = 0; ci < k; ci++) {
          if (rawClusters[ci].length >= minSize) continue;      // big enough
          let maxCi = 0;
          for (let cj = 1; cj < k; cj++) {
            if (rawClusters[cj].length > rawClusters[maxCi].length) maxCi = cj;
          }
          const donor = rawClusters[maxCi];
          if (donor.length > minSize) {                          // donor has surplus
            const take = Math.min(minSize - rawClusters[ci].length,
                                  Math.floor(donor.length / 2));
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

      // DEBUG — remove after diagnosis
      console.group("[VRP] Cluster assignment");
      for (let pos = 0; pos < k; pos++) {
        const ri = resOrder[pos];
        const ci = clusterOrder[pos];
        console.log(`  pos=${pos}  vehicle="${resources[ri].nombre||resources[ri].matricula||ri}"  cluster=${ci}  tasks=${clusterQueues[ri].length}  centroid=(${centroids[ci].lat.toFixed(4)},${centroids[ci].lng.toFixed(4)})`);
      }
      console.groupEnd();
    }
  }
  noCoords.forEach((t, i) => clusterQueues[resOrder[i % k]].push(t));

  // Sort each cluster once (strip-sort for large, TSP+2-opt for small)
  const sortedQueues = clusterQueues.map((cluster, i) => {
    const depot = (resources[i]?.depotLat && resources[i]?.depotLng)
      ? { lat: +resources[i].depotLat, lng: +resources[i].depotLng } : null;
    const withC = cluster.filter(t => hasCoords(t.lat, t.lng));
    const noC   = cluster.filter(t => !hasCoords(t.lat, t.lng));
    const ordered = withC.length > 1500 ? stripSort(withC) : twoOpt(nnTSP(withC, depot));
    return [...ordered, ...noC];
  });

  // Pointer into each queue — advances as tasks are assigned (never reset between days)
  const queueIdx  = new Int32Array(k);
  // Per-resource counter of stops assigned today (reset each day, for maxStops)
  const dayStops  = new Int32Array(k);

  let day = 0;
  let anyAssignedThisDay = true;

  while (anyAssignedThisDay && day < MAX_AUTO_DAYS) {
    anyAssignedThisDay = false;
    const dayOffset = day * 1440;
    dayStops.fill(0);

    for (let i = 0; i < k; i++) {
      const res   = state[i];
      const queue = sortedQueues[i];
      if (queueIdx[i] >= queue.length) continue; // all tasks for this resource done

      const depot = (res.depotLat && res.depotLng)
        ? { lat: +res.depotLat, lng: +res.depotLng } : null;
      let cursor     = res.shiftStart + dayOffset;
      const dayEnd   = res.shiftEnd   + dayOffset;
      let sinceBreak = 0;
      let lastLat    = depot ? depot.lat : null;
      let lastLng    = depot ? depot.lng : null;
      let fromDepot  = !!depot;

      // If the head-of-queue task is infeasible for this vehicle today (e.g. too far from
      // depot for retBuffer), scan ahead up to 15 tasks and swap the first feasible one
      // to the front so the vehicle isn't permanently blocked on an outlier.
      if (queueIdx[i] < queue.length) {
        const LOOK = Math.min(15, queue.length - queueIdx[i]);
        let swapTo = -1;
        for (let li = 0; li < LOOK && swapTo === -1; li++) {
          const t = queue[queueIdx[i] + li];
          const tdur = t.duracion || 15;
          let ttMin = 0;
          if (hasCoords(lastLat, lastLng) && hasCoords(t.lat, t.lng)) {
            const tkm = haversineKm(lastLat, lastLng, t.lat, t.lng);
            if (tkm >= 0.05) ttMin = Math.max(1, Math.ceil(tkm / TRAVEL_SPEED_KMH * 60));
          }
          let tRet = 0;
          if (depot && hasCoords(t.lat, t.lng)) {
            const rkm = haversineKm(+t.lat, +t.lng, depot.lat, depot.lng);
            if (rkm >= 0.05) tRet = Math.max(1, Math.ceil(rkm / TRAVEL_SPEED_KMH * 60));
          }
          if (cursor + ttMin + tdur + tRet <= dayEnd) swapTo = li;
        }
        if (swapTo > 0) {
          const [best] = queue.splice(queueIdx[i] + swapTo, 1);
          queue.splice(queueIdx[i], 0, best);
        }
      }

      while (queueIdx[i] < queue.length) {
        const task = queue[queueIdx[i]];
        const dur  = task.duracion || 15;

        if (maxStops > 0 && dayStops[i] >= maxStops) break;

        if (breakAfter > 0 && breakDur > 0 && sinceBreak >= breakAfter && cursor + breakDur <= dayEnd) {
          res.assignments.push({ _break: true, _start: cursor, _end: cursor + breakDur, duracion: breakDur });
          cursor += breakDur; sinceBreak = 0;
        }

        let travelMin = 0, travelKm = 0;
        if (hasCoords(lastLat, lastLng) && hasCoords(task.lat, task.lng)) {
          travelKm = haversineKm(lastLat, lastLng, task.lat, task.lng);
          if (travelKm >= 0.05) travelMin = Math.max(1, Math.ceil(travelKm / TRAVEL_SPEED_KMH * 60));
        }

        let retBuffer = 0;
        if (depot) {
          const refLat = hasCoords(task.lat, task.lng) ? +task.lat : lastLat;
          const refLng = hasCoords(task.lat, task.lng) ? +task.lng : lastLng;
          if (hasCoords(refLat, refLng)) {
            const retKmEst = haversineKm(refLat, refLng, depot.lat, depot.lng);
            if (retKmEst >= 0.05) retBuffer = Math.max(1, Math.ceil(retKmEst / TRAVEL_SPEED_KMH * 60));
          }
        }

        const workSoFar = cursor - (res.shiftStart + dayOffset);
        if (maxShiftMin > 0 && workSoFar + travelMin + dur + retBuffer > maxShiftMin) break;
        if (cursor + travelMin + dur + retBuffer > dayEnd) break;

        if (travelMin > 0) {
          const block = { _travel: true, _start: cursor, _end: cursor + travelMin, duracion: travelMin, km: +travelKm.toFixed(3) };
          if (fromDepot) block._depot_exit = true;
          res.assignments.push(block);
          cursor += travelMin; res.totalKm += travelKm;
        }
        fromDepot = false;
        res.assignments.push({ ...task, _start: cursor, _end: cursor + dur });
        cursor += dur; sinceBreak += dur;
        if (hasCoords(task.lat, task.lng)) { lastLat = +task.lat; lastLng = +task.lng; }
        queueIdx[i]++;
        dayStops[i]++;
        anyAssignedThisDay = true;
      }

      // Return to depot
      if (depot && hasCoords(lastLat, lastLng) && (lastLat !== depot.lat || lastLng !== depot.lng)) {
        const retKm = haversineKm(lastLat, lastLng, depot.lat, depot.lng);
        if (retKm >= 0.05) {
          const retMin = Math.max(1, Math.ceil(retKm / TRAVEL_SPEED_KMH * 60));
          res.assignments.push({
            _travel: true, _depot_return: true,
            _start: cursor, _end: cursor + retMin,
            duracion: retMin, km: +retKm.toFixed(3),
          });
          res.totalKm += retKm;
        }
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
    if (state[i].assignments.length > 0) continue;          // already has work
    if (queueIdx[i] >= sortedQueues[i].length) continue;    // queue exhausted

    const res    = state[i];
    const eDepot = (res.depotLat && res.depotLng)
      ? { lat: +res.depotLat, lng: +res.depotLng } : null;

    for (let bDay = 0; bDay < day; bDay++) {
      const dOff   = bDay * 1440;
      let   cur    = res.shiftStart + dOff;
      const dEnd   = res.shiftEnd   + dOff;
      if (cur >= dEnd) continue;

      let lLat    = eDepot ? eDepot.lat : null;
      let lLng    = eDepot ? eDepot.lng : null;
      let fromDep = !!eDepot;
      let sinceB  = 0;

      let pi = 0;
      while (pi < sortedQueues[i].length) {
        const task = sortedQueues[i][pi];
        const dur  = task.duracion || 15;

        if (breakAfter > 0 && breakDur > 0 && sinceB >= breakAfter && cur + breakDur <= dEnd) {
          res.assignments.push({ _break: true, _start: cur, _end: cur + breakDur, duracion: breakDur });
          cur += breakDur; sinceB = 0;
        }

        let tMin = 0, tKm = 0;
        if (hasCoords(lLat, lLng) && hasCoords(task.lat, task.lng)) {
          tKm = haversineKm(lLat, lLng, task.lat, task.lng);
          if (tKm >= 0.05) tMin = Math.max(1, Math.ceil(tKm / TRAVEL_SPEED_KMH * 60));
        }

        if (cur + tMin + dur > dEnd) { pi++; continue; }

        if (tMin > 0) {
          const blk = { _travel: true, _start: cur, _end: cur + tMin, duracion: tMin, km: +tKm.toFixed(3) };
          if (fromDep) blk._depot_exit = true;
          res.assignments.push(blk);
          cur += tMin; res.totalKm += tKm;
        }
        fromDep = false;
        res.assignments.push({ ...task, _start: cur, _end: cur + dur });
        cur += dur; sinceB += dur;
        if (hasCoords(task.lat, task.lng)) { lLat = +task.lat; lLng = +task.lng; }
        sortedQueues[i].splice(pi, 1); // remove assigned task; pi stays (next shifts down)
      }

      if (eDepot && hasCoords(lLat, lLng) && (lLat !== eDepot.lat || lLng !== eDepot.lng)) {
        const rKm = haversineKm(lLat, lLng, eDepot.lat, eDepot.lng);
        if (rKm >= 0.05) {
          const rMin = Math.max(1, Math.ceil(rKm / TRAVEL_SPEED_KMH * 60));
          res.assignments.push({ _travel: true, _depot_return: true, _start: cur, _end: cur + rMin, duracion: rMin, km: +rKm.toFixed(3) });
          res.totalKm += rKm;
        }
      }
    }
  }

  // DEBUG — remove after diagnosis
  console.group("[VRP] After main loop + backfill");
  for (let i = 0; i < k; i++) {
    const stops = state[i].assignments.filter(a => !a._travel && !a._break).length;
    console.log(`  vehicle="${state[i].nombre||state[i].matricula||i}"  assignments=${state[i].assignments.length}  stops=${stops}  queueRemaining=${sortedQueues[i].length - queueIdx[i]}`);
  }
  console.groupEnd();

  // Collect remaining unassigned tasks (queueIdx[i]=0 for backfilled vehicles, remaining tasks in sortedQueues[i])
  const leftover = [];
  for (let i = 0; i < k; i++) {
    for (let j = queueIdx[i]; j < sortedQueues[i].length; j++) leftover.push(sortedQueues[i][j]);
  }

  // ── Mop-up pass: redistribute leftover tasks across ALL vehicles ──
  // Each vehicle scans the entire remaining pool and assigns what fits,
  // skipping tasks that don't fit (instead of breaking). This prevents
  // one outlier task from blocking all subsequent assignable tasks.
  if (leftover.length > 0) {
    const pool   = leftover.slice(); // mutable; tasks removed when assigned
    let mopDay   = day;
    let anyMop   = true;

    while (pool.length > 0 && anyMop && mopDay < MAX_AUTO_DAYS) {
      anyMop = false;
      const dayOffset = mopDay * 1440;

      for (let i = 0; i < k && pool.length > 0; i++) {
        const res   = state[i];
        const depot = (res.depotLat && res.depotLng)
          ? { lat: +res.depotLat, lng: +res.depotLng } : null;
        let cursor     = res.shiftStart + dayOffset;
        const dayEnd   = res.shiftEnd   + dayOffset;
        let sinceBreak = 0;
        let lastLat    = depot ? depot.lat : null;
        let lastLng    = depot ? depot.lng : null;
        let fromDepot  = !!depot;

        // Scan every remaining pool task; assign what fits, skip what doesn't.
        // No retBuffer check here — depot return is appended after the loop and
        // may slightly overshoot dayEnd, which is acceptable for the mop-up.
        let pi = 0;
        while (pi < pool.length) {
          const task = pool[pi];
          const dur  = task.duracion || 15;

          if (breakAfter > 0 && breakDur > 0 && sinceBreak >= breakAfter && cursor + breakDur <= dayEnd) {
            res.assignments.push({ _break: true, _start: cursor, _end: cursor + breakDur, duracion: breakDur });
            cursor += breakDur; sinceBreak = 0;
          }

          let travelMin = 0, travelKm = 0;
          if (hasCoords(lastLat, lastLng) && hasCoords(task.lat, task.lng)) {
            travelKm = haversineKm(lastLat, lastLng, task.lat, task.lng);
            if (travelKm >= 0.05) travelMin = Math.max(1, Math.ceil(travelKm / TRAVEL_SPEED_KMH * 60));
          }

          const workSoFar = cursor - (res.shiftStart + dayOffset);
          const fitsShift   = maxShiftMin <= 0 || workSoFar + travelMin + dur <= maxShiftMin;
          const fitsDay     = cursor + travelMin + dur <= dayEnd;

          if (!fitsShift || !fitsDay) {
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
          res.assignments.push({ ...task, _start: cursor, _end: cursor + dur });
          cursor += dur; sinceBreak += dur;
          if (hasCoords(task.lat, task.lng)) { lastLat = +task.lat; lastLng = +task.lng; }
          pool.splice(pi, 1); // remove from pool; pi now points to next element
          anyMop = true;
        }

        // Return to depot
        if (depot && hasCoords(lastLat, lastLng) && (lastLat !== depot.lat || lastLng !== depot.lng)) {
          const retKm = haversineKm(lastLat, lastLng, depot.lat, depot.lng);
          if (retKm >= 0.05) {
            const retMin = Math.max(1, Math.ceil(retKm / TRAVEL_SPEED_KMH * 60));
            res.assignments.push({ _travel: true, _depot_return: true, _start: cursor, _end: cursor + retMin, duracion: retMin, km: +retKm.toFixed(3) });
            res.totalKm += retKm;
          }
        }
      }

      mopDay++;
    }

    const daysUsed = Math.max(1, mopDay);
    return { schedule: state, unassigned: pool, daysUsed };
  }

  const daysUsed = Math.max(1, day);
  return { schedule: state, unassigned: [], daysUsed };
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
  const [compactDayNav, setCompactDayNav] = useState(() => days > 10);
  const [dragging,     setDragging]     = useState(null); // { task, fromRowId }
  const [dropRowId,    setDropRowId]    = useState(null);
  const [stackPanel,   setStackPanel]   = useState(null); // { task, row }
  const [ganttSort,    setGanttSort]    = useState("default"); // "default" | "salida_asc" | "salida_desc" | "servicio_asc" | "servicio_desc"

  const sortedRows = useMemo(() => {
    if (ganttSort === "default") return rows;
    const type = ganttSort.startsWith("salida") ? "salida" : "servicio";
    const asc  = ganttSort.endsWith("asc");
    const getKey = row => {
      const dayA = (row.assignments || []).filter(a => Math.floor(a._start / 1440) === selectedDay);
      if (type === "salida") {
        const dep = dayA.find(a => a._depot_exit);
        return dep ? dep._start : (dayA.length ? dayA[0]._start : Infinity);
      } else {
        const stop = dayA.find(a => !a._travel && !a._break);
        return stop ? stop._start : Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const ka = getKey(a), kb = getKey(b);
      if (ka === Infinity && kb === Infinity) return 0;
      if (ka === Infinity) return 1;
      if (kb === Infinity) return -1;
      return asc ? ka - kb : kb - ka;
    });
  }, [rows, ganttSort, selectedDay]);

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

        {/* Sort */}
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }} />
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 2 }}>Ordenar</span>
        {[
          { key: "salida_asc",    label: "Salida ↑" },
          { key: "salida_desc",   label: "Salida ↓" },
          { key: "servicio_asc",  label: "1ª parada ↑" },
          { key: "servicio_desc", label: "1ª parada ↓" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setGanttSort(s => s === key ? "default" : key)} style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
            border: `1px solid ${ganttSort === key ? C.blue : C.border}`,
            background: ganttSort === key ? C.blueDim : "none",
            color: ganttSort === key ? C.blueText : C.dim,
            transition: "all .1s",
          }}>{label}</button>
        ))}

        {/* Day navigation */}
        {days > 1 && <>
          <div style={{ width: 1, height: 16, background: C.border, margin: "0 8px" }} />
          <button onClick={() => setSelectedDay(d => Math.max(0, d - 1))} disabled={selectedDay === 0}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === 0 ? C.dim : C.muted, cursor: selectedDay === 0 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>

          {compactDayNav ? (
            /* Compact: input + total */
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number" min="1" max={days} value={selectedDay + 1}
                onChange={e => { const v = parseInt(e.target.value, 10) - 1; if (v >= 0 && v < days) setSelectedDay(v); }}
                style={{
                  width: 48, background: C.card, border: `1px solid ${C.green}55`,
                  color: C.green, borderRadius: 5, padding: "1px 6px",
                  fontSize: 11, fontFamily: mono, fontWeight: 700,
                  textAlign: "center", outline: "none",
                }}
              />
              <span style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>/ {days}</span>
            </div>
          ) : (
            /* Expanded: all day pills */
            Array.from({ length: days }, (_, d) => (
              <button key={d} onClick={() => setSelectedDay(d)} style={{
                padding: "2px 10px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
                border: `1px solid ${selectedDay === d ? C.green : C.border}`,
                background: selectedDay === d ? C.greenDim : "none",
                color: selectedDay === d ? C.green : C.dim,
                fontWeight: selectedDay === d ? 700 : 400,
                transition: "all .1s",
              }}>Día {d + 1}</button>
            ))
          )}

          <button onClick={() => setSelectedDay(d => Math.min(days - 1, d + 1))} disabled={selectedDay === days - 1}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === days - 1 ? C.dim : C.muted, cursor: selectedDay === days - 1 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>

          {/* Toggle compact/expanded */}
          <button
            onClick={() => setCompactDayNav(v => !v)}
            title={compactDayNav ? "Mostrar todos los días" : "Ocultar días"}
            style={{
              width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`,
              background: "none", color: C.dim, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              {compactDayNav
                ? <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>
              }
            </svg>
          </button>
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
          {sortedRows.map((row, ri) => (
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
                  const dayAssignments = (row.assignments || []).filter(a => Math.floor(a._start / 1440) === selectedDay);
                  const stopCount = dayAssignments.filter(a => !a._break && !a._travel).length;
                  const dayKm = dayAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);

                  // Actual shift times from real assignments
                  const hasWork = dayAssignments.length > 0;
                  const actStart = hasWork ? Math.min(...dayAssignments.map(a => a._start)) : null;
                  const actEnd   = hasWork ? Math.max(...dayAssignments.map(a => a._end))   : null;
                  const durMin   = hasWork ? actEnd - actStart : 0;
                  const durH     = Math.floor(durMin / 60);
                  const durM     = durMin % 60;
                  const durLabel = durMin > 0
                    ? `${durH}h${durM > 0 ? String(durM).padStart(2, "0") : ""}`
                    : null;

                  // Fallback: theoretical turno window
                  const tw = row.turno ? turnoWindow(row.turno, startMin, endMin) : null;
                  const timeLabel = hasWork
                    ? `${minToTime(actStart % 1440)}–${minToTime(actEnd % 1440)}`
                    : tw
                      ? `${String(Math.floor(tw.start / 60)).padStart(2,"0")}–${String(Math.floor((tw.end % 1440) / 60)).padStart(2,"0")}h`
                      : (row.matricula || "");

                  return (
                    <>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.blueText }}>
                        {letter}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Nombre + hora en la misma línea */}
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5, overflow: "hidden" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0 }}>
                            {fullName}
                          </span>
                          <span style={{ fontSize: 10, color: C.blueText, fontFamily: mono, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {timeLabel}
                          </span>
                        </div>
                        {/* Stats en línea propia — no hay overflow */}
                        <div style={{ fontSize: 10, fontFamily: mono, display: "flex", gap: 5, alignItems: "center", marginTop: 2 }}>
                          {durLabel && <span style={{ color: "#34d399", fontWeight: 700, whiteSpace: "nowrap" }}>{durLabel}</span>}
                          {stopCount > 0 && <span style={{ color: C.muted, whiteSpace: "nowrap" }}>{stopCount}p</span>}
                          {dayKm > 0 && <span style={{ color: "#fb923c", fontWeight: 700, whiteSpace: "nowrap" }}>{dayKm.toFixed(1)}km</span>}
                          {row.depotLat && row.depotLng && <span title={`Depot: ${(+row.depotLat).toFixed(4)}, ${(+row.depotLng).toFixed(4)}`} style={{ flexShrink: 0 }}>🏠</span>}
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

                {/* Inactive-hours shading per row */}
                {(() => {
                  const rs = row._tw?.start ?? row.shiftStart ?? minShiftStart;
                  const re = row._tw?.end   ?? row.shiftEnd   ?? (hasNightShift ? maxShiftEnd : endMin);
                  // re may exceed 1440 for night shifts (22-06 → end=1800); cap display at maxShiftEnd
                  const reNorm = Math.min(re, maxShiftEnd);
                  const bands = [
                    rs > 0               ? { x: 0,                 w: rs * pxPerMin }                     : null,
                    reNorm < maxShiftEnd ? { x: reNorm * pxPerMin, w: (maxShiftEnd - reNorm) * pxPerMin } : null,
                  ].filter(Boolean);
                  return bands.map(({ x, w: bw }, i) => (
                    <div key={i} style={{ position: "absolute", left: x, top: 0, width: bw, height: "100%", background: "rgba(0,0,0,0.25)", pointerEvents: "none", zIndex: 1 }} />
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
                  if (task._travel) {
                    const tH = ROW_H * 0.38;
                    const tTop = (ROW_H - tH) / 2;
                    const kmLabel = task.km != null ? `${task.km.toFixed(2)} km` : "";
                    const minLabel = `${dur} min`;
                    const isDepotMove = task._depot_exit || task._depot_return;
                    const depotLabel = task._depot_exit ? "Salida depot" : "Vuelta depot";
                    const bg = isDepotMove
                      ? "repeating-linear-gradient(135deg, #92400e 0px, #92400e 6px, #fb923c99 6px, #fb923c99 12px)"
                      : "repeating-linear-gradient(135deg, #111 0px, #111 6px, #c0000099 6px, #c0000099 12px)";
                    const borderColor = isDepotMove ? "#fb923cbb" : "#c00000bb";
                    return (
                      <div key={`tr${ti}`}
                        title={isDepotMove ? `${depotLabel}: ${kmLabel} · ${minLabel}` : `Km en vacío: ${kmLabel} · ${minLabel}`}
                        style={{
                          position: "absolute", left, top: tTop,
                          width: Math.max(w, 4), height: tH,
                          background: bg,
                          border: `1px solid ${borderColor}`,
                          borderRadius: 3,
                          display: "flex", alignItems: "center", gap: 3,
                          overflow: "hidden", zIndex: 3, boxSizing: "border-box",
                          paddingLeft: 4,
                        }}
                      >
                        {w > 14 && (
                          isDepotMove ? (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="#fb923c" stroke="none" style={{ flexShrink: 0, filter: "drop-shadow(0 0 2px #000)" }}>
                              <path d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9"/>
                            </svg>
                          ) : (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" style={{ flexShrink: 0, filter: "drop-shadow(0 0 2px #000)" }}>
                              <path d="M5 12h14M13 6l6 6-6 6"/>
                            </svg>
                          )
                        )}
                        {w > 36 && kmLabel && (
                          <span style={{ fontSize: 9, color: "#fff", whiteSpace: "nowrap", fontWeight: 700, fontFamily: "monospace", textShadow: "0 0 4px #000, 0 0 4px #000" }}>
                            {kmLabel}
                          </span>
                        )}
                        {w > 72 && (
                          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap", textShadow: "0 0 3px #000" }}>
                            · {isDepotMove ? depotLabel : minLabel}
                          </span>
                        )}
                      </div>
                    );
                  }

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
export function TabVehiculos({ vehicles, loading, activeProject, orgId }) {
  const empty = { nombre: "", matricula: "", tipo: "Camión lateral", capacidad: "", turno: "Jornada completa", depotLat: "", depotLng: "" };
  const [form,   setForm]   = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [planningDepots, setPlanningDepots] = useState([]);
  const [showDepotPicker, setShowDepotPicker] = useState(null); // vehicleId | "new"

  // Load depots from Firestore planning_depots (migrated from localStorage)
  useEffect(() => {
    if (!activeProject?._id) return;
    const projectId = activeProject._id;
    return onSnapshot(doc(db, "planning_depots", projectId), snap => {
      if (snap.exists()) {
        setPlanningDepots(snap.data().depots ?? []);
      } else {
        // Fallback: legacy localStorage data
        try {
          const raw = localStorage.getItem(`fc_depots_${projectId}`);
          if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
        } catch { /* ignore */ }
      }
    }, () => {
      try {
        const raw = localStorage.getItem(`fc_depots_${activeProject._id}`);
        if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
      } catch { /* ignore */ }
    });
  }, [activeProject?._id]);

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };
  const inpStyle = { ...selStyle };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un vehículo sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "scheduling_vehicles"), {
        nombre: form.nombre.trim(), matricula: form.matricula.trim(),
        tipo: form.tipo, turno: form.turno,
        capacidad: parseInt(form.capacidad) || 0,
        depotLat: form.depotLat ? +form.depotLat : null,
        depotLng: form.depotLng ? +form.depotLng : null,
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create vehicle:", e); alert("Error al crear vehículo: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "scheduling_vehicles", id), {
        nombre: editForm.nombre.trim(), matricula: editForm.matricula.trim(),
        tipo: editForm.tipo, turno: editForm.turno,
        capacidad: parseInt(editForm.capacidad) || 0,
        depotLat: editForm.depotLat ? +editForm.depotLat : null,
        depotLng: editForm.depotLng ? +editForm.depotLng : null,
      });
      setEditId(null);
    } catch (e) { console.error("save vehicle:", e); alert("Error al guardar."); }
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este vehículo?")) return;
    await deleteDoc(doc(db, "scheduling_vehicles", id));
  }

  function startEdit(v) {
    setEditId(v._id);
    setEditForm({ nombre: v.nombre || "", matricula: v.matricula || "", tipo: v.tipo || "Camión lateral", turno: v.turno || "Jornada completa", capacidad: v.capacidad || "", depotLat: v.depotLat ?? "", depotLng: v.depotLng ?? "" });
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

  function DepotPicker({ onPick }) {
    if (planningDepots.length === 0) return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>No hay depots en Planning para este proyecto.</div>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {planningDepots.map(d => (
          <button key={d.id} onClick={() => onPick(d)} style={{
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.text, fontSize: 12, padding: "6px 10px", cursor: "pointer",
            fontFamily: font, textAlign: "left", transition: "border-color .12s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            <span style={{ marginRight: 6 }}>🏠</span>
            <b>{d.nombre}</b>
            <span style={{ color: C.dim, marginLeft: 8, fontSize: 10, fontFamily: mono }}>{(+d.lat).toFixed(5)}, {(+d.lng).toFixed(5)}</span>
          </button>
        ))}
      </div>
    );
  }

  const depotSection = (formObj, setFormObj, pickerKey) => (
    <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: .5 }}>DEPOT (inicio/fin de turno)</span>
        {planningDepots.length > 0 && (
          <button onClick={() => setShowDepotPicker(showDepotPicker === pickerKey ? null : pickerKey)} style={{
            fontSize: 10, padding: "3px 8px", background: "none", border: `1px solid ${C.border}`, borderRadius: 5,
            color: C.blueText, cursor: "pointer", fontFamily: font,
          }}>Importar desde Planning</button>
        )}
      </div>
      {showDepotPicker === pickerKey && (
        <div style={{ marginBottom: 8 }}>
          <DepotPicker onPick={d => { setFormObj({ ...formObj, depotLat: String(d.lat), depotLng: String(d.lng) }); setShowDepotPicker(null); }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" placeholder="Lat (ej: 41.3851)" value={formObj.depotLat ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLat: e.target.value })}
          step="0.00001" style={{ ...inpStyle, flex: 1, minWidth: 0 }} />
        <input type="number" placeholder="Lng (ej: 2.1734)" value={formObj.depotLng ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLng: e.target.value })}
          step="0.00001" style={{ ...inpStyle, flex: 1, minWidth: 0 }} />
        {(formObj.depotLat || formObj.depotLng) && (
          <button onClick={() => setFormObj({ ...formObj, depotLat: "", depotLng: "" })} title="Quitar depot"
            style={{ padding: "0 10px", background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, fontFamily: font }}>
            ×
          </button>
        )}
      </div>
    </div>
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
          {depotSection(form, setForm, "new")}
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
              {depotSection(editForm, setEditForm, v._id)}
            </div>
          ) : (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.blueText, flexShrink: 0 }}>
                {v.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {v.matricula && <span style={{ fontFamily: mono }}>{v.matricula}</span>}
                  <span>{v.tipo}</span>
                  {v.capacidad > 0 && <span>{v.capacidad} m³</span>}
                  {v.turno && <span style={{ color: C.blueText }}>{v.turno}</span>}
                  {v.depotLat && v.depotLng && (
                    <span style={{ color: "#fb923c", display: "flex", alignItems: "center", gap: 3 }}>
                      🏠 {(+v.depotLat).toFixed(4)}, {(+v.depotLng).toFixed(4)}
                    </span>
                  )}
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
export function TabTrabajadores({ workers, vehicles, loading, orgId }) {
  const empty = { nombre: "", apellidos: "", turno: "Mañana (06-14)", rol: "conductor", vehiculoId: "" };
  const [form,     setForm]     = useState(empty);
  const [adding,   setAdding]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un trabajador sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "scheduling_workers"), {
        nombre: form.nombre.trim(), apellidos: form.apellidos.trim(),
        turno: form.turno, rol: form.rol,
        vehiculoId: form.vehiculoId || "",
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create worker:", e); alert("Error al crear trabajador: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "scheduling_workers", id), {
        nombre: editForm.nombre.trim(), apellidos: (editForm.apellidos || "").trim(),
        turno: editForm.turno, rol: editForm.rol,
        vehiculoId: editForm.vehiculoId || "",
      });
      setEditId(null);
    } catch (e) { console.error("save worker:", e); alert("Error al guardar."); }
    setSaving(false);
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

// ── helpers for loading tasks from planning_layers ────────────────
const BARRIO_KEYS_VRP = ["barri","barrio","barri_nom","sector","zona","zone","district",
                         "districte","municipio","area","neighbourhood","neighborhood"];
function extractFieldVRP(fields, keys) {
  for (const [k, v] of Object.entries(fields || {})) {
    if (keys.includes(k.toLowerCase().trim()) && v) return String(v);
  }
  return "";
}
async function loadTasksFromLayers(projectId) {
  const snap = await getDocs(
    query(collection(db, "planning_layers"), where("projectId", "==", projectId))
  );
  const mainDocs  = snap.docs.filter(d => !d.id.match(/_c\d+$/));
  const chunkDocs = snap.docs.filter(d =>  d.id.match(/_c\d+$/));

  const assembled = await Promise.all(mainDocs.map(async d => {
    const layer = { _docId: d.id, ...d.data() };
    if (layer.localOnly) {
      layer.markers = await idbGet(d.id).catch(() => []);
    } else if (layer.chunked) {
      const chunks = chunkDocs
        .filter(c => c.data().layerId === layer.id)
        .sort((a, b) => a.data().chunkIndex - b.data().chunkIndex);
      layer.markers = chunks.flatMap(c => c.data().markers || []);
    }
    return layer;
  }));

  const allTasks = [];
  assembled.forEach(layer => {
    if (!layer.visible) return;
    (layer.markers || []).forEach(m => {
      const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
      if (!isFinite(lat) || !isFinite(lng)) return;
      // IDB markers are flat { lat, lng, Barrio: "X", ... }; Firestore markers nest under .campos/.fields
      const nested = m.campos || m.fields || null;
      const fields = (nested && Object.keys(nested).length > 0) ? nested : m;
      const nombre = extractFieldVRP(fields, ["nombre","name","calle","street"]) || "";
      const barrio = extractFieldVRP(fields, BARRIO_KEYS_VRP) || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      allTasks.push({ _id: puntoKey, lat, lng, nombre, barrio, campos: fields, layerColor: layer.color });
    });
  });

  // Apply default duration from project settings (set in Timetable tab)
  try {
    const settingsSnap = await getDoc(doc(db, "planning_settings", projectId));
    if (settingsSnap.exists()) {
      const defDur = settingsSnap.data().defaultDuracion;
      if (defDur != null && defDur > 0) {
        allTasks.forEach(t => { if (t.duracion == null) t.duracion = defDur; });
      }
    }
  } catch {}

  return allTasks;
}

// ── PLANIFICACION TAB ─────────────────────────────────────────────
export function TabPlanificacion({ vehicles, workers, activeProject, onProjectUpdate, orgId }) {
  const [tasks,        setTasks]       = useState([]);
  const [loadingTasks, setLoadingTasks]= useState(false);

  // Load tasks when project opens (from IDB for large localOnly layers, Firestore for rest)
  useEffect(() => {
    setTasks([]);
    if (!activeProject?._id || !activeProject?.planning?.tasksCount) return;
    setLoadingTasks(true);
    loadTasksFromLayers(activeProject._id)
      .then(t => { setTasks(t); setLoadingTasks(false); })
      .catch(() => setLoadingTasks(false));
  }, [activeProject?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importing,    setImporting]   = useState(false);
  const [mode,         setMode]        = useState("vehicles");
  const [showC,        setShowC]       = useState(false);
  const [constraints,  setConstraints] = useState({
    maxShiftMin: 0, maxStops: 0, breakAfter: 240, breakDur: 30,
    startMin: 360, endMin: 1320, days: 1,
  });
  const [schedules,    setSchedules]   = useState({ vehicles: null, workers: null });
  const [unassigneds,  setUnassigneds] = useState({ vehicles: [], workers: [] });
  const [showDayStrip, setShowDayStrip] = useState(true);
  const [generating,   setGenerating]  = useState(false);
  const [osrmRunning,  setOsrmRunning] = useState(false);
  const [genError,     setGenError]    = useState(null);
  const [genPhase,     setGenPhase]    = useState(null); // "vrp"|"osrm"|"workers"|"saving"
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [focusMode,    setFocusMode]   = useState(false); // hide all panels except gantt
  const [elapsedSec,   setElapsedSec]  = useState(0);
  const genStartRef = useRef(null);

  const GEN_PHASES = {
    vrp:     { label: "Calculando rutas VRP…",            pct: 20 },
    osrm:    { label: "Calculando km reales por carretera…", pct: 55 },
    workers: { label: "Asignando trabajadores…",          pct: 78 },
    saving:  { label: "Guardando resultado…",             pct: 92 },
  };

  // Elapsed-time counter — starts when generating=true, resets when done
  useEffect(() => {
    if (!generating) { setElapsedSec(0); return; }
    genStartRef.current = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - genStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [generating]);

  const [publishModal, setPublishModal] = useState(null);
  const [publishing,   setPublishing]  = useState(false);

  // ── Rostering integration ────────────────────────────────────
  const [schedYear, schedMonth] = (activeProject?.mes ?? "").split("-").map(Number);
  const { grid: rosterGrid } = useRostering(orgId, schedYear || null, schedMonth || null);

  // Compute worker-day conflicts after VRP (L/B days assigned to routes)
  const rosterConflicts = (() => {
    if (!schedules.vehicles || !rosterGrid) return [];
    const conflicts = [];
    for (const row of schedules.vehicles) {
      const linked = workers.filter(w => w.vehiculoId === (row._id || row.id));
      if (!linked.length) continue;
      const byDay = {};
      for (const a of row.assignments) {
        if (a._break || a._travel) continue;
        const d = Math.floor((a._start - constraints.startMin) / 1440) + 1;
        byDay[d] = true;
      }
      for (const w of linked) {
        for (const day of Object.keys(byDay).map(Number)) {
          const code = workerCodeOnDay(rosterGrid, w._id, day);
          if (isUnavailable(code)) {
            conflicts.push({
              name: [w.nombre, w.apellidos].filter(Boolean).join(" "),
              day,
              code,
              label: SHIFT_META[code]?.label ?? code,
            });
          }
        }
      }
    }
    return conflicts;
  })();

  const schedule   = schedules[mode];
  const unassigned = unassigneds[mode];
  // Only use saved constraints.days when there is actually a loaded schedule;
  // an empty array [] is truthy in JS but means "no data yet".
  const activeDays = schedule?.length > 0 ? (constraints.days || 1) : 1;

  // When active project changes, restore its scheduling state (IndexedDB first, Firestore summary as fallback)
  useEffect(() => {
    if (!activeProject) {
      setSchedules({ vehicles: null, workers: null });
      return;
    }
    const sc = activeProject.scheduling;
    idbLoad(`vrp_${activeProject._id}`).then(cached => {
      if (cached?.vehicles?.length) {
        setSchedules({ vehicles: cached.vehicles, workers: cached.workers || [] });
        if (sc?.constraints) setConstraints(prev => ({ ...prev, ...sc.constraints, days: sc.daysUsed || 1 }));
      } else if (sc) {
        setSchedules({ vehicles: sc.vehicleSchedule || [], workers: sc.workerSchedule || [] });
        setConstraints(prev => ({ ...prev, ...(sc.constraints || {}), days: sc.daysUsed || 1 }));
      } else {
        setSchedules({ vehicles: null, workers: null });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?._id]);

  async function importFromPlanning() {
    if (!activeProject) return;
    setImporting(true);
    try {
      const allTasks = await loadTasksFromLayers(activeProject._id);

      if (allTasks.length === 0) {
        alert("No hay puntos en planning para este proyecto.\nVe a Planning, sube el Excel y vuelve aquí a importar.");
        setImporting(false);
        return;
      }

      const uniqueBarrios = [...new Set(allTasks.map(t => t.barrio).filter(Boolean))];
      setTasks(allTasks);
      onProjectUpdate({
        planning: {
          tasksCount: allTasks.length,
          importedAt: new Date().toISOString(),
          uniqueBarrios: uniqueBarrios.slice(0, 30),
        },
        status: "con_planning",
      });
    } catch (e) {
      console.error("importFromPlanning:", e);
      alert("Error al importar: " + e.message);
    }
    setImporting(false);
  }

  async function runGenerate() {
    if (!tasks.length) return;
    if (!vehicles.length && !workers.length) return;
    setGenerating(true);
    setGenError(null);
    setGenPhase("vrp");
    await new Promise(resolve => setTimeout(resolve, 30)); // let React render the phase

    try {
      // Read Planning depots from Firestore as fallback depot for vehicles
      let planningDepot = null;
      try {
        if (activeProject?._id) {
          const snap = await getDoc(doc(db, "planning_depots", activeProject._id));
          if (snap.exists()) {
            const list = snap.data().depots ?? [];
            if (list.length > 0) planningDepot = { lat: +list[0].lat, lng: +list[0].lng };
          }
        }
      } catch { /* ignore */ }

      // Inject planning depot into vehicles that have no depot set
      const vehiclesWithDepot = vehicles.map(v => {
        if (v.depotLat && v.depotLng) return v;
        if (!planningDepot) return v;
        return { ...v, depotLat: planningDepot.lat, depotLng: planningDepot.lng };
      });

      // Compute each vehicle's effective shift from its linked workers' union.
      // A vehicle with only a morning worker works 06–14; morning+afternoon → 06–22.
      // Vehicles with no linked workers keep their own turno.
      const vehiclesForVRP = vehiclesWithDepot.map(v => {
        const linked = workers.filter(w => w.vehiculoId === (v._id || v.id));
        if (!linked.length) return v;
        const wins = linked.map(w => turnoWindow(w.turno, constraints.startMin, constraints.endMin));
        const effStart = Math.min(...wins.map(w => w.start));
        const effEnd   = Math.max(...wins.map(w => w.end));
        return { ...v, _effectiveStart: effStart, _effectiveEnd: effEnd };
      });

      // ── Step 1: Vehicle VRP ──────────────────────────────────────
      // generateScenario preserves resource order: vr.schedule[i] ↔ vehiclesForVRP[i]
      let vr = { schedule: [], unassigned: [...tasks], daysUsed: 1 };
      if (vehiclesForVRP.length > 0) {
        vr = await generateScenario(tasks, vehiclesForVRP, constraints);
      }
      const vehicleScheduleRaw = vehiclesForVRP.map((v, i) => ({
        ...v,
        assignments: vr.schedule[i]?.assignments || [],
        totalKm:     vr.schedule[i]?.totalKm     || 0,
        shiftStart:  vr.schedule[i]?.shiftStart,
        shiftEnd:    vr.schedule[i]?.shiftEnd,
      }));

      // Enrich travel block km with real road distances via OSRM
      setGenPhase("osrm");
      setOsrmRunning(true);
      const vehicleSchedule = await enrichWithOSRM(vehicleScheduleRaw);
      setOsrmRunning(false);

      // ── Step 2: Worker schedule ──────────────────────────────────
      setGenPhase("workers");
      await new Promise(resolve => setTimeout(resolve, 0));
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
          const dayOffset = Math.floor((a._start - constraints.startMin) / 1440) * 1440;
          const tStart = a._start - dayOffset;
          // Depot return: assign to the last worker of the vehicle (latest shift end)
          if (a._depot_return) {
            const last = peers.reduce((best, p) => !best || p._tw.end > best._tw.end ? p : best, null);
            return last && (last._id || last.id) === wId;
          }
          // All other blocks: owner = first peer whose window contains the slot start
          const owner = peers.find(p => tStart >= p._tw.start && tStart < p._tw.end);
          return owner && (owner._id || owner.id) === wId;
        });

        const myKm = myAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
        return { ...w, assignments: myAssignments, totalKm: myKm };
      });

      setSchedules({ vehicles: vehicleSchedule, workers: workerRows });
      setUnassigneds({ vehicles: vr.unassigned, workers: vr.unassigned });
      const newDays = vr.daysUsed;
      setConstraints(prev => ({ ...prev, days: newDays }));

      // Persist full schedule to IndexedDB (too large for Firestore)
      if (activeProject?._id) {
        idbSave(`vrp_${activeProject._id}`, { vehicles: vehicleSchedule, workers: workerRows });
      }

      // Auto-save summary to project (assignments excluded — too large for Firestore 1MB limit)
      setGenPhase("saving");
      if (activeProject && onProjectUpdate) {
        const totalKm    = vehicleSchedule.reduce((s, v) => s + (v.totalKm || 0), 0);
        const totalStops = vehicleSchedule.reduce((s, v) =>
          s + v.assignments.filter(a => !a._break && !a._travel).length, 0);
        await onProjectUpdate({
          scheduling: {
            vehicleCount: vehicleSchedule.length,
            workerCount:  workerRows.length,
            constraints:  { ...constraints, days: newDays },
            daysUsed: newDays, totalKm, totalStops,
            generatedAt: new Date().toISOString(),
          },
          status: "schedulado",
        });
      }

      // Save worker–day roster so Rostering can display scheduled shifts
      if (activeProject?._id && orgId) {
        try {
          const turnoByWorker = {};
          const daysWorked    = {};
          for (const wRow of workerRows) {
            const wId = wRow._id || wRow.id;
            const t   = wRow.turno ?? "";
            const code = /06.?14/i.test(t) ? "M" : /14.?22/i.test(t) ? "T" : /22.?06/i.test(t) ? "N" : null;
            if (code) turnoByWorker[wId] = code;
            const dSet = new Set();
            for (const a of (wRow.assignments ?? [])) {
              if (a._break || a._travel) continue;
              dSet.add(Math.floor((a._start - constraints.startMin) / 1440) + 1);
            }
            if (dSet.size) daysWorked[wId] = [...dSet].sort((a, b) => a - b);
          }
          await setDoc(doc(db, "scheduling_roster", activeProject._id), {
            projectId: activeProject._id,
            orgId,
            mes: activeProject.mes ?? "",   // "YYYY-MM" — schedule starts on day 1 of this month
            turnoByWorker,
            daysWorked,
            generatedAt: new Date().toISOString(),
          });
        } catch { /* non-critical */ }
      }

    } catch (e) {
      console.error("generateScenario error:", e);
      setGenError(e.message || "Error al generar el escenario");
    } finally {
      setGenerating(false);
      setGenPhase(null);
    }
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

  // ── Excel export ───────────────────────────────────────────────
  function downloadVehicleXLSX() {
    const vs = schedules.vehicles;
    if (!vs) return;
    const rows = [["Vehículo","Matrícula","Día","Hora inicio","Hora fin","Tipo","Nombre parada","Dirección","Barrio","Lat","Lng","Duración (min)","Km"]];
    for (const v of vs) {
      const name = v.nombre || v.matricula || v._id || "";
      const mat  = v.matricula || "";
      for (const a of v.assignments) {
        const day   = Math.floor(a._start / 1440) + 1;
        const type  = a._break ? "Descanso" : a._depot_exit ? "Salida depósito" : a._depot_return ? "Vuelta depósito" : a._travel ? "Viaje" : "Parada";
        rows.push([
          name, mat, day,
          minToTime(a._start % 1440), minToTime(a._end % 1440),
          type,
          a._break || a._travel ? "" : (a.nombre || a.name || ""),
          a._break || a._travel ? "" : (a.direccion || a.address || ""),
          a.barrio || "",
          a.lat ?? "", a.lng ?? "",
          a.duracion || (a._end - a._start),
          a.km ? +a.km.toFixed(3) : "",
        ]);
      }
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [20,12,5,10,10,20,30,30,15,10,10,13,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Vehículos");
    XLSX.writeFile(wb, `vehicle_scheduling_${activeProject?.nombre || "export"}.xlsx`);
  }

  function downloadCrewXLSX() {
    const ws2 = schedules.workers;
    if (!ws2) return;
    const rows = [["Trabajador","Turno","Vehículo","Día","Hora inicio","Hora fin","Tipo","Nombre parada","Dirección","Duración (min)","Km"]];
    for (const w of ws2) {
      const name   = [w.nombre, w.apellidos].filter(Boolean).join(" ") || w._id || "";
      const turno  = w.turno || "";
      const veh    = vehicles.find(v => (v._id || v.id) === w.vehiculoId);
      const vehNm  = veh ? (veh.nombre || veh.matricula || "") : "";
      for (const a of w.assignments) {
        const day  = Math.floor(a._start / 1440) + 1;
        const type = a._break ? "Descanso" : a._depot_exit ? "Salida depósito" : a._depot_return ? "Vuelta depósito" : a._travel ? "Viaje" : "Parada";
        rows.push([
          name, turno, vehNm, day,
          minToTime(a._start % 1440), minToTime(a._end % 1440),
          type,
          a._break || a._travel ? "" : (a.nombre || a.name || ""),
          a._break || a._travel ? "" : (a.direccion || a.address || ""),
          a.duracion || (a._end - a._start),
          a.km ? +a.km.toFixed(3) : "",
        ]);
      }
    }
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [25,15,14,5,10,10,20,30,30,13,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, sheet, "Trabajadores");
    XLSX.writeFile(wb, `crew_scheduling_${activeProject?.nombre || "export"}.xlsx`);
  }

  // ── Excel import ───────────────────────────────────────────────
  const xlsxUploadRef = useRef(null);

  function handleUploadXLSX(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parseT = t => {
          const s = String(t ?? "00:00");
          const [h, m] = s.split(":").map(Number);
          return ((isNaN(h) ? 0 : h) * 60) + (isNaN(m) ? 0 : m);
        };
        const wb   = XLSX.read(ev.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (data.length < 2) return;
        const h0 = String(data[0][0] ?? "").toLowerCase().trim();

        if (h0 === "vehículo" || h0 === "vehiculo") {
          // Vehicle schedule
          const byVeh = {};
          for (let i = 1; i < data.length; i++) {
            const r = data[i];
            if (!r[0]) continue;
            const vName = String(r[0]);
            const mat   = String(r[1] ?? "");
            if (!byVeh[vName]) {
              const ex = vehicles.find(v => (v.nombre || "") === vName || (v.matricula || "") === mat);
              byVeh[vName] = { _id: ex?._id || vName, nombre: ex?.nombre || vName, matricula: ex?.matricula || mat, assignments: [], totalKm: 0 };
            }
            const day    = parseInt(r[2]) || 1;
            const _start = (day - 1) * 1440 + parseT(r[3]);
            const _end   = (day - 1) * 1440 + parseT(r[4]);
            const type   = String(r[5] ?? "");
            const dur    = parseInt(r[11]) || (_end - _start);
            const km     = r[12] ? +r[12] : 0;
            const a      = { _start, _end, duracion: dur };
            if (type === "Descanso")         a._break = true;
            else if (type === "Salida depósito") { a._travel = true; a._depot_exit  = true; a.km = km; }
            else if (type === "Vuelta depósito") { a._travel = true; a._depot_return = true; a.km = km; }
            else if (type === "Viaje")       { a._travel = true; a.km = km; }
            else {
              a.nombre    = String(r[6] ?? "");
              a.direccion = String(r[7] ?? "");
              a.barrio    = String(r[8] ?? "");
              if (r[9]) a.lat = +r[9];
              if (r[10]) a.lng = +r[10];
            }
            byVeh[vName].assignments.push(a);
            byVeh[vName].totalKm += km;
          }
          setSchedules(prev => ({ ...prev, vehicles: Object.values(byVeh) }));

        } else if (h0 === "trabajador") {
          // Crew schedule
          const byW = {};
          for (let i = 1; i < data.length; i++) {
            const r = data[i];
            if (!r[0]) continue;
            const wName = String(r[0]);
            const turno = String(r[1] ?? "");
            if (!byW[wName]) {
              const ex   = workers.find(w => [w.nombre, w.apellidos].filter(Boolean).join(" ") === wName);
              const pts  = wName.split(" ");
              byW[wName] = { _id: ex?._id || wName, nombre: ex?.nombre || pts[0] || wName, apellidos: ex?.apellidos || pts.slice(1).join(" ") || "", turno, vehiculoId: ex?.vehiculoId || null, assignments: [], totalKm: 0 };
            }
            const day    = parseInt(r[3]) || 1;
            const _start = (day - 1) * 1440 + parseT(r[4]);
            const _end   = (day - 1) * 1440 + parseT(r[5]);
            const type   = String(r[6] ?? "");
            const dur    = parseInt(r[9]) || (_end - _start);
            const km     = r[10] ? +r[10] : 0;
            const a      = { _start, _end, duracion: dur };
            if (type === "Descanso")         a._break = true;
            else if (type === "Salida depósito") { a._travel = true; a._depot_exit  = true; a.km = km; }
            else if (type === "Vuelta depósito") { a._travel = true; a._depot_return = true; a.km = km; }
            else if (type === "Viaje")       { a._travel = true; a.km = km; }
            else {
              a.nombre    = String(r[7] ?? "");
              a.direccion = String(r[8] ?? "");
            }
            byW[wName].assignments.push(a);
            byW[wName].totalKm += km;
          }
          setSchedules(prev => ({ ...prev, workers: Object.values(byW) }));
        }
      } catch (err) {
        console.error("Error al importar Excel:", err);
        alert("Error al importar el archivo: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  }

  async function publishToRoutes(tipo, mes) {
    const vehicleSchedule = schedules.vehicles;
    if (!vehicleSchedule) return;
    setPublishing(true);
    const startMin = constraints.startMin;
    const col = collection(db, "planes");
    try {
      // Build all plan documents first, then write concurrently in chunks
      const docs = [];
      for (const row of vehicleSchedule) {
        const allStops = row.assignments.filter(a => !a._break && !a._travel);
        if (allStops.length === 0) continue;

        const byDay = {};
        for (const a of allStops) {
          const d = Math.floor((a._start - startMin) / 1440);
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(a);
        }

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
          if (conductor) {
            const code = workerCodeOnDay(rosterGrid, conductor._id ?? conductor.id ?? "", d);
            if (isUnavailable(code)) continue;
          }
          const stops = byDay[d];
          const ubicaciones = stops.map((a, i) => taskToUbicacion(a, i));
          const recorrido = stops
            .filter(a => hasCoords(a.lat, a.lng))
            .map(a => ({ lat: +a.lat, lng: +a.lng }));
          const dayLabel = `Día ${String(d + 1).padStart(2, "0")}`;
          const nombre = totalDays > 1
            ? `${conductorLabel} · ${dayLabel} · ${mes}`
            : `${conductorLabel} · ${mes}`;
          docs.push({
            tipo, nombre, archivo: "vrp-generado",
            turno: row.turno || "",
            conductorNombre: conductorLabel,
            vehiculoNombre: row.nombre || row.matricula || "",
            mes, diaServicio: dayLabel,
            ubicaciones, recorrido,
            fechaSubida: Date.now(),
            origenVRP: true,
            ...(orgId ? { org_id: orgId } : {}),
          });
        }
      }

      // Write 50 docs concurrently per round
      const CHUNK = 50;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await Promise.all(docs.slice(i, i + CHUNK).map(d => addDoc(col, d)));
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

      {/* ── TOOLBAR ──────────────────────────────────────────────── */}
      {!focusMode && <div style={{
        padding: "0 16px", height: 46, borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {/* Import */}
        <button onClick={importFromPlanning} disabled={importing} style={{
          padding: "5px 11px", background: importing ? C.surface2 : !!tasks.length ? C.greenDim : C.surface2,
          border: `1px solid ${!!tasks.length ? C.green + "44" : C.border}`,
          color: !!tasks.length ? C.green : C.muted,
          borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: importing ? "wait" : "pointer",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          {importing
            ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(52,211,153,.2)", borderTopColor: C.green, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Importando…</>
            : !!tasks.length
              ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> {tasks.length.toLocaleString()} paradas</>
              : "Importar desde Planning"
          }
        </button>

        <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2, flexShrink: 0 }}>
          {[["vehicles","Vehículos"],["workers","Trabajadores"]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{
              padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              background: mode === v ? C.blue : "none",
              color: mode === v ? "#fff" : C.muted,
              fontSize: 11, fontWeight: mode === v ? 600 : 400, fontFamily: font,
              transition: "all .12s",
            }}>{l}</button>
          ))}
        </div>

        {/* Constraints toggle */}
        <button onClick={() => setShowC(!showC)} title="Restricciones" style={{
          padding: "5px 10px", background: showC ? C.surface2 : "none",
          border: `1px solid ${showC ? C.border2 : C.border}`, color: showC ? C.text : C.muted,
          borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          Restricciones
        </button>

        {/* Inline KPI chips — only when schedule exists */}
        {schedule && <>
          <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
            <span><span style={{ fontWeight: 700, color: C.green }}>{totalAssigned.toLocaleString()}</span> <span style={{ color: C.dim }}>asig.</span></span>
            {unassigned.length > 0 && <span><span style={{ fontWeight: 700, color: C.red }}>{unassigned.length.toLocaleString()}</span> <span style={{ color: C.dim }}>sin asig.</span></span>}
            <span><span style={{ fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span> <span style={{ color: C.dim }}>días</span></span>
            {totalKm > 0 && <span><span style={{ fontWeight: 700, color: C.amber }}>{totalKm.toFixed(0)}</span> <span style={{ color: C.dim }}>km∅</span></span>}
          </div>
          {schedules.vehicles && (
            <>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              {/* Excel export */}
              <button onClick={downloadVehicleXLSX} title="Descargar vehicle scheduling en Excel"
                style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Vehículos
              </button>
              {schedules.workers && (
                <button onClick={downloadCrewXLSX} title="Descargar crew scheduling en Excel"
                  style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Trabajadores
                </button>
              )}
              {/* Excel import */}
              <input ref={xlsxUploadRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUploadXLSX} />
              <button onClick={() => xlsxUploadRef.current?.click()} title="Importar vehicle scheduling o crew scheduling desde Excel"
                style={{ padding: "5px 10px", background: "rgba(92,155,255,.08)", border: `1px solid rgba(92,155,255,.3)`, color: C.blue, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Importar
              </button>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              <button
                onClick={() => { const now = new Date(); setPublishModal({ tipo: "prev", mes: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}` }); }}
                style={{
                  padding: "5px 10px", background: C.greenDim, border: `1px solid ${C.green}44`,
                  color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Publicar en Rutas
              </button>
            </>
          )}
        </>}

        {/* Worker mode hint */}
        {mode === "workers" && !schedules.vehicles && (
          <span style={{ fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span>⚠</span> Genera primero el escenario de vehículos
          </span>
        )}

        {/* Generate + Focus mode toggle */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={runGenerate} disabled={!canGenerate} style={{
            padding: "6px 14px", background: canGenerate ? C.blue : C.blueDim,
            border: "none", color: canGenerate ? "#fff" : C.blueText,
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: canGenerate ? "pointer" : "not-allowed",
            fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            opacity: canGenerate ? 1 : .6,
          }}>
            {osrmRunning
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Calculando km…</>
              : generating
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Generando…</>
              : "Generar escenario"
            }
          </button>
          {schedule && (
            <button
              onClick={() => setFocusMode(true)}
              title="Modo pantalla completa (Gantt)"
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: C.surface2, border: `1px solid ${C.border}`,
                color: C.dim, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
              </svg>
            </button>
          )}
        </div>
      </div>}

      {/* Focus-mode mini bar — only when focusMode */}
      {focusMode && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 999,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {schedule && <div style={{
            background: "rgba(23,32,53,0.9)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "5px 12px", fontSize: 11,
            display: "flex", gap: 12, backdropFilter: "blur(4px)",
          }}>
            <span><span style={{ fontWeight: 700, color: C.green }}>{totalAssigned.toLocaleString()}</span> <span style={{ color: C.dim }}>asig.</span></span>
            {unassigned.length > 0 && <span><span style={{ fontWeight: 700, color: C.red }}>{unassigned.length.toLocaleString()}</span> <span style={{ color: C.dim }}>sin asig.</span></span>}
            <span><span style={{ fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span> <span style={{ color: C.dim }}>días</span></span>
          </div>}
          <button
            onClick={() => setFocusMode(false)}
            style={{
              padding: "5px 12px", background: "rgba(23,32,53,0.9)", border: `1px solid ${C.border2}`,
              color: C.muted, borderRadius: 8, cursor: "pointer",
              fontFamily: font, fontSize: 11, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5, backdropFilter: "blur(4px)",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
              <path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
            Salir
          </button>
        </div>
      )}

      {/* Warnings */}
      {!focusMode && !!tasks.length && vehicles.length === 0 && workers.length === 0 && (
        <div style={{ padding: "7px 16px", background: "rgba(251,146,60,0.08)", borderBottom: `1px solid rgba(251,146,60,0.2)`, fontSize: 11, color: C.orange, flexShrink: 0 }}>
          No hay vehículos ni trabajadores registrados. Añade recursos en las pestañas correspondientes.
        </div>
      )}
      {!focusMode && mode === "workers" && schedules.workers && (() => {
        const sinVehiculo = workers.filter(w => !w.vehiculoId || !vehicles.some(v => (v._id || v.id) === w.vehiculoId));
        if (!sinVehiculo.length) return null;
        const nombres = sinVehiculo.map(w => w.nombre).join(", ");
        return (
          <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, fontSize: 11, color: C.red, flexShrink: 0 }}>
            <strong>Sin vehículo asignado:</strong> {nombres}. Ve a Trabajadores y asigna un vehículo.
          </div>
        );
      })()}

      {/* Constraints panel */}
      {!focusMode && showC && <ConstraintsPanel c={constraints} onChange={setConstraints} />}

      {/* Progress bar */}
      {generating && (
        <div style={{
          padding: "10px 16px 12px",
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          animation: "sched-fadein .15s ease both",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(92,155,255,.3)", borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {GEN_PHASES[genPhase]?.label ?? "Preparando…"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: elapsedSec >= 60 ? "#f59e0b" : C.muted }}>
                {elapsedSec >= 60
                  ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
                  : `${elapsedSec}s`}
              </span>
              <span style={{ fontSize: 11, color: C.dim }}>
                {tasks.length.toLocaleString()} paradas · {(vehicles.length || workers.length) > 0 ? `${Math.max(vehicles.length, workers.length)} recurso${Math.max(vehicles.length, workers.length) !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
          </div>
          {/* Track */}
          <div style={{ height: 4, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${GEN_PHASES[genPhase]?.pct ?? 4}%`,
              background: `linear-gradient(90deg, ${C.blue}, #818cf8)`,
              borderRadius: 3,
              transition: "width 0.5s ease",
              animation: "sched-shimmer 1.8s ease-in-out infinite",
            }} />
          </div>
          {/* Phase steps */}
          <div style={{ display: "flex", gap: 0, marginTop: 7 }}>
            {Object.entries(GEN_PHASES).map(([key, ph]) => {
              const currentIdx  = Object.keys(GEN_PHASES).indexOf(genPhase);
              const thisIdx     = Object.keys(GEN_PHASES).indexOf(key);
              const done        = currentIdx > thisIdx;
              const active      = key === genPhase;
              return (
                <div key={key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: done ? C.green : active ? C.blue : C.surface2,
                    border: `1px solid ${done ? C.green : active ? C.blue : C.border}`,
                    transition: "all .3s",
                  }} />
                  <span style={{
                    fontSize: 9, color: done ? C.green : active ? C.blueText : C.dim,
                    letterSpacing: .3, fontWeight: active ? 600 : 400,
                    transition: "color .3s", whiteSpace: "nowrap",
                  }}>
                    {ph.label.replace("…", "").replace(" por carretera", "")}
                  </span>
                  {thisIdx < Object.keys(GEN_PHASES).length - 1 && (
                    <div style={{ flex: 1, height: 1, background: done ? C.green : C.border, margin: "0 4px", transition: "background .3s" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error banner */}
      {genError && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Rostering conflict banner */}
      {rosterConflicts.length > 0 && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(251,191,36,0.07)", borderBottom: `1px solid rgba(251,191,36,0.2)`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>Conflictos:</span>
          {rosterConflicts.map((c, i) => (
            <span key={i} style={{ fontSize: 10, color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 4, padding: "1px 6px" }}>
              {c.name} — día {c.day} ({c.label})
            </span>
          ))}
        </div>
      )}

      {/* Per-day breakdown strip */}
      {schedule?.length > 0 && !focusMode && activeDays > 1 && (
        <div style={{
          flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
          padding: showDayStrip ? "4px 16px" : "3px 16px",
          display: "flex", alignItems: "center", gap: 6, flexWrap: showDayStrip ? "wrap" : "nowrap",
        }}>
          <button onClick={() => setShowDayStrip(v => !v)} style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Reparto por día</span>
            <span style={{ fontSize: 9, color: C.dim, fontFamily: mono }}>({activeDays})</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2.5"
              style={{ transform: showDayStrip ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {showDayStrip && Array.from({ length: activeDays }, (_, d) => (
            <div key={d} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 5, padding: "2px 8px", flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, color: C.blue, fontWeight: 700, fontFamily: mono }}>Día {d + 1}</span>
              <span style={{ fontSize: 9, color: C.muted }}>{stopsPerDay[d] || 0}p</span>
            </div>
          ))}
        </div>
      )}

      {/* ── MAIN CONTENT ──────────────────────────────────────────── */}
      {!schedule?.length ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: C.dim }}>
          {!!!tasks.length
            ? <>
                <div style={{ fontSize: 13, color: C.muted }}>Importa los datos desde Planning para empezar</div>
                <div style={{ fontSize: 11 }}>Planning → Timetable → Exportar a Scheduling</div>
              </>
            : <>
                <div style={{ fontSize: 13, color: C.muted }}>{tasks.length.toLocaleString()} paradas listas</div>
                <div style={{ fontSize: 11 }}>
                  {(vehicles.length > 0 || workers.length > 0)
                    ? "Pulsa «Generar escenario» para asignar paradas"
                    : "Añade vehículos o trabajadores en las pestañas correspondientes"}
                </div>
              </>
          }
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Gantt — fills all available space */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <GanttChart
              rows={schedule}
              startMin={constraints.startMin}
              endMin={constraints.endMin}
              days={activeDays}
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
          </div>

          {/* ── Sin asignar — collapsible bottom drawer ───────────── */}
          {unassigned.length > 0 && (
            <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.card }}>
              {/* Handle / toggle */}
              <button
                onClick={() => setShowUnassigned(v => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 16px", background: "none", border: "none", cursor: "pointer",
                  borderBottom: showUnassigned ? `1px solid ${C.border}` : "none",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2.5"
                  style={{ transform: showUnassigned ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span style={{ fontSize: 10, color: C.red, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700 }}>
                  Sin asignar
                </span>
                <span style={{
                  background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)",
                  color: C.red, borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                }}>
                  {unassigned.length.toLocaleString()}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim }}>
                  {showUnassigned ? "Ocultar" : "Mostrar"}
                </span>
              </button>
              {/* Content */}
              {showUnassigned && (
                <div style={{ maxHeight: 120, overflowY: "auto", padding: "8px 16px 10px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {unassigned.map((t, i) => (
                      <div key={i} style={{
                        background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)",
                        borderRadius: 4, padding: "2px 7px", fontSize: 10, color: C.red, fontFamily: mono,
                      }}>
                        {t.nombre || t.barrio || minToTime(timeToMin(t.horaInicio))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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

export function TabProyectos({ activeProject, onOpenProject, orgId, isSuperAdmin }) {
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [newModal,    setNewModal]    = useState(null);
  const [creating,    setCreating]    = useState(false);
  const [orgs,        setOrgs]        = useState([]);
  const [filterOrg,   setFilterOrg]   = useState("__all__");

  // Load orgs list for superadmin filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(collection(db, "orgs"), snap => {
      setOrgs(snap.docs.map(d => ({ org_id: d.id, ...d.data() })).sort((a, b) => a.nombre?.localeCompare(b.nombre)));
    });
    return () => unsub();
  }, [isSuperAdmin]);

  const effectiveOrgId = isSuperAdmin
    ? (filterOrg === "__all__" ? null : filterOrg)
    : orgId;

  useEffect(() => {
    const constraints = effectiveOrgId ? [where("org_id", "==", effectiveOrgId)] : [];
    const unsub = onSnapshot(
      query(collection(db, "scheduling_projects"), ...constraints),
      snap => {
        const docs = snap.docs
          .map(d => {
            const data = d.data();
            // Strip tasks from memory — list view doesn't need them
            // (tasks remain in Firestore until user re-imports, which saves without them)
            const planning = data.planning
              ? { tasksCount: data.planning.tasksCount, importedAt: data.planning.importedAt, uniqueBarrios: data.planning.uniqueBarrios }
              : null;
            return { _id: d.id, ...data, planning };
          })
          .sort((a, b) => {
            const am = a.updatedAt?.toMillis?.() ?? 0;
            const bm = b.updatedAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        setProjects(docs); setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [effectiveOrgId]);

  function createProject() {
    if (!newModal?.nombre?.trim()) return;
    const docId  = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nombre = newModal.nombre.trim();
    const desc   = newModal.descripcion?.trim() || "";
    const mes    = newModal.mes || new Date().toISOString().slice(0, 7);
    const projectOrgId = newModal.orgId || effectiveOrgId || docId;

    // Close modal and navigate immediately (optimistic)
    setNewModal(null);
    onOpenProject({ _id: docId, nombre, status: "nuevo", org_id: projectOrgId });

    // Save in background — alert only on failure
    setDoc(doc(db, "scheduling_projects", docId), {
      nombre, descripcion: desc, mes, status: "nuevo",
      org_id: projectOrgId,
      planning: null, scheduling: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }).catch(e => {
      console.error("createProject:", e);
      alert("Error al guardar el proyecto en la nube: " + e.message);
    });
  }

  async function removeProject(id) {
    if (!window.confirm("¿Eliminar este proyecto y todos sus datos?")) return;
    await deleteDoc(doc(db, "scheduling_projects", id));
  }

  const inpStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: font, outline: "none", marginBottom: 10 };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isSuperAdmin ? 12 : 24 }}>
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

      {/* Superadmin org filter */}
      {isSuperAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>Organización:</span>
          <select
            value={filterOrg}
            onChange={e => setFilterOrg(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: font, outline: "none", cursor: "pointer", flex: 1, maxWidth: 320 }}
          >
            <option value="__all__">Todas las organizaciones ({projects.length})</option>
            {orgs.map(o => (
              <option key={o.org_id} value={o.org_id}>{o.nombre}</option>
            ))}
          </select>
        </div>
      )}

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
            {isSuperAdmin && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Organización *</label>
                <select
                  value={newModal.orgId || effectiveOrgId || ""}
                  onChange={e => setNewModal(p => ({ ...p, orgId: e.target.value }))}
                  style={{ ...inpStyle, marginBottom: 0, cursor: "pointer", colorScheme: "dark" }}
                >
                  <option value="">— Selecciona una organización —</option>
                  {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.nombre}</option>)}
                </select>
              </div>
            )}
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
              <button onClick={createProject} disabled={creating || !newModal.nombre.trim() || (isSuperAdmin && !newModal.orgId && !effectiveOrgId)} style={{
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
export function SchedulingModuleWrapper({ vehicles, workers, loadingV, loadingW, activeProject, onProjectUpdate, orgId }) {
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
            orgId={orgId}
          />
        </div>
        {subTab === "vehiculos"    && <TabVehiculos vehicles={vehicles} loading={loadingV} activeProject={activeProject} orgId={orgId} />}
        {subTab === "trabajadores" && <TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} orgId={orgId} />}
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
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", sesion.org_id)),
      snap => { setVehicles(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingV(false); },
      () => setLoadingV(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

  useEffect(() => {
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", sesion.org_id)),
      snap => { setWorkers(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingW(false); },
      () => setLoadingW(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

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
              Operanzia
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
          <TabProyectos activeProject={null} onOpenProject={openProject} orgId={sesion?.org_id} isSuperAdmin={sesion?.rol === "superadmin"} />
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
            orgId={sesion?.org_id}
          />
        </div>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
export function LoginScheduling({ onLogin }) {
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [nombre,    setNombre]    = useState("");
  const [orgId,     setOrgId]     = useState("default");
  const [err,       setErr]       = useState("");
  const [loading,   setLoading]   = useState(false);
  const [mode,      setMode]      = useState("checking"); // checking | login | setup

  // Detecta si hay algún admin en Firestore; si no, muestra setup
  useEffect(() => {
    getDocs(query(collection(db, "usuarios"), where("rol", "==", "admin"), limit(1)))
      .then(snap => setMode(snap.empty ? "setup" : "login"))
      .catch(() => setMode("login"));
  }, []);

  async function login() {
    if (!email || !password) { setErr("Introduce email y contraseña."); return; }
    setLoading(true); setErr("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, "usuarios", cred.user.uid));
      if (!snap.exists() || snap.data().activo === false) {
        await signOut(auth); setErr("Usuario inactivo o sin perfil."); setLoading(false); return;
      }
      const profile = { uid: cred.user.uid, ...snap.data() };
      if (profile.rol !== "admin" && profile.rol !== "superadmin") {
        await signOut(auth); setErr("Acceso restringido a administradores."); setLoading(false); return;
      }
      onLogin(profile);
    } catch (e) {
      setErr(e.code === "auth/invalid-credential" ? "Credenciales incorrectas." : (e.message || "Error de autenticación."));
    }
    setLoading(false);
  }

  async function setup() {
    if (!email || !password || !nombre) { setErr("Rellena todos los campos."); return; }
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    setLoading(true); setErr("");
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const profile = {
        nombre: nombre.trim(), apellidos: "", email,
        rol: "admin", org_id: orgId.trim() || "default",
        activo: true, createdAt: serverTimestamp(),
      };
      await setDoc(doc(secondaryDb, "usuarios", cred.user.uid), profile);
      await secondaryAuth.signOut();
      // Now sign in as the new user
      const cred2 = await signInWithEmailAndPassword(auth, email, password);
      onLogin({ uid: cred2.user.uid, ...profile });
    } catch (e) {
      setErr(e.message || "Error al crear el administrador.");
    }
    setLoading(false);
  }

  const iStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`, color: C.text,
    padding: "10px 13px", borderRadius: 7, fontSize: 13,
    boxSizing: "border-box", fontFamily: font, outline: "none",
  };

  if (mode === "checking") return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontFamily: font, fontSize: 13 }}>Cargando…</div>
    </div>
  );

  const onEnter = e => e.key === "Enter" && (mode === "setup" ? setup() : login());

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
      <div style={{ width: 380, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 28px", boxShadow: "0 16px 48px rgba(0,0,0,.5)", animation: "sched-fadein .3s ease both" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Operanzia</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
            {mode === "setup" ? "Configuración inicial" : "Planning & Scheduling"}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            {mode === "setup" ? "No hay administradores. Crea el primero." : "Acceso para administradores"}
          </div>
        </div>

        {mode === "setup" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Nombre</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" autoComplete="name" onKeyDown={onEnter}
              style={{ ...iStyle, borderColor: nombre ? `${C.blue}44` : C.border }}
              onFocus={e => e.target.style.borderColor = `${C.blue}66`}
              onBlur={e  => e.target.style.borderColor = nombre ? `${C.blue}44` : C.border}
            />
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="admin@empresa.com" autoComplete="email" onKeyDown={onEnter}
            style={{ ...iStyle, borderColor: email ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = email ? `${C.blue}44` : C.border}
          />
        </div>
        <div style={{ marginBottom: mode === "setup" ? 14 : 20 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Contraseña</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••"
            autoComplete={mode === "setup" ? "new-password" : "current-password"} onKeyDown={onEnter}
            style={{ ...iStyle, borderColor: password ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = password ? `${C.blue}44` : C.border}
          />
        </div>
        {mode === "setup" && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>ID de organización</label>
            <input value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="default" autoComplete="off" onKeyDown={onEnter}
              style={{ ...iStyle, borderColor: orgId ? `${C.blue}44` : C.border }}
              onFocus={e => e.target.style.borderColor = `${C.blue}66`}
              onBlur={e  => e.target.style.borderColor = orgId ? `${C.blue}44` : C.border}
            />
          </div>
        )}

        {err && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: C.red, borderRadius: 7, padding: "9px 13px", fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {err}
          </div>
        )}
        <button onClick={mode === "setup" ? setup : login} disabled={loading} style={{
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
            ? <><span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(163,196,252,.3)", borderTopColor: C.blueText, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> {mode === "setup" ? "Creando…" : "Accediendo…"}</>
            : (mode === "setup" ? "Crear administrador" : "Acceder")
          }
        </button>

        {mode === "login" && (
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: C.dim }}>
            ¿Sin acceso?{" "}
            <button onClick={() => { setMode("setup"); setErr(""); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, fontFamily: font, textDecoration: "underline" }}>
              Crear primer admin
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────
export default function SchedulingApp() {
  const [sesion, setSesion] = useState(undefined); // undefined=cargando

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getDoc(doc(db, "usuarios", user.uid));
          if (snap.exists() && snap.data().activo !== false) {
            setSesion({ uid: user.uid, ...snap.data() });
          } else { await signOut(auth); setSesion(null); }
        } catch { setSesion(null); }
      } else { setSesion(null); }
    });
  }, []);

  async function handleLogin(profile) { setSesion(profile); }
  async function handleLogout() { await signOut(auth); setSesion(null); }

  if (sesion === undefined) return (
    <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:C.bg, fontFamily:font }}>
      <div style={{ color:C.muted, fontSize:13 }}>Cargando…</div>
    </div>
  );
  if (!sesion || sesion.rol !== "admin") return <LoginScheduling onLogin={handleLogin} />;
  return <SchedulingPage sesion={sesion} onLogout={handleLogout} />;
}
