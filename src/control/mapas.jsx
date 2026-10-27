// Control de rutas por puntos: el mapa de una ruta y el mapa de la flota en vivo.
import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "../firebase.js";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { C, DRIVER_STALE_MS, DRIVER_WARN_MS, barrioColor, computeFleetAlerts, font, mono } from "./datos.js";
import { useUltimo } from "../use-ultimo.js";
import { tono } from "../tema.js";

// ── LEAFLET MINI-MAP (read-only, updates on ubicaciones change) ────
// Stops are drawn on a single canvas overlay instead of one Leaflet DOM
// marker per stop — with hundreds of paradas, recreating a DOM divIcon for
// every point on every real-time update (one driver check-in = full rebuild)
// was the main source of lag. The map is read-only (no marker click/popup),
// so canvas has no functional downside here.
export function MapaControl({ ubicaciones, recorrido, height = 280 }) {
  const divRef      = useRef(null);
  const mapRef      = useRef(null);
  const polyRef      = useRef(null);
  const canvasRef    = useRef(null); // { canvas, draw }

  function ensureLeaflet(cb) {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (window.L) { cb(); return; }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = cb;
    document.head.appendChild(js);
  }

  function drawLayers() {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (polyRef.current) { try { map.removeLayer(polyRef.current); } catch { /* ya no estaba en el mapa */ } polyRef.current = null; }
    if (recorrido && recorrido.length > 1) {
      const ll = recorrido.map(p => Array.isArray(p) ? p : [p.lat, p.lng]);
      polyRef.current = L.polyline(ll, { color: "#1e3a5f", weight: 2, opacity: 0.6, dashArray: "6,4" }).addTo(map);
    }

    if (canvasRef.current) {
      const { canvas, draw } = canvasRef.current;
      try { map.off("moveend zoomend viewreset resize", draw); } catch { /* el mapa ya se había cerrado */ }
      try { canvas.remove(); } catch { /* ya quitado */ }
      canvasRef.current = null;
    }

    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    if (pts.length === 0) return;

    const showLabels = pts.length <= 300; // order number inside the dot — skip when it'd just be visual noise
    const packed = pts.map(u => ({
      lat: u.lat, lng: u.lng, orden: u.orden,
      done: !!u.realizado,
      color: u.realizado ? C.green : barrioColor(u.barri),
    }));

    const PAD = 60;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;pointer-events:none;";
    map.getPanes().overlayPane.appendChild(canvas);

    function draw() {
      if (!canvas.parentNode || !mapRef.current) return;
      const sz = map.getSize();
      const topLeft = map.containerPointToLayerPoint([-PAD, -PAD]);
      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width  = sz.x + 2 * PAD;
      canvas.height = sz.y + 2 * PAD;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      packed.forEach(p => {
        const cp = map.latLngToContainerPoint([p.lat, p.lng]);
        const x = cp.x + PAD, y = cp.y + PAD;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.done ? "#ffffff88" : p.color + "55";
        ctx.stroke();
        if (showLabels) {
          ctx.fillStyle = "#fff";
          ctx.font = `800 8px ${mono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p.orden ?? ""), x, y + 0.5);
        }
      });
    }

    draw();
    map.on("moveend zoomend viewreset resize", draw);
    canvasRef.current = { canvas, draw };

    map.invalidateSize();
    map.fitBounds(pts.map(u => [u.lat, u.lng]), { padding: [16, 16] });
  }

  function initMap() {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    const center = pts.length > 0 ? [pts[0].lat, pts[0].lng] : [39.57, 2.65];
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: false }).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current = map;
    drawLayers();
  }

  // el mapa se crea una vez; pinta siempre con las funciones de ahora
  const initMapRef = useUltimo(initMap);
  const drawLayersRef = useUltimo(drawLayers);
  useEffect(() => {
    ensureLeaflet(() => {
      if (!mapRef.current) initMapRef.current();
      else drawLayersRef.current();
    });
  }, [ubicaciones, drawLayersRef, initMapRef]);

  // Destroy map instance on unmount to avoid canvas leaks
  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={divRef} style={{ height, background: tono("#131e35", "#e7ecf6") }} />
      <div style={{ background: C.card, padding: "6px 12px", display: "flex", gap: 14, borderTop: `1px solid ${C.border}` }}>
        {[[C.green, "Realizada"], [C.muted, "Pendiente"]].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MapaFlota({ orgId, isSuperAdmin, planes }) {
  const divRef      = useRef(null);
  const mapRef      = useRef(null);
  const markersRef  = useRef(new Map()); // uid -> Leaflet marker
  const firstFitRef = useRef(false);
  const [drivers, setDrivers] = useState([]);
  // "now" congelado en estado (no Date.now() directo en el render, que React
  // considera impuro) — se refresca cada 30s para que los marcadores y las
  // alertas envejezcan aunque no llegue ninguna escritura nueva.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "ubicaciones_activas");
    const q = orgId ? query(col, where("org_id", "==", orgId)) : col;
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      console.log("[flota] ubicaciones_activas:", docs.length, "docs", docs);
      setDrivers(docs);
    }, e => console.error("[flota] error leyendo ubicaciones_activas:", e));
  }, [orgId, isSuperAdmin]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  function ensureLeaflet(cb) {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (window.L) { cb(); return; }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = cb;
    document.head.appendChild(js);
  }

  function initMap() {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false }).setView([39.57, 2.65], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current = map;
  }

  function drawDrivers() {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;
    const seen = new Set();

    drivers.forEach(d => {
      if (!d.lat || !d.lng) return;
      seen.add(d.uid);
      const age   = now - (d.updatedAt || 0);
      const stale = age > DRIVER_STALE_MS;
      const alerts = stale ? { parada: false, zona: false } : computeFleetAlerts(d, planes || [], now);
      const alerted = alerts.parada || alerts.zona;

      const color = alerted ? C.red : stale ? C.dim : age > DRIVER_WARN_MS ? C.orange : C.green;
      const sufijo = stale ? " · desconectado"
        : alerts.parada && alerts.zona ? " · parada + fuera de zona"
        : alerts.parada ? " · parada sin programar"
        : alerts.zona ? " · fuera de zona"
        : "";
      const label = `${d.nombre || "?"}${sufijo}`;
      const pulse = alerted ? "animation:control-pulse 1.6s infinite;" : "";

      const html = `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
        <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);${pulse}"></div>
        <div style="margin-top:3px;padding:2px 7px;border-radius:5px;background:${alerted ? "rgba(242,109,109,0.15)" : C.card};border:1px solid ${alerted ? C.red : C.border};color:${alerted ? "#fff" : C.text};font-size:10px;font-weight:600;font-family:${font};white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4);">${label}</div>
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [16, 16], iconAnchor: [8, 8] });

      const existing = markersRef.current.get(d.uid);
      if (existing) {
        existing.setLatLng([d.lat, d.lng]);
        existing.setIcon(icon);
      } else {
        markersRef.current.set(d.uid, L.marker([d.lat, d.lng], { icon }).addTo(map));
      }
    });

    for (const [uid, marker] of markersRef.current.entries()) {
      if (!seen.has(uid)) { map.removeLayer(marker); markersRef.current.delete(uid); }
    }

    if (!firstFitRef.current) {
      const pts = drivers.filter(d => d.lat && d.lng).map(d => [d.lat, d.lng]);
      if (pts.length > 0) {
        firstFitRef.current = true;
        map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
      }
    }
  }

  const initFlotaRef = useUltimo(initMap);
  const drawDriversRef = useUltimo(drawDrivers);
  useEffect(() => {
    ensureLeaflet(() => { if (!mapRef.current) initFlotaRef.current(); drawDriversRef.current(); });
  }, [drivers, now, planes, drawDriversRef, initFlotaRef]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  const activeCount = drivers.filter(d => now - (d.updatedAt || 0) < DRIVER_STALE_MS).length;

  const alertedDrivers = useMemo(() => {
    return drivers
      .filter(d => now - (d.updatedAt || 0) < DRIVER_STALE_MS)
      .map(d => ({ d, alerts: computeFleetAlerts(d, planes || [], now) }))
      .filter(x => x.alerts.parada || x.alerts.zona);
  }, [drivers, planes, now]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: C.muted }}>
          <span style={{ color: C.green, fontWeight: 700, fontFamily: mono }}>{activeCount}</span>{" "}
          conductor{activeCount !== 1 ? "es" : ""} compartiendo ubicación ahora
        </span>
        {alertedDrivers.length > 0 && (
          <span style={{ fontSize: 12, color: C.red, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.red, animation: "control-pulse 1.6s infinite" }} />
            <span style={{ fontWeight: 700, fontFamily: mono }}>{alertedDrivers.length}</span> alerta{alertedDrivers.length !== 1 ? "s" : ""} activa{alertedDrivers.length !== 1 ? "s" : ""}
          </span>
        )}
        {drivers.length === 0 && (
          <span style={{ fontSize: 11, color: C.dim }}>Nadie está compartiendo ubicación todavía — se activa al entrar en Rutas y aceptar el permiso</span>
        )}
      </div>

      {alertedDrivers.length > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0, background: "rgba(242,109,109,0.05)" }}>
          {alertedDrivers.map(({ d, alerts }) => {
            const stationaryMin = Math.round((now - (d.lastMovedAt || d.updatedAt || now)) / 60000);
            const motivos = [
              alerts.parada && `parado ${stationaryMin} min fuera de una parada programada`,
              alerts.zona && "fuera de la zona de su ruta",
            ].filter(Boolean).join(" · ");
            return (
              <div key={d.uid} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                background: C.card, border: `1px solid ${C.red}55`, borderRadius: 8,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{d.nombre || "?"}</span>
                <span style={{ fontSize: 10, color: C.muted }}>{motivos}</span>
              </div>
            );
          })}
        </div>
      )}

      <div ref={divRef} style={{ flex: 1, background: tono("#131e35", "#e7ecf6") }} />
    </div>
  );
}
