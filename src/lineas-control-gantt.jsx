// ── Gantt en vivo (Control de líneas): lo programado frente a lo real ──
// Cada fila es un turno (o un autobús). Arriba, en gris, los viajes del
// Scheduling tal y como se publicaron; debajo, en color, lo que se ha hecho
// de verdad (salida y llegada reales que anota el móvil), coloreado por
// puntualidad. El viaje en curso crece hasta la línea de «ahora».
import { useState, useEffect, useMemo, useRef } from "react";
import { hhmm, textoRetraso, COLOR_PUNTUALIDAD, ADELANTO_OK, RETRASO_OK } from "./lineas-servicio.js";

const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25", border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574", blue: "#5b7cfa", blueDim: "#1a2142", blueText: "#b4c3ff", red: "#f26d6d",
};
const font = "var(--font)";
const mono = "var(--mono)";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ROW = 34, ETIQ = 190, ESCALAS = [1, 2, 4, 8];
const GRIS = "#3b4a66", GRIS_VACIO = "#2a3550";
const estadoDe = d => (d == null ? null : d < -ADELANTO_OK ? "adelantado" : d > 10 ? "muy" : d > RETRASO_OK ? "tarde" : "ok");

/**
 * Filas del Gantt. modo "turnos": una por turno; "buses": una por autobús,
 * con los viajes de todos los turnos que lo conducen.
 * Cada viaje: { v, turno, s (salida real), l (llegada real), saltado }
 */
function filasDe(turnos, modo) {
  const viaje = (t, v) => ({ v, turno: t, s: t.real?.salidas?.[v.k] ?? null, l: t.real?.llegadas?.[v.k] ?? null, saltado: (t.real?.saltados || []).includes(v.k) });
  if (modo === "turnos") {
    return [...turnos].sort((a, b) => a.inicio - b.inicio || a.num - b.num).map(t => ({
      id: t.id, nombre: t.id, sub: t.conductorNombre || "sin trabajador", turnos: [t], viajes: t.viajes.map(v => viaje(t, v)), inicio: t.inicio,
    }));
  }
  const porBus = new Map();
  for (const t of turnos) for (const v of t.viajes) {
    if (!porBus.has(v.bus)) porBus.set(v.bus, []);
    porBus.get(v.bus).push(viaje(t, v));
  }
  return [...porBus].map(([bus, vs]) => {
    vs.sort((a, b) => a.v.dep - b.v.dep);
    const ts = [...new Set(vs.map(x => x.turno))];
    return { id: `bus-${bus}`, nombre: `Bus ${bus}`, sub: ts.map(t => t.id).join(" · "), turnos: ts, viajes: vs, inicio: vs[0]?.v.dep ?? 0 };
  }).sort((a, b) => a.inicio - b.inicio);
}

