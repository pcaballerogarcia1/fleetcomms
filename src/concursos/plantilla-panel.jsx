// Cálculo → la plantilla a subrogar: se sube la lista del Ayuntamiento
// (Excel/CSV), se ve cómo se ha entendido y su coste, y se usa en lugar del
// personal del estudio.
import { Trash2, Upload, Users } from "lucide-react";
import { useRef, useState } from "react";
import { C } from "../tema.js";
import { eur, F1 } from "./formato.js";
import { hojasDeArchivo } from "./inventario.js";
import { CAMPOS_PLANTILLA, costePlantilla, entenderPlantilla } from "./plantilla.js";

export function PlantillaSubrogar({ calc, cambiar, personalEstudio, tarjeta, titulo }) {
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const ref = useRef();
  const pl = calc.plantilla || null;

  async function subir(archivo) {
    if (!archivo) return;
    setError(null); setOcupado(true);
    try {
      const hojas = await hojasDeArchivo(archivo);
      // la hoja con más trabajadores
      const mejor = hojas.map(h => ({ h, e: entenderPlantilla(h.matriz) })).map(x => ({ ...x, r: costePlantilla(x.h.matriz, x.e, { ssPct: calc.parametros?.ssPct ?? 33, absentismoPct: calc.parametros?.absentismoPlantillaPct ?? 5 }) })).sort((a, b) => b.r.personas - a.r.personas)[0];
      if (!mejor || mejor.r.error) throw new Error(mejor?.r.error || "No sale ningún trabajador.");
      const columnas = Object.fromEntries(Object.entries(mejor.e.columnas).map(([k, i]) => [k, mejor.e.nombres[i]]));
      cambiar({ plantilla: { nombre: archivo.name, personas: mejor.r.personas, etc: mejor.r.etc, coste: mejor.r.coste, absentismoPct: mejor.r.absentismoPct, ssPct: mejor.r.ssPct, porCategoria: mejor.r.porCategoria.map(x => ({ ...x, coste: Math.round(x.coste) })), columnas }, usarPlantilla: true });
    } catch (e) { setError(`No se pudo leer «${archivo.name}»: ${e.message || e}`); }
    setOcupado(false);
  }

  return (
    <>
      {titulo("Plantilla a subrogar")}
      <div style={{ ...tarjeta, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Users size={16} color={C.blue} />
          <div style={{ flex: "1 1 300px", fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
            {pl ? <><b style={{ color: C.text }}>{pl.nombre}</b>: {pl.personas} personas ({F1.format(pl.etc)} a jornada completa), <b style={{ color: C.text }}>{eur(pl.coste)}</b> al año{pl.ssPct != null ? ` (bruto + ${pl.ssPct} % de Seguridad Social)` : " (coste para la empresa)"} con un {pl.absentismoPct} % de cobertura de bajas y vacaciones{personalEstudio ? <> · el estudio pone <b style={{ color: C.text }}>{eur(personalEstudio)}</b> ({pl.coste > personalEstudio ? "+" : ""}{F1.format((pl.coste / personalEstudio - 1) * 100)} %)</> : null}</>
              : "Si hay que subrogar la plantilla actual, sube la lista que publica el Ayuntamiento (categoría, antigüedad, jornada, sueldo o coste): su coste sustituye al personal del estudio."}
          </div>
          <button className="op-btn" disabled={ocupado} onClick={() => ref.current?.click()}><Upload size={14} /> {pl ? "Cambiar lista" : "Subir lista de personal"}</button>
          {pl && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: C.text }}><input type="checkbox" checked={!!calc.usarPlantilla} onChange={e => cambiar({ usarPlantilla: e.target.checked })} style={{ accentColor: C.blue }} /> Usarla</label>}
          {pl && <button className="op-btn op-fantasma op-icono" title="Quitar la lista" onClick={() => cambiar({ plantilla: null, usarPlantilla: false })}><Trash2 size={14} /></button>}
          <input ref={ref} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; subir(f); }} />
        </div>
        {ocupado && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>Leyendo…</div>}
        {error && <div style={{ fontSize: 12.5, color: C.red, marginTop: 6 }}>{error}</div>}
        {pl?.porCategoria?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {pl.porCategoria.map(x => <div key={x.categoria} style={{ background: C.surface2, borderRadius: 8, padding: "5px 10px", fontSize: 12, color: C.muted }}><b style={{ color: C.text }}>{x.categoria}</b>: {x.personas} · {eur(x.coste)}</div>)}
          </div>
        )}
        {pl?.columnas && <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>Columnas entendidas: {Object.entries(pl.columnas).map(([k, n]) => `${CAMPOS_PLANTILLA[k] || k} = «${n}»`).join(" · ")}</div>}
      </div>
    </>
  );
}
