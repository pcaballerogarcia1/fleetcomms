// Control → «GPS de la flota»: elegir el GPS de la empresa, poner sus claves,
// probar la conexión y emparejar sus vehículos con los de la flota.
import { useMemo, useState } from "react";
import { Check, Loader2, Satellite, TriangleAlert } from "lucide-react";
import { C, font } from "../tema.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { logAudit } from "../audit.js";
import { CAMPOS_GENERICO, PROVEEDORES_GPS, RUTAS_GENERICO, emparejarGps, guardarConexionGps, pedirPosicionesGps, proveedorGps } from "./proveedores.js";

export function VentanaGps({ orgId, conexion, flota, puedeEditar, onCerrar }) {
  const [proveedor, setProveedor] = useState(conexion?.proveedor || "");
  const [cred, setCred] = useState(conexion?.cred || {});
  const [enlaces, setEnlaces] = useState(conexion?.enlaces || {});
  const [prueba, setPrueba] = useState(null); // { cargando } | { vehiculos } | { error }
  const [guardando, setGuardando] = useState(false);
  const p = proveedorGps(proveedor);
  const campos = p ? (p.generico ? CAMPOS_GENERICO : p.campos) : [];
  const pares = useMemo(() => emparejarGps(prueba?.vehiculos || [], flota, enlaces), [prueba, flota, enlaces]);

  const poner = (k, v) => setCred(c => ({ ...c, [k]: v }));
  const ponerRuta = (k, v) => setCred(c => ({ ...c, campos: { ...(c.campos || {}), [k]: v } }));
  async function probar() {
    setPrueba({ cargando: true });
    try { setPrueba({ vehiculos: await pedirPosicionesGps({ proveedor, cred }) }); } catch (e) { setPrueba({ error: e.message }); }
  }
  async function guardar(activa) {
    setGuardando(true);
    try {
      await guardarConexionGps(orgId, { proveedor, cred, enlaces, activa });
      logAudit({ modulo: "Control", accion: activa ? "Conectó el GPS de la flota" : "Desconectó el GPS de la flota", detalle: p?.nombre || "", projectId: null });
      onCerrar();
    } catch (e) { setPrueba({ error: `No se pudo guardar: ${e.message}` }); } finally { setGuardando(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onCerrar}>
      <div role="dialog" aria-label="GPS de la flota" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "22px 24px 20px", width: 720, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: C.text }}><Satellite size={16} />GPS de la flota</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Si los vehículos ya llevan un localizador, Control enseña su posición en el mapa (se pide cada minuto mientras está abierto; no se guarda).
        </div>

        {!puedeEditar && <div style={{ fontSize: 12, color: C.amber, marginBottom: 12 }}>Solo un administrador puede cambiar la conexión.</div>}

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted, marginBottom: 12 }}>
          GPS de la empresa
          <select className="op-input" value={proveedor} disabled={!puedeEditar} onChange={e => { setProveedor(e.target.value); setPrueba(null); }} aria-label="GPS de la empresa" style={{ height: 32 }}>
            <option value="">— Elegir —</option>
            {PROVEEDORES_GPS.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </label>
        {p && <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{p.ayuda}</div>}

        {p && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {campos.map(([k, l, secreto]) => (
              <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted, gridColumn: k === "url" || k === "cabecera" ? "1 / -1" : undefined }}>
                {l}
                <input className="op-input" type={secreto ? "password" : "text"} autoComplete="off" value={cred[k] || ""} disabled={!puedeEditar} onChange={e => poner(k, e.target.value)} aria-label={l} style={{ height: 32 }} />
              </label>
            ))}
            {p.generico && RUTAS_GENERICO.map(([k, l]) => (
              <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
                Campo: {l}
                <input className="op-input" value={cred.campos?.[k] || ""} placeholder={k} disabled={!puedeEditar} onChange={e => ponerRuta(k, e.target.value)} aria-label={`Campo ${l}`} style={{ height: 32 }} />
              </label>
            ))}
          </div>
        )}

        {p && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <button className="op-btn" onClick={probar} disabled={prueba?.cargando}>{prueba?.cargando ? <Loader2 size={14} className="op-girando" /> : null}Probar conexión</button>
            {prueba?.vehiculos && <span style={{ fontSize: 12, color: C.green, display: "inline-flex", gap: 5, alignItems: "center" }}><Check size={14} />Conectado: {prueba.vehiculos.length} vehículos con posición</span>}
            {prueba?.error && <span style={{ fontSize: 12, color: C.red, display: "inline-flex", gap: 5, alignItems: "center" }}><TriangleAlert size={14} />{prueba.error}</span>}
          </div>
        )}

        {prueba?.vehiculos?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>Cada vehículo del GPS con el de la flota</div>
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Se emparejan solos por matrícula o nombre; cambia los que no acierte.</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 260, overflowY: "auto" }}>
              {prueba.vehiculos.map(g => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ flex: 1, fontSize: 12, color: C.text }}>{g.nombre}{g.matricula ? <span style={{ color: C.dim }}> · {g.matricula}</span> : null}</span>
                  <select className="op-input" value={enlaces[g.id] ?? pares.get(g.id)?._id ?? ""} disabled={!puedeEditar} aria-label={`Vehículo de la flota para ${g.nombre}`}
                    onChange={e => setEnlaces(x => ({ ...x, [g.id]: e.target.value }))} style={{ width: 220, height: 28 }}>
                    <option value="">— Ninguno —</option>
                    {flota.map(v => <option key={v._id} value={v._id}>{v.nombre || v.matricula}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {conexion?.activa && puedeEditar && <button className="op-btn" onClick={() => guardar(false)} disabled={guardando}>Desconectar</button>}
          {puedeEditar && <button className="op-btn op-primario" onClick={() => guardar(true)} disabled={!p || guardando || !prueba?.vehiculos}
            title={!prueba?.vehiculos ? "Primero prueba la conexión" : undefined}>Guardar y conectar</button>}
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>
          Las claves solo las ve la oficina de la empresa. Webfleet, Geotab y Samsara están preparados según su documentación; al conectar el primer cliente de cada uno lo revisamos con su cuenta.
        </div>
      </div>
    </div>
  );
}
