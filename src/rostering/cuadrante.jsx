// Rostering: trozos de la pantalla del cuadrante (cabecera con leyenda y botones,
// la tabla de trabajadores × días y el resumen del turno de una celda).


import { AlertTriangle, Scale, Sparkles, Users } from "lucide-react";
import { checkWorkerMonth } from "../roster-optimizer.js";
import { C, DAY_NAMES, MONTH_NAMES, SHIFTS, SHIFT_META, fmtClock, font, navBtnStyle, pubBtn, thStyle } from "./datos.js";
import { ModeTabs } from "./vehiculos.jsx";
import { tono } from "../tema.js";


export function CabeceraCuadrante({ avisoServicio, calsLineas, conSalida, coveredCount, daysInMonth, libreShifts, mode, month, nextMonth, optimizar, prevMonth, schedRoster, setMode, setShowRules, workers, year }) {
  return (
    <>
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ModeTabs mode={mode} setMode={setMode} conSalida={conSalida} />
          <button onClick={prevMonth} style={navBtnStyle}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, minWidth: 200, textAlign: "center" }}>
            {MONTH_NAMES[month - 1]} {year}
          </div>
          <button onClick={nextMonth} style={navBtnStyle}>›</button>
          <div style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>
            {workers.length} trabajadores · {daysInMonth} días
          </div>
        </div>

        {/* Legend + export */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {SHIFTS.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: SHIFT_META[s].bg,
                border: `1px solid ${SHIFT_META[s].text}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: SHIFT_META[s].text, fontWeight: 700, fontSize: 11,
              }}>{s}</div>
              <span style={{ fontSize: 11, color: C.muted }}>{SHIFT_META[s].label}</span>
            </div>
          ))}

          <button onClick={() => setShowRules(true)}
            title="Reglas del cuadrante: días seguidos, horas/mes, descanso, reparto"
            className="op-btn"><Scale size={14} />
            Reglas
          </button>

          {avisoServicio && <span style={{ fontSize: 11, color: C.green, borderLeft: `1px solid ${C.border}`, paddingLeft: 10 }}>✓ {avisoServicio}</span>}
          {calsLineas && calsLineas.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: `1px solid ${C.border}`, paddingLeft: 10, flexWrap: "wrap" }} title="Calendarios de la red de líneas que circulan este mes">
              {calsLineas.map(c => (
                <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: c.color }} />
                  {c.nombre} <span style={{ color: C.dim }}>· {c.turnos} turnos/día · {c.dias} día{c.dias === 1 ? "" : "s"}</span>
                </span>
              ))}
            </div>
          )}

          {libreShifts && (
            <span title="Turnos del escenario (modo libre) con trabajador asignado"
              style={{
                fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px",
                color: coveredCount === libreShifts.length ? C.green : C.amber,
                background: coveredCount === libreShifts.length ? `${C.green}18` : `${C.amber}18`,
              }}>
              {coveredCount}/{libreShifts.length} turnos cubiertos
            </span>
          )}

          {/* Scheduling overlay legend + optimizar */}
          {schedRoster && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: `1px solid ${C.border}`, paddingLeft: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: SHIFT_META["M"].bg + "55",
                border: `1px dashed ${SHIFT_META["M"].text}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: SHIFT_META["M"].text + "88", fontWeight: 700, fontSize: 11,
              }}>M</div>
              <span style={{ fontSize: 11, color: C.dim }}>= planificado</span>
              <button
                onClick={optimizar}
                className="op-btn op-primario" style={{ marginLeft: 4 }}
                title={schedRoster.modo === "libre"
                  ? "Asigna trabajador y vehículo a cada turno del escenario respetando las Reglas"
                  : "Asigna los turnos del escenario de scheduling a los trabajadores disponibles"}
              >
                <Sparkles size={14} /> Optimizar
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function TablaCuadrante({ CELL_W, NAME_W, PUB_W, STATS_W, asign, calDeDia, calsLineas, coveredIds, dayTotals, days, daysInMonth, fillRow, getDow, grid, handleCellMouseDown, handleCellMouseEnter, handleKeyDown, horasPorTrabajador, isCellSelected, isToday, isWeekend, libreShifts, linkWorker, loading, month, publicados, publishing, rules, scheduledCode, setPublishModal, setSelEnd, setSelStart, setSummaryCell, suggestUser, tableRef, usuarios, workedInterval, workerStats, workers, year }) {
  return (
    <>
      {/* ── GRID ────────────────────────────────────────────────── */}
      <div ref={tableRef} tabIndex={0} onKeyDown={handleKeyDown}
        style={{ flex: 1, overflow: "auto", outline: "none" }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setSelStart(null); setSelEnd(null); } }}
      >
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13 }}>
            Cargando…
          </div>
        ) : workers.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13, gap: 8 }}>
            <Users size={32} color={C.dim} />
            <div>Sin trabajadores. Añade trabajadores en el módulo de Rutas.</div>
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NAME_W + daysInMonth * CELL_W + STATS_W + PUB_W }}>
            <thead>
              <tr>
                {/* Name header */}
                <th style={{
                  ...thStyle, width: NAME_W, minWidth: NAME_W,
                  position: "sticky", left: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "left",
                  padding: "6px 12px", borderRight: `1px solid ${C.border2}`,
                }}>
                  Trabajador
                </th>

                {/* Day headers */}
                {days.map(d => {
                  const dow     = getDow(d);
                  const weekend = isWeekend(d);
                  const today   = isToday(d);
                  return (
                    <th key={d} style={{
                      width: CELL_W, minWidth: CELL_W,
                      position: "sticky", top: 0, zIndex: 3,
                      background: today ? C.blueDim : weekend ? tono("#151922", "#ebedf2") : C.card,
                      borderBottom: `2px solid ${today ? C.blue : C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      padding: "3px 0", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: today ? C.blue : weekend ? C.orange : C.dim }}>
                        {DAY_NAMES[dow]}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: today ? 700 : 500, color: today ? C.blue : weekend ? `${C.orange}88` : C.muted }}>
                        {d}
                      </div>
                      {calsLineas && (() => {
                        const cal = calDeDia(d);
                        const deDia = cal ? libreShifts?.filter(sh => sh.d === d) || [] : [];
                        const cubiertos = deDia.filter(sh => coveredIds.has(sh.id)).length;
                        return (
                          <div title={cal ? `${cal.nombre}: ${deDia.length} turnos · ${cubiertos} cubiertos` : "Sin servicio"}
                            style={{ margin: "2px auto 0", width: CELL_W - 6, height: 5, borderRadius: 2, background: cal ? cal.color : "transparent", border: cal ? "none" : `1px dashed ${C.border}`, opacity: cal && cubiertos < deDia.length ? 0.55 : 1 }} />
                        );
                      })()}
                    </th>
                  );
                })}

                {/* Stats header */}
                <th style={{
                  ...thStyle, width: STATS_W, minWidth: STATS_W,
                  position: "sticky", right: PUB_W, top: 0, zIndex: 5,
                  background: C.card, textAlign: "center",
                  borderLeft: `1px solid ${C.border2}`,
                }}>
                  Resumen mes
                </th>

                {/* Publicar a Rutas */}
                <th style={{
                  ...thStyle, width: PUB_W, minWidth: PUB_W,
                  position: "sticky", right: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "center",
                  borderLeft: `1px solid ${C.border}`,
                }}>
                  <div>Rutas</div>
                  <button disabled={!!publishing || !workers.some(w => w.uid)}
                    onClick={() => setPublishModal({ targets: workers.filter(w => w.uid) })}
                    title="Publica en Rutas las rutas y el cuadrante de todos los trabajadores vinculados a un usuario"
                    style={{ ...pubBtn, marginTop: 3, opacity: workers.some(w => w.uid) ? 1 : 0.4 }}>
                    {publishing || "Publicar todos"}
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {workers.map((w, wi) => {
                const stats = workerStats(w._id);
                const check = checkWorkerMonth(d => workedInterval(w._id, d), daysInMonth, rules, +horasPorTrabajador[w._id] || 0, { year, month });
                const ruleIssues = check.issues;
                const rowBg = wi % 2 === 0 ? C.bg : tono("#12161f", "#eaedf3");
                const shiftMeta = w.turno ? SHIFT_META[w.turno] : null;

                return (
                  <tr key={w._id}>
                    {/* Worker name */}
                    <td style={{
                      position: "sticky", left: 0, zIndex: 2,
                      background: rowBg, height: 32,
                      borderRight: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 10px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {shiftMeta && (
                          <div style={{
                            width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                            background: shiftMeta.bg,
                            border: `1px solid ${shiftMeta.text}44`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: shiftMeta.text, fontWeight: 700, fontSize: 9,
                          }}>{w.turno}</div>
                        )}
                        <span style={{
                          fontSize: 12, color: C.text, fontWeight: 500,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: NAME_W - 60, cursor: "default",
                        }}
                          title={`${w.nombre ?? ""} ${w.apellidos ?? ""} — clic derecho en celdas para borrar`}
                        >
                          {[w.nombre, w.apellidos].filter(Boolean).join(" ")}
                        </span>
                        {/* Quick-fill button */}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                          {["M","T","N"].map(s => (
                            <button key={s} onClick={() => fillRow(w._id, s)}
                              title={`Rellenar mes con ${SHIFT_META[s].label}`}
                              style={{
                                width: 14, height: 14, borderRadius: 2, border: "none",
                                background: SHIFT_META[s].bg, color: SHIFT_META[s].text,
                                fontSize: 8, fontWeight: 700, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                padding: 0, lineHeight: 1,
                              }}
                            >{s}</button>
                          ))}
                        </div>
                      </div>
                    </td>

                    {/* Shift cells */}
                    {days.map((d, dIdx) => {
                      const shift    = grid[w._id]?.[String(d)] ?? "";
                      const sched    = scheduledCode(w._id, d); // from scheduling scenario
                      const display  = shift || sched;
                      const isManual = !!shift;
                      const meta     = display ? SHIFT_META[display] : null;
                      const weekend  = isWeekend(d);
                      const today    = isToday(d);
                      const selected = isCellSelected(wi, dIdx);

                      return (
                        <td key={d}
                          data-cell={`${w._id}:${d}`}
                          onMouseDown={e => handleCellMouseDown(e, wi, dIdx)}
                          onMouseEnter={e => { handleCellMouseEnter(wi, dIdx); e.currentTarget.style.filter = "brightness(1.35)"; }}
                          onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
                          onContextMenu={e => {
                            e.preventDefault();
                            setSummaryCell({ workerId: w._id, day: d, x: e.clientX, y: e.clientY });
                          }}
                          title={shift
                            ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[shift].label}` +
                              (asign[w._id]?.[String(d)]
                                ? ` · ${asign[w._id][String(d)].vn} ${fmtClock(asign[w._id][String(d)].s)}–${fmtClock(asign[w._id][String(d)].e)} (optimizado)`
                                : "")
                            : sched
                              ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[sched].label} (planificado)`
                              : `Día ${d} · sin asignar — selecciona y escribe M/T/N/L/G/B/D`}
                          style={{
                            width: CELL_W, minWidth: CELL_W, height: 32,
                            textAlign: "center", fontSize: 11, fontWeight: 700,
                            cursor: "pointer",
                            background: meta
                              ? (isManual ? meta.bg : meta.bg + "55")
                              : (today ? tono("#0e2040", "#e4ecf8") : weekend ? tono("#141c30", "#e8ecf5") : "transparent"),
                            color: meta ? (isManual ? meta.text : meta.text + "88") : C.dim,
                            borderRight: !isManual && sched
                              ? `1px dashed ${SHIFT_META[sched].text}44`
                              : `1px solid ${C.border}`,
                            borderBottom: `1px solid ${C.border}`,
                            transition: "filter .1s",
                            userSelect: "none",
                            position: "relative",
                          }}
                        >
                          {display}
                          {asign[w._id]?.[String(d)] && (
                            <div title="Asignado por Optimizar" style={{
                              position: "absolute", top: 3, right: 3, width: 4, height: 4,
                              borderRadius: 2, background: C.blue, pointerEvents: "none",
                            }} />
                          )}
                          {selected && (
                            <div style={{
                              position: "absolute", inset: 0, pointerEvents: "none",
                              boxShadow: `inset 0 0 0 2px ${C.blue}`,
                              background: "rgba(79,142,247,0.12)",
                            }} />
                          )}
                        </td>
                      );
                    })}

                    {/* Worker stats */}
                    <td style={{
                      position: "sticky", right: PUB_W, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 8px",
                    }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
                        {check.hours > 0 && (
                          <span title={ruleIssues.length ? ruleIssues.join(" · ") : `${check.hours}h de ${check.cap}h · máx. ${check.maxRun} días seguidos`}
                            style={{
                              fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "0 4px",
                              color: ruleIssues.length ? C.red : C.muted,
                              background: ruleIssues.length ? `${C.red}22` : "transparent",
                            }}>
                            {ruleIssues.length ? <AlertTriangle size={11} style={{ verticalAlign: "-1px", marginRight: 2 }} /> : null}{Math.round(check.hours)}h
                          </span>
                        )}
                        {SHIFTS.filter(s => stats[s]).map(s => (
                          <div key={s} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                            <span style={{ color: SHIFT_META[s].text, fontWeight: 700 }}>{s}</span>
                            <span style={{ color: C.dim }}>{stats[s]}</span>
                          </div>
                        ))}
                        {Object.keys(stats).length === 0 && (
                          <span style={{ color: C.dim, fontSize: 10 }}>—</span>
                        )}
                      </div>
                    </td>

                    {/* Publicar a Rutas: vincular con su usuario de la app + publicar */}
                    <td style={{
                      position: "sticky", right: 0, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 6px", textAlign: "center",
                    }}>
                      {w.uid ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                          <button disabled={!!publishing} onClick={() => setPublishModal({ targets: [w] })}
                            title={`Enviar a conductores a ${usuarios.find(u => u._id === w.uid)?.email || "su usuario"}`}
                            style={pubBtn}>
                            Publicar
                          </button>
                          {publicados[w.uid] && (
                            <span title={`Publicado ${new Date(publicados[w.uid]).toLocaleString()}`}
                              style={{ fontSize: 10, color: C.green }}>✓</span>
                          )}
                          <button onClick={() => { if (confirm("¿Desvincular este trabajador de su usuario de la app?")) linkWorker(w._id, null); }}
                            title="Desvincular usuario" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 11, padding: 0 }}>×</button>
                        </div>
                      ) : (
                        <select value="" onChange={e => e.target.value && linkWorker(w._id, e.target.value)}
                          title="Vincula el trabajador con su usuario de la app para poder publicarle sus rutas"
                          style={{ width: "100%", background: C.surface2, border: `1px dashed ${C.border2}`, color: C.muted, borderRadius: 5, fontSize: 10.5, padding: "3px 4px", fontFamily: font, cursor: "pointer" }}>
                          <option value="">Vincular usuario…</option>
                          {(() => {
                            const sug = suggestUser(w);
                            const linked = new Set(workers.map(x => x.uid).filter(Boolean));
                            return [
                              ...(sug ? [<option key={"s" + sug._id} value={sug._id}>{[sug.nombre, sug.apellidos].filter(Boolean).join(" ")} (sugerido)</option>] : []),
                              ...usuarios.filter(u => !linked.has(u._id) && u._id !== sug?._id).map(u => (
                                <option key={u._id} value={u._id}>{[u.nombre, u.apellidos].filter(Boolean).join(" ") || u.email}</option>
                              )),
                            ];
                          })()}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr>
                <td style={{
                  position: "sticky", left: 0, zIndex: 2,
                  background: C.surface2, borderRight: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.border2}`,
                  padding: "0 12px", height: 38,
                  fontSize: 10, color: C.muted, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  Totales día
                </td>
                {days.map(d => {
                  const totals = dayTotals(d);
                  const today  = isToday(d);
                  return (
                    <td key={d} style={{
                      width: CELL_W, textAlign: "center", height: 38,
                      background: today ? C.blueDim : C.surface2,
                      borderRight: `1px solid ${C.border}`,
                      borderTop: `2px solid ${C.border2}`,
                      verticalAlign: "middle", padding: "2px 0",
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        {SHIFTS.filter(s => totals[s]).map(s => (
                          <div key={s} style={{ fontSize: 9, fontWeight: 700, color: SHIFT_META[s].text, lineHeight: 1.2 }}>
                            {s}{totals[s] > 1 ? <span style={{ fontSize: 8, fontWeight: 400 }}>×{totals[s]}</span> : ""}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
                <td style={{
                  position: "sticky", right: PUB_W, zIndex: 2,
                  background: C.surface2, borderLeft: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.border2}`,
                }}/>
                <td style={{
                  position: "sticky", right: 0, zIndex: 2,
                  background: C.surface2, borderLeft: `1px solid ${C.border}`,
                  borderTop: `2px solid ${C.border2}`,
                }}/>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function PieYResumen({ asign, getDow, grid, month, schedDayFor, schedRoster, scheduledCode, selectedCount, setSummaryCell, summaryCell, workers, year }) {
  return (
    <>
      {/* ── FOOTER HINT ─────────────────────────────────────────── */}
      {(() => {
        const n = selectedCount();
        return (
          <div style={{
            flexShrink: 0, padding: "5px 16px",
            background: C.card, borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 20, fontSize: 10, color: C.dim, alignItems: "center",
          }}>
            {n > 1 ? (
              <>
                <span style={{ color: C.blue, fontWeight: 600 }}>{n} celdas seleccionadas</span>
                <span>Escribe <b style={{color:C.muted}}>M T N L G B D</b> para asignar a todas · <b style={{color:C.muted}}>Supr</b> para borrar · <b style={{color:C.muted}}>Esc</b> para deseleccionar</span>
              </>
            ) : (
              <>
                <span>Clic o arrastra para seleccionar · <b style={{color:C.muted}}>Shift+clic</b> para extender</span>
                <span>Escribe <b style={{color:C.muted}}>M T N L G B D</b> · <b style={{color:C.muted}}>Supr</b> para borrar · Flechas para navegar</span>
                <span>Botones M/T/N en el nombre → rellenar mes completo</span>
                <span>Clic derecho → resumen del turno</span>
              </>
            )}
          </div>
        );
      })()}

      {/* ── RESUMEN DEL TURNO (clic derecho en una celda) ──────────── */}
      {summaryCell && (() => {
        const w = workers.find(w => w._id === summaryCell.workerId);
        if (!w) return null;
        const { day } = summaryCell;
        const shift  = grid[w._id]?.[String(day)] ?? "";
        const sched  = scheduledCode(w._id, day);
        const code   = shift || sched;
        const meta   = code ? SHIFT_META[code] : null;
        const dayNum = schedDayFor(day);
        const detail = dayNum ? schedRoster?.dailyDetail?.[w._id]?.[String(dayNum)] : null;
        const dow    = DAY_NAMES[getDow(day)];

        // Clamp near viewport edges so el popup no se salga de la pantalla
        const PW = 260, PH = 260;
        const left = Math.min(summaryCell.x, window.innerWidth  - PW - 12);
        const top  = Math.min(summaryCell.y, window.innerHeight - PH - 12);

        return (
          <>
            <div onClick={() => setSummaryCell(null)}
              style={{ position: "fixed", inset: 0, zIndex: 998 }} />
            <div style={{
              position: "fixed", left, top, zIndex: 999, width: PW,
              background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10,
              boxShadow: "0 12px 36px rgba(0,0,0,.5)", padding: 14, fontFamily: font,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  {[w.nombre, w.apellidos].filter(Boolean).join(" ") || "Trabajador"}
                </div>
                <button onClick={() => setSummaryCell(null)} style={{
                  background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, lineHeight: 1,
                }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                {dow} {day} de {MONTH_NAMES[month - 1]} {year}
              </div>

              {meta ? (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10,
                  background: meta.bg, border: `1px solid ${meta.text}44`, borderRadius: 6,
                  padding: "3px 9px",
                }}>
                  <span style={{ color: meta.text, fontWeight: 700, fontSize: 12 }}>{code}</span>
                  <span style={{ color: meta.text, fontSize: 11 }}>{meta.label}</span>
                  {!shift && sched && <span style={{ color: C.dim, fontSize: 10 }}>(planificado)</span>}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>Sin turno asignado.</div>
              )}

              {asign[w._id]?.[String(day)] ? (() => {
                const a = asign[w._id][String(day)];
                const sh = (schedRoster?.shifts || []).find(x => x.id === a.id);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Vehículo</span>
                      <span style={{ color: C.text }}>{a.vn}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Horario</span>
                      <span style={{ color: C.text, fontFamily: "var(--mono)" }}>
                        {fmtClock(a.s)} – {fmtClock(a.e)}
                      </span>
                    </div>
                    {sh && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: C.dim }}>Paradas · km</span>
                        <span style={{ color: C.text }}>{sh.st} · {sh.km}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: C.dim }}>Asignado por Optimizar — editar la celda lo anula.</div>
                  </div>
                );
              })() : detail ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Horario</span>
                    <span style={{ color: C.text, fontFamily: "var(--mono)" }}>
                      {fmtClock(detail.start)} – {fmtClock(detail.end)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Paradas</span>
                    <span style={{ color: C.text }}>{detail.stops}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Km</span>
                    <span style={{ color: C.text }}>{detail.km}</span>
                  </div>
                  {detail.vehiculo && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Vehículo</span>
                      <span style={{ color: C.text }}>{detail.vehiculo}</span>
                    </div>
                  )}
                </div>
              ) : sched ? (
                <div style={{ fontSize: 10, color: C.dim }}>
                  Sin detalle de paradas/km guardado — regenera el escenario en Rutas para verlo aquí.
                </div>
              ) : null}
            </div>
          </>
        );
      })()}
    </>
  );
}
