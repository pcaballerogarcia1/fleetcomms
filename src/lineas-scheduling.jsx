// ── Scheduling de proyectos "Líneas regulares" ────────────────────────
// Misma estructura y aspecto que el Scheduling de rutas por puntos
// (pestañas, barra de herramientas, Restricciones, barra de indicadores
// KpiBar, Gantt con vista Tabla/Compacta y zoom) con lo propio de los
// autobuses: los viajes de cada línea en su color, los relevos de conductor
// (T12) y la pestaña de horarios de salida. El cálculo está en lineas-sched.js.
import { useState, useEffect, useMemo, useRef } from "react";
import { TIPOS_DIA, FRANJAS, franjaDe } from "./gtfs-red.js";
import { TIPOS_VEHICULO, watchRed, watchCfg, watchSchedParams, guardarSchedParams, watchCocheras, cambiarManuales } from "./lineas-store.js";
import { generarVehiculos, generarTurnos, moverViaje, moverPieza, moverViajes, moverViajesTurno, esCambioVehiculos, esCambioTurnos, aplicarCambios, claveViaje, clavePieza, ID_COCHERA, PARAMS_DEFECTO, TIPOS_TURNO_DEFECTO, salidasDe, duracionViaje, costeDia, OBJETIVOS, OBJETIVOS_VEHICULOS, OBJETIVOS_TURNOS, esCalendario, nombreDia, viajesDia, resumenServicio, nombreEstrategia, CAMPOS_ESTRATEGIA, CAMPOS_VEHICULOS } from "./lineas-sched.js";
import { minToHHMM } from "./gtfs-parse.js";
import { KpiBar } from "./scheduling.jsx";
import { logAudit } from "./audit.js";

// Mismos colores y tipografías que scheduling.jsx
const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  blue: "#5c9bff", blueDim: "#0d2550", blueText: "#b0ccff",
  green: "#34d399", greenDim: "#082a18",
  orange: "#fb923c", red: "#f87171", amber: "#fbbf24",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
};
const font = "'Inter',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hm = m => (m == null ? "—" : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`);
// antes de las 00:00 (un autobús que sale de cochera la víspera): "23:40 (−1)"
const hhmm = m => (m == null ? "—" : m < 0 ? `${minToHHMM(m + 1440).slice(0, 5)} (−1)` : minToHHMM(m).slice(0, 5));
const horaEje = m => minToHHMM(((m % 1440) + 1440) % 1440).slice(0, 5);
const num = n => Math.round(n).toLocaleString("es-ES");
const nombreTipo = id => TIPOS_VEHICULO.find(t => t.id === id)?.nombre || "";
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4];
const PAGINA = 150;
const ROW_H = 34;

// ── Filas del Gantt: autobuses (vista Vehículos) o turnos (Trabajadores) ──
function filasDe(res, modo) {
  if (modo === "vehicles") {
    return res.autobuses.map(b => {
      const bloques = b.bloques.map(id => res.vehiculos.find(v => v.id === id)).filter(Boolean).sort((x, y) => x.inicio - y.inicio);
      const viajes = bloques.flatMap(x => x.viajes);
      const vacios = bloques.slice(1).map((x, i) => ({ inicio: bloques[i].fin, fin: x.inicio }));
      const relevos = bloques.flatMap(x => x.relevos);
      return fila(`Bus ${b.id}`, nombreTipo(b.tipo) || "—", viajes, {
        id: b.id, vacios, relevos, bloques: bloques.length, avisos: bloques.flatMap(x => x.avisos || []), manual: bloques.some(x => x.manual),
      });
    });
  }
  return res.turnos.map(t => {
    const viajes = t.piezas.flatMap(pz => pz.viajes);
    const tramosPausa = t.piezas.slice(1).map((pz, i) => ({ inicio: t.piezas[i].fin, fin: pz.inicio }));
    const buses = t.piezas.map(pz => res.vehiculos.find(v => v.id === pz.vehiculo)?.autobus);
    return fila(`T${t.id}`, `${t.tipoNombre ? `${t.tipoNombre} · ` : t.tipo === null ? "Sin tipo · " : ""}${t.piezas.length} pieza${t.piezas.length > 1 ? "s" : ""}${t.partidos && t.tipo !== "partido" ? " · partido" : ""}`, viajes, {
      id: t.id, tramosPausa, avisos: t.avisos, trabajo: t.trabajo, detalle: `Bus ${[...new Set(buses)].join(" + ")}`, manual: !!t.manual,
      relevos: t.piezas.map(pz => ({ inicio: pz.inicio, turno: t.id })),
      piezaDe: new Map(t.piezas.flatMap(pz => pz.viajes.map(v => [v, clavePieza(pz)]))),
    });
  });
}
function fila(nombre, tipo, viajes, extra) {
  const inicio = viajes[0]?.dep ?? 0, fin = viajes.at(-1)?.arr ?? 0;
  const conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  const pausas = (extra.tramosPausa || []).reduce((s, x) => s + (x.fin - x.inicio), 0);
  return {
    nombre, tipo, viajes, inicio, fin, amplitud: fin - inicio, conduccion, pausas,
    km: viajes.reduce((s, v) => s + v.km, 0), kmVacio: viajes.reduce((s, v) => s + (v.vacio ? v.km : 0), 0), nViajes: viajes.filter(v => !v.vacio).length,
    lineas: [...new Set(viajes.filter(v => !v.vacio).map(v => v.nombre))], avisos: [], relevos: [], vacios: [], tramosPausa: [], ...extra,
  };
}

const COLS = [
  { k: "avisos", l: "", w: 22, align: "center", t: "Avisos de reglas (pasa el ratón por el !)" },
  { k: "nombre", l: "Recurso", w: 92, align: "left" },
  { k: "tipo", l: "Tipo", w: 86, align: "left" },
  { k: "inicio", l: "Inicio", w: 80 },
  { k: "fin", l: "Fin", w: 50 },
  { k: "amplitud", l: "Amplitud", w: 62 },
  { k: "conduccion", l: "Conduc.", w: 58, t: "Tiempo con viajeros" },
  { k: "pausas", l: "Pausas", w: 52, t: "Pausa entre piezas del turno" },
  { k: "km", l: "Km", w: 52, t: "Km totales, con los vacíos" },
  { k: "kmVacio", l: "Vacío", w: 50, t: "Km en vacío (cochera y entre cabeceras)" },
  { k: "nViajes", l: "Viajes", w: 50 },
];
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0) + 8;
const celda = (r, k) => {
  if (k === "nombre") return r.manual ? `${r.nombre} ✎` : r.nombre;
  if (k === "inicio" || k === "fin") return hhmm(r[k]);
  if (k === "amplitud" || k === "conduccion" || k === "pausas") return r[k] ? hm(r[k]) : "—";
  if (k === "km" || k === "kmVacio") return Math.round(r[k]).toLocaleString("es-ES");
  return r[k];
};

