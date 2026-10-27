// Análisis → Cierre del mes: horas de cada trabajador para la nómina, sacadas
// de los fichajes, con lo que no cuadra con el Cuadrante. Se puede cerrar el
// mes (queda guardada una copia) y descargar el Excel para nómina.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { FileDown, Lock, LockOpen, TriangleAlert } from "lucide-react";
import { db } from "../firebase.js";
import { C, font } from "../tema.js";
import { DEFAULT_ROSTER_RULES } from "../roster-optimizer.js";
import { listenRosterMonth } from "../roster-store.js";
import { logAudit } from "../audit.js";
import { cierreDelMes } from "./cierre.js";
import { Cifra } from "./ui.jsx";
import { horas, num, td, th } from "./formato.js";

const PRECIOS = [
  ["costeHora", "€ / hora ordinaria"],
  ["costeHoraExtra", "€ / hora extra"],
  ["plusNocturnaHora", "Plus nocturno (€ / hora)"],
  ["plusFestivoPct", "Plus domingo y festivo (%)"],
];

export function PanelCierre({ orgId, sesion, fichajes, mes }) {
  const [y, m] = mes.split("-").map(Number);
  const [rules, setRules] = useState(DEFAULT_ROSTER_RULES);
  const [precios, setPrecios] = useState({});
  const [workers, setWorkers] = useState([]);
  const [grid, setGrid] = useState({});
  const [cierre, setCierre] = useState(null);
  const [error, setError] = useState(null);
  const reglasId = orgId ? `${orgId}_reglas` : null;
  const cierreId = orgId ? `${orgId}_cierre_${y}_${String(m).padStart(2, "0")}` : null;

  useEffect(() => {
    if (!reglasId) return;
    return onSnapshot(doc(db, "rostering", reglasId), s => {
      const d = s.exists() ? s.data() : {};
      setRules({ ...DEFAULT_ROSTER_RULES, ...(d.rules || {}) });
      setPrecios(d.preciosCierre || {});
    }, () => {});
  }, [reglasId]);
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(query(collection(db, "scheduling_workers"), where("org_id", "==", orgId)), s => setWorkers(s.docs.map(d => ({ _id: d.id, ...d.data() }))), () => {});
  }, [orgId]);
  useEffect(() => { if (!orgId) return; return listenRosterMonth(orgId, y, m, mm => setGrid(mm.grid || {})); }, [orgId, y, m]);
  useEffect(() => {
    if (!cierreId) return;
    return onSnapshot(doc(db, "rostering", cierreId), s => setCierre(s.exists() && s.data().cerrado ? s.data() : null), () => setCierre(null));
  }, [cierreId]);

  const vivo = useMemo(() => cierreDelMes({ fichajes, workers, grid, rules, precios, year: y, month: m }), [fichajes, workers, grid, rules, precios, y, m]);
  const datos = cierre ? { filas: cierre.filas || [], totales: cierre.totales || {}, limiteDia: cierre.limiteDia, topeMes: cierre.topeMes } : vivo;
  const { filas, totales } = datos;

  async function guardarPrecio(k, v) {
    const n = v === "" ? null : Math.max(0, +String(v).replace(",", "."));
    setPrecios(p => ({ ...p, [k]: n }));
    try { await setDoc(doc(db, "rostering", reglasId), { org_id: orgId, preciosCierre: { [k]: n } }, { merge: true }); } catch (e) { setError(e.message); }
  }
  async function cerrar() {
    if (!window.confirm(`¿Cerrar ${mes}?\n\nSe guarda una copia de estas horas tal y como están ahora. Lo que se fiche o corrija después no la cambia, salvo que reabras el mes.`)) return;
    try {
      await setDoc(doc(db, "rostering", cierreId), {
        org_id: orgId, year: y, month: m, cerrado: true, at: Date.now(),
        cerradoPor: { uid: sesion?.uid || null, nombre: [sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") || null },
        filas: vivo.filas, totales: vivo.totales, limiteDia: vivo.limiteDia, topeMes: vivo.topeMes, precios,
      });
      logAudit({ modulo: "Análisis", accion: "Cerró el mes", detalle: mes, projectId: null });
    } catch (e) { setError(e.message); }
  }
  async function reabrir() {
    if (!window.confirm(`¿Reabrir ${mes}? Las horas volverán a calcularse con los fichajes de ahora.`)) return;
    try {
      await setDoc(doc(db, "rostering", cierreId), { org_id: orgId, cerrado: false, reabiertoAt: Date.now() }, { merge: true });
      logAudit({ modulo: "Análisis", accion: "Reabrió el mes", detalle: mes, projectId: null });
    } catch (e) { setError(e.message); }
  }
  async function excel() {
    const XLSX = await import("xlsx");
    const h = v => +(v / 60).toFixed(2);
    const rows = [["Trabajador", "Días trabajados", "Horas totales", "Horas ordinarias", "Horas extra", "Horas nocturnas", "Horas en domingo o festivo", "Km", "Importe (€)", "Avisos"]];
    for (const f of filas) rows.push([f.nombre, f.dias, h(f.total), h(f.ordinarias), h(f.extra), h(f.nocturnas), h(f.festivo), f.km, f.importe ?? "", f.avisos.join(" · ")]);
    rows.push([]);
    rows.push(["Total", "", h(totales.total), "", h(totales.extra), h(totales.nocturnas), h(totales.festivo), totales.km, totales.importe ?? ""]);
    rows.push([]);
    rows.push([`Extra: por encima de ${horas(datos.limiteDia)} al día${datos.topeMes ? ` o de ${horas(datos.topeMes)} al mes` : ""}. Nocturnas: de 22:00 a 06:00.${cierre ? ` Mes cerrado el ${new Date(cierre.at).toLocaleString("es-ES")}.` : " Mes sin cerrar."}`]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Nómina");
    XLSX.writeFile(wb, `cierre_${mes}.xlsx`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: font }}>
      {cierre ? (
        <div className="op-tarjeta" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderColor: `${C.green}55` }}>
          <Lock size={15} color={C.green} />
          <span style={{ fontSize: 13, color: C.text, flex: 1 }}>Mes cerrado el {new Date(cierre.at).toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}{cierre.cerradoPor?.nombre ? ` por ${cierre.cerradoPor.nombre}` : ""}. Se ve la copia guardada.</span>
          <button className="op-btn" onClick={reabrir}><LockOpen size={14} />Reabrir</button>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Cifra label="Horas trabajadas" value={horas(totales.total)} sub={`${totales.personas} ${totales.personas === 1 ? "trabajador" : "trabajadores"}`} ayuda="De la entrada a la salida de cada fichaje cerrado del mes." />
        <Cifra label="Horas extra" value={horas(totales.extra)} color={totales.extra ? C.amber : undefined}
          sub={`más de ${horas(datos.limiteDia)} al día${datos.topeMes ? ` o de ${horas(datos.topeMes)} al mes` : ""}`}
          ayuda="La jornada máxima diaria y el tope del mes salen de las Reglas del Cuadrante (si no hay, 9 h al día, Estatuto art. 34.3)." />
        <Cifra label="Nocturnas / festivo" value={`${horas(totales.nocturnas)} / ${horas(totales.festivo)}`} sub="de 22:00 a 06:00 · domingos y festivos" ayuda="Festivos: los de las Reglas del Cuadrante." />
        <Cifra label="Importe" value={totales.importe != null ? `${num(totales.importe)} €` : "—"} sub={totales.importe != null ? "con los precios de abajo" : "pon los precios para verlo"} />
        <Cifra label="Con avisos" value={totales.conAvisos} color={totales.conAvisos ? C.red : C.green} sub="revisar antes de cerrar" />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        {PRECIOS.map(([k, l]) => (
          <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.muted }}>
            {l}
            <input className="op-input" inputMode="decimal" defaultValue={precios[k] ?? ""} key={`${k}-${precios[k] ?? ""}`} disabled={!!cierre}
              onBlur={e => { if (String(e.target.value) !== String(precios[k] ?? "")) guardarPrecio(k, e.target.value); }} style={{ width: 150, height: 30 }} aria-label={l} />
          </label>
        ))}
        <div style={{ flex: 1 }} />
        <button className="op-btn" onClick={excel}><FileDown size={14} />Excel para nómina</button>
        {!cierre && <button className="op-btn op-primario" onClick={cerrar} disabled={!filas.length}><Lock size={14} />Cerrar el mes</button>}
      </div>
      {error && <div style={{ color: C.red, fontSize: 12 }}>{error}</div>}

      {!filas.length ? <div style={{ color: C.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>No hay fichajes ni turnos este mes.</div> : (
        <div className="op-tarjeta" style={{ overflow: "auto", maxHeight: "55vh", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Trabajador", "Días", "Total", "Ordinarias", "Extra", "Nocturnas", "Dom./festivo", "Km", "Importe", "Avisos"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.uid}>
                  <td style={{ ...td, fontWeight: 600 }}>{f.nombre}</td>
                  <td style={td}>{f.dias}</td>
                  <td style={td}>{horas(f.total)}</td>
                  <td style={td}>{horas(f.ordinarias)}</td>
                  <td style={{ ...td, color: f.extra ? C.amber : C.dim }}>{f.extra ? horas(f.extra) : "—"}</td>
                  <td style={{ ...td, color: f.nocturnas ? C.text : C.dim }}>{f.nocturnas ? horas(f.nocturnas) : "—"}</td>
                  <td style={{ ...td, color: f.festivo ? C.text : C.dim }}>{f.festivo ? horas(f.festivo) : "—"}</td>
                  <td style={td}>{num(f.km)}</td>
                  <td style={td}>{f.importe != null ? `${num(f.importe, 2)} €` : "—"}</td>
                  <td style={{ ...td, whiteSpace: "normal", minWidth: 220, color: f.avisos.length ? C.red : C.green, fontSize: 12 }}>
                    {f.avisos.length ? <span style={{ display: "inline-flex", gap: 5, alignItems: "flex-start" }}><TriangleAlert size={12} style={{ flexShrink: 0, marginTop: 2 }} />{f.avisos.join(" · ")}</span> : "Todo cuadra"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11, color: C.dim }}>
        Las horas salen de los fichajes de la app de conductores. Los avisos comparan con el Cuadrante del mes (turnos M, T y N). Los precios se guardan para toda la empresa.
      </div>
    </div>
  );
}
