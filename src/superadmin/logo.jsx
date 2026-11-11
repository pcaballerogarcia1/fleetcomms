// Panel del superadmin › Configuración: el logo de la empresa (sale en la
// barra de arriba de su oficina, a la derecha). Con vista previa de cómo queda.
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { C } from "../tema.js";
import { reducirLogo } from "../logo-empresa.js";
import { LogoEnBarra } from "../ui/logo-empresa.jsx";

export function LogoEmpresaEditor({ org, onUpdate }) {
  const archivo = useRef();
  const [estado, setEstado] = useState(null);
  // paraPantalla: lo que se enseña ya (quitar el logo se guarda con deleteField)
  const guardar = async (cambios, paraPantalla = cambios) => {
    setEstado("guardando");
    try {
      await updateDoc(doc(db, "orgs", org.org_id), { ...cambios, updatedAt: serverTimestamp() });
      onUpdate({ ...org, ...paraPantalla });
      setEstado(null);
    } catch (e) { setEstado(`No se pudo guardar: ${e.message}`); }
  };
  async function subir(f) {
    try { await guardar({ logo: await reducirLogo(f) }); }
    catch (e) { setEstado(e.message); }
  }
  const conFondo = org.logoFondo !== false;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10, fontWeight: 500 }}>Logo de la empresa</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>Sale arriba a la derecha en la oficina de esta empresa. Mejor un PNG o SVG con el fondo transparente.</div>
      {/* vista previa: la barra de arriba */}
      <div aria-label="Vista previa del logo en la barra" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, height: 52, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, marginBottom: 12 }}>
        {org.logo ? <LogoEnBarra logo={org.logo} nombre={org.nombre} fondo={conFondo} /> : <span style={{ fontSize: 12, color: C.dim }}>Sin logo</span>}
        <span style={{ fontSize: 12, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px" }}>Historial</span>
      </div>
      <input ref={archivo} type="file" accept="image/*" aria-label="Archivo del logo" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) subir(f); }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button className="op-btn" onClick={() => archivo.current?.click()} disabled={estado === "guardando"}><ImagePlus size={14} /> {org.logo ? "Cambiar logo" : "Subir logo"}</button>
        {org.logo && <button className="op-btn" onClick={() => guardar({ logo: deleteField() }, { logo: null })} disabled={estado === "guardando"}><Trash2 size={14} /> Quitar</button>}
        {org.logo && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text, cursor: "pointer" }}>
            <input type="checkbox" checked={conFondo} onChange={e => guardar({ logoFondo: e.target.checked })} /> Fondo blanco detrás (para logos oscuros)
          </label>
        )}
        {estado === "guardando" && <span style={{ fontSize: 12, color: C.muted }}>Guardando…</span>}
      </div>
      {estado && estado !== "guardando" && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{estado}</div>}
    </div>
  );
}
