// Planificación → «Calles para barrer»: buscar el municipio o el barrio,
// descargar sus calles de OpenStreetMap y crear una capa con sus tramos.
import { useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { C, font } from "../tema.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { sitios } from "../concursos/distancias.js";
import { TIPOS_POR_DEFECTO, TIPOS_VIA, descargarCallejero, marcadoresDeTramos, rectanguloDe } from "./callejero.js";

const RADIOS = [0.5, 1, 2, 3, 5];
const num = (n, d = 0) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

export function VentanaCallejero({ onCrear, onCerrar }) {
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState(null);
  const [lugar, setLugar] = useState(null);
  const [km, setKm] = useState(1);
  const [tipos, setTipos] = useState(TIPOS_POR_DEFECTO);
  const [mPorHora, setMPorHora] = useState(1200);
  const [aceras, setAceras] = useState(2);
  const [estado, setEstado] = useState(null); // { cargando } | { tramos } | { error }
  const [creando, setCreando] = useState(false);

  async function buscarLugar() {
    if (!texto.trim()) return;
    setOpciones({ cargando: true });
    const r = await sitios(texto.trim(), { limite: 5 });
    setOpciones({ lista: r });
    if (r.length === 1) setLugar(r[0]);
  }
  async function descargar() {
    setEstado({ cargando: true });
    try {
      const tramos = await descargarCallejero(rectanguloDe(lugar.lat, lugar.lng, km), { tipos, mPorHora: +mPorHora || 1200, aceras: +aceras || 2 });
      setEstado({ tramos });
    } catch (e) { setEstado({ error: e.message || String(e) }); }
  }
  async function crear() {
    setCreando(true);
    try { await onCrear({ name: `Calles · ${lugar.texto.split(",")[0]}`, markers: marcadoresDeTramos(estado.tramos) }); onCerrar(); }
    catch (e) { setEstado({ ...estado, error: e.message }); } finally { setCreando(false); }
  }
  const t = estado?.tramos;
  const metros = t ? t.reduce((x, y) => x + y.longitudM, 0) : 0;
  const minutos = t ? t.reduce((x, y) => x + y.duracion, 0) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onCerrar}>
      <div role="dialog" aria-label="Calles para barrer" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "22px 24px 20px", width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Calles para barrer</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          Descarga las calles de la zona (OpenStreetMap) partidas en tramos, cada uno con sus metros, su tiempo de barrido y su frecuencia. Después las repartes en itinerarios en Rutas.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input className="op-input" value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === "Enter" && buscarLugar()}
            placeholder="Municipio, barrio o calle (p. ej. «Salamanca» o «Plaza Mayor, Salamanca»)" aria-label="Municipio o barrio" style={{ flex: 1, height: 32 }} />
          <button className="op-btn" onClick={buscarLugar}><Search size={14} />Buscar</button>
        </div>
        {opciones?.cargando && <div style={{ fontSize: 12, color: C.muted }}><Loader2 size={13} className="op-girando" /> Buscando…</div>}
        {opciones?.lista && !opciones.lista.length && <div style={{ fontSize: 12, color: C.amber }}>No se ha encontrado ese sitio.</div>}
        {opciones?.lista?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {opciones.lista.map((o, i) => (
              <button key={i} className={`op-btn${lugar === o ? " op-activo" : ""}`} onClick={() => { setLugar(o); setEstado(null); }}><MapPin size={13} />{o.texto}</button>
            ))}
          </div>
        )}

        {lugar && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
                Radio alrededor
                <select className="op-input" value={km} onChange={e => { setKm(+e.target.value); setEstado(null); }} aria-label="Radio" style={{ width: 120, height: 30 }}>
                  {RADIOS.map(r => <option key={r} value={r}>{num(r, r < 1 ? 1 : 0)} km</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
                Metros de acera por hora
                <input className="op-input" inputMode="numeric" value={mPorHora} onChange={e => setMPorHora(e.target.value)} aria-label="Metros de acera por hora" style={{ width: 150, height: 30 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
                Aceras por calle
                <select className="op-input" value={aceras} onChange={e => setAceras(+e.target.value)} aria-label="Aceras por calle" style={{ width: 110, height: 30 }}>
                  <option value={2}>Las dos</option><option value={1}>Una</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: 12 }}>
              {Object.entries(TIPOS_VIA).map(([k, l]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text, cursor: "pointer" }}>
                  <input type="checkbox" checked={tipos.includes(k)} onChange={e => { setTipos(x => (e.target.checked ? [...x, k] : x.filter(y => y !== k))); setEstado(null); }} style={{ accentColor: C.blue }} />{l}
                </label>
              ))}
            </div>
            <button className="op-btn" onClick={descargar} disabled={estado?.cargando || !tipos.length}>
              {estado?.cargando ? <Loader2 size={14} className="op-girando" /> : null}Descargar las calles
            </button>
          </>
        )}

        {estado?.error && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{estado.error}</div>}
        {t && (
          <div className="op-tarjeta" style={{ marginTop: 14, padding: "12px 14px" }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>{num(t.length)} tramos · {num(metros / 1000, 1)} km de calle</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Barrerlo todo una vez: unas {num(minutos / 60)} h de trabajo (≈ {num(minutos / 60 / 7, 1)} jornadas de 7 h). Cada tramo lleva la frecuencia según su tipo de vía (diaria las avenidas y peatonales, L-X-V las calles, 1/semana las demás); se puede cambiar después.
            </div>
            {t.length > 6000 && <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>Son muchas calles: mejor un radio más pequeño o por barrios.</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <button className="op-btn op-primario" onClick={crear} disabled={creando || !t.length}>{creando ? <Loader2 size={14} className="op-girando" /> : null}Crear la capa de calles</button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>Datos de calles © colaboradores de OpenStreetMap. El rendimiento (metros por hora) depende del tipo de acera y de la suciedad: ajústalo a lo que hace vuestra plantilla.</div>
      </div>
    </div>
  );
}
