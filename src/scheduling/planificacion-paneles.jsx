// Scheduling de rutas por puntos: trozos de la pantalla (barra de herramientas,
// progreso, avisos, ventanas de publicar, historial y simulador). Reciben de la
// pantalla lo que enseñan; no guardan estado propio.




import { t } from "../i18n.js";
import { C, font, mono } from "./estilo.js";





export function BarraHerramientas({ activeProject, canGenerate, canRedoMove, canUndoMove, constraints, downloadCrewXLSX, downloadVehicleXLSX, focusMode, generating, handleUploadXLSX, historyIndex, importFromPlanning, importing, lang, mode, moveHistory, osrmRunning, redoMove, runGenerate, schedule, schedules, setFocusMode, setMode, setPublishModal, setShowC, setShowHistorial, setShowSimulador, setSimError, setSimResult, showC, tasks, totalAssigned, totalKm, unassigned, undoMove, xlsxUploadRef }) {
  return (
    <>
      {/* ── TOOLBAR ──────────────────────────────────────────────── */}
      {!focusMode && <div style={{
        padding: "0 16px", height: 46, borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {/* Import */}
        <button onClick={importFromPlanning} disabled={importing} style={{
          padding: "5px 11px", background: importing ? C.surface2 : !!tasks.length ? C.greenDim : C.surface2,
          border: `1px solid ${!!tasks.length ? C.green + "44" : C.border}`,
          color: !!tasks.length ? C.green : C.muted,
          borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: importing ? "wait" : "pointer",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          {importing
            ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(52,211,153,.2)", borderTopColor: C.green, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Importando…</>
            : !!tasks.length
              ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> {tasks.length.toLocaleString()} paradas</>
              : "Importar desde Planning"
          }
        </button>

        <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2, flexShrink: 0 }}>
          {[["vehicles",t("vehiculos", lang)],["workers",t("trabajadores", lang)]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{
              padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              background: mode === v ? C.blue : "none",
              color: mode === v ? "#fff" : C.muted,
              fontSize: 11, fontWeight: mode === v ? 600 : 400, fontFamily: font,
              transition: "all .12s",
            }}>{l}</button>
          ))}
        </div>

        {/* Constraints toggle */}
        <button onClick={() => setShowC(!showC)} title={t("restricciones", lang)} style={{
          padding: "5px 10px", background: showC ? C.surface2 : "none",
          border: `1px solid ${showC ? C.border2 : C.border}`, color: showC ? C.text : C.muted,
          borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          {t("restricciones", lang)}
        </button>

        {activeProject && (
          <button onClick={() => setShowHistorial(true)} title="Historial de versiones del escenario" style={{
            padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
            display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/>
            </svg>
            {t("historial", lang)}
          </button>
        )}

        {schedule && (
          <button onClick={() => { setShowSimulador(true); setSimResult(null); setSimError(null); }} title="Simular +/- vehículos sin tocar el escenario actual" style={{
            padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
            display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18M3 9v10a2 2 0 0 0 2 2h4"/>
            </svg>
            {t("simulador", lang)}
          </button>
        )}

        {/* Inline KPI chips — only when schedule exists */}
        {schedule && <>
          <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
            <span><span style={{ fontWeight: 700, color: C.green }}>{totalAssigned.toLocaleString()}</span> <span style={{ color: C.dim }}>asig.</span></span>
            {unassigned.length > 0 && <span><span style={{ fontWeight: 700, color: C.red }}>{unassigned.length.toLocaleString()}</span> <span style={{ color: C.dim }}>sin asig.</span></span>}
            <span><span style={{ fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span> <span style={{ color: C.dim }}>días</span></span>
            {totalKm > 0 && <span><span style={{ fontWeight: 700, color: C.amber }}>{totalKm.toFixed(0)}</span> <span style={{ color: C.dim }}>km∅</span></span>}
          </div>
          {schedules.vehicles && (
            <>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              {/* Excel export */}
              <button onClick={downloadVehicleXLSX} title="Descargar vehicle scheduling en Excel"
                style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Vehículos
              </button>
              {schedules.workers && (
                <button onClick={downloadCrewXLSX} title="Descargar crew scheduling en Excel"
                  style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Trabajadores
                </button>
              )}
              {/* Excel import */}
              <input ref={xlsxUploadRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUploadXLSX} />
              <button onClick={() => xlsxUploadRef.current?.click()} title="Importar vehicle scheduling o crew scheduling desde Excel"
                style={{ padding: "5px 10px", background: "rgba(92,155,255,.08)", border: `1px solid rgba(92,155,255,.3)`, color: C.blue, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {t("importar", lang)}
              </button>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              <button
                onClick={() => { const now = new Date(); setPublishModal({ tipo: "prev", mes: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}` }); }}
                style={{
                  padding: "5px 10px", background: C.greenDim, border: `1px solid ${C.green}44`,
                  color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {t("publicarRutas", lang)}
              </button>

              {/* Deshacer / rehacer movimientos manuales del Gantt (tipo Excel) */}
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <button
                  onClick={undoMove} disabled={!canUndoMove}
                  title={canUndoMove ? `Deshacer: ${moveHistory[historyIndex]?.label || "último movimiento"}` : "Nada que deshacer"}
                  style={{
                    width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none",
                    color: canUndoMove ? C.text : C.dim, cursor: canUndoMove ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: canUndoMove ? 1 : 0.35, flexShrink: 0,
                  }}
                  onMouseEnter={e => canUndoMove && (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 7"/>
                  </svg>
                </button>
                <button
                  onClick={redoMove} disabled={!canRedoMove}
                  title={canRedoMove ? `Rehacer: ${moveHistory[historyIndex + 1]?.label || "movimiento"}` : "Nada que rehacer"}
                  style={{
                    width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none",
                    color: canRedoMove ? C.text : C.dim, cursor: canRedoMove ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: canRedoMove ? 1 : 0.35, flexShrink: 0,
                  }}
                  onMouseEnter={e => canRedoMove && (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 7"/>
                  </svg>
                </button>
              </div>
            </>
          )}
        </>}

        {/* Worker mode hint */}
        {mode === "workers" && !schedules.vehicles && (
          <span style={{ fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span>⚠</span> Genera primero el escenario de vehículos
          </span>
        )}

        {/* Generate + Focus mode toggle */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={runGenerate} disabled={!canGenerate} style={{
            padding: "6px 14px", background: canGenerate ? C.blue : C.blueDim,
            border: "none", color: canGenerate ? "#fff" : C.blueText,
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: canGenerate ? "pointer" : "not-allowed",
            fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            opacity: canGenerate ? 1 : .6,
          }}>
            {osrmRunning
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> {t("calculandoKm", lang)}</>
              : generating
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> {t("generando", lang)}</>
              : t("generarEscenario", lang)
            }
          </button>
          {schedule && (
            <button
              onClick={() => setFocusMode(true)}
              title="Modo pantalla completa (Gantt)"
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: C.surface2, border: `1px solid ${C.border}`,
                color: C.dim, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
              </svg>
            </button>
          )}
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
              <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(92,155,255,.3)", borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite", flexShrink: 0 }} />
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
          {genPhase === "vrp" && scaleProgress && (
            <div style={{ marginTop: 8, fontSize: 10.5, color: C.dim, fontFamily: "monospace", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.blueText, fontWeight: 700 }}>
                {scaleProgress.stage === "growth" ? `Ronda ${scaleProgress.round}` : `Afinando`}
              </span>
              <span>{scaleProgress.vehicles.toLocaleString()} vehículos</span>
              <span style={{ color: scaleProgress.unassigned > 0 ? "#fbbf24" : C.green }}>
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
        <div style={{ padding: "7px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Guardado del resumen en segundo plano — no bloquea, solo informa.
          Si tarda mucho o falla (conexión atascada), el escenario ya está
          generado y usable igualmente; esto solo afecta a la tarjeta de
          Proyectos, el historial de versiones y Rostering. */}
      {savingSummary && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(92,155,255,0.06)", borderBottom: `1px solid rgba(92,155,255,0.18)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>Guardando resumen del proyecto…</span>
        </div>
      )}
      {(cloudSync === "saving" || cloudSync === "loading") && !focusMode && (
        <div style={{ padding: "4px 16px", background: "rgba(92,155,255,0.05)", borderBottom: `1px solid rgba(92,155,255,0.15)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>
            {cloudSync === "saving" ? "Guardando el escenario en la nube…" : "Cargando la última versión del escenario…"}
          </span>
        </div>
      )}
      {cloudConflict && cloudConflict.projectId === activeProject?._id && !focusMode && (
        <div style={{ padding: "8px 16px", background: "rgba(251,191,36,0.10)", borderBottom: `1px solid rgba(251,191,36,0.35)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#fbbf24" }}>
            {cloudConflict.meta?.savedBy?.nombre || "Otra persona"} ha guardado otra versión de este escenario mientras lo editabas. Tus cambios están a salvo en este navegador — elige con cuál te quedas.
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button onClick={takeTheirScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: C.surface2, border: `1px solid ${C.border}`, color: C.text }}>
              Ver su versión (descarta la mía)
            </button>
            <button onClick={keepMyScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.45)", color: "#fbbf24", fontWeight: 600 }}>
              Guardar la mía encima
            </button>
          </div>
        </div>
      )}
      {cloudSync === "error" && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo sincronizar el escenario con la nube. Está guardado en este navegador y se volverá a subir con el próximo cambio o al recargar.
          </span>
          <button onClick={() => setCloudSync(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}
      {saveSummaryError && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo guardar el resumen del proyecto ({saveSummaryError}) — el escenario generado sigue intacto, pero la tarjeta de Proyectos y Rostering pueden no reflejarlo. Prueba a recargar.
          </span>
          <button onClick={() => setSaveSummaryError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Auto-scale (virtual fleet) banner */}
      {scaleInfo && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(251,191,36,0.08)", borderBottom: `1px solid rgba(251,191,36,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#fbbf24" }}>⚙ {scaleInfo}</span>
          <button onClick={() => setScaleInfo(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Rostering conflict banner */}
      {rosterConflicts.length > 0 && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(251,191,36,0.07)", borderBottom: `1px solid rgba(251,191,36,0.2)`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>Conflictos:</span>
          {rosterConflicts.map((c, i) => (
            <span key={i} style={{ fontSize: 10, color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 4, padding: "1px 6px" }}>
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
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Publicar en Rutas</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>
              Se creará un plan por cada vehículo con sus paradas asignadas.
            </div>

            {/* Tipo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Tipo de plan</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["prev","Prev. Mantenimiento"],["ext","Limp. Exterior"],["int","Limp. Interior"]].map(([k, label]) => (
                  <button key={k} onClick={() => setPublishModal(m => ({ ...m, tipo: k }))} style={{
                    flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${publishModal.tipo === k ? C.blue : C.border}`,
                    background: publishModal.tipo === k ? C.blueDim : "none",
                    color: publishModal.tipo === k ? C.blueText : C.muted,
                    fontSize: 10, fontWeight: publishModal.tipo === k ? 700 : 400,
                    cursor: "pointer", fontFamily: font, textAlign: "center",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Mes */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Mes</div>
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
              <button onClick={() => publishToRoutes(publishModal.tipo, publishModal.mes)} disabled={publishing} style={{
                flex: 2, padding: "9px 0", borderRadius: 7, border: "none",
                background: publishing ? C.blueDim : C.blue,
                color: publishing ? C.blueText : "#fff",
                fontSize: 13, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer",
                fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {publishing
                  ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Publicando…</>
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

export function VentanaHistorial({ cloudMeta, restorePoint, scenarioHistory, setShowHistorial, showHistorial }) {
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
                      <div style={{ fontSize: 12, color: C.text }}>{p.motivo}</div>
                      <div style={{ fontSize: 10.5, color: C.dim }}>{p.savedBy?.nombre ? `Guardada por ${p.savedBy.nombre}` : "Autor desconocido"}{p.bytes ? ` · ${(p.bytes / 1e6).toFixed(1)} MB` : ""}</div>
                    </div>
                    <button onClick={() => restorePoint(p)} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontFamily: font, background: "rgba(92,155,255,0.12)", border: `1px solid ${C.blue}55`, color: C.blueText, fontWeight: 600, flexShrink: 0 }}>
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

export function VentanaSimulador({ constraints, runSimulation, schedules, setShowSimulador, setSimDelta, showSimulador, simDelta, simError, simResult, simRunning, totalKm, unassigned, vehicles }) {
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
              Prueba a añadir o quitar vehículos sobre tu flota real y compara el resultado con el escenario actual — no se guarda nada hasta que tú lo decidas.
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Vehículos</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setSimDelta(d => d - 1)} disabled={simRunning} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>−</button>
                <span style={{ width: 46, textAlign: "center", fontFamily: mono, fontSize: 14, fontWeight: 700, color: simDelta > 0 ? C.green : simDelta < 0 ? C.red : C.muted }}>
                  {simDelta > 0 ? `+${simDelta}` : simDelta}
                </span>
                <button onClick={() => setSimDelta(d => d + 1)} disabled={simRunning} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>+</button>
              </div>
              <span style={{ fontSize: 10, color: C.dim }}>respecto a los {vehicles.length} actuales</span>
            </div>

            <button onClick={runSimulation} disabled={simRunning || vehicles.length + simDelta <= 0} style={{
              width: "100%", padding: "9px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: simRunning ? "wait" : "pointer",
              fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: vehicles.length + simDelta <= 0 ? 0.5 : 1, marginBottom: 16,
            }}>
              {simRunning
                ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Simulando…</>
                : "Simular"
              }
            </button>

            {simError && <div style={{ fontSize: 11, color: C.red, marginBottom: 12 }}>{simError}</div>}

            {simResult && (() => {
              const actual = { vehicleCount: schedules.vehicles?.length || 0, unassigned: unassigned.length, totalKm, daysUsed: constraints.days || 1 };
              const rows = [
                ["Vehículos", actual.vehicleCount, simResult.vehicleCount],
                ["Días", actual.daysUsed, simResult.daysUsed],
                ["Km totales", actual.totalKm.toFixed(0), simResult.totalKm.toFixed(0)],
                ["Sin asignar", actual.unassigned, simResult.unassigned],
              ];
              return (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: C.surface2, padding: "7px 12px" }}>
                    <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}></span>
                    <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", textAlign: "right" }}>Actual</span>
                    <span style={{ fontSize: 10, color: C.blueText, textTransform: "uppercase", textAlign: "right" }}>Simulado</span>
                  </div>
                  {rows.map(([label, a, s]) => {
                    const numA = +a, numS = +s;
                    const better = label === "Sin asignar" || label === "Km totales" || label === "Días" ? numS < numA : null;
                    const worse  = label === "Sin asignar" || label === "Km totales" || label === "Días" ? numS > numA : null;
                    const color = numS === numA ? C.text : better ? C.green : worse ? C.orange : C.text;
                    return (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: mono, textAlign: "right" }}>{a}</span>
                        <span style={{ fontSize: 12, color, fontFamily: mono, fontWeight: 700, textAlign: "right" }}>{s}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
