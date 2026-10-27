// Analytics (puntos) → Pesadas: los kg que descarga cada camión en la planta.
// Se apuntan aquí, desde la app del conductor o subiendo el Excel de la
// báscula; y se ven por día, fracción, camión y planta, y en kg por parada.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { leerKg, resumenPesadas } from "./pesadas.js";
import { apuntarPesada, borrarPesada, escucharPesadas } from "./pesadas-store.js";
import { C } from "./tema.js";
import { X } from "lucide-react";
import { tono } from "./tema.js";


const font = "var(--font)";
const mono = "var(--mono)";
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const tooltipStyle = { background: C.card, border: `1px solid ${C.border2}`, borderRadius: 8, fontSize: 12, color: C.text };
const axisStyle = { fill: C.muted, fontSize: 10 };
const kgTxt = kg => (kg >= 10000 ? `${(kg / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} t` : `${Math.round(kg).toLocaleString("es-ES")} kg`);

function Kpi({ label, value, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", minWidth: 150, flex: "1 1 150px" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginTop: 4, fontFamily: mono }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Grafico({ titulo, datos, x }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, flex: "1 1 320px", minWidth: 280 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>{titulo}</div>
      {datos.length ? (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey={x} tick={axisStyle} interval={0} angle={datos.length > 8 ? -30 : 0} textAnchor={datos.length > 8 ? "end" : "middle"} height={datos.length > 8 ? 50 : 30} />
              <YAxis tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={v => kgTxt(v)} />
              <Bar dataKey="kg" fill={C.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <div style={{ fontSize: 12, color: C.dim, padding: "30px 0", textAlign: "center" }}>Sin pesadas</div>}
    </div>
  );
}

export function PesadasAnalytics({ orgId, mes, planes = [], sesion, projectId }) {
  const [lista, setLista] = useState({ clave: null, datos: [] });
  const [error, setError] = useState(null);
  const [nota, setNota] = useState(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ fecha: hoy, hora: "", vehiculo: "", planta: "", fraccion: "", kg: "", ticket: "" });
  const fileRef = useRef(null);
  const clave = `${orgId}|${mes}`;

  useEffect(() => {
    if (!orgId) return;
    return escucharPesadas(orgId, mes, datos => setLista({ clave: `${orgId}|${mes}`, datos }), e => setError(`No se pudieron leer las pesadas: ${e.message || e}`));
  }, [orgId, mes]);
  const pesadas = useMemo(() => (lista.clave === clave ? lista.datos : []), [lista, clave]);
  const res = useMemo(() => resumenPesadas(pesadas, planes), [pesadas, planes]);
  const vehiculos = useMemo(() => [...new Set([...planes.map(p => p.vehiculoNombre), ...pesadas.map(p => p.vehiculo)].filter(Boolean))].sort(), [planes, pesadas]);
  const plantas = useMemo(() => [...new Set(pesadas.map(p => p.planta).filter(Boolean))].sort(), [pesadas]);
  const fracciones = useMemo(() => [...new Set(pesadas.map(p => p.fraccion).filter(Boolean))].sort(), [pesadas]);
  const quien = { id: sesion?.id || sesion?.uid || null, nombre: [sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") };

  async function apuntar() {
    const kg = leerKg(f.kg);
    if (!kg) { setError("Pon los kg (por ejemplo 8450 o 8,45 t)."); return; }
    setError(null);
    try {
      await apuntarPesada(orgId, { ...f, kg, projectId }, quien);
      setF(x => ({ ...x, kg: "", ticket: "", hora: "" }));
      setNota("Pesada apuntada.");
    } catch (e) { setError(`No se pudo apuntar: ${e.message || e}`); }
  }
  async function importar(file) {
    if (!file) return;
    setError(null); setNota(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const col = (fila, re) => { const k = Object.keys(fila).find(c => re.test(norm(c))); return k ? fila[k] : ""; };
      let ok = 0, mal = 0;
      for (const fila of filas) {
        const kg = leerKg(col(fila, /^(kg|kilos|peso neto|neto|peso)/));
        const fv = col(fila, /^(fecha|dia|día|date)/);
        const fecha = fv instanceof Date ? fv.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.test(String(fv)) ? String(fv).slice(0, 10)
          : (/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(String(fv)) || []).slice(1).reverse().map((x, i) => (i === 0 && x.length === 2 ? `20${x}` : x.padStart(2, "0"))).join("-");
        if (!kg || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { mal++; continue; }
        await apuntarPesada(orgId, {
          fecha, hora: String(col(fila, /^hora/) || "").slice(0, 5), kg, projectId,
          vehiculo: String(col(fila, /^(matricula|vehiculo|camion|vehículo|camión)/) || "").trim(),
          planta: String(col(fila, /^(planta|destino|instalacion|vertedero)/) || "").trim(),
          fraccion: String(col(fila, /^(fraccion|residuo|ler|material|producto)/) || "").trim(),
          ticket: String(col(fila, /^(ticket|albaran|albarán|n ?ticket|numero)/) || "").trim(),
        }, quien);
        ok++;
      }
      setNota(`«${file.name}»: ${ok} pesada(s) apuntadas${mal ? `, ${mal} fila(s) sin fecha o sin kg` : ""}.`);
    } catch (e) { setError(`No se pudo importar: ${e.message || e}`); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const inp = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "6px 8px", fontSize: 12, fontFamily: font, outline: "none" };
  const th = { fontSize: 11, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "7px 10px", position: "sticky", top: 0, background: C.card };
  const td = { padding: "6px 10px", borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.text };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: font }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Kpi label="Recogido en el mes" value={kgTxt(res.total)} sub={`${res.n} pesada(s)`} />
        <Kpi label="Media por descarga" value={res.n ? kgTxt(res.mediaPorPesada) : "—"} />
        <Kpi label="Kg por parada" value={res.kgPorParada != null ? `${res.kgPorParada.toLocaleString("es-ES")} kg` : "—"} sub={res.paradasHechas ? `${res.paradasHechas} paradas hechas en las rutas` : "sin paradas marcadas en las rutas"} />
        <Kpi label="Fracción principal" value={res.porFraccion[0]?.name ?? "—"} sub={res.porFraccion[0] ? kgTxt(res.porFraccion[0].kg) : null} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Apuntar una pesada</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Del ticket de la báscula. Los conductores también pueden apuntarlas desde su ruta en la app. Si la planta te da un Excel, súbelo entero.</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} style={{ ...inp, colorScheme: tono("dark", "light") }} />
          <input type="time" value={f.hora} onChange={e => setF({ ...f, hora: e.target.value })} style={{ ...inp, colorScheme: tono("dark", "light") }} />
          <input list="pes-veh" value={f.vehiculo} onChange={e => setF({ ...f, vehiculo: e.target.value })} placeholder="Camión" style={{ ...inp, width: 130 }} />
          <input list="pes-pla" value={f.planta} onChange={e => setF({ ...f, planta: e.target.value })} placeholder="Planta" style={{ ...inp, width: 130 }} />
          <input list="pes-fra" value={f.fraccion} onChange={e => setF({ ...f, fraccion: e.target.value })} placeholder="Fracción" style={{ ...inp, width: 120 }} />
          <input value={f.kg} onChange={e => setF({ ...f, kg: e.target.value })} onKeyDown={e => e.key === "Enter" && apuntar()} placeholder="Kg netos" style={{ ...inp, width: 90, fontFamily: mono }} />
          <input value={f.ticket} onChange={e => setF({ ...f, ticket: e.target.value })} placeholder="Nº ticket" style={{ ...inp, width: 100 }} />
          <button onClick={apuntar} className="op-btn op-primario">Apuntar</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => importar(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} className="op-btn">Subir Excel de la báscula</button>
          <datalist id="pes-veh">{vehiculos.map(v => <option key={v} value={v} />)}</datalist>
          <datalist id="pes-pla">{plantas.map(v => <option key={v} value={v} />)}</datalist>
          <datalist id="pes-fra">{fracciones.map(v => <option key={v} value={v} />)}</datalist>
        </div>
        {error && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{error}</div>}
        {nota && <div style={{ fontSize: 12, color: C.green, marginTop: 8 }}>{nota}</div>}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Grafico titulo="Kg por día" datos={res.porDia} x="fecha" />
        <Grafico titulo="Kg por fracción" datos={res.porFraccion} x="name" />
        <Grafico titulo="Kg por camión" datos={res.porVehiculo} x="name" />
        <Grafico titulo="Kg por planta" datos={res.porPlanta} x="name" />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "auto", maxHeight: 420 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Fecha", "Hora", "Camión", "Planta", "Fracción", "Kg", "Ticket", "Apuntó", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {pesadas.map(p => (
              <tr key={p._id}>
                <td style={{ ...td, fontFamily: mono }}>{p.fecha}</td>
                <td style={{ ...td, fontFamily: mono }}>{p.hora || ""}</td>
                <td style={td}>{p.vehiculo}</td>
                <td style={td}>{p.planta}</td>
                <td style={td}>{p.fraccion}</td>
                <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{Math.round(p.kg).toLocaleString("es-ES")}</td>
                <td style={{ ...td, fontFamily: mono }}>{p.ticket}</td>
                <td style={{ ...td, color: C.muted }}>{p.creadoNombre}</td>
                <td style={{ ...td, textAlign: "right" }}><button onClick={() => window.confirm("¿Borrar esta pesada?") && borrarPesada(p._id).catch(e => setError(e.message))} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 15 }}><X size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pesadas.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>No hay pesadas este mes.</div>}
      </div>
    </div>
  );
}
