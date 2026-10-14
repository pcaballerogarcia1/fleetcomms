// Gantt del Scheduling de puntos: trozos de la pantalla (barra de vista/zoom/orden/día,
// tooltip, panel de detalle y reasignación, jornada media y tareas sin asignar).


import { ChevronLeft, ChevronRight, Minus, Plus, Rows2, Rows3, TriangleAlert } from "lucide-react";
import { minToTime } from "../vrp-engine.js";
import { C, barrioColor, fmtDurHM, mono } from "./estilo.js";
import { ROW_H, UNASSIGNED_RENDER_CAP, ZOOM_STEPS } from "./gantt-comun.js";
import { ClockBadge } from "./kpi-bar.jsx";

export function BarraGantt({ cambiarVista, compactDayNav, days, nombreDia = d => `Día ${d + 1}`, ganttSort, pxPerMin, selectedDay, setCompactDayNav, setGanttSort, setSelectedDay, setZoom, totals, vista, zoomIn, zoomLabel, zoomOut }) {
  const etiqueta = txt => <span style={{ fontSize: 12, color: C.dim, marginRight: 2 }}>{txt}</span>;
  const pequeno = { height: 26, fontSize: 12 };
  return (
    <>
      {/* ── Toolbar ── */}
      <div style={{
        flexShrink: 0, background: C.bg, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", flexWrap: "wrap",
      }}>
        <div className="op-seg">
          {[["tabla", "Tabla"], ["compacta", "Compacta"]].map(([v, l]) => (
            <button key={v} onClick={() => cambiarVista(v)} className={vista === v ? "op-on" : ""}>{l}</button>
          ))}
        </div>
        <div className="op-sep" />
        {etiqueta("Zoom")}
        <div className="op-seg">
          <button onClick={zoomOut} title="Alejar"><Minus size={13} style={{ verticalAlign: "-2px" }} /></button>
          {ZOOM_STEPS.map(z => <button key={z} onClick={() => setZoom(z)} className={pxPerMin === z ? "op-on" : ""}>{z}×</button>)}
          <button onClick={zoomIn} title="Acercar"><Plus size={13} style={{ verticalAlign: "-2px" }} /></button>
        </div>
        <span style={{ fontSize: 12, color: C.muted, minWidth: 30 }}>{zoomLabel}</span>
        <div className="op-sep" />
        {etiqueta("Ordenar")}
        <div className="op-seg">
          {[
            { key: "salida_asc", label: "Salida ↑" },
            { key: "salida_desc", label: "Salida ↓" },
            { key: "servicio_asc", label: "1ª parada ↑" },
            { key: "servicio_desc", label: "1ª parada ↓" },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setGanttSort(s => s === key ? "default" : key)} className={ganttSort === key ? "op-on" : ""}>{label}</button>
          ))}
        </div>

        {totals.conAviso > 0 && (
          <span title="Filas del día con avisos de reglas — mira la columna ! de la tabla" style={{ marginLeft: 4, fontSize: 12, color: C.red, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <TriangleAlert size={13} /> {totals.conAviso} con avisos
          </span>
        )}

        {days > 1 && <>
          <div className="op-sep" style={{ marginLeft: "auto" }} />
          <button onClick={() => setSelectedDay(d => Math.max(0, d - 1))} disabled={selectedDay === 0} className="op-btn op-fantasma op-icono" style={{ ...pequeno, width: 26 }} title="Día anterior"><ChevronLeft size={15} /></button>
          {compactDayNav ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="number" min="1" max={days} value={selectedDay + 1}
                onChange={e => { const v = parseInt(e.target.value, 10) - 1; if (v >= 0 && v < days) setSelectedDay(v); }}
                className="op-input" style={{ width: 56, height: 26, padding: "0 6px", textAlign: "center", fontSize: 12, fontWeight: 600 }} />
              <span style={{ fontSize: 12, color: C.dim }}>de {days}</span>
            </div>
          ) : (
            <div className="op-seg">
              {Array.from({ length: days }, (_, d) => (
                <button key={d} onClick={() => setSelectedDay(d)} className={selectedDay === d ? "op-on" : ""}>{nombreDia(d)}</button>
              ))}
            </div>
          )}
          <button onClick={() => setSelectedDay(d => Math.min(days - 1, d + 1))} disabled={selectedDay === days - 1} className="op-btn op-fantasma op-icono" style={{ ...pequeno, width: 26 }} title="Día siguiente"><ChevronRight size={15} /></button>
          <button onClick={() => setCompactDayNav(v => !v)} title={compactDayNav ? "Mostrar todos los días" : "Ocultar días"} className="op-btn op-fantasma op-icono" style={{ ...pequeno, width: 26 }}>
            {compactDayNav ? <Rows3 size={14} /> : <Rows2 size={14} />}
          </button>
        </>}
      </div>
    </>
  );
}

