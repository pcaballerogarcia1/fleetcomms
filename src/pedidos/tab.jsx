// Planificación → Pedidos (reparto): la bandeja de pedidos de cada día.
// Se apuntan en segundos (el cliente se busca por su nombre en la lista
// importada; uno nuevo, por su dirección), se pegan desde Excel, y los fijos
// («cada lunes, 2 cajas al Bar Pepe») salen solos los días que tocan.
import { ChevronLeft, ChevronRight, ClipboardPaste, Plus, Repeat, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, font } from "../tema.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { geocodificar } from "../concursos/geocodificar.js";
import { DIAS, buscarClientes, clientesDe, fechaLarga, leerPegado, masDias, nuevoFijo, nuevoPedido, resumenDia, ymd } from "./datos.js";
import { anadirClienteNuevo, anularPedido, borrarFijo, borrarPedido, crearPedido, crearPedidos, crearPedidosDeFijos, escucharFijos, escucharPedidos, guardarFijo } from "./store.js";

const NUM = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const th = { textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 500, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "7px 8px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" };
const caja = { border: `1px solid ${C.border}`, borderRadius: 10, background: C.card, padding: "12px 14px", marginBottom: 12 };
const entrada = (ancho, extra = {}) => ({ className: "op-input", style: { height: 32, width: ancho, ...extra } });

