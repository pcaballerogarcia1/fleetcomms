// «Conectar con IA» en el menú de la foto (oficina). El admin decide si la
// empresa lo usa, si la IA solo consulta o también hace cambios y qué tipos
// de usuario pueden. Todos ven la dirección para pegar en su IA y sus
// conexiones (el admin, las de toda la empresa) y pueden desconectarlas.
import { Copy, Check, Loader2, Sparkles, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { C, alfa } from "../tema.js";
import { PASOS_IA, ROLES, ROLES_POR_DEFECTO, cuando, motivoSinAcceso, nivelDe } from "./datos.js";

const esAdmin = s => s?.rol === "admin" || s?.rol === "superadmin";
const titulo = { fontSize: 13, fontWeight: 650, color: C.text, margin: "0 0 8px" };
const seccion = { padding: "16px 20px", borderTop: `1px solid ${C.border}` };

function useAjustes(org) {
  const [a, setA] = useState(undefined);
  useEffect(() => {
    if (!org) return undefined;
    return onSnapshot(doc(db, "ia_ajustes", org), d => setA(d.exists() ? d.data() : null), () => setA(null));
  }, [org]);
  return a;
}

function useConexiones(sesion) {
  const [l, setL] = useState([]);
  useEffect(() => {
    if (!sesion?.org_id) return undefined;
    const q = esAdmin(sesion)
      ? query(collection(db, "ia_conexiones"), where("org_id", "==", sesion.org_id))
      : query(collection(db, "ia_conexiones"), where("uid", "==", sesion.uid));
    return onSnapshot(q, s => setL(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.activa - a.activa) || String(b.ultimoUso || "").localeCompare(String(a.ultimoUso || "")))), () => setL([]));
  }, [sesion?.org_id, sesion?.uid, sesion?.rol]); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

