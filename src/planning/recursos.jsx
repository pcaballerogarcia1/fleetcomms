// Planning → Recursos: los vehículos y los trabajadores de la empresa (los
// mismos en todos sus proyectos) y, en este proyecto, qué trabajos puede hacer
// cada vehículo (proyecto.vehiculosTrabajos; sin marcar = todos).
import { useState } from "react";
import { TabTrabajadores, TabVehiculos } from "../scheduling/flota.jsx";
import { C, font } from "./estilo.js";
import { ImportarRecursos } from "./importar-recursos.jsx";

export function TabRecursos({ vehicles = [], workers = [], loadingV, loadingW, activeProject, onProjectUpdate, orgId }) {
  const [sub, setSub] = useState("vehiculos");
  const SUBS = [
    ["vehiculos", `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}`],
    ["trabajadores", `Trabajadores${workers.length ? ` (${workers.length})` : ""}`],
    ["trabajos", "Qué hace cada vehículo"],
  ];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: font }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 20px", borderBottom: `1px solid ${C.border}`, alignItems: "center", flexWrap: "wrap" }}>
        {SUBS.map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)} style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12.5, fontFamily: font, cursor: "pointer",
            background: sub === k ? C.blueDim : "none", color: sub === k ? C.blueText : C.muted,
            border: `1px solid ${sub === k ? C.blue : C.border}`, fontWeight: sub === k ? 600 : 400,
          }}>{l}</button>
        ))}
        <span style={{ fontSize: 11.5, color: C.dim, marginLeft: 8 }}>Vehículos y trabajadores son de toda la empresa: los mismos en todos los proyectos.</span>
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {sub === "vehiculos" && <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ImportarRecursos tipo="vehiculos" vehicles={vehicles} workers={workers} orgId={orgId} />
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}><TabVehiculos vehicles={vehicles} loading={loadingV} activeProject={activeProject} orgId={orgId} /></div>
        </div>}
        {sub === "trabajadores" && <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ImportarRecursos tipo="trabajadores" vehicles={vehicles} workers={workers} orgId={orgId} />
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}><TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} activeProject={activeProject} orgId={orgId} /></div>
        </div>}
        {sub === "trabajos" && <VehiculosTrabajos vehicles={vehicles} activeProject={activeProject} onProjectUpdate={onProjectUpdate} />}
      </div>
    </div>
  );
}

/** Qué trabajos del proyecto puede hacer cada vehículo (sin marcar ninguno = todos) */
function VehiculosTrabajos({ vehicles, activeProject, onProjectUpdate }) {
  const trabajos = activeProject?.trabajos || [];
  const [mapa, setMapa] = useState(() => activeProject?.vehiculosTrabajos || {});
  const [error, setError] = useState(null);
  const puede = (v, t) => { const l = mapa[v._id]; return !l || l.includes(t.id); };
  function cambiar(v, t) {
    const actual = mapa[v._id] || trabajos.map(x => x.id);
    let nuevo = actual.includes(t.id) ? actual.filter(x => x !== t.id) : [...actual, t.id];
    const todos = trabajos.every(x => nuevo.includes(x.id));
    const siguiente = { ...mapa };
    if (todos) delete siguiente[v._id]; else siguiente[v._id] = nuevo;
    setMapa(siguiente); setError(null);
    Promise.resolve(onProjectUpdate?.({ vehiculosTrabajos: siguiente })).catch(e => setError(`No se pudo guardar: ${e.message || e}`));
  }
  const th = { textAlign: "center", padding: "8px 10px", fontSize: 10.5, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "7px 10px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.text, textAlign: "center" };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 22px 40px" }}>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, maxWidth: 900, marginBottom: 12 }}>
        Marca qué trabajos de este proyecto puede hacer cada vehículo: Scheduling solo le dará esos. Un vehículo con todo marcado (como vienen) puede hacerlo todo.
      </div>
      {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
      {!trabajos.length ? (
        <div style={{ fontSize: 12.5, color: C.dim }}>Este proyecto aún no tiene trabajos: créalos en la pestaña Trabajos.</div>
      ) : !vehicles.length ? (
        <div style={{ fontSize: 12.5, color: C.dim }}>La empresa aún no tiene vehículos: añádelos en «Vehículos».</div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", background: C.card, display: "inline-block", minWidth: 420, maxWidth: "100%" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Vehículo</th>
              {trabajos.map(t => <th key={t.id} style={th}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: t.color || C.blue, marginRight: 5 }} />{t.nombre}</th>)}
            </tr></thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v._id}>
                  <td style={{ ...td, textAlign: "left" }}><b>{v.nombre || v.matricula}</b><div style={{ fontSize: 11, color: C.dim }}>{v.tipo || ""}</div></td>
                  {trabajos.map(t => {
                    const sugerido = t.vehiculo && v.tipo && t.vehiculo.toLowerCase() === v.tipo.toLowerCase();
                    return (
                      <td key={t.id} style={td} title={sugerido ? "Su tipo coincide con el del trabajo" : ""}>
                        <input type="checkbox" checked={puede(v, t)} onChange={() => cambiar(v, t)} style={{ accentColor: C.blue, width: 16, height: 16, cursor: "pointer" }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
