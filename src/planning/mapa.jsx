// Planning de rutas por puntos: el mapa (capas, puntos, cocheras, dibujo de zonas).
import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "../firebase.js";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { barrioColor, coordQuality, getBarrio, isJunkCoord, routeStats } from "./datos.js";
import { C, MAP_STYLES, font } from "./estilo.js";
import { useUltimo } from "../use-ultimo.js";

// ── POPUP HTML ────────────────────────────────────────────────────
function makePopupHtml(marker, color) {
  const skip = new Set(["lat","lng","latitude","longitude","latitud","longitud"]);
  const entries = Object.entries(marker).filter(([k]) => !skip.has(k.toLowerCase()) && !k.startsWith("_"));

  const title = marker.nombre || marker.name || marker.id || marker.pa || "";
  const rows = entries
    .filter(([k]) => !["nombre","name"].includes(k.toLowerCase()))
    .map(([k,v]) => `
      <tr>
        <td style="color:#9aa3b2;padding:3px 12px 3px 0;font-size:11px;white-space:nowrap;vertical-align:top;">${k}</td>
        <td style="color:#e6e8ee;font-size:11px;word-break:break-word;">${v ?? "—"}</td>
      </tr>`)
    .join("");

  return `
    <div style="font-family:'Inter',sans-serif;min-width:180px;max-width:300px;padding:12px 14px;">
      ${title ? `<div style="font-size:13px;font-weight:600;color:${color};margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">${title}</div>` : ""}
      ${rows ? `<table style="width:100%;border-collapse:collapse;">${rows}</table>` : '<div style="color:#9aa3b2;font-size:12px;">Sin campos adicionales</div>'}
      <div style="font-size:10px;color:#5d6574;margin-top:8px;font-family:monospace;">${marker.lat?.toFixed(5)}, ${marker.lng?.toFixed(5)}</div>
    </div>`;
}

