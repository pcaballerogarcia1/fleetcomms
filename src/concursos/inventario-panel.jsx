// Planning del concurso → Inventario de contenedores (sin coordenadas).
// Se sube cualquier listado (Excel, ODS, CSV, texto), Operanzia dice cómo lo
// ha entendido (qué es cada columna, con unas filas de ejemplo) y se corrige
// si hace falta antes de guardarlo. Luego: cómo es (puntos, contenedores por
// punto, distritos) y cómo se compara con el parque del pliego.
import { Check, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { C } from "../tema.js";
import { CAMPOS, compararConPliego, entenderHoja, hojasDeArchivo, leerInventario } from "./inventario.js";
import { borrarInventario, guardarInventario } from "./store.js";

const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 1 }); } catch { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }); } })();
const CON_FRACCION = "__fraccion__"; // columna con la cantidad de una fracción (listado por punto)

export function PanelInventario({ concursoId, inventario, resumen, parque }) {
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState(null);
  const [revisar, setRevisar] = useState(null); // { nombre, hojas, hoja, entendido }
  const ref = useRef();
  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };

  async function subir(archivo) {
    if (!archivo) return;
    setError(null); setOcupado(`Leyendo ${archivo.name}…`);
    try {
      const hojas = await hojasDeArchivo(archivo);
      // la hoja con más contenedores reconocibles
      let hoja = 0, max = -1;
      hojas.forEach((h, i) => { const n = leerInventario(h.matriz, entenderHoja(h.matriz)).contenedores.length; if (n > max) { max = n; hoja = i; } });
      setRevisar({ nombre: archivo.name, hojas, hoja, entendido: entenderHoja(hojas[hoja].matriz) });
    } catch (e) { setError(`No se pudo leer «${archivo.name}»: ${e.message || e}`); }
    setOcupado(null);
  }
  async function guardar() {
    const { contenedores, error: e } = leerInventario(revisar.hojas[revisar.hoja].matriz, revisar.entendido);
    if (e || !contenedores.length) { setError(e || "No sale ningún contenedor con esas columnas."); return; }
    setOcupado("Guardando…");
    try {
      // sin campos vacíos (Firestore no los admite)
      await guardarInventario(concursoId, { nombre: revisar.nombre, contenedores: contenedores.map(c => Object.fromEntries(Object.entries(c).filter(([, v]) => v != null))) });
      setRevisar(null);
    } catch (err) { setError(`No se pudo guardar: ${err.message || err}`); }
    setOcupado(null);
  }

  const comparacion = resumen && parque.length ? compararConPliego(resumen, parque) : [];
  const descuadres = comparacion.filter(f => f.diferencia);

  // ── revisar cómo se ha entendido ──
  let vista = null;
  if (revisar) {
    const { matriz } = revisar.hojas[revisar.hoja];
    const e = revisar.entendido;
    const campoDe = i => { const k = Object.entries(e.columnas).find(([, c]) => c === i)?.[0]; return k || (e.porFraccion.some(p => p.col === i) ? CON_FRACCION : ""); };
    const cambiar = (i, campo) => {
      const columnas = Object.fromEntries(Object.entries(e.columnas).filter(([k, c]) => c !== i && k !== campo));
      if (campo && campo !== CON_FRACCION) columnas[campo] = i;
      const porFraccion = e.porFraccion.filter(p => p.col !== i);
      if (campo === CON_FRACCION) porFraccion.push({ col: i, fraccion: e.nombres[i] });
      setRevisar(r => ({ ...r, entendido: { ...e, columnas, porFraccion } }));
    };
    const res = leerInventario(matriz, e);
    const muestra = matriz.slice(e.cabecera + 1).filter(f => Array.isArray(f) && f.some(x => String(x ?? "").trim())).slice(0, 5);
    vista = (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Así he entendido «{revisar.nombre}»{revisar.hojas.length > 1 ? "" : ""}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Revisa qué es cada columna y corrígelo si hace falta. {res.error ? <span style={{ color: C.red }}>{res.error}</span> : <span style={{ color: C.green }}>Salen {FMT.format(res.contenedores.length)} contenedores.</span>}</div>
        {revisar.hojas.length > 1 && (
          <select className="op-input" value={revisar.hoja} onChange={ev => { const h = Number(ev.target.value); setRevisar(r => ({ ...r, hoja: h, entendido: entenderHoja(r.hojas[h].matriz) })); }} style={{ width: 260, height: 30, marginBottom: 8 }}>
            {revisar.hojas.map((h, i) => <option key={i} value={i}>Hoja: {h.nombre}</option>)}
          </select>
        )}
        <div style={{ overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>{e.nombres.map((n, i) => (
                <th key={i} style={{ padding: "6px 8px", textAlign: "left", borderBottom: `1px solid ${C.border}`, background: C.surface2, verticalAlign: "top" }}>
                  <div style={{ color: C.dim, fontWeight: 500, marginBottom: 4, whiteSpace: "nowrap" }}>{n}</div>
                  <select className="op-input" value={campoDe(i)} onChange={ev => cambiar(i, ev.target.value)} style={{ height: 28, fontSize: 12, minWidth: 130, color: campoDe(i) ? C.text : C.dim }}>
                    <option value="">— no se usa —</option>
                    {Object.entries(CAMPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    <option value={CON_FRACCION}>Cantidad de esta fracción</option>
                  </select>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {muestra.map((f, j) => <tr key={j}>{e.nombres.map((_, i) => <td key={i} style={{ padding: "4px 8px", color: campoDe(i) ? C.text : C.dim, whiteSpace: "nowrap", borderTop: `1px solid ${C.border}` }}>{String(f[i] ?? "")}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="op-btn op-primario" disabled={!!res.error || !!ocupado} onClick={guardar}><Check size={14} /> Usar este listado</button>
          <button className="op-btn op-fantasma" onClick={() => setRevisar(null)}><X size={14} /> Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...tarjeta, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>Inventario de contenedores</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
            {inventario && resumen ? <>{inventario.nombre} · {FMT.format(resumen.total)} contenedores en {FMT.format(resumen.puntos)} puntos de aportación</> : "Sube el listado de contenedores (Excel, CSV…), aunque no tenga coordenadas: con sus puntos de aportación el rendimiento se estima mucho mejor."}
          </div>
        </div>
        <button className="op-btn" disabled={!!ocupado} onClick={() => ref.current?.click()}><Upload size={14} /> {inventario ? "Cambiar listado" : "Subir listado"}</button>
        {inventario && <button className="op-btn op-fantasma op-icono" title="Quitar el listado" onClick={() => window.confirm("¿Quitar el listado de contenedores?") && borrarInventario(concursoId).catch(e => setError(e.message))}><Trash2 size={14} /></button>}
        <input ref={ref} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; subir(f); }} />
      </div>
      {ocupado && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>{ocupado}</div>}
      {error && <div style={{ fontSize: 12.5, color: C.red, marginTop: 8 }}>{error}</div>}
      {vista}

      {!revisar && inventario && resumen && <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {resumen.porUbicacion.map(u => (
            <div key={u.ubicacion} style={{ background: C.surface2, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: C.muted }}>
              <b style={{ color: C.text }}>{u.ubicacion}</b>: {FMT.format(u.contenedores)} contenedores · {FMT.format(u.puntos)} puntos · <b style={{ color: C.text }}>{FMT.format(u.porPunto)}</b> por punto
            </div>
          ))}
          {resumen.porDistrito.length > 0 && <div style={{ background: C.surface2, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: C.muted }}>{resumen.porDistrito.map(([d, n]) => `${d} ${n}`).join(" · ")}</div>}
        </div>

        {comparacion.length > 0 && <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "14px 0 6px" }}>
            Comparado con el parque del pliego {descuadres.length ? <span style={{ color: C.amber, fontWeight: 500 }}><TriangleAlert size={13} style={{ verticalAlign: "-2px" }} /> {descuadres.length} no cuadran</span> : <span style={{ color: C.green, fontWeight: 500 }}>✓ cuadra</span>}
          </div>
          <div style={{ overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["Ubicación", "Fracción", "Pliego", "Listado", "Diferencia"].map(h => <th key={h} style={{ textAlign: ["Pliego", "Listado", "Diferencia"].includes(h) ? "right" : "left", padding: "4px 12px", color: C.dim, fontWeight: 600, fontSize: 11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {comparacion.map((f, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "4px 12px", color: C.muted }}>{f.ubicacion}</td>
                    <td style={{ padding: "4px 12px", color: C.text }}>{f.fraccion}</td>
                    <td style={{ padding: "4px 12px", textAlign: "right", color: C.text }}>{f.pliego ?? "—"}</td>
                    <td style={{ padding: "4px 12px", textAlign: "right", color: C.text }}>{f.listado}</td>
                    <td style={{ padding: "4px 12px", textAlign: "right", fontWeight: 600, color: f.diferencia == null ? C.dim : f.diferencia === 0 ? C.green : Math.abs(f.diferencia) / Math.max(1, f.pliego) > 0.1 ? C.red : C.amber }}>{f.diferencia == null ? "no está en el pliego" : f.diferencia === 0 ? "✓" : (f.diferencia > 0 ? "+" : "") + f.diferencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {descuadres.length > 0 && <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>Las cantidades de servicio de la ficha son las del pliego. Si el listado es el bueno, pregúntalo en las aclaraciones o corrige la ficha.</div>}
        </>}
      </>}
    </div>
  );
}
