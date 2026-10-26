// ── Diseñar la red de líneas a mano (Planning de "Líneas regulares") ────
// Paradas pinchando en el mapa, líneas con ida y vuelta, recorrido (rectas o
// por calles), tiempo de recorrido, calendarios y horarios por frecuencias.
// Cada cambio se guarda solo (a los 2 s) como una red normal (red-diseno.js).
import { useState, useEffect, useRef, useMemo } from "react";
import { useLeaflet } from "./use-leaflet.js";
import { guardarRed, anotarCambioPlanning, guardarColorLinea } from "./lineas-store.js";
import { FRANJAS, kmTrazado } from "./gtfs-red.js";
import { construirRed, disenoNuevo, fechasCalendario, salidasDeTramos, revisarDiseno, vueltaDe, quitarParada, nuevoId, trazadoSentido, tiempoPropuesto, hhmmMin, PALETA_LINEAS } from "./red-diseno.js";
import { simplificar } from "./lineas-servicio.js";
import { leerHora } from "./lineas-horarios-util.js";
import { logAudit } from "./audit.js";
import { C, alfa } from "./tema.js";
import { tono } from "./tema.js";


const font = "var(--font)";
const mono = "var(--mono)";
const SEMANA = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [0, "D"]];
const fechaCorta = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "2-digit" });
const inp = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none", boxSizing: "border-box" };
const btn = (fuerte = false) => ({ padding: "5px 10px", borderRadius: 6, border: `1px solid ${fuerte ? C.blue : C.border2}`, background: fuerte ? tono("#222c58", "#e7eaf6") : "none", color: fuerte ? "#d6deff" : C.muted, fontSize: 11.5, fontWeight: fuerte ? 600 : 500, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" });
const titulo = { fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, margin: "14px 0 6px" };

// Campo de hora (hh:mm) que solo guarda al terminar de escribir
function CampoHora({ valor, onCambiar, ancho = 56 }) {
  const [t, setT] = useState(null);
  const ver = t ?? (valor == null ? "" : hhmmMin(valor));
  const fijar = () => { if (t == null) return; const m = leerHora(t); if (m != null) onCambiar(m); setT(null); };
  return <input value={ver} onChange={e => setT(e.target.value)} onBlur={fijar} onKeyDown={e => e.key === "Enter" && fijar()} placeholder="hh:mm" style={{ ...inp, width: ancho, fontFamily: mono, textAlign: "center" }} />;
}
function CampoNum({ valor, onCambiar, ancho = 50, min = 1, placeholder }) {
  const [t, setT] = useState(null);
  const fijar = () => { if (t == null) return; const n = Math.round(Number(t)); onCambiar(t.trim() === "" ? null : n >= min ? n : min); setT(null); };
  return <input value={t ?? (valor ?? "")} onChange={e => setT(e.target.value)} onBlur={fijar} onKeyDown={e => e.key === "Enter" && fijar()} inputMode="numeric" placeholder={placeholder} style={{ ...inp, width: ancho, fontFamily: mono, textAlign: "center" }} />;
}

// ── Mapa: paradas (arrastrables) y el recorrido del sentido elegido ──
function MapaDiseno({ d, linea, dir, anadiendo, onPinchar, onMoverParada, onElegirParada }) {
  const L = useLeaflet();
  const divRef = useRef(null), mapRef = useRef(null), capaRef = useRef(null);
  // solo se encuadra al abrir una red que ya tiene paradas (al crear la primera no salta el zoom)
  const encuadreRef = useRef(d.paradas.length === 0);
  const cb = useRef({});
  useEffect(() => { cb.current = { onPinchar, onMoverParada, onElegirParada, anadiendo }; });
  useEffect(() => {
    if (!L || !divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, doubleClickZoom: false }).setView([40.4, -3.7], 6);
    map.attributionControl.setPrefix(false); // sin el «Leaflet» de la esquina
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}").addTo(map);
    map.on("click", e => { if (cb.current.anadiendo) cb.current.onPinchar([e.latlng.lat, e.latlng.lng]); });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    // el buscador de sitios («¿Dónde?») centra el mapa
    const centrar = e => map.setView(e.detail, 14, { animate: false });
    window.addEventListener("diseno-centrar", centrar);
    return () => { window.removeEventListener("diseno-centrar", centrar); ro.disconnect(); map.stop(); map.off(); map.remove(); mapRef.current = null; };
  }, [L]);
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    if (capaRef.current) map.removeLayer(capaRef.current);
    const g = L.layerGroup();
    const porId = new Map(d.paradas.map(p => [p.id, p]));
    // las demás líneas, tenues
    for (const l of d.lineas) for (const s of l.sentidos) {
      if (l.id === linea?.id && s.dir === dir) continue;
      const tr = trazadoSentido(s, porId);
      if (tr.length >= 2) L.polyline(tr, { color: l.color, weight: l.id === linea?.id ? 3 : 2, opacity: l.id === linea?.id ? 0.5 : 0.3, dashArray: s.dir === 1 ? "6 6" : null, interactive: false }).addTo(g);
    }
    const s = linea?.sentidos.find(x => x.dir === dir);
    const orden = new Map((s?.paradas || []).map((id, i) => [id, i + 1]));
    if (s) {
      const tr = trazadoSentido(s, porId);
      if (tr.length >= 2) L.polyline(tr, { color: linea.color, weight: 5, opacity: 0.95, interactive: false }).addTo(g);
    }
    for (const p of d.paradas) {
      const n = orden.get(p.id);
      const html = n
        ? `<div style="transform:translate(-50%,-50%);min-width:20px;height:20px;padding:0 4px;border-radius:10px;background:${linea.color};color:${C.input};font:800 11px ${font};display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px ${C.input}">${n}</div>`
        : `<div style="transform:translate(-50%,-50%);width:11px;height:11px;border-radius:6px;background:${C.text};box-shadow:0 0 0 2px ${C.input}"></div>`;
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html, iconSize: null }), draggable: true, zIndexOffset: n ? 500 : 0 })
        .bindTooltip(p.nombre, { direction: "top", offset: [0, -8] }).addTo(g);
      m.on("click", () => cb.current.onElegirParada(p.id));
      m.on("dragend", e => { const ll = e.target.getLatLng(); cb.current.onMoverParada(p.id, [ll.lat, ll.lng]); });
    }
    g.addTo(map);
    capaRef.current = g;
    if (!encuadreRef.current && d.paradas.length) {
      encuadreRef.current = true;
      const b = L.latLngBounds(d.paradas.map(p => [p.lat, p.lng]));
      if (b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 16, animate: false });
    }
  }, [L, d, linea, dir]);
  useEffect(() => { if (divRef.current) divRef.current.style.cursor = anadiendo ? "crosshair" : ""; }, [anadiendo]);
  return <div ref={divRef} style={{ position: "absolute", inset: 0 }} />;
}

