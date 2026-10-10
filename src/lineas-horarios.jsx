// Horarios de salida de las líneas (por tipo de día o calendario del GTFS) y
// el selector de calendario. Los usan el Scheduling (para ver) y el Planning
// (para cambiar las horas: añadir, mover o quitar expediciones). Las horas
// cambiadas se guardan en la configuración de la línea (lineasCfg.salidas) y
// mandan sobre las del GTFS en el Scheduling.
import { useState, useEffect, useMemo, useRef } from "react";
import { TIPOS_DIA, FRANJAS, franjaDe } from "./gtfs-red.js";
import { salidasDe, duracionViaje, esCalendario, nombreDia, claveSalidas } from "./lineas-sched.js";
import { COLORES_CAL, MESES_L, fechaLarga, hhmmTxt, leerHora, agruparVariantes, textoVariante } from "./lineas-horarios-util.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  blue: "#5c9bff", blueDim: "#0d2550", blueText: "#b0ccff", green: "#34d399", orange: "#fb923c", red: "#f87171", amber: "#fbbf24",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
};
const font = "'Inter',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";
const norm = x => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const num = n => Math.round(n).toLocaleString("es-ES");

export function SelectorCalendario({ red, valor, onCambiar, ancho = 300 }) {
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

/**
 * Horarios de salida. editable: se pueden mover, quitar y añadir salidas;
 * onGuardar(lineaId, nombreLinea, claveSalidas, lista | null) — null = volver a las del GTFS.
 * onGuardarTiempo(lineaId, nombreLinea, "dir|franja", minutos | null) — tiempo de recorrido de esa franja (null = el calculado).
 */
export function Horarios({ red, cfg, diaInicial, editable = false, onGuardar, onGuardarTiempo }) {
  const [dia, setDia] = useState(diaInicial || "laborable");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(red.lineas[0]?.id || null);
  const [editando, setEditando] = useState(null); // { clave, m, texto }
  const [nueva, setNueva] = useState({}); // clave → texto de la salida a añadir
  const [tiempoEd, setTiempoEd] = useState(null); // { clave: "dir|franja", texto }
  const [error, setError] = useState(null);
  const lista = red.lineas.filter(l => !q.trim() || norm(`${l.nombre} ${l.sentidos.map(x => x.cabecera).join(" ")}`).includes(norm(q.trim())));
  const linea = lista.find(l => l.id === sel) || lista[0]; // al buscar, la primera que coincide
  const grupos = agruparVariantes(lista);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const editadaEn = l => Object.keys(cfg[l.id]?.salidas || {}).length > 0;
  const guardar = (s, nuevaLista) => { setError(null); onGuardar?.(linea.id, linea.nombre, claveSalidas(s.dir, dia), nuevaLista); };
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.card }}>
        <div style={{ padding: 10 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea…" style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
          {grupos.slice(0, 400).map(g => {
            const fila = (l, variante) => (
              <button key={l.id} onClick={() => { setSel(l.id); setEditando(null); }} style={{ display: "flex", alignItems: "center", gap: 8, width: variante ? "calc(100% - 20px)" : "100%", marginLeft: variante ? 20 : 0, textAlign: "left", padding: "6px 6px", borderRadius: 6, marginBottom: 1, background: l.id === linea?.id ? C.blueDim : "none", border: "none", cursor: "pointer", fontFamily: font }}>
                {!variante && <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 5, background: l.color, color: "#0b1220", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{l.nombre}</span>}
                <span style={{ flex: 1, fontSize: 11, color: l.id === linea?.id ? C.blueText : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{variante ? textoVariante(l) : l.sentidos.map(x => x.cabecera).join(" ↔ ")}</span>
                {editadaEn(l) && <span title="Horarios cambiados a mano en Planning" style={{ fontSize: 10, color: C.amber }}>✎</span>}
              </button>
            );
            if (g.lineas.length === 1) return fila(g.lineas[0], false);
            const abierto = abiertos.has(g.clave) || !!q.trim() || g.lineas.some(l => l.id === linea?.id);
            const l0 = g.lineas[0];
            return (
              <div key={g.clave}>
                <button onClick={() => setAbiertos(prev => { const n = new Set(prev); if (n.has(g.clave)) n.delete(g.clave); else n.add(g.clave); return n; })}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 6px", borderRadius: 6, marginBottom: 1, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>
                  <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 5, background: l0.color, color: "#0b1220", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{l0.nombre}</span>
                  <span style={{ flex: 1, fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{abierto ? "▾" : "▸"} {g.lineas.length} variantes</span>
                  {g.lineas.some(editadaEn) && <span title="Horarios cambiados a mano en Planning" style={{ fontSize: 10, color: C.amber }}>✎</span>}
                </button>
                {abierto && g.lineas.map(l => fila(l, true))}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <SelectorCalendario red={red} valor={dia} onCambiar={d => { setDia(d); setEditando(null); }} ancho={420} />
          {!esCalendario(dia) && red.dias?.[dia] && <span style={{ fontSize: 11, color: C.dim }}>día de referencia {new Date(red.dias[dia] + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span>}
          {editable && <span style={{ fontSize: 11, color: C.muted }}>Pincha una hora para cambiarla o quitarla. Los cambios valen para este {esCalendario(dia) ? "calendario" : "tipo de día"} y los usa el Scheduling.</span>}
        </div>
        {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</div>}
        {linea && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${linea.sentidos.length}, minmax(320px, 1fr))`, gap: 16 }}>
            {linea.sentidos.map(s => {
              const clave = claveSalidas(s.dir, dia);
              const { lista: salidas, aproximado, editado } = salidasDe(s, dia, red, cfg[linea.id]);
              const gtfs = editado ? new Set(salidasDe(s, dia, red).lista) : null;
              const actuales = new Set(salidas);
              const quitadas = gtfs ? [...gtfs].filter(m => !actuales.has(m)).length : 0;
              const nuevas = gtfs ? salidas.filter(m => !gtfs.has(m)).length : 0;
              const porHora = new Map();
              for (const m of salidas) { const h = Math.floor(m / 60); if (!porHora.has(h)) porHora.set(h, []); porHora.get(h).push(m); }
              const cambiarHora = (de, texto) => {
                const a = leerHora(texto);
                if (a == null) { setError(`«${texto}» no es una hora válida (escribe por ejemplo 07:35, o 25:10 para después de medianoche).`); return; }
                if (a !== de && actuales.has(a)) { setError(`Ya hay una salida a las ${hhmmTxt(a)}.`); return; }
                guardar(s, salidas.map(x => (x === de ? a : x)));
              };
              const anadir = () => {
                const a = leerHora(nueva[clave]);
                if (a == null) { setError("Escribe la hora de la nueva salida (por ejemplo 07:35)."); return; }
                if (actuales.has(a)) { setError(`Ya hay una salida a las ${hhmmTxt(a)}.`); return; }
                guardar(s, [...salidas, a]);
                setNueva(n => ({ ...n, [clave]: "" }));
              };
              return (
                <div key={s.dir} style={{ background: C.card, border: `1px solid ${editado ? C.amber + "88" : C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ minWidth: 34, padding: "2px 6px", borderRadius: 5, background: linea.color, color: "#0b1220", fontSize: 12, fontWeight: 800, textAlign: "center" }}>{linea.nombre}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: s.dir === 0 ? C.green : C.amber }}>{s.dir === 0 ? "IDA" : "VUELTA"}</span>
                    <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {s.cabecera}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontFamily: mono }}>{salidas.length} salidas</span>
                  </div>
                  {editado && (
                    <div style={{ padding: "6px 14px", fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
                      ✎ Cambiado a mano en Planning{nuevas || quitadas ? ` (${[nuevas && `${nuevas} nueva${nuevas > 1 ? "s" : ""} o movida${nuevas > 1 ? "s" : ""}`, quitadas && `${quitadas} quitada${quitadas > 1 ? "s" : ""} o movida${quitadas > 1 ? "s" : ""}`].filter(Boolean).join(", ")} respecto al GTFS)` : ""}
                      {editable && <button onClick={() => window.confirm("¿Volver a las salidas del GTFS en este sentido y día?") && guardar(s, null)} style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.amber}88`, color: C.amber, borderRadius: 5, padding: "2px 8px", fontSize: 10.5, cursor: "pointer", fontFamily: font }}>Volver a las del GTFS</button>}
                    </div>
                  )}
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
                          <td style={{ padding: "4px 8px", fontFamily: mono, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                            {!editable ? mins.map(m => String(m % 60).padStart(2, "0")).join("  ") : mins.map(m => (editando?.clave === clave && editando.m === m ? (
                              <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6 }}>
                                <input autoFocus value={editando.texto} onChange={e => setEditando({ ...editando, texto: e.target.value })}
                                  onKeyDown={e => { if (e.key === "Enter") { cambiarHora(m, editando.texto); setEditando(null); } if (e.key === "Escape") setEditando(null); }}
                                  style={{ width: 54, background: C.bg, border: `1px solid ${C.blue}`, color: C.text, borderRadius: 4, padding: "1px 4px", fontSize: 12, fontFamily: mono, outline: "none" }} />
                                <button title="Guardar" onClick={() => { cambiarHora(m, editando.texto); setEditando(null); }} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 11, cursor: "pointer" }}>✓</button>
                                <button title="Quitar esta salida" onClick={() => { guardar(s, salidas.filter(x => x !== m)); setEditando(null); }} style={{ background: "none", border: `1px solid ${C.red}88`, color: C.red, borderRadius: 4, padding: "1px 6px", fontSize: 11, cursor: "pointer" }}>Quitar</button>
                              </span>
                            ) : (
                              <button key={m} onClick={() => setEditando({ clave, m, texto: hhmmTxt(m) })} title={`${hhmmTxt(m)} · pincha para cambiarla o quitarla`}
                                style={{ background: gtfs && !gtfs.has(m) ? "rgba(52,211,153,0.15)" : "none", border: `1px solid ${gtfs && !gtfs.has(m) ? C.green + "88" : "transparent"}`, color: gtfs && !gtfs.has(m) ? C.green : C.muted, borderRadius: 4, padding: "0 4px", marginRight: 4, fontSize: 12, fontFamily: mono, cursor: "pointer" }}>
                                {String(m % 60).padStart(2, "0")}
                              </button>
                            )))}
                          </td>
                          <td style={{ padding: "4px 14px", fontFamily: mono, fontSize: 11, color: C.dim, textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                            {(() => {
                              const franja = franjaDe(h * 60), kt = `${s.dir}|${franja}`;
                              const corregido = cfg[linea.id]?.tiempos?.[kt] != null;
                              const min = duracionViaje(s, h * 60, cfg[linea.id]);
                              if (!editable) return <span style={{ color: corregido ? C.amber : C.dim }}>{min} min</span>;
                              if (tiempoEd?.clave === kt && tiempoEd.h === h) {
                                const guardarT = () => { const t = tiempoEd.texto.trim(); const n = t === "" ? null : parseInt(t, 10); if (t !== "" && !(n > 0)) { setError("Escribe los minutos de recorrido (por ejemplo 32)."); return; } onGuardarTiempo?.(linea.id, linea.nombre, kt, n); setTiempoEd(null); };
                                return (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <input autoFocus value={tiempoEd.texto} onChange={e => setTiempoEd({ ...tiempoEd, texto: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                      onKeyDown={e => { if (e.key === "Enter") guardarT(); if (e.key === "Escape") setTiempoEd(null); }}
                                      style={{ width: 40, background: C.bg, border: `1px solid ${C.blue}`, color: C.text, borderRadius: 4, padding: "1px 4px", fontSize: 11.5, fontFamily: mono, textAlign: "right", outline: "none" }} />
                                    <span>min</span>
                                    <button title={`Guardar: vale para toda la franja ${franja.replace("-", "–")} h de este sentido, todos los días (vacío = el calculado del GTFS)`} onClick={guardarT} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 11, cursor: "pointer" }}>✓</button>
                                  </span>
                                );
                              }
                              return (
                                <button onClick={() => setTiempoEd({ clave: kt, h, texto: String(min) })} title={`Pincha para cambiar el tiempo de recorrido de la franja ${franja.replace("-", "–")} h (${corregido ? "corregido a mano" : "calculado del GTFS"})`}
                                  style={{ background: "none", border: `1px solid ${corregido ? C.amber + "88" : "transparent"}`, color: corregido ? C.amber : C.muted, borderRadius: 4, padding: "0 4px", fontSize: 11, fontFamily: mono, cursor: "pointer" }}>{min} min</button>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                      {!salidas.length && <tr><td colSpan={3} style={{ padding: 14, fontSize: 12, color: C.dim }}>Sin servicio este {esCalendario(dia) ? "calendario" : "tipo de día"}</td></tr>}
                    </tbody>
                  </table>
                  {editable && (
                    <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                      <input value={nueva[clave] || ""} onChange={e => setNueva(n => ({ ...n, [clave]: e.target.value }))} onKeyDown={e => e.key === "Enter" && anadir()} placeholder="hh:mm"
                        style={{ width: 64, background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 5, padding: "3px 6px", fontSize: 12, fontFamily: mono, outline: "none" }} />
                      <button onClick={anadir} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 5, padding: "3px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: font }}>+ Añadir salida</button>
                    </div>
                  )}
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
