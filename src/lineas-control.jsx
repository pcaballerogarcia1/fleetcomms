// ── Control de proyectos de "Líneas regulares" (autobuses) ─────────────
// Lo programado (el servicio publicado desde el Scheduling) frente a lo que
// pasa en la calle (lo que anota el móvil de cada conductor): mapa en vivo
// con cada autobús coloreado por su puntualidad, avisos, turnos y el
// informe del día (expediciones programadas frente a realizadas).
// Los proyectos de rutas por puntos siguen con su Control (control.jsx).
import { useState, useEffect, useMemo, useRef } from "react";
import { useLeaflet } from "./use-leaflet.js";
import { watchRed } from "./lineas-store.js";
import { watchServiciosProyecto, watchTurnos, watchPosiciones } from "./lineas-servicio-store.js";
import {
  fechaLocal, minutosDesde, hhmm, cumplimiento, avisosControl, estadoPuntualidad, COLOR_PUNTUALIDAD, textoRetraso, ADELANTO_OK, RETRASO_OK, viajeActual,
} from "./lineas-servicio.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", blueDim: "#0d2550", blueText: "#b0ccff", green: "#34d399", amber: "#fbbf24", red: "#f87171", violet: "#a78bfa",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const pct = x => (x == null ? "—" : `${Math.round(x * 100)}%`);
const fechaTxt = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const SENAL_MS = 3 * 60000;

// Estado de un turno para la lista
function estadoTurno(t, u, ahora, ahoraMs) {
  if (t.finReal != null) return { id: "terminado", txt: "Terminado", color: C.dim };
  if (t.inicioReal != null) {
    if (!u || !u.activo || ahoraMs - (u.updatedAt || 0) > SENAL_MS) return { id: "marcha", txt: "Sin señal GPS", color: C.muted, sinSenal: true };
    const e = estadoPuntualidad(u.retraso);
    return { id: "marcha", txt: textoRetraso(u.retraso), color: COLOR_PUNTUALIDAD[e] };
  }
  if (ahora > t.fin) return { id: "sin", txt: "No se hizo", color: C.red };
  if (ahora > t.inicio + 5) return { id: "sin", txt: t.conductorUid ? "Sin empezar" : "Sin conductor", color: C.red };
  return { id: "pendiente", txt: `Empieza ${hhmm(t.inicio)}`, color: C.dim };
}

