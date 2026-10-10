// ── Planning de proyectos "Líneas regulares" (autobuses) ──────────────
// Red de líneas importada de un GTFS: cada línea con ida y vuelta, su
// secuencia de paradas, viajes por tipo de día, tiempos de recorrido por
// franja (calculados, corregibles a mano), regulación en cabecera y los
// tipos de vehículo que admite. Nada de esto aparece en los proyectos de
// "Rutas por puntos" (residuos, reparto…), que siguen con su Planning.
import { useState, useEffect, useRef, useMemo } from "react";
import { leerGtfs } from "./gtfs-import.js";
import { FRANJAS, TIPOS_DIA, filtrarRed, viajesLinea } from "./gtfs-red.js";
import { TIPOS_VEHICULO, watchRed, guardarRed, watchCfg, guardarCfgLinea, tiempoEfectivo, watchCocheras, cambiarCocheras, asegurarResumenRed, anotarCambioPlanning } from "./lineas-store.js";
import { Horarios } from "./lineas-horarios.jsx";
import { nombreDia, cabecerasDeRed } from "./lineas-sched.js";
import { logAudit } from "./audit.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", green: "#34d399", amber: "#fbbf24", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fmtFecha = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }) : "—");

// ── Mapa (Leaflet, el mismo que usa el resto de la app) ───────────────
function useLeaflet() {
  const [L, setL] = useState(() => window.L || null);
  useEffect(() => {
    if (window.L) return;
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    let js = document.getElementById("leaflet-js");
    if (!js) {
      js = document.createElement("script");
      js.id = "leaflet-js"; js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      document.head.appendChild(js);
    }
    const ok = () => setL(window.L);
    js.addEventListener("load", ok);
    return () => js.removeEventListener("load", ok);
  }, []);
  return L;
}

// km en línea recta (para enseñar a qué distancia queda cada cochera)
function kmEntre(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function MapaRed({ red, linea, paradasPorId, cocheras = [], poniendoCochera, onClickMapa, onMoverCochera }) {
  const L = useLeaflet();
  const divRef = useRef(null), mapRef = useRef(null), capaRef = useRef(null), cocherasRef = useRef(null);
  const clickRef = useRef(null);
  useEffect(() => { clickRef.current = poniendoCochera ? onClickMapa : null; }, [poniendoCochera, onClickMapa]);
  const moverRef = useRef(onMoverCochera);
  useEffect(() => { moverRef.current = onMoverCochera; }, [onMoverCochera]);

  useEffect(() => {
    if (!L || !divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, preferCanvas: true }).setView([40.4, -3.7], 6);
    // Mismo fondo que el Planning de puntos (Esri; CARTO pide ya API key)
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}").addTo(map);
    mapRef.current = map;
    map.on("click", e => clickRef.current?.(e.latlng));
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [L]);

  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    if (capaRef.current) { map.removeLayer(capaRef.current); capaRef.current = null; }
    if (!red) return;
    const renderer = L.canvas({ padding: 0.3 });
    const g = L.layerGroup();
    if (linea) {
      for (const s of linea.sentidos) {
        if (s.trazado.length) L.polyline(s.trazado, { color: linea.color, weight: s.dir === 0 ? 5 : 3, opacity: 0.95, dashArray: s.dir === 1 ? "8 7" : null, renderer }).addTo(g);
      }
      const vistas = new Set();
      linea.sentidos.forEach(s => s.paradas.forEach((id, k) => {
        const p = paradasPorId.get(id);
        if (!p || vistas.has(id)) return;
        vistas.add(id);
        const cab = k === 0 || k === s.paradas.length - 1;
        L.circleMarker([p.lat, p.lng], { radius: cab ? 7 : 4, color: "#0b1220", weight: 1.5, fillColor: cab ? "#fff" : linea.color, fillOpacity: 1, renderer })
          .bindTooltip(`${p.nombre} · ${p.codigo}`, { direction: "top" }).addTo(g);
      }));
      const b = L.latLngBounds(linea.sentidos.flatMap(s => s.trazado));
      g.addTo(map);
      map.invalidateSize();
      if (b.isValid()) { map.stop(); map.fitBounds(b, { padding: [40, 40], maxZoom: 16, animate: false }); }
    } else {
      for (const l of red.lineas) for (const s of l.sentidos) {
        if (s.trazado.length) L.polyline(s.trazado, { color: l.color, weight: 2, opacity: 0.55, renderer, interactive: false }).addTo(g);
      }
      g.addTo(map);
      map.invalidateSize();
      const b = L.latLngBounds(red.paradas.map(p => [p.lat, p.lng]));
      if (b.isValid()) { map.stop(); map.fitBounds(b, { padding: [30, 30], animate: false }); }
    }
    capaRef.current = g;
  }, [L, red, linea, paradasPorId]);

  // Cocheras: encima de todo, se arrastran para moverlas
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    if (cocherasRef.current) map.removeLayer(cocherasRef.current);
    const g = L.layerGroup();
    for (const c of cocheras) {
      if (!isFinite(c.lat) || !isFinite(c.lng)) continue;
      const icono = L.divIcon({
        className: "", iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<div style="width:26px;height:26px;border-radius:6px;background:#fb923c;border:2px solid #0b1220;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0b1220" stroke-width="2.4"><path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8"/><line x1="7" y1="17" x2="17" y2="17"/></svg></div>',
      });
      const m = L.marker([c.lat, c.lng], { icon: icono, draggable: true, zIndexOffset: 1000 }).bindTooltip(`${c.nombre || "Cochera"} · arrastra para moverla`, { direction: "top" });
      m.on("dragend", () => { const p = m.getLatLng(); moverRef.current?.(c.id, p.lat, p.lng); });
      m.addTo(g);
    }
    g.addTo(map);
    cocherasRef.current = g;
  }, [L, cocheras]);

  useEffect(() => {
    if (divRef.current) divRef.current.style.cursor = poniendoCochera ? "crosshair" : "";
    const cont = mapRef.current?.getContainer();
    if (cont) cont.style.cursor = poniendoCochera ? "crosshair" : "";
  }, [poniendoCochera]);

  return <div ref={divRef} style={{ position: "absolute", inset: 0, background: C.bg }} />;
}

