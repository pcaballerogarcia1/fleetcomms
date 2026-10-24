// Pestañas de vehículos y trabajadores, y la sección de depots.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { logAudit } from "../audit.js";
import { db } from "../firebase.js";
import { C, TURNO_TYPES, VEHICLE_TYPES, font, mono } from "./estilo.js";
import { CAMPOS_FICHA, edadDe, valorFicha } from "../trabajador-ficha.js";
import { AccesoApp } from "./acceso-app.jsx";
import { CAMPOS_FICHA_VEHICULO, diasHasta, valorFichaVehiculo } from "../vehiculo-ficha.js";

// ── DEPOT SECTION ─────────────────────────────────────────────────
// Selector de cochera/depot compartido por vehículos y trabajadores: dos
// campos lat/lng editables a mano, más un botón para elegir uno de los
// depots ya creados en Planning (planning_depots) si el proyecto tiene
// alguno. Cada instancia lleva su propio estado de "picker abierto" — no
// hace falta compartirlo entre formularios porque cada uno es independiente.
function DepotSection({ projectId, formObj, setFormObj }) {
  const [planningDepots, setPlanningDepots] = useState([]);
  const [showPicker,     setShowPicker]     = useState(false);

  // Load depots from Firestore planning_depots (migrated from localStorage)
  useEffect(() => {
    if (!projectId) return;
    return onSnapshot(doc(db, "planning_depots", projectId), snap => {
      if (snap.exists()) {
        setPlanningDepots((snap.data().depots ?? []).filter(d => !d.planta)); // las plantas de descarga no son depósito de salida
      } else {
        // Fallback: legacy localStorage data
        try {
          const raw = localStorage.getItem(`fc_depots_${projectId}`);
          if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
        } catch { /* ignore */ }
      }
    }, () => {
      try {
        const raw = localStorage.getItem(`fc_depots_${projectId}`);
        if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
      } catch { /* ignore */ }
    });
  }, [projectId]);

  const inpStyle = { flex: 1, minWidth: 0, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };

  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: .5 }}>COCHERA / DEPOT (inicio/fin de turno)</span>
        {planningDepots.length > 0 && (
          <button onClick={() => setShowPicker(v => !v)} style={{
            fontSize: 10, padding: "3px 8px", background: "none", border: `1px solid ${C.border}`, borderRadius: 5,
            color: C.blueText, cursor: "pointer", fontFamily: font,
          }}>Elegir de Planning</button>
        )}
      </div>
      {showPicker && (
        <div style={{ marginBottom: 8 }}>
          {planningDepots.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>No hay depots en Planning para este proyecto.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {planningDepots.map(d => (
                <button key={d.id} onClick={() => { setFormObj({ ...formObj, depotLat: String(d.lat), depotLng: String(d.lng) }); setShowPicker(false); }} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.text, fontSize: 12, padding: "6px 10px", cursor: "pointer",
                  fontFamily: font, textAlign: "left", transition: "border-color .12s",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >
                  <span style={{ marginRight: 6 }}>🏠</span>
                  <b>{d.nombre}</b>
                  <span style={{ color: C.dim, marginLeft: 8, fontSize: 10, fontFamily: mono }}>{(+d.lat).toFixed(5)}, {(+d.lng).toFixed(5)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" placeholder="Lat (ej: 41.3851)" value={formObj.depotLat ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLat: e.target.value })}
          step="0.00001" style={inpStyle} />
        <input type="number" placeholder="Lng (ej: 2.1734)" value={formObj.depotLng ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLng: e.target.value })}
          step="0.00001" style={inpStyle} />
        {(formObj.depotLat || formObj.depotLng) && (
          <button onClick={() => setFormObj({ ...formObj, depotLat: "", depotLng: "" })} title="Quitar depot"
            style={{ padding: "0 10px", background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, fontFamily: font }}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ── VEHICLES TAB ──────────────────────────────────────────────────
// La ficha del vehículo (marca, combustible, autonomía, ITV…), en el panel de la derecha
function FichaVehiculoCampos({ obj, setObj, selStyle }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, marginTop: 10 }}>
      {CAMPOS_FICHA_VEHICULO.map(c => (
        <label key={c.k} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: c.k === "autonomiaKm" ? C.blueText : C.muted, gridColumn: c.k === "notas" || c.k === "autonomiaKm" ? "1 / -1" : undefined }}>
          {c.l}
          {c.tipo === "opciones" ? (
            <select value={obj[c.k] ?? ""} onChange={e => setObj({ ...obj, [c.k]: e.target.value })} style={{ ...selStyle, flex: "none", color: obj[c.k] ? C.text : C.dim }}>
              <option value="">—</option>
              {[...c.opciones, ...(obj[c.k] && !c.opciones.includes(obj[c.k]) ? [obj[c.k]] : [])].map(o => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input type={c.tipo === "fecha" ? "date" : "text"} inputMode={c.tipo === "decimal" ? "decimal" : undefined}
              placeholder={c.k === "autonomiaKm" ? "sin límite — el Scheduling no le dará rutas más largas" : ""}
              value={obj[c.k] ?? ""} onChange={e => setObj({ ...obj, [c.k]: e.target.value })}
              style={{ ...selStyle, flex: "none", colorScheme: "dark" }} />
          )}
        </label>
      ))}
    </div>
  );
}
const fichaVehiculoParaGuardar = obj => Object.fromEntries(CAMPOS_FICHA_VEHICULO.map(c => [c.k, valorFichaVehiculo(c, obj[c.k]) ?? ""]));
const fichaVehiculoVacia = Object.fromEntries(CAMPOS_FICHA_VEHICULO.map(c => [c.k, ""]));
// aviso de una fecha que caduca (ITV, seguro): en rojo si ya pasó, en ámbar si falta menos de un mes
function AvisoFecha({ fecha, que }) {
  const d = diasHasta(fecha);
  if (d == null || d > 30) return null;
  return <span style={{ color: d < 0 ? C.red : C.amber, fontWeight: 600 }}>{d < 0 ? `${que} caducada` : d === 0 ? `${que} hoy` : `${que} en ${d} días`}</span>;
}

export function TabVehiculos({ vehicles, loading, activeProject, orgId }) {
  const empty = { nombre: "", matricula: "", tipo: "Camión lateral", capacidad: "", turno: "Jornada completa", depotLat: "", depotLng: "", ...fichaVehiculoVacia };
  const [form,   setForm]   = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };
  const inpStyle = { ...selStyle };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un vehículo sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      logAudit({ modulo: "Flota", accion: "Dio de alta un vehículo", detalle: [form.nombre.trim(), form.matricula.trim()].filter(Boolean).join(" · "), projectId: null });
      await addDoc(collection(db, "scheduling_vehicles"), {
        nombre: form.nombre.trim(), matricula: form.matricula.trim(),
        tipo: form.tipo, turno: form.turno,
        capacidad: parseInt(form.capacidad) || 0,
        depotLat: form.depotLat ? +form.depotLat : null,
        depotLng: form.depotLng ? +form.depotLng : null,
        ...fichaVehiculoParaGuardar(form),
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create vehicle:", e); alert("Error al crear vehículo: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      logAudit({ modulo: "Flota", accion: "Modificó un vehículo", detalle: [editForm.nombre.trim(), editForm.matricula.trim()].filter(Boolean).join(" · "), projectId: null });
      await updateDoc(doc(db, "scheduling_vehicles", id), {
        nombre: editForm.nombre.trim(), matricula: editForm.matricula.trim(),
        tipo: editForm.tipo, turno: editForm.turno,
        capacidad: parseInt(editForm.capacidad) || 0,
        depotLat: editForm.depotLat ? +editForm.depotLat : null,
        depotLng: editForm.depotLng ? +editForm.depotLng : null,
        ...fichaVehiculoParaGuardar(editForm),
      });
      setEditId(null);
    } catch (e) { console.error("save vehicle:", e); alert("Error al guardar."); }
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este vehículo?")) return;
    const v = vehicles.find(x => x._id === id);
    await deleteDoc(doc(db, "scheduling_vehicles", id));
    logAudit({ modulo: "Flota", accion: "Eliminó un vehículo", detalle: [v?.nombre, v?.matricula].filter(Boolean).join(" · "), projectId: null });
  }

  function startEdit(v) {
    setEditId(v._id);
    setEditForm({ nombre: v.nombre || "", matricula: v.matricula || "", tipo: v.tipo || "Camión lateral", turno: v.turno || "Jornada completa", capacidad: v.capacidad || "", depotLat: v.depotLat ?? "", depotLng: v.depotLng ?? "", ...Object.fromEntries(CAMPOS_FICHA_VEHICULO.map(c => [c.k, v[c.k] ?? ""])) });
    setAdding(false);
  }

  const inp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={inpStyle} />
  );

  const eInp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={inpStyle} />
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
    <div style={{ flex: "1 1 520px", maxWidth: 720, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Vehículos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{vehicles.length} registrado{vehicles.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir vehículo"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {inp("nombre", "Nombre (p.ej. Vehículo 01)")}
            {inp("matricula", "Matrícula")}
            {inp("capacidad", "Capacidad (m³)", "number")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={selStyle}>
              {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
          <DepotSection projectId={activeProject?._id} formObj={form} setFormObj={setForm} />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : vehicles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay vehículos. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {vehicles.map(v => editId === v._id ? (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("matricula", "Matrícula")}
                {eInp("capacidad", "Capacidad (m³)", "number")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={editForm.tipo} onChange={e => setEditForm({ ...editForm, tipo: e.target.value })} style={selStyle}>
                  {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <button onClick={() => save(v._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
              <DepotSection projectId={activeProject?._id} formObj={editForm} setFormObj={setEditForm} />
            </div>
          ) : (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.blueText, flexShrink: 0 }}>
                {v.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {v.matricula && <span style={{ fontFamily: mono }}>{v.matricula}</span>}
                  <span>{v.tipo}</span>
                  {v.capacidad > 0 && <span>{v.capacidad} m³</span>}
                  {v.turno && <span style={{ color: C.blueText }}>{v.turno}</span>}
                  {[v.marca, v.modelo].filter(Boolean).length > 0 && <span>{[v.marca, v.modelo].filter(Boolean).join(" ")}</span>}
                  {v.combustible && <span>{v.combustible}</span>}
                  {Number(v.autonomiaKm) > 0 && <span style={{ color: C.green }} title="El Scheduling no le da rutas de más km al día">{/el[eé]ctric/i.test(v.combustible || "") ? "🔋" : "⛽"} {Number(v.autonomiaKm).toLocaleString("es-ES")} km</span>}
                  <AvisoFecha fecha={v.proximaITV} que="ITV" />
                  <AvisoFecha fecha={v.seguroVence} que="Seguro" />
                  {v.depotLat && v.depotLng && (
                    <span style={{ color: "#f59e5b", display: "flex", alignItems: "center", gap: 3 }}>
                      🏠 {(+v.depotLat).toFixed(4)}, {(+v.depotLng).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => startEdit(v)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(v._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    {/* la ficha del vehículo que se está editando o dando de alta, a la derecha */}
    {(adding || editId) && (() => {
      const nuevo = adding && !editId;
      const obj = nuevo ? form : editForm, setObj = nuevo ? setForm : setEditForm;
      return (
        <div style={{ flex: "1 1 420px", maxWidth: 640, position: "sticky", top: 0, background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Ficha {nuevo ? "del vehículo nuevo" : `de ${obj.nombre || obj.matricula || "…"}`}</div>
            <span style={{ fontSize: 11, color: C.dim }}>Se guarda con «Guardar»</span>
          </div>
          <FichaVehiculoCampos obj={obj} setObj={setObj} selStyle={selStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => (nuevo ? create() : save(editId))} disabled={saving || !String(obj.nombre || "").trim()} style={{ padding: "8px 18px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: !String(obj.nombre || "").trim() ? .5 : 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
            <button onClick={() => (nuevo ? setAdding(false) : setEditId(null))} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancelar</button>
          </div>
        </div>
      );
    })()}
    </div>
  );
}

// ── WORKERS TAB ───────────────────────────────────────────────────
// Desplegable de vehículo de un trabajador
const VehicleSelect = ({ value, onChange, vehicles, selStyle }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ ...selStyle, color: value ? C.text : C.dim }}>
    <option value="">Sin vehículo asignado</option>
    {(vehicles || []).map(v => <option key={v._id} value={v._id}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` (${v.matricula})` : ""}</option>)}
  </select>
);

// La ficha del trabajador (DNI, nacimiento, nacionalidad, categoría, contacto…), plegable
function FichaCampos({ obj, setObj, selStyle, siempre = false }) {
  const [abierta0, setAbierta] = useState(() => CAMPOS_FICHA.some(c => obj[c.k]));
  const abierta = siempre || abierta0;
  const rellenos = CAMPOS_FICHA.filter(c => obj[c.k] !== "" && obj[c.k] != null).length;
  return (
    <div style={{ marginTop: 10 }}>
      {!siempre && <button type="button" onClick={() => setAbierta(a => !a)} style={{ background: "none", border: "none", color: C.blueText, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: font }}>
        {abierta ? "▾" : "▸"} Ficha del trabajador {rellenos ? `(${rellenos} datos)` : ""}
      </button>}
      {abierta && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, marginTop: 8 }}>
          {CAMPOS_FICHA.map(c => (
            <label key={c.k} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: C.muted, gridColumn: c.k === "direccion" || c.k === "notas" ? "1 / -1" : undefined }}>
              {c.l}
              <input type={c.tipo === "fecha" ? "date" : c.tipo === "numero" ? "number" : c.tipo === "email" ? "email" : "text"}
                value={obj[c.k] ?? ""} onChange={e => setObj({ ...obj, [c.k]: e.target.value })}
                style={{ ...selStyle, flex: "none", colorScheme: "dark" }} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
// los datos de la ficha para guardar (normalizados; vacíos = se borran)
const fichaParaGuardar = obj => Object.fromEntries(CAMPOS_FICHA.map(c => [c.k, valorFicha(c, obj[c.k]) ?? ""]));
const fichaVacia = Object.fromEntries(CAMPOS_FICHA.map(c => [c.k, ""]));

export function TabTrabajadores({ workers, vehicles, loading, activeProject, orgId }) {
  const empty = { nombre: "", apellidos: "", turno: "Mañana (06-14)", rol: "conductor", vehiculoId: "", depotLat: "", depotLng: "", ...fichaVacia };
  const [form,     setForm]     = useState(empty);
  const [adding,   setAdding]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un trabajador sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      logAudit({ modulo: "Plantilla", accion: "Dio de alta un trabajador", detalle: [form.nombre.trim(), form.apellidos.trim()].filter(Boolean).join(" "), projectId: null });
      await addDoc(collection(db, "scheduling_workers"), {
        nombre: form.nombre.trim(), apellidos: form.apellidos.trim(),
        turno: form.turno, rol: form.rol,
        vehiculoId: form.vehiculoId || "",
        depotLat: form.depotLat ? +form.depotLat : null,
        depotLng: form.depotLng ? +form.depotLng : null,
        ...fichaParaGuardar(form),
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create worker:", e); alert("Error al crear trabajador: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      logAudit({ modulo: "Plantilla", accion: "Modificó un trabajador", detalle: [editForm.nombre.trim(), (editForm.apellidos || "").trim()].filter(Boolean).join(" "), projectId: null });
      await updateDoc(doc(db, "scheduling_workers", id), {
        nombre: editForm.nombre.trim(), apellidos: (editForm.apellidos || "").trim(),
        turno: editForm.turno, rol: editForm.rol,
        vehiculoId: editForm.vehiculoId || "",
        depotLat: editForm.depotLat ? +editForm.depotLat : null,
        depotLng: editForm.depotLng ? +editForm.depotLng : null,
        ...fichaParaGuardar(editForm),
      });
      setEditId(null);
    } catch (e) { console.error("save worker:", e); alert("Error al guardar."); }
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este trabajador?")) return;
    const w = workers.find(x => x._id === id);
    await deleteDoc(doc(db, "scheduling_workers", id));
    logAudit({ modulo: "Plantilla", accion: "Eliminó un trabajador", detalle: [w?.nombre, w?.apellidos].filter(Boolean).join(" "), projectId: null });
  }

  function startEdit(w) {
    setEditId(w._id);
    setEditForm({ nombre: w.nombre || "", apellidos: w.apellidos || "", turno: w.turno || "Mañana (06-14)", rol: w.rol || "conductor", vehiculoId: w.vehiculoId || "", depotLat: w.depotLat ?? "", depotLng: w.depotLng ?? "", ...Object.fromEntries(CAMPOS_FICHA.map(c => [c.k, w[c.k] ?? ""])) });
    setAdding(false);
  }

  const inp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={selStyle} />
  );

  const eInp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={selStyle} />
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
    <div style={{ flex: "1 1 520px", maxWidth: 720, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Trabajadores</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{workers.length} registrado{workers.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir trabajador"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {inp("nombre", "Nombre")}
            {inp("apellidos", "Apellidos")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
              {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, rol: v })} style={{
                  padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: form.rol === v ? "rgba(255,255,255,0.1)" : "none",
                  color: form.rol === v ? "#fff" : C.muted,
                  fontSize: 11, fontFamily: font, transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <VehicleSelect value={form.vehiculoId} onChange={v => setForm({ ...form, vehiculoId: v })} vehicles={vehicles} selStyle={selStyle} />
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
          <DepotSection projectId={activeProject?._id} formObj={form} setFormObj={setForm} />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : workers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay trabajadores. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workers.map(w => editId === w._id ? (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("apellidos", "Apellidos")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
                  {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                    <button key={v} onClick={() => setEditForm({ ...editForm, rol: v })} style={{
                      padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                      background: editForm.rol === v ? "rgba(255,255,255,0.1)" : "none",
                      color: editForm.rol === v ? "#fff" : C.muted,
                      fontSize: 11, fontFamily: font, transition: "all .12s",
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <VehicleSelect value={editForm.vehiculoId} onChange={v => setEditForm({ ...editForm, vehiculoId: v })} vehicles={vehicles} selStyle={selStyle} />
                <button onClick={() => save(w._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
              <DepotSection projectId={activeProject?._id} formObj={editForm} setFormObj={setEditForm} />
            </div>
          ) : (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.green, flexShrink: 0, fontWeight: 700 }}>
                {w.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{w.nombre} {w.apellidos}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>{w.turno}</span>
                  <span style={{ color: w.rol === "supervisor" ? C.amber : C.dim }}>{w.rol}</span>
                  {w.categoria && <span>{w.categoria}</span>}
                  {edadDe(w) != null && <span>{edadDe(w)} años</span>}
                  {w.nacionalidad && <span>{w.nacionalidad}</span>}
                  {w.telefono && <span>☎ {w.telefono}</span>}
                  {w.email && <span>{w.email}</span>}
                  {w.uid && <span style={{ color: C.blueText }} title="Tiene acceso a la app">🔑 {w.usuario || "app"}</span>}
                  {(() => {
                    const v = (vehicles || []).find(v => v._id === w.vehiculoId);
                    return v
                      ? <span style={{ color: C.blue, background: C.blueDim, borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>🚛 {v.nombre || v.matricula}</span>
                      : <span style={{ color: C.red, fontSize: 10 }}>Sin vehículo</span>;
                  })()}
                  {w.depotLat && w.depotLng && (
                    <span style={{ color: "#f59e5b", display: "flex", alignItems: "center", gap: 3 }}>
                      🏠 {(+w.depotLat).toFixed(4)}, {(+w.depotLng).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => startEdit(w)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(w._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    {/* la ficha del trabajador que se está editando o dando de alta, a la derecha */}
    {(adding || editId) && (() => {
      const nuevo = adding && !editId;
      const obj = nuevo ? form : editForm, setObj = nuevo ? setForm : setEditForm;
      return (
        <div style={{ flex: "1 1 420px", maxWidth: 640, position: "sticky", top: 0, background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Ficha {nuevo ? "del trabajador nuevo" : `de ${[obj.nombre, obj.apellidos].filter(Boolean).join(" ") || "…"}`}</div>
            <span style={{ fontSize: 11, color: C.dim }}>Se guarda con «Guardar»</span>
          </div>
          <FichaCampos obj={obj} setObj={setObj} selStyle={selStyle} siempre />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => (nuevo ? create() : save(editId))} disabled={saving || !String(obj.nombre || "").trim()} style={{ padding: "8px 18px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: !String(obj.nombre || "").trim() ? .5 : 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
            <button onClick={() => (nuevo ? setAdding(false) : setEditId(null))} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancelar</button>
          </div>
          {nuevo
            ? <div style={{ fontSize: 11.5, color: C.dim, marginTop: 14 }}>Cuando lo guardes, ábrelo para darle su usuario y contraseña de la app.</div>
            : workers.find(w => w._id === editId) && <AccesoApp key={editId} worker={workers.find(w => w._id === editId)} orgId={orgId} selStyle={selStyle} />}
        </div>
      );
    })()}
    </div>
  );
}