export function GanttVivo({ turnos, ahora, esHoy, onElegirTurno }) {
  const [modo, setModo] = useState("turnos");
  const [escala, setEscala] = useState(2); // px por minuto
  const [q, setQ] = useState("");
  const [soloMarcha, setSoloMarcha] = useState(false);
  const caja = useRef(null);
  const filas = useMemo(() => filasDe(turnos, modo), [turnos, modo]);
  const desde = useMemo(() => Math.floor(Math.min(...turnos.map(t => t.inicio)) / 60) * 60, [turnos]);
  const hasta = useMemo(() => Math.ceil(Math.max(...turnos.map(t => t.fin)) / 60) * 60, [turnos]);
  const x = m => (m - desde) * escala;
  const ancho = (hasta - desde) * escala;
  const vis = filas.filter(f =>
    (!soloMarcha || f.turnos.some(t => t.inicioReal != null && t.finReal == null)) &&
    (!q.trim() || norm(`${f.nombre} ${f.sub} ${f.viajes.map(v => v.v.l).join(" ")}`).includes(norm(q.trim()))));

  // al abrir (y al cambiar de escala), «ahora» queda a la vista, con una hora de margen a la izquierda
  useEffect(() => {
    const el = caja.current;
    if (el && esHoy) el.scrollLeft = Math.max(0, x(ahora - 60));
  }, [escala, modo, esHoy]); // eslint-disable-line react-hooks/exhaustive-deps

  const horas = [];
  for (let m = desde; m <= hasta; m += 60) horas.push(m);
  const btn = on => ({ padding: "4px 10px", borderRadius: 5, border: "none", background: on ? C.blue : "none", color: on ? "#fff" : C.muted, fontSize: 11.5, fontWeight: on ? 600 : 400, cursor: "pointer", fontFamily: font });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2 }}>
          <button onClick={() => setModo("turnos")} style={btn(modo === "turnos")}>Turnos</button>
          <button onClick={() => setModo("buses")} style={btn(modo === "buses")}>Autobuses</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={modo === "turnos" ? "Buscar turno, conductor o línea…" : "Buscar autobús, turno o línea…"} style={{ width: 230, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={soloMarcha} onChange={e => setSoloMarcha(e.target.checked)} /> Solo en marcha
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.dim }}>
          Zoom {ESCALAS.map(e => <button key={e} onClick={() => setEscala(e)} style={{ ...btn(escala === e), padding: "2px 8px", background: escala === e ? C.blueDim : "none", color: escala === e ? C.blueText : C.muted }}>{e}×</button>)}
        </div>
        {esHoy && <button onClick={() => { if (caja.current) caja.current.scrollLeft = Math.max(0, x(ahora - 60)); }} style={{ ...btn(false), border: `1px solid ${C.border2}` }}>Ir a ahora</button>}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 10.5, color: C.dim }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 7, borderRadius: 2, background: GRIS }} />programado</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 7, borderRadius: 2, background: COLOR_PUNTUALIDAD.ok }} />real (color = puntualidad)</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 7, borderRadius: 2, border: `1.5px solid ${C.red}` }} />no hecho</span>
        </span>
      </div>
      <div ref={caja} style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <div style={{ width: ETIQ + ancho, position: "relative" }}>
          {/* eje de horas */}
          <div style={{ position: "sticky", top: 0, zIndex: 3, height: 24, display: "flex", background: C.card, borderBottom: `1px solid ${C.border2}` }}>
            <div style={{ position: "sticky", left: 0, zIndex: 4, width: ETIQ, flexShrink: 0, background: C.card, borderRight: `1px solid ${C.border2}`, fontSize: 10, color: C.dim, padding: "6px 10px", boxSizing: "border-box" }}>{vis.length} {modo === "turnos" ? "turnos" : "autobuses"}</div>
            <div style={{ position: "relative", width: ancho }}>
              {horas.map(m => <span key={m} style={{ position: "absolute", left: x(m) + 3, top: 5, fontSize: 10, color: C.muted, fontFamily: mono }}>{hhmm(m)}</span>)}
            </div>
          </div>
          {/* filas */}
          <div style={{ position: "relative" }}>
            {/* rejilla de horas y la línea de ahora, por detrás */}
            <div style={{ position: "absolute", left: ETIQ, top: 0, bottom: 0, width: ancho, pointerEvents: "none" }}>
              {horas.map(m => <div key={m} style={{ position: "absolute", left: x(m), top: 0, bottom: 0, width: 1, background: "rgba(148,163,184,0.10)" }} />)}
              {esHoy && ahora >= desde && ahora <= hasta && <div style={{ position: "absolute", left: x(ahora), top: 0, bottom: 0, width: 2, background: C.blue, boxShadow: `0 0 8px ${C.blue}`, zIndex: 2 }} />}
            </div>
            {vis.map(f => (
              <div key={f.id} style={{ display: "flex", height: ROW, borderBottom: `1px solid ${C.border}` }}>
                <button onClick={() => onElegirTurno?.(f.turnos[0]?.id)} title={modo === "turnos" ? "Ver este turno en el mapa" : "Ver su turno en el mapa"} style={{ position: "sticky", left: 0, zIndex: 2, width: ETIQ, flexShrink: 0, background: C.card, border: "none", borderRight: `1px solid ${C.border2}`, textAlign: "left", padding: "0 10px", cursor: "pointer", fontFamily: font, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.text }}>{f.nombre}</span>
                  <span style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: ETIQ - 20 }}>{f.sub}</span>
                </button>
                <div style={{ position: "relative", width: ancho }}>
                  {f.viajes.map(({ v, turno, s, l, saltado }) => {
                    // «ahora» son los minutos desde el inicio del día del servicio (en un día pasado, ya pasó todo; en uno futuro, nada)
                    const pasado = ahora > v.arr + 2;
                    const sinHacer = !v.v && (saltado || (s == null && pasado && (turno.inicioReal != null || ahora > turno.fin)));
                    const titulo = `${turno.id} · Bus ${v.bus} · ${v.v ? (v.s || "Vacío") : `Línea ${v.l}: ${v.on} → ${v.dn}`}\nProgramado ${hhmm(v.dep)}–${hhmm(v.arr)}${s != null ? `\nReal ${hhmm(s)}–${l != null ? hhmm(l) : "en curso"} (${textoRetraso(Math.round(s - v.dep))})` : saltado ? "\nNo se hizo" : ""}`;
                    // lo real: de la salida a la llegada (o hasta ahora si está en curso)
                    const finReal = l ?? (s != null && ahora > s ? Math.min(ahora, s + (v.arr - v.dep) * 3) : null);
                    const desv = s != null ? s - v.dep : null;
                    const colorReal = COLOR_PUNTUALIDAD[estadoDe(desv) || "ok"];
                    return (
                      <div key={`${turno.id}-${v.k}`} title={titulo}>
                        <div style={{ position: "absolute", left: x(v.dep), width: Math.max(2, x(v.arr) - x(v.dep)), top: v.v ? 7 : 4, height: v.v ? 6 : 12, borderRadius: 3, background: v.v ? GRIS_VACIO : GRIS, boxSizing: "border-box", border: sinHacer ? `1.5px solid ${C.red}` : "none", overflow: "hidden" }}>
                          {!v.v && escala >= 2 && x(v.arr) - x(v.dep) > 18 && <span style={{ fontSize: 9, fontWeight: 800, color: "#c3cfe6", padding: "0 3px", lineHeight: "12px", whiteSpace: "nowrap" }}>{v.l}</span>}
                        </div>
                        {!v.v && s != null && finReal != null && (
                          <div style={{ position: "absolute", left: x(s), width: Math.max(3, x(finReal) - x(s)), top: 19, height: 10, borderRadius: 3, background: colorReal, opacity: l != null ? 0.95 : 0.75, boxShadow: l == null ? `0 0 6px ${colorReal}` : "none" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {!vis.length && <div style={{ padding: 20, fontSize: 12, color: C.dim }}>Nada que enseñar con ese filtro.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