// ── Ficha de una línea ────────────────────────────────────────────────
function Insignia({ linea, grande }) {
  return (
    <span style={{
      minWidth: grande ? 44 : 34, padding: grande ? "4px 8px" : "2px 5px", borderRadius: 6, background: linea.color, color: "#0b1220",
      fontSize: grande ? 15 : 11, fontWeight: 800, textAlign: "center", flexShrink: 0, display: "inline-block",
    }}>{linea.nombre}</span>
  );
}

function NumeroEditable({ valor, placeholder, onGuardar, sufijo = "min", ancho = 56 }) {
  const [txt, setTxt] = useState(valor ?? "");
  const [editando, setEditando] = useState(false);
  const mostrado = editando ? txt : (valor ?? "");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input value={mostrado} placeholder={placeholder}
        onFocus={() => { setTxt(valor ?? ""); setEditando(true); }}
        onChange={e => setTxt(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
        onBlur={() => { setEditando(false); const n = txt === "" ? null : Number(txt); if (n !== (valor ?? null)) onGuardar(n); }}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{
          width: ancho, background: C.bg, border: `1px solid ${valor != null ? C.amber : C.border}`, color: C.text,
          borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: mono, textAlign: "right", outline: "none",
        }} />
      <span style={{ fontSize: 10.5, color: C.dim }}>{sufijo}</span>
    </span>
  );
}

