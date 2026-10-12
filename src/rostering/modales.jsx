// Rostering: ventanas de Reglas, Publicar a Rutas y resultado de Optimizar.
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase.js";
import { describeReasons, DEFAULT_ROSTER_RULES, ESTATUTO_RULES, ESTATUTO_ARTS } from "../roster-optimizer.js";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { C, PDF_CHUNK, PDF_MAX_BYTES, RULE_FIELDS, TIPOS_RUTA, fmtClock, font, parseFestivos, primaryBtn, secondaryBtn, inputStyle } from "./datos.js";

export function RulesModal({ rules, horas, convenio, workers, orgId, onClose, onSave }) {
  const [r, setR] = useState({ ...DEFAULT_ROSTER_RULES, ...rules });
  const [h, setH] = useState(horas);
  const [cv, setCv] = useState({ arts: {}, ...convenio });
  const [festText, setFestText] = useState((rules.festivos || []).join(", "));
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null); // texto de progreso
  const fileRef = useRef(null);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function uploadPdf(file) {
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Sube el convenio en PDF."); return; }
    if (file.size > PDF_MAX_BYTES) { alert("El PDF pasa de 10 MB — sube una versión más ligera."); return; }
    setPdfBusy("Subiendo convenio…");
    try {
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const n = Math.ceil(b64.length / PDF_CHUNK);
      const uploadId = Date.now().toString(36);
      for (let i = 0; i < n; i++) {
        setPdfBusy(`Subiendo convenio… ${i + 1}/${n}`);
        await setDoc(doc(db, "rostering", `${orgId}_convenio_pdf_${uploadId}_${i}`), {
          org_id: orgId, i, data: b64.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK),
        });
      }
      setCv(c => ({ ...c, pdf: { name: file.name, size: file.size, chunks: n, uploadId, uploadedAt: new Date().toISOString() } }));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(file)); // se abre ya, sin volver a descargarlo
    } catch (e) {
      alert("No se pudo subir el convenio: " + (e.message || e));
    } finally {
      setPdfBusy(null);
    }
  }

  async function openPdf() {
    if (pdfUrl || !cv.pdf?.chunks) return;
    setPdfBusy("Abriendo convenio…");
    try {
      let b64 = "";
      for (let i = 0; i < cv.pdf.chunks; i++) {
        const snap = await getDoc(doc(db, "rostering", `${orgId}_convenio_pdf_${cv.pdf.uploadId}_${i}`));
        b64 += snap.data()?.data || "";
      }
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
    } catch (e) {
      alert("No se pudo abrir el convenio: " + (e.message || e));
    } finally {
      setPdfBusy(null);
    }
  }

  function fillEstatuto() {
    const next = { ...r };
    const arts = { ...(cv.arts || {}) };
    for (const [k, v] of Object.entries(ESTATUTO_RULES)) {
      next[k] = v;
      if (!arts[k]) arts[k] = ESTATUTO_ARTS[k];
    }
    setR(next);
    setCv({ ...cv, arts });
  }

  function save() {
    onSave({ ...r, festivos: parseFestivos(festText) }, h, cv);
  }

  const setArt = (key, val) => setCv({ ...cv, arts: { ...(cv.arts || {}), [key]: val } });
  const meta = (key, placeholder, width = "100%") => (
    <input value={cv[key] || ""} placeholder={placeholder}
      onChange={e => setCv({ ...cv, [key]: e.target.value })}
      style={{ ...inputStyle, width }} />
  );
  const sectionTitle = t => (
    <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, margin: "14px 0 6px" }}>{t}</div>
  );

  return (
    <ModalShell title="Reglas del cuadrante" onClose={onClose} width={pdfUrl ? 1280 : 640}>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
        {pdfUrl && (
          <div style={{ flex: "1 1 520px", minHeight: 520, display: "flex", flexDirection: "column" }}>
            <iframe title="Convenio" src={pdfUrl}
              style={{ flex: 1, width: "100%", minHeight: 520, border: `1px solid ${C.border}`, borderRadius: 6, background: "#fff" }} />
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>
              Ctrl+F dentro del documento para buscar lo que indica cada regla.
            </div>
          </div>
        )}

        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          {/* ── Convenio ── */}
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
            Sube el convenio colectivo y rellena cada regla con lo que dice, anotando el artículo.
            Se aplican al pulsar <b style={{ color: C.muted }}>Optimizar</b> y se comprueban siempre en la columna de resumen.
            0 = no se aplica.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
              onChange={e => { uploadPdf(e.target.files?.[0]); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={!!pdfBusy} style={secondaryBtn}>
              {cv.pdf ? "Cambiar PDF del convenio" : "Subir PDF del convenio"}
            </button>
            {cv.pdf && !pdfUrl && (
              <button onClick={openPdf} disabled={!!pdfBusy} style={secondaryBtn}>Abrir al lado</button>
            )}
            {pdfUrl && <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} style={secondaryBtn}>Cerrar PDF</button>}
            <button onClick={fillEstatuto} style={secondaryBtn}
              title="Jornada diaria 9h, descanso entre jornadas 12h, descanso semanal 36h, jornada anual 1.826h">
              Rellenar mínimos del Estatuto
            </button>
            {pdfBusy && <span style={{ fontSize: 11, color: C.blue }}>{pdfBusy}</span>}
            {cv.pdf && !pdfBusy && (
              <span style={{ fontSize: 11, color: C.dim }}>{cv.pdf.name} · {(cv.pdf.size / 1024 / 1024).toFixed(1)} MB</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {meta("nombre", "Nombre del convenio")}
            {meta("codigo", "Código de convenio (REGCON)")}
            {meta("vigencia", "Vigencia (p. ej. 2025–2027)")}
            {meta("url", "Enlace BOE / BOP")}
          </div>

          {/* ── Reglas ── */}
          {sectionTitle("Reglas")}
          {RULE_FIELDS.map(f => (
            <div key={f.key} style={{ display: "grid", gridTemplateColumns: "190px 110px 1fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 12, color: C.muted }}>{f.label}</div>
                <div style={{ fontSize: 10, color: C.dim }}>Busca: {f.busca}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="number" min={0} value={r[f.key] ?? 0}
                  onChange={e => setR({ ...r, [f.key]: Math.max(0, parseFloat(e.target.value) || 0) })}
                  style={{ ...inputStyle, width: 64 }} />
                <span style={{ fontSize: 10.5, color: C.dim }}>{f.suffix}</span>
              </div>
              <input value={cv.arts?.[f.key] || ""} placeholder="Artículo (p. ej. art. 23.2)"
                onChange={e => setArt(f.key, e.target.value)}
                style={{ ...inputStyle, width: "100%" }} />
            </div>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, margin: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={!!r.equilibrar} onChange={e => setR({ ...r, equilibrar: e.target.checked })}
              style={{ accentColor: C.blue }} />
            Repartir horas y fines de semana de forma equitativa (preferencia, no obligatoria)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, margin: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={r.moverTurnos !== false} onChange={e => setR({ ...r, moverTurnos: e.target.checked })}
              style={{ accentColor: C.blue }} />
            Si un turno no se puede cubrir en su día, moverlo al día más cercano en que se pueda (Scheduling adapta la ruta)
          </label>

          {sectionTitle("Festivos (para el máximo de domingos/festivos)")}
          <textarea value={festText} onChange={e => setFestText(e.target.value)} rows={2}
            placeholder="12/10/2026, 01/11/2026, 2026-12-08…"
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: font }} />
          <div style={{ fontSize: 10.5, color: C.dim }}>
            {parseFestivos(festText).length} fecha(s) reconocida(s) — nacionales, autonómicos y locales del año.
          </div>

          {sectionTitle(`Horas/mes por trabajador (vacío = las de arriba${r.jornadaAnualH ? " y la jornada anual" : ""})`)}
          <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
            {workers.length === 0 && <div style={{ fontSize: 11, color: C.dim, padding: 6 }}>Sin trabajadores.</div>}
            {workers.map(w => (
              <div key={w._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ fontSize: 12, color: C.text }}>{[w.nombre, w.apellidos].filter(Boolean).join(" ")}</span>
                <input type="number" min={0} placeholder={String(r.maxHorasMes || "")} value={h[w._id] ?? ""}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    const next = { ...h };
                    if (v > 0) next[w._id] = v; else delete next[w._id];
                    setH(next);
                  }}
                  style={{ ...inputStyle, width: 64 }} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
            <button onClick={save} disabled={!!pdfBusy} style={primaryBtn}>Guardar</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function PublishModal({ targets, mes, onClose, onConfirm }) {
  const [tipo, setTipo] = useState(() => {
    try { return localStorage.getItem("rostering_pub_tipo") || "prev"; } catch { return "prev"; }
  });
  const names = targets.map(w => [w.nombre, w.apellidos].filter(Boolean).join(" "));
  return (
    <ModalShell title="Publicar en Rutas" onClose={onClose} width={440}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
        {targets.length === 1 ? names[0] : `${targets.length} trabajadores`} · {mes}
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>
        Cada uno verá en Rutas solo sus rutas (una por día trabajado, con su vehículo) y su cuadrante del mes.
        Se sustituye lo publicado antes de este proyecto y mes, salvo los días en que ya haya marcado paradas.
      </div>
      <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Tipo de trabajo</label>
      <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 16 }}>
        {TIPOS_RUTA.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
        <button onClick={() => { try { localStorage.setItem("rostering_pub_tipo", tipo); } catch { /* sin almacenamiento */ } onConfirm(tipo); }}
          style={primaryBtn}>Publicar</button>
      </div>
    </ModalShell>
  );
}

// ── MODAL: resultado de Optimizar ──────────────────────────────────
export function OptResultModal({ result, workers, rules, onClose }) {
  const nameOf = id => {
    const w = workers.find(x => x._id === id);
    return w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") : id;
  };
  const rows = Object.entries(result.stats)
    .map(([id, s]) => ({ id, ...s }))
    .filter(s => s.days > 0)
    .sort((a, b) => b.hours - a.hours);
  const allCovered = result.covered === result.total;
  return (
    <ModalShell title="Resultado de la optimización" onClose={onClose} width={560}>
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 12,
        color: allCovered ? "#34d399" : "#fbbf24",
      }}>
        {result.covered} de {result.total} turnos cubiertos
        {result.outOfMonth > 0 && <span style={{ color: C.dim, fontWeight: 400, fontSize: 11 }}> · {result.outOfMonth} fuera de este mes (no se optimizan)</span>}
      </div>

      {result.moves?.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
            Movidos de día para cumplir las reglas ({result.moves.length})
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", marginBottom: 8 }}>
            {result.moves.map(m => (
              <div key={m.id} style={{ fontSize: 11, padding: "3px 0", color: C.muted }}>
                <span style={{ color: C.text, fontWeight: 600 }}>Día {m.fromDay} → {m.toDay}</span>
                {" · "}{m.shift?.vehicleName} · {fmtClock(m.shift?.start)}–{fmtClock(m.shift?.end)}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>
            Scheduling mueve esas rutas al nuevo día (mismo vehículo y horario). Revísalas en el Gantt antes de publicar.
          </div>
        </>
      )}

      {result.uncovered.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
            Sin cubrir
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", marginBottom: 14 }}>
            {result.uncovered.map(({ shift, reasons }) => (
              <div key={shift.id} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.text, fontWeight: 600 }}>Día {shift.day}</span>
                <span style={{ color: C.muted }}> · {shift.vehicleName} · {fmtClock(shift.start)}–{fmtClock(shift.end)}</span>
                <div style={{ color: C.dim, fontSize: 10.5 }}>Nadie puede: {describeReasons(reasons)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>
            Para cubrirlos: más plantilla, relajar alguna regla, o revisar L/B/turnos fijados a mano esos días.
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
        Carga por trabajador
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: C.dim, textAlign: "left" }}>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Trabajador</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Horas</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Días</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Racha máx.</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Findes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
                <td style={{ padding: "3px 8px" }}>{nameOf(s.id)}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.hours} / {s.maxHoras || "—"}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.days}</td>
                <td style={{ padding: "3px 8px", textAlign: "right", color: rules.maxDiasSeguidos && s.maxRun > rules.maxDiasSeguidos ? "#f87171" : C.text }}>{s.maxRun}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.weekends}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10 }}>
        Los días seguidos no tienen en cuenta el final del mes anterior.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={onClose} style={primaryBtn}>Cerrar</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, width, children }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.55)" }} />
      <div style={{
        position: "fixed", zIndex: 1001, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: `min(${width}px, calc(100vw - 32px))`, maxHeight: "calc(100vh - 48px)", overflowY: "auto",
        background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,.5)", padding: 18, fontFamily: font,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </>
  );
}