export function MapaPlanning({ layers, depots = [], barrioColors = {}, mapStyle, setMapStyle, addPointMode = false, onMapClickAddPoint, projectId, windowedKeys, nombreOverrides, recorridos = null }) {
  const divRef    = useRef(null);
  const mapRef    = useRef(null);
  const tileRef          = useRef(null);
  const tileLabelsRef    = useRef(null);
  const leafletLayersRef  = useRef([]);
  const depotLayersRef    = useRef([]);
  const canvasOverlayRef  = useRef(null); // raw canvas overlay for large datasets
  const selPolyRef    = useRef(null);
  const selPinsRef    = useRef([]);
  const recorridosRef = useRef(null); // trazados de líneas GTFS
  const [showStylePicker, setShowStylePicker] = useState(false);
  const currentStyle = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];

  const [selMode,      setSelMode]      = useState(false);
  const [selected,     setSelected]     = useState([]);  // [{lat,lng,nombre}]
  // ruta por carretera (OSRM) de los puntos elegidos: { clave, data: {km, minutes, geometry} | null }
  const [ruta, setRuta] = useState({ clave: null, data: null });

  // Refs so Leaflet click handlers always see current values
  const selModeRef  = useRef(false);
  const selectedRef = useRef([]);
  useEffect(() => { selModeRef.current  = selMode;   }, [selMode]);
  useEffect(() => { selectedRef.current = selected;  }, [selected]);

  // Fetch road route via OSRM when selection has ≥2 points
  const claveRuta = selected.length >= 2 ? selected.map(p => `${p.lng},${p.lat}`).join(";") : null;
  useEffect(() => {
    if (!claveRuta) return;
    const ctrl = new AbortController();
    const url = `https://router.project-osrm.org/route/v1/driving/${claveRuta}?overview=full&geometries=geojson`;
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        const r = data.code === "Ok" && data.routes?.[0];
        setRuta({ clave: claveRuta, data: r ? { km: r.distance / 1000, minutes: Math.round(r.duration / 60), geometry: r.geometry } : null });
      })
      .catch(e => { if (e.name !== "AbortError") setRuta({ clave: claveRuta, data: null }); });
    return () => ctrl.abort();
  }, [claveRuta]);
  const routeData = claveRuta && ruta.clave === claveRuta ? ruta.data : null;
  const routeLoading = !!claveRuta && ruta.clave !== claveRuta;

  const drawLayers = useCallback(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    // Recorridos de líneas GTFS (debajo de las paradas)
    if (recorridosRef.current) { try { map.removeLayer(recorridosRef.current); } catch { /* ya no estaba */ } recorridosRef.current = null; }
    if (recorridos?.length) {
      const renderer = L.canvas({ padding: 0.3 });
      recorridosRef.current = L.layerGroup(recorridos.flatMap(r => r.trazados.map(t =>
        L.polyline(t, { color: r.color, weight: r.grosor || 3, opacity: r.opacidad ?? 0.9, renderer, interactive: false })))).addTo(map);
    }

    // Remove previous Leaflet marker layers
    leafletLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /* ya no estaba en el mapa */ } });
    leafletLayersRef.current = [];

    // Clean up previous canvas/renderer overlay
    if (canvasOverlayRef.current) {
      const { canvas, drawFn, renderer, clickFn } = canvasOverlayRef.current;
      if (drawFn) { try { map.off('moveend zoomend viewreset resize', drawFn); } catch { /* el mapa ya se había cerrado */ } }
      if (clickFn) { try { map.off('click', clickFn); } catch { /* ya no estaba */ } }
      if (canvas)   { try { canvas.remove(); } catch { /* ya quitado */ } }
      if (renderer) { try { renderer.remove(); } catch { /* ya quitado */ } }
      canvasOverlayRef.current = null;
    }
    // Remove any orphan canvas nodes from earlier attempts
    map.getContainer().querySelectorAll('[data-operanzia=canvas-overlay]').forEach(c => c.remove());

    const visibleLayers = layers.filter(l => l.visible && l.markers?.length > 0);
    const totalPoints = visibleLayers.reduce((s, l) => s + l.markers.length, 0);
    const useLargeMode = totalPoints > 2000;

    const allPoints = [];

    if (useLargeMode) {
      // ── LARGE DATASET: direct canvas overlay in Leaflet's overlayPane ──
      // Build a flat array of [lat, lng, color] tuples first (no Leaflet objects).
      const allPts = [];
      const ptMarkers = []; // punto original de cada entrada de allPts (para seleccionarlo al medir)
      visibleLayers.forEach(layer => {
        const q = coordQuality(layer.markers);
        layer.markers.forEach(m => {
          const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
          if (isJunkCoord(lat, lng)) return;
          const barrio = getBarrio(m);
          const color = barrio ? barrioColor(barrio, barrioColors) : (layer.color || '#5b7cfa');
          allPts.push(lat, lng, color); // packed flat for cache efficiency
          ptMarkers.push(m);
          if (!q.isFar(lat, lng)) allPoints.push([lat, lng]); // los muy lejanos no mueven el encuadre
        });
      });

      // Create canvas inside overlayPane (same pane Leaflet uses for its own renderers)
      const PAD = 150;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-operanzia', 'canvas-overlay');
      canvas.style.cssText = 'position:absolute;pointer-events:none;';
      map.getPanes().overlayPane.appendChild(canvas);

      // Rendimiento del dibujo (44.249 puntos en MADRID; medido ~1,4 s
      // bloqueando la pantalla al abrir, en un PC normal):
      //  - cada punto se proyecta UNA vez por nivel de zoom; al desplazar el
      //    mapa solo cambia un desplazamiento común (sin reproyectar);
      //  - un solo trazado y un solo relleno por color (antes, uno por punto);
      //  - los puntos fuera de la vista no se dibujan;
      //  - varios eventos seguidos (mover + zoom + tamaño) = un solo redibujo.
      const nPts = allPts.length / 3;
      const byColor = new Map(); // color → índices de punto
      for (let k = 0; k < nPts; k++) {
        const col = allPts[k * 3 + 2];
        if (!byColor.has(col)) byColor.set(col, []);
        byColor.get(col).push(k);
      }
      let projZoom = null, proj = null;
      function projected() {
        const z = map.getZoom();
        if (projZoom !== z || !proj) {
          proj = new Float64Array(nPts * 2);
          for (let k = 0; k < nPts; k++) {
            const p = map.project([allPts[k * 3], allPts[k * 3 + 1]], z);
            proj[k * 2] = p.x; proj[k * 2 + 1] = p.y;
          }
          projZoom = z;
        }
        // desplazamiento proyectado → punto de contenedor (igual para todos)
        const ref = map.latLngToContainerPoint([allPts[0], allPts[1]]);
        return { proj, ox: ref.x - proj[0], oy: ref.y - proj[1] };
      }

      function drawPts() {
        if (!canvas.parentNode || !mapRef.current || !nPts) return;
        const sz = map.getSize();
        // Position canvas to cover viewport + PAD padding (same math as L.Canvas renderer)
        const topLeft = map.containerPointToLayerPoint([-PAD, -PAD]);
        L.DomUtil.setPosition(canvas, topLeft);
        canvas.width  = sz.x + 2 * PAD;
        canvas.height = sz.y + 2 * PAD;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const { proj: pr, ox, oy } = projected();
        const W = canvas.width, H = canvas.height, TWO_PI = Math.PI * 2;
        for (const [col, idxs] of byColor) {
          ctx.fillStyle = col;
          ctx.beginPath();
          for (const k of idxs) {
            // offset by PAD because canvas top-left = container(-PAD,-PAD)
            const x = pr[k * 2] + ox + PAD, y = pr[k * 2 + 1] + oy + PAD;
            if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
            ctx.moveTo(x + 3, y);
            ctx.arc(x, y, 3, 0, TWO_PI);
          }
          ctx.fill();
        }
      }

      let rafId = 0;
      const scheduleDraw = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => { rafId = 0; drawPts(); });
      };
      drawPts();
      map.on('moveend zoomend viewreset resize', scheduleDraw);

      // "Medir distancia" con muchos puntos: el canvas no recibe clics (los
      // puntos no son marcadores), así que en Madrid no había forma de
      // seleccionar ninguno. Al hacer clic en el mapa en modo medición se
      // coge el punto pintado más cercano al cursor (a menos de 14 px).
      const PICK_PX = 14;
      function pickNearest(e) {
        if (!selModeRef.current) return;
        const cp = e.containerPoint;
        let best = -1, bestD = PICK_PX * PICK_PX;
        const { proj: pr, ox, oy } = projected();
        for (let k = 0; k < nPts; k++) {
          const dx = pr[k * 2] + ox - cp.x, dy = pr[k * 2 + 1] + oy - cp.y, d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = k * 3; }
        }
        if (best < 0) return;
        const lat = allPts[best], lng = allPts[best + 1];
        const m = ptMarkers[best / 3];
        const overrideName = nombreOverrides?.get(`${lat.toFixed(5)}_${lng.toFixed(5)}`);
        const prev = selectedRef.current;
        const idx = prev.findIndex(s => s.lat === lat && s.lng === lng);
        setSelected(idx >= 0
          ? prev.filter((_, i) => i !== idx)
          : [...prev, { lat, lng, nombre: overrideName || m?.nombre || m?.name || (m && getBarrio(m)) || `${lat.toFixed(4)},${lng.toFixed(4)}` }]
        );
      }
      map.on('click', pickNearest);
      canvasOverlayRef.current = { canvas, drawFn: scheduleDraw, renderer: null, clickFn: pickNearest };

    } else {
      // ── SMALL DATASET: individual Leaflet markers with popups ──
      visibleLayers.forEach(layer => {
        const q = coordQuality(layer.markers);
        layer.markers.forEach(m => {
          const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
          if (isJunkCoord(lat, lng)) return;

          const barrio = getBarrio(m);
          const color  = barrio ? barrioColor(barrio, barrioColors) : layer.color;
          const size = 14;
          const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
          const hasWindow = windowedKeys?.has(puntoKey);
          const border = hasWindow ? "3px solid rgba(0,0,0,0.85)" : "2px solid rgba(255,255,255,0.8)";
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;transition:transform .15s;"></div>`,
            iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
          });
          // Nombre renombrado a mano en Timetable, si lo hay — mismo puntoKey.
          const overrideName = nombreOverrides?.get(puntoKey);
          const mPopup = overrideName ? { ...m, nombre: overrideName } : m;
          const marker = L.marker([lat, lng], { icon })
            .bindPopup(makePopupHtml(mPopup, color), { maxWidth: 320, className: "" });

          marker.on("click", e => {
            if (!selModeRef.current) return;
            L.DomEvent.stopPropagation(e);
            marker.closePopup();
            const prev = selectedRef.current;
            const idx  = prev.findIndex(s => s.lat === lat && s.lng === lng);
            setSelected(idx >= 0
              ? prev.filter((_, i) => i !== idx)
              : [...prev, { lat, lng, nombre: overrideName || m.nombre || m.name || getBarrio(m) || `${lat.toFixed(4)},${lng.toFixed(4)}` }]
            );
          });

          marker.addTo(map);
          leafletLayersRef.current.push(marker);
          if (!q.isFar(lat, lng)) allPoints.push([lat, lng]); // los muy lejanos no mueven el encuadre
        });
      });
    }

    // Render depots (orange house markers, above stops)
    depotLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /* ya no estaba en el mapa */ } });
    depotLayersRef.current = [];
    depots.forEach((d, i) => {
      const dIcon = L.divIcon({
        className: "",
        html: `<div title="${d.nombre}" style="
          width:36px;height:36px;border-radius:8px;
          background:#f59e5b;border:2.5px solid rgba(255,255,255,0.95);
          box-shadow:0 3px 14px rgba(245,158,91,0.7);
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;
        "><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`,
        iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
      });
      const fields = Object.entries(d.fields || {}).map(([k, v]) =>
        `<tr><td style="color:#9aa3b2;padding:2px 10px 2px 0;font-size:11px;">${k}</td><td style="color:#e6e8ee;font-size:11px;">${v}</td></tr>`
      ).join("");
      const popupHtml = `<div style="font-family:'Inter',sans-serif;min-width:160px;padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:#f59e5b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Depot ${i + 1}</div>
        <div style="font-size:13px;font-weight:600;color:#e6e8ee;margin-bottom:6px;">${d.nombre}</div>
        ${fields ? `<table style="width:100%;border-collapse:collapse;">${fields}</table>` : ""}
        <div style="font-size:10px;color:#5d6574;margin-top:6px;font-family:monospace;">${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
      </div>`;
      const dm = L.marker([d.lat, d.lng], { icon: dIcon, zIndexOffset: 500 })
        .bindPopup(popupHtml, { maxWidth: 280 });
      dm.on("click", e => {
        if (!selModeRef.current) return;
        L.DomEvent.stopPropagation(e);
        dm.closePopup();
        const prev = selectedRef.current;
        const idx  = prev.findIndex(s => s.lat === d.lat && s.lng === d.lng);
        setSelected(idx >= 0
          ? prev.filter((_, i) => i !== idx)
          : [...prev, { lat: d.lat, lng: d.lng, nombre: `🏠 ${d.nombre}` }]
        );
      });
      dm.addTo(map);
      depotLayersRef.current.push(dm);
      allPoints.push([d.lat, d.lng]);
    });

    const foco = recorridos?.find(r => r.encuadrar);
    if (foco) {
      map.invalidateSize();
      const b = L.latLngBounds(foco.trazados.flat());
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
    } else if (allPoints.length > 0) {
      map.invalidateSize();
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const [lat, lng] of allPoints) {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      }
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40], maxZoom: 16 });
    }
  }, [layers, depots, barrioColors, windowedKeys, nombreOverrides, recorridos]);

  // Draw / update selection polyline and numbered pins
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    // Remove old
    if (selPolyRef.current) { map.removeLayer(selPolyRef.current); selPolyRef.current = null; }
    selPinsRef.current.forEach(p => { try { map.removeLayer(p); } catch { /* ya no estaba en el mapa */ } });
    selPinsRef.current = [];

    if (selected.length < 1) return;

    // Numbered pins
    selected.forEach((pt, i) => {
      const pin = L.marker([pt.lat, pt.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:22px;height:22px;border-radius:50%;background:#5b7cfa;border:2px solid #fff;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5);">${i + 1}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
      }).addTo(map);
      selPinsRef.current.push(pin);
    });

    // Polyline: real road geometry from OSRM, or straight dashed fallback
    if (selected.length > 1) {
      if (routeData?.geometry) {
        selPolyRef.current = L.geoJSON(routeData.geometry, {
          style: { color: "#5b7cfa", weight: 3.5, opacity: 0.9 },
        }).addTo(map);
      } else {
        selPolyRef.current = L.polyline(
          selected.map(p => [p.lat, p.lng]),
          { color: "#5b7cfa", weight: 2, dashArray: "6 4", opacity: 0.5 }
        ).addTo(map);
      }
    }
  }, [selected, routeData]);

  const initMap = useCallback(() => {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false })
      .setView([40.416, -3.703], 6);
    const style = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];
    tileRef.current = L.tileLayer(style.url).addTo(map);
    if (style.labelsUrl) tileLabelsRef.current = L.tileLayer(style.labelsUrl).addTo(map);
    mapRef.current = map;
    drawLayers();
  }, [drawLayers, mapStyle]);

  // Swap tile layer when style changes (map already initialized)
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const style = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];
    if (tileRef.current) mapRef.current.removeLayer(tileRef.current);
    if (tileLabelsRef.current) { mapRef.current.removeLayer(tileLabelsRef.current); tileLabelsRef.current = null; }
    tileRef.current = L.tileLayer(style.url).addTo(mapRef.current);
    // Etiquetas (nombres de calles/barrios) por encima del fondo, si el
    // estilo las trae en una capa aparte (ver comentario en MAP_STYLES).
    if (style.labelsUrl) tileLabelsRef.current = L.tileLayer(style.labelsUrl).addTo(mapRef.current);
    if (tileLabelsRef.current) tileLabelsRef.current.bringToBack();
    tileRef.current.bringToBack();
  }, [mapStyle]);

  // el mapa se crea una vez; pinta siempre con la función de ahora
  const initMapRef = useUltimo(initMap);
  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (!window.L) {
      const js = document.createElement("script");
      js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      js.onload = () => initMapRef.current();
      document.head.appendChild(js);
    } else {
      initMapRef.current();
    }
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [initMapRef]);

  useEffect(() => {
    if (window.L && mapRef.current) drawLayers();
    else {
      const t = setTimeout(() => {
        if (window.L && !mapRef.current) initMapRef.current();
        else if (window.L) drawLayers();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [layers, drawLayers, initMapRef]);

  // Add-point mode: crosshair cursor + click handler
  const addPointModeRef = useRef(addPointMode);
  useEffect(() => { addPointModeRef.current = addPointMode; }, [addPointMode]);
  const onMapClickAddPointRef = useRef(onMapClickAddPoint);
  useEffect(() => { onMapClickAddPointRef.current = onMapClickAddPoint; }, [onMapClickAddPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (addPointMode) {
      container.style.cursor = "crosshair";
      const handler = (e) => {
        if (!addPointModeRef.current) return;
        onMapClickAddPointRef.current?.(e.latlng.lat, e.latlng.lng);
      };
      map.once("click", handler);
      return () => { map.off("click", handler); container.style.cursor = ""; };
    } else {
      container.style.cursor = "";
    }
  }, [addPointMode]);

  useEffect(() => {
    if (!divRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current && divRef.current?.offsetWidth > 0) mapRef.current.invalidateSize();
    });
    ro.observe(divRef.current);
    return () => ro.disconnect();
  }, []);

  // routeData from OSRM; haversine only as fallback label
  const haversineStats = selected.length > 1 ? routeStats(selected) : null;

  return (
    <div style={{ flex: 1, position: "relative", height: "100%" }}>
      {/* Map container */}
      <div ref={divRef} className="planning-map" style={{ width: "100%", height: "100%", background: "#181c25" }} />

      {/* Selection mode toggle */}
      <button
        onClick={() => { setSelMode(m => !m); if (selMode) setSelected([]); }}
        title={selMode ? "Salir de selección" : "Medir distancia entre puntos"}
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 900,
          padding: "7px 13px", borderRadius: 8, fontFamily: font, fontSize: 12, fontWeight: 600,
          background: selMode ? C.blue : C.card,
          color: selMode ? "#fff" : C.muted,
          border: `1px solid ${selMode ? C.blue : C.border}`,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,.4)", transition: "all .15s",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l7.5 7.5M21 3l-7.5 7.5M3 21l7.5-7.5M21 21l-7.5-7.5"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        {selMode ? "Salir de medición" : "Medir distancia"}
      </button>

      {/* Map style picker */}
      <div style={{ position: "absolute", top: 50, right: 10, zIndex: 900 }}>
        <button
          onClick={() => setShowStylePicker(s => !s)}
          title="Cambiar estilo del mapa"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "6px 12px", borderRadius: 8, fontFamily: font, fontSize: 12, fontWeight: 600,
            background: showStylePicker ? C.surface2 : C.card,
            color: C.muted, border: `1px solid ${C.border}`,
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.4)", transition: "all .15s",
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 2, background: currentStyle.preview, border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
          {currentStyle.label}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.5 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {showStylePicker && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 9, overflow: "hidden",
            boxShadow: "0 6px 24px rgba(0,0,0,.5)", minWidth: 150,
          }}>
            {MAP_STYLES.map(s => (
              <button
                key={s.key}
                onClick={() => {
                  setMapStyle(s.key); setShowStylePicker(false);
                  if (projectId) setDoc(doc(db, "planning_settings", projectId), { mapStyle: s.key, updatedAt: serverTimestamp() }, { merge: true });
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 14px", background: s.key === mapStyle ? C.surface2 : "none",
                  border: "none", borderBottom: `1px solid ${C.border}`,
                  color: s.key === mapStyle ? C.text : C.muted,
                  cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: s.key === mapStyle ? 600 : 400,
                  textAlign: "left", transition: "background .1s",
                }}
                onMouseEnter={e => { if (s.key !== mapStyle) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={e => { if (s.key !== mapStyle) e.currentTarget.style.background = "none"; }}
              >
                <div style={{ width: 14, height: 14, borderRadius: 3, background: s.preview, border: `1px solid rgba(255,255,255,0.15)`, flexShrink: 0 }} />
                {s.label}
                {s.key === mapStyle && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.5" style={{ marginLeft: "auto" }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selection instructions */}
      {selMode && selected.length === 0 && (
        <div style={{
          position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)",
          zIndex: 900, background: "rgba(15,17,23,0.88)", border: `1px solid ${C.border}`,
          borderRadius: 8, padding: "8px 16px", fontSize: 12, color: C.muted,
          backdropFilter: "blur(4px)", whiteSpace: "nowrap",
        }}>
          Haz clic en los puntos del mapa para seleccionarlos en orden
        </div>
      )}

      {/* Results panel */}
      {selMode && selected.length > 0 && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 900, background: "rgba(22,27,39,0.95)", border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "12px 16px", minWidth: 280,
          boxShadow: "0 4px 24px rgba(0,0,0,.5)", backdropFilter: "blur(6px)",
        }}>
          {/* Selected points list */}
          <div style={{ marginBottom: 10, maxHeight: 120, overflowY: "auto" }}>
            {selected.map((pt, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", background: C.blue,
                  color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ fontSize: 11, color: C.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pt.nombre}
                </span>
              </div>
            ))}
          </div>

          {/* Stats — road route from OSRM */}
          {selected.length > 1 && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              {routeLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(79,142,247,0.2)", borderTopColor: C.blue, borderRadius: "50%", animation: "planning-spin .6s linear infinite", flexShrink: 0 }} />
                  Calculando ruta por carretera…
                </div>
              ) : routeData ? (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Por carretera</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{routeData.km.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>km</span></div>
                  </div>
                  <div style={{ width: 1, height: 36, background: C.border }} />
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Tiempo estimado</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                      {routeData.minutes >= 60
                        ? `${Math.floor(routeData.minutes / 60)}h ${routeData.minutes % 60}min`
                        : `${routeData.minutes} min`}
                    </div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setSelected([])} style={{
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.dim, cursor: "pointer", fontSize: 11, padding: "4px 10px",
                    fontFamily: font, transition: "all .12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >Limpiar</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Línea recta (aprox.)</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{haversineStats.km.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>km</span></div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setSelected([])} style={{
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.dim, cursor: "pointer", fontSize: 11, padding: "4px 10px",
                    fontFamily: font, transition: "all .12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >Limpiar</button>
                </div>
              )}
            </div>
          )}

          {selected.length === 1 && (
            <div style={{ fontSize: 11, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              Selecciona otro punto para calcular la distancia
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────
export function DepotIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