function FichaLinea({ linea, cfg, paradasPorId, dias, onCfg, onCerrar, cocheras = [] }) {
  const [tab, setTab] = useState("sentidos");
  const [abierto, setAbierto] = useState(null); // sentido con la lista de paradas desplegada
  const tipos = cfg?.tipos || [];
  const tabBtn = (k, t) => (
    <button key={k} onClick={() => setTab(k)} style={{
      flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: `2px solid ${tab === k ? C.blue : "transparent"}`,
      color: tab === k ? C.text : C.muted, fontWeight: tab === k ? 600 : 400, fontSize: 12, fontFamily: font, cursor: "pointer",
    }}>{t}</button>
  );
  return (
    <div style={{ width: 400, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Insignia linea={linea} grande />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {linea.largo || linea.sentidos.map(s => s.cabecera).join(" ↔ ")}
            </div>
            <div style={{ fontSize: 11, color: C.dim }}>{linea.tipo}{linea.agencia ? ` · ${linea.agencia}` : ""}</div>
          </div>
          <button onClick={onCerrar} title="Cerrar" style={{ background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {tabBtn("sentidos", "Ida y vuelta")}{tabBtn("tiempos", "Tiempos")}{tabBtn("vehiculos", "Vehículos")}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {tab === "sentidos" && linea.sentidos.map(s => (
          <div key={s.dir} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: s.dir === 0 ? C.green : C.amber }}>{s.dir === 0 ? "IDA (OUTBOUND)" : "VUELTA (INBOUND)"}</span>
              <span style={{ fontSize: 10.5, color: C.dim }}>{s.dir === 0 ? "línea continua" : "línea discontinua"} en el mapa</span>
            </div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>→ {s.cabecera || "—"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
              {[["Paradas", s.paradas.length], ["Longitud", s.km != null ? `${s.km.toLocaleString("es-ES")} km` : "—"], ["Horario", s.primera ? `${s.primera}–${s.ultima}` : "—"]].map(([k, v]) => (
                <div key={k}><div style={{ fontSize: 10, color: C.dim }}>{k}</div><div style={{ fontSize: 12, color: C.text, fontFamily: mono }}>{v}</div></div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {TIPOS_DIA.map(t => (
                <span key={t.id} title={dias?.[t.id] ? `Día de referencia: ${fmtFecha(dias[t.id])}` : "Sin servicio ese tipo de día"} style={{ fontSize: 11, color: C.muted, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 7px" }}>
                  {t.nombre}: <b style={{ color: C.text }}>{s.viajes[t.id] ?? 0}</b> viajes
                </span>
              ))}
            </div>
            <button onClick={() => setAbierto(abierto === s.dir ? null : s.dir)} style={{ background: "none", border: "none", color: C.blue, fontSize: 11.5, cursor: "pointer", padding: 0, fontFamily: font }}>
              {abierto === s.dir ? "Ocultar paradas" : `Ver las ${s.paradas.length} paradas en orden`}
            </button>
            {abierto === s.dir && (
              <ol style={{ margin: "8px 0 0", paddingLeft: 22, maxHeight: 260, overflowY: "auto" }}>
                {s.paradas.map((id, k) => {
                  const p = paradasPorId.get(id);
                  return <li key={`${id}-${k}`} style={{ fontSize: 11.5, color: k === 0 || k === s.paradas.length - 1 ? C.text : C.muted, padding: "2px 0" }}>
                    {p?.nombre || id} <span style={{ color: C.dim, fontFamily: mono, fontSize: 10 }}>{p?.codigo}</span>
                  </li>;
                })}
              </ol>
            )}
          </div>
        ))}

        {tab === "tiempos" && (
          <div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
              Minutos de cabecera a cabecera por franja horaria, calculados con la mediana de los viajes de un laborable ({fmtFecha(dias?.laborable)}). Escribe un valor para corregirlo; vacío vuelve al calculado.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                <th style={{ textAlign: "left", color: C.dim, fontSize: 10, fontWeight: 600, padding: "4px 0" }}>FRANJA</th>
                {linea.sentidos.map(s => <th key={s.dir} style={{ textAlign: "right", color: C.dim, fontSize: 10, fontWeight: 600, padding: "4px 0" }}>{s.nombre.toUpperCase()}</th>)}
              </tr></thead>
              <tbody>
                {FRANJAS.map(f => (
                  <tr key={f.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 0", color: C.text, fontFamily: mono }}>{f.id.replace("-", "–")} h</td>
                    {linea.sentidos.map(s => {
                      const t = tiempoEfectivo(s, f.id, cfg);
                      const calc = s.tiempos.find(x => x.franja === f.id);
                      return (
                        <td key={s.dir} style={{ textAlign: "right", padding: "4px 0" }}>
                          <NumeroEditable valor={cfg?.tiempos?.[`${s.dir}|${f.id}`] ?? null}
                            placeholder={calc?.min != null ? String(calc.min) : "—"}
                            onGuardar={n => onCfg({ tiempos: { [`${s.dir}|${f.id}`]: n } })} />
                          <div style={{ fontSize: 9.5, color: t.manual ? C.amber : C.dim }}>{t.manual ? "corregido" : calc ? `${calc.viajes} viajes` : "sin viajes"}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.surface2, borderRadius: 8, padding: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Regulación en cabecera</div>
                <div style={{ fontSize: 10.5, color: C.dim }}>Margen mínimo entre la llegada de un viaje y la salida del siguiente</div>
              </div>
              <NumeroEditable valor={cfg?.regulacion ?? null} placeholder="5" onGuardar={n => onCfg({ regulacion: n })} />
            </div>
          </div>
        )}

        {tab === "vehiculos" && (
          <div>
            <SelectorCocheraLinea linea={linea} cfg={cfg} cocheras={cocheras} paradasPorId={paradasPorId} onCfg={onCfg} />
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
              Tipos de vehículo que pueden hacer esta línea. Al planificar, solo se asignarán vehículos de estos tipos (sin marcar ninguno, vale cualquiera).
            </div>
            {TIPOS_VEHICULO.map(t => {
              const on = tipos.includes(t.id);
              return (
                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, marginBottom: 4, background: on ? `${C.blue}18` : "none", border: `1px solid ${on ? `${C.blue}55` : C.border}`, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => {
                    const nuevos = on ? tipos.filter(x => x !== t.id) : [...tipos, t.id];
                    onCfg({ tipos: nuevos, ...(on && cfg?.preferente === t.id ? { preferente: null } : {}) });
                  }} />
                  <span style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: C.text }}>{t.nombre}</div>
                    <div style={{ fontSize: 10.5, color: C.dim }}>{t.detalle}</div>
                  </span>
                  {on && (
                    <button onClick={e => { e.preventDefault(); onCfg({ preferente: cfg?.preferente === t.id ? null : t.id }); }} style={{
                      fontSize: 10.5, padding: "2px 7px", borderRadius: 5, cursor: "pointer", fontFamily: font,
                      background: cfg?.preferente === t.id ? C.green : "none", color: cfg?.preferente === t.id ? "#0b1220" : C.muted,
                      border: `1px solid ${cfg?.preferente === t.id ? C.green : C.border2}`, fontWeight: 700,
                    }}>{cfg?.preferente === t.id ? "Preferente" : "Marcar preferente"}</button>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Cochera de la línea: fija o la más cercana a su primera cabecera
function SelectorCocheraLinea({ linea, cfg, cocheras, paradasPorId, onCfg }) {
  const inicio = paradasPorId.get(linea.sentidos[0]?.paradas[0]);
  const dist = c => (inicio && isFinite(c.lat) ? kmEntre(inicio, c) * 1.35 : null);
  const cercana = cocheras.reduce((m, c) => (dist(c) != null && (!m || dist(c) < dist(m)) ? c : m), null);
  const fija = cocheras.find(c => String(c.id) === String(cfg?.cochera));
  const km = c => (dist(c) != null ? ` · ${dist(c).toFixed(1).replace(".", ",")} km` : "");
  return (
    <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>Cochera de la línea</div>
      {cocheras.length ? (
        <select value={fija ? String(fija.id) : ""} onChange={e => onCfg({ cochera: e.target.value || null })} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 7, padding: "7px 9px", fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">La más cercana ({cercana?.nombre || "—"}{cercana ? km(cercana) : ""})</option>
          {cocheras.map(c => <option key={c.id} value={String(c.id)}>{c.nombre || "Cochera"}{km(c)}</option>)}
        </select>
      ) : (
        <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.5 }}>Aún no hay cocheras. Añádelas en la lista de la izquierda («Cocheras») para que el Scheduling calcule las salidas y vueltas a cochera.</div>
      )}
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>Los autobuses de esta línea salen de esta cochera y vuelven a ella; los km en vacío se calculan en el Scheduling.</div>
    </div>
  );
}

// Lista de cocheras del proyecto
function PanelCocheras({ cocheras, poniendo, setPoniendo, onCambiar, cfg }) {
  const [abierto, setAbierto] = useState(true);
  const usos = c => Object.values(cfg).filter(x => String(x?.cochera) === String(c.id)).length;
  return (
    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setAbierto(a => !a)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, fontFamily: font }}>
          {abierto ? "▾" : "▸"} Cocheras {cocheras.length ? `(${cocheras.length})` : ""}
        </button>
        <button onClick={() => setPoniendo(p => !p)} style={{ marginLeft: "auto", fontSize: 11, padding: "3px 9px", borderRadius: 6, cursor: "pointer", fontFamily: font, fontWeight: 600,
          background: poniendo ? "#fb923c" : "none", color: poniendo ? "#0b1220" : "#fb923c", border: "1px solid #fb923c88" }}>{poniendo ? "Pincha en el mapa…" : "+ Añadir"}</button>
      </div>
      {abierto && (
        <div style={{ marginTop: 8 }}>
          {!cocheras.length && <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.5 }}>Sin cochera, el Scheduling no puede calcular las salidas y vueltas a cochera ni sus km en vacío.</div>}
          {cocheras.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: "#fb923c", flexShrink: 0 }} />
              <input defaultValue={c.nombre || ""} placeholder="Nombre de la cochera" onBlur={e => { const n = e.target.value.trim(); if (n && n !== c.nombre) onCambiar(l => l.map(x => (x.id === c.id ? { ...x, nombre: n } : x))); }}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "4px 7px", fontSize: 11.5, fontFamily: font, outline: "none" }} />
              <span title="Líneas que la tienen fijada (el resto usa la más cercana)" style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>{usos(c) ? `${usos(c)} lín.` : ""}</span>
              <button title="Quitar cochera" onClick={() => { if (window.confirm(`¿Quitar la cochera «${c.nombre || "sin nombre"}»?`)) onCambiar(l => l.filter(x => x.id !== c.id)); }} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 15, padding: "0 2px" }}>×</button>
            </div>
          ))}
          {cocheras.length > 0 && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Arrastra la cochera en el mapa para moverla.</div>}
        </div>
      )}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────
// ── Puntos de relevo: cabeceras donde el Scheduling puede cambiar de conductor ──
function PuntosRelevo({ red, cfg, onGuardar }) {
  const cabs = useMemo(() => cabecerasDeRed(red), [red]);
  const [q, setQ] = useState("");
  const no = new Set(cfg._relevos?.no || []);
  const permitido = c => !c.paradas.some(x => no.has(x));
  const vis = cabs.filter(c => !q.trim() || norm(`${c.nombre} ${c.lineas.join(" ")}`).includes(norm(q.trim())));
  const poner = (lista, si) => {
    const n = new Set(no);
    for (const c of lista) for (const x of c.paradas) { if (si) n.delete(x); else n.add(x); }
    onGuardar([...n]);
  };
  const conRelevo = cabs.filter(permitido).length;
  const btn = { background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: font };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
      <div style={{ maxWidth: 900 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Puntos de relevo</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>
          Marca las cabeceras donde se puede cambiar de conductor. El Scheduling solo corta las piezas (relevos) en las marcadas; si una pieza tiene que cortarse a la fuerza (pieza máxima o conducción) donde no se puede, se corta en el último punto de relevo anterior. Al principio y al final del autobús (cochera) siempre hay relevo.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px", flexWrap: "wrap" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cabecera o línea…" style={{ width: 280, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
          <button onClick={() => poner(vis, true)} style={btn}>{q ? "Permitir en las encontradas" : "Permitir en todas"}</button>
          <button onClick={() => poner(vis, false)} style={btn}>{q ? "Quitar en las encontradas" : "Quitar en todas"}</button>
          <span style={{ fontSize: 12, color: conRelevo === cabs.length ? C.muted : C.amber, marginLeft: "auto" }}>
            Se puede relevar en {conRelevo} de {cabs.length} cabeceras
          </span>
        </div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.card }}>
          {vis.map(c => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", opacity: permitido(c) ? 1 : 0.6 }}>
              <input type="checkbox" checked={permitido(c)} onChange={e => poner([c], e.target.checked)} style={{ width: 16, height: 16, accentColor: C.green, cursor: "pointer" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nombre}</span>
                <span style={{ display: "block", fontSize: 10.5, color: C.dim, marginTop: 2 }}>Líneas {c.lineas.join(", ")}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: permitido(c) ? C.green : C.red, whiteSpace: "nowrap" }}>{permitido(c) ? "Se puede relevar" : "Sin relevo"}</span>
            </label>
          ))}
          {!vis.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>Ninguna cabecera con «{q}».</div>}
        </div>
      </div>
    </div>
  );
}

// ── Al importar: elegir qué líneas y qué calendarios del GTFS se quedan ──
function ElegirImportacion({ archivo, red, onImportar, onCancelar }) {
  const [lineas, setLineas] = useState(() => new Set(red.lineas.map(l => l.id)));
  const [cals, setCals] = useState(() => new Set((red.calendarios || []).map(c => c.id)));
  const [q, setQ] = useState("");
  const hayCals = (red.calendarios || []).length > 0;
  const calsElegidos = useMemo(() => (red.calendarios || []).filter(c => cals.has(c.id)), [red, cals]);
  const viajes = useMemo(() => new Map(red.lineas.map(l => [l.id, hayCals ? viajesLinea(l, calsElegidos) : l.sentidos.reduce((n, s) => n + (s.viajes?.laborable || 0), 0)])), [red, calsElegidos, hayCals]);
  const visibles = useMemo(() => {
    const t = norm(q).trim();
    return red.lineas.filter(l => !t || norm(`${l.nombre} ${l.largo} ${l.agencia} ${l.sentidos.map(s => s.cabecera).join(" ")}`).includes(t));
  }, [red, q]);
  const alternar = (setSet, id) => setSet(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcarVisibles = si => setLineas(prev => { const n = new Set(prev); for (const l of visibles) { if (si) n.add(l.id); else n.delete(l.id); } return n; });
  const totalViajes = red.lineas.reduce((n, l) => n + (lineas.has(l.id) ? viajes.get(l.id) : 0), 0);
  const puede = lineas.size > 0 && (!hayCals || cals.size > 0);
  const casilla = (marcada, onClick) => <input type="checkbox" checked={marcada} onChange={onClick} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer", flexShrink: 0 }} />;
  const boton = (txt, onClick, fuerte = false, deshabilitado = false) => (
    <button onClick={onClick} disabled={deshabilitado} style={{ padding: fuerte ? "9px 18px" : "5px 10px", borderRadius: 7, border: `1px solid ${fuerte ? C.blue : C.border}`, background: fuerte ? (deshabilitado ? C.surface2 : "#16306a") : "transparent", color: fuerte ? "#cfe0ff" : C.muted, fontSize: fuerte ? 12.5 : 11, fontWeight: fuerte ? 700 : 500, cursor: deshabilitado ? "not-allowed" : "pointer", fontFamily: font }}>{txt}</button>
  );
  const columna = { display: "flex", flexDirection: "column", minHeight: 0, border: `1px solid ${C.border}`, borderRadius: 10, background: C.card };
  const cabeza = { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(1100px, 100%)", height: "min(760px, 100%)", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 12, display: "flex", flexDirection: "column", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
        <div style={{ padding: "16px 20px 10px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Qué quieres importar de «{archivo}»</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Marca las líneas y los calendarios que quieres en este proyecto. Lo que no marques no se guarda (se puede volver a importar cuando quieras).</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: hayCals ? "3fr 2fr" : "1fr", gap: 14, padding: "4px 20px 12px" }}>
          <div style={columna}>
            <div style={cabeza}>
              <b style={{ fontSize: 12, color: C.text }}>Líneas</b>
              <span style={{ fontSize: 11, color: C.dim }}>{lineas.size} de {red.lineas.length}</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea, cabecera, operador…" style={{ flex: 1, minWidth: 160, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
              {boton(q ? "Marcar las encontradas" : "Todas", () => marcarVisibles(true))}
              {boton(q ? "Quitar las encontradas" : "Ninguna", () => marcarVisibles(false))}
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {visibles.map(l => (
                <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", opacity: lineas.has(l.id) ? 1 : 0.55 }}>
                  {casilla(lineas.has(l.id), () => alternar(setLineas, l.id))}
                  <Insignia linea={l} />
                  <span style={{ flex: 1, fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.largo || l.sentidos.map(s => s.cabecera).filter(Boolean).join(" – ") || "—"}</span>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: mono, whiteSpace: "nowrap" }}>{viajes.get(l.id).toLocaleString("es-ES")} viajes</span>
                </label>
              ))}
              {!visibles.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>Ninguna línea con «{q}».</div>}
            </div>
          </div>
          {hayCals && (
            <div style={columna}>
              <div style={cabeza}>
                <b style={{ fontSize: 12, color: C.text }}>Calendarios</b>
                <span style={{ fontSize: 11, color: C.dim }}>{cals.size} de {red.calendarios.length}</span>
                <span style={{ flex: 1 }} />
                {boton("Todos", () => setCals(new Set(red.calendarios.map(c => c.id))))}
                {boton("Ninguno", () => setCals(new Set()))}
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {red.calendarios.map(c => (
                  <label key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", opacity: cals.has(c.id) ? 1 : 0.55 }}>
                    {casilla(cals.has(c.id), () => alternar(setCals, c.id))}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12, color: C.text }}>{c.nombre}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: C.dim, marginTop: 2 }}>{c.fechas.length} día{c.fechas.length === 1 ? "" : "s"} · {c.viajes.toLocaleString("es-ES")} viajes{c.codigos?.length ? ` · ${c.codigos.join(", ")}` : ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: `1px solid ${C.border}` }}>
          <span style={{ flex: 1, fontSize: 12, color: puede ? C.muted : C.amber }}>
            {puede ? `Se importarán ${lineas.size} línea${lineas.size === 1 ? "" : "s"}${hayCals ? ` y ${cals.size} calendario${cals.size === 1 ? "" : "s"}` : ""} · ${totalViajes.toLocaleString("es-ES")} viajes` : `Marca al menos una línea${hayCals ? " y un calendario" : ""}.`}
          </span>
          {boton("Cancelar", onCancelar)}
          {boton("Importar", () => onImportar(filtrarRed(red, { lineas: [...lineas], calendarios: [...cals] })), true, !puede)}
        </div>
      </div>
    </div>
  );
}

export function PlanningLineasPage({ projectId, orgId }) {
  const [estado, setEstado] = useState({ ficha: null, red: null, cargando: true });
  const [cfg, setCfg] = useState({});
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [importando, setImportando] = useState(null); // texto del avance
  const [error, setError] = useState(null);
  const [eligiendo, setEligiendo] = useState(null);
  const [vista, setVista] = useState("red"); // red · horarios · relevos // { archivo, red } leído del GTFS, a falta de elegir qué se queda
  const fileRef = useRef(null);

  useEffect(() => watchRed(projectId, setEstado), [projectId]);
  // la tarjeta del proyecto (lista de proyectos) enseña el resumen de la red
  const vRed = estado.ficha?.cloud?.v;
  useEffect(() => { if (vRed && estado.red) asegurarResumenRed(projectId, estado.ficha, estado.red).catch(() => {}); }, [projectId, vRed, estado.red]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => watchCfg(projectId, setCfg), [projectId]);
  const [cocheras, setCocheras] = useState([]);
  const [poniendoCochera, setPoniendoCochera] = useState(false);
  useEffect(() => watchCocheras(projectId, setCocheras), [projectId]);
  // cada cambio se aplica sobre la lista del servidor (no se pisa a otros)
  const cambiarListaCocheras = cambio => {
    setCocheras(l => cambio(l));
    cambiarCocheras(projectId, orgId, cambio)
      .then(() => anotarCambioPlanning(projectId, "cocheras"))
      .catch(e => alert("No se pudo guardar la cochera: " + (e.message || e)));
  };
  const anadirCochera = ({ lat, lng }) => {
    setPoniendoCochera(false);
    const nueva = { id: `c${Date.now().toString(36)}`, nombre: `Cochera ${cocheras.length + 1}`, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, fields: {} };
    cambiarListaCocheras(l => [...l, nueva]);
    logAudit({ modulo: "Planning", accion: "Añadió una cochera", detalle: nueva.nombre });
  };

  const red = estado.red;
  const paradasPorId = useMemo(() => new Map((red?.paradas || []).map(p => [p.id, p])), [red]);
  const lista = useMemo(() => {
    const t = norm(q).trim();
    return (red?.lineas || []).filter(l => !t || norm(`${l.nombre} ${l.largo} ${l.agencia} ${l.tipo} ${l.sentidos.map(s => s.cabecera).join(" ")}`).includes(t));
  }, [red, q]);
  const linea = sel ? red?.lineas.find(l => l.id === sel) || null : null;
  const configuradas = Object.values(cfg).filter(c => c?.tipos?.length || c?.regulacion != null || Object.keys(c?.tiempos || {}).length).length;

  async function importar(file) {
    if (!file) return;
    if (estado.red && !window.confirm(`Sustituir la red actual (${estado.red.lineas.length} líneas) por la de «${file.name}»? La configuración de las líneas que se llamen igual se conserva.`)) return;
    setError(null); setImportando("Leyendo GTFS…");
    try {
      const r = await leerGtfs(file, (f, t) => setImportando(`${t.replace(/….*$/, "")} ${Math.round(f * 100)} %`), "red");
      if (!r.lineas.length) throw new Error("el GTFS no tiene líneas con viajes");
      setEligiendo({ archivo: file.name, red: r }); // se guarda al confirmar en la ventana
    } catch (e) {
      console.error("GTFS red:", e);
      setError(`${file.name}: ${e.message || e}`);
    } finally {
      setImportando(null);
    }
  }
  async function guardarElegida(r) {
    const { archivo, red: completa } = eligiendo;
    setEligiendo(null); setError(null); setImportando("Guardando en la nube…");
    try {
      await guardarRed(projectId, orgId, r, { archivo, anterior: estado.ficha?.cloud });
      const parcial = r.lineas.length < completa.lineas.length || (r.calendarios || []).length < (completa.calendarios || []).length;
      logAudit({ modulo: "Planning", accion: "Importó la red de líneas (GTFS)", detalle: `${archivo} · ${r.lineas.length}${parcial ? ` de ${completa.lineas.length}` : ""} líneas · ${(r.calendarios || []).length} calendarios · ${r.paradas.length} paradas` });
      setSel(null);
    } catch (e) {
      console.error("GTFS red:", e);
      setError(`${archivo}: ${e.message || e}`);
    } finally {
      setImportando(null);
    }
  }

  const guardarSalidas = (lineaId, nombreLinea, clave, lista) => {
    const [dir, ...d] = clave.split("|");
    const dia = d.join("|");
    const que = `horarios de salida de la línea ${nombreLinea} (${dir === "0" ? "ida" : "vuelta"}, ${nombreDia(dia, red)})`;
    guardarCfgLinea(projectId, lineaId, { salidas: { [clave]: lista } }, { detalle: que })
      .then(() => logAudit({ modulo: "Planning", accion: lista ? "Cambió los horarios de salida" : "Volvió a los horarios del GTFS", detalle: que }))
      .catch(e => alert("No se pudo guardar: " + (e.message || e)));
  };
  const guardarTiempo = (lineaId, nombreLinea, clave, min) => {
    const [dir, franja] = clave.split("|");
    const que = `tiempo de recorrido de la línea ${nombreLinea} (${dir === "0" ? "ida" : "vuelta"}, ${franja.replace("-", "–")} h)`;
    guardarCfgLinea(projectId, lineaId, { tiempos: { [clave]: min } }, { detalle: que })
      .then(() => logAudit({ modulo: "Planning", accion: min == null ? "Volvió al tiempo de recorrido calculado" : "Cambió un tiempo de recorrido", detalle: `${que}${min != null ? `: ${min} min` : ""}` }))
      .catch(e => alert("No se pudo guardar: " + (e.message || e)));
  };
  const guardarRelevos = no => {
    const n = cabecerasDeRed(red).filter(c => c.paradas.some(x => no.includes(x))).length;
    guardarCfgLinea(projectId, "_relevos", { no }, { detalle: n ? `puntos de relevo (${n} cabecera${n > 1 ? "s" : ""} sin relevo)` : "puntos de relevo (en todas las cabeceras)" })
      .then(() => logAudit({ modulo: "Planning", accion: "Cambió los puntos de relevo", detalle: `${n} cabeceras sin relevo` }))
      .catch(e => alert("No se pudo guardar: " + (e.message || e)));
  };
  const pestana = (id, txt) => (
    <button onClick={() => setVista(id)} style={{ padding: "10px 4px", marginRight: 20, background: "none", border: "none", borderBottom: `2px solid ${vista === id ? C.blue : "transparent"}`, color: vista === id ? C.text : C.muted, fontSize: 12.5, fontWeight: vista === id ? 600 : 400, cursor: "pointer", fontFamily: font }}>{txt}</button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: C.bg, fontFamily: font, minHeight: 0 }}>
      {red && (
        <div style={{ display: "flex", alignItems: "center", padding: "0 18px", borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
          {pestana("red", "Red y mapa")}
          {pestana("horarios", "Horarios de salida")}
          {pestana("relevos", "Puntos de relevo")}
          {vista === "horarios" && <span style={{ fontSize: 11, color: C.dim }}>Pincha una hora de salida o un tiempo de recorrido para cambiarlo. Los cambios los usa el Scheduling (y avisa de que el Planning ha cambiado).</span>}
        </div>
      )}
      {red && vista === "relevos" ? <PuntosRelevo red={red} cfg={cfg} onGuardar={guardarRelevos} /> : red && vista === "horarios" ? <Horarios red={red} cfg={cfg} editable onGuardar={guardarSalidas} onGuardarTiempo={guardarTiempo} /> : (
    <div style={{ display: "flex", flex: 1, width: "100%", background: C.bg, fontFamily: font, minHeight: 0 }}>
      {eligiendo && <ElegirImportacion archivo={eligiendo.archivo} red={eligiendo.red} onImportar={guardarElegida} onCancelar={() => setEligiendo(null)} />}
      {/* Lista de líneas */}
      <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Red de líneas</div>
          <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; importar(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!importando} style={{
            width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.blue}55`, background: importando ? C.surface2 : "#16306a",
            color: "#a3c4fc", fontSize: 12, fontWeight: 600, cursor: importando ? "wait" : "pointer", fontFamily: font,
          }}>{importando || (red ? "Sustituir red (GTFS .zip)" : "Importar red (GTFS .zip)")}</button>
          {error && <div style={{ fontSize: 11, color: C.red, marginTop: 8 }}>{error}</div>}
          {estado.ficha && (
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
              <div>{estado.ficha.archivo || "Red importada"} · {(estado.ficha.totalLineas || 0).toLocaleString("es-ES")} líneas · {(estado.ficha.totalMarkers || 0).toLocaleString("es-ES")} paradas</div>
              {estado.ficha.agencias?.length > 0 && <div>Operadores: {estado.ficha.agencias.join(", ")}</div>}
              <div>Días de referencia: {TIPOS_DIA.map(t => `${t.nombre.split(" ")[0].toLowerCase()} ${fmtFecha(estado.ficha.dias?.[t.id])}`).join(" · ")}</div>
              {red?.calendarios?.length > 0 && <div>{red.calendarios.length} calendario{red.calendarios.length > 1 ? "s" : ""} en el GTFS (se eligen en Scheduling)</div>}
              {configuradas > 0 && <div style={{ color: C.amber }}>{configuradas} línea(s) con configuración propia</div>}
            </div>
          )}
        </div>
        {red && <PanelCocheras cocheras={cocheras} poniendo={poniendoCochera} setPoniendo={setPoniendoCochera} onCambiar={cambiarListaCocheras} cfg={cfg} />}
        {red && (
          <div style={{ padding: "10px 14px 6px" }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea, cabecera, operador…" style={{
              width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text,
              borderRadius: 7, padding: "7px 10px", fontSize: 12, fontFamily: font, outline: "none",
            }} />
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>{lista.length.toLocaleString("es-ES")} líneas</div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
          {estado.cargando && <div style={{ fontSize: 12, color: C.dim, padding: 14 }}>Cargando la red…</div>}
          {!estado.cargando && !red && !importando && (
            <div style={{ fontSize: 12, color: C.muted, padding: 14, lineHeight: 1.6 }}>
              Este proyecto es de <b style={{ color: C.text }}>Líneas regulares</b>. Importa el GTFS de la red (el .zip que publica el operador o el consorcio) para ver las líneas con su ida y vuelta, los viajes por tipo de día y los tiempos de recorrido.
            </div>
          )}
          {lista.slice(0, 400).map(l => {
            const activa = l.id === sel;
            const lab = l.sentidos.reduce((s, x) => s + (x.viajes.laborable || 0), 0);
            const c = cfg[l.id];
            return (
              <button key={l.id} onClick={() => setSel(activa ? null : l.id)} style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 7, marginBottom: 2,
                background: activa ? `${l.color}22` : "none", border: `1px solid ${activa ? l.color : "transparent"}`, cursor: "pointer", fontFamily: font,
              }}>
                <Insignia linea={l} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.sentidos.map(s => s.cabecera).filter(Boolean).join(" ↔ ") || l.largo || l.tipo}
                  </div>
                  <div style={{ fontSize: 10, color: C.dim }}>
                    {l.sentidos.length === 2 ? "Ida y vuelta" : "Un sentido"} · {lab.toLocaleString("es-ES")} viajes laborable{c?.tipos?.length ? ` · ${c.tipos.length} tipo(s) de vehículo` : ""}
                  </div>
                </span>
              </button>
            );
          })}
          {lista.length > 400 && <div style={{ fontSize: 11, color: C.dim, padding: 8 }}>…y {lista.length - 400} más: escribe para buscar</div>}
        </div>
      </div>

      {/* Mapa */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <MapaRed red={red} linea={linea} paradasPorId={paradasPorId} cocheras={cocheras} poniendoCochera={poniendoCochera} onClickMapa={anadirCochera}
          onMoverCochera={(id, lat, lng) => cambiarListaCocheras(l => l.map(c => (c.id === id ? { ...c, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : c)))} />
        {poniendoCochera && (
          <div style={{ position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 600, background: "#fb923c", color: "#0b1220", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, boxShadow: "0 6px 20px rgba(0,0,0,.5)" }}>
            Pincha en el mapa donde está la cochera · <button onClick={() => setPoniendoCochera(false)} style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontWeight: 700, color: "#0b1220", fontFamily: font }}>cancelar</button>
          </div>
        )}
        {red && !linea && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 500, background: "rgba(15,22,35,0.88)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 11, color: C.muted }}>
            Elige una línea para ver su ida (continua) y vuelta (discontinua)
          </div>
        )}
      </div>

      {linea && (
        <FichaLinea key={linea.id} linea={linea} cfg={cfg[linea.id]} paradasPorId={paradasPorId} dias={red.dias} cocheras={cocheras}
          onCfg={cambios => guardarCfgLinea(projectId, linea.id, cambios, { nombreLinea: linea.nombre }).catch(e => alert("No se pudo guardar: " + (e.message || e)))}
          onCerrar={() => setSel(null)} />
      )}
    </div>
      )}
    </div>
  );
}
