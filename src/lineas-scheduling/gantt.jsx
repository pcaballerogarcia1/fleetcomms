// Scheduling de líneas: el Gantt (autobuses o turnos, con cambios a mano).
import { useState, useEffect, useMemo } from "react";
import { claveViaje } from "../lineas-sched.js";
import { C, COLS, PAGINA, ROW_H, TABLE_W, ZOOM_STEPS, filasDe, font, hhmm, hm, horaEje, mono, norm, num } from "./comun.js";
import { tono } from "../tema.js";

const celda = (r, k) => {
  if (k === "nombre") return r.manual ? `${r.nombre} ✎` : r.nombre;
  if (k === "inicio" || k === "fin") return hhmm(r[k]);
  if (k === "amplitud" || k === "conduccion" || k === "pausas") return r[k] ? hm(r[k]) : "—";
  if (k === "km" || k === "kmVacio") return Math.round(r[k]).toLocaleString("es-ES");
  return r[k];
};

// Forma de una pieza: un extremo recto y el otro en punta, en la cabecera «en punta» de la línea
const formaPieza = (dir, w) => {
  const n = Math.min(9, w * 0.45);
  return dir === 1
    ? { borderRadius: "4px 0 0 4px", clipPath: `polygon(0 0, calc(100% - ${n}px) 0, 100% 50%, calc(100% - ${n}px) 100%, 0 100%)` }
    : { borderRadius: "0 4px 4px 0", clipPath: `polygon(${n}px 0, 100% 0, 100% 100%, ${n}px 100%, 0 50%)` };
};

