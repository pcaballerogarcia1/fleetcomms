// ── Enviar un mes al Rostering (desde el Scheduling de líneas) ──────────
// Cada día del mes lleva los turnos del calendario que circula ese día
// (lineas-rostering.js). Los calendarios ya calculados en pantalla se usan
// tal cual; los demás se calculan aquí (en segundo plano) con su estrategia
// y sus cambios a mano.
import { useState, useMemo } from "react";
import { diasDelMes, turnosDelMes, nombreDiaRoster } from "./lineas-rostering.js";
import { saveScenarioRoster } from "./roster-store.js";
import { logAudit } from "./audit.js";
import { COLORES_CAL } from "./lineas-horarios-util.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", green: "#34d399", amber: "#fbbf24", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const irARostering = () => { window.history.pushState({}, "", "/rostering"); window.dispatchEvent(new PopStateEvent("popstate")); };

/**
 * estadoDe(dia) → "pantalla" (calculado y al día en esta pantalla) | "guardado" (calculado antes) | "nuevo"
 * turnosDe(dia) → Promise<turnosCompactos> (de la pantalla o calculándolo)
 */
export function EnviarRostering({ red, projectId, orgId, estadoDe, turnosDe, onCerrar }) {
  const hoy = new Date();
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`);
  const [estado, setEstado] = useState(null); // { trabajando, texto } | { ok, n, dias } | { error }
  const [year, month] = mes.split("-").map(Number);
  const dias = useMemo(() => (year && month ? diasDelMes(red, year, month) : []), [red, year, month]);
  const usados = useMemo(() => {
    const m = new Map();
    for (const x of dias) if (x.dia) m.set(x.dia, (m.get(x.dia) || 0) + 1);
    const orden = (red?.calendarios || []).map(c => c.id);
    return [...m].sort((a, b) => (orden.indexOf(a[0]) + 1 || 99) - (orden.indexOf(b[0]) + 1 || 99));
  }, [dias, red]);
  const sinServicio = dias.filter(x => !x.dia).length;

  async function enviar() {
    setEstado({ trabajando: true, texto: "Preparando…" });
    try {
      const porDia = {};
      for (const [i, [dia]] of usados.entries()) {
        setEstado({ trabajando: true, texto: `${estadoDe(dia) === "pantalla" ? "Leyendo" : "Calculando"} los turnos de «${nombreDiaRoster(red, dia)}» (${i + 1} de ${usados.length})…` });
        porDia[dia] = await turnosDe(dia);
      }
      const { shifts, cals, calDia } = turnosDelMes(red, dias, porDia);
      setEstado({ trabajando: true, texto: "Guardando en el Rostering…" });
      await saveScenarioRoster(projectId, {
        projectId, orgId, mes, turnoByWorker: {}, modo: "libre", moves: [], generatedAt: new Date().toISOString(),
        lineas: true, cals, calDia,
      }, shifts, {});
      logAudit({ modulo: "Scheduling", accion: "Envió los turnos de líneas al Rostering", detalle: `${MESES[month - 1]} ${year} · ${shifts.length} turnos · ${cals.map(c => `${c.nombre}: ${c.dias} días`).join(" · ")}` });
      setEstado({ ok: true, n: shifts.length, dias: Object.keys(calDia).length });
    } catch (e) {
      console.error("Enviar a Rostering:", e);
      setEstado({ error: e.message || String(e) });
    }
  }

  const btn = (fuerte, off) => ({ padding: fuerte ? "9px 18px" : "6px 12px", borderRadius: 7, border: `1px solid ${fuerte ? C.blue : C.border2}`, background: fuerte ? (off ? C.surface2 : "#16306a") : "transparent", color: fuerte ? "#cfe0ff" : C.muted, fontSize: 12.5, fontWeight: fuerte ? 700 : 500, cursor: off ? "not-allowed" : "pointer", fontFamily: font });
  const trabajando = !!estado?.trabajando;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !trabajando && onCerrar()}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 12, fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,.5)", padding: "18px 20px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Enviar a Rostering</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>
          Cada día del mes se cubre con los turnos del calendario que circula ese día (laborables, sábados, festivos…). En Rostering, <b style={{ color: C.text }}>Optimizar</b> reparte la plantilla con sus reglas, sin cambiar ningún turno de día.
        </div>
        {estado?.ok ? (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 9, background: "rgba(52,211,153,.08)", border: `1px solid ${C.green}55` }}>
            <div style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>✓ Enviados {estado.n.toLocaleString("es-ES")} turnos de {estado.dias} días de {MESES[month - 1]}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>En Rostering, ve a {MESES[month - 1]} de {year} y pulsa «Optimizar».</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => { onCerrar(); irARostering(); }} style={btn(true)}>Ir a Rostering</button>
              <button onClick={onCerrar} style={btn(false)}>Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, fontSize: 12.5, color: C.text }}>
              Mes
              <input type="month" value={mes} disabled={trabajando} onChange={e => e.target.value && setMes(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12.5, fontFamily: font, colorScheme: "dark" }} />
            </label>
            <div style={{ marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
              {usados.map(([dia, n], i) => {
                const e = estadoDe(dia);
                return (
                  <div key={dia} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: COLORES_CAL[i % COLORES_CAL.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreDiaRoster(red, dia)}</span>
                    <span style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap" }}>{n} día{n > 1 ? "s" : ""}</span>
                    <span style={{ fontSize: 11, whiteSpace: "nowrap", color: e === "nuevo" ? C.amber : C.green }} title={e === "nuevo" ? "Este calendario aún no se ha calculado en el Scheduling: se calcula ahora con las restricciones de siempre" : undefined}>
                      {e === "pantalla" ? "✓ el de pantalla" : e === "guardado" ? "✓ calculado" : "se calculará"}
                    </span>
                  </div>
                );
              })}
              {sinServicio > 0 && <div style={{ padding: "8px 12px", fontSize: 11.5, color: C.dim }}>{sinServicio} día{sinServicio > 1 ? "s" : ""} sin servicio (ningún calendario circula)</div>}
              {!usados.length && <div style={{ padding: 12, fontSize: 12, color: C.amber }}>Ese mes no circula ningún calendario de la red.</div>}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>Sustituye lo que hubiera en Rostering de este proyecto. Lo que ya se haya asignado a mano en el cuadrante se respeta.</div>
            {estado?.error && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>No se pudo enviar: {estado.error}</div>}
            {trabajando && <div style={{ fontSize: 12, color: C.blue, marginTop: 10 }}>{estado.texto}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={onCerrar} disabled={trabajando} style={btn(false)}>Cancelar</button>
              <button onClick={enviar} disabled={trabajando || !usados.length} style={btn(true, trabajando || !usados.length)}>{trabajando ? "Enviando…" : "Enviar a Rostering"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