// Buscar un sitio para centrar el mapa al empezar (OpenStreetMap)
async function buscarSitio(texto) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(texto)}`, { headers: { "Accept-Language": "es" } });
  const j = await r.json();
  return j[0] ? [Number(j[0].lat), Number(j[0].lon)] : null;
}
// Recorrido por calles entre las paradas (servicio público de OSRM)
async function porCalles(puntos) {
  const coords = puntos.map(([la, ln]) => `${ln},${la}`).join(";");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  if (!r.ok) throw new Error(`el servicio de mapas respondió ${r.status}`);
  const j = await r.json();
  const ruta = j.routes?.[0];
  if (!ruta) throw new Error("no encontró camino por carretera entre esas paradas");
  return { trazado: simplificar(ruta.geometry.coordinates.map(([ln, la]) => [la, ln]), 8), min: ruta.duration / 60 };
}

function EditorHorarios({ d, s, onCambiar }) {
  return (
    <div>
      {d.calendarios.map(c => {
        const tramos = s.horarios?.[c.id] || [];
        const n = salidasDeTramos(tramos).length;
        const poner = nuevos => onCambiar({ ...s.horarios, [c.id]: nuevos });
        return (
          <div key={c.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 12, color: C.text, flex: 1 }}>{c.nombre}</b>
              <span style={{ fontSize: 11, color: n ? C.green : C.dim }}>{n} salidas</span>
            </div>
            {tramos.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 11.5, color: C.muted }}>
                de <CampoHora valor={t.desde} onCambiar={m => poner(tramos.map((x, j) => (j === i ? { ...x, desde: m } : x)))} />
                a <CampoHora valor={t.hasta} onCambiar={m => poner(tramos.map((x, j) => (j === i ? { ...x, hasta: m } : x)))} />
                cada <CampoNum valor={t.cada} ancho={44} onCambiar={v => poner(tramos.map((x, j) => (j === i ? { ...x, cada: v || 1 } : x)))} /> min
                <button onClick={() => poner(tramos.filter((_, j) => j !== i))} title="Quitar este tramo" style={{ ...btn(), padding: "2px 7px", marginLeft: "auto" }}>×</button>
              </div>
            ))}
            <button onClick={() => { const ult = tramos.at(-1); poner([...tramos, ult ? { desde: ult.hasta, hasta: Math.min(ult.hasta + 240, 1439), cada: ult.cada } : { desde: 360, hasta: 1320, cada: 20 }]); }} style={{ ...btn(), marginTop: 6, fontSize: 11 }}>+ Tramo de frecuencia</button>
          </div>
        );
      })}
    </div>
  );
}

function EditorLinea({ d, linea, dir, setDir, anadiendo, setAnadiendo, cambiarLinea, cambiarSentido, onBorrar, paradaPorId }) {
  const s = linea.sentidos.find(x => x.dir === dir);
  const [calculando, setCalculando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const tr = s ? trazadoSentido(s, paradaPorId) : [];
  const km = kmTrazado(tr);
  const mover = (i, k) => { const p = [...s.paradas]; const [x] = p.splice(i, 1); p.splice(i + k, 0, x); cambiarSentido({ paradas: p, trazado: null }); };
  async function calles() {
    if (s.paradas.length < 2) return;
    setCalculando(true); setAviso(null);
    try {
      const pts = s.paradas.map(id => paradaPorId.get(id)).filter(Boolean).map(p => [p.lat, p.lng]);
      const r = await porCalles(pts);
      cambiarSentido({ trazado: r.trazado, tiempo: s.tiempo || Math.max(5, Math.round(r.min * 1.35 + s.paradas.length * 0.3)) });
      setAviso({ ok: true, texto: `Recorrido por calles: ${kmTrazado(r.trazado).toLocaleString("es-ES")} km` });
    } catch (e) {
      setAviso({ ok: false, texto: `No se pudo calcular por calles (${e.message || e}). Se quedan las rectas.` });
    }
    setCalculando(false);
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="color" value={linea.color} onChange={e => cambiarLinea({ color: e.target.value })} title="Color de la línea" style={{ width: 32, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
        <input value={linea.nombre} onChange={e => cambiarLinea({ nombre: e.target.value })} placeholder="Nº" style={{ ...inp, width: 60, fontWeight: 700 }} />
        <input value={linea.largo || ""} onChange={e => cambiarLinea({ largo: e.target.value })} placeholder="Nombre (p. ej. Centro – Hospital)" style={{ ...inp, flex: 1, minWidth: 0 }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 10, background: C.surface2, borderRadius: 7, padding: 3 }}>
        {[0, 1].map(k => {
          const existe = linea.sentidos.some(x => x.dir === k);
          return <button key={k} onClick={() => setDir(k)} style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: dir === k ? alfa(0.1) : "none", color: dir === k ? "#fff" : existe ? C.muted : C.dim, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{k === 0 ? "Ida" : "Vuelta"}{!existe ? " (no hay)" : ""}</button>;
        })}
      </div>
      {!s ? (
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Esta línea no tiene {dir === 0 ? "ida" : "vuelta"}.
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {dir === 1 && linea.sentidos.some(x => x.dir === 0) && <button onClick={() => cambiarLinea({ sentidos: [...linea.sentidos, vueltaDe(linea.sentidos.find(x => x.dir === 0))] })} style={btn(true)}>Crear la vuelta (la ida al revés)</button>}
            <button onClick={() => { cambiarLinea({ sentidos: [...linea.sentidos, { dir, paradas: [], trazado: null, tiempo: null, tiempos: {}, horarios: {} }] }); setAnadiendo(true); }} style={btn()}>Empezar en blanco</button>
          </div>
        </div>
      ) : (
        <>
          <div style={titulo}>Paradas en orden ({s.paradas.length})</div>
          <button onClick={() => setAnadiendo(!anadiendo)} style={{ ...btn(anadiendo), width: "100%", padding: "7px 10px" }}>{anadiendo ? "✓ Pinchando en el mapa: cada clic añade una parada (pulsa para terminar)" : "+ Añadir paradas pinchando en el mapa"}</button>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>Pinchar encima de una parada que ya existe la reutiliza. Arrastra una parada para moverla.</div>
          <div style={{ marginTop: 6 }}>
            {s.paradas.map((id, i) => {
              const p = paradaPorId.get(id);
              return (
                <div key="${id}-${i}" style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 0" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 10, background: linea.color, color: C.input, fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.nombre || id}</span>
                  <button disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" style={{ ...btn(), padding: "1px 6px", opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                  <button disabled={i === s.paradas.length - 1} onClick={() => mover(i, 1)} title="Bajar" style={{ ...btn(), padding: "1px 6px", opacity: i === s.paradas.length - 1 ? 0.3 : 1 }}>↓</button>
                  <button onClick={() => cambiarSentido({ paradas: s.paradas.filter((_, j) => j !== i), trazado: null })} title="Quitar del recorrido (la parada sigue existiendo)" style={{ ...btn(), padding: "1px 6px" }}>×</button>
                </div>
              );
            })}
          </div>
          <div style={titulo}>Recorrido</div>
          <div style={{ fontSize: 12, color: C.muted }}>{s.trazado ? "Por calles" : "En línea recta entre paradas"} · {km.toLocaleString("es-ES")} km</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button onClick={calles} disabled={calculando || s.paradas.length < 2} style={btn(true)}>{calculando ? "Calculando…" : "Ajustar a las calles"}</button>
            {s.trazado && <button onClick={() => cambiarSentido({ trazado: null })} style={btn()}>Volver a rectas</button>}
          </div>
          {aviso && <div style={{ fontSize: 11, color: aviso.ok ? C.green : C.amber, marginTop: 5 }}>{aviso.texto}</div>}
          <div style={titulo}>Tiempo de cabecera a cabecera</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted }}>
            <CampoNum valor={s.tiempo} onCambiar={v => cambiarSentido({ tiempo: v })} placeholder={String(tiempoPropuesto(km))} /> min
            {!s.tiempo && <span style={{ fontSize: 11, color: C.dim }}>(sin poner: {tiempoPropuesto(km)} min, a 18 km/h)</span>}
          </div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 11.5, color: C.muted, cursor: "pointer" }}>Distinto según la hora (horas punta…)</summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 6 }}>
              {FRANJAS.map(f => (
                <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
                  <span style={{ width: 50 }}>{f.id.replace("-", "–")} h</span>
                  <CampoNum valor={s.tiempos?.[f.id]} ancho={44} placeholder={String(s.tiempo || tiempoPropuesto(km))} onCambiar={v => cambiarSentido({ tiempos: { ...(s.tiempos || {}), [f.id]: v } })} />
                </label>
              ))}
            </div>
          </details>
          <div style={titulo}>Horarios de salida</div>
          {dir === 1 && linea.sentidos.some(x => x.dir === 0) && <button onClick={() => cambiarSentido({ horarios: JSON.parse(JSON.stringify(linea.sentidos.find(x => x.dir === 0).horarios || {})) })} style={{ ...btn(), marginBottom: 6, fontSize: 11 }}>Copiar los de la ida</button>}
          <EditorHorarios d={d} s={s} onCambiar={h => cambiarSentido({ horarios: h })} />
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>Las horas sueltas se retocan luego en «Horarios de salida».</div>
          {dir === 1 && <button onClick={() => { if (window.confirm("¿Quitar la vuelta de esta línea?")) cambiarLinea({ sentidos: linea.sentidos.filter(x => x.dir !== 1) }); }} style={{ ...btn(), marginTop: 12, color: C.red }}>Quitar la vuelta</button>}
        </>
      )}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 10 }}>
        <button onClick={onBorrar} style={{ ...btn(), color: C.red }}>Borrar la línea {linea.nombre}</button>
      </div>
    </div>
  );
}

function EditorCalendarios({ d, cambiar }) {
  const [nuevaFecha, setNuevaFecha] = useState({});
  const cambiarCal = (id, cambios) => cambiar({ ...d, calendarios: d.calendarios.map(c => (c.id === id ? { ...c, ...cambios } : c)) });
  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>Cada calendario es un horario distinto (laborables, sábados, verano…). Los horarios de cada línea se ponen por calendario.</div>
      {d.calendarios.map(c => {
        const fechas = fechasCalendario(c);
        return (
          <div key={c.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <input value={c.nombre} onChange={e => cambiarCal(c.id, { nombre: e.target.value })} style={{ ...inp, width: "100%", fontWeight: 700 }} />
            <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
              {SEMANA.map(([w, t]) => {
                const on = c.dias.includes(w);
                return <button key={w} onClick={() => cambiarCal(c.id, { dias: on ? c.dias.filter(x => x !== w) : [...c.dias, w] })} style={{ flex: 1, padding: "4px 0", borderRadius: 5, border: `1px solid ${on ? C.blue : C.border}`, background: on ? C.blueDim : "none", color: on ? C.blueText : C.dim, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{t}</button>;
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11.5, color: C.muted }}>
              del <input type="date" value={c.desde} onChange={e => e.target.value && cambiarCal(c.id, { desde: e.target.value })} style={{ ...inp, colorScheme: tono("dark", "light"), flex: 1 }} />
              al <input type="date" value={c.hasta} onChange={e => e.target.value && cambiarCal(c.id, { hasta: e.target.value })} style={{ ...inp, colorScheme: tono("dark", "light"), flex: 1 }} />
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>Días sin servicio (festivos…) y días que se añaden:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {(c.sin || []).map(f => <span key="s${f}" style={{ fontSize: 10.5, padding: "2px 6px", borderRadius: 9, background: "rgba(242,109,109,.12)", color: C.red, cursor: "pointer" }} title="Quitar" onClick={() => cambiarCal(c.id, { sin: c.sin.filter(x => x !== f) })}>sin {fechaCorta(f)} ×</span>)}
              {(c.con || []).map(f => <span key="c${f}" style={{ fontSize: 10.5, padding: "2px 6px", borderRadius: 9, background: "rgba(63,207,142,.12)", color: C.green, cursor: "pointer" }} title="Quitar" onClick={() => cambiarCal(c.id, { con: c.con.filter(x => x !== f) })}>+ {fechaCorta(f)} ×</span>)}
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
              <input type="date" value={nuevaFecha[c.id] || ""} onChange={e => setNuevaFecha(n => ({ ...n, [c.id]: e.target.value }))} style={{ ...inp, colorScheme: tono("dark", "light"), flex: 1 }} />
              <button disabled={!nuevaFecha[c.id]} onClick={() => { cambiarCal(c.id, { sin: [...new Set([...(c.sin || []), nuevaFecha[c.id]])].sort() }); setNuevaFecha(n => ({ ...n, [c.id]: "" })); }} style={btn()}>Sin servicio</button>
              <button disabled={!nuevaFecha[c.id]} onClick={() => { cambiarCal(c.id, { con: [...new Set([...(c.con || []), nuevaFecha[c.id]])].sort() }); setNuevaFecha(n => ({ ...n, [c.id]: "" })); }} style={btn()}>Añadir</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: fechas.length ? C.muted : C.amber, flex: 1 }}>{fechas.length ? `${fechas.length} días · ${fechaCorta(fechas[0])} – ${fechaCorta(fechas.at(-1))}` : "Ningún día"}</span>
              <button onClick={() => { if (window.confirm(`¿Borrar el calendario «${c.nombre}» y sus horarios?`)) cambiar({ ...d, calendarios: d.calendarios.filter(x => x.id !== c.id), lineas: d.lineas.map(l => ({ ...l, sentidos: l.sentidos.map(s => { const h = { ...(s.horarios || {}) }; delete h[c.id]; return { ...s, horarios: h }; }) })) }); }} style={{ ...btn(), color: C.red, padding: "2px 8px" }}>Borrar</button>
            </div>
          </div>
        );
      })}
      <button onClick={() => { const base = d.calendarios[0]; cambiar({ ...d, calendarios: [...d.calendarios, { id: nuevoId("cal:", d.calendarios.map(c => c.id)), nombre: "Nuevo calendario", dias: [1, 2, 3, 4, 5], desde: base?.desde || new Date().toISOString().slice(0, 10), hasta: base?.hasta || new Date().toISOString().slice(0, 10), sin: [], con: [] }] }); }} style={btn(true)}>+ Nuevo calendario</button>
    </div>
  );
}

function EditorParadas({ d, cambiar, elegida }) {
  const [q, setQ] = useState("");
  const usos = useMemo(() => {
    const m = new Map();
    for (const l of d.lineas) for (const s of l.sentidos) for (const id of s.paradas) { if (!m.has(id)) m.set(id, new Set()); m.get(id).add(l.nombre); }
    return m;
  }, [d]);
  const vis = d.paradas.filter(p => !q.trim() || p.nombre.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar parada…" style={{ ...inp, width: "100%" }} />
      <div style={{ fontSize: 11, color: C.dim, margin: "6px 0" }}>{d.paradas.length} paradas. Se crean pinchando en el mapa al añadir paradas a una línea.</div>
      {vis.map(p => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${C.border}`, background: elegida === p.id ? C.blueDim : "none" }}>
          <input value={p.nombre} onChange={e => cambiar({ ...d, paradas: d.paradas.map(x => (x.id === p.id ? { ...x, nombre: e.target.value } : x)) })} style={{ ...inp, flex: 1, minWidth: 0 }} />
          <span style={{ fontSize: 10.5, color: C.dim, whiteSpace: "nowrap" }}>{usos.get(p.id)?.size ? `líneas ${[...usos.get(p.id)].join(", ")}` : "sin usar"}</span>
          <button onClick={() => { if (!usos.get(p.id)?.size || window.confirm(`«${p.nombre}» la usan las líneas ${[...usos.get(p.id)].join(", ")}. ¿Borrarla de todas?`)) cambiar(quitarParada(d, p.id)); }} title="Borrar parada" style={{ ...btn(), padding: "1px 7px" }}>×</button>
        </div>
      ))}
    </div>
  );
}

