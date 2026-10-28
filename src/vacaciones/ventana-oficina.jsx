// Cuadrante → «Solicitudes»: vacaciones y permisos que piden los
// trabajadores desde la app. Antes de aprobar se ve cuántos compañeros
// trabajan esos días; al aprobar, los días quedan en «V» en el cuadrante.
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { C, font } from "../tema.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { loadRosterMonth } from "../roster-store.js";
import { companerosTrabajando, diasPorMes, nombreTipo, ordenarSolicitudes } from "./solicitudes.js";
import { aprobarAusencia, periodo, rechazarAusencia } from "./store.js";

const ESTADO = { pendiente: ["Pendiente", C.amber], aprobada: ["Aprobada", C.green], rechazada: ["Rechazada", C.red], cancelada: ["Retirada por el trabajador", C.dim] };
const fechaLarga = f => new Date(f + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

/** Los cuadrantes de los meses que tocan las solicitudes pendientes: { "YYYY-MM": grid } */
function useGrids(orgId, solicitudes) {
  const meses = useMemo(() => [...new Set(solicitudes.filter(s => s.estado === "pendiente").flatMap(s => Object.keys(diasPorMes(s.desde, s.hasta))))].sort().join(","), [solicitudes]);
  const [grids, setGrids] = useState({});
  useEffect(() => {
    if (!orgId || !meses) return;
    let vivo = true;
    Promise.all(meses.split(",").map(async mes => {
      const [y, m] = mes.split("-").map(Number);
      try { return [mes, (await loadRosterMonth(orgId, y, m)).grid || {}]; } catch { return [mes, {}]; }
    })).then(par => { if (vivo) setGrids(Object.fromEntries(par)); });
    return () => { vivo = false; };
  }, [orgId, meses]);
  return grids;
}

export function VentanaSolicitudes({ orgId, solicitudes, workers, sesion, onCerrar }) {
  const [ver, setVer] = useState("pendientes");
  const [ocupado, setOcupado] = useState(null);
  const [rechazando, setRechazando] = useState(null); // { id, motivo }
  const [error, setError] = useState(null);
  const grids = useGrids(orgId, solicitudes);
  const workerDe = uid => workers.find(w => w.uid === uid) || null;
  const lista = ordenarSolicitudes(solicitudes).filter(s => (ver === "pendientes" ? s.estado === "pendiente" : true));
  const pendientes = solicitudes.filter(s => s.estado === "pendiente").length;

  async function hacer(id, fn) {
    setOcupado(id); setError(null);
    try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setOcupado(null); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onCerrar}>
      <div role="dialog" aria-label="Solicitudes de vacaciones y permisos" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "22px 24px 20px", width: 720, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Vacaciones y permisos</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Lo que piden los trabajadores desde la app. Al aprobar, esos días quedan como «V» en el cuadrante, no se les ponen turnos ni rutas y se les avisa al móvil.</div>

        <div className="op-seg" style={{ marginBottom: 12 }}>
          <button className={ver === "pendientes" ? "op-on" : ""} onClick={() => setVer("pendientes")}>Pendientes ({pendientes})</button>
          <button className={ver === "todas" ? "op-on" : ""} onClick={() => setVer("todas")}>Todas</button>
        </div>
        {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        {!lista.length ? <div style={{ color: C.dim, fontSize: 13, padding: "24px 0", textAlign: "center" }}>{ver === "pendientes" ? "No hay solicitudes pendientes." : "Todavía no hay solicitudes."}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lista.map(s => {
              const w = workerDe(s.uid);
              const cob = s.estado === "pendiente" && w ? companerosTrabajando(grids, w._id, s.desde, s.hasta) : null;
              const [txt, col] = ESTADO[s.estado] || ESTADO.pendiente;
              return (
                <div key={s.id} className="op-tarjeta" style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") : s.nombre}</div>
                      <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{nombreTipo(s.tipo)} · {periodo(s)} · {s.dias} {s.dias === 1 ? "día" : "días"}</div>
                      {s.comentario && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>«{s.comentario}»</div>}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: col, whiteSpace: "nowrap" }}>{txt}</span>
                  </div>
                  {s.estado === "pendiente" && (
                    <>
                      {!w && <div style={{ fontSize: 12, color: C.amber, marginTop: 8, display: "flex", gap: 6 }}><TriangleAlert size={13} />No está vinculado a ningún trabajador de la plantilla: se aprobará, pero no se podrá marcar en el cuadrante.</div>}
                      {cob?.minimo != null && (
                        <div style={{ fontSize: 12, color: cob.minimo <= 1 ? C.red : C.muted, marginTop: 8 }}>
                          Esos días trabajan como mínimo <b>{cob.minimo}</b> {cob.minimo === 1 ? "compañero" : "compañeros"} (el {fechaLarga(cob.dia)}), según el cuadrante.
                        </div>
                      )}
                      {rechazando?.id === s.id ? (
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <input className="op-input" autoFocus placeholder="Motivo (lo verá el trabajador)" value={rechazando.motivo} onChange={e => setRechazando({ id: s.id, motivo: e.target.value })} aria-label="Motivo del rechazo" style={{ flex: 1, height: 30 }} />
                          <button className="op-btn" onClick={() => setRechazando(null)}>Cancelar</button>
                          <button className="op-btn op-btn-peligro" disabled={ocupado === s.id} onClick={() => hacer(s.id, async () => { await rechazarAusencia(s, rechazando.motivo, sesion); setRechazando(null); })}>Rechazar</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                          <button className="op-btn" onClick={() => setRechazando({ id: s.id, motivo: "" })} disabled={!!ocupado}><X size={14} />Rechazar</button>
                          <button className="op-btn op-primario" onClick={() => hacer(s.id, () => aprobarAusencia(s, w, sesion))} disabled={!!ocupado}>
                            {ocupado === s.id ? <Loader2 size={14} className="op-girando" /> : <Check size={14} />}Aprobar
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {s.estado !== "pendiente" && s.resueltaPor?.nombre && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Contestada por {s.resueltaPor.nombre}{s.motivo ? ` · ${s.motivo}` : ""}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
