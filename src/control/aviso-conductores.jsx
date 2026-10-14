// Control → «Aviso al móvil»: un mensaje de la oficina a un conductor o a
// todos (p. ej. «calle cortada en el centro, entrad por la avenida»). Les
// llega aunque tengan la app cerrada, si han activado los avisos.
import { useState } from "react";
import { enviarAvisos, resumenEnvio } from "../avisos.js";
import { C, font } from "./datos.js";

export function AvisoConductores({ orgId, usuarios }) {
  const [abierto, setAbierto] = useState(false);
  const [para, setPara] = useState("todos");
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState(null);
  const conductores = usuarios.filter(u => u.activo !== false && !["admin", "superadmin"].includes(u.rol))
    .sort((a, b) => `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`));
  async function enviar() {
    if (!texto.trim()) return;
    setEstado({ cargando: true });
    try {
      const r = await enviarAvisos(orgId, para === "todos" ? "todos" : [para], { titulo: "Mensaje de la oficina", cuerpo: texto.trim(), url: "/rutas" });
      setEstado({ ok: true, t: resumenEnvio(r) }); setTexto("");
    } catch (e) { setEstado({ ok: false, t: e.message || String(e) }); }
  }
  const inp = { background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 7, padding: "7px 10px", fontSize: 12, fontFamily: font, outline: "none" };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => { setAbierto(a => !a); setEstado(null); }} title="Mandar un aviso al móvil de los conductores"
        style={{ background: "rgba(91,124,250,0.10)", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
        📣 Aviso al móvil
      </button>
      {abierto && (
        <div style={{ position: "absolute", right: 0, top: 36, zIndex: 50, width: 340, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10, padding: 12, boxShadow: "0 10px 30px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: 8 }}>
          <select value={para} onChange={e => setPara(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="todos">A todos</option>
            {conductores.map(u => <option key={u._id} value={u._id}>{[u.nombre, u.apellidos].filter(Boolean).join(" ") || u.email}</option>)}
          </select>
          <textarea value={texto} onChange={e => setTexto(e.target.value.slice(0, 300))} rows={3} placeholder="Escribe el mensaje…" style={{ ...inp, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={enviar} disabled={!texto.trim() || estado?.cargando} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{estado?.cargando ? "Enviando…" : "Enviar"}</button>
            <span style={{ fontSize: 10.5, color: C.muted }}>Solo llega a quien haya activado los avisos en su móvil.</span>
          </div>
          {estado?.t && <div style={{ fontSize: 11.5, color: estado.ok ? C.green : C.red }}>{estado.t}</div>}
        </div>
      )}
    </div>
  );
}