export function DisenoRed({ projectId, orgId, red, ficha, onCerrar }) {
  const [d, setD] = useState(() => red?.diseno ? JSON.parse(JSON.stringify(red.diseno)) : disenoNuevo());
  const [pestana, setPestana] = useState("lineas");
  const [selLinea, setSelLinea] = useState(() => red?.diseno?.lineas?.[0]?.id || null);
  const [dir, setDir] = useState(0);
  const [anadiendo, setAnadiendo] = useState(false);
  const [paradaElegida, setParadaElegida] = useState(null);
  const [guardado, setGuardado] = useState({ estado: "ok" }); // ok · pendiente · guardando · error
  const [sitio, setSitio] = useState("");
  const [error, setError] = useState(null);
  const cloudRef = useRef(ficha?.cloud || null);
  const ultimoRef = useRef(JSON.stringify(red?.diseno || null));
  const primeraVezRef = useRef(!red);
  const paradaPorId = useMemo(() => new Map(d.paradas.map(p => [p.id, p])), [d.paradas]);
  const linea = d.lineas.find(l => l.id === selLinea) || null;
  const avisos = useMemo(() => revisarDiseno(d), [d]);

  // Se guarda solo, 2 s después del último cambio
  useEffect(() => {
    const txt = JSON.stringify(d);
    if (txt === ultimoRef.current) return;
    const t = setTimeout(async () => {
      setGuardado({ estado: "guardando" });
      try {
        const nueva = construirRed(d);
        cloudRef.current = await guardarRed(projectId, orgId, nueva, { archivo: "Red diseñada en Operanzia", anterior: cloudRef.current });
        ultimoRef.current = txt;
        anotarCambioPlanning(projectId, "red de líneas (diseño: líneas, paradas, calendarios u horarios)").catch(() => {});
        if (primeraVezRef.current) { primeraVezRef.current = false; logAudit({ modulo: "Planning", accion: "Creó la red de líneas a mano", detalle: `${d.lineas.length} líneas · ${d.paradas.length} paradas` }); }
        setGuardado({ estado: "ok", en: Date.now() });
      } catch (e) {
        console.error("Guardar diseño:", e);
        setGuardado({ estado: "error", texto: e.message || String(e) });
      }
    }, 2000);
    setGuardado(g => (g.estado === "pendiente" ? g : { estado: "pendiente" }));
    return () => clearTimeout(t);
  }, [d, projectId, orgId]);

  const cambiarLinea = cambios => {
    // el color elegido aquí manda sobre el que se pusiera en el Planning
    if (cambios.color && ficha?.colores?.[selLinea]) guardarColorLinea(projectId, selLinea, null).catch(() => {});
    setD(x => ({ ...x, lineas: x.lineas.map(l => (l.id === selLinea ? { ...l, ...cambios } : l)) }));
  };
  const cambiarSentido = cambios => setD(x => ({ ...x, lineas: x.lineas.map(l => (l.id === selLinea ? { ...l, sentidos: l.sentidos.map(s => (s.dir === dir ? { ...s, ...cambios } : s)) } : l)) }));

  function nuevaLinea() {
    const id = nuevoId("L", d.lineas.map(l => l.id));
    const n = d.lineas.length + 1;
    const usados = new Set(d.lineas.map(l => l.nombre));
    let nombre = String(n); for (let k = n; usados.has(nombre); k++) nombre = String(k + 1);
    const l = { id, nombre, largo: "", color: PALETA_LINEAS[d.lineas.length % PALETA_LINEAS.length], sentidos: [{ dir: 0, paradas: [], trazado: null, tiempo: null, tiempos: {}, horarios: { [d.calendarios[0]?.id]: [{ desde: 420, hasta: 1320, cada: 20 }] } }] };
    if (!d.calendarios[0]) l.sentidos[0].horarios = {};
    setD(x => ({ ...x, lineas: [...x.lineas, l] }));
    setSelLinea(id); setDir(0); setAnadiendo(true); setPestana("lineas");
  }
  // clic en el mapa: parada existente cerca (≤ 40 m) o una nueva
  function pinchar([lat, lng]) {
    if (!linea) return;
    const cerca = d.paradas.map(p => ({ p, m: Math.hypot((p.lat - lat) * 110540, (p.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180)) })).sort((a, b) => a.m - b.m)[0];
    let id;
    setD(x => {
      let paradas = x.paradas;
      if (cerca && cerca.m <= 40) id = cerca.p.id;
      else {
        id = nuevoId("p", x.paradas.map(p => p.id));
        paradas = [...x.paradas, { id, nombre: `Parada ${x.paradas.length + 1}`, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }];
      }
      const lineas = x.lineas.map(l => {
        if (l.id !== selLinea) return l;
        const tiene = l.sentidos.some(s => s.dir === dir);
        const sentidos = tiene ? l.sentidos : [...l.sentidos, { dir, paradas: [], trazado: null, tiempo: null, tiempos: {}, horarios: {} }];
        return { ...l, sentidos: sentidos.map(s => (s.dir === dir ? (s.paradas.at(-1) === id ? s : { ...s, paradas: [...s.paradas, id], trazado: null }) : s)) };
      });
      return { ...x, paradas, lineas };
    });
  }
  const moverParada = (id, [lat, lng]) => setD(x => ({
    ...x,
    paradas: x.paradas.map(p => (p.id === id ? { ...p, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : p)),
    lineas: x.lineas.map(l => ({ ...l, sentidos: l.sentidos.map(s => (s.paradas.includes(id) ? { ...s, trazado: null } : s)) })), // el recorrido por calles se rehace
  }));
  async function irASitio() {
    setError(null);
    try { const p = await buscarSitio(sitio); if (!p) setError(`No encuentro «${sitio}».`); else window.dispatchEvent(new CustomEvent("diseno-centrar", { detail: p })); }
    catch { setError("No se pudo buscar el sitio (sin conexión con el buscador de mapas)."); }
  }

  const estadoTxt = { ok: guardado.en ? "✓ Guardado" : "✓ Al día", pendiente: "Cambios sin guardar…", guardando: "Guardando…", error: `No se pudo guardar: ${guardado.texto}` }[guardado.estado];
  const pest = (id, t) => <button onClick={() => setPestana(id)} style={{ flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: `2px solid ${pestana === id ? C.blue : "transparent"}`, color: pestana === id ? C.text : C.muted, fontSize: 12, fontWeight: pestana === id ? 600 : 400, cursor: "pointer", fontFamily: font }}>{t}</button>;
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, background: C.bg, fontFamily: font }}>
      <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 14px 8px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, flex: 1 }}>Diseñar la red</div>
            <span style={{ fontSize: 11, color: guardado.estado === "error" ? C.red : guardado.estado === "ok" ? C.green : C.amber }}>{estadoTxt}</span>
            {onCerrar && <button onClick={onCerrar} style={btn()}>Ver la red</button>}
          </div>
          <input value={d.operador || ""} onChange={e => setD(x => ({ ...x, operador: e.target.value }))} placeholder="Operador (empresa de autobuses)" style={{ ...inp, width: "100%", marginTop: 8 }} />
        </div>
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {pest("lineas", `Líneas (${d.lineas.length})`)}{pest("calendarios", `Calendarios (${d.calendarios.length})`)}{pest("paradas", `Paradas (${d.paradas.length})`)}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          {pestana === "lineas" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                {d.lineas.map(l => (
                  <button key={l.id} onClick={() => { setSelLinea(l.id); setDir(0); setAnadiendo(false); }} style={{ minWidth: 34, padding: "3px 8px", borderRadius: 6, background: l.color, color: C.input, fontSize: 12, fontWeight: 800, border: `2px solid ${l.id === selLinea ? "#fff" : "transparent"}`, cursor: "pointer", fontFamily: font }}>{l.nombre || "?"}</button>
                ))}
                <button onClick={nuevaLinea} style={btn(true)}>+ Nueva línea</button>
              </div>
              {linea ? <EditorLinea d={d} linea={linea} dir={dir} setDir={k => { setDir(k); setAnadiendo(false); }} anadiendo={anadiendo} setAnadiendo={setAnadiendo} cambiarLinea={cambiarLinea} cambiarSentido={cambiarSentido} paradaPorId={paradaPorId}
                onBorrar={() => { if (window.confirm(`¿Borrar la línea ${linea.nombre}?`)) { setD(x => ({ ...x, lineas: x.lineas.filter(l => l.id !== linea.id) })); setSelLinea(null); setAnadiendo(false); } }} />
                : <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
                    Empieza con <b style={{ color: C.text }}>+ Nueva línea</b> y pincha en el mapa, en orden, las paradas de la ida. Luego crea la vuelta (la ida al revés), pon el tiempo de recorrido y los horarios. Los calendarios (laborables, sábados, domingos…) se cambian en su pestaña.
                  </div>}
            </>
          )}
          {pestana === "calendarios" && <EditorCalendarios d={d} cambiar={setD} />}
          {pestana === "paradas" && <EditorParadas d={d} cambiar={setD} elegida={paradaElegida} />}
        </div>
        {avisos.length > 0 && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 14px", maxHeight: 110, overflowY: "auto", flexShrink: 0 }}>
            {avisos.slice(0, 6).map((a, i) => <div key={i} style={{ fontSize: 11, color: C.amber, lineHeight: 1.5 }}>• {a}</div>)}
          </div>
        )}
      </div>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <MapaDiseno d={d} linea={linea} dir={dir} anadiendo={anadiendo && !!linea} onPinchar={pinchar} onMoverParada={moverParada} onElegirParada={id => { setParadaElegida(id); if (!(anadiendo && linea)) setPestana("paradas"); else pinchar([paradaPorId.get(id).lat, paradaPorId.get(id).lng]); }} />
        {!d.paradas.length && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 600, background: tono("rgba(15,22,35,0.94)", "rgba(255,255,255,0.94)"), border: `1px solid ${C.border2}`, borderRadius: 9, padding: "8px 10px", display: "flex", gap: 6, alignItems: "center" }}>
            <input value={sitio} onChange={e => setSitio(e.target.value)} onKeyDown={e => e.key === "Enter" && irASitio()} placeholder="¿Dónde? (ciudad o dirección)" style={{ ...inp, width: 240 }} />
            <button onClick={irASitio} style={btn(true)}>Ir</button>
            {error && <span style={{ fontSize: 11, color: C.amber }}>{error}</span>}
          </div>
        )}
        {anadiendo && linea && <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 600, background: linea.color, color: C.input, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, boxShadow: "0 6px 20px rgba(0,0,0,.5)" }}>Línea {linea.nombre} · {dir === 0 ? "ida" : "vuelta"}: pincha en el mapa para añadir la siguiente parada</div>}
      </div>
    </div>
  );
}
