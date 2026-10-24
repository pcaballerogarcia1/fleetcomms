// Planning → Recursos: subir vehículos o trabajadores desde un Excel/CSV.
// Primero se enseña lo que va a pasar (nuevos, actualizados, filas que no
// valen) y se guarda al confirmar. La lectura está en recursos-importar.js.
import { Download, Upload } from "lucide-react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useRef, useState } from "react";
import { logAudit } from "../audit.js";
import { db } from "../firebase.js";
import { PLANTILLA_TRABAJADORES, PLANTILLA_VEHICULOS, leerTrabajadores, leerVehiculos, planTrabajadores, planVehiculos } from "../recursos-importar.js";
import { C, font } from "./estilo.js";

const COLECCION = { vehiculos: "scheduling_vehicles", trabajadores: "scheduling_workers" };

export function ImportarRecursos({ tipo, vehicles = [], workers = [], orgId }) {
  const fileRef = useRef(null);
  const [plan, setPlan] = useState(null); // { nuevos, cambios, ignorados, sinVehiculo, archivo }
  const [estado, setEstado] = useState(null); // { ok, texto }
  const [guardando, setGuardando] = useState(false);
  const nombre = tipo === "vehiculos" ? "vehículos" : "trabajadores";

  async function leer(file) {
    if (!file) return;
    setEstado(null); setPlan(null);
    try {
      const XLSX = await import("xlsx");
      // un CSV se lee como texto (UTF-8): leído en binario, las tildes salían rotas («JosÃ©») y no se reconocían columnas como «Vehículo»
      const wb = /\.csv$/i.test(file.name) ? XLSX.read(await file.text(), { type: "string" }) : XLSX.read(await file.arrayBuffer());
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!filas.length) throw new Error("el archivo no tiene filas");
      if (tipo === "vehiculos") {
        const { vehiculos, ignorados } = leerVehiculos(filas);
        setPlan({ ...planVehiculos(vehiculos, vehicles), ignorados, sinVehiculo: [], archivo: file.name });
      } else {
        const { trabajadores, ignorados } = leerTrabajadores(filas);
        setPlan({ ...planTrabajadores(trabajadores, workers, vehicles), ignorados, archivo: file.name });
      }
    } catch (e) { setEstado({ ok: false, texto: `No se pudo leer «${file.name}»: ${e.message || e}` }); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function confirmar() {
    if (!plan || !orgId) { setEstado({ ok: false, texto: "Falta la empresa: abre un proyecto de una empresa." }); return; }
    setGuardando(true);
    try {
      const col = collection(db, COLECCION[tipo]);
      const ops = [
        ...plan.nuevos.map(d => b => b.set(doc(col), { ...d, activo: true, org_id: orgId, createdAt: serverTimestamp() })),
        ...plan.cambios.map(({ id, datos }) => b => b.update(doc(db, COLECCION[tipo], id), datos)),
      ];
      for (let i = 0; i < ops.length; i += 400) {
        const b = writeBatch(db);
        ops.slice(i, i + 400).forEach(f => f(b));
        await b.commit();
      }
      logAudit({ modulo: "Flota", accion: `Subió ${nombre} desde Excel`, detalle: `${plan.archivo}: ${plan.nuevos.length} nuevos, ${plan.cambios.length} actualizados`, projectId: null });
      setEstado({ ok: true, texto: `«${plan.archivo}»: ${plan.nuevos.length} ${nombre} nuevos y ${plan.cambios.length} actualizados.` });
      setPlan(null);
    } catch (e) { setEstado({ ok: false, texto: `No se pudo guardar: ${e.message || e}` }); }
    setGuardando(false);
  }

  async function plantilla() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tipo === "vehiculos" ? PLANTILLA_VEHICULOS : PLANTILLA_TRABAJADORES), tipo === "vehiculos" ? "Vehículos" : "Trabajadores");
    XLSX.writeFile(wb, `plantilla-${nombre}.xlsx`);
  }

  const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 12.5, fontFamily: font, cursor: "pointer" };
  return (
    <div style={{ padding: "12px 22px 0", fontFamily: font }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => leer(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} style={btn}><Upload size={14} /> Subir Excel/CSV de {nombre}</button>
        <button onClick={plantilla} style={{ ...btn, background: "none" }}><Download size={14} /> Descargar plantilla</button>
        <span style={{ fontSize: 11.5, color: C.dim }}>
          {tipo === "vehiculos" ? "Columnas: Nombre, Matrícula, Tipo, Capacidad, Turno, Marca, Modelo, Nº de bastidor, Fecha de matriculación, Fecha de alta, Propiedad, Combustible, Autonomía (km), Consumo, Depósito, MMA, Tara, Plazas, Km actuales, Próxima ITV, Seguro vence (y Latitud/Longitud de su base). Solo el nombre o la matrícula son obligatorios; los que ya existen se actualizan por la matrícula." : "Columnas: Nombre y Apellidos (o Nombre completo), DNI/NIE, Fecha de nacimiento (o Edad), Nacionalidad, Categoría, Correo electrónico, Teléfono, Dirección, Permiso de conducir, Fecha de alta, Turno, Rol y Vehículo (su matrícula o nombre). Solo el nombre es obligatorio; los que ya existen se actualizan."}
        </span>
      </div>
      {estado && <div style={{ fontSize: 12.5, color: estado.ok ? C.green : C.red, marginTop: 8 }}>{estado.texto}</div>}
      {plan && (
        <div style={{ marginTop: 10, background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: "12px 14px", maxWidth: 820 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>«{plan.archivo}»</div>
          <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7 }}>
            <div><b>{plan.nuevos.length}</b> {nombre} nuevos · <b>{plan.cambios.length}</b> que ya estaban se actualizan</div>
            {plan.ignorados.length > 0 && <div style={{ color: C.amber }}>{plan.ignorados.length} fila(s) no se suben ({plan.ignorados.slice(0, 5).map(x => `fila ${x.fila}: ${x.motivo}`).join(" · ")}{plan.ignorados.length > 5 ? "…" : ""})</div>}
            {plan.sinVehiculo?.length > 0 && <div style={{ color: C.amber }}>Vehículos que no se encuentran (se quedan sin vehículo): {plan.sinVehiculo.slice(0, 8).join(", ")}{plan.sinVehiculo.length > 8 ? "…" : ""}. Sube antes los vehículos.</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={confirmar} disabled={guardando || !(plan.nuevos.length + plan.cambios.length)} style={{ ...btn, background: C.blue, border: "none", color: "#fff", fontWeight: 600, opacity: guardando ? 0.6 : 1 }}>{guardando ? "Guardando…" : "Confirmar"}</button>
            <button onClick={() => setPlan(null)} disabled={guardando} style={{ ...btn, background: "none" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
