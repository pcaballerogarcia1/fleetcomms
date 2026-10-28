// App del trabajador · en el menú de su foto (junto a «poner foto» y
// «cambiar mi contraseña»): los documentos (con los que tiene sin leer) y los
// avisos al móvil (con un punto si no están activados).
import { useEffect, useState } from "react";
import { Bell, BellOff, ChevronLeft, FileText } from "lucide-react";
import { estadoAvisos } from "../avisos.js";
import { C, S } from "./comun.js";
import { AvisosMovil } from "./avisos-movil.jsx";

const opcion = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", color: C.text, fontSize: 15, cursor: "pointer", textAlign: "left" };
const pastilla = color => ({ marginLeft: "auto", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: color, color: "#111", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" });

/** Las dos opciones del menú del perfil */
export function OpcionesPerfilApp({ docs, onDocumentos, onAvisos }) {
  const [estado, setEstado] = useState(null);
  useEffect(() => { estadoAvisos().then(setEstado, () => setEstado("no-soportado")); }, []);
  const sinLeer = (docs || []).filter(d => !d.leido).length;
  const activos = estado === "activos";
  return (
    <>
      {docs?.length > 0 && (
        <button role="menuitem" style={opcion} onClick={onDocumentos}>
          <FileText size={16} color={C.amber} /> Documentos
          {sinLeer > 0 && <span style={pastilla(C.amber)}>{sinLeer}</span>}
        </button>
      )}
      <button role="menuitem" style={opcion} onClick={onAvisos}>
        {activos ? <Bell size={16} color={C.green} /> : <BellOff size={16} color={C.orange} />} Avisos en el móvil
        {estado && !activos && <span style={{ ...pastilla(C.orange), minWidth: 10, width: 10, height: 10, padding: 0 }} />}
      </button>
    </>
  );
}

/** Pantalla de los avisos al móvil (activar, probar) */
export function PantallaAvisos({ sesion, onBack }) {
  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <button onClick={onBack} style={{ ...S.btnGhost, padding: "7px 10px" }} title="Volver"><ChevronLeft size={18} style={{ verticalAlign: "-4px" }} /></button>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Avisos en el móvil</div>
      </div>
      <div style={{ padding: "0 14px" }}><AvisosMovil sesion={sesion} /></div>
    </div>
  );
}
