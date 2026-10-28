// App del trabajador → Mi cuadrante → «Vacaciones y permisos»: pedir días,
// ver en qué quedan y retirar los que aún no se han contestado.
import { useEffect, useState } from "react";
import { CalendarPlus, Check, Clock, X } from "lucide-react";
import { C, S } from "../conductor/comun.js";
import { DIAS_VACACIONES_AÑO, TIPOS_AUSENCIA, nombreTipo, ordenarSolicitudes, problemaSolicitud, resumenAño, diasDe } from "./solicitudes.js";
import { cancelarAusencia, escucharMisAusencias, pedirAusencia, periodo } from "./store.js";

const ESTADO = {
  pendiente: { t: "Pendiente", c: C.amber, I: Clock },
  aprobada: { t: "Aprobada", c: C.green, I: Check },
  rechazada: { t: "Rechazada", c: C.red, I: X },
  cancelada: { t: "Retirada", c: C.dim, I: X },
};
const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function MisAusencias({ sesion }) {
  const [lista, setLista] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ tipo: "vacaciones", desde: "", hasta: "", comentario: "" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    if (!sesion?.org_id || !sesion?.uid) return;
    return escucharMisAusencias(sesion.org_id, sesion.uid, setLista);
  }, [sesion?.org_id, sesion?.uid]);

  const año = new Date().getFullYear();
  const r = resumenAño(lista || [], año);
  const dias = f.desde && f.hasta && f.hasta >= f.desde ? diasDe(f.desde, f.hasta).length : 0;

  async function enviar() {
    const p = problemaSolicitud(f, hoyIso());
    if (p) { setError(p); return; }
    setEnviando(true); setError(null);
    try {
      await pedirAusencia(sesion, f);
      setF({ tipo: "vacaciones", desde: "", hasta: "", comentario: "" }); setAbierto(false); setHecho(true);
    } catch (e) { setError(e.message || String(e)); } finally { setEnviando(false); }
  }

  return (
    <div style={{ ...S.card, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Vacaciones y permisos</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {año}: {r.aprobados} de {DIAS_VACACIONES_AÑO} días de vacaciones aprobados{r.pendientes ? ` · ${r.pendientes} pendientes` : ""}
          </div>
        </div>
        {!abierto && <button style={S.btnSm} onClick={() => { setAbierto(true); setHecho(false); }}><CalendarPlus size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />Pedir días</button>}
      </div>

      {hecho && <div style={{ fontSize: 13, color: C.green, marginTop: 10 }}>Solicitud enviada. Te avisaremos cuando la contesten.</div>}

      {abierto && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={S.label}>Tipo
            <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} style={{ ...S.input, marginTop: 6 }} aria-label="Tipo de ausencia">
              {TIPOS_AUSENCIA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...S.label, flex: 1 }}>Desde
              <input type="date" min={hoyIso()} value={f.desde} onChange={e => setF({ ...f, desde: e.target.value, hasta: f.hasta && f.hasta >= e.target.value ? f.hasta : e.target.value })} style={{ ...S.input, marginTop: 6 }} aria-label="Desde" />
            </label>
            <label style={{ ...S.label, flex: 1 }}>Hasta
              <input type="date" min={f.desde || hoyIso()} value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} style={{ ...S.input, marginTop: 6 }} aria-label="Hasta" />
            </label>
          </div>
          {dias > 0 && <div style={{ fontSize: 12, color: C.muted }}>{dias} {dias === 1 ? "día" : "días"}</div>}
          <label style={S.label}>Comentario (opcional)
            <textarea value={f.comentario} onChange={e => setF({ ...f, comentario: e.target.value })} rows={2} style={{ ...S.input, marginTop: 6, resize: "vertical" }} aria-label="Comentario" />
          </label>
          {error && <div style={{ fontSize: 13, color: C.red }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.btnGhost, flex: 1 }} onClick={() => { setAbierto(false); setError(null); }}>Cancelar</button>
            <button style={{ ...S.btnOk, flex: 2 }} onClick={enviar} disabled={enviando}>{enviando ? "Enviando…" : "Enviar solicitud"}</button>
          </div>
        </div>
      )}

      {lista?.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {ordenarSolicitudes(lista).slice(0, 12).map(s => {
            const e = ESTADO[s.estado] || ESTADO.pendiente;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: C.surface2 }}>
                <e.I size={16} color={e.c} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{nombreTipo(s.tipo)} · {periodo(s)}</div>
                  <div style={{ fontSize: 12, color: e.c }}>{e.t}{s.dias ? ` · ${s.dias} ${s.dias === 1 ? "día" : "días"}` : ""}{s.estado === "rechazada" && s.motivo ? ` · ${s.motivo}` : ""}</div>
                </div>
                {s.estado === "pendiente" && <button style={{ ...S.btnGhost, padding: "6px 10px", fontSize: 12 }} onClick={() => cancelarAusencia(s.id).catch(() => {})}>Retirar</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