function MapaFlota({ red, posiciones, ahoraMs, foco, onElegir }) {
  const L = useLeaflet();
  const divRef = useRef(null), mapRef = useRef(null), lineasRef = useRef(null), busesRef = useRef(new Map());
  const elegirRef = useRef(onElegir);
  useEffect(() => { elegirRef.current = onElegir; }, [onElegir]);
  useEffect(() => {
    if (!L || !divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, preferCanvas: true }).setView([40.4, -3.7], 6);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}").addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    const buses = busesRef.current;
    // parar cualquier movimiento antes de quitar el mapa (al cambiar al informe a mitad de un zoom fallaba)
    return () => { ro.disconnect(); map.stop(); map.off(); map.remove(); mapRef.current = null; buses.clear(); };
  }, [L]);
  // la red, tenue, de fondo
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !red) return;
    if (lineasRef.current) map.removeLayer(lineasRef.current);
    const renderer = L.canvas({ padding: 0.3 });
    const g = L.layerGroup();
    for (const l of red.lineas) for (const s of l.sentidos) if (s.trazado?.length) L.polyline(s.trazado, { color: l.color, weight: 2, opacity: 0.28, renderer, interactive: false }).addTo(g);
    g.addTo(map);
    lineasRef.current = g;
    const b = L.latLngBounds(red.paradas.map(p => [p.lat, p.lng]));
    if (b.isValid()) { map.invalidateSize(); map.fitBounds(b, { padding: [30, 30], animate: false }); }
  }, [L, red]);
  // los autobuses: un marcador por conductor, se mueven en su sitio
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    const vivos = new Set();
    for (const u of posiciones) {
      if (!u.activo || ahoraMs - (u.updatedAt || 0) > 15 * 60000 || !isFinite(u.lat)) continue;
      vivos.add(u._id);
      const viejo = ahoraMs - (u.updatedAt || 0) > SENAL_MS;
      const color = viejo ? "#64748b" : COLOR_PUNTUALIDAD[estadoPuntualidad(u.retraso)];
      const sel = foco === u.turnoId;
      const html = `<div style="transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:9px;background:${color};color:#0b1220;font:800 10.5px ${font};white-space:nowrap;box-shadow:0 0 0 ${sel ? 3 : 1.5}px ${sel ? "#fff" : "#0b1220"}">${u.linea ? `<span style="opacity:.7">L${String(u.linea).replace(/</g, "")} ·</span>` : ""}${u.bus ?? "?"}</div>`;
      const tip = `${u.turnoId} · Bus ${u.bus ?? "?"} · línea ${u.linea ?? "—"}<br>${u.nombre || ""}<br>${viejo ? "sin señal" : textoRetraso(u.retraso)}${u.viaje ? `<br>${String(u.viaje).replace(/</g, "")}` : ""}`;
      let m = busesRef.current.get(u._id);
      if (!m) {
        m = L.marker([u.lat, u.lng], { icon: L.divIcon({ className: "", html, iconSize: null }), zIndexOffset: sel ? 1000 : 0 }).addTo(map);
        m.on("click", () => elegirRef.current?.(m._turno));
        busesRef.current.set(u._id, m);
      } else {
        m.setLatLng([u.lat, u.lng]);
        m.setIcon(L.divIcon({ className: "", html, iconSize: null }));
        m.setZIndexOffset(sel ? 1000 : 0);
      }
      m._turno = u.turnoId;
      m.unbindTooltip(); m.bindTooltip(tip, { direction: "top", offset: [0, -10] });
    }
    for (const [id, m] of busesRef.current) if (!vivos.has(id)) { map.removeLayer(m); busesRef.current.delete(id); }
  }, [L, posiciones, ahoraMs, foco]);
  // al elegir un turno, centrar su autobús
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !foco) return;
    const u = posiciones.find(x => x.turnoId === foco && x.activo);
    if (u && isFinite(u.lat)) map.setView([u.lat, u.lng], Math.max(map.getZoom(), 15), { animate: false });
  }, [foco]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={divRef} style={{ position: "absolute", inset: 0 }} />;
}

