// Control de rutas por puntos: fichajes (tabla y calendario).
import { useState, useEffect, useMemo } from "react";
import { db } from "../firebase.js";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { C, DIAS_SEMANA_CORTO, fmtDur, fmtFecha, fmtHoraF, fmtMes, font, mono, userName } from "./datos.js";

export function PanelFichajes({ orgId, isSuperAdmin, usuarios }) {
  const [fichajes, setFichajes] = useState([]);
  const [mesFilter, setMesFilter] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [vistaFichajes, setVistaFichajes] = useState("calendario"); // calendario | tabla
  const [diaSeleccionado, setDiaSeleccionado] = useState(null); // "YYYY-MM-DD" | null

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "fichajes");
    const q = orgId ? query(col, where("org_id", "==", orgId), limit(500)) : query(col, limit(500));
    return onSnapshot(q, snap => {
      setFichajes(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
    }, e => console.error("[fichajes] error leyendo:", e));
  }, [orgId, isSuperAdmin]);

  const meses = useMemo(() =>
    [...new Set(fichajes.map(f => f.fecha?.slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [fichajes]
  );

  const delMes = useMemo(() =>
    fichajes.filter(f => f.fecha?.startsWith(mesFilter)).sort((a, b) => (b.horaEntrada || 0) - (a.horaEntrada || 0)),
    [fichajes, mesFilter]
  );

  // Fila visible en la tabla: si hay un día del calendario seleccionado, solo ese día
  const filasTabla = useMemo(() =>
    diaSeleccionado ? delMes.filter(f => f.fecha === diaSeleccionado) : delMes,
    [delMes, diaSeleccionado]
  );

  // Días del mes con al menos un fichaje, con su recuento y si alguno sigue abierto
  const porDia = useMemo(() => {
    const map = {};
    delMes.forEach(f => {
      if (!f.fecha) return;
      if (!map[f.fecha]) map[f.fecha] = { count: 0, abierto: false };
      map[f.fecha].count++;
      if (f.estado === "abierto") map[f.fecha].abierto = true;
    });
    return map;
  }, [delMes]);

  const abiertosAhora = useMemo(() => fichajes.filter(f => f.estado === "abierto"), [fichajes]);

  const stats = useMemo(() => {
    let ms = 0, km = 0;
    delMes.forEach(f => {
      if (f.horaSalida) ms += f.horaSalida - f.horaEntrada;
      km += f.kmRecorridos || 0;
    });
    return { horas: fmtDur(ms), km: km.toFixed(0), registros: delMes.length };
  }, [delMes]);

  function nombreDe(f) { return f.nombre || userName(f.uid, usuarios); }

  function exportarExcel() {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Conductor", "Matrícula", "Fecha", "Entrada", "Salida", "Duración", "Km inicio", "Km fin", "Km recorridos", "Estado"];
    const rows = delMes.map(f => [
      nombreDe(f), f.matricula ?? "", f.fecha, fmtHoraF(f.horaEntrada), fmtHoraF(f.horaSalida),
      f.horaSalida ? fmtDur(f.horaSalida - f.horaEntrada) : "en curso",
      f.kmInicio ?? "", f.kmFin ?? "", f.kmRecorridos ?? "", f.estado,
    ]);
    const csv = "﻿" + [header, ...rows].map(r => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fichajes_${mesFilter}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={mesFilter}
              onChange={e => { setMesFilter(e.target.value); setDiaSeleccionado(null); }}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 7, padding: "5px 10px",
                fontSize: 12, fontFamily: font, cursor: "pointer", outline: "none",
              }}
            >
              {!meses.includes(mesFilter) && <option value={mesFilter}>{fmtMes(mesFilter)}</option>}
              {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
            </select>
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
              {[["calendario", "Calendario"], ["tabla", "Tabla"]].map(([k, l]) => (
                <button key={k} onClick={() => setVistaFichajes(k)} style={{
                  padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: vistaFichajes === k ? "rgba(255,255,255,0.1)" : "none",
                  color: vistaFichajes === k ? "#fff" : C.muted,
                  fontSize: 11, fontWeight: vistaFichajes === k ? 600 : 400, fontFamily: font,
                  transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <button
            onClick={exportarExcel}
            disabled={delMes.length === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(63,207,142,0.08)", border: "1px solid rgba(63,207,142,0.25)",
              color: C.green, borderRadius: 7, padding: "5px 12px",
              fontSize: 12, fontWeight: 600, cursor: delMes.length === 0 ? "not-allowed" : "pointer",
              opacity: delMes.length === 0 ? 0.4 : 1, fontFamily: font,
            }}
          >Excel</button>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { l: "Fichados ahora", v: abiertosAhora.length, c: abiertosAhora.length > 0 ? C.green : C.dim },
            { l: "Registros del mes", v: stats.registros, c: C.blue },
            { l: "Horas del mes", v: stats.horas, c: C.muted },
            { l: "Km del mes", v: stats.km, c: C.orange },
          ].map(s => (
            <div key={s.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.c, fontFamily: mono, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {vistaFichajes === "calendario" ? (
          <div style={{ padding: "14px 16px" }}>
            <CalendarioFichajes mesFilter={mesFilter} porDia={porDia} diaSeleccionado={diaSeleccionado} onSelectDia={setDiaSeleccionado} />
            {diaSeleccionado && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    {fmtFecha(diaSeleccionado)} · {filasTabla.length} fichaje{filasTabla.length !== 1 ? "s" : ""}
                  </div>
                  <button onClick={() => setDiaSeleccionado(null)} style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", fontFamily: font }}>
                    ver todo el mes
                  </button>
                </div>
                {filasTabla.length === 0 ? (
                  <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Sin fichajes este día</div>
                ) : (
                  <TablaFichajes rows={filasTabla} nombreDe={nombreDe} />
                )}
              </div>
            )}
          </div>
        ) : (
          filasTabla.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "60px 0" }}>
              Sin fichajes este mes
            </div>
          ) : (
            <TablaFichajes rows={filasTabla} nombreDe={nombreDe} />
          )
        )}
      </div>
    </div>
  );
}

// ── TABLA DE FICHAJES (reutilizada por la vista tabla y el detalle del día) ──
function TablaFichajes({ rows, nombreDe }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          {["Conductor", "Matrícula", "Fecha", "Entrada", "Salida", "Duración", "Km inicio", "Km fin", "Km recorridos", ""].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "8px 14px", color: C.dim, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(f => (
          <tr key={f._id} style={{ borderBottom: `1px solid ${C.border}` }}>
            <td style={{ padding: "8px 14px", color: C.text, fontWeight: 600 }}>{nombreDe(f)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{f.matricula || "—"}</td>
            <td style={{ padding: "8px 14px", color: C.muted }}>{fmtFecha(f.fecha)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{fmtHoraF(f.horaEntrada)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{fmtHoraF(f.horaSalida)}</td>
            <td style={{ padding: "8px 14px", color: C.muted }}>{f.horaSalida ? fmtDur(f.horaSalida - f.horaEntrada) : "—"}</td>
            <td style={{ padding: "8px 14px", color: C.dim, fontFamily: mono }}>{f.kmInicio ?? "—"}</td>
            <td style={{ padding: "8px 14px", color: C.dim, fontFamily: mono }}>{f.kmFin ?? "—"}</td>
            <td style={{ padding: "8px 14px", color: C.orange, fontFamily: mono, fontWeight: 600 }}>{f.kmRecorridos ?? "—"}</td>
            <td style={{ padding: "8px 14px" }}>
              {f.estado === "abierto" && (
                <span style={{ fontSize: 10, color: C.green, background: "rgba(63,207,142,0.1)", border: "1px solid rgba(63,207,142,0.3)", borderRadius: 4, padding: "2px 7px" }}>en curso</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CalendarioFichajes({ mesFilter, porDia, diaSeleccionado, onSelectDia }) {
  const [y, m] = mesFilter.split("-").map(Number);
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${mesFilter}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {DIAS_SEMANA_CORTO.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: C.dim, fontWeight: 600, padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;
          const info = porDia[day];
          const isToday = day === todayStr;
          const isSelected = day === diaSeleccionado;
          const dayNum = +day.slice(-2);
          return (
            <button
              key={day}
              onClick={() => onSelectDia(isSelected ? null : day)}
              style={{
                aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 3, borderRadius: 8, cursor: "pointer", fontFamily: font, padding: 0,
                background: isSelected ? C.blueDim : info ? C.card : "transparent",
                border: `1px solid ${isSelected ? C.blue : isToday ? C.border2 : info ? C.border : "transparent"}`,
                color: isSelected ? C.blueText : info ? C.text : C.dim,
                transition: "all .12s",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              {info && (
                <span style={{
                  fontSize: 9, fontFamily: mono, fontWeight: 700,
                  color: info.abierto ? C.green : (isSelected ? C.blueText : C.muted),
                }}>
                  {info.abierto ? "● en curso" : `${info.count} fich.`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
