// Cuadrante → «Versiones»: guardar el cuadrante del mes con un nombre,
// compararlo con el actual (qué turnos cambian) y volver a él.
import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { C, SHIFT_META, font } from "./datos.js";
import { borrarVersion, diferenciasCuadrante, escucharVersiones, guardarVersion, leerVersion, nombreVersionCuadrante, renombrarVersion } from "../roster-versiones.js";

const fecha = ms => new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Turno({ c }) {
  const m = SHIFT_META[c];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 3px", borderRadius: 4,
      fontSize: 11, fontWeight: 700, background: m?.bg || C.surface2, color: m?.text || C.dim, border: `1px solid ${(m?.text || C.border)}55`,
    }}>{c || "·"}</span>
  );
}

export function VentanaVersiones({ orgId, year, month, grid, asign, workers, autor, onRestaurar, onCerrar }) {
  const [lista, setLista] = useState(null);
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState(null);
  const [comparando, setComparando] = useState(null); // { v, dif } | { v, cargando }

  useEffect(() => escucharVersiones(orgId, year, month, setLista), [orgId, year, month]);

  const nombreTrab = wid => {
    const w = workers.find(x => (x._id || x.id) === wid);
    return w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") : "Trabajador sin ficha";
  };

  async function hacer(etiqueta, fn) {
    setOcupado(etiqueta); setError(null);
    try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setOcupado(null); }
  }
  const guardar = () => hacer("guardar", async () => {
    await guardarVersion(orgId, year, month, { nombre, grid, asign, autor });
    setNombre("");
  });
  const comparar = v => hacer("comparar", async () => {
    setComparando({ v, cargando: true });
    const datos = await leerVersion(v);
    setComparando({ v, dif: diferenciasCuadrante(grid, datos.grid) });
  });
  const restaurar = v => {
    if (!window.confirm(`¿Volver a «${nombreVersionCuadrante(v)}»?\n\nEl cuadrante actual no se pierde: se guarda antes como otra versión.`)) return;
    hacer("restaurar", async () => {
      const datos = await leerVersion(v);
      await guardarVersion(orgId, year, month, { nombre: `Antes de volver a «${nombreVersionCuadrante(v)}»`, grid, asign, autor });
      onRestaurar(datos);
      setComparando(null);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onCerrar}>
      <div role="dialog" aria-label="Versiones del cuadrante" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "22px 24px 20px", width: 680, maxWidth: "calc(100vw - 32px)", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Versiones del cuadrante</div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex" }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          Guarda el cuadrante de este mes con un nombre para probar cambios, compararlo con el actual o volver a él.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input className="op-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre (por ejemplo, «Con 2 de vacaciones»)"
            aria-label="Nombre de la versión" onKeyDown={e => e.key === "Enter" && !ocupado && guardar()} style={{ flex: 1, height: 32 }} />
          <button className="op-btn op-primario" onClick={guardar} disabled={!!ocupado} style={{ whiteSpace: "nowrap" }}>
            {ocupado === "guardar" ? <Loader2 size={14} className="op-girando" /> : null}Guardar versión
          </button>
        </div>
        {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        {lista == null ? <div style={{ color: C.dim, fontSize: 12, padding: "14px 0" }}>Cargando…</div>
          : !lista.length ? <div style={{ color: C.dim, fontSize: 12, padding: "14px 0" }}>Todavía no hay versiones de este mes.</div>
          : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8 }}>
              {lista.map(v => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreVersionCuadrante(v)}</span>
                      <button title="Cambiar el nombre" aria-label="Renombrar versión" onClick={() => { const n = window.prompt("Nombre de esta versión:", v.nombre || ""); if (n != null) hacer("renombrar", () => renombrarVersion(orgId, year, month, v.id, n)); }}
                        style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 0, display: "inline-flex" }}><Pencil size={11} /></button>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim }}>{fecha(v.at)}{v.autor?.nombre ? ` · ${v.autor.nombre}` : ""} · {v.trabajadores || 0} trabajadores</div>
                  </div>
                  <button className="op-btn" onClick={() => comparar(v)} disabled={!!ocupado}><ArrowLeftRight size={13} />Comparar</button>
                  <button className="op-btn" onClick={() => restaurar(v)} disabled={!!ocupado}><RotateCcw size={13} />Volver a esta</button>
                  <button aria-label="Borrar versión" title="Borrar esta versión" onClick={() => window.confirm(`¿Borrar «${nombreVersionCuadrante(v)}»?`) && hacer("borrar", () => borrarVersion(orgId, year, month, v.id))}
                    style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex", padding: 4 }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

        {comparando && (
          <div style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Actual frente a «{nombreVersionCuadrante(comparando.v)}»</div>
              <button onClick={() => setComparando(null)} aria-label="Cerrar comparación" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex" }}><X size={15} /></button>
            </div>
            {comparando.cargando ? <div style={{ color: C.muted, fontSize: 12 }}><Loader2 size={13} className="op-girando" /> Cargando…</div>
              : !comparando.dif.celdas ? <div style={{ color: C.green, fontSize: 13 }}>Son iguales: no cambia ningún turno.</div>
              : (
                <>
                  <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                    {comparando.dif.celdas === 1 ? "Cambia" : "Cambian"} <b style={{ color: C.text }}>{comparando.dif.celdas} {comparando.dif.celdas === 1 ? "turno" : "turnos"}</b> de <b style={{ color: C.text }}>{comparando.dif.porTrabajador.length} {comparando.dif.porTrabajador.length === 1 ? "trabajador" : "trabajadores"}</b>. Cada día se ve así: día, turno en la versión → turno ahora.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {comparando.dif.porTrabajador.map(t => (
                      <div key={t.wid} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ width: 150, flexShrink: 0, fontSize: 12, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreTrab(t.wid)}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {t.dias.map(x => (
                            <span key={x.d} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "2px 5px" }}>
                              <b style={{ color: C.text }}>{x.d}</b><Turno c={x.antes} />→<Turno c={x.ahora} />
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