function DetalleTurno({ t, u, ahora, onCerrar }) {
  const sal = t.real?.salidas || {}, lle = t.real?.llegadas || {}, salt = new Set(t.real?.saltados || []);
  const actual = viajeActual(t, t.real || {});
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t.id}{t.tipo ? <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}> · {t.tipo}</span> : null}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{t.conductorNombre || "Sin conductor"} · {hhmm(t.inicio)}–{hhmm(t.fin)} · Bus {t.buses.join(" + ")}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{t.inicioReal != null ? `Empezó ${hhmm(t.inicioReal)}` : "No ha empezado"}{t.finReal != null ? ` · terminó ${hhmm(t.finReal)}` : ""}{u?.updatedAt ? ` · última posición ${new Date(u.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
        </div>
        <button onClick={onCerrar} style={{ background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {t.viajes.map((v, i) => {
          const s = sal[v.k], l = lle[v.k];
          const d = s != null ? s - v.dep : null;
          const e = d == null ? null : d < -ADELANTO_OK ? "adelantado" : d > RETRASO_OK ? (d > 10 ? "muy" : "tarde") : "ok";
          const enCurso = i === actual && t.inicioReal != null && t.finReal == null;
          const cambioBus = i > 0 && t.viajes[i - 1].bus !== v.bus;
          return (
            <div key={v.k}>
              {cambioBus && <div style={{ padding: "3px 14px", fontSize: 10.5, color: C.amber, background: "rgba(251,191,36,.06)" }}>↔ Relevo: pasa al Bus {v.bus} en {v.on || "cabecera"}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 92px", gap: 8, alignItems: "center", padding: "6px 14px", borderBottom: `1px solid ${C.border}`, opacity: v.v ? 0.55 : 1, background: enCurso ? "rgba(92,155,255,.08)" : "none" }}>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: C.text }}>{hhmm(v.dep)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {!v.v && <span style={{ display: "inline-block", minWidth: 22, padding: "0 4px", marginRight: 6, borderRadius: 4, background: v.color, color: "#0b1220", fontSize: 10, fontWeight: 800, textAlign: "center" }}>{v.l}</span>}
                    {v.v ? v.s || "Vacío" : `${v.on} → ${v.dn}`}
                  </span>
                  <span style={{ display: "block", fontSize: 10, color: C.dim }}>Bus {v.bus} · llega {hhmm(v.arr)}{l != null ? ` · llegó ${hhmm(l)}` : ""}</span>
                </span>
                <span style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: v.v ? C.dim : salt.has(v.k) ? C.red : e ? COLOR_PUNTUALIDAD[e] : enCurso ? C.blueText : ahora > v.arr ? C.red : C.dim }}>
                  {v.v ? "" : salt.has(v.k) ? "No hecha" : s != null ? `${hhmm(s)} ${textoRetraso(d) === "en hora" ? "✓" : `(${textoRetraso(d)})`}` : enCurso ? "Siguiente" : ahora > v.arr && t.inicioReal != null ? "Sin registrar" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Informe({ c, servicio, turnos }) {
  async function excel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const fila = (nombre, x) => ({
      "Línea": nombre, "Expediciones del día": x.totalDia, "Programadas hasta ahora": x.programadas, "Realizadas": x.realizadas, "En curso": x.enCurso, "No hechas": x.sinHacer,
      "Puntuales": x.puntuales, "Tarde": x.tarde, "Adelantadas": x.adelantadas, "Puntualidad": x.puntualidad == null ? "" : Math.round(x.puntualidad * 1000) / 10, "Retraso medio (min)": x.retrasoMedio == null ? "" : Math.round(x.retrasoMedio * 10) / 10,
      "Km programados": x.kmProg, "Km realizados": x.kmReal,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...c.porLinea.map(x => fila(x.linea, x)), fila("TOTAL", c)]), "Por línea");
    const exp = turnos.flatMap(t => t.viajes.filter(v => !v.v).map(v => {
      const s = t.real?.salidas?.[v.k], l = t.real?.llegadas?.[v.k];
      return { "Turno": t.id, "Conductor": t.conductorNombre || "", "Autobús": v.bus, "Línea": v.l, "Sentido": v.s, "Desde": v.on, "Hasta": v.dn, "Salida prevista": hhmm(v.dep), "Salida real": s != null ? hhmm(s) : "", "Desviación (min)": s != null ? Math.round(s - v.dep) : "", "Llegada prevista": hhmm(v.arr), "Llegada real": l != null ? hhmm(l) : "", "No hecha": (t.real?.saltados || []).includes(v.k) ? "sí" : "", "Km": v.km };
    })).sort((a, b) => a["Salida prevista"].localeCompare(b["Salida prevista"]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exp), "Expediciones");
    XLSX.writeFile(wb, `servicio_${servicio.fecha}_${String(servicio.proyecto || "").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40)}.xlsx`);
  }
  const th = { padding: "8px 10px", fontSize: 10.5, color: C.dim, fontWeight: 700, textAlign: "right", letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${C.border2}`, position: "sticky", top: 0, background: C.card };
  const td = { padding: "7px 10px", fontSize: 12, color: C.text, textAlign: "right", borderBottom: `1px solid ${C.border}`, fontFamily: mono };
  const filaTabla = (x, total) => (
    <tr key={total ? "_total" : x.linea} style={{ background: total ? C.surface2 : "none", fontWeight: total ? 700 : 400 }}>
      <td style={{ ...td, textAlign: "left", fontFamily: font }}>{total ? "Total" : <span style={{ display: "inline-block", minWidth: 26, padding: "1px 5px", borderRadius: 5, background: x.color, color: "#0b1220", fontSize: 11, fontWeight: 800, textAlign: "center" }}>{x.linea}</span>}</td>
      <td style={td}>{x.totalDia}</td><td style={td}>{x.programadas}</td>
      <td style={{ ...td, color: x.realizadas < x.programadas - x.enCurso ? C.amber : C.green }}>{x.realizadas}</td>
      <td style={td}>{x.enCurso || ""}</td><td style={{ ...td, color: x.sinHacer ? C.red : C.dim }}>{x.sinHacer || "—"}</td>
      <td style={{ ...td, color: x.puntualidad == null ? C.dim : x.puntualidad >= 0.9 ? C.green : x.puntualidad >= 0.75 ? C.amber : C.red }}>{pct(x.puntualidad)}</td>
      <td style={td}>{x.retrasoMedio == null ? "—" : `${x.retrasoMedio > 0 ? "+" : ""}${x.retrasoMedio.toFixed(1).replace(".", ",")}`}</td>
      <td style={td}>{x.kmProg.toLocaleString("es-ES")}</td><td style={td}>{x.kmReal.toLocaleString("es-ES")}</td>
    </tr>
  );
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Informe del {fechaTxt(servicio.fecha)}</div>
        <span style={{ fontSize: 11.5, color: C.muted }}>Programadas = las que ya tenían que haber salido. Puntual = sale entre {ADELANTO_OK} min antes y {RETRASO_OK} min después de su hora.</span>
        <button onClick={excel} style={{ marginLeft: "auto", padding: "6px 12px", background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.3)", color: C.green, borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Descargar Excel</button>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.card }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Línea</th><th style={th}>Del día</th><th style={th}>Programadas</th><th style={th}>Realizadas</th><th style={th}>En curso</th><th style={th}>No hechas</th><th style={th}>Puntualidad</th><th style={th}>Retraso medio</th><th style={th}>Km prog.</th><th style={th}>Km real</th>
          </tr></thead>
          <tbody>{c.porLinea.map(x => filaTabla(x, false))}{filaTabla(c, true)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function ControlLineasPage({ projectId, orgId }) {
  const [publicados, setPublicados] = useState(null);
  const [fechaSel, setFechaSel] = useState(null);
  // turnos y posiciones van con el día al que pertenecen (al cambiar de día no se mezclan)
  const [turnosDe, setTurnosDe] = useState({ sid: null, lista: [] });
  const [posDe, setPosDe] = useState({ sid: null, lista: [] });
  const [estadoRed, setEstadoRed] = useState({ red: null });
  const [vista, setVista] = useState("vivo");
  const [filtro, setFiltro] = useState("marcha");
  const [q, setQ] = useState("");
  const [foco, setFoco] = useState(null);
  const [ahoraMs, setAhoraMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhoraMs(Date.now()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => watchServiciosProyecto(projectId, orgId, setPublicados), [projectId, orgId]);
  useEffect(() => watchRed(projectId, setEstadoRed), [projectId]);
  const hoy = fechaLocal(new Date(ahoraMs));
  // por defecto: el de hoy; si no, el de ayer si aún dura (madrugada); si no, el próximo; si no, el último
  const servicio = useMemo(() => {
    const l = publicados || [];
    if (fechaSel) return l.find(p => p.fecha === fechaSel) || null;
    const ayer = l.find(p => p.fecha < hoy && minutosDesde(p.fecha, ahoraMs) < (p.resumen?.fin ?? 0));
    return l.find(p => p.fecha === hoy) || ayer || l.find(p => p.fecha > hoy) || l.at(-1) || null;
  }, [publicados, fechaSel, hoy, ahoraMs]);
  const sid = servicio?._id || null;
  useEffect(() => watchTurnos(sid, orgId, lista => setTurnosDe({ sid, lista })), [sid, orgId]);
  useEffect(() => watchPosiciones(orgId, sid, lista => setPosDe({ sid, lista })), [sid, orgId]);
  const turnos = useMemo(() => (turnosDe.sid === sid ? turnosDe.lista : []), [turnosDe, sid]);
  const posiciones = useMemo(() => (posDe.sid === sid ? posDe.lista : []), [posDe, sid]);

  const ahora = servicio ? minutosDesde(servicio.fecha, ahoraMs) : 0;
  const ubic = useMemo(() => new Map(posiciones.filter(u => u.turnoId).map(u => [u.turnoId, u])), [posiciones]);
  const ordenados = useMemo(() => [...turnos].sort((a, b) => a.num - b.num), [turnos]);
  const turnosPorId = useMemo(() => new Map(turnos.map(t => [t.id, t])), [turnos]);
  const c = useMemo(() => cumplimiento(turnos, ahora), [turnos, ahora]);
  const avisos = useMemo(() => avisosControl(turnos, ubic, ahora, ahoraMs), [turnos, ubic, ahora, ahoraMs]);
  const estados = useMemo(() => new Map(turnos.map(t => [t.id, estadoTurno(t, ubic.get(t.id), ahora, ahoraMs)])), [turnos, ubic, ahora, ahoraMs]);
  const cuenta = id => ordenados.filter(t => estados.get(t.id)?.id === id).length;
  const enCalle = posiciones.filter(u => u.activo && ahoraMs - (u.updatedAt || 0) <= SENAL_MS).length;
  const visibles = ordenados.filter(t => (filtro === "todos" || estados.get(t.id)?.id === filtro) && (!q.trim() || norm(`${t.id} ${t.conductorNombre} ${t.buses.join(" ")} ${t.lineas.join(" ")}`).includes(norm(q.trim()))));
  const elegido = foco ? turnosPorId.get(foco) : null;

  if (publicados === null) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: font, fontSize: 13, background: C.bg }}>Cargando…</div>;
  if (!publicados.length) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font, padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Aún no hay ningún día publicado</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
          En <b style={{ color: C.text }}>Scheduling</b>, con los turnos hechos (paso 2), pulsa <b style={{ color: C.text }}>Publicar a Control</b> y elige el día. Los conductores cogerán su turno en el móvil («Mi turno») y aquí verás cada autobús en el mapa, si va a su hora y lo que se va haciendo.
        </div>
      </div>
    </div>
  );

  const kpi = (titulo, valor, sub, color) => (
    <div style={{ padding: "0 14px", borderLeft: `1px solid ${C.border}`, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || C.text, fontFamily: mono, marginTop: 1, whiteSpace: "nowrap" }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
  const pestana = (id, txt) => <button onClick={() => setVista(id)} style={{ padding: "10px 4px", marginRight: 18, background: "none", border: "none", borderBottom: `2px solid ${vista === id ? C.blue : "transparent"}`, color: vista === id ? C.text : C.muted, fontSize: 12.5, fontWeight: vista === id ? 600 : 400, cursor: "pointer", fontFamily: font }}>{txt}</button>;
  const chip = (id, txt) => <button key={id} onClick={() => setFiltro(id)} style={{ padding: "3px 9px", borderRadius: 12, border: `1px solid ${filtro === id ? C.blue : C.border}`, background: filtro === id ? C.blueDim : "none", color: filtro === id ? C.blueText : C.muted, fontSize: 11, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>{txt}</button>;
  const esHoy = servicio.fecha === hoy || (servicio.fecha < hoy && ahora < (servicio.resumen?.fin ?? 0));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.border}`, background: C.card, gap: 6, flexShrink: 0, overflowX: "auto" }}>
        <div style={{ paddingRight: 8, flexShrink: 0 }}>
          <select value={servicio.fecha} onChange={e => setFechaSel(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font }}>
            {publicados.map(p => <option key={p._id} value={p.fecha}>{fechaTxt(p.fecha)}{p.fecha === hoy ? " (hoy)" : ""}</option>)}
          </select>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3 }}>{servicio.nombreDia} · {esHoy ? `ahora ${hhmm(ahora)}` : servicio.fecha > hoy ? "aún no ha llegado" : "día pasado"}</div>
        </div>
        {kpi("Turnos en marcha", `${cuenta("marcha")}/${turnos.length}`, `${cuenta("terminado")} terminados`)}
        {kpi("Autobuses en la calle", enCalle, `${servicio.resumen?.autobuses ?? "—"} en el servicio`)}
        {kpi("Expediciones hechas", `${c.realizadas}/${c.programadas}`, `${c.enCurso} en curso · ${c.totalDia} en el día`, c.sinHacer ? C.amber : C.text)}
        {kpi("Puntualidad", pct(c.puntualidad), `${c.tarde} tarde · ${c.adelantadas} adelantadas`, c.puntualidad == null ? C.text : c.puntualidad >= 0.9 ? C.green : c.puntualidad >= 0.75 ? C.amber : C.red)}
        {kpi("Avisos", avisos.length, avisos.filter(a => a.grave).length ? `${avisos.filter(a => a.grave).length} graves` : "ninguno grave", avisos.some(a => a.grave) ? C.red : avisos.length ? C.amber : C.green)}
      </div>
      <div style={{ display: "flex", alignItems: "center", padding: "0 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {pestana("vivo", "En vivo")}
        {pestana("informe", "Informe del día")}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 10.5, color: C.dim }}>
          {[["ok", `en hora (−${ADELANTO_OK}/+${RETRASO_OK})`], ["tarde", "tarde"], ["muy", "+10 min"], ["adelantado", "adelantado"]].map(([k, t]) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: 5, background: COLOR_PUNTUALIDAD[k] }} />{t}</span>)}
        </span>
      </div>
      {vista === "informe" ? <Informe c={c} servicio={servicio} turnos={ordenados} /> : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
            <MapaFlota red={estadoRed.red} posiciones={posiciones} ahoraMs={ahoraMs} foco={foco} onElegir={setFoco} />
            {!enCalle && <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 500, background: "rgba(15,22,35,0.9)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 11px", fontSize: 11.5, color: C.muted, maxWidth: 420 }}>Ningún autobús enviando posición ahora mismo. Aparecen cuando el conductor empieza su turno en el móvil («Mi turno»).</div>}
          </div>
          <div style={{ width: 400, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {elegido ? <DetalleTurno t={elegido} u={ubic.get(elegido.id)} ahora={ahora} onCerrar={() => setFoco(null)} /> : (
              <>
                {avisos.length > 0 && (
                  <div style={{ maxHeight: "38%", overflowY: "auto", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                    <div style={{ padding: "9px 14px 4px", fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>Avisos ({avisos.length})</div>
                    {avisos.slice(0, 60).map((a, i) => (
                      <button key={i} onClick={() => setFoco(a.turno)} style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%", textAlign: "left", padding: "6px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: font }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0, background: a.grave ? C.red : a.tipo === "adelantado" ? C.violet : a.tipo === "sin_senal" ? C.muted : C.amber }} />
                        <span style={{ fontSize: 11.5, color: C.text, lineHeight: 1.4 }}>{a.texto}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ padding: "10px 14px 8px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar turno, conductor, bus o línea…" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {chip("marcha", `En marcha ${cuenta("marcha")}`)}{chip("sin", `Sin empezar ${cuenta("sin")}`)}{chip("pendiente", `Más tarde ${cuenta("pendiente")}`)}{chip("terminado", `Terminados ${cuenta("terminado")}`)}{chip("todos", `Todos ${turnos.length}`)}
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {visibles.map(t => {
                    const e = estados.get(t.id), u = ubic.get(t.id);
                    return (
                      <button key={t.id} onClick={() => setFoco(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "7px 14px", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: font }}>
                        <span style={{ width: 42, fontSize: 12, fontWeight: 700, color: C.text }}>{t.id}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 11.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.conductorNombre || <span style={{ color: C.dim }}>sin conductor</span>}</span>
                          <span style={{ display: "block", fontSize: 10.5, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hhmm(t.inicio)}–{hhmm(t.fin)} · Bus {u?.bus ?? t.buses.join("+")} · {u?.linea ? `ahora línea ${u.linea}` : `líneas ${t.lineas.slice(0, 4).join(", ")}`}</span>
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: e.color, whiteSpace: "nowrap" }}>{e.txt}</span>
                      </button>
                    );
                  })}
                  {!visibles.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>Ningún turno en este grupo.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
