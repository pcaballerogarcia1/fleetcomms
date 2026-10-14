// Planning de líneas → Flota: los autobuses de verdad, uno por uno (matrícula,
// tipo, autonomía en km y una nota). Se suben desde un Excel/CSV o se añaden a
// mano, y se editan uno a uno. El Scheduling los usa para la autonomía de cada
// salida de cochera y para poner un vehículo real a cada autobús del escenario.
// Se guardan en planning_settings.lineasCfg._flota.lista.
import { useRef, useState } from "react";
import { TIPOS_VEHICULO } from "./lineas-store.js";

const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25", border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  blue: "#5b7cfa", blueText: "#b4c3ff", green: "#3fcf8e", amber: "#f5b84a", red: "#f26d6d", text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
};
const font = "var(--font)";
const mono = "var(--mono)";
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const nuevoId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// del texto del Excel al tipo de Operanzia («Eléctrico», «articulado 18m»…)
function tipoDeTexto(t) {
  const x = norm(t);
  if (!x) return null;
  if (/electr|bev|bateria/.test(x)) return "electrico";
  if (/articul|18 ?m/.test(x)) return "articulado";
  if (/micro/.test(x)) return "micro";
  if (/midi|8 ?m|10 ?m/.test(x)) return "midi";
  if (/interurb|autocar|coach/.test(x)) return "interurbano";
  if (/estandar|12 ?m|standard|rigido/.test(x)) return "estandar";
  return TIPOS_VEHICULO.find(tv => norm(tv.nombre) === x || tv.id === x)?.id || null;
}

