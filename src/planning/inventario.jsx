// Planning (puntos) → Inventario: la ficha de cada contenedor. Se crea con los
// puntos del mapa, se edita aquí o se actualiza con un Excel (por código o
// RFID), y se descarga en Excel. Los cambios se guardan con «Guardar».
// Lo usan Scheduling (litros de cada parada) y la app del conductor (RFID).
import { useEffect, useMemo, useRef, useState } from "react";
import { ESTADOS, completarConPuntos, importarFilas, resumenInventario } from "../inventario.js";
import { escucharInventario, guardarInventario } from "../inventario-store.js";
import { useUltimo } from "../use-ultimo.js";
import { C, font, mono } from "./estilo.js";
import { useSector } from "../sector.js";
import { X } from "lucide-react";
import { tono } from "../tema.js";

const POR_PAGINA = 200;
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const COLOR_ESTADO = { "En servicio": C.green, "Dañado": C.red, "En taller": C.amber, "Pendiente de instalar": C.blue, "Retirado": C.muted };

export function TabInventario({ layers, projectId, orgId }) {
  const { t: T, ver } = useSector();
  const elementoRef = useUltimo(T.elemento);
  const [remoto, setRemoto] = useState({ pid: null, v: null, lista: [] });
  const [lista, setLista] = useState([]);
  const [cambiados, setCambiados] = useState(() => new Set());
  const [borrados, setBorrados] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [nota, setNota] = useState(null);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [paginas, setPaginas] = useState(1);
  const fileRef = useRef(null);
  const pendientes = cambiados.size + borrados.length;
  const pendRef = useUltimo(pendientes);
  const layersRef = useUltimo(layers);
  const cargando = remoto.pid !== projectId && !error;

  useEffect(() => {
    if (!projectId) return;
    return escucharInventario(projectId, r => {
      setRemoto({ ...r, pid: projectId });
      if (pendRef.current) return; // con cambios sin guardar, no se pisan
      // sin inventario guardado: se prepara solo con los puntos del mapa (no se guarda hasta «Guardar»)
      const puntos = r.lista.length ? [] : layersRef.current.filter(l => l.visible !== false && !l.lineasCloud).flatMap(l => l.markers || []);
      const prep = puntos.length ? completarConPuntos([], puntos) : null;
      if (prep?.nuevos) {
        setLista(prep.lista); setCambiados(new Set(prep.lista.map(c => c.id)));
        setNota(`He preparado el inventario con los ${prep.nuevos} puntos del mapa (una fila = un ${elementoRef.current}). Revísalo y pulsa «Guardar» para guardarlo.`);
      } else setLista(r.lista);
    }, e => setError(`No se pudo leer el inventario: ${e.message || e}`));
  }, [projectId, pendRef, layersRef, elementoRef]);

  const marcar = ids => setCambiados(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
  const cambiar = (id, cambio) => { setLista(l => l.map(c => (c.id === id ? { ...c, ...cambio } : c))); marcar([id]); };

  const marcadores = () => layers.filter(l => l.visible !== false && !l.lineasCloud).flatMap(l => l.markers || []);
  function completar() {
    const r = completarConPuntos(lista, marcadores());
    if (!r.nuevos) { setNota("Todos los puntos del mapa ya están en el inventario."); return; }
    setLista(r.lista); marcar(r.lista.slice(-r.nuevos).map(c => c.id));
    setNota(`${r.nuevos} ${T.elementos} añadidos desde los puntos del mapa. Pulsa «Guardar» para guardarlos.`);
  }
  async function importar(file) {
    if (!file) return;
    setError(null); setNota(null);
    try {
      const XLSX = await import("xlsx");
      const wb = /\.csv$/i.test(file.name) ? XLSX.read(await file.text(), { type: "string" }) : XLSX.read(await file.arrayBuffer()); // CSV como texto UTF-8 (si no, las tildes salen rotas)
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!filas.length) throw new Error("el archivo no tiene filas");
      const antes = new Map(lista.map(c => [c.id, JSON.stringify(c)]));
      const r = importarFilas(lista, filas);
      setLista(r.lista);
      marcar(r.lista.filter(c => antes.get(c.id) !== JSON.stringify(c)).map(c => c.id));
      setNota(`«${file.name}»: ${r.actualizados} actualizado(s), ${r.nuevos} nuevo(s)${r.ignorados ? `, ${r.ignorados} fila(s) sin código o sin coordenadas` : ""}. Pulsa «Guardar».`);
    } catch (e) { setError(`No se pudo importar: ${e.message || e}`); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function exportar() {
    const XLSX = await import("xlsx");
    const filas = lista.map(c => ({ Código: c.codigo, RFID: c.rfid, Tipo: c.tipo, Litros: c.litros ?? "", Fracción: c.fraccion, Estado: c.estado, Instalado: c.instalado, Revisado: c.revisado, Lavado: c.lavado, Notas: c.notas, Nombre: c.nombre, Lat: c.lat, Lng: c.lng }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Inventario");
    XLSX.writeFile(wb, `inventario-${T.elementos}.xlsx`);
  }
  async function guardar() {
    setGuardando(true); setError(null);
    try {
      const r = await guardarInventario(projectId, orgId, lista, { baseV: remoto.v, cambiados, borrados });
      setRemoto({ ...r, pid: projectId }); setLista(r.lista); setCambiados(new Set()); setBorrados([]);
      setNota("Inventario guardado.");
    } catch (e) { setError(`No se pudo guardar: ${e.message || e}`); }
    finally { setGuardando(false); }
  }
  function descartar() { setLista(remoto.lista); setCambiados(new Set()); setBorrados([]); setNota(null); }

  const vis = useMemo(() => {
    const t = norm(q);
    return lista.filter(c => (!estado || c.estado === estado) && (!t || norm(`${c.codigo} ${c.rfid} ${c.tipo} ${c.fraccion} ${c.nombre} ${c.notas}`).includes(t)));
  }, [lista, q, estado]);
  const res = useMemo(() => resumenInventario(lista), [lista]);

  const inp = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: "4px 7px", fontSize: 12, fontFamily: font, outline: "none" };
  const th = { fontSize: 11, color: C.muted, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "7px 8px", position: "sticky", top: 0, background: C.card, zIndex: 1, whiteSpace: "nowrap" };
  const td = { padding: "4px 8px", borderTop: `1px solid ${C.border}` };
  const btn = (principal) => ({ padding: "7px 13px", borderRadius: 8, border: principal ? "none" : `1px solid ${C.border2}`, background: principal ? C.blue : "none", color: principal ? "#fff" : C.text, fontSize: 12, fontWeight: principal ? 600 : 400, cursor: "pointer", fontFamily: font });
  const editable = (c, campo, ancho, tipo = "text") => (
    <input key={`${c.id}:${campo}:${remoto.v}`} type={tipo} defaultValue={c[campo] ?? ""}
      onBlur={e => { const v = tipo === "number" ? (parseFloat(e.target.value) > 0 ? parseFloat(e.target.value) : null) : e.target.value.trim(); if (v !== (c[campo] ?? (tipo === "number" ? null : ""))) cambiar(c.id, { [campo]: v }); }}
      style={{ ...inp, width: ancho, ...(tipo !== "date" ? {} : { colorScheme: tono("dark", "light") }), ...(campo === "rfid" || campo === "codigo" ? { fontFamily: mono } : {}) }} />
  );

  if (!projectId) return <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Abre un proyecto para ver su inventario.</div>;
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 22px", fontFamily: font }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Inventario de {T.elementos}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55, maxWidth: 900 }}>
        La ficha de cada {T.elemento}. {ver.volumen ? "Rutas usa sus litros para saber cuándo se llena el camión, y l" : "L"}a app del conductor recibe sus RFID o códigos: al leer la etiqueta, la parada se marca sola. Los «Retirados» y «Pendientes de instalar» no cuentan en las rutas.
      </div>
      <div style={{ display: "flex", gap: 14, margin: "12px 0", flexWrap: "wrap", fontSize: 12, color: C.muted }}>
        <span><b style={{ color: C.text }}>{res.total}</b> {T.elementos}</span>
        {ESTADOS.filter(e => res.porEstado[e]).map(e => <span key={e}><b style={{ color: COLOR_ESTADO[e] }}>{res.porEstado[e]}</b> {e.toLowerCase()}</span>)}
        <span><b style={{ color: C.text }}>{res.conRfid}</b> con RFID</span>
        {ver.volumen && res.litros > 0 && <span><b style={{ color: C.text }}>{Math.round(res.litros / 1000).toLocaleString("es-ES")}</b> m³ en servicio</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={q} onChange={e => { setQ(e.target.value); setPaginas(1); }} placeholder="Buscar código, RFID, tipo, calle…" style={{ ...inp, width: 230, padding: "6px 9px" }} />
        <select value={estado} onChange={e => { setEstado(e.target.value); setPaginas(1); }} style={{ ...inp, padding: "6px 8px", cursor: "pointer" }}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <button onClick={completar} style={btn(false)} title="Añade los puntos del mapa que aún no están (lo ya editado no se toca)">{lista.length ? "Añadir los puntos nuevos del mapa" : "Crear con los puntos del mapa"}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => importar(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} style={btn(false)}>Actualizar con Excel</button>
        <button onClick={exportar} disabled={!lista.length} style={btn(false)}>Descargar Excel</button>
        {pendientes > 0 && <>
          <button onClick={guardar} disabled={guardando} style={btn(true)}>{guardando ? "Guardando…" : `Guardar (${pendientes} cambio${pendientes === 1 ? "" : "s"})`}</button>
          <button onClick={descartar} disabled={guardando} style={{ ...btn(false), color: C.muted }}>Descartar</button>
        </>}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>El Excel: una fila por {T.elemento} con «Código» o «RFID» para encontrarlo, y las columnas que quieras cambiar ({`Tipo, ${ver.volumen ? "Litros" : "Capacidad"}, ${T.categoria}, Estado, Instalado, Revisado, ${T.revision}, Notas`}). Si el código no está y la fila trae Lat/Lng, se añade.</div>
      {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
      {nota && <div style={{ fontSize: 12, color: C.green, marginBottom: 8 }}>{nota}</div>}
      {cargando ? <div style={{ fontSize: 12, color: C.muted }}>Cargando…</div> : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", maxHeight: "calc(100vh - 360px)", background: C.card }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Código", "RFID", "Tipo", ver.volumen ? "Litros" : "Capacidad", T.categoria, "Estado", "Instalado", "Revisado", T.revision, "Notas", "Dónde", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.slice(0, paginas * POR_PAGINA).map(c => (
                <tr key={c.id} style={cambiados.has(c.id) ? { background: "rgba(91,124,250,0.06)" } : undefined}>
                  <td style={td}>{editable(c, "codigo", 100)}</td>
                  <td style={td}>{editable(c, "rfid", 140)}</td>
                  <td style={td}>{editable(c, "tipo", 120)}</td>
                  <td style={td}>{editable(c, "litros", 70, "number")}</td>
                  <td style={td}>{editable(c, "fraccion", 90)}</td>
                  <td style={td}>
                    <select value={c.estado || "En servicio"} onChange={e => cambiar(c.id, { estado: e.target.value })} style={{ ...inp, cursor: "pointer", color: COLOR_ESTADO[c.estado] || C.text }}>
                      {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </td>
                  <td style={td}>{editable(c, "instalado", 125, "date")}</td>
                  <td style={td}>{editable(c, "revisado", 125, "date")}</td>
                  <td style={td}>{editable(c, "lavado", 125, "date")}</td>
                  <td style={td}>{editable(c, "notas", 180)}</td>
                  <td style={{ ...td, fontSize: 11, color: C.muted, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }} title={`${c.lat}, ${c.lng}`}>{c.nombre || `${(+c.lat).toFixed(4)}, ${(+c.lng).toFixed(4)}`}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button title="Quitar del inventario (para dejarlo pero sin usarlo, ponlo como «Retirado»)" onClick={() => { if (!window.confirm(`¿Quitar ${c.codigo || "este contenedor"} del inventario?`)) return; setLista(l => l.filter(x => x.id !== c.id)); setBorrados(b => [...b, c.id]); setCambiados(prev => { const n = new Set(prev); n.delete(c.id); return n; }); }}
                      style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15 }}><X size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vis.length > paginas * POR_PAGINA && <div style={{ padding: 10, textAlign: "center" }}><button onClick={() => setPaginas(p => p + 1)} style={btn(false)}>Ver {Math.min(POR_PAGINA, vis.length - paginas * POR_PAGINA)} más (de {vis.length})</button></div>}
          {!lista.length && <div style={{ padding: 16, fontSize: 12, color: C.muted }}>Aún no hay inventario. Pulsa «Crear con los puntos del mapa» (una fila del Excel = un contenedor) o sube un Excel con Código, Lat y Lng.</div>}
        </div>
      )}
    </div>
  );
}