export function TooltipGantt({ allVehicles, allWorkers, dragging, mode, stackPanel, tooltip }) {
  return (
    <>
      {/* Hover Tooltip */}
      {tooltip && !dragging && !stackPanel && (
        <div style={{
          position: "fixed",
          left: Math.min(tooltip.x + 14, window.innerWidth - 270),
          top: Math.max(tooltip.y - 70, 8),
          background: C.card, border: `1px solid ${C.border2}`,
          borderRadius: 9, padding: "11px 14px", zIndex: 2000,
          boxShadow: "0 8px 28px rgba(0,0,0,.6)",
          fontSize: 12, color: C.text, minWidth: 190, maxWidth: 270,
          pointerEvents: "none", animation: "sched-fadein .1s ease both",
        }}>
          {tooltip.task._travel ? (() => {
            // vacío: de dónde a dónde, cuándo, cuántos km y minutos
            const t = tooltip.task, lista = tooltip.row?.assignments || [];
            const i = lista.indexOf(t);
            const esParada = a => a && !a._travel && !a._break && !a._wait;
            const nombre = a => a ? (a.nombre || Object.entries(a.campos || {}).find(([k]) => ["pa", "idsap", "id_sap", "codigopoint", "codigo"].includes(k.toLowerCase()))?.[1] || a.barrio || "parada") : null;
            const antes = i > 0 ? [...lista.slice(0, i)].reverse().find(esParada) : null;
            const despues = i >= 0 ? lista.slice(i + 1).find(esParada) : null;
            const desde = t._depot_exit ? "Cochera" : nombre(antes) || "—";
            const hasta = t._depot_return ? "Cochera" : nombre(despues) || "—";
            return (
              <>
                <div style={{ fontSize: 11, color: t._depot_exit || t._depot_return ? C.amber : C.muted, marginBottom: 4, fontWeight: 600 }}>
                  {t._depot_exit ? "Salida de cochera" : t._depot_return ? "Vuelta a cochera" : t._a_planta ? "Viaje a descargar" : "Vacío entre paradas"}
                </div>
                <div style={{ fontWeight: 650, color: C.text, fontSize: 13, marginBottom: 4 }}>{desde} → {hasta}</div>
                <div style={{ color: C.muted, fontSize: 11.5 }}>
                  {minToTime(t._start % 1440)} → {minToTime(t._end % 1440)} · {t.duracion || 0} min{t.km != null ? ` · ${t.km.toFixed(1).replace(".", ",")} km` : ""}
                </div>
              </>
            );
          })() : <>
          {tooltip.task.barrio && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: barrioColor(tooltip.task.barrio), flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: C.muted }}>{tooltip.task.barrio}</span>
            </div>
          )}
          <div style={{ fontWeight: 700, marginBottom: 4, color: C.text, fontSize: 13 }}>
            {tooltip.task.nombre
              || Object.entries(tooltip.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
              || tooltip.task.barrio || "Parada"}
          </div>
          <div style={{ color: C.muted, fontFamily: mono, fontSize: 11, marginBottom: 3 }}>
            {minToTime(tooltip.task._start % 1440)} → {minToTime(tooltip.task._end % 1440)}
            <span style={{ color: C.dim }}> · {tooltip.task.duracion || 15} min</span>
          </div>
          {(() => {
            const campos = tooltip.task.campos || {};
            const calle  = Object.entries(campos).find(([k]) => k.toLowerCase() === "calle")?.[1];
            const num    = Object.entries(campos).find(([k]) => ["num","num.","número","numero"].includes(k.toLowerCase()))?.[1];
            return calle ? <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{calle}{num ? ` ${num}` : ""}</div> : null;
          })()}
          </>}
          {(() => {
            const row = tooltip.row;
            if (!row) return null;
            if (mode === "vehicles") {
              const linked = allWorkers.find(w => w.vehiculoId === (row._id || row.id));
              if (!linked) return null;
              const name = [linked.nombre, linked.apellidos].filter(Boolean).join(" ");
              return (
                <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.green, fontWeight: 700, flexShrink: 0 }}>{name[0]}</div>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Conductor asignado</div>
                    <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{name}</div>
                  </div>
                </div>
              );
            }
            if (mode === "workers") {
              const vId = row.vehiculoId;
              if (!vId) return null;
              const v = allVehicles.find(v => (v._id || v.id) === vId);
              if (!v) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blue, fontWeight: 700, flexShrink: 0 }}>🚛</div>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Vehículo asignado</div>
                    <div style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` · ${v.matricula}` : ""}</div>
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}
    </>
  );
}