function Ajustes({ sesion, ajustes }) {
  const [f, setF] = useState(() => ({ activa: !!ajustes?.activa, nivel: nivelDe(ajustes), roles: ajustes?.roles || ROLES_POR_DEFECTO, ubicacion: ajustes?.ubicacion === true }));
  const [estado, setEstado] = useState(null);
  const cambiar = x => { setF(v => ({ ...v, ...x })); setEstado(null); };
  async function guardar() {
    setEstado("guardando");
    try {
      await setDoc(doc(db, "ia_ajustes", sesion.org_id), { org_id: sesion.org_id, ...f, cambiadoPor: sesion.uid, cambiadoEn: new Date().toISOString() });
      setEstado("ok");
    } catch (e) { setEstado(`No se pudo guardar: ${e.message}`); }
  }
  const opcion = { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, color: C.text, cursor: "pointer", lineHeight: 1.4 };
  return (
    <div style={seccion}>
      <div style={titulo}>Tu empresa</div>
      <label style={{ ...opcion, marginBottom: 12, fontWeight: 600 }}>
        <input type="checkbox" checked={f.activa} onChange={e => cambiar({ activa: e.target.checked })} /> Permitir conectar la IA con Operanzia
      </label>
      <div style={{ opacity: f.activa ? 1 : 0.5, pointerEvents: f.activa ? "auto" : "none", display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Qué puede hacer la IA</div>
          <label style={opcion}><input type="radio" name="ia-nivel" checked={f.nivel === "leer"} onChange={() => cambiar({ nivel: "leer" })} /> Solo consultar</label>
          <label style={{ ...opcion, marginTop: 4 }}><input type="radio" name="ia-nivel" checked={f.nivel === "actuar"} onChange={() => cambiar({ nivel: "actuar" })} /> Consultar y hacer cambios (pasar los no entregados a otro día)</label>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Ubicación</div>
          <label style={opcion}>
            <input type="checkbox" checked={f.ubicacion} onChange={e => cambiar({ ubicacion: e.target.checked })} />
            <span>Permitir preguntar dónde está cada conductor y vehículo<br /><span style={{ fontSize: 12, color: C.muted }}>Solo la oficina y solo en jornada. Avisa a la plantilla de que su ubicación en jornada se puede consultar así.</span></span>
          </label>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Quién puede conectarla</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            {ROLES.map(([r, nombre]) => (
              <label key={r} style={opcion}>
                <input type="checkbox" checked={f.roles.includes(r)} onChange={e => cambiar({ roles: e.target.checked ? [...f.roles, r] : f.roles.filter(x => x !== r) })} /> {nombre}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button className="op-btn op-primario" onClick={guardar} disabled={estado === "guardando"}>{estado === "guardando" ? <><Loader2 size={14} className="op-girando" /> Guardando…</> : "Guardar"}</button>
        {estado === "ok" && <span role="status" style={{ fontSize: 13, color: C.green }}>Guardado. Vale al momento, también para las IA ya conectadas.</span>}
        {estado && estado !== "ok" && estado !== "guardando" && <span style={{ fontSize: 13, color: C.red }}>{estado}</span>}
      </div>
    </div>
  );
}

function Direccion() {
  const url = `${window.location.origin}/mcp`;
  const [copiada, setCopiada] = useState(false);
  const copiar = () => navigator.clipboard?.writeText(url).then(() => { setCopiada(true); setTimeout(() => setCopiada(false), 2000); }).catch(() => {});
  return (
    <div style={seccion}>
      <div style={titulo}>Dirección para pegar en tu IA</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="op-input" readOnly value={url} onFocus={e => e.target.select()} aria-label="Dirección MCP de Operanzia" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
        <button className="op-btn" onClick={copiar} title="Copiar">{copiada ? <><Check size={14} /> Copiada</> : <><Copy size={14} /> Copiar</>}</button>
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: C.muted, lineHeight: 1.45 }}>
        {PASOS_IA.map(([ia, pasos]) => <li key={ia}><b style={{ color: C.text }}>{ia}:</b> {pasos}</li>)}
      </ul>
      <p style={{ margin: "10px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.45 }}>Al conectar, se abre Operanzia: entras con tu cuenta y pulsas «Permitir». La IA verá solo lo que tú ves.</p>
    </div>
  );
}

function Conexiones({ sesion, lista }) {
  const [ocupada, setOcupada] = useState(null);
  async function desconectar(c) {
    if (!window.confirm(`¿Desconectar ${c.cliente || "esta IA"}${c.uid !== sesion.uid ? ` de ${c.nombre || "este usuario"}` : ""}? Dejará de poder consultar Operanzia al momento.`)) return;
    setOcupada(c.id);
    try { await updateDoc(doc(db, "ia_conexiones", c.id), { activa: false, desconectadaEn: new Date().toISOString(), desconectadaPor: sesion.uid }); }
    catch (e) { window.alert(`No se pudo desconectar: ${e.message}`); }
    setOcupada(null);
  }
  return (
    <div style={seccion}>
      <div style={titulo}>{esAdmin(sesion) ? "IA conectadas en tu empresa" : "Tus IA conectadas"}</div>
      {!lista.length && <div style={{ fontSize: 13, color: C.dim }}>Ninguna todavía.</div>}
      <div style={{ display: "grid", gap: 6 }}>
        {lista.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: alfa(0.03), border: `1px solid ${C.border}`, opacity: c.activa ? 1 : 0.55 }}>
            <Sparkles size={15} color={c.activa ? C.blue : C.dim} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <b>{c.cliente || "IA"}</b>{esAdmin(sesion) && c.nombre ? ` · ${c.nombre}` : ""}
              </div>
              <div style={{ fontSize: 12, color: C.dim }}>
                {c.activa ? `Último uso: ${cuando(c.ultimoUso)} · ${c.nivel === "actuar" ? "consulta y cambia" : "solo consulta"}` : `Desconectada ${cuando(c.desconectadaEn)}`}
              </div>
            </div>
            {c.activa && (esAdmin(sesion) || c.uid === sesion.uid) && (
              <button className="op-btn op-btn-peligro" onClick={() => desconectar(c)} disabled={ocupada === c.id}><Unplug size={14} /> Desconectar</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelConectarIA({ sesion, onCerrar }) {
  const ajustes = useAjustes(sesion?.org_id);
  const conexiones = useConexiones(sesion);
  const motivo = ajustes === undefined ? null : motivoSinAcceso(sesion, ajustes);
  useEffect(() => {
    const esc = e => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);
  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px 16px", overflowY: "auto" }}>
      <div role="dialog" aria-modal="true" aria-label="Conectar con IA" onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px" }}>
          <Sparkles size={18} color={C.blue} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 650, color: C.text }}>Conectar con IA</div>
            <div style={{ fontSize: 13, color: C.muted }}>Pregunta a ChatGPT, Claude, Gemini, Copilot o Grok por tus rutas, entregas y pedidos.</div>
          </div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        {ajustes === undefined ? <div style={{ ...seccion, display: "flex", justifyContent: "center" }}><Loader2 size={18} className="op-girando" color={C.muted} /></div> : (
          <>
            {esAdmin(sesion) && <Ajustes sesion={sesion} ajustes={ajustes} />}
            {motivo
              ? <div style={{ ...seccion, fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{motivo}</div>
              : <Direccion />}
            <Conexiones sesion={sesion} lista={conexiones} />
          </>
        )}
      </div>
    </div>
  );
}
