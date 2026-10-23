// Planning de rutas por puntos: el panel lateral (capas, filtros, precios).
import { Loader2, Upload, Warehouse } from "lucide-react";
import { useState, useRef } from "react";
import { db } from "../firebase.js";
import { doc, deleteDoc, updateDoc } from "firebase/firestore";
import { deleteLayerPieces } from "../layer-store.js";
import { LineasPanel } from "../gtfs-lineas.jsx";
import { logAudit } from "../audit.js";
import { barrioColor, cambiarDepots, coordQuality, getBarrio, getContenedor, getFraccion, idbDel } from "./datos.js";
import { C, font, mono } from "./estilo.js";
import { useSector } from "../sector.js";

// Flecha y cabecera plegable de cada sección del panel
const Chevron = ({ open }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transition: "transform .2s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const SecBtn = ({ label, badge, open, onToggle, extra }) => (
  <button onClick={onToggle} style={{
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "none", border: "none", cursor: "pointer", padding: "8px 12px 6px",
    color: C.dim, fontFamily: font,
  }}>
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Chevron open={open} />
      <span style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
        {label}{badge != null ? ` (${badge})` : ""}
      </span>
    </span>
    {extra}
  </button>
);

export function Sidebar(props) {
  const sector = useSector();
  return <SidebarSector {...props} sector={sector} />;
}
function SidebarSector({ sector, layers, setLayers, onUpload, uploading, depots, setDepots, onDepotImport, depotUploading, barrioColors, setBarrioColors, saveBarrioColors, searchQuery, setSearchQuery, totalFiltered, totalAll, addPointMode, setAddPointMode, manualForm, setManualForm, onAddManualPoint, projectId, orgId, fraccionFilter, setFraccionFilter, contenedorFilter, setContenedorFilter, gtfsGrupos = [], lineaSel = null, setLineaSel, verTodasLineas = false, setVerTodasLineas }) {
  const fileRef      = useRef(null);
  const depotFileRef = useRef(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualName, setManualName] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [savingManualDepot, setSavingManualDepot] = useState(false);
  const [openUpload,      setOpenUpload]      = useState(true);
  const [openManualPt,    setOpenManualPt]    = useState(false);
  const [openDepots,      setOpenDepots]      = useState(true);
  const [openLayers,      setOpenLayers]      = useState(true);
  const [openBarrios,     setOpenBarrios]     = useState(false);

  async function removeLayer(id) {
    if (projectId) {
      const layer = layers.find(l => l.id === id);
      logAudit({ modulo: "Planning", accion: "Eliminó una capa", detalle: `${layer?.name || id}${layer?.totalMarkers ? " · " + layer.totalMarkers + " puntos" : ""}` });
      const docId = `${projectId}_${id}`;
      deleteDoc(doc(db, "planning_layers", docId));
      if (layer?.localOnly || layer?.cloud) idbDel(docId);
      if (layer?.cloud) deleteLayerPieces(docId, layer.cloud);
      if (layer?.lineasCloud) { deleteLayerPieces(docId, layer.lineasCloud, { clave: `${docId}__lineas` }); idbDel(`${docId}__lineas`); }
      if (layer?.chunked && layer.chunkCount) {
        for (let ci = 0; ci < layer.chunkCount; ci++) {
          deleteDoc(doc(db, "planning_layers", `${docId}_c${ci}`));
        }
      }
    } else {
      setLayers(prev => prev.filter(l => l.id !== id));
    }
  }
  function toggleLayer(id) {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    if (projectId) {
      updateDoc(doc(db, "planning_layers", `${projectId}_${id}`), { visible: !layer.visible });
    } else {
      setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
    }
  }

  const totalMarkers = layers.reduce((s, l) => s + (l.markers?.length ?? l.totalMarkers ?? 0), 0);

  return (
    <div style={{
      width: 290, flexShrink: 0, background: C.card,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      {/* Search bar */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={searchQuery ? C.blue : C.dim} strokeWidth="2"
            style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", transition: "stroke .15s" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar por palabra clave…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              background: searchQuery ? `${C.blue}14` : C.surface2,
              border: `1px solid ${searchQuery ? C.blue + "55" : C.border}`,
              color: C.text, borderRadius: 7, padding: "7px 28px 7px 28px",
              fontSize: 12, fontFamily: font, outline: "none", transition: "all .15s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = C.blue + "88"; }}
            onBlur={e => { e.currentTarget.style.borderColor = searchQuery ? C.blue + "55" : C.border; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: C.dim, cursor: "pointer",
                fontSize: 15, lineHeight: 1, padding: 2, transition: "color .12s",
              }}
              onMouseEnter={e => e.currentTarget.style.color = C.text}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}
            >×</button>
          )}
        </div>
        {searchQuery && (
          <div style={{ fontSize: 10, color: totalFiltered > 0 ? C.blue : C.red, marginTop: 5, fontWeight: 500 }}>
            {totalFiltered > 0
              ? `${totalFiltered} de ${totalAll} punto${totalAll !== 1 ? "s" : ""}`
              : "Sin resultados"}
          </div>
        )}
      </div>

      {/* ── DEPOTS SECTION ────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Depots" badge={depots.length || null} open={openDepots}
          onToggle={() => setOpenDepots(o => !o)}
          extra={
            <button
              onClick={e => { e.stopPropagation(); setShowManual(s => !s); if (!openDepots) setOpenDepots(true); }}
              title="Añadir depot manualmente"
              style={{
                background: showManual ? "rgba(245,158,91,0.15)" : "none",
                border: `1px solid ${showManual ? "rgba(245,158,91,0.5)" : C.border}`,
                borderRadius: 5,
                color: showManual ? "#f59e5b" : C.dim, cursor: "pointer", fontSize: 15, lineHeight: 1,
                width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#f59e5b"; e.currentTarget.style.borderColor = "#f59e5b55"; }}
              onMouseLeave={e => { if (!showManual) { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border; } }}
            >+</button>
          } />
        {openDepots && (
        <>
        {/* Manual add form */}
        {showManual && (
          <div style={{ padding: "8px 12px 10px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Nuevo depot</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                placeholder="Latitud"
                value={manualLat}
                onChange={e => setManualLat(e.target.value)}
                style={{
                  flex: 1, background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 5, padding: "6px 8px", fontSize: 11,
                  fontFamily: mono, outline: "none", boxSizing: "border-box",
                }}
              />
              <input
                placeholder="Longitud"
                value={manualLng}
                onChange={e => setManualLng(e.target.value)}
                style={{
                  flex: 1, background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 5, padding: "6px 8px", fontSize: 11,
                  fontFamily: mono, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <input
              placeholder="Nombre (opcional)"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              style={{
                width: "100%", background: C.surface2, border: `1px solid ${C.border}`,
                color: C.text, borderRadius: 5, padding: "6px 8px", fontSize: 11,
                fontFamily: font, outline: "none", marginBottom: 7, boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                disabled={savingManualDepot}
                onClick={async () => {
                  // parseFloat("40,4168") = 40 (se para en la coma) — con
                  // coma decimal (muy normal al escribir coordenadas en
                  // español) el depot se creaba en un sitio completamente
                  // distinto sin ningún aviso. Normaliza antes de parsear.
                  const lat = parseFloat(String(manualLat).trim().replace(",", "."));
                  const lng = parseFloat(String(manualLng).trim().replace(",", "."));
                  if (isNaN(lat) || isNaN(lng)) {
                    window.alert("Latitud y longitud tienen que ser números (ej. 40.4168 y -3.7038).");
                    return;
                  }
                  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    window.alert("Coordenadas fuera de rango — revisa que no estén cambiadas de sitio (latitud entre -90 y 90, longitud entre -180 y 180).");
                    return;
                  }
                  const newDepot = { id: Date.now() + Math.random(), lat, lng, nombre: manualName.trim() || `Depot ${depots.length + 1}`, fields: {} };
                  if (projectId) {
                    setSavingManualDepot(true);
                    try {
                      await cambiarDepots(projectId, orgId, l => [...l, newDepot]);
                    } catch (e) {
                      console.error("Error al guardar el depot:", e);
                      window.alert("No se ha podido guardar el depot: " + (e.message || "error desconocido"));
                      setSavingManualDepot(false);
                      return;
                    }
                    setSavingManualDepot(false);
                  } else {
                    setDepots(prev => [...prev, newDepot]);
                  }
                  setManualLat(""); setManualLng(""); setManualName(""); setShowManual(false);
                }}
                style={{
                  flex: 1, padding: "6px", background: "rgba(245,158,91,0.12)",
                  border: "1px solid rgba(245,158,91,0.35)", color: "#f59e5b",
                  borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: savingManualDepot ? "wait" : "pointer",
                  fontFamily: font, transition: "all .12s", opacity: savingManualDepot ? 0.6 : 1,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(245,158,91,0.22)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(245,158,91,0.12)"}
              >{savingManualDepot ? "Guardando…" : "Añadir"}</button>
              <button
                disabled={savingManualDepot}
                onClick={() => { setShowManual(false); setManualLat(""); setManualLng(""); setManualName(""); }}
                style={{
                  padding: "6px 10px", background: "none", border: `1px solid ${C.border}`,
                  color: C.dim, borderRadius: 5, fontSize: 11, cursor: "pointer",
                  fontFamily: font, transition: "all .12s",
                }}
              >Cancelar</button>
            </div>
          </div>
        )}

        {/* Import button */}
        <div style={{ padding: "8px 12px" }}>
          <input
            ref={depotFileRef}
            type="file"
            accept="*"
            multiple
            style={{ display: "none" }}
            onChange={e => { onDepotImport(Array.from(e.target.files)); e.target.value = ""; }}
          />
          <button
            onClick={() => depotFileRef.current?.click()}
            disabled={depotUploading}
            className="op-btn" style={{ width: "100%" }}
          >
            {depotUploading
              ? <><Loader2 size={14} className="op-girando" /> Procesando…</>
              : <><Warehouse size={14} /> Importar depósitos (CSV / KML / Excel)</>
            }
          </button>
        </div>

        {/* Depot list */}
        {depots.length > 0 ? (
          <div style={{ padding: "0 8px 8px" }}>
            {depots.map((d, i) => (
              <div key={d.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: C.surface2, border: "1px solid rgba(245,158,91,0.2)",
                borderLeft: "3px solid #f59e5b",
                borderRadius: 7, padding: "7px 10px", marginBottom: 4,
              }}>
                <span style={{ fontSize: 9, color: "#f59e5b", fontWeight: 700, fontFamily: mono, width: 14, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nombre}</div>
                  <div style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</div>
                </div>
                {/* Planta de descarga (vertedero, planta de transferencia…): el Scheduling manda ahí a los camiones cuando se llenan */}
                {(sector.ver.plantas || d.planta) && <button
                  title={d.planta ? "Es una planta de descarga: los camiones descargan aquí. Pulsa para que vuelva a ser depósito." : "Marcar como planta de descarga (vertedero, planta de transferencia…)"}
                  onClick={() => {
                    const cambio = l => l.map(x => (x.id === d.id ? { ...x, planta: !x.planta } : x));
                    if (projectId) cambiarDepots(projectId, orgId, cambio).catch(e => window.alert("No se ha podido cambiar: " + (e.message || "error desconocido")));
                    else setDepots(cambio);
                  }}
                  style={{ background: d.planta ? "rgba(63,207,142,0.15)" : "none", border: `1px solid ${d.planta ? "rgba(63,207,142,0.5)" : C.border}`, color: d.planta ? "#3fcf8e" : C.dim, borderRadius: 5, fontSize: 9.5, padding: "2px 6px", cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}>
                  {d.planta ? "Planta" : "Depósito"}
                </button>}
                <button
                  onClick={() => {
                    if (projectId) {
                      cambiarDepots(projectId, orgId, l => l.filter(x => x.id !== d.id))
                        .catch(e => { console.error("Error al borrar el depot:", e); window.alert("No se ha podido borrar el depot: " + (e.message || "error desconocido")); });
                    } else {
                      setDepots(prev => prev.filter(x => x.id !== d.id));
                    }
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, fontSize: 14, padding: 0, lineHeight: 1, transition: "color .12s", flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.dim}
                >×</button>
              </div>
            ))}
          </div>
        ) : !showManual && (
          <div style={{ padding: "2px 16px 12px", fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
            Pulsa <strong>+</strong> para añadir un depot manualmente o importa desde archivo
          </div>
        )}
        </>
        )}
      </div>

      {/* Upload area */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Cargar capa" open={openUpload} onToggle={() => setOpenUpload(o => !o)} />
        {openUpload && (
          <div style={{ padding: "4px 12px 12px" }}>
            <input ref={fileRef} type="file" accept="*" multiple style={{ display: "none" }}
              onChange={e => { const files = Array.from(e.target.files); e.target.value = ""; onUpload(files); }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="op-btn op-primario" style={{ width: "100%", height: 34 }}>
              {uploading
                ? <><Loader2 size={14} className="op-girando" /> Procesando…</>
                : <><Upload size={14} /> Subir CSV / KML / Excel</>}
            </button>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 7, lineHeight: 1.7 }}>
              <div>CSV: <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lat</code> / <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lon</code></div>
              <div>Excel: <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>Latitud</code> / <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>Longitud</code></div>
            </div>
          </div>
        )}
      </div>

      {/* Manual point section */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Punto manual" open={openManualPt} onToggle={() => setOpenManualPt(o => !o)} />
        {openManualPt && (
          <div style={{ padding: "4px 12px 12px" }}>
            <button
              onClick={() => setAddPointMode(m => !m)}
              style={{
                width: "100%", padding: "8px 12px", marginBottom: 8,
                background: addPointMode ? "rgba(63,207,142,0.15)" : C.surface2,
                border: `1px solid ${addPointMode ? C.green : C.border2}`,
                color: addPointMode ? C.green : C.muted,
                borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all .15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
              {addPointMode ? "Haz clic en el mapa…" : "Clic en mapa para colocar"}
            </button>
            <input
              placeholder="Nombre del punto"
              value={manualForm.nombre}
              onChange={e => setManualForm(f => ({ ...f, nombre: e.target.value }))}
              style={{ width: "100%", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none", marginBottom: 5, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              <input
                placeholder="Latitud"
                value={manualForm.lat}
                onChange={e => setManualForm(f => ({ ...f, lat: e.target.value }))}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }}
              />
              <input
                placeholder="Longitud"
                value={manualForm.lng}
                onChange={e => setManualForm(f => ({ ...f, lng: e.target.value }))}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }}
              />
            </div>
            <button
              onClick={onAddManualPoint}
              disabled={!manualForm.lat || !manualForm.lng}
              style={{
                width: "100%", padding: "7px",
                background: (!manualForm.lat || !manualForm.lng) ? C.surface2 : "rgba(91,124,250,0.15)",
                border: `1px solid ${(!manualForm.lat || !manualForm.lng) ? C.border : C.blue}44`,
                color: (!manualForm.lat || !manualForm.lng) ? C.dim : C.blueText,
                borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: (!manualForm.lat || !manualForm.lng) ? "default" : "pointer",
                fontFamily: font, transition: "all .15s",
              }}
            >
              + Añadir punto
            </button>
          </div>
        )}
      </div>

      {/* Layers section */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Capas" badge={layers.length || null}
          open={openLayers} onToggle={() => setOpenLayers(o => !o)}
          extra={layers.length > 0 && (
            <span style={{ fontSize: 10, color: C.dim }}>{totalMarkers.toLocaleString()} pts</span>
          )} />
        {openLayers && (
          <div style={{ padding: "0 8px 8px" }}>
            {layers.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
                  Sube un archivo para visualizar puntos en el mapa
                </div>
              </div>
            ) : (
              <>
                {layers.map(layer => (
                  <div key={layer.id} style={{
                    background: C.surface2, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${layer.visible ? layer.color : C.dim}`,
                    borderRadius: 8, padding: "9px 12px", marginBottom: 5,
                    opacity: layer.visible ? 1 : 0.5,
                    animation: "planning-fadein .2s ease both",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <button
                        onClick={() => toggleLayer(layer.id)}
                        title={layer.visible ? "Ocultar" : "Mostrar"}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          padding: 0, lineHeight: 1, flexShrink: 0,
                          width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={layer.visible ? C.muted : C.dim} strokeWidth="2">
                          {layer.visible
                            ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                            : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                          }
                        </svg>
                      </button>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {layer.name}
                      </div>
                      <button
                        onClick={() => removeLayer(layer.id)}
                        title="Eliminar capa"
                        style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, fontSize: 14, padding: 0, lineHeight: 1, transition: "color .15s" }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = C.dim}
                      >×</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
                      <span style={{ fontSize: 9, fontFamily: mono, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{layer.type}</span>
                      <span style={{ fontSize: 11, color: C.dim }}>
                        {(layer.markers?.length ?? layer.totalMarkers ?? 0).toLocaleString()} pts
                      </span>
                    </div>
                    {(() => {
                      const q = coordQuality(layer.markers);
                      if (!q.invalid && !q.far) return null;
                      return (
                        <div style={{ paddingLeft: 24, fontSize: 10.5, color: "#f5b84a", marginTop: 2 }}
                          title="Filas del archivo sin coordenadas (o en 0,0) no se pintan ni se importan en Scheduling. Las que están muy lejos del resto sí se pintan, pero no cuentan para encuadrar el mapa. Corrígelas en el archivo y vuelve a subirlo.">
                          ⚠ {[
                            q.invalid && `${q.invalid.toLocaleString()} sin coordenadas válidas`,
                            q.far && `${q.far.toLocaleString()} muy lejos del resto`,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      );
                    })()}
                    {layer._missing && (
                      <div style={{ paddingLeft: 24, fontSize: 10.5, color: "#f5b84a", marginTop: 2 }}
                        title="Esta capa se subió antes de guardarse en la nube: sus puntos solo están en el navegador de quien la subió. En cuanto esa persona abra este proyecto en Planning, se sube sola y aparece aquí.">
                        ⚠ {(layer.totalMarkers || 0).toLocaleString()} pts solo en el navegador de quien la subió
                      </div>
                    )}
                    {layer._loadError && (
                      <div style={{ paddingLeft: 24, fontSize: 10.5, color: "#f26d6d", marginTop: 2 }}>
                        No se pudieron cargar los puntos: {layer._loadError}
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => {
                    if (projectId) { for (const l of layers) deleteDoc(doc(db, "planning_layers", `${projectId}_${l.id}`)); }
                    else { setLayers([]); }
                  }}
                  style={{
                    width: "100%", padding: "6px", marginTop: 2, background: "none",
                    border: `1px solid ${C.border}`, color: C.dim,
                    borderRadius: 6, fontSize: 10, cursor: "pointer",
                    fontFamily: font, transition: "all .15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                >Limpiar todas las capas</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Barrios section */}
      {(() => {
        const barrios = [...new Set(
          layers.filter(l => l.visible)
            .flatMap(l => l.markers.map(m => getBarrio(m)))
            .filter(Boolean)
        )].sort();
        if (barrios.length === 0) return null;
        const hasOverrides = barrios.some(b => barrioColors[b]);
        return (
          <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <SecBtn label="Barrios" badge={barrios.length} open={openBarrios}
              onToggle={() => setOpenBarrios(o => !o)}
              extra={hasOverrides && (
                <button
                  onClick={() => { setBarrioColors({}); saveBarrioColors({}); }}
                  title="Resetear colores"
                  style={{ background: "none", border: "none", fontSize: 10, color: C.dim, cursor: "pointer", padding: 0, fontFamily: font, transition: "color .12s" }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.dim}
                >resetear</button>
              )} />
            {openBarrios && (
              <div style={{ padding: "2px 12px 8px" }}>
                {barrios.map(b => {
                  const color = barrioColor(b, barrioColors);
                  const isCustom = !!barrioColors[b];
                  return (
                    <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                      <label title={isCustom ? `Color: ${color} — clic para cambiar` : "Clic para personalizar"} style={{ position: "relative", flexShrink: 0, cursor: "pointer" }}>
                        <div style={{
                          width: 16, height: 16, borderRadius: 3, background: color,
                          border: isCustom ? `2px solid rgba(255,255,255,0.6)` : `1px solid rgba(255,255,255,0.2)`,
                          boxShadow: isCustom ? `0 0 0 1px ${color}` : "none", transition: "transform .12s",
                        }}
                          onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
                          onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                        />
                        <input type="color" value={color}
                          onChange={e => { const nc = { ...barrioColors, [b]: e.target.value }; setBarrioColors(nc); saveBarrioColors(nc); }}
                          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }} tabIndex={-1} />
                      </label>
                      <span style={{ fontSize: 11, color: isCustom ? C.text : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{b}</span>
                      {isCustom && (
                        <button
                          onClick={() => { const nc = { ...barrioColors }; delete nc[b]; setBarrioColors(nc); saveBarrioColors(nc); }}
                          style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0, transition: "color .12s" }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.dim}
                        >×</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Filtro por tipo de fracción / tipo de contenedor — a diferencia de
          Barrios (que es solo leyenda de color), estas SÍ filtran el mapa y
          la lista: clic para activar, clic otra vez para quitar el filtro. */}
      {/* Líneas de capas GTFS importadas antes de existir los proyectos de
          «Líneas regulares» (ya no se pueden subir aquí): se siguen viendo */}
      <LineasPanel grupos={gtfsGrupos} sel={lineaSel} onSel={setLineaSel} verTodas={verTodasLineas} setVerTodas={setVerTodasLineas} />

      <FilterChipsSection
        label={sector.t.tipoCategoria}
        layers={layers}
        getValue={getFraccion}
        active={fraccionFilter}
        onSelect={setFraccionFilter}
      />
      <FilterChipsSection
        label={sector.t.tipoElemento}
        layers={layers}
        getValue={getContenedor}
        active={contenedorFilter}
        onSelect={setContenedorFilter}
      />
    </div>
  );
}

// ── FILTER CHIPS (Fracción / Contenedor) ────────────────────────────
// Detects distinct values for a given field getter across visible layers
// and renders them as click-to-toggle filter chips (single active value).
function FilterChipsSection({ label, layers, getValue, active, onSelect }) {
  const [open, setOpen] = useState(false);
  const values = [...new Set(
    layers.filter(l => l.visible).flatMap(l => (l.markers ?? []).map(getValue)).filter(Boolean)
  )].sort();
  if (values.length === 0) return null;

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "none", border: "none", cursor: "pointer", padding: "8px 12px 6px",
        color: C.dim, fontFamily: font,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transition: "transform .2s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
            {label} ({values.length})
          </span>
        </span>
        {active && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onSelect(null); }}
            title="Quitar filtro"
            style={{ background: "none", border: "none", fontSize: 10, color: C.dim, cursor: "pointer", padding: 0, fontFamily: font, transition: "color .12s" }}
            onMouseEnter={e => e.currentTarget.style.color = C.red}
            onMouseLeave={e => e.currentTarget.style.color = C.dim}
          >quitar filtro</span>
        )}
      </button>
      {open && (
        <div style={{ padding: "2px 12px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {values.map(v => {
            const isActive = active === v;
            return (
              <button
                key={v}
                onClick={() => onSelect(isActive ? null : v)}
                style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: font,
                  cursor: "pointer", transition: "all .12s",
                  background: isActive ? C.blueDim : C.surface2,
                  border: `1px solid ${isActive ? C.blue : C.border}`,
                  color: isActive ? C.blueText : C.muted,
                  fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = C.border2; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = C.border; }}
              >{v}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