/** Busca un cliente en la lista mientras se escribe; si no está, es uno nuevo */
function BuscadorCliente({ clientes, valor, onCambio, etiqueta = "Cliente" }) {
  const [abierto, setAbierto] = useState(false);
  const opciones = useMemo(() => (valor.cliente ? [] : buscarClientes(clientes, valor.texto)), [clientes, valor]);
  return (
    <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
      <input {...entrada("100%")} aria-label={etiqueta} placeholder="Escribe el nombre o la dirección" value={valor.cliente ? valor.cliente.nombre : valor.texto}
        onChange={e => { onCambio({ texto: e.target.value, cliente: null }); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)} />
      {valor.cliente && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{valor.cliente.direccion}</div>}
      {abierto && opciones.length > 0 && (
        <div role="listbox" style={{ position: "absolute", top: 34, left: 0, right: 0, zIndex: 30, background: C.card, border: `1px solid ${C.border2 || C.border}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,.35)", maxHeight: 260, overflowY: "auto" }}>
          {opciones.map(c => (
            <div key={c.clave} role="option" aria-selected="false" onMouseDown={() => { onCambio({ texto: c.nombre, cliente: c }); setAbierto(false); }}
              style={{ padding: "7px 10px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, color: C.text }}>{c.nombre}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{c.direccion}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sitúa la dirección de un cliente nuevo; null si no se encuentra */
async function situar(texto) {
  const r = await geocodificar([texto], { maxKm: 100000 });
  return r.porDireccion.get(texto) || null;
}

const VACIO = { cliente: { texto: "", cliente: null }, direccion: "", ref: "", bultos: "", kg: "", desde: "", hasta: "", notas: "", guardarCliente: true };

/** El formulario para apuntar un pedido */
function FormPedido({ clientes, onAnadir }) {
  const [f, setF] = useState(VACIO);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const primero = useRef(null);
  const nuevo = !f.cliente.cliente && f.cliente.texto.trim().length > 0;
  const poner = cambio => { setF(x => ({ ...x, ...cambio })); setAviso(""); };

  async function anadir(e) {
    e.preventDefault();
    if (!f.cliente.cliente && !f.cliente.texto.trim()) { setAviso("Escribe el cliente"); return; }
    setOcupado(true);
    try {
      let cliente = f.cliente.cliente, esNuevo = false;
      if (!cliente) {
        if (!f.direccion.trim()) { setAviso("Es un cliente nuevo: escribe su dirección con el municipio (Calle Mayor 12, Salamanca)"); return; }
        const r = await situar(f.direccion.trim());
        if (!r) { setAviso("No encuentro esa dirección. Revisa la calle, el número y el municipio."); return; }
        cliente = { nombre: f.cliente.texto.trim(), direccion: f.direccion.trim(), lat: r.lat, lng: r.lng };
        esNuevo = true;
      }
      await onAnadir({ cliente, esNuevo: esNuevo && f.guardarCliente, ref: f.ref, bultos: f.bultos, kg: f.kg, desde: f.desde, hasta: f.hasta, notas: f.notas });
      setF(VACIO);
      primero.current?.querySelector("input")?.focus();
    } catch (err) { setAviso(`No se pudo guardar: ${err.message || err}`); }
    finally { setOcupado(false); }
  }

  return (
    <form onSubmit={anadir} style={caja}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nuevo pedido</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div ref={primero} style={{ display: "contents" }}><BuscadorCliente clientes={clientes} valor={f.cliente} onCambio={v => poner({ cliente: v })} /></div>
        <input {...entrada(90)} aria-label="Nº de pedido" placeholder="Nº pedido" value={f.ref} onChange={e => poner({ ref: e.target.value })} />
        <input {...entrada(70)} aria-label="Bultos" placeholder="Bultos" inputMode="decimal" value={f.bultos} onChange={e => poner({ bultos: e.target.value })} />
        <input {...entrada(70)} aria-label="Kg" placeholder="Kg" inputMode="decimal" value={f.kg} onChange={e => poner({ kg: e.target.value })} />
        <input {...entrada(70)} aria-label="Desde" placeholder="Desde" value={f.desde} onChange={e => poner({ desde: e.target.value })} />
        <input {...entrada(70)} aria-label="Hasta" placeholder="Hasta" value={f.hasta} onChange={e => poner({ hasta: e.target.value })} />
        <input {...entrada(180)} aria-label="Notas" placeholder="Notas para el conductor" value={f.notas} onChange={e => poner({ notas: e.target.value })} />
        <button type="submit" className="op-btn op-primario" disabled={ocupado} style={{ height: 32 }}><Plus size={14} />{ocupado ? "Guardando…" : "Añadir"}</button>
      </div>
      {nuevo && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: C.amber }}>Cliente nuevo:</span>
          <input {...entrada(320)} aria-label="Dirección del cliente nuevo" placeholder="Calle Mayor 12, Salamanca" value={f.direccion} onChange={e => poner({ direccion: e.target.value })} />
          <label style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={f.guardarCliente} onChange={e => poner({ guardarCliente: e.target.checked })} /> Guardarlo en la lista de clientes
          </label>
        </div>
      )}
      {aviso && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{aviso}</div>}
    </form>
  );
}

/** Pegar una tabla de pedidos desde Excel */
function VentanaPegar({ clientes, onAnadir, onCerrar }) {
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState(null); // con { situado } ya resuelto
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function revisar() {
    const r = leerPegado(texto, clientes);
    if (r.error) { setError(r.error); return; }
    setOcupado(true); setError("");
    try {
      const textos = new Set(r.filas.filter(f => !f.cliente && f.texto).map(f => f.texto));
      const g = textos.size ? await geocodificar(textos, { maxKm: 150 }) : { porDireccion: new Map() };
      setFilas(r.filas.map(f => {
        if (f.cliente) return { ...f, estado: "conocido" };
        const s = f.texto ? g.porDireccion.get(f.texto) : null;
        return s ? { ...f, estado: "situado", cliente: { nombre: f.nombre || f.texto, direccion: f.texto, lat: s.lat, lng: s.lng, telefono: f.telefono, contacto: f.contacto } } : { ...f, estado: "no" };
      }));
    } catch (e) { setError(`No se pudo buscar las direcciones: ${e.message}`); }
    finally { setOcupado(false); }
  }
  const validas = (filas || []).filter(f => f.estado !== "no");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div role="dialog" aria-label="Pegar pedidos desde Excel" style={{ background: C.card, borderRadius: 12, padding: "18px 20px", width: 760, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto", border: `1px solid ${C.border}`, fontFamily: font, color: C.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><ClipboardPaste size={16} />Pegar pedidos desde Excel</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        {!filas && <>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Copia en Excel la tabla con su fila de títulos y pégala aquí. Con <b>Cliente</b> basta si ya está en la lista; si es nuevo, también <b>Dirección</b> y <b>Población</b>.
            El resto (Pedido, Bultos, Kg, Desde, Hasta, Notas) es opcional.
          </div>
          <textarea aria-label="Tabla pegada" value={texto} onChange={e => setTexto(e.target.value)} rows={10} className="op-input" style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, padding: 8, height: "auto" }} placeholder={"Cliente\tPedido\tBultos\tKg\nBar El Puente\tP-1001\t3\t45"} />
          {error && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button className="op-btn" onClick={onCerrar}>Cancelar</button>
            <button className="op-btn op-primario" onClick={revisar} disabled={!texto.trim() || ocupado}>{ocupado ? "Buscando direcciones…" : "Revisar"}</button>
          </div>
        </>}
        {filas && <>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
            <thead><tr>{["Cliente", "Dirección", "Pedido", "Bultos", "Kg", "Franja", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{filas.map((f, i) => (
              <tr key={i}>
                <td style={td}>{f.cliente?.nombre || f.nombre || "—"}</td>
                <td style={{ ...td, color: C.muted }}>{f.cliente?.direccion || f.texto || "—"}</td>
                <td style={td}>{f.ref}</td><td style={td}>{f.bultos}</td><td style={td}>{f.kg}</td>
                <td style={td}>{f.desde}{f.hasta ? `–${f.hasta}` : ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap", color: f.estado === "no" ? C.red : f.estado === "situado" ? C.amber : C.green }}>
                  {f.estado === "conocido" ? "Cliente de la lista" : f.estado === "situado" ? "Nuevo: situado" : "No se encuentra"}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {filas.some(f => f.estado === "no") && <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Las que no se encuentran no se añaden: corrige su dirección y pégalas otra vez.</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="op-btn" onClick={() => setFilas(null)}>Volver</button>
            <button className="op-btn op-primario" disabled={!validas.length || ocupado}
              onClick={async () => { setOcupado(true); try { await onAnadir(validas); onCerrar(); } catch (e) { setError(e.message); setOcupado(false); } }}>
              Añadir {validas.length} {validas.length === 1 ? "pedido" : "pedidos"}
            </button>
          </div>
          {error && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 6 }}>{error}</div>}
        </>}
      </div>
    </div>
  );
}

/** Los pedidos fijos del proyecto: ver, añadir, pausar y quitar */
function VentanaFijos({ fijos, clientes, onGuardar, onBorrar, onCerrar }) {
  const [cli, setCli] = useState({ texto: "", cliente: null });
  const [dias, setDias] = useState([]);
  const [f, setF] = useState({ ref: "", bultos: "", kg: "", desde: "", hasta: "", notas: "" });
  const [aviso, setAviso] = useState("");
  const dSem = d => DIAS.filter(([n]) => d.includes(n)).map(x => x[1]).join(" ");

  async function anadir() {
    if (!cli.cliente) { setAviso("Elige el cliente de la lista (si es nuevo, haz antes un pedido suelto para él)"); return; }
    if (!dias.length) { setAviso("Elige qué días de la semana"); return; }
    await onGuardar({ cliente: cli.cliente, dias: [...dias].sort(), ...f });
    setCli({ texto: "", cliente: null }); setDias([]); setF({ ref: "", bultos: "", kg: "", desde: "", hasta: "", notas: "" }); setAviso("");
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div role="dialog" aria-label="Pedidos fijos" style={{ background: C.card, borderRadius: 12, padding: "18px 20px", width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto", border: `1px solid ${C.border}`, fontFamily: font, color: C.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Repeat size={16} />Pedidos fijos</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Salen solos en la bandeja los días que tocan. Si un día no hace falta, se anula ese día y los demás siguen.</div>
        <div style={{ ...caja, background: "transparent" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <BuscadorCliente clientes={clientes} valor={cli} onCambio={setCli} etiqueta="Cliente del pedido fijo" />
            <div role="group" aria-label="Días de la semana" style={{ display: "flex", gap: 3 }}>
              {DIAS.map(([n, letra, nombre]) => (
                <button key={n} type="button" title={nombre} aria-pressed={dias.includes(n)} aria-label={nombre}
                  onClick={() => setDias(d => (d.includes(n) ? d.filter(x => x !== n) : [...d, n]))}
                  style={{ width: 30, height: 32, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, border: `1px solid ${dias.includes(n) ? C.blue : C.border}`, background: dias.includes(n) ? C.blueDim : "transparent", color: dias.includes(n) ? C.blueText : C.muted }}>{letra}</button>
              ))}
            </div>
            <input {...entrada(70)} aria-label="Bultos del fijo" placeholder="Bultos" value={f.bultos} onChange={e => setF({ ...f, bultos: e.target.value })} />
            <input {...entrada(70)} aria-label="Kg del fijo" placeholder="Kg" value={f.kg} onChange={e => setF({ ...f, kg: e.target.value })} />
            <input {...entrada(70)} aria-label="Desde (fijo)" placeholder="Desde" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} />
            <input {...entrada(70)} aria-label="Hasta (fijo)" placeholder="Hasta" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} />
            <input {...entrada(160)} aria-label="Notas del fijo" placeholder="Notas" value={f.notas} onChange={e => setF({ ...f, notas: e.target.value })} />
            <button className="op-btn op-primario" onClick={anadir} style={{ height: 32 }}><Plus size={14} />Añadir fijo</button>
          </div>
          {aviso && <div role="alert" style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{aviso}</div>}
        </div>
        {fijos.length === 0 ? <div style={{ fontSize: 12, color: C.dim, padding: "10px 0" }}>Todavía no hay pedidos fijos.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Cliente", "Días", "Bultos", "Kg", "Franja", "Notas", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{fijos.map(x => (
              <tr key={x.id} style={{ opacity: x.activo === false ? 0.5 : 1 }}>
                <td style={td}>{x.cliente?.nombre}<div style={{ fontSize: 11, color: C.muted }}>{x.cliente?.direccion}</div></td>
                <td style={td}>{dSem(x.dias || [])}</td><td style={td}>{x.bultos ?? ""}</td><td style={td}>{x.kg ?? ""}</td>
                <td style={td}>{x.desde}{x.hasta && x.hasta !== x.desde ? `–${x.hasta}` : ""}</td><td style={{ ...td, color: C.muted }}>{x.notas}</td>
                <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="op-btn" style={{ height: 26, fontSize: 11 }} onClick={() => onGuardar({ id: x.id, activo: x.activo === false })}>{x.activo === false ? "Reanudar" : "Pausar"}</button>{" "}
                  <button className="op-btn" style={{ height: 26, fontSize: 11 }} aria-label={`Quitar el fijo de ${x.cliente?.nombre}`} onClick={() => onBorrar(x.id)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TabPedidos({ layers, activeProject, orgId, sesion }) {
  const projectId = activeProject?._id;
  const [fecha, setFecha] = useState(() => masDias(ymd(), 1)); // por defecto, mañana
  const [leidos, setLeidos] = useState({ fecha: null, lista: null }); // los de la fecha que se escucha
  const pedidos = leidos.fecha === fecha ? leidos.lista : null; // al cambiar de día, «cargando» hasta que llegan
  const [fijos, setFijos] = useState([]);
  const [error, setError] = useState("");
  const [verPegar, setVerPegar] = useState(false);
  const [verFijos, setVerFijos] = useState(false);
  const clientes = useMemo(() => clientesDe(layers), [layers]);

  useEffect(() => {
    if (!orgId || !projectId) return;
    return escucharPedidos(orgId, projectId, fecha, lista => setLeidos({ fecha, lista }), e => setError(`No se pudieron leer los pedidos (${e.code || e.message})`));
  }, [orgId, projectId, fecha]);
  useEffect(() => (orgId && projectId ? escucharFijos(orgId, projectId, setFijos, e => setError(`No se pudieron leer los fijos (${e.code || e.message})`)) : undefined), [orgId, projectId]);
  // los fijos de ese día salen solos (desde hoy en adelante: los días pasados no se tocan)
  useEffect(() => {
    if (!pedidos || !fijos.length || fecha < ymd()) return;
    crearPedidosDeFijos(fijos, fecha, pedidos, sesion).catch(e => setError(`No se pudieron crear los pedidos fijos (${e.code || e.message})`));
  }, [pedidos, fijos, fecha, sesion]);

  const base = { orgId, projectId, fecha };
  async function anadir({ cliente, esNuevo, ...resto }) {
    await crearPedido(nuevoPedido({ ...base, cliente, ...resto }), sesion);
    if (esNuevo) await anadirClienteNuevo(projectId, orgId, cliente, {}).catch(e => setError(`El pedido se ha guardado, pero el cliente no se pudo añadir a la lista (${e.code || e.message})`));
  }
  const anadirPegados = filas => crearPedidos(filas.map(f => nuevoPedido({ ...base, cliente: f.cliente, ref: f.ref, bultos: f.bultos, kg: f.kg, desde: f.desde, hasta: f.hasta, duracion: f.duracion, notas: f.notas, origen: "excel" })), sesion);
  const guardarUnFijo = x => guardarFijo(x.id ? x : nuevoFijo({ orgId, projectId, ...x }), sesion);

  const r = resumenDia(pedidos || []);
  const hoy = ymd();
  const botonDia = (txt, f) => <button className="op-btn" onClick={() => setFecha(f)} style={{ height: 30, fontWeight: fecha === f ? 600 : 400, borderColor: fecha === f ? C.blue : undefined }}>{txt}</button>;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", fontFamily: font, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="op-btn" aria-label="Día anterior" onClick={() => setFecha(masDias(fecha, -1))} style={{ height: 30, width: 30, padding: 0 }}><ChevronLeft size={15} /></button>
        <input type="date" className="op-input" aria-label="Fecha de los pedidos" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} style={{ height: 30, width: 150, flex: "0 0 auto" }} />
        <button className="op-btn" aria-label="Día siguiente" onClick={() => setFecha(masDias(fecha, 1))} style={{ height: 30, width: 30, padding: 0 }}><ChevronRight size={15} /></button>
        {botonDia("Hoy", hoy)}{botonDia("Mañana", masDias(hoy, 1))}
        <div style={{ fontSize: 15, fontWeight: 600, marginLeft: 8 }}>{fechaLarga(fecha).replace(/^./, c => c.toUpperCase())}</div>
        <div style={{ flex: 1 }} />
        <button className="op-btn" onClick={() => setVerPegar(true)} style={{ height: 30 }}><ClipboardPaste size={14} />Pegar desde Excel</button>
        <button className="op-btn" onClick={() => setVerFijos(true)} style={{ height: 30 }}><Repeat size={14} />Pedidos fijos ({fijos.length})</button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[["Pedidos", r.pedidos], ["Bultos", NUM.format(r.bultos)], ["Kg", NUM.format(r.kg)], ["De pedidos fijos", r.fijos]].map(([t, v]) => (
          <div key={t} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 14px", minWidth: 110, background: C.card }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{t}</div>
          </div>
        ))}
      </div>
      {clientes.length === 0 && <div style={{ fontSize: 12, color: C.amber, marginBottom: 10 }}>Todavía no hay lista de clientes: súbela en Mapa → Cargar capa (con dirección basta). Mientras, cada pedido se puede apuntar con su dirección.</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</div>}

      <FormPedido clientes={clientes} onAnadir={anadir} />

      <div style={caja}>
        {pedidos == null ? <div style={{ fontSize: 12, color: C.muted }}>Cargando…</div> : pedidos.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>No hay pedidos para este día.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Cliente", "Pedido", "Bultos", "Kg", "Franja", "Notas", "", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{pedidos.map(p => {
              const anulado = p.estado === "anulado";
              return (
                <tr key={p.id} style={{ opacity: anulado ? 0.45 : 1 }}>
                  <td style={td}><div style={{ textDecoration: anulado ? "line-through" : "none" }}>{p.cliente?.nombre}</div><div style={{ fontSize: 11, color: C.muted }}>{p.cliente?.direccion}</div></td>
                  <td style={td}>{p.ref}</td><td style={td}>{p.bultos ?? ""}</td><td style={td}>{p.kg ?? ""}</td>
                  <td style={td}>{p.desde}{p.hasta && p.hasta !== p.desde ? `–${p.hasta}` : ""}</td>
                  <td style={{ ...td, color: C.muted }}>{p.notas}</td>
                  <td style={td}>{p.origen === "fijo" && <span style={{ fontSize: 10, color: C.violet, border: `1px solid ${C.violet}55`, borderRadius: 8, padding: "1px 6px" }}>fijo</span>}
                    {p.origen === "excel" && <span style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "1px 6px" }}>Excel</span>}
                    {anulado && <span style={{ fontSize: 10, color: C.red, marginLeft: 4 }}>anulado</span>}
                    {p.ruta && !anulado && <span title="Publicado en esta ruta" style={{ fontSize: 10, color: C.green, border: `1px solid ${C.green}55`, borderRadius: 8, padding: "1px 6px", marginLeft: 4, whiteSpace: "nowrap" }}>en ruta · {p.ruta}</span>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {anulado
                      ? <button className="op-btn" style={{ height: 26, fontSize: 11 }} onClick={() => anularPedido(p.id, false)}><RotateCcw size={12} />Recuperar</button>
                      : <button className="op-btn" style={{ height: 26, fontSize: 11 }} aria-label={`Anular el pedido de ${p.cliente?.nombre}`} onClick={() => anularPedido(p.id)}><XCircle size={12} />Anular</button>}
                    {p.origen !== "fijo" && <>{" "}<button className="op-btn" style={{ height: 26, fontSize: 11 }} aria-label={`Borrar el pedido de ${p.cliente?.nombre}`} onClick={() => borrarPedido(p.id)}><Trash2 size={12} /></button></>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      {verPegar && <VentanaPegar clientes={clientes} onAnadir={anadirPegados} onCerrar={() => setVerPegar(false)} />}
      {verFijos && <VentanaFijos fijos={fijos} clientes={clientes} onGuardar={x => guardarUnFijo(x)} onBorrar={id => borrarFijo(id)} onCerrar={() => setVerFijos(false)} />}
    </div>
  );
}
