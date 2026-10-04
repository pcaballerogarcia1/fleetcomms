// ── Scheduling de proyectos "Líneas regulares" ────────────────────────
// Con la red del Planning de líneas: encadena los viajes del tipo de día en
// autobuses y los reparte en turnos de conductor (lineas-sched.js). Muestra
// los indicadores, la curva de autobuses en servicio, el Gantt de autobuses
// con los relevos y la tabla de turnos; exporta todo a Excel.
import { useState, useEffect, useMemo, useRef } from "react";
import { TIPOS_DIA } from "./gtfs-red.js";
import { TIPOS_VEHICULO, watchRed, watchCfg, watchSchedParams, guardarSchedParams } from "./lineas-store.js";
import { generarServicio, PARAMS_DEFECTO } from "./lineas-sched.js";
import { minToHHMM } from "./gtfs-parse.js";
import { logAudit } from "./audit.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", green: "#34d399", amber: "#fbbf24", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hm = m => (m == null ? "—" : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`);
const num = n => Math.round(n).toLocaleString("es-ES");
const nombreTipo = id => TIPOS_VEHICULO.find(t => t.id === id)?.nombre || "Sin tipo";
const PAGINA = 150;
const PX_MIN = 1.1; // px por minuto en el Gantt

const AJUSTES = [
  { k: "regulacion", t: "Regulación por defecto", s: "min", d: "Si la línea no tiene la suya (Planning → línea → Tiempos)" },
  { k: "margenVacio", t: "Margen para un vacío por cochera", s: "min", d: "Entre dos bloques del mismo autobús" },
  { k: "piezaMax", t: "Pieza máxima", s: "min", d: "De relevo a relevo; además nunca más de 4h30 conduciendo" },
  { k: "jornadaMax", t: "Jornada de trabajo máxima", s: "min", d: "Suma de las piezas del turno" },
  { k: "amplitudMax", t: "Amplitud máxima del turno", s: "min", d: "De la primera salida a la última llegada, pausa incluida" },
];

function Kpi({ v, l, sub, color, title }) {
  return (
    <div title={title} style={{ padding: "10px 16px", borderRight: `1px solid ${C.border}`, minWidth: 130, flexShrink: 0, cursor: title ? "help" : undefined }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.blue, fontFamily: mono, lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: 9.5, color: C.text, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginTop: 3 }}>{l}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 1, whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function Perfil({ perfil }) {
  if (!perfil.length) return null;
  const W = 900, H = 70, max = Math.max(...perfil.map(p => p.vehiculos), 1);
  const x = i => (i / Math.max(1, perfil.length - 1)) * W, y = v => H - (v / max) * (H - 6);
  const d = perfil.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.vehiculos).toFixed(1)}`).join("") + `L${W},${H}L0,${H}Z`;
  const pico = perfil.reduce((a, p) => (p.vehiculos > a.vehiculos ? p : a), perfil[0]);
  const marcas = perfil.filter(p => p.min % 120 === 0);
  return (
    <div style={{ padding: "8px 16px 4px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
      <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>
        AUTOBUSES EN SERVICIO A LO LARGO DEL DÍA · pico <b style={{ color: C.text }}>{pico.vehiculos}</b> a las {minToHHMM(pico.min)}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" style={{ width: "100%", height: 84, display: "block" }}>
        <path d={d} fill="rgba(92,155,255,0.25)" stroke={C.blue} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {marcas.map(m => {
          const i = perfil.indexOf(m);
          return <text key={m.min} x={x(i)} y={H + 12} fill={C.dim} fontSize="10" textAnchor="middle">{minToHHMM(m.min).slice(0, 5)}</text>;
        })}
      </svg>
    </div>
  );
}

function Gantt({ res, paradasPorId, filtro }) {
  const [n, setN] = useState(PAGINA);
  const filas = useMemo(() => {
    const t = norm(filtro).trim();
    const lista = [...res.vehiculos].sort((a, b) => a.autobus - b.autobus || a.inicio - b.inicio);
    return t ? lista.filter(v => v.lineas.some(l => norm(l) === t || norm(l).startsWith(t))) : lista;
  }, [res, filtro]);
  const ini = Math.floor(Math.min(...res.vehiculos.map(v => v.inicio)) / 60) * 60;
  const fin = Math.ceil(Math.max(...res.vehiculos.map(v => v.fin)) / 60) * 60;
  const ancho = (fin - ini) * PX_MIN;
  const X = m => (m - ini) * PX_MIN;
  const nombre = id => paradasPorId.get(id)?.nombre || id;
  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 200, flexShrink: 0, position: "sticky", left: 0, background: C.card, zIndex: 4, padding: "6px 10px", fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>AUTOBÚS · BLOQUE</div>
        <div style={{ position: "relative", width: ancho, height: 24, flexShrink: 0 }}>
          {Array.from({ length: (fin - ini) / 60 + 1 }, (_, k) => (
            <span key={k} style={{ position: "absolute", left: k * 60 * PX_MIN, top: 6, fontSize: 10, color: C.dim, fontFamily: mono, transform: "translateX(-50%)" }}>{minToHHMM(ini + k * 60).slice(0, 5)}</span>
          ))}
        </div>
      </div>
      {filas.slice(0, n).map(v => (
        <div key={v.id} style={{ display: "flex", borderBottom: `1px solid ${C.border}`, height: 30 }}>
          <div style={{ width: 200, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: C.bg, padding: "4px 10px", borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11.5, color: C.text, fontWeight: 600 }}>Bus {v.autobus} <span style={{ color: C.dim, fontWeight: 400 }}>· bloque {v.id}</span></div>
            <div style={{ fontSize: 9.5, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {v.tipo ? nombreTipo(v.tipo) + " · " : ""}{v.viajes.length} viajes · L {v.lineas.join(", ")}
            </div>
          </div>
          <div style={{ position: "relative", width: ancho, flexShrink: 0 }}>
            {[...Array((fin - ini) / 60 + 1)].map((_, k) => <div key={k} style={{ position: "absolute", left: k * 60 * PX_MIN, top: 0, bottom: 0, width: 1, background: "rgba(88,130,225,0.08)" }} />)}
            {v.viajes.map((x, i) => {
              const w = Math.max(2, (x.arr - x.dep) * PX_MIN);
              return (
                <div key={i} title={`Línea ${x.nombre} · ${x.sentido}\n${minToHHMM(x.dep)} ${nombre(x.o)}\n${minToHHMM(x.arr)} ${nombre(x.d)}`} style={{
                  position: "absolute", left: X(x.dep), width: w, top: 6, height: 18, borderRadius: 3,
                  background: x.color, opacity: x.dir === 1 ? 0.75 : 1, color: "#0b1220", fontSize: 9.5, fontWeight: 800,
                  overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3, lineHeight: "18px",
                }}>{w > 22 ? x.nombre : ""}</div>
              );
            })}
            {v.relevos.map((r, i) => (
              <div key={`r${i}`} title={`Turno ${r.turno}: ${minToHHMM(r.inicio)}–${minToHHMM(r.fin)}`} style={{ position: "absolute", left: X(r.inicio) - 1, top: 1, bottom: 1, width: 2, background: "#fff" }}>
                <span style={{ position: "absolute", left: 2, top: -1, fontSize: 8.5, color: C.text, fontFamily: mono, whiteSpace: "nowrap", background: "rgba(11,18,32,0.85)", borderRadius: 2, padding: "0 2px", lineHeight: "11px" }}>T{r.turno}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {filas.length > n && (
        <div style={{ padding: 12, position: "sticky", left: 0 }}>
          <button onClick={() => setN(x => x + PAGINA)} style={{ padding: "5px 12px", borderRadius: 6, background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12, cursor: "pointer", fontFamily: font }}>
            Mostrar {Math.min(PAGINA, filas.length - n)} más ({num(filas.length - n)} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

function TablaTurnos({ res, filtro }) {
  const [n, setN] = useState(200);
  const filas = useMemo(() => {
    const t = norm(filtro).trim();
    return t ? res.turnos.filter(tu => tu.piezas.some(pz => pz.viajes.some(v => norm(v.nombre) === t || norm(v.nombre).startsWith(t)))) : res.turnos;
  }, [res, filtro]);
  const busDe = id => res.vehiculos.find(v => v.id === id)?.autobus;
  const th = { textAlign: "left", fontSize: 10, color: C.dim, fontWeight: 700, padding: "8px 10px", position: "sticky", top: 0, background: C.card, letterSpacing: 0.6 };
  const td = { fontSize: 12, color: C.text, padding: "7px 10px", borderBottom: `1px solid ${C.border}`, fontFamily: mono, whiteSpace: "nowrap" };
  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["TURNO", "INICIO", "FIN", "AMPLITUD", "TRABAJO", "CONDUCCIÓN", "PIEZAS (AUTOBÚS · HORARIO)", "AVISOS"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {filas.slice(0, n).map(t => (
            <tr key={t.id}>
              <td style={td}>T{t.id}</td>
              <td style={td}>{minToHHMM(t.inicio)}</td>
              <td style={td}>{minToHHMM(t.fin)}</td>
              <td style={td}>{hm(t.duracion)}</td>
              <td style={td}>{hm(t.trabajo)}</td>
              <td style={td}>{hm(t.conduccion)}</td>
              <td style={{ ...td, fontFamily: font }}>
                {t.piezas.map((pz, i) => (
                  <span key={i} style={{ marginRight: 10 }}>
                    <b>Bus {busDe(pz.vehiculo)}</b> {minToHHMM(pz.inicio)}–{minToHHMM(pz.fin)}{i === 0 && t.piezas.length === 2 ? <span style={{ color: C.dim }}> · pausa {hm(t.piezas[1].inicio - pz.fin)}</span> : ""}
                  </span>
                ))}
              </td>
              <td style={{ ...td, fontFamily: font, color: t.avisos.length ? C.red : C.green, whiteSpace: "normal" }}>{t.avisos.length ? t.avisos.join(" · ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filas.length > n && (
        <div style={{ padding: 12 }}>
          <button onClick={() => setN(x => x + 200)} style={{ padding: "5px 12px", borderRadius: 6, background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12, cursor: "pointer", fontFamily: font }}>
            Mostrar 200 más ({num(filas.length - n)} restantes)
          </button>
        </div>
      )}
    </div>
  );
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

export function SchedulingLineasPage({ projectId }) {
  const [estado, setEstado] = useState({ red: null, cargando: true });
  const [cfg, setCfg] = useState({});
  const [guardados, setGuardados] = useState(undefined);
  const [cambios, setCambios] = useState({}); // parámetros tocados en esta sesión (aún sin generar)
  const [res, setRes] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [vista, setVista] = useState("gantt");
  const [filtro, setFiltro] = useState("");
  const [panel, setPanel] = useState(null); // "lineas" | "ajustes"
  const autoRef = useRef(false);

  useEffect(() => watchRed(projectId, setEstado), [projectId]);
  useEffect(() => watchCfg(projectId, setCfg), [projectId]);
  useEffect(() => watchSchedParams(projectId, setGuardados), [projectId]);

  const red = estado.red;
  const params = { ...PARAMS_DEFECTO, lineas: null, ...(guardados || {}), ...cambios };
  const paradasPorId = useMemo(() => new Map((red?.paradas || []).map(p => [p.id, p])), [red]);
  const viajesDia = useMemo(() => Object.fromEntries(TIPOS_DIA.map(t => [t.id, (red?.lineas || []).reduce((s, l) => s + l.sentidos.reduce((a, x) => a + (x.viajes?.[t.id] || 0), 0), 0)])), [red]);

  function generar(p = params) {
    if (!red) return;
    setCalculando(true);
    setTimeout(() => {
      try {
        const r = generarServicio(red, cfg, p);
        setRes(r);
        setCambios({});
        const { lineas, ...resto } = p;
        guardarSchedParams(projectId, { ...resto, lineas: lineas || null }).catch(() => {});
        logAudit({ modulo: "Scheduling", accion: "Generó el servicio de líneas", detalle: `${TIPOS_DIA.find(t => t.id === p.dia)?.nombre} · ${r.kpis.viajes} viajes · ${r.kpis.autobuses} autobuses · ${r.kpis.turnos} turnos` });
      } finally {
        setCalculando(false);
      }
    }, 30);
  }
  // Primera vez con la red y los parámetros cargados: se genera solo
  useEffect(() => {
    if (red && guardados !== undefined && !autoRef.current) { autoRef.current = true; generar(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [red, guardados]);

  async function exportar() {
    if (!res) return;
    const XLSX = await import("xlsx");
    const nom = id => paradasPorId.get(id)?.nombre || id;
    const filasV = res.vehiculos.flatMap(v => v.viajes.map(x => ({
      "Autobús": v.autobus, "Bloque": v.id, "Tipo": v.tipo ? nombreTipo(v.tipo) : "", "Línea": x.nombre, "Sentido": x.sentido,
      "Salida": minToHHMM(x.dep), "Llegada": minToHHMM(x.arr), "Desde": nom(x.o), "Hasta": nom(x.d), "Km": x.km,
    })));
    const filasT = res.turnos.map(t => ({
      "Turno": t.id, "Inicio": minToHHMM(t.inicio), "Fin": minToHHMM(t.fin), "Amplitud": hm(t.duracion), "Trabajo": hm(t.trabajo), "Conducción": hm(t.conduccion),
      "Pieza 1": `Bus ${res.vehiculos.find(v => v.id === t.piezas[0].vehiculo)?.autobus} ${minToHHMM(t.piezas[0].inicio)}–${minToHHMM(t.piezas[0].fin)}`,
      "Pieza 2": t.piezas[1] ? `Bus ${res.vehiculos.find(v => v.id === t.piezas[1].vehiculo)?.autobus} ${minToHHMM(t.piezas[1].inicio)}–${minToHHMM(t.piezas[1].fin)}` : "",
      "Avisos": t.avisos.join(" · "),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasV), "Autobuses");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasT), "Turnos");
    XLSX.writeFile(wb, `servicio_${res.params.dia}.xlsx`);
  }

  if (estado.cargando) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.muted, fontFamily: font, fontSize: 13 }}>Cargando la red…</div>;
  if (!red) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
      <div style={{ maxWidth: 460, textAlign: "center", color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Primero, la red de líneas</div>
        Importa el GTFS en Planning («Importar red») y vuelve aquí para encadenar los viajes en autobuses y turnos de conductor.
      </div>
    </div>
  );

  const k = res?.kpis;
  const pendientes = Object.keys(cambios).length > 0;
  const btn = (activo) => ({ padding: "6px 11px", borderRadius: 7, background: activo ? `${C.blue}22` : C.surface2, border: `1px solid ${activo ? C.blue : C.border}`, color: activo ? C.blue : C.text, fontSize: 12, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" });
  const nLineas = params.lineas ? params.lineas.length : red.lineas.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, minHeight: 0 }}>
      {/* Barra de herramientas */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.card, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, fontWeight: 700, marginRight: 6 }}>SCHEDULING DE LÍNEAS</span>
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
          {TIPOS_DIA.map(t => (
            <button key={t.id} onClick={() => setCambios(c => ({ ...c, dia: t.id }))} title={`${num(viajesDia[t.id])} viajes`} style={{
              padding: "5px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontFamily: font, fontSize: 11.5,
              background: params.dia === t.id ? C.blue : "none", color: params.dia === t.id ? "#fff" : C.muted, fontWeight: params.dia === t.id ? 600 : 400,
            }}>{t.nombre}</button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setPanel(p => (p === "lineas" ? null : "lineas"))} style={btn(panel === "lineas")}>Líneas: {nLineas === red.lineas.length ? "todas" : nLineas} ({red.lineas.length})</button>
          {panel === "lineas" && <SelectorLineas lineas={red.lineas} elegidas={params.lineas} onCambiar={ids => setCambios(c => ({ ...c, lineas: ids }))} onCerrar={() => setPanel(null)} />}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setPanel(p => (p === "ajustes" ? null : "ajustes"))} style={btn(panel === "ajustes")}>Ajustes</button>
          {panel === "ajustes" && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 380, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", padding: 12 }}>
              {AJUSTES.map(a => (
                <div key={a.k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.text }}>{a.t}</div>
                    <div style={{ fontSize: 10.5, color: C.dim }}>{a.d}</div>
                  </div>
                  <input type="number" min="0" value={params[a.k]} onChange={e => setCambios(c => ({ ...c, [a.k]: Math.max(0, Number(e.target.value) || 0) }))}
                    style={{ width: 64, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: mono, textAlign: "right", outline: "none" }} />
                  <span style={{ fontSize: 10.5, color: C.dim, width: 24 }}>{a.s}</span>
                </div>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.text, cursor: "pointer" }}>
                <input type="checkbox" checked={!!params.entreLineas} onChange={e => setCambios(c => ({ ...c, entreLineas: e.target.checked }))} />
                Un autobús puede seguir con otra línea en la misma cabecera
              </label>
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>Los tiempos de recorrido, la regulación de cada línea y los tipos de vehículo se configuran en Planning, en la ficha de cada línea.</div>
            </div>
          )}
        </div>
        <button onClick={() => { setPanel(null); generar(); }} disabled={calculando} style={{
          padding: "7px 16px", borderRadius: 7, border: "none", background: pendientes ? C.amber : C.blue, color: pendientes ? "#0b1220" : "#fff",
          fontSize: 12.5, fontWeight: 700, cursor: calculando ? "wait" : "pointer", fontFamily: font,
        }}>{calculando ? "Calculando…" : pendientes ? "Generar con los cambios" : "Generar servicio"}</button>
        <div style={{ flex: 1 }} />
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar por línea…" style={{ width: 150, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
          {[["gantt", "Autobuses"], ["turnos", "Turnos"]].map(([kk, t]) => (
            <button key={kk} onClick={() => setVista(kk)} style={{ padding: "5px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontFamily: font, fontSize: 11.5, background: vista === kk ? C.blue : "none", color: vista === kk ? "#fff" : C.muted }}>{t}</button>
          ))}
        </div>
        <button onClick={exportar} disabled={!res} style={btn(false)}>Excel</button>
      </div>

      {res?.aproximado && (
        <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.amber, background: "rgba(251,191,36,0.08)", borderBottom: `1px solid rgba(251,191,36,0.3)` }}>
          Esta red se importó sin las horas de salida de cada viaje: se han repartido entre la primera y la última de cada sentido. Vuelve a importar el GTFS en Planning («Sustituir red») para usar los horarios exactos.
        </div>
      )}

      {k && (
        <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          <Kpi v={num(k.autobuses)} l="Autobuses" sub={`pico ${num(k.pico)} a la vez`} title="Autobuses físicos necesarios: cada uno puede hacer varios bloques si entre ellos hay margen para ir y volver de cochera. El pico es el máximo en servicio a la vez." />
          <Kpi v={num(k.bloques)} l="Bloques" sub="cadenas de viajes seguidas" title="Cada bloque es lo que un autobús hace sin pasar por cochera" />
          <Kpi v={num(k.viajes)} l="Viajes" sub={TIPOS_DIA.find(t => t.id === res.params.dia)?.nombre} />
          <Kpi v={num(k.km)} l="Km" sub={`${num(k.horasServicio)} h con viajeros`} />
          <Kpi v={k.eficiencia != null ? `${(k.eficiencia * 100).toFixed(1).replace(".", ",")} %` : "—"} l="Eficiencia vehículo" sub="con viajeros / en línea" title="Tiempo haciendo viajes / tiempo del autobús en línea (lo que falta es regulación y esperas en cabecera)" />
          <Kpi v={num(k.turnos)} l="Turnos" sub={`${num(k.turnosDosPiezas)} de dos piezas`} color={C.green} title="Turnos de conductor: una o dos piezas con relevo en cabecera" />
          <Kpi v={k.eficienciaPersonal != null ? `${(k.eficienciaPersonal * 100).toFixed(1).replace(".", ",")} %` : "—"} l="Eficiencia personal" sub={`${num(k.horasPagadas)} h de trabajo`} color={C.green} title="Conducción / tiempo de trabajo de los turnos" />
          <Kpi v={num(k.turnosConAviso)} l="Avisos" sub="UE 561/2006 · Estatuto" color={k.turnosConAviso ? C.red : C.green} />
          <div style={{ padding: "10px 16px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {Object.entries(k.porTipo).map(([t, nn]) => (
              <span key={t} style={{ fontSize: 11, color: C.muted, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>{t === "sin tipo" ? "Sin tipo" : nombreTipo(t)}: <b style={{ color: C.text }}>{nn}</b></span>
            ))}
          </div>
        </div>
      )}
      {res && <Perfil perfil={res.perfil} />}
      {res && (vista === "gantt" ? <Gantt key={res.params.dia + filtro} res={res} paradasPorId={paradasPorId} filtro={filtro} /> : <TablaTurnos key={res.params.dia + filtro} res={res} filtro={filtro} />)}
      {!res && <div style={{ padding: 20, color: C.muted, fontSize: 13 }}>{calculando ? "Calculando…" : "Pulsa «Generar servicio»."}</div>}
    </div>
  );
}