function Gantt({ res, modo, filtro, paradasPorId, onMover }) {
  const [vista, setVista] = useState(() => { try { return localStorage.getItem("fc_gantt_vista") || "tabla"; } catch { return "tabla"; } });
  const cambiarVista = v => { setVista(v); try { localStorage.setItem("fc_gantt_vista", v); } catch { /* sin almacenamiento */ } };
  const [px, setPx] = useState(1);
  const [orden, setOrden] = useState(null); // { k, dir }
  const [n, setN] = useState(PAGINA);
  const [tip, setTip] = useState(null);
  const [arr, setArr] = useState(null); // lo que se arrastra: { tipo, clave | claves, origen }
  // Ctrl/⌘ + clic: varias expediciones (vehículos) o viajes de turnos (trabajadores) para moverlas juntas
  const [sel, setSel] = useState(() => new Set());
  // filas fijas arriba para trabajar entre ellas (se anclan con 📌)
  const [anclados, setAnclados] = useState([]);
  const alternarAncla = id => setAnclados(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]));
  useEffect(() => {
    const tecla = e => { if (e.key === "Escape") setSel(s => (s.size ? new Set() : s)); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  const [sobre, setSobre] = useState(null); // fila donde se soltaría (id, o "nuevo")
  const todas = useMemo(() => filasDe(res, modo), [res, modo]);
  const filas = useMemo(() => {
    const t = norm(filtro).trim();
    let l = t ? todas.filter(r => r.lineas.some(x => norm(x) === t || norm(x).startsWith(t))) : todas;
    if (orden) l = [...l].sort((a, b) => (a[orden.k] > b[orden.k] ? 1 : a[orden.k] < b[orden.k] ? -1 : 0) * orden.dir);
    return l;
  }, [todas, filtro, orden]);
  const filasAncladas = anclados.map(id => todas.find(r => r.id === id)).filter(Boolean);
  const normales = anclados.length ? filas.filter(r => !anclados.includes(r.id)) : filas;
  if (!todas.length) return null;
  const ini = Math.floor(Math.min(...todas.map(r => r.inicio)) / 60) * 60;
  const fin = Math.ceil(Math.max(...todas.map(r => r.fin)) / 60) * 60;
  const X = m => (m - ini) * px;
  const ancho = (fin - ini) * px;
  const leftW = vista === "tabla" ? TABLE_W : 200;
  const horas = Array.from({ length: (fin - ini) / 60 + 1 }, (_, k) => ini + k * 60);
  const cadaH = px * 60 < 20 ? 4 : px * 60 < 40 ? 2 : 1; // etiquetas del eje sin montarse
  const nombre = id => paradasPorId.get(id)?.nombre || id;
  const claveDe = (x, r) => (modo === "vehicles" ? claveViaje(x) : r.piezaDe?.get(x));
  // la zona verde es "nuevo": autobús o turno nuevo (destino null)
  const soltar = destino => {
    if (arr && onMover && onMover(arr.tipo, arr.claves || arr.clave, destino === "nuevo" ? null : destino) && arr.claves) setSel(new Set());
    setArr(null); setSobre(null);
  };
  const tipoVarios = modo === "vehicles" ? "viajes" : "viajesTurno";
  const zonaDe = id => ({
    onDragOver: e => { if (!arr || id === arr.origen) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== id) setSobre(id); },
    onDrop: e => { e.preventDefault(); soltar(id); },
  });
  const tot = filas.reduce((a, r) => ({ km: a.km + r.km, kv: a.kv + r.kmVacio, v: a.v + r.nViajes, c: a.c + r.conduccion }), { km: 0, kv: 0, v: 0, c: 0 });

  const chincheta = r => (
    <button onClick={e => { e.stopPropagation(); alternarAncla(r.id); }} title={anclados.includes(r.id) ? "Desanclar" : "Anclar arriba (para trabajar con esta fila a mano)"}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginRight: 4, fontSize: 10, opacity: anclados.includes(r.id) ? 1 : 0.28, filter: anclados.includes(r.id) ? "none" : "grayscale(1)" }}>📌</button>
  );
  const pintarFila = (r, ri) => (
          <div key={r.nombre} {...zonaDe(r.id)} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.border}`, background: sobre === r.id ? "rgba(92,155,255,0.18)" : ri % 2 ? "rgba(23,32,53,0.45)" : "transparent", outline: sobre === r.id ? `1px solid ${C.blue}` : "none", outlineOffset: -1, width: leftW + ancho }}>
            <div style={{ width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 4, background: ri % 2 ? "#141d30" : C.bg, display: "flex", alignItems: "center", padding: "0 4px", borderRight: `1px solid ${C.border}` }}>
              {vista === "tabla" ? COLS.map(col => (
                <div key={col.k} title={col.k === "avisos" && r.avisos.length ? r.avisos.map(a => `• ${a}`).join("\n") : col.k === "nombre" && r.detalle ? r.detalle : undefined}
                  style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", fontFamily: col.k === "nombre" || col.k === "tipo" ? font : mono,
                    fontSize: col.k === "nombre" ? 11.5 : 10.5, fontWeight: col.k === "nombre" ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    color: col.k === "avisos" ? C.red : col.k === "amplitud" ? C.green : col.k === "km" ? C.orange : col.k === "kmVacio" ? "#94a3b8" : col.k === "nombre" ? C.text : C.muted }}>
                  {col.k === "avisos" ? (r.avisos.length ? "!" : "") : col.k === "nombre" ? <>{chincheta(r)}{celda(r, col.k)}</> : celda(r, col.k)}
                </div>
              )) : (
                <div style={{ paddingLeft: 6, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: C.text, fontWeight: 700 }}>{chincheta(r)}{r.nombre} <span style={{ color: C.dim, fontWeight: 400 }}>{r.detalle || r.tipo}</span></div>
                  <div style={{ fontSize: 9.5, color: C.dim, fontFamily: mono }}>{hhmm(r.inicio)}–{hhmm(r.fin)} · {hm(r.amplitud)} · {r.nViajes} viajes</div>
                </div>
              )}
            </div>
            <div style={{ position: "relative", width: ancho, flexShrink: 0 }}>
              {horas.map(h => <div key={h} style={{ position: "absolute", left: X(h), top: 0, bottom: 0, width: 1, background: "rgba(88,130,225,0.07)" }} />)}
              {r.vacios.map((x, i) => (
                <div key={`v${i}`} title={`Sin servicio (en cochera) ${hhmm(x.inicio)}–${hhmm(x.fin)}`} style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.36, height: ROW_H * 0.28,
                  background: "repeating-linear-gradient(135deg, #92400e 0px, #92400e 6px, #fb923c55 6px, #fb923c55 12px)", borderRadius: 3, opacity: 0.6 }} />
              ))}
              {r.tramosPausa.map((x, i) => (
                <div key={`p${i}`} title={`Pausa ${hm(x.fin - x.inicio)}`} style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.3, height: ROW_H * 0.4,
                  background: "repeating-linear-gradient(45deg,rgba(34,211,238,0.15) 0,rgba(34,211,238,0.15) 4px,transparent 4px,transparent 8px)", border: "1px dashed rgba(34,211,238,0.4)", borderRadius: 3 }} />
              ))}
              {r.viajes.map((x, i) => {
                const w = Math.max(2, (x.arr - x.dep) * px - 1);
                return (
                  <div key={i} className="sched-block"
                    draggable={!!onMover && !x.vacio}
                    onClick={e => {
                      if (x.vacio || !onMover) return;
                      if (e.ctrlKey || e.metaKey) { const k = claveViaje(x); setSel(s0 => { const s1 = new Set(s0); if (s1.has(k)) s1.delete(k); else s1.add(k); return s1; }); }
                      else if (sel.size) setSel(new Set());
                    }}
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = "move"; setTip(null);
                      const k = claveViaje(x);
                      if (sel.has(k)) { e.dataTransfer.setData("text/plain", [...sel].join(",")); setArr({ tipo: tipoVarios, claves: [...sel], origen: null }); return; }
                      if (sel.size) setSel(new Set());
                      e.dataTransfer.setData("text/plain", claveDe(x, r) || ""); setArr({ tipo: modo === "vehicles" ? "viaje" : "pieza", clave: claveDe(x, r), origen: r.id });
                    }}
                    onDragEnd={() => { setArr(null); setSobre(null); }}
                    onMouseEnter={e => !arr && setTip({ x, r, cx: e.clientX, cy: e.clientY })}
                    onMouseMove={e => setTip(t => (t ? { ...t, cx: e.clientX, cy: e.clientY } : t))}
                    onMouseLeave={() => setTip(null)}
                    style={{ ...(!x.vacio && sel.has(claveViaje(x)) ? { outline: "2px solid #fff", boxShadow: `0 0 0 4px ${C.blue}aa`, zIndex: 2 } : {}), ...(arr && !x.vacio && (arr.claves ? arr.claves.includes(claveViaje(x)) : claveDe(x, r) === arr.clave) ? { opacity: 0.4, outline: "2px solid #fff" } : {}), cursor: onMover && !x.vacio ? "grab" : "default", ...(x.vacio ? {
                      position: "absolute", left: X(x.dep), width: w, top: 9, height: ROW_H - 18, borderRadius: 3,
                      background: "repeating-linear-gradient(135deg, #475569 0px, #475569 4px, #64748b 4px, #64748b 8px)", border: "1px solid #94a3b8",
                      color: "#e2e8f0", fontSize: 8.5, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 2, lineHeight: `${ROW_H - 20}px`,
                    } : {
                      position: "absolute", left: X(x.dep), width: w, top: 6, height: ROW_H - 12, borderRadius: 4,
                      background: x.color + (x.dir === 1 ? "b0" : "e0"), border: `1px solid ${x.color}`, color: "#0b1220", fontSize: 9.5, fontWeight: 800,
                      overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3, lineHeight: `${ROW_H - 14}px`,
                    }) }}>{x.vacio ? (w > 34 && x.hacia ? `→${x.hacia}` : w > 14 ? "V" : "") : w > 20 ? x.nombre : ""}</div>
                );
              })}
              {r.relevos.map((x, i) => (
                <div key={`r${i}`} title={`Relevo · turno T${x.turno}`} style={{ position: "absolute", left: X(x.inicio) - 1, top: 2, bottom: 2, width: 2, background: "#fff", zIndex: 3 }}>
                  {modo === "vehicles" && <span style={{ position: "absolute", left: 2, top: -1, fontSize: 8.5, color: C.text, fontFamily: mono, whiteSpace: "nowrap", background: "rgba(11,18,32,0.85)", borderRadius: 2, padding: "0 2px", lineHeight: "11px" }}>T{x.turno}</span>}
                </div>
              ))}
            </div>
          </div>
  );
  const barraBtn = (on) => ({ padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontFamily: font, fontSize: 10.5, background: on ? C.blue : "none", color: on ? "#fff" : C.muted, fontWeight: on ? 600 : 400 });
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Controles del Gantt (como en el de puntos) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2 }}>
          <button onClick={() => cambiarVista("tabla")} style={barraBtn(vista === "tabla")}>Tabla</button>
          <button onClick={() => cambiarVista("compacta")} style={barraBtn(vista === "compacta")}>Compacta</button>
        </div>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700 }}>ZOOM</span>
        <div style={{ display: "flex", gap: 2 }}>
          {ZOOM_STEPS.map(z => <button key={z} onClick={() => setPx(z)} style={{ ...barraBtn(px === z), border: `1px solid ${px === z ? C.blue : C.border}`, fontFamily: mono }}>{z}×</button>)}
        </div>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700, marginLeft: 6 }}>ORDENAR</span>
        {[["inicio", "Salida"], ["amplitud", "Amplitud"], ["nViajes", "Viajes"]].map(([k, l]) => (
          <button key={k} onClick={() => setOrden(o => (o?.k === k ? (o.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 }))} style={{ ...barraBtn(orden?.k === k), border: `1px solid ${orden?.k === k ? C.blue : C.border}`, fontFamily: mono }}>
            {l} {orden?.k === k ? (orden.dir === 1 ? "↑" : "↓") : ""}
          </button>
        ))}
        {modo === "workers" && res.kpis.turnosConAviso > 0 && <span style={{ fontSize: 11, color: C.red, fontFamily: mono }}>! {res.kpis.turnosConAviso} con avisos</span>}
        {sel.size > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", fontSize: 11.5, color: C.text, background: C.blueDim, border: `1px solid ${C.blue}`, borderRadius: 6, padding: "3px 6px 3px 10px" }}>
            {sel.size} {modo === "vehicles" ? "expedicion(es)" : "viaje(s)"} elegidos · arrástralos a otro {modo === "vehicles" ? "autobús" : "turno"}
            <button onClick={() => { if (onMover && onMover(tipoVarios, [...sel], null)) setSel(new Set()); }} style={{ background: C.green, border: "none", color: "#06281a", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>A {modo === "vehicles" ? "uno nuevo" : "un turno nuevo"}</button>
            <button onClick={() => setSel(new Set())} title="Quitar la selección (Esc)" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }}>✕</button>
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0, position: "relative" }} onMouseLeave={() => setTip(null)}>
        {/* Cabecera */}
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 5, background: C.card, borderBottom: `1px solid ${C.border2}`, width: leftW + ancho }}>
          <div style={{ width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 6, background: C.card, display: "flex", alignItems: "center", padding: "0 4px", height: 30, borderRight: `1px solid ${C.border}` }}>
            {vista === "tabla" ? COLS.map(col => (
              <div key={col.k} title={col.t} onClick={() => col.k !== "avisos" && setOrden(o => (o?.k === col.k ? (o.dir === 1 ? { k: col.k, dir: -1 } : null) : { k: col.k, dir: 1 }))}
                style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", fontSize: 9, color: orden?.k === col.k ? C.blue : C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, cursor: col.k !== "avisos" ? "pointer" : "default", whiteSpace: "nowrap", overflow: "hidden" }}>
                {col.k === "avisos" ? "!" : col.l}{orden?.k === col.k ? (orden.dir === 1 ? " ↑" : " ↓") : ""}
              </div>
            )) : <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700, paddingLeft: 8 }}>{modo === "vehicles" ? "AUTOBÚS" : "TURNO"}</span>}
          </div>
          <div style={{ position: "relative", width: ancho, height: 30, flexShrink: 0 }}>
            {horas.filter((h, i) => i % cadaH === 0).map(h => <span key={h} style={{ position: "absolute", left: X(h), top: 9, fontSize: 10, color: C.dim, fontFamily: mono, transform: "translateX(-50%)" }}>{horaEje(h)}</span>)}
          </div>
        </div>

        {arr && (
          <div {...zonaDe("nuevo")} style={{ position: "sticky", top: 30, left: 0, zIndex: 6, width: "100%", maxWidth: "100vw", height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600,
            background: sobre === "nuevo" ? "rgba(52,211,153,0.25)" : "rgba(52,211,153,0.10)", color: C.green, border: `1px dashed ${C.green}`, boxSizing: "border-box" }}>
            Suelta aquí para {modo === "vehicles" ? "un autobús nuevo" : "un turno nuevo"} · o sobre {modo === "vehicles" ? "otro autobús" : "otro turno"}
          </div>
        )}
        {filasAncladas.length > 0 && (
          // Ancladas: fijas arriba mientras se recorre el resto (para pasar piezas entre ellas)
          <div style={{ position: "sticky", top: arr ? 60 : 30, zIndex: 5, background: C.bg, borderBottom: `2px solid ${C.blue}`, boxShadow: "0 6px 14px rgba(0,0,0,0.45)", width: leftW + ancho }}>
            <div style={{ position: "sticky", left: 0, display: "flex", alignItems: "center", gap: 10, height: 22, padding: "0 10px", fontSize: 10, color: C.blueText, fontWeight: 700, letterSpacing: 0.5, width: "max-content" }}>
              📌 {filasAncladas.length} {modo === "vehicles" ? "autobús(es)" : "turno(s)"} anclado(s) arriba
              <button onClick={() => setAnclados([])} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 4, padding: "1px 7px", fontSize: 10, cursor: "pointer", fontFamily: font }}>Desanclar todos</button>
            </div>
            {filasAncladas.map((r, ri) => pintarFila(r, ri))}
          </div>
        )}
        {normales.slice(0, n).map((r, ri) => pintarFila(r, ri))}

        {/* Totales (como la fila de la vista Tabla del de puntos) */}
        {vista === "tabla" && filas.length > 0 && (
          <div style={{ display: "flex", height: 30, position: "sticky", bottom: 0, zIndex: 5, background: C.surface2, borderTop: `1px solid ${C.border2}`, width: leftW + ancho }}>
            <div style={{ width: leftW, flexShrink: 0, position: "sticky", left: 0, background: C.surface2, display: "flex", alignItems: "center", padding: "0 4px", borderRight: `1px solid ${C.border}`, fontFamily: mono, fontSize: 10.5, fontWeight: 700, color: C.text }}>
              <span style={{ width: COLS[0].w + COLS[1].w + COLS[2].w, padding: "0 5px" }}>{filas.length.toLocaleString("es-ES")} {modo === "vehicles" ? "autobuses" : "turnos"}</span>
              <span style={{ width: COLS.slice(3, 6).reduce((s, c) => s + c.w, 0) }} />
              <span style={{ width: COLS[6].w, textAlign: "right", padding: "0 5px", whiteSpace: "nowrap" }}>{num(tot.c / 60)} h</span>
              <span style={{ width: COLS[7].w }} />
              <span style={{ width: COLS[8].w, textAlign: "right", padding: "0 5px" }}>{num(tot.km)}</span>
              <span style={{ width: COLS[9].w, textAlign: "right", padding: "0 5px" }}>{num(tot.kv)}</span>
              <span style={{ width: COLS[10].w, textAlign: "right", padding: "0 5px" }}>{num(tot.v)}</span>
            </div>
          </div>
        )}
        {filas.length > n && (
          <div style={{ padding: 12, position: "sticky", left: 0 }}>
            <button onClick={() => setN(x => x + PAGINA)} style={{ padding: "5px 12px", borderRadius: 6, background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12, cursor: "pointer", fontFamily: font }}>
              Mostrar {Math.min(PAGINA, filas.length - n)} más ({num(filas.length - n)} restantes)
            </button>
          </div>
        )}
      </div>

      {tip && (
        <div style={{ position: "fixed", left: Math.min(tip.cx + 14, window.innerWidth - 280), top: Math.max(tip.cy - 80, 8), background: C.card, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "11px 14px", zIndex: 2000, boxShadow: "0 8px 28px rgba(0,0,0,.6)", fontSize: 12, color: C.text, minWidth: 200, maxWidth: 280, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ minWidth: 30, padding: "1px 5px", borderRadius: 4, background: tip.x.color, color: tip.x.vacio ? "#fff" : "#0b1220", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{tip.x.nombre}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>{tip.x.sentido}</span>
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{hhmm(tip.x.dep)} {nombre(tip.x.o)}</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{hhmm(tip.x.arr)} {nombre(tip.x.d)}</div>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>{tip.x.arr - tip.x.dep} min · {tip.x.km.toLocaleString("es-ES")} km · {tip.r.nombre}{tip.r.detalle ? ` (${tip.r.detalle})` : ""}</div>
          {onMover && !tip.x.vacio && <div style={{ fontSize: 10, color: C.blueText, marginTop: 4 }}>Arrastra para {modo === "vehicles" ? "llevar la expedición a otro autobús" : "llevar la pieza entera a otro turno"} · Ctrl+clic para elegir varios {modo === "vehicles" ? "y moverlos juntos" : "viajes sueltos y moverlos juntos"}</div>}
        </div>
      )}
    </div>
  );
}

// ── Tipos de turno (duty types) ─────────────────────────────────────────
const aHHMM = m => `${String(Math.floor((m ?? 0) / 60)).padStart(2, "0")}:${String((m ?? 0) % 60).padStart(2, "0")}`;
const deHHMM = v => { const [a, b] = String(v || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
function TiposTurno({ tipos, onChange }) {
  const lista = tipos || [];
  const cambiar = (i, cambio) => onChange(lista.map((x, k) => (k === i ? { ...x, ...cambio } : x)));
  const estiloCampo = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "3px 5px", fontSize: 12, fontFamily: mono, outline: "none", colorScheme: "dark" };
  // vacio = true: se puede dejar en blanco (null = sin límite)
  const hora = (i, k, vacio = false, deshabilitado = false) => (
    <input type="time" disabled={deshabilitado} value={vacio && !(lista[i][k] > 0) ? "" : aHHMM(lista[i][k])}
      onChange={e => cambiar(i, { [k]: vacio && !e.target.value ? null : deHHMM(e.target.value) })}
      style={{ ...estiloCampo, width: 84, opacity: deshabilitado ? 0.35 : 1 }} />
  );
  const th = { fontSize: 9.5, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "4px 6px", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Usar</th><th style={th}>Nombre</th><th style={th}>Empieza entre</th>
              <th style={th}>Trabajo mínimo</th><th style={th}>Trabajo máximo</th><th style={th}>Amplitud máxima</th><th style={th}>Partido</th>
              <th style={th} title="El hueco sin pagar del partido no puede ser más largo (en blanco: sin límite)">Split máximo</th>
              <th style={th} title="Como mucho tantos turnos de este tipo al día (en blanco: sin límite)">Máximo al día</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {lista.map((x, i) => (
              <tr key={x.id || i} style={{ opacity: x.activo === false ? 0.5 : 1 }}>
                <td style={td}><input type="checkbox" checked={x.activo !== false} onChange={e => cambiar(i, { activo: e.target.checked })} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} /></td>
                <td style={td}><input value={x.nombre} onChange={e => cambiar(i, { nombre: e.target.value })} style={{ width: 110, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 7px", fontSize: 12, fontFamily: font, outline: "none" }} /></td>
                <td style={td}>{hora(i, "desde")} <span style={{ color: C.dim, fontSize: 11 }}>y</span> {hora(i, "hasta")}</td>
                <td style={td}>{hora(i, "trabajoMin")}</td>
                <td style={td}>{hora(i, "trabajoMax")}</td>
                <td style={td}>{hora(i, "amplitudMax")}</td>
                <td style={td}><input type="checkbox" checked={!!x.partido} onChange={e => cambiar(i, { partido: e.target.checked })} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} /></td>
                <td style={td}>{hora(i, "splitMax", true, !x.partido)}</td>
                <td style={td}>
                  <input type="number" min="1" placeholder="sin límite" value={x.maximo > 0 ? x.maximo : ""}
                    onChange={e => cambiar(i, { maximo: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value) || 1) })}
                    style={{ ...estiloCampo, width: 84 }} />
                </td>
                <td style={td}><button onClick={() => onChange(lista.filter((_, k) => k !== i))} title="Quitar este tipo" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={() => onChange([...lista, { id: `t${lista.length + 1}-${lista.length}`, nombre: `Tipo ${lista.length + 1}`, activo: true, desde: 360, hasta: 600, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false }])}
          style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: font }}>+ Añadir tipo</button>
        <button onClick={() => onChange(TIPOS_TURNO_DEFECTO)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>Volver a los de por defecto</button>
        <span style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.5 }}>
          Cada turno tiene que encajar en uno de los marcados: es del primero de la lista en el que encaja y aún tiene sitio («Máximo al día»). Si «empieza entre» va de una hora a otra más temprana, cruza la medianoche (p. ej. 17:00 y 04:00). «Split máximo»: el hueco sin pagar más largo que se permite en el partido. Split máximo y máximo al día en blanco: sin límite. Los que no encajan en ninguno salen con aviso. Sin ningún tipo marcado se usan la amplitud, la jornada y los partidos generales.
        </span>
      </div>
    </div>
  );
}

// ── Restricciones (mismo formato que las del Scheduling de puntos) ──────
function Restricciones({ p, onChange, red, onCambiarDia, onCerrar }) {
  // el radio de los vacíos de la estrategia también enciende o apaga los vacíos
  const set = (k, v) => onChange(k === "vacioKm" ? { vacioKm: v, vacios: v !== 0 } : { [k]: v });
  const titulo = t => <div style={{ fontSize: 12, color: C.blueText, fontWeight: 700, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{t}</div>;
  const sub = t => <div style={{ fontSize: 9.5, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, margin: "12px 0 8px" }}>{t}</div>;
  const row = (label, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
      <label style={{ fontSize: 11, color: C.muted, width: 190, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
  const numInput = (k, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min="0" value={p[k] ?? ""} onChange={e => set(k, Math.max(0, parseInt(e.target.value) || 0))}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }} />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const sel = (k, opciones) => (
    <select value={String(p[k])} onChange={e => { const o = opciones.find(x => String(x[0]) === e.target.value); set(k, o[0]); }}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none" }}>
      {opciones.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
    </select>
  );
  const decInput = (k, suffix, step = 0.01) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min="0" step={step} value={p[k] ?? ""} onChange={e => set(k, e.target.value === "" ? null : Math.max(0, parseFloat(String(e.target.value).replace(",", ".")) || 0))}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }} />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const conTipos = (p.tiposTurno || []).some(x => x.activo !== false);
  const check = (k, invertido = false) => (
    <input type="checkbox" checked={invertido ? !p[k] : !!p[k]} onChange={e => set(k, invertido ? !e.target.checked : e.target.checked)}
      style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} />
  );
  return (
    // Altura limitada con su propia barra: el panel no puede empujar fuera de
    // la pantalla la barra de botones ni el Gantt (antes se quedaba atascado)
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: "0 20px 14px", flexShrink: 0, maxHeight: "min(58vh, 620px)", overflowY: "auto", animation: "sched-fadein .15s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", marginBottom: 4, position: "sticky", top: 0, zIndex: 2, background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Restricciones</span>
        {row("Calendario", <SelectorCalendario red={red} valor={p.dia} onCambiar={onCambiarDia} ancho={280} />)}
        <span style={{ flex: 1 }} />
        {onCerrar && <button onClick={onCerrar} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: font, marginBottom: 9 }}>Cerrar ✕</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "4px 36px", marginBottom: 14 }}>
        <div>
          {titulo("Vehículos")}
          {row("Flota disponible", decInput("flotaMax", "autobuses (vacío = sin límite)", 1))}
          {row("Rato mínimo en cochera entre dos bloques", numInput("margenCochera", "min"))}
          {sub("Coste")}
          {row("Coste por autobús y día", decInput("costeVehiculoDia", "€/autobús·día"))}
          {row("Coste por km", decInput("costeKm", "€/km (con los vacíos)"))}
        </div>
        <div>
          {titulo("Conductores")}
          {sub("Jornada")}
          {conTipos ? (
            <div style={{ fontSize: 11, color: C.muted, margin: "0 0 9px", lineHeight: 1.5 }}>Amplitud, trabajo y partidos: los marca cada <b style={{ color: C.text }}>tipo de turno</b> (abajo).</div>
          ) : <>
            {row("Amplitud máxima del turno", numInput("amplitudMax", "min"))}
            {row("Jornada de trabajo máxima", numInput("jornadaMax", "min (piezas + huecos cortos)"))}
            {row("Jornadas partidas por turno", numInput("maxPartidos", "como mucho (0 = sin partidos)"))}
          </>}
          {row("Hueco que ya no se paga", numInput("huecoNoPagado", "min o más (jornada partida)"))}
          {sub("Piezas y relevos")}
          {row("Pieza máxima", numInput("piezaMax", "min de relevo a relevo"))}
          {row("Pieza mínima", numInput("piezaMin", "min (no se releva antes)"))}
          {row("Piezas por turno", numInput("maxPiezas", "como mucho"))}
          {row("Relevo en la misma cabecera", numInput("relevoMin", "min"))}
          {row("Ir a otra cabecera", numInput("desplazamiento", "min entre piezas"))}
          {sub("Conducción (UE 561/2006)")}
          {row("Conducción continua máxima", numInput("conduccionContinuaMax", "min"))}
          {row("Pausa de conducción", numInput("pausaConduccionMin", "min (se puede partir 15 + 30)"))}
          {row("Conducción diaria máxima", numInput("conduccionDiariaMax", "min"))}
          {row("No aplicar la UE 561/2006", check("aplicar561", true))}
          {sub("Disponibles y coste")}
          {row("Conductores disponibles", decInput("conductoresMax", "turnos (vacío = sin límite)", 1))}
          {row("Coste por hora de conductor", decInput("costeHora", "€/h"))}
        </div>
        <div>
          {titulo("Línea")}
          {row("Regulación en cabecera", numInput("regulacion", "min (si la línea no tiene la suya)"))}
          {row("Cambiar de línea en la misma cabecera", check("entreLineas"))}
          {sub("Vacíos entre cabeceras")}
          {row("Distancia máxima", decInput("vacioMaxKm", "km (0 = no se hacen)", 0.5))}
          {row("Velocidad", numInput("velocidadVacio", "km/h"))}
          {row("Factor de rodeo", decInput("factorRodeo", "× la línea recta", 0.05))}
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
            Lo propio de cada línea (tiempos de recorrido por franja, su regulación y los tipos de vehículo que admite) se configura en Planning, en la ficha de la línea.
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.blueText, fontWeight: 700, margin: "6px 0 10px", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>Tipos de turno <span style={{ fontSize: 11, color: C.dim, fontWeight: 400 }}>· de conductor (mañana, tarde, partido, refuerzo…)</span></div>
      <TiposTurno tipos={p.tiposTurno} onChange={v => set("tiposTurno", v)} />
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, margin: "6px 0 12px", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>Estrategia del optimizador para este calendario <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· la elige Optimizar; también puedes fijarla a mano</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
        <div>
          {row("Qué autobús coge cada viaje", sel("eleccion", [["ultimo", "El que menos espera en cabecera"], ["primero", "El que más espera (reparte la regulación)"]]))}
          {row("Vacíos entre cabeceras", sel("vacioKm", [[null, `Hasta el máximo (${String(p.vacioMaxKm).replace(".", ",")} km)`], ...[8, 3].filter(k => k < p.vacioMaxKm).map(k => [k, `Hasta ${k} km`]), [0, "No (cada autobús sigue en su cabecera)"]]))}
        </div>
        <div>
          {row("Dónde se corta la pieza (relevo)", sel("corte", [["max", "Piezas lo más largas posible"], ["equilibrado", "Piezas de largo parecido"], ...[225, 210, 180, 150, 120, 90, 60].filter(m => m < p.piezaMax).map(m => [m, `Piezas de hasta ${hm(m)}`])]))}
          {row("Cómo se forman los turnos", sel("metodo", [["particion", "La mejor combinación (como Optibus / GoalSystem)"], ["voraz", "Pieza a pieza (rápido)"]]))}
          {p.metodo === "voraz" && row("A qué conductor va cada pieza", sel("emparejar", [["primera", "Al que menos espera"], ["llena", "Al que lleva más horas (llenar turnos)"]]))}
        </div>
      </div>
    </div>
  );
}

// ── Selector de calendario: tipos de día y calendarios del GTFS ─────────
const COLORES_CAL = ["#5c9bff", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171", "#a3e635", "#e879f9", "#2dd4bf", "#facc15"];
const MESES_L = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fechaLarga = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

function SelectorCalendario({ red, valor, onCambiar, ancho = 300 }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = e => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);
  const cals = useMemo(() => red.calendarios || [], [red]);
  const colorDe = useMemo(() => new Map(cals.map((c, i) => [c.id, COLORES_CAL[i % COLORES_CAL.length]])), [cals]);
  const calDeFecha = useMemo(() => { const m = new Map(); for (const c of cals) for (const f of c.fechas) m.set(f, c); return m; }, [cals]);
  // meses que cubre el GTFS
  const meses = useMemo(() => {
    const fs = [...calDeFecha.keys()].sort();
    if (!fs.length) return [];
    const out = [];
    for (let y = +fs[0].slice(0, 4), m = +fs[0].slice(5, 7) - 1; `${y}-${String(m + 1).padStart(2, "0")}` <= fs.at(-1).slice(0, 7); m === 11 ? (y++, m = 0) : m++) out.push([y, m]);
    return out.slice(0, 15);
  }, [calDeFecha]);
  const elegir = id => { onCambiar(id); setAbierto(false); };
  const vis = cals.filter(c => !q.trim() || norm(`${c.nombre} ${(c.codigos || []).join(" ")}`).includes(norm(q.trim())));
  const fila = (id, titulo, detalle, color) => (
    <button key={id} onClick={() => elegir(id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", background: valor === id ? C.blueDim : "none", fontFamily: font }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color || "transparent", border: color ? "none" : `1px solid ${C.dim}`, flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: valor === id ? C.blueText : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titulo}</div>
        <div style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{detalle}</div>
      </span>
    </button>
  );
  const titulo = { fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700, padding: "8px 8px 4px", textTransform: "uppercase" };
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setAbierto(a => !a)} title="Calendario del escenario" style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: ancho, padding: "5px 10px", borderRadius: 6, background: C.surface2, border: `1px solid ${abierto ? C.blue : C.border2}`, color: C.text, fontSize: 11.5, cursor: "pointer", fontFamily: font }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={esCalendario(valor) ? colorDe.get(valor) || C.blue : C.blue} strokeWidth="2.2"><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nombreDia(valor, red)}</span>
        <span style={{ color: C.dim, fontSize: 9 }}>▾</span>
      </button>
      {abierto && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, width: meses.length ? 720 : 320, maxWidth: "calc(100vw - 32px)", background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.5)", display: "flex", maxHeight: 460 }}>
          <div style={{ width: 320, flexShrink: 0, borderRight: meses.length ? `1px solid ${C.border}` : "none", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ overflowY: "auto", padding: 6, flex: 1 }}>
              <div style={titulo}>Tipo de día · día de referencia</div>
              {TIPOS_DIA.map(t => fila(t.id, t.nombre, red.dias?.[t.id] ? `como el ${fechaLarga(red.dias[t.id])} (el de más servicio)` : "sin servicio", null))}
              <div style={{ ...titulo, display: "flex", alignItems: "center", gap: 8 }}>
                <span>Calendarios del GTFS{cals.length ? ` (${cals.length})` : ""}</span>
              </div>
              {cals.length > 8 && (
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar calendario o código…" style={{ width: "calc(100% - 16px)", margin: "0 8px 4px", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 11.5, fontFamily: font, outline: "none" }} />
              )}
              {vis.map(c => fila(c.id, c.nombre, `${c.fechas.length} día${c.fechas.length > 1 ? "s" : ""} · ${num(c.viajes)} viajes${c.codigos?.length ? ` · ${c.codigos.join(", ")}` : ""}`, colorDe.get(c.id)))}
              {!cals.length && <div style={{ fontSize: 11, color: C.dim, padding: "4px 8px 8px", lineHeight: 1.5 }}>Esta red se importó antes de leer los calendarios. Vuelve a importar el GTFS en Planning («Sustituir red») para elegir cualquiera.</div>}
            </div>
          </div>
          {meses.length > 0 && (
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px 16px", alignContent: "start" }}>
              <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: C.dim }}>Pincha un día para usar su calendario. Cada color es un calendario distinto.</div>
              {meses.map(([y, m]) => {
                const primero = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lunes = 0
                const nDias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
                return (
                  <div key={`${y}-${m}`}>
                    <div style={{ fontSize: 11, color: C.text, fontWeight: 600, marginBottom: 4 }}>{MESES_L[m]} {y}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                      {["L", "M", "X", "J", "V", "S", "D"].map(d => <div key={d} style={{ fontSize: 8.5, color: C.dim, textAlign: "center" }}>{d}</div>)}
                      {Array.from({ length: primero }, (_, i) => <div key={`v${i}`} />)}
                      {Array.from({ length: nDias }, (_, i) => {
                        const f = `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                        const c = calDeFecha.get(f);
                        const sel = c && c.id === valor;
                        return (
                          <button key={f} disabled={!c} onClick={() => elegir(c.id)} title={c ? `${fechaLarga(f)} · ${c.nombre}` : `${fechaLarga(f)} · sin servicio en el GTFS`}
                            style={{ height: 20, borderRadius: 4, border: sel ? "1.5px solid #fff" : "1px solid transparent", padding: 0, fontSize: 9.5, fontFamily: mono, cursor: c ? "pointer" : "default",
                              background: c ? colorDe.get(c.id) + (sel ? "" : "55") : "transparent", color: c ? (sel ? "#0b1220" : C.text) : C.dim, fontWeight: sel ? 800 : 400 }}>{i + 1}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Horarios de salida ──────────────────────────────────────────────────
function Horarios({ red, cfg, diaInicial }) {
  const [dia, setDia] = useState(diaInicial || "laborable");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(red.lineas[0]?.id || null);
  const lista = red.lineas.filter(l => !q.trim() || norm(`${l.nombre} ${l.sentidos.map(s => s.cabecera).join(" ")}`).includes(norm(q.trim())));
  const linea = lista.find(l => l.id === sel) || lista[0]; // al buscar, la primera que coincide
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.card }}>
        <div style={{ padding: 10 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea…" style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
          {lista.slice(0, 400).map(l => (
            <button key={l.id} onClick={() => setSel(l.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 6px", borderRadius: 6, marginBottom: 1, background: l.id === linea?.id ? C.blueDim : "none", border: "none", cursor: "pointer", fontFamily: font }}>
              <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 5, background: l.color, color: "#0b1220", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{l.nombre}</span>
              <span style={{ fontSize: 11, color: l.id === linea?.id ? C.blueText : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.sentidos.map(s => s.cabecera).join(" ↔ ")}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <SelectorCalendario red={red} valor={dia} onCambiar={setDia} ancho={420} />
          {!esCalendario(dia) && red.dias?.[dia] && <span style={{ fontSize: 11, color: C.dim }}>día de referencia {new Date(red.dias[dia] + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span>}
        </div>
        {linea && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${linea.sentidos.length}, minmax(320px, 1fr))`, gap: 16 }}>
            {linea.sentidos.map(s => {
              const { lista: salidas, aproximado } = salidasDe(s, dia, red);
              const porHora = new Map();
              for (const m of salidas) { const h = Math.floor(m / 60); if (!porHora.has(h)) porHora.set(h, []); porHora.get(h).push(m % 60); }
              return (
                <div key={s.dir} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ minWidth: 34, padding: "2px 6px", borderRadius: 5, background: linea.color, color: "#0b1220", fontSize: 12, fontWeight: 800, textAlign: "center" }}>{linea.nombre}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: s.dir === 0 ? C.green : C.amber }}>{s.dir === 0 ? "IDA" : "VUELTA"}</span>
                    <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {s.cabecera}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontFamily: mono }}>{salidas.length} salidas</span>
                  </div>
                  {aproximado && salidas.length > 0 && <div style={{ padding: "6px 14px", fontSize: 10.5, color: C.amber }}>Horas aproximadas: vuelve a importar el GTFS en Planning para tener las exactas.</div>}
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={{ fontSize: 9, color: C.dim, textAlign: "left", padding: "6px 14px", letterSpacing: 1 }}>HORA</th>
                      <th style={{ fontSize: 9, color: C.dim, textAlign: "left", padding: "6px 8px", letterSpacing: 1 }}>MINUTOS DE SALIDA</th>
                      <th style={{ fontSize: 9, color: C.dim, textAlign: "right", padding: "6px 14px", letterSpacing: 1 }}>RECORRIDO</th>
                    </tr></thead>
                    <tbody>
                      {[...porHora.entries()].map(([h, mins]) => (
                        <tr key={h} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "5px 14px", fontFamily: mono, fontSize: 12, color: C.text, fontWeight: 700, verticalAlign: "top" }}>{String(h % 24).padStart(2, "0")}{h >= 24 ? <span style={{ color: C.dim, fontWeight: 400, fontSize: 10 }}> +1</span> : null}</td>
                          <td style={{ padding: "5px 8px", fontFamily: mono, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{mins.map(m => String(m).padStart(2, "0")).join("  ")}</td>
                          <td style={{ padding: "5px 14px", fontFamily: mono, fontSize: 11, color: C.dim, textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>{duracionViaje(s, h * 60, cfg[linea.id])} min</td>
                        </tr>
                      ))}
                      {!salidas.length && <tr><td colSpan={3} style={{ padding: 14, fontSize: 12, color: C.dim }}>Sin servicio este tipo de día</td></tr>}
                    </tbody>
                  </table>
                  <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10.5, color: C.dim }}>
                    Frecuencia media: {FRANJAS.map(f => {
                      const n = salidas.filter(m => franjaDe(m) === f.id).length;
                      return n ? `${f.id.replace("-", "–")} cada ${Math.round((f.hasta - f.desde) / n)} min` : null;
                    }).filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Optimizar: prueba estrategias dentro de las restricciones ───────────
function PanelOptimizar({ fase, p, diaNombre, objetivo, setObjetivo, opt, onOptimizar, onAplicar, onRestricciones, bloqueado }) {
  const veh = fase === "vehiculos";
  const objetivos = veh ? OBJETIVOS_VEHICULOS : OBJETIVOS_TURNOS;
  const hayPrecio = o => !o.precios || o.precios.some(k => p[k] > 0);
  const corriendo = opt.estado === "corriendo";
  const lim = veh ? (p.flotaMax > 0 ? `flota ${p.flotaMax} autobuses` : null) : (p.conductoresMax > 0 ? `${p.conductoresMax} conductores` : null);
  const th = { fontSize: 9, color: C.dim, letterSpacing: 1, fontWeight: 700, padding: "5px 8px", textAlign: "right", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", fontFamily: mono, fontSize: 11.5, textAlign: "right", color: C.text };
  const mejor = opt.probadas?.[0];
  const conCoste = opt.probadas?.some(r => r.coste != null);
  const columnas = veh
    ? [["Autobuses", r => num(r.autobuses), r => r.autobuses === mejor.autobuses], ["Bloques", r => num(r.bloques)], ["Vacíos", r => num(r.vacios)], ["Km vacío", r => num(r.kmVacio), r => r.kmVacio === mejor.kmVacio], ...(conCoste ? [["Coste/día", r => (r.coste != null ? `${num(r.coste)} €` : "—")]] : [])]
    : [["Turnos", r => num(r.turnos), r => r.turnos === mejor.turnos], ["Piezas/turno", r => r.piezasMedias.toFixed(1).replace(".", ",")], ["Horas pagadas", r => num(r.horasPagadas), r => r.horasPagadas === mejor.horasPagadas], ["Avisos", r => r.avisos], ...(conCoste ? [["Coste personal", r => (r.coste != null ? `${num(r.coste)} €` : "—")]] : [])];
  return (
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: "14px 20px", flexShrink: 0, animation: "sched-fadein .15s ease both", maxHeight: "45vh", overflowY: "auto" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
        Optimizar {veh ? "paso 1 · vehículos" : "paso 2 · turnos"} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {diaNombre} · {veh ? "después se rehacen los turnos en el paso 2" : "sobre los vehículos del paso 1, sin cambiarlos"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.muted }}>Objetivo</span>
        <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 6, padding: 2 }}>
          {objetivos.map(o => {
            const off = !hayPrecio(o);
            return (
              <button key={o.id} disabled={off} onClick={() => setObjetivo(o.id)} title={off ? "Pon los precios en Restricciones" : o.ayuda}
                style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: off ? "not-allowed" : "pointer", background: objetivo === o.id ? C.blue : "none", color: objetivo === o.id ? "#fff" : off ? C.dim : C.muted, fontSize: 11, fontWeight: objetivo === o.id ? 600 : 400, fontFamily: font }}>{o.nombre}</button>
            );
          })}
        </div>
        <span style={{ fontSize: 11, color: C.dim }}>
          Límite: {lim || "ninguno"} ·{" "}
          <button onClick={onRestricciones} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 11, fontFamily: font }}>cambiar en Restricciones</button>
        </span>
        <button onClick={onOptimizar} disabled={corriendo || !!bloqueado} title={bloqueado || undefined} style={{ marginLeft: "auto", opacity: bloqueado ? 0.5 : 1, padding: "6px 14px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: corriendo ? "wait" : "pointer", fontFamily: font }}>
          {corriendo ? `Probando ${opt.progreso[0]} de ${opt.progreso[1] || "…"}` : veh ? "Optimizar vehículos" : "Optimizar turnos"}
        </button>
      </div>
      {corriendo && (
        <div style={{ height: 3, background: C.bg, borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${opt.progreso[1] ? (100 * opt.progreso[0]) / opt.progreso[1] : 3}%`, background: C.blue, transition: "width .2s" }} />
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>
        {veh
          ? "Prueba distintas formas de encadenar los viajes en los autobuses: qué autobús coge cada viaje, hasta cuántos km se hacen vacíos entre cabeceras y si un autobús cambia de línea. Mandan la flota disponible y después el objetivo."
          : "Prueba distintos largos de pieza y formas de repartirlas entre los conductores, sin tocar los autobuses. Todas respetan las Restricciones. Mandan los conductores disponibles, que no haya avisos legales y después el objetivo."}
      </div>
      {opt.error && <div style={{ fontSize: 11.5, color: C.red, marginTop: 8 }}>No se ha podido optimizar: {opt.error}</div>}
      {opt.estado === "hecho" && mejor && (
        <>
          {!mejor.cumple && <div style={{ fontSize: 11.5, color: C.red, marginTop: 10 }}>Ninguna combinación cabe en {veh ? "la flota disponible" : "los conductores disponibles"}: hay que quitar viajes, relajar restricciones o ampliar {veh ? "la flota" : "la plantilla"}.</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>Estrategia</th>
              {columnas.map(([t]) => <th key={t} style={th}>{t}</th>)}<th style={th} />
            </tr></thead>
            <tbody>
              {opt.probadas.slice(0, 8).map((r, i) => (
                <tr key={r.nombre + i} style={{ borderTop: `1px solid ${C.border}`, background: i === 0 ? "rgba(52,211,153,0.07)" : "none" }}>
                  <td style={{ ...td, textAlign: "left", color: i === 0 ? C.green : C.dim }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 11.5, color: C.muted }}>{r.nombre}{!r.cumple && <span style={{ color: C.red }}> · pasa del límite</span>}</td>
                  {columnas.map(([t, f, igual]) => <td key={t} style={{ ...td, color: igual ? (igual(r) ? C.text : C.muted) : C.muted }}>{f(r)}</td>)}
                  <td style={{ ...td, width: 110, whiteSpace: "nowrap" }}>
                    {opt.aplicada === i
                      ? <span style={{ fontSize: 11, color: C.green, fontFamily: font }}>En el escenario</span>
                      : <button onClick={() => onAplicar(i)} style={{ padding: "3px 10px", borderRadius: 5, background: "none", border: `1px solid ${C.border2}`, color: C.blueText, fontSize: 11, cursor: "pointer", fontFamily: font }}>Usar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>{opt.probadas.length} combinaciones probadas. La primera ya está aplicada{veh ? "; los turnos se rehacen en el paso 2" : ""}.</div>
        </>
      )}
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────
// Un escenario por calendario, en dos pasos (1 vehículos, 2 trabajadores),
// con su estrategia, indicadores y ▲▼ propios.
// lineasSched = { ...restricciones comunes, dia (el último visto),
//   porCalendario: { [dia]: { estrategia, objetivoV, objetivoT, resumen, claveV, clave } } }
// claveV resume con qué se hicieron los vehículos y clave, todo (también los
// turnos): si ya no coinciden, está desactualizado. resumen.turnos es null
// si solo se ha hecho el paso 1.
const ESTRATEGIA_UI = ["eleccion", "corte", "emparejar", "metodo", "vacios", "vacioKm"]; // entreLineas además es restricción
const CAMPOS_COSTE = ["costeHora", "costeKm", "costeVehiculoDia"];
// lo que cambia los vehículos (el resto solo cambia los turnos)
const CLAVES_VEHICULOS = ["dia", "lineas", "regulacion", "margenVacio", "margenCochera", "vacioMaxKm", "factorRodeo", "velocidadVacio", "entreLineas", ...CAMPOS_VEHICULOS];
const sinCampos = (o, campos) => Object.fromEntries(Object.entries(o).filter(([k]) => !campos.includes(k)));
const soloCampos = (o, campos) => Object.fromEntries(Object.entries(o).filter(([k]) => campos.includes(k)));
function hashTexto(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const claveEscenario = (p, cfgTxt) => hashTexto(JSON.stringify(Object.keys(p).filter(k => !CAMPOS_COSTE.includes(k)).sort().map(k => [k, p[k]])) + cfgTxt);
const claveVehiculos = (p, cfgTxt) => hashTexto(JSON.stringify(CLAVES_VEHICULOS.map(k => [k, p[k] ?? null])) + cfgTxt);
const mismos = (campos, a = {}, b = {}) => campos.every(k => (a[k] ?? PARAMS_DEFECTO[k]) === (b[k] ?? PARAMS_DEFECTO[k]));
const baseDeResumen = (r, p) => (r ? {
  vehicleCount: r.autobuses, turnos: r.turnos, eficPersonal: r.eficienciaPersonal, totalKm: r.km, eficVehiculo: r.km ? (r.km - (r.kmVacio || 0)) / r.km : null, totalStops: r.viajes, avisos: r.avisos,
  coste: r.turnos == null ? null : costeDia(r, p),
} : null);
const MAX_EN_MEMORIA = 5; // escenarios completos guardados en memoria (los de Roma ocupan)
const nombreObjetivo = id => OBJETIVOS.find(o => o.id === id)?.nombre.toLowerCase();

export function SchedulingLineasPage({ projectId }) {
  const [subTab, setSubTab] = useState("escenario");
  const [estado, setEstado] = useState({ red: null, cargando: true });
  const [cfg, setCfg] = useState({});
  const [guardados, setGuardados] = useState(undefined);
  const [cambios, setCambios] = useState({});
  const [diaSel, setDiaSel] = useState(null);
  const [cache, setCache] = useState({}); // dia → { res, base, claveV, clave, t }
  const [calculando, setCalculando] = useState(false);
  const [modo, setModo] = useState("vehicles"); // paso: "vehicles" 1 o "workers" 2
  const [showC, setShowC] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [panelLineas, setPanelLineas] = useState(false);
  const [showOpt, setShowOpt] = useState(false);
  const [objetivoV, setObjetivoV] = useState("autobuses");
  const [objetivoT, setObjetivoT] = useState("conductores");
  const [optPorDia, setOptPorDia] = useState({}); // "dia|fase" → estado de la optimización
  const [lote, setLote] = useState(null); // { optimizar, progreso: [i, n], dia }
  const [nota, setNota] = useState(null); // { texto, error } abajo, unos segundos
  useEffect(() => { if (!nota) return; const t = setTimeout(() => setNota(null), nota.error ? 6000 : 4500); return () => clearTimeout(t); }, [nota]);
  const autoRef = useRef(false);
  const escribiendoRef = useRef(0); // transacciones de cambios a mano en curso
  const workerRef = useRef(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => watchRed(projectId, setEstado), [projectId]);
  useEffect(() => watchCfg(projectId, setCfg), [projectId]);
  useEffect(() => watchSchedParams(projectId, setGuardados), [projectId]);
  const [cocheras, setCocheras] = useState([]);
  useEffect(() => watchCocheras(projectId, setCocheras), [projectId]);

  const red = estado.red;
  // la clave de cada escenario también cambia si se mueven las cocheras
  const cfgTxt = useMemo(() => JSON.stringify(cfg) + JSON.stringify(cocheras.map(c => [c.id, c.lat, c.lng])), [cfg, cocheras]);
  const { porCalendario = {}, ...guardadoTop } = guardados || {};
  const existe = d => !esCalendario(d) || !!red?.calendarios?.some(c => c.id === d);
  const diaGuardado = existe(guardadoTop.dia) ? guardadoTop.dia : "laborable";
  const dia = diaSel && existe(diaSel) ? diaSel : diaGuardado || "laborable";
  const fase = modo === "workers" ? "turnos" : "vehiculos";

  // Parámetros de un calendario: restricciones comunes + su estrategia
  function paramsPara(d, extra = {}, estrategia) {
    const globales = { ...PARAMS_DEFECTO, lineas: null, ...sinCampos(guardadoTop, ESTRATEGIA_UI), ...sinCampos(extra, ESTRATEGIA_UI), dia: d };
    const est = { ...(estrategia ?? porCalendario[d]?.estrategia ?? {}), ...soloCampos(extra, ESTRATEGIA_UI) };
    return { ...globales, ...soloCampos(est, ESTRATEGIA_UI), entreLineas: globales.entreLineas && (est.entreLineas ?? true), entreLineasGlobal: globales.entreLineas };
  }
  const params = paramsPara(dia, cambios);
  const actual = cache[dia];
  const res = actual?.res || null;
  const optDe = (d, f) => optPorDia[`${d}|${f}`] || { estado: "nada", progreso: [0, 0] };
  const opt = optDe(dia, fase);
  const paradasPorId = useMemo(() => new Map([...(red?.paradas || []).map(p => [p.id, p]), ...cocheras.map(c => [ID_COCHERA(c.id), { nombre: `Cochera ${c.nombre || ""}`.trim() }])]), [red, cocheras]);
  const pendientes = Object.keys(cambios).length > 0;
  const enMemoriaValido = (d, p) => {
    const c = cache[d];
    return c && (c.res.turnos ? c.clave === claveEscenario(p, cfgTxt) : c.claveV === claveVehiculos(p, cfgTxt));
  };

  function guardarCalendario(d, datos) {
    return guardarSchedParams(projectId, { porCalendario: { [d]: datos } }).catch(() => {});
  }

  // Calcula un calendario: "vehiculos" (paso 1, sin turnos), "turnos" (paso 2
  // sobre los vehículos que hay) o "ambos". meta.objetivoV/T: si viene de Optimizar.
  // Cambios a mano: meta.manuales (lista a aplicar), meta.conservar (los
  // guardados); si no, generar un paso quita los cambios a mano de ese paso.
  // La partición de turnos (lo pesado de «Generar turnos») en un worker, para
  // no congelar la pantalla con redes grandes; devuelve grupos de claves de pieza.
  function gruposEnWorker(p, opsV) {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./lineas-opt.worker.js", import.meta.url), { type: "module" });
      w.onmessage = e => { w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.ok); };
      w.onerror = e => { w.terminate(); reject(new Error(e.message || "error en el cálculo")); };
      w.postMessage({ tipo: "grupos", red, cfg, cocheras, params: p, opsV });
    });
  }
  function calcular(p = params, que = "ambos", meta = {}) {
    if (!red) return;
    setCalculando(true);
    setTimeout(async () => {
      try {
        const claveV = claveVehiculos(p, cfgTxt);
        const previos = cache[p.dia]?.manuales ?? porCalendario[p.dia]?.manuales ?? [];
        const lista = meta.manuales ?? (meta.conservar ? previos : que === "turnos" ? previos.filter(esCambioVehiculos) : []);
        const opsV = lista.filter(esCambioVehiculos), opsT = lista.filter(esCambioTurnos);
        const fallidos = [];
        const conV = x => { if (!opsV.length) return x; const a = aplicarCambios(x, opsV); fallidos.push(...a.fallidos); return a.res; };
        const conT = x => { if (!opsT.length) return x; const a = aplicarCambios(x, opsT); fallidos.push(...a.fallidos); return a.res; };
        let r;
        if (que === "vehiculos") r = conV(generarVehiculos(red, cfg, p, { cocheras }));
        else {
          const c = cache[p.dia];
          const veh = que === "turnos" && c?.res && c.claveV === claveV ? c.res : conV(generarVehiculos(red, cfg, p, { cocheras }));
          const grupos = (p.metodo ?? PARAMS_DEFECTO.metodo) === "particion" ? await gruposEnWorker(p, opsV) : null;
          r = conT(generarTurnos(veh, p, { grupos }));
        }
        const aplicados = lista.filter(o => !fallidos.some(f => f.clave === o.clave && f.tipo === o.tipo && f.destino === o.destino));
        if (meta.aviso && !fallidos.length) setNota({ texto: meta.aviso });
        if (fallidos.length) setNota({ texto: `${fallidos.length} cambio${fallidos.length > 1 ? "s" : ""} a mano ya no encaja${fallidos.length > 1 ? "n" : ""} y se ha${fallidos.length > 1 ? "n" : ""} quitado: ${fallidos[0].error}`, error: true });
        const resumen = resumenServicio(r);
        const clave = r.turnos ? claveEscenario(p, cfgTxt) : null;
        const est = soloCampos(p, CAMPOS_ESTRATEGIA);
        const previo = porCalendario[p.dia];
        setCache(c => {
          const antes = c[p.dia]?.res ? resumenServicio(c[p.dia].res) : previo?.resumen;
          const n = { ...c, [p.dia]: { res: r, base: baseDeResumen(antes, p), claveV, clave, manuales: aplicados, t: Date.now() } };
          const sobran = Object.keys(n).sort((x, y) => n[y].t - n[x].t).slice(MAX_EN_MEMORIA);
          for (const k of sobran) delete n[k];
          return n;
        });
        setCambios({});
        setDiaSel(p.dia);
        const top = { ...sinCampos(p, [...CAMPOS_ESTRATEGIA, "entreLineasGlobal"]), entreLineas: p.entreLineasGlobal, lineas: p.lineas || null, ...soloCampos(PARAMS_DEFECTO, ESTRATEGIA_UI) };
        // solo lo que esta persona ha cambiado: si otra cambió a la vez otra
        // restricción, no se le deshace (antes se guardaban todas)
        const cambiados = Object.fromEntries(Object.entries(top).filter(([k, v]) => k === "dia" || JSON.stringify(guardadoTop[k] ?? PARAMS_DEFECTO[k] ?? null) !== JSON.stringify(v ?? null)));
        guardarSchedParams(projectId, cambiados).catch(() => {});
        guardarCalendario(p.dia, {
          estrategia: est, resumen, claveV, clave, manuales: aplicados,
          objetivoV: meta.objetivoV ?? (previo && mismos(CAMPOS_VEHICULOS, previo.estrategia, est) ? previo.objetivoV ?? null : null),
          objetivoT: r.turnos ? meta.objetivoT ?? (previo?.clave && mismos(CAMPOS_ESTRATEGIA, previo.estrategia, est) ? previo.objetivoT ?? null : null) : null,
        });
        logAudit({
          modulo: "Scheduling", accion: que === "vehiculos" ? "Generó los vehículos de líneas" : que === "turnos" ? "Generó los turnos de líneas" : "Generó el escenario de líneas",
          detalle: `${r.diaNombre} · ${r.kpis.viajes} viajes · ${r.kpis.autobuses} autobuses · ${Math.round(r.kpis.kmVacio || 0)} km en vacío${r.turnos ? ` · ${r.kpis.turnos} turnos` : ""}`,
        });
      } catch (e) {
        console.error("Scheduling de líneas:", e);
        setNota({ texto: `No se pudo calcular: ${e.message || e}`, error: true });
      } finally {
        setCalculando(false);
      }
    }, 30);
  }

  // Cambiar de calendario: si ya está calculado y al día se enseña, si no se calculan los dos pasos
  function cambiarDia(d) {
    const extra = sinCampos(cambios, ESTRATEGIA_UI); // la estrategia a medio tocar era del otro calendario
    const p = paramsPara(d, extra);
    setPanelLineas(false);
    if (!Object.keys(extra).length && enMemoriaValido(d, p)) {
      setCambios({});
      setDiaSel(d);
      guardarSchedParams(projectId, { dia: d }).catch(() => {});
      return;
    }
    calcular(p, "ambos", { conservar: true });
  }

  // Mover a mano una expedición (paso 1) o una pieza (paso 2)
  // tipo: "viaje" | "pieza" (uno) · "viajes" | "viajesTurno" (varios: clave es la lista)
  function mover(tipo, clave, destino) {
    const c = cache[dia];
    if (!c?.res) return false;
    const claves = Array.isArray(clave) ? clave : null;
    const deVeh = tipo === "viaje" || tipo === "viajes";
    const r = tipo === "viaje" ? moverViaje(c.res, clave, destino)
      : tipo === "viajes" ? moverViajes(c.res, claves, destino)
        : tipo === "viajesTurno" ? moverViajesTurno(c.res, claves, destino)
          : moverPieza(c.res, clave, destino);
    if (r.error) { setNota({ texto: `No se puede: ${r.error}`, error: true }); return false; }
    const previos = c.manuales || [];
    const op = claves ? { tipo, clave: claves[0], claves, destino } : { tipo, clave, destino };
    // mover expediciones rehace los vehículos: los cambios de turnos ya no valen
    const anadir = l => (deVeh ? [...l.filter(esCambioVehiculos), op] : [...l, op]);
    const manuales = anadir(previos);
    const clv = r.turnos ? c.clave : null;
    setCache(m => ({ ...m, [dia]: { ...c, res: r, base: baseDeResumen(resumenServicio(c.res), params), clave: clv, manuales, t: Date.now() } }));
    const prev = porCalendario[dia] || {};
    const d = dia;
    escribiendoRef.current++;
    // la operación se añade a la lista del SERVIDOR: si otra persona movió
    // piezas de este calendario a la vez, se conservan y se recalcula con todas
    cambiarManuales(projectId, d, anadir, { resumen: resumenServicio(r), claveV: c.claveV, clave: clv, objetivoT: r.turnos ? prev.objetivoT ?? null : null })
      .then(({ antes, despues }) => {
        if (JSON.stringify(antes) !== JSON.stringify(previos)) {
          setNota({ texto: "Otra persona ha cambiado este calendario a la vez: se recalcula con sus cambios y los tuyos." });
          calcular(paramsPara(d), "ambos", { manuales: despues });
        }
      })
      .catch(e => setNota({ texto: `No se pudo guardar el cambio: ${e.message || e}`, error: true }))
      .finally(() => { escribiendoRef.current--; });
    const primero = claves ? claves[0] : clave;
    const avisos = (deVeh
      ? r.vehiculos.find(v => v.viajes.some(x => !x.vacio && claveViaje(x) === primero))?.avisos
      : tipo === "viajesTurno" ? r.turnos.find(t => t.piezas.some(pz => pz.viajes.some(x => !x.vacio && claveViaje(x) === primero)))?.avisos
        : r.turnos.find(t => t.piezas.some(x => clavePieza(x) === clave))?.avisos) || [];
    const donde = destino == null ? (deVeh ? "a un autobús nuevo" : "a un turno nuevo") : deVeh ? `al autobús ${destino}` : `al turno T${destino}`;
    const que = tipo === "viaje" ? "Expedición movida" : tipo === "viajes" ? `${claves.length} expediciones movidas` : tipo === "viajesTurno" ? `${claves.length} viaje${claves.length > 1 ? "s" : ""} movido${claves.length > 1 ? "s" : ""}` : "Pieza movida";
    setNota({ texto: `${que} ${donde}${avisos.length ? ` · ojo: ${avisos[0]}` : ""}${deVeh && c.res.turnos ? " · los turnos hay que rehacerlos (paso 2)" : ""}`, error: avisos.length > 0 });
    logAudit({ modulo: "Scheduling", accion: deVeh ? (claves ? "Movió a mano varias expediciones" : "Movió a mano una expedición") : claves ? "Movió a mano varios viajes de turno" : "Movió a mano una pieza", detalle: `${nombreDia(dia, red)} · ${claves ? `${claves.length}: ${claves.slice(0, 3).join(", ")}${claves.length > 3 ? "…" : ""}` : clave} → ${donde}` });
    return true;
  }
  const manualesActuales = actual?.manuales || [];
  const deshacer = () => {
    const ultima = JSON.stringify(manualesActuales.at(-1));
    escribiendoRef.current++;
    cambiarManuales(projectId, dia, l => { const i = l.map(o => JSON.stringify(o)).lastIndexOf(ultima); return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)]; })
      .then(({ despues }) => calcular(params, "ambos", { manuales: despues }))
      .catch(e => setNota({ texto: `No se pudo deshacer: ${e.message || e}`, error: true }))
      .finally(() => { escribiendoRef.current--; });
  };
  const quitarManuales = () => { if (window.confirm(`¿Quitar los ${manualesActuales.length} cambios a mano de este calendario?`)) calcular(params, "ambos", { manuales: [] }); };
  // generar u optimizar un paso quita los cambios a mano de ese paso
  const perderManuales = f => {
    const n = f === "vehiculos" ? manualesActuales.length : manualesActuales.filter(esCambioTurnos).length;
    return !n || window.confirm(`Se perderán ${n} cambio${n > 1 ? "s" : ""} a mano de ${f === "vehiculos" ? "vehículos y turnos" : "turnos"}. ¿Seguir?`);
  };

  function nuevoWorker() {
    workerRef.current?.terminate();
    const w = new Worker(new URL("./lineas-opt.worker.js", import.meta.url), { type: "module" });
    workerRef.current = w;
    return w;
  }
  const hayPreciosVeh = p => p.costeVehiculoDia > 0 || p.costeKm > 0;
  const objetivoVehValido = p => (objetivoV === "coste" && !hayPreciosVeh(p) ? "autobuses" : objetivoV);

  // Optimizar un paso del calendario que se está viendo (en un worker)
  function optimizar() {
    if (!red || opt.estado === "corriendo" || lote || !perderManuales(fase)) return;
    const p = params, d = p.dia, f = fase;
    const obj = f === "vehiculos" ? objetivoVehValido(p) : objetivoT;
    const setO = x => setOptPorDia(m => ({ ...m, [`${d}|${f}`]: typeof x === "function" ? x(m[`${d}|${f}`] || {}) : x }));
    setPanelLineas(false);
    setO({ estado: "corriendo", progreso: [0, 0] });
    const w = nuevoWorker();
    w.onmessage = e => {
      if (e.data.progreso) { setO(o => ({ ...o, progreso: e.data.progreso })); return; }
      w.terminate(); workerRef.current = null;
      if (e.data.error) { setO({ estado: "nada", progreso: [0, 0], error: e.data.error }); return; }
      const { probadas } = e.data.ok;
      setO({ estado: "hecho", progreso: [0, 0], probadas, params: p, objetivo: obj, aplicada: 0 });
      if (probadas[0]) {
        calcular({ ...p, ...probadas[0].estrategia }, f, f === "vehiculos" ? { objetivoV: obj } : { objetivoT: obj });
        logAudit({ modulo: "Scheduling", accion: f === "vehiculos" ? "Optimizó los vehículos de líneas" : "Optimizó los turnos de líneas", detalle: `${nombreDia(d, red)} · ${OBJETIVOS.find(o => o.id === obj)?.nombre} · ${probadas[0].nombre}` });
      }
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setO({ estado: "nada", progreso: [0, 0], error: e.message || "error en el cálculo" }); };
    // vehículos: puede probar a no cambiar de línea solo si la restricción lo permite;
    // turnos: con los vehículos tal cual están
    w.postMessage({ tipo: f, red, cfg, cocheras, params: f === "vehiculos" ? { ...p, entreLineas: p.entreLineasGlobal } : p, objetivo: obj });
  }
  function aplicarOpt(i) {
    const r = opt.probadas?.[i];
    if (!r) return;
    setOptPorDia(m => ({ ...m, [`${dia}|${fase}`]: { ...opt, aplicada: i } }));
    calcular({ ...opt.params, ...r.estrategia }, fase, fase === "vehiculos" ? { objetivoV: opt.objetivo } : { objetivoT: opt.objetivo });
  }

  // Calcular u optimizar varios calendarios, uno detrás de otro (en un worker)
  function calcularLote(dias, optimizarTodos) {
    if (!red || lote || !dias.length) return;
    const globales = paramsPara(dias[0], {}, {});
    const objV = objetivoVehValido(globales), objT = objetivoT;
    // restricciones comunes + la estrategia por defecto (cada calendario pone la suya encima)
    const base = { ...sinCampos(globales, ["entreLineasGlobal", "dia"]), entreLineas: globales.entreLineasGlobal };
    const hechos = {};
    setLote({ optimizar: optimizarTodos, progreso: [0, dias.length], dia: dias[0] });
    const w = nuevoWorker();
    w.onmessage = e => {
      const m = e.data;
      if (m.progreso) { setLote(l => (l ? { ...l, progreso: m.progreso, dia: m.dia } : l)); return; }
      if (m.hecho) {
        const { dia: d, estrategia, resumen, optimizado } = m.hecho;
        hechos[d] = estrategia;
        const previo = porCalendario[d];
        const q = paramsPara(d, {}, estrategia);
        guardarCalendario(d, {
          estrategia, resumen, claveV: claveVehiculos(q, cfgTxt), clave: claveEscenario(q, cfgTxt), manuales: m.hecho.manuales || [],
          objetivoV: optimizado ? objV : previo && mismos(CAMPOS_VEHICULOS, previo.estrategia, estrategia) ? previo.objetivoV ?? null : null,
          objetivoT: optimizado ? objT : previo?.clave && mismos(CAMPOS_ESTRATEGIA, previo.estrategia, estrategia) ? previo.objetivoT ?? null : null,
        });
        return;
      }
      w.terminate(); workerRef.current = null;
      setLote(null);
      if (m.error) { alert(`No se ha podido terminar: ${m.error}`); return; }
      logAudit({ modulo: "Scheduling", accion: optimizarTodos ? "Optimizó todos los calendarios de líneas" : "Calculó los calendarios de líneas", detalle: `${dias.length} calendarios${optimizarTodos ? ` · ${nombreObjetivo(objV)} · ${nombreObjetivo(objT)}` : ""}` });
      // el calendario que se está viendo ha cambiado: se recalcula
      if (hechos[dia]) calcular(paramsPara(dia, {}, hechos[dia]), "ambos", { conservar: !optimizarTodos });
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setLote(null); alert(`No se ha podido terminar: ${e.message || "error en el cálculo"}`); };
    w.postMessage({ tipo: "lote", red, cfg, cocheras, params: base, objetivoVehiculos: objV, objetivoTurnos: objT, optimizar: optimizarTodos, dias: dias.map(d => ({ dia: d, estrategia: optimizarTodos ? {} : porCalendario[d]?.estrategia || {}, manuales: optimizarTodos ? [] : (cache[d]?.manuales ?? porCalendario[d]?.manuales ?? []) })) });
  }
  function pararLote() { workerRef.current?.terminate(); workerRef.current = null; setLote(null); }

  // Otra persona ha cambiado los cambios a mano del calendario que se ve:
  // se recalcula con la lista del servidor (si no, se pisarían)
  const manualesServidor = JSON.stringify(porCalendario[dia]?.manuales || []);
  useEffect(() => {
    const c = cache[dia];
    if (!c?.res || calculando || lote || escribiendoRef.current) return;
    if (JSON.stringify(c.manuales || []) === manualesServidor) return;
    if (porCalendario[dia]?.claveV && porCalendario[dia].claveV !== c.claveV) return; // otro escenario: lo resuelve «Desactualizado»
    // en diferido: agrupa varios cambios seguidos del servidor en un solo recálculo
    const t = setTimeout(() => calcular(paramsPara(dia), "ambos", { manuales: JSON.parse(manualesServidor), aviso: "Otra persona ha cambiado este calendario: se actualiza con sus cambios." }), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualesServidor, dia]);

  useEffect(() => {
    if (red && guardados !== undefined && !autoRef.current) { autoRef.current = true; calcular(params, "ambos", { conservar: true }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [red, guardados]);

  async function exportar(tipo) {
    if (!res || (tipo === "turnos" && !res.turnos)) return;
    const XLSX = await import("xlsx");
    const nom = id => paradasPorId.get(id)?.nombre || id;
    const filas = tipo === "vehiculos"
      ? res.vehiculos.flatMap(v => v.viajes.map(x => ({ "Autobús": v.autobus, "Bloque": v.id, "Tipo": nombreTipo(v.tipo), "Línea": x.vacio ? (x.hacia ? `Vacío → ${x.hacia}` : "Vacío") : x.nombre, "Sentido": x.sentido, "Salida": hhmm(x.dep), "Llegada": hhmm(x.arr), "Desde": nom(x.o), "Hasta": nom(x.d), "Km": x.km, "En vacío": x.vacio ? "sí" : "" })))
      : res.turnos.flatMap(t => t.piezas.flatMap((pz, i) => pz.viajes.map(x => ({
          "Turno": `T${t.id}`, "Pieza": i + 1, "Autobús": res.vehiculos.find(v => v.id === pz.vehiculo)?.autobus, "Línea": x.vacio ? "Vacío" : x.nombre, "Sentido": x.sentido,
          "Salida": hhmm(x.dep), "Llegada": hhmm(x.arr), "Desde": nom(x.o), "Hasta": nom(x.d), "Inicio turno": hhmm(t.inicio), "Fin turno": hhmm(t.fin), "Avisos": t.avisos.join(" · "),
        }))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), tipo === "vehiculos" ? "Autobuses" : "Turnos");
    XLSX.writeFile(wb, `${tipo === "vehiculos" ? "vehiculos" : "turnos"}_${res.diaNombre.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.xlsx`);
  }

  const subTabs = [["escenario", "Escenario / Gantt"], ["calendarios", "Calendarios"], ["horarios", "Horarios de salida"]];
  const cabecera = (
    <div style={{ height: 38, flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2 }}>
      {subTabs.map(([k, l]) => (
        <button key={k} onClick={() => setSubTab(k)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 14px", fontFamily: font, fontSize: 12, fontWeight: subTab === k ? 600 : 400, color: subTab === k ? C.text : C.muted, borderBottom: `2px solid ${subTab === k ? C.blue : "transparent"}`, marginBottom: -1 }}>{l}</button>
      ))}
      {lote && (
        <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: C.blueText, fontFamily: mono }}>
          {lote.optimizar ? "Optimizando" : "Calculando"} calendarios · {lote.progreso[0] + 1} de {lote.progreso[1]}
        </div>
      )}
    </div>
  );

  if (estado.cargando) return <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg }}>{cabecera}<div style={{ padding: 30, color: C.muted, fontFamily: font, fontSize: 13 }}>Cargando la red…</div></div>;
  if (!red) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font }}>
      {cabecera}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>Importa primero la red (GTFS) en Planning para generar el escenario.</div>
    </div>
  );

  const nLineas = params.lineas ? params.lineas.length : red.lineas.length;
  const totalViajes = red.lineas.filter(l => !params.lineas || params.lineas.includes(l.id)).reduce((s, l) => s + l.sentidos.reduce((a, x) => a + viajesDia(x, params.dia, red), 0), 0);
  const btnSec = { padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 };
  const btnExcel = { padding: "5px 10px", background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.3)", color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 };
  const icoDescarga = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
  const sep = <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />;
  const infoCal = porCalendario[dia];
  const restriccionesUI = { ...params, entreLineas: params.entreLineasGlobal };
  const sinTurnos = res && !res.turnos;
  const etiquetaOpt = [infoCal?.objetivoV && `vehículos: ${nombreObjetivo(infoCal.objetivoV)}`, infoCal?.objetivoT && `turnos: ${nombreObjetivo(infoCal.objetivoT)}`].filter(Boolean).join(" · ");
  const paso = (v, n, l, aviso) => (
    <button key={v} onClick={() => setModo(v)} title={aviso || undefined} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 4, border: "none", cursor: "pointer", background: modo === v ? C.blue : "none", color: modo === v ? "#fff" : C.muted, fontSize: 11, fontWeight: modo === v ? 600 : 400, fontFamily: font }}>
      <span style={{ width: 16, height: 16, borderRadius: 8, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", background: modo === v ? "#fff" : C.bg, color: modo === v ? C.blue : C.muted }}>{n}</span>
      {l}
      {aviso && <span style={{ width: 7, height: 7, borderRadius: 4, background: C.amber }} />}
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, minHeight: 0 }}>
      {cabecera}
      {subTab === "horarios" ? <Horarios red={red} cfg={cfg} diaInicial={params.dia} /> : subTab === "calendarios" ? (
        <ResumenCalendarios red={red} porCalendario={porCalendario} claveDe={d => claveEscenario(paramsPara(d), cfgTxt)} claveVDe={d => claveVehiculos(paramsPara(d), cfgTxt)} precios={params} diaActual={dia}
          objetivoV={objetivoV} setObjetivoV={setObjetivoV} objetivoT={objetivoT} setObjetivoT={setObjetivoT} lote={lote} pendientes={pendientes} ocupado={opt.estado === "corriendo"}
          onVer={d => { setSubTab("escenario"); cambiarDia(d); }} onLote={calcularLote} onParar={pararLote} onRestricciones={() => { setSubTab("escenario"); setShowC(true); }} />
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* ── TOOLBAR (como la del Scheduling de puntos) ── */}
          <div style={{ padding: "0 16px", height: 46, borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setPanelLineas(v => !v)} title="Líneas que entran en el escenario" style={{ padding: "5px 11px", background: C.greenDim, border: `1px solid ${C.green}44`, color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                {totalViajes.toLocaleString("es-ES")} viajes · {nLineas === red.lineas.length ? `${nLineas} líneas` : `${nLineas} de ${red.lineas.length} líneas`}
              </button>
              {panelLineas && <SelectorLineas lineas={red.lineas} elegidas={params.lineas} onCambiar={ids => setCambios(c => ({ ...c, lineas: ids }))} onCerrar={() => setPanelLineas(false)} />}
            </div>
            <SelectorCalendario red={red} valor={dia} onCambiar={cambiarDia} ancho={240} />
            {etiquetaOpt && <span title={`Estrategia de este calendario: ${nombreEstrategia(infoCal.estrategia || {}, params.piezaMax)}`} style={{ fontSize: 10.5, color: C.green, border: `1px solid ${C.green}44`, borderRadius: 10, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>Optimizado · {etiquetaOpt}</span>}
            {sep}
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2, flexShrink: 0 }}>
              {paso("vehicles", 1, "Vehículos")}
              {paso("workers", 2, "Trabajadores", sinTurnos ? "Faltan los turnos de estos vehículos" : null)}
            </div>
            <button onClick={() => setShowC(s => !s)} style={{ ...btnSec, background: showC ? C.surface2 : "none", border: `1px solid ${showC ? C.border2 : C.border}`, color: showC ? C.text : C.muted }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
              Restricciones
            </button>
            {res && <>
              {sep}
              {modo === "vehicles"
                ? <button onClick={() => exportar("vehiculos")} title="Descargar los autobuses, con los vacíos, en Excel" style={btnExcel}>{icoDescarga} Vehículos</button>
                : <button onClick={() => exportar("turnos")} disabled={!res.turnos} title="Descargar los turnos de conductor en Excel" style={{ ...btnExcel, opacity: res.turnos ? 1 : 0.4 }}>{icoDescarga} Trabajadores</button>}
            </>}
            <div style={{ flex: 1 }} />
            <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar por línea…" style={{ width: 130, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontFamily: font, outline: "none" }} />
            <button onClick={() => setShowOpt(s => !s)} title={modo === "vehicles" ? "Buscar los mejores vehículos de este calendario" : "Buscar los mejores turnos sobre estos vehículos"} style={{ ...btnSec, padding: "6px 12px", fontSize: 12, fontWeight: 600, background: showOpt ? C.blueDim : "none", border: `1px solid ${showOpt ? C.blue : C.border2}`, color: showOpt ? C.blueText : C.text }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></svg>
              {opt.estado === "corriendo" ? `Optimizando ${opt.progreso[1] ? Math.round((100 * opt.progreso[0]) / opt.progreso[1]) : 0}%` : modo === "vehicles" ? "Optimizar vehículos" : "Optimizar turnos"}
            </button>
            <button onClick={() => { setPanelLineas(false); if (perderManuales(fase)) calcular(params, fase); }} disabled={calculando} style={{
              padding: "7px 16px", borderRadius: 7, border: "none", background: pendientes ? C.amber : C.blue, color: pendientes ? "#0b1220" : "#fff",
              fontSize: 12, fontWeight: 600, cursor: calculando ? "wait" : "pointer", fontFamily: font, flexShrink: 0, whiteSpace: "nowrap",
            }}>{calculando ? "Generando…" : `${modo === "vehicles" ? "Generar vehículos" : "Generar turnos"}${pendientes ? " con los cambios" : ""}`}</button>
          </div>

          {manualesActuales.length > 0 && (
            <div style={{ padding: "5px 16px", fontSize: 11.5, color: C.blueText, background: "rgba(92,155,255,0.08)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <span>✎ {manualesActuales.length} cambio{manualesActuales.length > 1 ? "s" : ""} a mano en este calendario ({manualesActuales.filter(esCambioVehiculos).length} de vehículos, {manualesActuales.filter(esCambioTurnos).length} de turnos). Se guardan y se vuelven a aplicar al abrirlo.</span>
              <button onClick={deshacer} disabled={calculando} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: font }}>Deshacer el último</button>
              <button onClick={quitarManuales} disabled={calculando} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>Quitarlos todos</button>
            </div>
          )}
          {showC && <Restricciones p={restriccionesUI} red={red} onCambiarDia={cambiarDia} onChange={ch => setCambios(c => ({ ...c, ...ch }))} onCerrar={() => setShowC(false)} />}
          {showOpt && <PanelOptimizar fase={fase} p={params} diaNombre={nombreDia(dia, red)} objetivo={fase === "vehiculos" ? objetivoV : objetivoT} setObjetivo={fase === "vehiculos" ? setObjetivoV : setObjetivoT}
            opt={opt} onOptimizar={optimizar} onAplicar={aplicarOpt} onRestricciones={() => setShowC(true)}
            bloqueado={lote ? "Espera a que terminen los cálculos de la pestaña Calendarios" : null} />}
          {res && ((params.flotaMax > 0 && res.kpis.autobuses > params.flotaMax) || (params.conductoresMax > 0 && res.kpis.turnos > params.conductoresMax)) && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.red, background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.3)" }}>
              El escenario no cabe en los recursos disponibles:
              {params.flotaMax > 0 && res.kpis.autobuses > params.flotaMax && ` necesita ${num(res.kpis.autobuses)} autobuses y hay ${num(params.flotaMax)}.`}
              {params.conductoresMax > 0 && res.kpis.turnos > params.conductoresMax && ` Necesita ${num(res.kpis.turnos)} conductores y hay ${num(params.conductoresMax)}.`}
              {" "}Prueba «Optimizar» o relaja las restricciones.
            </div>
          )}

          {res && !res.conCocheras && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.amber, background: "rgba(251,191,36,0.08)", borderBottom: "1px solid rgba(251,191,36,0.3)" }}>
              Sin cocheras: no se calculan las salidas ni las vueltas a cochera ni sus km en vacío. Añádelas en Planning («Cocheras»).
            </div>
          )}
          {res?.aproximado && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.amber, background: "rgba(251,191,36,0.08)", borderBottom: "1px solid rgba(251,191,36,0.3)" }}>
              Esta red se importó sin las horas de salida de cada viaje: se han repartido entre la primera y la última de cada sentido. Vuelve a importar el GTFS en Planning («Sustituir red») para usar los horarios exactos.
            </div>
          )}

          {res && <KpiBar k={kpisBarra(res, params)} base={actual.base} onConfigCostes={() => setShowC(true)} cambios={cambiosKpi(res, params)} />}
          {res && modo === "workers" && !res.turnos ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", maxWidth: 460 }}>
                <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 6 }}>Paso 2 · Turnos de conductor</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                  Los vehículos de este calendario ({num(res.kpis.autobuses)} autobuses, {num(res.kpis.bloques)} bloques, {num(res.kpis.kmVacio || 0)} km en vacío) aún no tienen turnos. Se hacen sobre esos bloques sin cambiarlos.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => calcular(params, "turnos", { conservar: true })} disabled={calculando} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{calculando ? "Generando…" : "Generar turnos"}</button>
                  <button onClick={() => setShowOpt(true)} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${C.border2}`, background: "none", color: C.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Optimizar turnos…</button>
                </div>
              </div>
            </div>
          ) : res ? <Gantt key={`${modo}|${res.params.dia}|${!!res.turnos}`} res={res} modo={modo} filtro={filtro} paradasPorId={paradasPorId} onMover={calculando ? null : mover} />
            : <div style={{ padding: 20, color: C.muted, fontSize: 13 }}>{calculando ? "Generando…" : "Pulsa «Generar vehículos»."}</div>}
        </div>
      )}
      {nota && (
        <div onClick={() => setNota(null)} style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 3000, maxWidth: "min(760px, calc(100vw - 32px))", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, cursor: "pointer",
          background: nota.error ? "#3a1620" : "#0d2f22", border: `1px solid ${nota.error ? C.red : C.green}`, color: nota.error ? "#fecaca" : "#bbf7d0", boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>{nota.texto}</div>
      )}
    </div>
  );
}

// ── Resumen de todos los calendarios ────────────────────────────────────
function ResumenCalendarios({ red, porCalendario, claveDe, claveVDe, precios, diaActual, objetivoV, setObjetivoV, objetivoT, setObjetivoT, lote, pendientes, ocupado, onVer, onLote, onParar, onRestricciones }) {
  const cals = red.calendarios || [];
  const filasTipo = TIPOS_DIA.map(t => ({ id: t.id, nombre: t.nombre, detalle: red.dias?.[t.id] ? `día de referencia ${fechaLarga(red.dias[t.id])}` : "sin servicio", dias: null }));
  const filasCal = cals.map((c, i) => ({ id: c.id, nombre: c.nombre, detalle: c.codigos?.join(", "), dias: c.fechas.length, color: COLORES_CAL[i % COLORES_CAL.length], viajesGtfs: c.viajes }));
  const estadoDe = id => {
    const r = porCalendario[id];
    if (!r?.resumen) return "nada";
    if (r.resumen.turnos == null) return r.claveV === claveVDe(id) ? "sinTurnos" : "viejo";
    return r.clave !== claveDe(id) ? "viejo" : "ok";
  };
  const hayPrecios = precios.costeHora > 0 || precios.costeKm > 0 || precios.costeVehiculoDia > 0;
  const todas = [...filasTipo, ...filasCal];
  const pendientesCalc = todas.filter(f => estadoDe(f.id) !== "ok").map(f => f.id);
  const bloqueo = lote ? "Ya hay un cálculo en marcha" : ocupado ? "Hay una optimización en marcha" : pendientes ? "Genera primero el escenario con los cambios de Restricciones" : null;
  // totales del periodo (solo calendarios del GTFS, que no se solapan)
  const calc = filasCal.filter(f => porCalendario[f.id]?.resumen);
  const tot = calc.reduce((a, f) => {
    const r = porCalendario[f.id].resumen, c = r.turnos == null ? null : costeDia(r, precios);
    return { dias: a.dias + f.dias, viajes: a.viajes + r.viajes * f.dias, horas: a.horas + (r.horasPagadas || 0) * f.dias, km: a.km + r.km * f.dias, kmVacio: a.kmVacio + (r.kmVacio || 0) * f.dias, coste: c == null ? a.coste : (a.coste ?? 0) + c * f.dias, buses: Math.max(a.buses, r.autobuses), turnos: Math.max(a.turnos, r.turnos ?? 0) };
  }, { dias: 0, viajes: 0, horas: 0, km: 0, kmVacio: 0, coste: null, buses: 0, turnos: 0 });
  const th = { fontSize: 9, color: C.dim, letterSpacing: 1, fontWeight: 700, padding: "7px 10px", textAlign: "right", textTransform: "uppercase", whiteSpace: "nowrap", position: "sticky", top: 0, background: C.card, zIndex: 1 };
  const td = { padding: "6px 10px", fontFamily: mono, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap" };
  const boton = (texto, onClick, principal, titulo) => (
    <button onClick={onClick} disabled={!!bloqueo} title={bloqueo || titulo} style={{ padding: "6px 12px", borderRadius: 7, border: principal ? "none" : `1px solid ${C.border2}`, background: principal ? C.blue : "none", color: principal ? "#fff" : C.text, fontSize: 12, fontWeight: 600, cursor: bloqueo ? "not-allowed" : "pointer", opacity: bloqueo ? 0.5 : 1, fontFamily: font, flexShrink: 0 }}>{texto}</button>
  );
  const fila = f => {
    const r = porCalendario[f.id], est = estadoDe(f.id), x = r?.resumen;
    const viejo = est === "viejo";
    const c = x && x.turnos != null ? costeDia(x, precios) : null;
    const enCurso = lote?.dia === f.id;
    const col = viejo ? C.dim : C.text;
    return (
      <tr key={f.id} style={{ borderTop: `1px solid ${C.border}`, background: f.id === diaActual ? "rgba(92,155,255,0.07)" : enCurso ? "rgba(251,191,36,0.06)" : "none" }}>
        <td style={{ ...td, textAlign: "left", fontFamily: font, maxWidth: 340 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: f.color || "transparent", border: f.color ? "none" : `1px solid ${C.dim}`, flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{f.nombre}{f.id === diaActual && <span style={{ color: C.blue, fontSize: 10 }}> · en pantalla</span>}</div>
              {f.detalle && <div style={{ fontSize: 10, color: C.dim, overflow: "hidden", textOverflow: "ellipsis" }}>{f.detalle}</div>}
            </span>
          </div>
        </td>
        <td style={{ ...td, color: C.muted }}>{f.dias ?? "—"}</td>
        <td style={{ ...td, color: col }}>{x ? num(x.viajes) : f.viajesGtfs != null ? <span style={{ color: C.dim }}>{num(f.viajesGtfs)}</span> : "—"}</td>
        <td style={{ ...td, color: col, fontWeight: 700 }}>{x ? num(x.autobuses) : "—"}</td>
        <td style={{ ...td, color: col, fontWeight: 700 }}>{x && x.turnos != null ? num(x.turnos) : "—"}</td>
        <td style={{ ...td, color: viejo ? C.dim : C.muted }}>{x ? num(x.kmVacio || 0) : "—"}</td>
        <td style={{ ...td, color: col }}>{x && x.horasPagadas != null ? num(x.horasPagadas) : "—"}</td>
        <td style={{ ...td, color: x?.avisos ? C.red : C.dim }}>{x && x.avisos != null ? x.avisos : "—"}</td>
        {hayPrecios && <td style={{ ...td, color: col }}>{c != null ? `${num(c)} €` : "—"}</td>}
        {hayPrecios && <td style={{ ...td, color: col }}>{c != null && f.dias ? `${num(c * f.dias)} €` : "—"}</td>}
        <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 11 }}>
          {enCurso ? <span style={{ color: C.amber }}>{lote.optimizar ? "Optimizando…" : "Calculando…"}</span>
            : est === "nada" ? <span style={{ color: C.dim }}>Sin calcular</span>
            : viejo ? <span style={{ color: C.amber }} title="Han cambiado las restricciones, las líneas, las cocheras o su configuración desde que se calculó">Desactualizado</span>
            : est === "sinTurnos" ? <span style={{ color: C.amber }} title="Solo se ha hecho el paso 1 (vehículos)">Faltan los turnos</span>
            : r.objetivoV || r.objetivoT ? <span style={{ color: C.green }} title={nombreEstrategia(r.estrategia || {}, precios.piezaMax)}>Optimizado · {[r.objetivoV && nombreObjetivo(r.objetivoV), r.objetivoT && nombreObjetivo(r.objetivoT)].filter(Boolean).join(" · ")}</span>
            : <span style={{ color: C.muted }} title={nombreEstrategia(r.estrategia || {}, precios.piezaMax)}>Calculado</span>}
        </td>
        <td style={td}><div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={() => onVer(f.id)} style={{ padding: "3px 10px", borderRadius: 5, background: "none", border: `1px solid ${C.border2}`, color: C.blueText, fontSize: 11, cursor: "pointer", fontFamily: font }}>Ver</button>
          <button onClick={() => onLote([f.id], true)} disabled={!!bloqueo} title={bloqueo || `Optimizar solo este calendario: vehículos (${nombreObjetivo(objetivoV)}) y turnos (${nombreObjetivo(objetivoT)})`} style={{ padding: "3px 10px", borderRadius: 5, background: "none", border: `1px solid ${C.border2}`, color: C.text, fontSize: 11, cursor: bloqueo ? "not-allowed" : "pointer", opacity: bloqueo ? 0.5 : 1, fontFamily: font }}>Optimizar</button>
        </div></td>
      </tr>
    );
  };
  const cabeceraTabla = (
    <thead><tr>
      <th style={{ ...th, textAlign: "left" }}>Calendario</th><th style={th}>Días</th><th style={th}>Viajes/día</th><th style={th}>Autobuses</th><th style={th}>Turnos</th><th style={th}>Km vacío</th><th style={th}>Horas pagadas</th><th style={th}>Avisos</th>
      {hayPrecios && <th style={th}>Coste/día</th>}{hayPrecios && <th style={th}>Coste periodo</th>}<th style={{ ...th, textAlign: "left" }}>Estado</th><th style={th} />
    </tr></thead>
  );
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "0 16px", minHeight: 46, borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {[["Paso 1 · Vehículos", OBJETIVOS_VEHICULOS, objetivoV, setObjetivoV], ["Paso 2 · Turnos", OBJETIVOS_TURNOS, objetivoT, setObjetivoT]].map(([t, lista, val, set]) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{t}</span>
            <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 6, padding: 2 }}>
              {lista.map(o => {
                const off = o.precios && !o.precios.some(k => precios[k] > 0);
                return <button key={o.id} disabled={off} onClick={() => set(o.id)} title={off ? "Pon los precios en Restricciones" : o.ayuda} style={{ padding: "4px 9px", borderRadius: 4, border: "none", cursor: off ? "not-allowed" : "pointer", background: val === o.id ? C.blue : "none", color: val === o.id ? "#fff" : off ? C.dim : C.muted, fontSize: 11, fontWeight: val === o.id ? 600 : 400, fontFamily: font }}>{o.nombre}</button>;
              })}
            </div>
          </div>
        ))}
        {!hayPrecios && <button onClick={onRestricciones} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 11, fontFamily: font }}>poner precios para ver el coste</button>}
        <div style={{ flex: 1 }} />
        {lote ? (
          <>
            <div style={{ width: 180, height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${(100 * (lote.progreso[0] + 0.5)) / lote.progreso[1]}%`, background: C.blue }} /></div>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{lote.progreso[0] + 1}/{lote.progreso[1]} · {nombreDia(lote.dia, red)}</span>
            <button onClick={onParar} style={{ padding: "5px 10px", borderRadius: 6, background: "none", border: `1px solid ${C.red}66`, color: C.red, fontSize: 11, cursor: "pointer", fontFamily: font }}>Parar</button>
          </>
        ) : (
          <>
            {boton(`Calcular pendientes (${pendientesCalc.length})`, () => onLote(pendientesCalc, false), false, "Calcula los dos pasos, con su estrategia, de los calendarios sin calcular, sin turnos o desactualizados")}
            {boton(`Optimizar todos (${todas.length})`, () => onLote(todas.map(f => f.id), true), true, "Optimiza cada calendario por separado: primero los vehículos y después los turnos, con los objetivos elegidos")}
          </>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 0 16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          {cabeceraTabla}
          <tbody>
            <tr><td colSpan={12} style={{ padding: "12px 10px 4px", fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700 }}>TIPOS DE DÍA (DÍA DE REFERENCIA)</td></tr>
            {filasTipo.map(fila)}
            {filasCal.length > 0 && <tr><td colSpan={12} style={{ padding: "14px 10px 4px", fontSize: 9, color: C.dim, letterSpacing: 1.5, fontWeight: 700 }}>CALENDARIOS DEL GTFS ({filasCal.length})</td></tr>}
            {filasCal.map(fila)}
            {calc.length > 0 && (
              <tr style={{ borderTop: `1px solid ${C.border2}`, background: C.surface2 }}>
                <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 11.5, fontWeight: 700, color: C.text }}>
                  Periodo del GTFS{calc.length < filasCal.length && <span style={{ color: C.amber, fontWeight: 400 }}> · faltan {filasCal.length - calc.length} calendarios</span>}
                </td>
                <td style={{ ...td, color: C.text }}>{tot.dias}</td>
                <td style={{ ...td, color: C.text }} title="Viajes de todo el periodo">{num(tot.viajes)}</td>
                <td style={{ ...td, color: C.text, fontWeight: 700 }} title="Flota necesaria: el máximo de un día">{num(tot.buses)} máx.</td>
                <td style={{ ...td, color: C.text, fontWeight: 700 }} title="Turnos del día con más">{num(tot.turnos)} máx.</td>
                <td style={{ ...td, color: C.text }} title="Km en vacío de todo el periodo">{num(tot.kmVacio)}</td>
                <td style={{ ...td, color: C.text }} title="Horas pagadas de todo el periodo">{num(tot.horas)}</td>
                <td style={td} />
                {hayPrecios && <td style={td} />}
                {hayPrecios && <td style={{ ...td, color: C.text, fontWeight: 700 }}>{tot.coste != null ? `${num(tot.coste)} €` : "—"}</td>}
                <td colSpan={2} style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 10.5, color: C.dim }}>viajes, horas y coste: suma de los días del periodo</td>
              </tr>
            )}
          </tbody>
        </table>
        {!cals.length && <div style={{ padding: "10px 16px", fontSize: 11, color: C.dim }}>Esta red se importó antes de leer los calendarios. Vuelve a importar el GTFS en Planning («Sustituir red») para tener todos los calendarios.</div>}
        <div style={{ padding: "10px 16px", fontSize: 10.5, color: C.dim, lineHeight: 1.6 }}>
          Cada calendario tiene su propio escenario y su propia estrategia: optimizar uno no cambia los demás. Las restricciones (jornada, pausas, flota…) son comunes a todos. Los costes usan los precios actuales de Restricciones.
        </div>
      </div>
    </div>
  );
}

