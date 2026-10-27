// Scheduling de rutas por puntos: trozos de la pantalla (barra de herramientas,
// progreso, avisos, ventanas de publicar, historial y simulador). Reciben de la
// pantalla lo que enseñan; no guardan estado propio.




import { Check, ChevronDown, Download, Info, FileDown, FileSpreadsheet, FileUp, FlaskConical, History, Loader2, Maximize2, Redo2, Send, SlidersHorizontal, Pencil, Sparkles, TriangleAlert, Truck, Undo2, Users, X } from "lucide-react";
import { useState } from "react";
import { nombreDeVersion, renombrarEscenario, renombrarPunto } from "../scenario-store.js";
import { textoPuesto } from "./simulador.js";
import { t } from "../i18n.js";
import { NOMBRE_TIPO, recordarTrabajo, trabajoRecordado } from "../publicar-rutas.js";
import { C, font, mono } from "./estilo.js";
import { alfa } from "../tema.js";





export function BarraHerramientas({ activeProject, cloudMeta, canGenerate, canRedoMove, canUndoMove, constraints, setConstraints, downloadCrewXLSX, downloadVehicleXLSX, focusMode, generating, handleUploadXLSX, historyIndex, importFromPlanning, importing, lang, mode, moveHistory, osrmRunning, redoMove, runGenerate, schedule, schedules, setFocusMode, setMode, setPublishModal, setShowC, setShowHistorial, setShowSimulador, setSimError, setSimResult, showC, tasks, undoMove, xlsxUploadRef }) {
  const girando = <Loader2 size={13} className="op-girando" />;
  const [menuExcel, setMenuExcel] = useState(false);
  function elegirExcel(que) {
    setMenuExcel(false);
    if (que === "vehiculos") downloadVehicleXLSX();
    else if (que === "trabajadores") downloadCrewXLSX();
    else xlsxUploadRef.current?.click();
  }
  return (
    <>
      {/* ── TOOLBAR ──────────────────────────────────────────────── */}
      {!focusMode && <div style={{
        padding: "9px 16px", minHeight: 50, borderBottom: `1px solid ${C.border}`,
        background: C.bg, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 8, // si no cabe, a una segunda línea (antes «Generar escenario» se salía)
      }}>
        {/* Qué se ve: el escenario de los vehículos o el de los trabajadores */}
        <div role="tablist" aria-label="Ver el escenario de" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 9, background: C.surface2, border: `1px solid ${C.border}` }}>
          {[["vehicles", t("vehiculos", lang), Truck], ["workers", t("trabajadores", lang), Users]].map(([v, l, Icono]) => (
            <button key={v} role="tab" aria-selected={mode === v} onClick={() => setMode(v)} style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 14px", borderRadius: 7, border: "none", cursor: "pointer",
              fontFamily: font, fontSize: 13, fontWeight: 650,
              background: mode === v ? C.blue : "transparent", color: mode === v ? "#fff" : C.muted,
              transition: "background .12s, color .12s",
            }}><Icono size={16} />{l}</button>
          ))}
        </div>

        <div className="op-sep" />

        {/* Paradas importadas de Planning */}
        <button onClick={importFromPlanning} disabled={importing} className={`op-btn${tasks.length ? " op-ok" : ""}`} title="Volver a importar las paradas de Planificación">
          {importing ? <>{girando} Importando…</>
            : tasks.length ? <><Check size={14} /> {tasks.length.toLocaleString()} paradas</>
            : <><Download size={14} /> Importar desde Planificación</>}
        </button>


        <button onClick={() => setShowC(!showC)} className={`op-btn${showC ? " op-activo" : ""}`}><SlidersHorizontal size={14} /> {t("restricciones", lang)}</button>
        {activeProject && <button onClick={() => setShowHistorial(true)} className="op-btn" title="Historial de versiones del escenario"><History size={14} /> {t("historial", lang)}</button>}
        {activeProject && cloudMeta?.v && <NombreEscenario projectId={activeProject._id} meta={cloudMeta} />}
        {schedule && <button onClick={() => { setShowSimulador(true); setSimResult(null); setSimError(null); }} className="op-btn" title="Simular +/- vehículos sin tocar el escenario actual"><FlaskConical size={14} /> {t("simulador", lang)}</button>}

        {schedule && <>
          {schedules.vehicles && <>
            {/* Excel: descargar o importar el escenario, todo en un menú */}
            <div style={{ position: "relative" }}>
              <input ref={xlsxUploadRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUploadXLSX} />
              <button onClick={() => setMenuExcel(m => !m)} className={`op-btn${menuExcel ? " op-activo" : ""}`} aria-haspopup="menu" aria-expanded={menuExcel} title="Descargar o importar el escenario en Excel">
                <FileSpreadsheet size={14} /> Excel <ChevronDown size={13} />
              </button>
              {menuExcel && <>
                <div onClick={() => setMenuExcel(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
                <div role="menu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 51, minWidth: 290, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>
                  {[
                    [FileDown, "Descargar escenario de vehículos", "vehiculos"],
                    ...(schedules.workers ? [[FileDown, "Descargar escenario de trabajadores", "trabajadores"]] : []),
                    [FileUp, "Importar escenario desde Excel", "importar"],
                  ].map(([Icono, txt, que]) => (
                    <button key={que} role="menuitem" onClick={() => elegirExcel(que)} className="op-menu-item" style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", borderRadius: 6, background: "transparent",
                      color: C.text, fontFamily: font, fontSize: 12.5, cursor: "pointer", textAlign: "left", whiteSpace: "nowrap",
                    }}><Icono size={14} color={C.muted} />{txt}</button>
                  ))}
                </div>
              </>}
            </div>
            <div className="op-sep" />
            <button onClick={() => { const now = new Date(); setPublishModal({ tipo: "ruta", mes: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` }); }} className="op-btn"><Send size={14} /> {t("publicarRutas", lang)}</button>
            {/* Deshacer / rehacer movimientos manuales del Gantt */}
            <div style={{ display: "flex", gap: 2 }}>
              <button onClick={undoMove} disabled={!canUndoMove} className="op-btn op-fantasma op-icono" title={canUndoMove ? `Deshacer: ${moveHistory[historyIndex]?.label || "último movimiento"}` : "Nada que deshacer"}><Undo2 size={15} /></button>
              <button onClick={redoMove} disabled={!canRedoMove} className="op-btn op-fantasma op-icono" title={canRedoMove ? `Rehacer: ${moveHistory[historyIndex + 1]?.label || "movimiento"}` : "Nada que rehacer"}><Redo2 size={15} /></button>
            </div>
          </>}
        </>}

        {mode === "workers" && !schedules.vehicles && (
          <span style={{ fontSize: 12, color: C.amber, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}><TriangleAlert size={13} /> Genera primero el escenario de vehículos</span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {setConstraints && !constraints.usarFrecuencias && (
            <label title="Después de repartir las paradas, sigue mejorando las rutas hasta minuto y medio (menos días, turnos y km). Sin marcar, unos segundos."
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: constraints.optimizarAFondo ? C.text : C.muted, cursor: generating ? "default" : "pointer", marginRight: 4 }}>
              <input type="checkbox" checked={!!constraints.optimizarAFondo} disabled={generating} onChange={e => setConstraints(c => ({ ...c, optimizarAFondo: e.target.checked }))} style={{ accentColor: C.blue, margin: 0 }} />
              A fondo
            </label>
          )}
          <button onClick={runGenerate} disabled={!canGenerate} className="op-btn op-primario" style={{ height: 32, padding: "0 14px" }}>
            {osrmRunning ? <>{girando} {t("calculandoKm", lang)}</>
              : generating ? <>{girando} {t("generando", lang)}</>
              : <><Sparkles size={14} /> {t("generarEscenario", lang)}</>}
          </button>
          {schedule && <button onClick={() => setFocusMode(true)} className="op-btn op-icono" title="Modo pantalla completa (Gantt)"><Maximize2 size={14} /></button>}
        </div>
      </div>}
    </>
  );
}

export function ProgresoGeneracion({ GEN_PHASES, elapsedSec, genPhase, generating, scaleProgress, tasks, vehicles, workers }) {
  return (
    <>
      {/* Progress bar */}
      {generating && (
        <div style={{
          padding: "10px 16px 12px",
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          animation: "sched-fadein .15s ease both",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(91,124,250,.3)", borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {GEN_PHASES[genPhase]?.label ?? "Preparando…"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: elapsedSec >= 60 ? "#f59e0b" : C.muted }}>
                {elapsedSec >= 60
                  ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
                  : `${elapsedSec}s`}
              </span>
              <span style={{ fontSize: 11, color: C.dim }}>
                {tasks.length.toLocaleString()} paradas · {(vehicles.length || workers.length) > 0 ? `${Math.max(vehicles.length, workers.length)} recurso${Math.max(vehicles.length, workers.length) !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
          </div>
          {/* Track */}
          <div style={{ height: 4, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${GEN_PHASES[genPhase]?.pct ?? 4}%`,
              background: `linear-gradient(90deg, ${C.blue}, #818cf8)`,
              borderRadius: 3,
              transition: "width 0.5s ease",
              animation: "sched-shimmer 1.8s ease-in-out infinite",
            }} />
          </div>
          {/* Phase steps */}
          <div style={{ display: "flex", gap: 0, marginTop: 7 }}>
            {Object.entries(GEN_PHASES).map(([key, ph]) => {
              const currentIdx  = Object.keys(GEN_PHASES).indexOf(genPhase);
              const thisIdx     = Object.keys(GEN_PHASES).indexOf(key);
              const done        = currentIdx > thisIdx;
              const active      = key === genPhase;
              return (
                <div key={key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: done ? C.green : active ? C.blue : C.surface2,
                    border: `1px solid ${done ? C.green : active ? C.blue : C.border}`,
                    transition: "all .3s",
                  }} />
                  <span style={{
                    fontSize: 9, color: done ? C.green : active ? C.blueText : C.dim,
                    letterSpacing: .3, fontWeight: active ? 600 : 400,
                    transition: "color .3s", whiteSpace: "nowrap",
                  }}>
                    {ph.label.replace("…", "").replace(" por carretera", "")}
                  </span>
                  {thisIdx < Object.keys(GEN_PHASES).length - 1 && (
                    <div style={{ flex: 1, height: 1, background: done ? C.green : C.border, margin: "0 4px", transition: "background .3s" }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Progreso real del auto-escalado — sin esto, un proyecto grande
              en fase "vrp" es indistinguible de uno colgado durante los
              minutos (a veces bastantes) que tarda cada ronda. */}
          {genPhase === "carretera" && scaleProgress?.texto && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{scaleProgress.texto}</div>
          )}
          {genPhase === "vrp" && scaleProgress && !scaleProgress.texto && (
            <div style={{ marginTop: 8, fontSize: 10.5, color: C.dim, fontFamily: "monospace", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.blueText, fontWeight: 700 }}>
                {scaleProgress.stage === "growth" ? `Ronda ${scaleProgress.round}` : `Afinando`}
              </span>
              <span>{scaleProgress.vehicles.toLocaleString()} vehículos</span>
              <span style={{ color: scaleProgress.unassigned > 0 ? C.amber : C.green }}>
                {scaleProgress.unassigned.toLocaleString()} sin asignar
              </span>
              <span>{(scaleProgress.roundMs / 1000).toFixed(1)}s esta prueba</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function AvisosEscenario({ activeProject, cloudConflict, cloudSync, focusMode, genError, keepMyScenario, rosterConflicts, saveSummaryError, savingSummary, scaleInfo, setCloudSync, setGenError, setSaveSummaryError, setScaleInfo, takeTheirScenario }) {
  return (
    <>
      {/* Error banner */}
      {genError && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(242,109,109,0.08)", borderBottom: `1px solid rgba(242,109,109,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Guardado del resumen en segundo plano — no bloquea, solo informa.
          Si tarda mucho o falla (conexión atascada), el escenario ya está
          generado y usable igualmente; esto solo afecta a la tarjeta de
          Proyectos, el historial de versiones y Rostering. */}
      {savingSummary && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(91,124,250,0.06)", borderBottom: `1px solid rgba(91,124,250,0.18)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>Guardando resumen del proyecto…</span>
        </div>
      )}
      {(cloudSync === "saving" || cloudSync === "loading") && !focusMode && (
        <div style={{ padding: "4px 16px", background: "rgba(91,124,250,0.05)", borderBottom: `1px solid rgba(91,124,250,0.15)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>
            {cloudSync === "saving" ? "Guardando el escenario en la nube…" : "Cargando la última versión del escenario…"}
          </span>
        </div>
      )}
      {cloudConflict && cloudConflict.projectId === activeProject?._id && !focusMode && (
        <div style={{ padding: "8px 16px", background: "rgba(245,184,74,0.10)", borderBottom: `1px solid rgba(245,184,74,0.35)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.amber }}>
            {cloudConflict.meta?.savedBy?.nombre || "Otra persona"} ha guardado otra versión de este escenario mientras lo editabas. Tus cambios están a salvo en este navegador — elige con cuál te quedas.
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button onClick={takeTheirScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: C.surface2, border: `1px solid ${C.border}`, color: C.text }}>
              Ver su versión (descarta la mía)
            </button>
            <button onClick={keepMyScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: "rgba(245,184,74,0.15)", border: "1px solid rgba(245,184,74,0.45)", color: C.amber, fontWeight: 600 }}>
              Guardar la mía encima
            </button>
          </div>
        </div>
      )}
      {cloudSync === "error" && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(242,109,109,0.08)", borderBottom: `1px solid rgba(242,109,109,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo sincronizar el escenario con la nube. Está guardado en este navegador y se volverá a subir con el próximo cambio o al recargar.
          </span>
          <button onClick={() => setCloudSync(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}
      {saveSummaryError && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(242,109,109,0.08)", borderBottom: `1px solid rgba(242,109,109,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo guardar el resumen del proyecto ({saveSummaryError}) — el escenario generado sigue intacto, pero la tarjeta de Proyectos y Rostering pueden no reflejarlo. Prueba a recargar.
          </span>
          <button onClick={() => setSaveSummaryError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Auto-scale (virtual fleet) banner */}
      {scaleInfo && !focusMode && <AvisoCalculo mensajes={scaleInfo} onCerrar={() => setScaleInfo(null)} />}

      {/* Rostering conflict banner */}
      {rosterConflicts.length > 0 && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(245,184,74,0.07)", borderBottom: `1px solid rgba(245,184,74,0.2)`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>Conflictos:</span>
          {rosterConflicts.map((c, i) => (
            <span key={i} style={{ fontSize: 10, color: C.amber, background: "rgba(245,184,74,0.1)", border: "1px solid rgba(245,184,74,0.2)", borderRadius: 4, padding: "1px 6px" }}>
              {c.name} — día {c.day} ({c.label})
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function VentanaPublicar({ publishModal, publishToRoutes, publishing, setPublishModal }) {
  return (
    <>
      {/* Publish modal */}
      {publishModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => !publishing && setPublishModal(null)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "28px 28px 24px",
            width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Enviar a conductores</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>
              Se creará un plan por cada vehículo con sus paradas asignadas.
            </div>

            {/* Tipo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>Tipo de plan</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["ruta","Ruta"],["prev","Mantenimiento"],["ext","Limp. Exterior"],["int","Limp. Interior"]].map(([k, label]) => (
                  <button key={k} onClick={() => setPublishModal(m => ({ ...m, tipo: k, trabajo: trabajoRecordado(k) }))} style={{
                    flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${publishModal.tipo === k ? C.blue : C.border}`,
                    background: publishModal.tipo === k ? C.blueDim : "none",
                    color: publishModal.tipo === k ? C.blueText : C.muted,
                    fontSize: 10, fontWeight: publishModal.tipo === k ? 700 : 400,
                    cursor: "pointer", fontFamily: font, textAlign: "center",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Nombre del trabajo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>Nombre del trabajo en Rutas</div>
              <input
                value={publishModal.trabajo ?? trabajoRecordado(publishModal.tipo)} maxLength={60}
                onChange={e => setPublishModal(m => ({ ...m, trabajo: e.target.value }))}
                placeholder={NOMBRE_TIPO[publishModal.tipo]}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontSize: 12, fontFamily: font }}
              />
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>Así lo verán los conductores en la app (p. ej. «Recogida de vidrio»).</div>
            </div>

            {/* Mes */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>Mes</div>
              <input
                type="month"
                value={publishModal.mes}
                onChange={e => setPublishModal(m => ({ ...m, mes: e.target.value }))}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "8px 10px", borderRadius: 7,
                  border: `1px solid ${C.border}`, background: C.surface2,
                  color: C.text, fontSize: 12, fontFamily: font,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPublishModal(null)} disabled={publishing} style={{
                flex: 1, padding: "9px 0", borderRadius: 7, border: `1px solid ${C.border}`,
                background: "none", color: C.muted, fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: font,
              }}>Cancelar</button>
              <button onClick={() => { const tr = publishModal.trabajo ?? trabajoRecordado(publishModal.tipo); recordarTrabajo(publishModal.tipo, tr); publishToRoutes(publishModal.tipo, publishModal.mes, tr); }} disabled={publishing} style={{
                flex: 2, padding: "9px 0", borderRadius: 7, border: "none",
                background: publishing ? C.blueDim : C.blue,
                color: publishing ? C.blueText : "#fff",
                fontSize: 13, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer",
                fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {publishing
                  ? <><span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${alfa(0.3)}`, borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Publicando…</>
                  : "Publicar planes"
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function VentanaHistorial({ cloudMeta, compararCon, projectId, restorePoint, scenarioHistory, setShowHistorial, showHistorial }) {
  return (
    <>
      {/* Historial de versiones del escenario */}
      {showHistorial && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => setShowHistorial(false)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "24px 24px 20px",
            width: 620, maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Historial de versiones</div>
              <button onClick={() => setShowHistorial(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            {/* Puntos de restauración (versiones completas guardadas en la nube) */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: "10px 0 4px" }}>Puntos de restauración</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
              Versiones completas del escenario a las que puedes volver. Se guarda una antes de volver a generar, antes de restaurar, antes de guardar encima de otra persona y una copia automática cada 30 min de edición (máx. 15).
              {cloudMeta?.savedAtMs ? <> Versión actual: {new Date(cloudMeta.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{cloudMeta.savedBy?.nombre ? ` · ${cloudMeta.savedBy.nombre}` : ""}.</> : null}
            </div>
            {!(cloudMeta?.puntos?.length) ? (
              <div style={{ padding: "12px 0 16px", color: C.dim, fontSize: 12 }}>
                Todavía no hay puntos de restauración — aparecerán al volver a generar o tras 30 min editando.
              </div>
            ) : (
              <div style={{ marginBottom: 18, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                {cloudMeta.puntos.map(p => (
                  <div key={p.v} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, width: 95, flexShrink: 0 }}>
                      {p.savedAtMs ? new Date(p.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreDeVersion(p)}</span>
                        <button title="Cambiar el nombre de esta versión" aria-label="Renombrar versión" onClick={() => { const n = window.prompt("Nombre de esta versión:", p.nombre || ""); if (n != null) renombrarPunto(projectId, p.v, n).catch(e => window.alert(`No se pudo renombrar: ${e.message || e}`)); }}
                          style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 0, display: "inline-flex" }}><Pencil size={11} /></button>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted }}>{p.motivo}</div>
                      <div style={{ fontSize: 10.5, color: C.dim }}>{p.savedBy?.nombre ? `Guardada por ${p.savedBy.nombre}` : "Autor desconocido"}{p.bytes ? ` · ${(p.bytes / 1e6).toFixed(1)} MB` : ""}</div>
                    </div>
                    {compararCon && (
                      <button onClick={() => compararCon(p)} title="Ver esta versión al lado del escenario actual" style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontFamily: font, background: "transparent", border: `1px solid ${C.border}`, color: C.text, fontWeight: 600, flexShrink: 0 }}>
                        Comparar
                      </button>
                    )}
                    <button onClick={() => restorePoint(p)} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontFamily: font, background: "rgba(91,124,250,0.12)", border: `1px solid ${C.blue}55`, color: C.blueText, fontWeight: 600, flexShrink: 0 }}>
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: "6px 0 4px" }}>Resumen de cada generación</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>
              Cada vez que generas un escenario se guarda un resumen aquí — compara esta semana con la anterior sin tener que volver a generar nada.
            </div>
            {scenarioHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontSize: 13 }}>
                Todavía no hay historial — se empezará a guardar la próxima vez que generes un escenario.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Fecha", "Vehículos", "Trabajadores", "Días", "Km", "Paradas", "Sin asig."].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: C.dim, fontSize: 10, letterSpacing: .5, textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scenarioHistory.map((h, i) => {
                    const prev = scenarioHistory[i + 1];
                    const delta = (key, decimals = 0) => {
                      if (!prev || prev[key] == null || h[key] == null) return null;
                      const d = +(h[key] - prev[key]).toFixed(decimals);
                      if (d === 0) return null;
                      const up = d > 0;
                      return <span style={{ fontSize: 9, marginLeft: 4, color: up ? C.orange : C.green }}>{up ? "▲" : "▼"}{Math.abs(d)}</span>;
                    };
                    const fecha = h.generatedAt?.toDate ? h.generatedAt.toDate() : (h.generatedAt?.toMillis ? new Date(h.generatedAt.toMillis()) : null);
                    return (
                      <tr key={h._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: mono, fontSize: 11 }}>
                          {fecha ? fecha.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", color: C.text, fontFamily: mono }}>{h.vehicleCount}{delta("vehicleCount")}</td>
                        <td style={{ padding: "7px 10px", color: C.text, fontFamily: mono }}>{h.workerCount}{delta("workerCount")}</td>
                        <td style={{ padding: "7px 10px", color: C.blueText, fontFamily: mono }}>{h.daysUsed}{delta("daysUsed")}</td>
                        <td style={{ padding: "7px 10px", color: C.amber, fontFamily: mono }}>{h.totalKm?.toFixed?.(0) ?? h.totalKm}{delta("totalKm")}</td>
                        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: mono }}>{h.totalStops}{delta("totalStops")}</td>
                        <td style={{ padding: "7px 10px", fontFamily: mono, color: h.unassigned > 0 ? C.red : C.green }}>{h.unassigned ?? 0}{delta("unassigned")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function VentanaSimulador({ constraints, runSimulation, schedules, setShowSimulador, setSimDelta, setSimTrab, showSimulador, simDelta, simError, simResult, simRunning, simTrab, totalKm, unassigned, vehicles, workers = [] }) {
  const contador = (valor, cambiar, min, etiqueta) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button aria-label={`Quitar ${etiqueta}`} onClick={() => cambiar(d => Math.max(min, d - 1))} disabled={simRunning || valor <= min} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>−</button>
      <span style={{ width: 46, textAlign: "center", fontFamily: mono, fontSize: 14, fontWeight: 700, color: valor > 0 ? C.green : valor < 0 ? C.red : C.muted }}>{valor > 0 ? `+${valor}` : valor}</span>
      <button aria-label={`Añadir ${etiqueta}`} onClick={() => cambiar(d => d + 1)} disabled={simRunning} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>+</button>
    </div>
  );
  return (
    <>
      {/* Simulador "qué pasaría si" */}
      {showSimulador && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => !simRunning && setShowSimulador(false)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "24px 24px 22px",
            width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Simulador "qué pasaría si"</div>
              {!simRunning && <button onClick={() => setShowSimulador(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>
              Prueba a añadir o quitar vehículos, o a añadir trabajadores, y compara el resultado y el coste con el escenario actual. No se guarda nada.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "90px auto 1fr", alignItems: "center", gap: "10px 10px", marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Vehículos</span>
              {contador(simDelta, setSimDelta, -vehicles.length + 1, "vehículo")}
              <span style={{ fontSize: 10, color: C.dim }}>respecto a los {vehicles.length} actuales</span>
              <span style={{ fontSize: 11, color: C.muted }}>Trabajadores</span>
              {contador(simTrab, setSimTrab, 0, "trabajador")}
              <span style={{ fontSize: 10, color: C.dim }}>cada uno, un segundo turno en el vehículo con menos horas</span>
            </div>

            <button onClick={runSimulation} disabled={simRunning || vehicles.length + simDelta <= 0} style={{
              width: "100%", padding: "9px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: simRunning ? "wait" : "pointer",
              fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: vehicles.length + simDelta <= 0 ? 0.5 : 1, marginBottom: 16,
            }}>
              {simRunning
                ? <><span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${alfa(0.3)}`, borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Simulando…</>
                : "Simular"
              }
            </button>

            {simError && <div style={{ fontSize: 11, color: C.red, marginBottom: 12 }}>{simError}</div>}

            {simResult && (() => {
              const act = simResult.actual || {};
              const eur = n => `${Math.round(n).toLocaleString("es-ES")} €`;
              const h = n => `${Math.round(n / 60).toLocaleString("es-ES")} h`;
              // [etiqueta, actual, simulado, cuanto menos mejor, formato]
              const rows = [
                ["Vehículos", schedules.vehicles?.length || 0, simResult.vehicleCount, null],
                ["Trabajadores", act.trabajadores ?? workers.length, simResult.trabajadores ?? workers.length, null],
                ["Días", constraints.days || 1, simResult.daysUsed, true],
                ["Km totales", Math.round(totalKm), Math.round(simResult.totalKm), true],
                ["Sin asignar", unassigned.length, simResult.unassigned, true],
                ...(simResult.pagado != null ? [["Horas pagadas", act.pagado || 0, simResult.pagado, true, h]] : []),
                ...(simResult.coste != null ? [["Coste", act.coste || 0, simResult.coste, true, eur]] : []),
              ];
              const difCoste = simResult.coste != null ? simResult.coste - (act.coste || 0) : null;
              return (
                <>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: C.surface2, padding: "7px 12px" }}>
                      <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}></span>
                      <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", textAlign: "right" }}>Actual</span>
                      <span style={{ fontSize: 10, color: C.blueText, textTransform: "uppercase", textAlign: "right" }}>Simulado</span>
                    </div>
                    {rows.map(([label, a, s, menos, fmt = n => n]) => {
                      const color = menos == null || Math.round(s) === Math.round(a) ? C.text : (s < a) === menos ? C.green : C.orange;
                      return (
                        <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                          <span style={{ fontSize: 12, color: C.muted, fontFamily: mono, textAlign: "right" }}>{fmt(a)}</span>
                          <span style={{ fontSize: 12, color, fontFamily: mono, fontWeight: 700, textAlign: "right" }}>{fmt(s)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {difCoste != null && Math.abs(difCoste) >= 1 && (
                    <div style={{ marginTop: 12, fontSize: 12.5, color: C.text }}>
                      El simulado cuesta <b style={{ color: difCoste > 0 ? C.orange : C.green }}>{eur(Math.abs(difCoste))} {difCoste > 0 ? "más" : "menos"}</b> en los días del escenario.
                    </div>
                  )}
                  {simResult.coste != null && (
                    <div style={{ marginTop: 6, fontSize: 11, color: C.dim }}>Coste contado igual en los dos: horas de cada vehículo de la salida a la vuelta, más los turnos enteros de los trabajadores de más, y los km.</div>
                  )}
                  {simResult.coste == null && (
                    <div style={{ marginTop: 12, fontSize: 11.5, color: C.muted }}>Para ver el coste, pon el coste por hora de conductor y por km en Restricciones.</div>
                  )}
                  {simResult.puestos?.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                      Trabajadores de más: {simResult.puestos.map(textoPuesto).join(" · ")}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

// Los avisos del cálculo en una sola línea (lo importante primero); el resto, al desplegar
function AvisoCalculo({ mensajes, onCerrar }) {
  const [abierto, setAbierto] = useState(false);
  const lista = (Array.isArray(mensajes) ? mensajes : [mensajes]).filter(Boolean);
  // «Distancias y tiempos…» es informativo: va al final
  const orden = [...lista.filter(m => !/^Distancias y tiempos/.test(m)), ...lista.filter(m => /^Distancias y tiempos/.test(m))];
  if (!orden.length) return null;
  return (
    <div style={{ padding: "6px 16px", background: `${C.amber}14`, borderBottom: `1px solid ${C.amber}40`, flexShrink: 0, fontSize: 11.5, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Info size={13} color={C.amber} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: abierto ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{orden[0]}</span>
        {orden.length > 1 || orden[0].length > 110
          ? <button onClick={() => setAbierto(a => !a)} style={{ background: "none", border: "none", color: C.blueText, cursor: "pointer", fontSize: 11.5, padding: 0, flexShrink: 0 }}>{abierto ? "Ver menos" : `Ver todo${orden.length > 1 ? ` (${orden.length})` : ""}`}</button>
          : null}
        <button onClick={onCerrar} aria-label="Cerrar" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex", padding: 0, flexShrink: 0 }}><X size={14} /></button>
      </div>
      {abierto && orden.length > 1 && (
        <ul style={{ margin: "6px 0 2px", paddingLeft: 21, color: C.muted, lineHeight: 1.55 }}>
          {orden.slice(1).map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

// El nombre del escenario actual: se ve junto a «Historial» y se cambia con un clic
function NombreEscenario({ projectId, meta }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState(null);
  async function guardar() {
    setEditando(false);
    if (texto.trim() === (meta.nombre || "")) return;
    try { await renombrarEscenario(projectId, texto); setError(null); }
    catch (e) { setError(e.message || String(e)); }
  }
  if (editando) return (
    <input autoFocus aria-label="Nombre del escenario" value={texto} placeholder="Nombre del escenario" onChange={e => setTexto(e.target.value)}
      onBlur={guardar} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTexto(meta.nombre || ""); setEditando(false); } }}
      style={{ height: 30, width: 220, background: C.bg, border: `1px solid ${C.blue}`, color: C.text, borderRadius: 8, padding: "0 10px", fontSize: 12.5, fontFamily: font, outline: "none" }} />
  );
  return (
    <button onClick={() => { setTexto(meta.nombre || ""); setEditando(true); }} className="op-btn op-fantasma" title={error ? `No se pudo renombrar: ${error}` : "Cambiar el nombre del escenario"}
      style={{ maxWidth: 240, color: meta.nombre ? C.text : C.dim, fontStyle: meta.nombre ? "normal" : "italic" }}>
      <Pencil size={12} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{meta.nombre || "Ponle nombre"}</span>
    </button>
  );
}
