// Planning → Trabajos: el catálogo de trabajos del proyecto (con la plantilla
// de su sector) y las reglas en bloque que dicen qué puntos llevan cada uno.
// Se guarda en el proyecto (trabajos, reglasTrabajos) un momento después de
// cada cambio. La lógica está en trabajos.js.
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sectorDe } from "../sector.js";
import { FRECUENCIAS, columnasDe, cumple, idNuevo, plantillaDe, resumenTrabajos } from "../trabajos.js";
import { useUltimo } from "../use-ultimo.js";
import { C, font, mono } from "./estilo.js";

const COLORES = [C.blue, C.green, C.violet, C.orange, "#f472b6", "#22d3ee", C.amber, C.red];
// con punto de miles también en las cifras de 4 (el navegador no lo pone en español: «1560»)
const NUM = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 }); } catch { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }); } })();
const fmt = n => (n == null ? "—" : NUM.format(Math.round(n)));

export function TabTrabajos({ layers, activeProject, onProjectUpdate, vehicles = [] }) {
  const sector = sectorDe(activeProject);
  const [trabajos, setTrabajos] = useState(() => activeProject?.trabajos || []);
  const [reglas, setReglas] = useState(() => activeProject?.reglasTrabajos || []);
  const [estado, setEstado] = useState(null); // null | "guardando" | "guardado" | error
  const cambiado = useRef(false);
  const guardarRef = useUltimo(onProjectUpdate); // cambia en cada guardado: no debe volver a disparar el guardado

  // guardar un momento después del último cambio (solo si lo ha cambiado alguien aquí)
  useEffect(() => {
    if (!cambiado.current || !guardarRef.current) return;
    const t = setTimeout(() => {
      cambiado.current = false;
      Promise.resolve(guardarRef.current({ trabajos, reglasTrabajos: reglas }))
        .then(() => setEstado("guardado"))
        .catch(e => setEstado(`No se pudo guardar: ${e.message || e}`));
    }, 700);
    return () => clearTimeout(t);
  }, [trabajos, reglas, guardarRef]);
  const tocar = () => { cambiado.current = true; setEstado("guardando"); };
  const cambiarTrabajo = (id, cambio) => { tocar(); setTrabajos(l => l.map(t => (t.id === id ? { ...t, ...cambio } : t))); };
  const cambiarRegla = (i, cambio) => { tocar(); setReglas(l => l.map((r, j) => (j === i ? { ...r, ...cambio } : r))); };

  const puntos = useMemo(() => layers.filter(l => l.visible !== false && !l.lineasCloud).flatMap(l => l.markers || []), [layers]);
  const columnas = useMemo(() => columnasDe(puntos), [puntos]);
  const resumen = useMemo(() => resumenTrabajos(puntos, trabajos, reglas), [puntos, trabajos, reglas]);
  const tiposVehiculo = useMemo(() => [...new Set([...vehicles.map(v => v.tipo).filter(Boolean), ...trabajos.map(t => t.vehiculo).filter(Boolean)])], [vehicles, trabajos]);

  function usarPlantilla() { tocar(); setTrabajos(plantillaDe(sector.id)); }
  function anadirTrabajo() {
    tocar();
    setTrabajos(l => [...l, { id: idNuevo("Trabajo nuevo", l), nombre: "Trabajo nuevo", frecuencia: "mensual", duracion: 10, vehiculo: "", personas: 1, color: COLORES[l.length % COLORES.length], todos: true }]);
  }
  function quitarTrabajo(t) {
    if (!window.confirm(`¿Quitar el trabajo «${t.nombre}» y sus reglas?`)) return;
    tocar(); setTrabajos(l => l.filter(x => x.id !== t.id)); setReglas(l => l.filter(r => r.trabajoId !== t.id));
  }
  function anadirRegla() {
    tocar();
    const c = columnas[0];
    setReglas(l => [...l, { trabajoId: trabajos[0]?.id || "", accion: "quitar", campo: c?.campo || "*", valor: c?.valores[0]?.[0] || "" }]);
  }

  const inp = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 8px", fontSize: 12.5, fontFamily: font, outline: "none", boxSizing: "border-box" };
  const th = { textAlign: "left", padding: "8px 8px", fontSize: 10.5, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.text, verticalAlign: "middle" };
  const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 12.5, fontFamily: font, cursor: "pointer" };

  if (!activeProject) return <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Abre un proyecto para ver sus trabajos.</div>;
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 22px 40px", fontFamily: font }}>
      <datalist id="frecuencias-trabajo">{FRECUENCIAS.map(f => <option key={f} value={f} />)}</datalist>
      <datalist id="tipos-vehiculo">{tiposVehiculo.map(v => <option key={v} value={v} />)}</datalist>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Trabajos</div>
        {estado && <span style={{ fontSize: 11.5, color: estado === "guardado" ? C.green : estado === "guardando" ? C.dim : C.red }}>{estado === "guardado" ? "Guardado" : estado === "guardando" ? "Guardando…" : estado}</span>}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55, maxWidth: 920 }}>
        Lo que se hace en los puntos de este proyecto. Cada trabajo tiene su frecuencia, su duración por punto y el tipo de vehículo que lo hace. Por defecto se hace en todos los puntos; con las reglas de abajo se quita o se cambia en grupos de puntos (por fracción, tipo, barrio…).
      </div>

      {!trabajos.length ? (
        <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, maxWidth: 640 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Este proyecto aún no tiene trabajos</div>
          <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 12px", lineHeight: 1.5 }}>
            Empieza con los habituales de <b style={{ color: C.text }}>{sector.nombre}</b> ({plantillaDe(sector.id).map(t => t.nombre.toLowerCase()).join(", ")}) y cámbialos a tu medida.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={usarPlantilla} style={{ ...btn, background: C.blue, border: "none", color: "#fff", fontWeight: 600 }}>Empezar con la plantilla</button>
            <button onClick={anadirTrabajo} style={btn}><Plus size={14} /> Añadir uno vacío</button>
          </div>
        </div>
      ) : (<>
        <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", background: C.card }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Trabajo", "Frecuencia", "Min / punto", "Vehículo", "Personas", "Dónde", "Puntos", "Visitas / año", "Horas / año", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {trabajos.map(t => {
                const r = resumen[t.id] || {};
                return (
                  <tr key={t.id}>
                    <td style={td}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: t.color || C.blue, marginRight: 7 }} /><input value={t.nombre} onChange={e => cambiarTrabajo(t.id, { nombre: e.target.value })} style={{ ...inp, width: 190 }} /></td>
                    <td style={td}><input list="frecuencias-trabajo" value={t.frecuencia || ""} onChange={e => cambiarTrabajo(t.id, { frecuencia: e.target.value })} placeholder="mensual" style={{ ...inp, width: 120 }} /></td>
                    <td style={td}><input type="number" min={1} value={t.duracion ?? ""} onChange={e => cambiarTrabajo(t.id, { duracion: Number(e.target.value) || "" })} style={{ ...inp, width: 64, textAlign: "right" }} /></td>
                    <td style={td}><input list="tipos-vehiculo" value={t.vehiculo || ""} onChange={e => cambiarTrabajo(t.id, { vehiculo: e.target.value })} placeholder="Tipo de vehículo" style={{ ...inp, width: 180 }} /></td>
                    <td style={td}><input type="number" min={1} value={t.personas ?? ""} onChange={e => cambiarTrabajo(t.id, { personas: Number(e.target.value) || "" })} style={{ ...inp, width: 52, textAlign: "right" }} /></td>
                    <td style={td}>
                      <select value={t.todos === false ? "reglas" : "todos"} onChange={e => cambiarTrabajo(t.id, { todos: e.target.value === "todos" })} style={{ ...inp, cursor: "pointer" }}>
                        <option value="todos">Todos los puntos</option>
                        <option value="reglas">Solo donde lo pongan las reglas</option>
                      </select>
                    </td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{fmt(r.puntos)}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right" }} title={r.visitas == null ? "Hay frecuencias que no se entienden" : ""}>{fmt(r.visitas)}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{fmt(r.horas)}</td>
                    <td style={td}><button onClick={() => quitarTrabajo(t)} title="Quitar trabajo" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer" }}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={anadirTrabajo} style={btn}><Plus size={14} /> Añadir trabajo</button>
          {!puntos.length && <span style={{ fontSize: 11.5, color: C.dim }}>Sube los puntos en Mapa para ver cuántos lleva cada trabajo.</span>}
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, margin: "26px 0 4px" }}>Reglas en bloque</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5, maxWidth: 920 }}>
          Se aplican en orden. «Quitar» deja sin ese trabajo a los puntos que cumplen la condición; «Poner» se lo pone (o le cambia la frecuencia o la duración). Para un punto suelto, usa su fila del Timetable.
        </div>
        {reglas.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", background: C.card, marginBottom: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Trabajo", "Acción", "Donde", "Es", "Frecuencia", "Min / punto", "Puntos", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {reglas.map((r, i) => {
                  const col = columnas.find(c => c.campo === r.campo);
                  const n = puntos.filter(p => cumple(p, r)).length;
                  return (
                    <tr key={i}>
                      <td style={td}><select value={r.trabajoId} onChange={e => cambiarRegla(i, { trabajoId: e.target.value })} style={{ ...inp, cursor: "pointer" }}>{trabajos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></td>
                      <td style={td}><select value={r.accion} onChange={e => cambiarRegla(i, { accion: e.target.value })} style={{ ...inp, cursor: "pointer" }}><option value="quitar">Quitar</option><option value="poner">Poner / cambiar</option></select></td>
                      <td style={td}>
                        <select value={r.campo || "*"} onChange={e => { const c = columnas.find(x => x.campo === e.target.value); cambiarRegla(i, { campo: e.target.value, valor: c?.valores[0]?.[0] || "" }); }} style={{ ...inp, cursor: "pointer" }}>
                          <option value="*">Todos los puntos</option>
                          {columnas.map(c => <option key={c.campo} value={c.campo}>{c.campo}</option>)}
                          {r.campo && r.campo !== "*" && !col && <option value={r.campo}>{r.campo}</option>}
                        </select>
                      </td>
                      <td style={td}>
                        {r.campo && r.campo !== "*" ? (
                          <select value={r.valor || ""} onChange={e => cambiarRegla(i, { valor: e.target.value })} style={{ ...inp, cursor: "pointer", maxWidth: 220 }}>
                            {(col?.valores || [[r.valor, 0]]).map(([v, k]) => <option key={v} value={v}>{v}{k ? ` (${k})` : ""}</option>)}
                          </select>
                        ) : <span style={{ color: C.dim }}>—</span>}
                      </td>
                      <td style={td}>{r.accion === "poner" ? <input list="frecuencias-trabajo" value={r.frecuencia || ""} onChange={e => cambiarRegla(i, { frecuencia: e.target.value })} placeholder="la del trabajo" style={{ ...inp, width: 120 }} /> : <span style={{ color: C.dim }}>—</span>}</td>
                      <td style={td}>{r.accion === "poner" ? <input type="number" min={1} value={r.duracion ?? ""} onChange={e => cambiarRegla(i, { duracion: Number(e.target.value) || "" })} placeholder="—" style={{ ...inp, width: 64, textAlign: "right" }} /> : <span style={{ color: C.dim }}>—</span>}</td>
                      <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{fmt(n)}</td>
                      <td style={td}><button onClick={() => { tocar(); setReglas(l => l.filter((_, j) => j !== i)); }} title="Quitar regla" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer" }}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button onClick={anadirRegla} style={btn}><Plus size={14} /> Añadir regla</button>
      </>)}
    </div>
  );
}