// Indicadores en el formato de la KpiBar del Scheduling de puntos
function kpisBarra(res, p) {
  const k = res.kpis;
  const turnos = res.turnos || [];
  const conduccion = turnos.reduce((s, t) => s + t.conduccion, 0);
  const pagado = turnos.reduce((s, t) => s + t.trabajo, 0);
  const coste = res.turnos ? costeDia({ horasPagadas: pagado / 60, km: k.km, autobuses: k.autobuses }, p) : null;
  return {
    vehiculos: k.autobuses, pvr: k.pico, turnos: k.turnos, paradas: k.viajes, km: k.km, kmVacio: k.kmVacio || 0,
    conduccion, trabajo: 0, pagado, eficVehiculo: k.km ? (k.km - (k.kmVacio || 0)) / k.km : null, eficPersonal: k.eficienciaPersonal, coste,
    avisos: turnos.reduce((s, t) => s + t.avisos.length, 0), filasConAviso: k.turnosConAviso, sinAsignar: 0,
    // campos con los nombres que usa la comparación ▲▼
    vehicleCount: k.autobuses, totalKm: k.km, totalStops: k.viajes,
  };
}
function cambiosKpi(res, p = res.params) {
  const k = res.kpis;
  return {
    "Vehículos": { l: "Autobuses", sub: `pico ${k.pico} a la vez · ${num(k.bloques)} bloques`, ayuda: "Autobuses necesarios: un mismo autobús puede hacer varios bloques si entre ellos hay margen para ir y volver de cochera. El pico es el máximo en servicio a la vez." },
    "Turnos": { sub: res.turnos ? (Object.keys(k.turnosPorTipo || {}).length ? Object.entries(k.turnosPorTipo).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${num(c)} ${n.toLowerCase()}`).join(" · ") : `${(k.piezasMedias || 0).toFixed(1).replace(".", ",")} piezas de media · ${num(k.turnosPartidos || 0)} partidos`) : "falta el paso 2 (turnos)", subColor: res.turnos ? undefined : C.amber, ayuda: "Turnos de conductor: cada uno encadena las piezas (de cualquier autobús, con relevo en cabecera) que caben en su jornada y amplitud. Partido = con un hueco largo sin pagar." },
    "Eficiencia vehículo": { sub: `km con viajeros / km totales · ${num(k.km - (k.kmVacio || 0))} / ${num(k.km)}`, ayuda: "Parte de los km que se hacen con viajeros: el resto son vacíos (salir y volver a cochera, ir a otra cabecera)." },
    "Eficiencia personal": { sub: `conducción / trabajo · ${num(k.horasPagadas)} h`, ayuda: "Tiempo conduciendo con viajeros / tiempo de trabajo de los turnos (suma de sus piezas)." },
    "Km": { sub: `${num(k.kmVacio || 0)} en vacío · ${num(k.vacios || 0)} vacíos`, ayuda: "Kilómetros del día: los de los viajes y los vacíos (salida y vuelta a cochera, y entre cabeceras)." },
    "Paradas": { l: "Viajes", sub: res.diaNombre, subColor: C.dim, ayuda: "Viajes del calendario elegido en las líneas del escenario." },
    "Avisos": { ayuda: "Turnos que incumplen la conducción UE 561/2006 o el descanso del Estatuto (art. 34.4)." },
    ...(!res.turnos && costeDia({ horasPagadas: 0, km: 0, autobuses: 0 }, p) != null && { "Coste estimado": { v: "—", sub: "falta el paso 2 (turnos)" } }),
    ...(res.turnos && costeDia({ horasPagadas: 0, km: 0, autobuses: 0 }, p) != null && { "Coste estimado": { sub: "personal + autobuses + km", ayuda: "Horas pagadas × €/h + autobuses × €/autobús·día + km × €/km, con los precios de Restricciones." } }),
  };
}

function SelectorLineas({ lineas, elegidas, onCambiar, onCerrar }) {
  const [q, setQ] = useState("");
  const set = new Set(elegidas || lineas.map(l => l.id));
  const vis = lineas.filter(l => !q.trim() || norm(`${l.nombre} ${l.sentidos.map(s => s.cabecera).join(" ")} ${l.tipo}`).includes(norm(q.trim())));
  const poner = ids => onCambiar(ids.length === lineas.length ? null : ids);
  return (
    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 360, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", padding: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        <button onClick={onCerrar} style={{ background: "none", border: "none", color: C.muted, fontSize: 16, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {[["Marcar visibles", () => poner([...new Set([...set, ...vis.map(l => l.id)])])], ["Quitar visibles", () => poner([...set].filter(id => !vis.some(l => l.id === id)))], ["Todas", () => poner(lineas.map(l => l.id))]].map(([t, f]) => (
          <button key={t} onClick={f} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontFamily: font }}>{t}</button>
        ))}
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {vis.slice(0, 300).map(l => (
          <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px", cursor: "pointer" }}>
            <input type="checkbox" checked={set.has(l.id)} onChange={() => poner(set.has(l.id) ? [...set].filter(x => x !== l.id) : [...set, l.id])} />
            <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 5, background: l.color, color: "#0b1220", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{l.nombre}</span>
            <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.sentidos.map(s => s.cabecera).join(" ↔ ")}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