export function FlotaLineas({ cfg, onGuardar }) {
  const lista = Array.isArray(cfg?._flota?.lista) ? cfg._flota.lista : [];
  const [q, setQ] = useState("");
  const [error, setError] = useState(null);
  const [nota, setNota] = useState(null);
  const fileRef = useRef(null);
  const guardar = nueva => onGuardar(nueva).catch(e => setError(e.message || String(e)));
  const cambiar = (id, cambio) => guardar(lista.map(b => (b.id === id ? { ...b, ...cambio } : b)));

  async function importar(file) {
    if (!file) return;
    setError(null); setNota(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!filas.length) throw new Error("el archivo no tiene filas");
      const col = (f, ...nombres) => { const k = Object.keys(f).find(c => nombres.some(n => norm(c).includes(n))); return k ? f[k] : ""; };
      const nuevos = filas.map(f => {
        const matricula = String(col(f, "matric", "placa", "plate", "bus", "vehic", "codigo") || "").trim();
        const autonomia = parseFloat(String(col(f, "autonom", "range", "km")).replace(",", "."));
        return { id: nuevoId(), matricula, tipo: tipoDeTexto(col(f, "tipo", "type", "modelo", "model")), autonomiaKm: autonomia > 0 ? autonomia : null, nota: String(col(f, "nota", "observ", "coment") || "").trim() };
      }).filter(b => b.matricula);
      if (!nuevos.length) throw new Error("no encuentro una columna de matrícula (Matrícula, Placa, Bus…)");
      // las que ya estaban (misma matrícula) se actualizan; las nuevas se añaden
      const resultado = lista.map(b => ({ ...b }));
      const porMat = new Map(resultado.map(b => [norm(b.matricula), b]));
      let act = 0;
      for (const n of nuevos) {
        const ya = porMat.get(norm(n.matricula));
        if (ya) { ya.tipo = n.tipo ?? ya.tipo; ya.autonomiaKm = n.autonomiaKm ?? ya.autonomiaKm; ya.nota = n.nota || ya.nota; act++; }
        else { resultado.push(n); porMat.set(norm(n.matricula), n); }
      }
      await guardar(resultado);
      setNota(`${nuevos.length - act} autobús(es) añadido(s)${act ? ` y ${act} actualizado(s)` : ""} desde «${file.name}».`);
    } catch (e) { setError(`No se pudo importar: ${e.message || e}`); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const vis = lista.filter(b => !q.trim() || norm(`${b.matricula} ${b.nota} ${TIPOS_VEHICULO.find(t => t.id === b.tipo)?.nombre || ""}`).includes(norm(q)));
  const conAut = lista.filter(b => Number(b.autonomiaKm) > 0).length;
  const inp = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 7px", fontSize: 12, fontFamily: font, outline: "none" };
  const th = { fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "7px 10px", position: "sticky", top: 0, background: C.card, zIndex: 1 };
  const td = { padding: "5px 10px", borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 22px" }}>
      <div style={{ maxWidth: 980 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Flota</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>
          Tus autobuses de verdad. Con la autonomía (km que hace con una carga), el Scheduling no hace salidas de cochera más largas de lo que aguanta la flota de ese tipo y pone a cada autobús del escenario un vehículo real: los recorridos más largos, a los de más autonomía. Si se cargan solo de noche o entre salidas, en Scheduling → Restricciones → Autonomía.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px", flexWrap: "wrap" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar matrícula, tipo o nota…" style={{ ...inp, width: 240, padding: "6px 9px" }} />
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => importar(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Subir Excel / CSV</button>
          <button onClick={() => guardar([...lista, { id: nuevoId(), matricula: `Nuevo ${lista.length + 1}`, tipo: null, autonomiaKm: null, nota: "" }])} style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border2}`, background: "none", color: C.text, fontSize: 12, cursor: "pointer", fontFamily: font }}>+ Añadir autobús</button>
          <span style={{ fontSize: 11.5, color: C.muted }}>{lista.length} autobuses · {conAut} con autonomía</span>
        </div>
        <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 8 }}>El Excel: una fila por autobús, con columnas como «Matrícula», «Tipo» (eléctrico, articulado, estándar, midi, micro, interurbano) y «Autonomía» (km). Si la matrícula ya está, se actualiza.</div>
        {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
        {nota && <div style={{ fontSize: 12, color: C.green, marginBottom: 8 }}>{nota}</div>}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", maxHeight: "calc(100vh - 340px)", background: C.card }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Matrícula</th><th style={th}>Tipo</th><th style={th}>Autonomía</th><th style={th}>Nota</th><th style={th} /></tr></thead>
            <tbody>
              {vis.map(b => (
                <tr key={b.id}>
                  <td style={td}><input defaultValue={b.matricula} onBlur={e => e.target.value.trim() !== b.matricula && cambiar(b.id, { matricula: e.target.value.trim() })} style={{ ...inp, width: 130, fontFamily: mono }} /></td>
                  <td style={td}>
                    <select value={b.tipo || ""} onChange={e => cambiar(b.id, { tipo: e.target.value || null })} style={{ ...inp, cursor: "pointer" }}>
                      <option value="">Cualquiera</option>
                      {TIPOS_VEHICULO.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input type="number" min="0" defaultValue={b.autonomiaKm ?? ""} placeholder="sin límite" onBlur={e => { const v = parseFloat(e.target.value); const n = v > 0 ? v : null; if (n !== (b.autonomiaKm ?? null)) cambiar(b.id, { autonomiaKm: n }); }} style={{ ...inp, width: 90, fontFamily: mono }} />
                      <span style={{ fontSize: 11, color: C.dim }}>km</span>
                    </span>
                  </td>
                  <td style={td}><input defaultValue={b.nota || ""} onBlur={e => e.target.value !== (b.nota || "") && cambiar(b.id, { nota: e.target.value })} style={{ ...inp, width: 260 }} /></td>
                  <td style={{ ...td, textAlign: "right" }}><button onClick={() => window.confirm(`¿Quitar el ${b.matricula} de la flota?`) && guardar(lista.filter(x => x.id !== b.id))} title="Quitar de la flota" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lista.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>Aún no hay autobuses. Sube un Excel con tu flota o añádelos a mano. Sin flota, el Scheduling calcula los autobuses que hacen falta sin límite de autonomía.</div>}
        </div>
      </div>
    </div>
  );
}