export function PanelDetalleGantt({ attemptMove, closePanel, movePreview, onScheduleChange, rejectMove, rows, stackPanel }) {
  return (
    <>
      {/* Stack panel — click-open detail + reassign */}
      {stackPanel && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 300,
          background: C.card, borderLeft: `1px solid ${C.border2}`,
          zIndex: 3000, overflowY: "auto",
          boxShadow: "-8px 0 40px rgba(0,0,0,.55)",
          animation: "sched-fadein .15s ease both",
        }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
            {stackPanel.task.barrio && (
              <div style={{ width: 12, height: 12, borderRadius: 3, background: barrioColor(stackPanel.task.barrio), flexShrink: 0, marginTop: 2 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                {stackPanel.task.nombre
                  || Object.entries(stackPanel.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
                  || stackPanel.task.barrio || "Parada"}
              </div>
              {stackPanel.task.barrio && <div style={{ fontSize: 10, color: C.muted }}>{stackPanel.task.barrio}</div>}
            </div>
            <button onClick={closePanel} style={{ background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
          </div>

          {/* Time + assigned resource */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
              {minToTime(stackPanel.task._start % 1440)} → {minToTime(stackPanel.task._end % 1440)}
              <span style={{ color: C.dim }}> · {stackPanel.task.duracion || 15} min</span>
            </div>
            {stackPanel.task._start >= 1440 && (
              <div style={{ fontSize: 10, color: C.amber, marginTop: 3 }}>⏱ Turno de noche (continúa desde noche anterior)</div>
            )}
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blueText, fontWeight: 700, flexShrink: 0 }}>
                {(stackPanel.row.nombre || "?")[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.dim }}>Asignado a</div>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                  {[stackPanel.row.nombre, stackPanel.row.apellidos].filter(Boolean).join(" ") || stackPanel.row.matricula || "?"}
                </div>
              </div>
            </div>
          </div>

          {/* Reasignar — huecos calculados por openTaskPanel; también se
              pueden ver y elegir directamente sobre el Gantt (resaltado). */}
          {onScheduleChange && rows.length > 1 && (
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>Mover a</div>
              <div style={{ fontSize: 9.5, color: C.dim, marginBottom: 8, lineHeight: 1.4 }}>
                Los huecos válidos también se resaltan en el Gantt — haz clic ahí para elegir un momento concreto.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {rows.filter(r => (r._id || r.id) !== (stackPanel.row._id || stackPanel.row.id)).map(r => {
                  const slots = movePreview?.slotsByRowId.get(r._id || r.id) || [];
                  const best = slots.length ? slots.reduce((a, b) => b.kmDelta < a.kmDelta ? b : a) : null;
                  return (
                    <button key={r._id || r.id} disabled={!best} onClick={() => {
                      if (!best) { rejectMove(); return; }
                      attemptMove(stackPanel.task, stackPanel.row, r, best, movePreview.dayOffset);
                    }} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                      background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7,
                      cursor: best ? "pointer" : "not-allowed", textAlign: "left", transition: "border-color .1s",
                      opacity: best ? 1 : 0.45,
                    }}
                      onMouseEnter={e => best && (e.currentTarget.style.borderColor = C.blue)}
                      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                    >
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.surface2, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.muted, fontWeight: 700 }}>
                        {(r.nombre || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                          {[r.nombre, r.apellidos].filter(Boolean).join(" ") || r.matricula || "?"}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim }}>
                          {best
                            ? `${best.kmDelta >= 0 ? "+" : ""}${best.kmDelta.toFixed(2)} km${best.wait > 0 ? ` · espera ${best.wait} min` : ""}`
                            : "Sin hueco disponible"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* All campos */}
          {Object.keys(stackPanel.task.campos || {}).length > 0 && (
            <div style={{ padding: "10px 16px" }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Datos</div>
              {Object.entries(stackPanel.task.campos).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                  <span style={{ color: C.dim, minWidth: 80, flexShrink: 0, textOverflow: "ellipsis", overflow: "hidden" }}>{k}</span>
                  <span style={{ color: C.text, fontWeight: 500, wordBreak: "break-all" }}>{String(v)}</span>
                </div>
              ))}
              {stackPanel.task.lat && stackPanel.task.lng && (
                <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                  <span style={{ color: C.dim, minWidth: 80 }}>Coords</span>
                  <span style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>{(+stackPanel.task.lat).toFixed(5)}, {(+stackPanel.task.lng).toFixed(5)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function PieGantt({ dragging, jornadaStats, setDragging, setUnassignedOpen, unassigned, unassignedOpen }) {
  return (
    <>
      {/* ── Jornada media del día — indicador rápido para detectar turnos
          descompensados (p.ej. mañana llena y tarde casi vacía) de un
          vistazo, sin tener que abrir cada fila una a una. ── */}
      {jornadaStats && (
        <div style={{
          flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}`,
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>Jornada media</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.blueText, fontFamily: mono }}>{fmtDurHM(jornadaStats.avg)}</span>
          <span style={{ fontSize: 11, color: C.dim, fontFamily: mono }}>
            mín {fmtDurHM(jornadaStats.min)} · máx {fmtDurHM(jornadaStats.max)}
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            {jornadaStats.count} turno{jornadaStats.count !== 1 ? "s" : ""} con paradas
          </span>
          {jornadaStats.max - jornadaStats.min > 120 && (
            <span style={{ fontSize: 10.5, color: C.amber, display: "flex", alignItems: "center", gap: 4 }} title="Hay más de 2h de diferencia entre el turno más corto y el más largo del día">
              ⚠ turnos descompensados
            </span>
          )}
        </div>
      )}

      {/* ── Sin asignar — stack arrastrable para colocarlas a mano ── */}
      {unassigned.length > 0 && (
        <div style={{ flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setUnassignedOpen(o => !o)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "6px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ fontSize: 10.5, color: C.red, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700 }}>Sin asignar</span>
            <span style={{ background: "rgba(242,109,109,0.12)", border: "1px solid rgba(242,109,109,0.3)", color: C.red, borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{unassigned.length}</span>
            <span style={{ fontSize: 10, color: C.dim }}>arrastra una parada a una fila para colocarla</span>
            <span style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>{unassignedOpen ? "▲" : "▼"}</span>
          </button>
          {unassignedOpen && (
            <div style={{ padding: "6px 16px 10px", display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflowY: "auto" }}>
              {/* Con proyectos grandes puede haber miles de paradas sin
                  asignar — pintar todas de golpe (cada una arrastrable)
                  mete miles de nodos DOM y vuelve la pestaña lentísima.
                  Este stack es para colocar a mano las últimas que quedan,
                  no para miles a la vez, así que se limita el pintado. */}
              {unassigned.slice(0, UNASSIGNED_RENDER_CAP).map((task, i) => {
                const hasWindow = task.windowStart != null;
                const label = task.nombre || task.barrio || task.id || "?";
                const color = barrioColor(task.barrio);
                return (
                  <div key={task.id || i}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragging({ task, fromRowId: null }); }}
                    onDragEnd={() => setDragging(null)}
                    title={hasWindow ? `Franja ${minToTime(task.windowStart % 1440)}–${minToTime((task.windowEnd ?? task.windowStart) % 1440)}` : label}
                    style={{
                      position: "relative", height: ROW_H - 22, minWidth: 60, background: color + "d0",
                      border: `1px solid ${color}`, borderRadius: 4, overflow: "visible", cursor: "grab",
                      display: "flex", alignItems: "center", gap: 3, padding: "0 6px",
                      opacity: dragging?.task === task ? 0.4 : 1,
                    }}
                  >
                    {hasWindow && <ClockBadge size={10} />}
                    <div style={{ width: 3, height: "60%", borderRadius: 2, background: "#fff", opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 10.5, color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
                  </div>
                );
              })}
              {unassigned.length > UNASSIGNED_RENDER_CAP && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10.5, color: C.dim }}>
                  +{(unassigned.length - UNASSIGNED_RENDER_CAP).toLocaleString()} más — coloca o filtra estas para ver el resto
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
