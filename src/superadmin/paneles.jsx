// Panel del superadmin · pestañas de una empresa: Uso, Módulos y Eliminar.
import { AlertTriangle, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { C, alfa } from "../tema.js";
import { FUNCIONES, MODULOS, moduloActivo, modulosParaGuardar } from "../modulos.js";
import { haceCuanto, usoDeEmpresa } from "./uso.js";
import { LIMITE_DIARIO, borrarRecorrido, copiaDeEmpresa, recorrerEmpresa } from "./borrar-empresa.js";

const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const titulo = { fontSize: 13, fontWeight: 650, color: C.text, marginBottom: 10 };
const num = n => (n == null ? "—" : new Intl.NumberFormat("es-ES").format(n));

// ── Uso ─────────────────────────────────────────────────────────────────────
export function UsoEmpresa({ org, usuarios }) {
  const [uso, setUso] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vivo = true;
    usoDeEmpresa(org.org_id).then(u => vivo && setUso(u)).catch(() => vivo && setUso(null)).finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [org.org_id, vuelta]);
  const activos = usuarios.filter(u => u.activo !== false);
  const oficina = activos.filter(u => ["admin", "intermedio", "superadmin"].includes(u.rol)).length;
  const cifras = uso ? [
    ["Usuarios activos", `${activos.length} de ${org.max_usuarios ?? "—"}`, `${oficina} oficina · ${activos.length - oficina} conductores`],
    ["Conectados ahora", num(uso.conectados.length), uso.conectados.slice(0, 4).join(", ")],
    ["Última actividad", haceCuanto(uso.ultimaActividad), ""],
    ["Proyectos", num(uso.proyectos), ""],
    ["Vehículos", num(uso.vehiculos), ""],
    ["Trabajadores", num(uso.trabajadores), ""],
    ["Rutas publicadas este mes", num(uso.rutasMes), uso.mes],
    ["Fichajes este mes", num(uso.fichajesMes), ""],
    ["Incidencias abiertas", num(uso.incidenciasAbiertas), ""],
    ["Pedidos (total)", num(uso.pedidos), ""],
    ["Vacaciones pendientes", num(uso.pendientes), ""],
    ["IA conectadas", num(uso.ia), ""],
  ] : [];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="op-btn" onClick={() => { setCargando(true); setVuelta(v => v + 1); }} disabled={cargando}><RefreshCw size={14} /> Actualizar</button>
      </div>
      {cargando && !uso ? <div style={{ display: "flex", justifyContent: "center", padding: 30, color: C.muted }}><Loader2 size={20} className="op-girando" /></div> : !uso ? (
        <div style={{ ...tarjeta, color: C.red, fontSize: 13 }}>No se pudo leer el uso de esta empresa.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
            {cifras.map(([l, v, d]) => (
              <div key={l} style={{ ...tarjeta, marginBottom: 0, padding: 14 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{v}</div>
                {d && <div style={{ fontSize: 11, color: C.dim, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={d}>{d}</div>}
              </div>
            ))}
          </div>
          <div style={tarjeta}>
            <div style={titulo}>Lo último que han hecho</div>
            {!uso.acciones.length && <div style={{ fontSize: 13, color: C.dim }}>Sin actividad registrada.</div>}
            {uso.acciones.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, padding: "6px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                <span style={{ color: C.dim, minWidth: 92, flexShrink: 0 }}>{haceCuanto(a.cuando)}</span>
                <span style={{ color: C.text, minWidth: 0 }}><b>{a.quien}</b> · {a.accion}{a.detalle ? <span style={{ color: C.muted }}> — {a.detalle}</span> : null}{a.modulo ? <span style={{ color: C.dim }}> ({a.modulo})</span> : null}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Módulos ─────────────────────────────────────────────────────────────────
export function ModulosEmpresa({ org, onUpdate }) {
  const [marcados, setMarcados] = useState(() => Object.fromEntries([...MODULOS, ...FUNCIONES].map(m => [m.clave, moduloActivo(org, m.clave)])));
  const [estado, setEstado] = useState(null);
  async function guardar() {
    setEstado("guardando");
    try {
      const modulos = modulosParaGuardar(marcados);
      await updateDoc(doc(db, "orgs", org.org_id), { modulos, updatedAt: serverTimestamp() });
      onUpdate({ ...org, modulos });
      setEstado("ok");
    } catch (e) { setEstado(`No se pudo guardar: ${e.message}`); }
  }
  const lista = (titulo_, items) => (
    <div style={tarjeta}>
      <div style={titulo}>{titulo_}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {items.map(m => (
          <label key={m.clave} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={marcados[m.clave]} onChange={e => { setMarcados(v => ({ ...v, [m.clave]: e.target.checked })); setEstado(null); }} style={{ marginTop: 3 }} />
            <span><span style={{ fontSize: 14, color: C.text, fontWeight: 550 }}>{m.nombre}</span><br /><span style={{ fontSize: 12, color: C.muted }}>{m.detalle}</span></span>
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>Lo que se desmarca desaparece para toda la empresa al momento. No se borra ningún dato: al volver a marcarlo, todo sigue ahí.</p>
      {lista("Módulos de la oficina", MODULOS)}
      {lista("Funciones", FUNCIONES)}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="op-btn op-primario" onClick={guardar} disabled={estado === "guardando"}>{estado === "guardando" ? "Guardando…" : "Guardar módulos"}</button>
        {estado === "ok" && <span role="status" style={{ fontSize: 13, color: C.green }}>Guardado.</span>}
        {estado && !["ok", "guardando"].includes(estado) && <span style={{ fontSize: 13, color: C.red }}>{estado}</span>}
      </div>
    </div>
  );
}

// ── Eliminar ────────────────────────────────────────────────────────────────
export function BorrarEmpresa({ org, sesion, onBorrada }) {
  const [paso, setPaso] = useState("inicio"); // inicio | recorriendo | listo | borrando | hecho
  const [progreso, setProgreso] = useState("");
  const [recorrido, setRecorrido] = useState(null);
  const [copia, setCopia] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState(null);
  const [borrados, setBorrados] = useState(0);
  const propia = sesion?.org_id === org.org_id;
  const suspendida = org.activo === false;

  async function recorrer() {
    setError(null); setPaso("recorriendo"); setCopia(false); setConfirmacion("");
    try {
      const r = await recorrerEmpresa(org.org_id, (que, n) => setProgreso(`Buscando ${que}… (${num(n)} encontrados)`));
      setRecorrido(r); setPaso("listo");
    } catch (e) { setError(`No se pudo recorrer: ${e.message}`); setPaso("inicio"); }
  }
  function descargar() {
    const { nombre, blob } = copiaDeEmpresa(org.org_id, recorrido);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setCopia(true);
  }
  async function borrar() {
    setError(null); setPaso("borrando");
    try {
      const n = await borrarRecorrido(recorrido, (hechos, total) => setProgreso(`Borrando… ${num(hechos)} de ${num(total)}`));
      setBorrados(n); setPaso("hecho");
    } catch (e) { setError(`Se paró a medias: ${e.message}. Vuelve a pulsar «Buscar sus datos» y continúa.`); setPaso("inicio"); }
  }

  if (propia) return <div style={{ ...tarjeta, fontSize: 13, color: C.muted }}>Es tu propia empresa: no se puede eliminar desde aquí.</div>;
  if (!suspendida) return (
    <div style={tarjeta}>
      <div style={titulo}>Primero, suspéndela</div>
      <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>Para eliminar una empresa, antes tiene que estar <b>suspendida</b> (pestaña «Configuración» › Estado › Suspendida). Así nadie de ella la usa mientras se borra, y te da margen por si te arrepientes.</p>
    </div>
  );
  const total = recorrido?.docs.length || 0;
  const porDias = total > LIMITE_DIARIO;
  return (
    <div>
      <div style={{ ...tarjeta, borderColor: `${C.red}66`, background: alfa(0.02) }}>
        <div style={{ ...titulo, display: "flex", gap: 8, alignItems: "center", color: C.red }}><AlertTriangle size={16} /> Eliminar «{org.nombre}» y todos sus datos</div>
        <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>
          Se borra todo: proyectos, rutas, cuadrantes, fichajes, pedidos, documentos, usuarios… y la propia empresa. <b>No se puede deshacer</b>; antes se descarga una copia completa.
        </p>
        {paso === "inicio" && <button className="op-btn" onClick={recorrer}>1. Buscar sus datos</button>}
        {(paso === "recorriendo" || paso === "borrando") && <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.muted }}><Loader2 size={15} className="op-girando" /> {progreso}</div>}
        {error && <div role="alert" style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{error}</div>}
      </div>

      {paso === "listo" && recorrido && (
        <div style={tarjeta}>
          <div style={titulo}>Encontrados {num(total)} documentos ({recorrido.proyectos} proyectos, {recorrido.concursos} concursos)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 16px", fontSize: 12, color: C.muted, marginBottom: 14, maxHeight: 220, overflowY: "auto" }}>
            {Object.entries(recorrido.porColeccion).sort((a, b) => b[1] - a[1]).map(([c, n]) => <div key={c}><span style={{ color: C.text }}>{num(n)}</span> · {c}</div>)}
          </div>
          {porDias && <div style={{ fontSize: 13, color: C.amber, marginBottom: 12, lineHeight: 1.5 }}>Son más de {num(LIMITE_DIARIO)}: hoy se borrarán {num(LIMITE_DIARIO)} (lo que permite el plan gratuito de Firebase al día). Mañana vuelves aquí, «Buscar sus datos» y sigue con el resto.</div>}
          <button className="op-btn" onClick={descargar}><Download size={14} /> 2. Descargar la copia</button>
          {copia && <span style={{ fontSize: 13, color: C.green, marginLeft: 10 }}>Descargada. Guárdala en un sitio seguro.</span>}
          {copia && (
            <div style={{ marginTop: 16 }}>
              <label className="op-label" htmlFor="confirmar-borrado">3. Para confirmar, escribe el identificador de la empresa: <b style={{ color: C.text }}>{org.org_id}</b></label>
              <input id="confirmar-borrado" className="op-input" value={confirmacion} onChange={e => setConfirmacion(e.target.value)} autoComplete="off" style={{ maxWidth: 320 }} />
              <div style={{ marginTop: 12 }}>
                <button className="op-btn" onClick={borrar} disabled={confirmacion.trim() !== org.org_id}
                  style={{ background: confirmacion.trim() === org.org_id ? C.red : undefined, color: confirmacion.trim() === org.org_id ? "#fff" : undefined, borderColor: "transparent" }}>
                  <Trash2 size={14} /> Eliminar definitivamente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {paso === "hecho" && (
        <div style={tarjeta}>
          {borrados >= total
            ? <div role="status" style={{ ...titulo, color: C.green }}>Empresa eliminada: {num(borrados)} documentos borrados.</div>
            : <div role="status" style={{ ...titulo, color: C.amber }}>Borrados {num(borrados)} de {num(total)}. Mañana vuelve aquí y continúa con el resto.</div>}
          {recorrido.correos.length > 0 && (
            <>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, margin: "8px 0" }}>
                Falta borrar sus <b>cuentas de acceso</b> (ya no pueden entrar: no tienen perfil). Se hace en Firebase › Authentication, buscando estos correos:
              </p>
              <textarea readOnly value={recorrido.correos.join("\n")} rows={Math.min(8, recorrido.correos.length)} className="op-input" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
            </>
          )}
          {borrados >= total && <button className="op-btn" style={{ marginTop: 12 }} onClick={() => onBorrada?.()}>Volver a la lista</button>}
        </div>
      )}
    </div>
  );
}