export function Gantt({ res, modo, filtro, paradasPorId, onMover }) {
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
          <div key={r.nombre} {...zonaDe(r.id)} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.border}`, background: sobre === r.id ? "rgba(91,124,250,0.18)" : ri % 2 ? tono("rgba(23,32,53,0.45)", "rgba(255,255,255,0.45)") : "transparent", outline: sobre === r.id ? `1px solid ${C.blue}` : "none", outlineOffset: -1, width: leftW + ancho }}>
            <div style={{ width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 4, background: ri % 2 ? tono("#141d30", "#e8ecf5") : C.bg, display: "flex", alignItems: "center", padding: "0 4px", borderRight: `1px solid ${C.border}` }}>
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
              {horas.map(h => <div key={h} style={{ position: "absolute", left: X(h), top: 0, bottom: 0, width: 1, background: "rgba(148,163,184,0.07)" }} />)}
              {r.vacios.map((x, i) => (
                <div key={`v${i}`} title={`Sin servicio (en cochera) ${hhmm(x.inicio)}–${hhmm(x.fin)}`} style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.36, height: ROW_H * 0.28,
                  background: `repeating-linear-gradient(135deg, #92400e 0px, #92400e 6px, ${C.orange}55 6px, ${C.orange}55 12px)`, borderRadius: 3, opacity: 0.6 }} />
              ))}
              {r.tramosPausa.map((x, i) => (
                <div key={`p${i}`} title={`Pausa ${hm(x.fin - x.inicio)}`} style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.3, height: ROW_H * 0.4,
                  background: "repeating-linear-gradient(45deg,rgba(34,211,238,0.15) 0,rgba(34,211,238,0.15) 4px,transparent 4px,transparent 8px)", border: "1px dashed rgba(34,211,238,0.4)", borderRadius: 3 }} />
              ))}
              {(r.tomaDeje || []).map((x, i) => (
                // toma o deje de servicio (con el viaje desde o hasta la cochera, si lo hay)
                <div key={`td${i}`} title={`${x.que} de servicio ${hhmm(x.inicio)}–${hhmm(x.fin)} · ${x.min} min${x.viaje ? ` (${x.viaje} de viaje desde/hasta la cochera)` : ""}`}
                  style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.32, height: ROW_H * 0.36, zIndex: 1,
                    background: "repeating-linear-gradient(90deg,rgba(148,163,184,0.35) 0,rgba(148,163,184,0.35) 2px,transparent 2px,transparent 5px)", border: "1px solid rgba(148,163,184,0.6)", borderRadius: 3 }} />
              ))}
              {(r.desplazamientos || []).map((x, i) => (
                // el conductor va de una cabecera a otra para coger el siguiente autobús (trabajo, no pausa)
                <div key={`d${i}`} title={`Desplazamiento a otra cabecera ${hhmm(x.inicio)}–${hhmm(x.fin)} · ${x.fin - x.inicio} min${x.km ? ` · ${String(x.km).replace(".", ",")} km` : ""}`}
                  style={{ position: "absolute", left: X(x.inicio), width: Math.max(2, X(x.fin) - X(x.inicio)), top: ROW_H * 0.3, height: ROW_H * 0.4, zIndex: 1,
                    background: "repeating-linear-gradient(90deg,rgba(167,139,250,0.35) 0,rgba(167,139,250,0.35) 3px,transparent 3px,transparent 6px)", border: "1px solid rgba(167,139,250,0.7)", borderRadius: 3 }} />
              ))}
              {r.splits.map((x, i) => {
                // split del partido: línea naranja de punta a punta del hueco sin pagar, con su duración
                const w = X(x.fin) - X(x.inicio);
                return (
                  <div key={`s${i}`} title={`Split (sin pagar) ${hhmm(x.inicio)}–${hhmm(x.fin)} · ${hm(x.fin - x.inicio)}`} style={{ position: "absolute", left: X(x.inicio), width: w, top: 0, bottom: 0, zIndex: 2, pointerEvents: "auto" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `2px dashed ${C.orange}` }} />
                    <div style={{ position: "absolute", left: 0, top: 6, bottom: 6, borderLeft: `2px solid ${C.orange}` }} />
                    <div style={{ position: "absolute", right: 0, top: 6, bottom: 6, borderRight: `2px solid ${C.orange}` }} />
                    {w > 46 && <span style={{ position: "absolute", left: "50%", top: 3, transform: "translateX(-50%)", fontSize: 9, fontWeight: 700, color: C.orange, background: C.bg, padding: "0 4px", borderRadius: 3, whiteSpace: "nowrap", fontFamily: mono }}>split {hm(x.fin - x.inicio)}</span>}
                  </div>
                );
              })}
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
                    style={{ ...(!x.vacio && sel.has(claveViaje(x)) ? { boxShadow: "inset 0 0 0 2px #fff", filter: "brightness(1.25)", zIndex: 2 } : {}), ...(arr && !x.vacio && (arr.claves ? arr.claves.includes(claveViaje(x)) : claveDe(x, r) === arr.clave) ? { opacity: 0.4, boxShadow: "inset 0 0 0 2px #fff" } : {}), cursor: onMover && !x.vacio ? "grab" : "default", ...(x.vacio ? {
                      position: "absolute", left: X(x.dep), width: w, top: 9, height: ROW_H - 18, borderRadius: 3,
                      background: "repeating-linear-gradient(135deg, #475569 0px, #475569 4px, #64748b 4px, #64748b 8px)", border: "1px solid #94a3b8",
                      color: "#e2e8f0", fontSize: 8.5, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 2, lineHeight: `${ROW_H - 20}px`,
                    } : {
                      // como en Optibus: la punta es siempre la misma cabecera de la línea (la de salida de
                      // la ida): la ida la lleva al salir (izquierda) y la vuelta al llegar (derecha)
                      position: "absolute", left: X(x.dep), width: w, top: 6, height: ROW_H - 12, ...formaPieza(x.dir, w),
                      background: x.color + (x.dir === 1 ? "c8" : "f0"), color: C.input, fontSize: 9.5, fontWeight: 800,
                      overflow: "hidden", whiteSpace: "nowrap", paddingLeft: x.dir === 1 ? 4 : Math.min(9, w * 0.45) + 2, lineHeight: `${ROW_H - 12}px`,
                    }) }}>{x.vacio ? (w > 34 && x.hacia ? `→${x.hacia}` : w > 14 ? "V" : "") : w > 20 ? x.nombre : ""}</div>
                );
              })}
              {r.relevos.map((x, i) => (
                <div key={`r${i}`} title={`Relevo · turno T${x.turno}`} style={{ position: "absolute", left: X(x.inicio) - 1, top: 2, bottom: 2, width: 2, background: "#fff", zIndex: 3 }}>
                  {modo === "vehicles" && <span style={{ position: "absolute", left: 2, top: -1, fontSize: 8.5, color: C.text, fontFamily: mono, whiteSpace: "nowrap", background: tono("rgba(11,18,32,0.85)", "rgba(255,255,255,0.85)"), borderRadius: 2, padding: "0 2px", lineHeight: "11px" }}>T{x.turno}</span>}
                </div>
              ))}
            </div>
          </div>
  );
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Controles del Gantt (como en el de puntos) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0, flexWrap: "wrap" }}>
        <div className="op-seg">
          <button onClick={() => cambiarVista("tabla")} className={vista === "tabla" ? "op-on" : ""}>Tabla</button>
          <button onClick={() => cambiarVista("compacta")} className={vista === "compacta" ? "op-on" : ""}>Compacta</button>
        </div>
        <div className="op-sep" />
        <span style={{ fontSize: 12, color: C.dim }}>Zoom</span>
        <div className="op-seg">
          {ZOOM_STEPS.map(z => <button key={z} onClick={() => setPx(z)} className={px === z ? "op-on" : ""}>{z}×</button>)}
        </div>
        <div className="op-sep" />
        <span style={{ fontSize: 12, color: C.dim }}>Ordenar</span>
        <div className="op-seg">
          {[["inicio", "Salida"], ["amplitud", "Amplitud"], ["nViajes", "Viajes"]].map(([k, l]) => (
            <button key={k} onClick={() => setOrden(o => (o?.k === k ? (o.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 }))} className={orden?.k === k ? "op-on" : ""}>
              {l} {orden?.k === k ? (orden.dir === 1 ? "↑" : "↓") : ""}
            </button>
          ))}
        </div>
        {modo === "workers" && res.kpis.turnosConAviso > 0 && <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>! {res.kpis.turnosConAviso} con avisos</span>}
        {sel.size > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", fontSize: 11.5, color: C.text, background: C.blueDim, border: `1px solid ${C.blue}`, borderRadius: 6, padding: "3px 6px 3px 10px" }}>
            {sel.size} {modo === "vehicles" ? "expedicion(es)" : "viaje(s)"} elegidos · arrástralos a otro {modo === "vehicles" ? "autobús" : "turno"}
            <button onClick={() => { if (onMover && onMover(tipoVarios, [...sel], null)) setSel(new Set()); }} style={{ background: C.green, border: "none", color: tono("#06281a", "#e4f8f0"), borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>A {modo === "vehicles" ? "uno nuevo" : "un turno nuevo"}</button>
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
                style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", fontSize: 10.5, color: orden?.k === col.k ? C.blue : C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, cursor: col.k !== "avisos" ? "pointer" : "default", whiteSpace: "nowrap", overflow: "hidden" }}>
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
            background: sobre === "nuevo" ? "rgba(63,207,142,0.25)" : "rgba(63,207,142,0.10)", color: C.green, border: `1px dashed ${C.green}`, boxSizing: "border-box" }}>
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
            <span style={{ minWidth: 30, padding: "1px 5px", borderRadius: 4, background: tip.x.color, color: tip.x.vacio ? "#fff" : C.input, fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{tip.x.nombre}</span>
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
