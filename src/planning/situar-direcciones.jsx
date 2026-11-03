// Planificación · al subir un archivo con direcciones sin coordenadas (la
// lista de clientes de un programa de facturación): se buscan en CartoCiudad
// y se crea la capa con las encontradas. Las que no aparecen se pueden bajar
// en un Excel para corregirlas y volver a subirlas.
import { FileDown, MapPinned } from "lucide-react";
import { useState } from "react";
import { C, font } from "../tema.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { geocodificar } from "../concursos/geocodificar.js";
import { loadXLSX } from "./datos.js";
import { conMunicipio, faltaMunicipio, situarPendientes } from "./direcciones.js";

/** Lo que cae a más de esto del centro de lo encontrado no se da por bueno (una calle igual en otra provincia) */
const RADIO_KM = 150;

export function SituarDirecciones({ nombre, pendientes, dirCols, conCoordenadas = 0, onListo, onCancelar }) {
  const preguntar = faltaMunicipio(pendientes);
  const [municipio, setMunicipio] = useState("");
  const [fase, setFase] = useState("preguntar"); // preguntar | buscando | resultado
  const [progreso, setProgreso] = useState({ hechas: 0, total: 0 });
  const [res, setRes] = useState(null); // { markers, sinSituar, portal, calle }
  const [error, setError] = useState("");

  async function buscar() {
    setFase("buscando"); setError("");
    try {
      const lista = municipio.trim() ? conMunicipio(pendientes, dirCols, municipio.trim()) : pendientes;
      const textos = new Set(lista.map(p => p.texto));
      const r = await geocodificar(textos, { maxKm: RADIO_KM, onProgreso: (hechas, total) => setProgreso({ hechas, total }) });
      const { markers, sinSituar } = situarPendientes(lista, r.porDireccion);
      setRes({ markers, sinSituar, portal: markers.filter(m => m.situado === "en el portal").length, calle: markers.filter(m => m.situado !== "en el portal").length });
      setFase("resultado");
    } catch (e) {
      setError(`No se pudo conectar con el buscador de direcciones (${e.message}). Vuelve a intentarlo en un rato.`);
      setFase("preguntar");
    }
  }

  async function bajarSinSituar() {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(res.sinSituar.map(p => ({ ...p.campos, "Se buscó como": p.texto })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sin situar");
    XLSX.writeFile(wb, `${nombre}_sin_situar.xlsx`);
  }

  const n = pendientes.length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div role="dialog" aria-label="Situar direcciones en el mapa" style={{
        background: C.card, borderRadius: 12, padding: "20px 22px", width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font, color: C.text,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}><MapPinned size={16} />Situar direcciones en el mapa</div>
          {fase !== "buscando" && <BotonCerrar onClick={onCancelar} />}
        </div>

        {fase === "preguntar" && <>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 14 }}>
            «{nombre}» tiene <b style={{ color: C.text }}>{n} {n === 1 ? "fila" : "filas"} con dirección pero sin coordenadas</b>
            {conCoordenadas > 0 && <> (y {conCoordenadas} con coordenadas, que se usan tal cual)</>}.
            Se buscan en CartoCiudad, el buscador oficial de direcciones de España (gratis). Tarda unos segundos por cada cien.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted, marginBottom: 14 }}>
            {preguntar ? "Municipio (el archivo no lo trae)" : "Municipio para las filas que no lo traen (opcional)"}
            <input className="op-input" value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder="Por ejemplo: Salamanca" aria-label="Municipio" style={{ height: 32 }} />
          </label>
          {error && <div role="alert" style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="op-btn" onClick={onCancelar}>Cancelar</button>
            <button className="op-btn op-primario" onClick={buscar} disabled={preguntar && !municipio.trim()}>Situar en el mapa</button>
          </div>
        </>}

        {fase === "buscando" && (
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Buscando direcciones… {progreso.hechas} de {progreso.total || "…"}</div>
            <div style={{ height: 6, background: C.surface2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progreso.total ? Math.round((progreso.hechas / progreso.total) * 100) : 0}%`, background: C.blue, transition: "width .3s" }} />
            </div>
          </div>
        )}

        {fase === "resultado" && res && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            {[["En su portal", res.portal, C.green], ["Solo la calle (aproximado)", res.calle, C.amber], ["Sin encontrar", res.sinSituar.length, res.sinSituar.length ? C.red : C.dim]].map(([t, v, c]) => (
              <div key={t} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{t}</div>
              </div>
            ))}
          </div>
          {res.calle > 0 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Las aproximadas quedan en el centro de su calle: en el mapa, cada punto dice cómo se situó.</div>}
          {res.sinSituar.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>No se encontraron (revisa la dirección o el municipio):</div>
              <div style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
                {res.sinSituar.slice(0, 100).map((p, i) => <div key={i} style={{ padding: "2px 0" }}>{p.texto}</div>)}
                {res.sinSituar.length > 100 && <div style={{ color: C.dim }}>… y {res.sinSituar.length - 100} más</div>}
              </div>
              <button className="op-btn" onClick={bajarSinSituar} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}><FileDown size={14} />Bajar las no encontradas (Excel)</button>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="op-btn" onClick={onCancelar}>Cancelar</button>
            <button className="op-btn op-primario" onClick={() => onListo(res.markers)} disabled={!res.markers.length && !conCoordenadas}>
              Crear la capa con {res.markers.length + conCoordenadas} puntos
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}
