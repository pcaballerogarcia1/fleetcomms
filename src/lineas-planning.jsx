// ── Planning de proyectos "Líneas regulares" (autobuses) ──────────────
// Red de líneas importada de un GTFS: cada línea con ida y vuelta, su
// secuencia de paradas, viajes por tipo de día, tiempos de recorrido por
// franja (calculados, corregibles a mano), regulación en cabecera y los
// tipos de vehículo que admite. Nada de esto aparece en los proyectos de
// "Rutas por puntos" (residuos, reparto…), que siguen con su Planning.
import { useState, useEffect, useRef, useMemo } from "react";
import { leerGtfs } from "./gtfs-import.js";
import { FRANJAS, TIPOS_DIA } from "./gtfs-red.js";
import { TIPOS_VEHICULO, watchRed, guardarRed, watchCfg, guardarCfgLinea, tiempoEfectivo } from "./lineas-store.js";
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

function MapaRed({ red, linea, paradasPorId }) {
  const L = useLeaflet();
  const divRef = useRef(null), mapRef = useRef(null), capaRef = useRef(null);

  useEffect(() => {
    if (!L || !divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, preferCanvas: true }).setView([40.4, -3.7], 6);
    // Mismo fondo que el Planning de puntos (Esri; CARTO pide ya API key)
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}").addTo(map);
    mapRef.current = map;
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

function FichaLinea({ linea, cfg, paradasPorId, dias, onCfg, onCerrar }) {
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

// ── Página ────────────────────────────────────────────────────────────
export function PlanningLineasPage({ projectId, orgId }) {
  const [estado, setEstado] = useState({ ficha: null, red: null, cargando: true });
  const [cfg, setCfg] = useState({});
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [importando, setImportando] = useState(null); // texto del avance
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => watchRed(projectId, setEstado), [projectId]);
  useEffect(() => watchCfg(projectId, setCfg), [projectId]);

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
      setImportando("Guardando en la nube…");
      await guardarRed(projectId, orgId, r, { archivo: file.name, anterior: estado.ficha?.cloud });
      logAudit({ modulo: "Planning", accion: "Importó la red de líneas (GTFS)", detalle: `${file.name} · ${r.lineas.length} líneas · ${r.paradas.length} paradas` });
      setSel(null);
    } catch (e) {
      console.error("GTFS red:", e);
      setError(`${file.name}: ${e.message || e}`);
    } finally {
      setImportando(null);
    }
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: C.bg, fontFamily: font, minHeight: 0 }}>
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
              {configuradas > 0 && <div style={{ color: C.amber }}>{configuradas} línea(s) con configuración propia</div>}
            </div>
          )}
        </div>
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
        <MapaRed red={red} linea={linea} paradasPorId={paradasPorId} />
        {red && !linea && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 500, background: "rgba(15,22,35,0.88)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 11, color: C.muted }}>
            Elige una línea para ver su ida (continua) y vuelta (discontinua)
          </div>
        )}
      </div>

      {linea && (
        <FichaLinea key={linea.id} linea={linea} cfg={cfg[linea.id]} paradasPorId={paradasPorId} dias={red.dias}
          onCfg={cambios => guardarCfgLinea(projectId, linea.id, cambios).catch(e => alert("No se pudo guardar: " + (e.message || e)))}
          onCerrar={() => setSel(null)} />
      )}
    </div>
  );
}
