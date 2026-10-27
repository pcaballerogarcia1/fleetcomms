// Comparar el escenario actual con otra versión guardada (Historial →
// «Comparar»): las mismas cifras de los dos, una al lado de la otra, con
// barras y la diferencia en verde (mejor) o rojo (peor).
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import { C, font, mono } from "./estilo.js";
import { filasComparacion, num } from "./comparar-datos.js";

export function ComparadorEscenarios({ nombreA, kpisA, nombreB, kpisB, cargando, error, onCerrar }) {
  const filas = kpisB ? filasComparacion(kpisA, kpisB) : [];
  const mejores = filas.filter(f => f.mejor === true).length, peores = filas.filter(f => f.mejor === false).length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }} onClick={onCerrar}>
      <div role="dialog" aria-label="Comparar escenarios" onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "22px 24px 20px", width: 720, maxWidth: "calc(100vw - 32px)", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: C.text }}><ArrowLeftRight size={16} />Comparar escenarios</div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex" }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 13 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.text }}><i style={{ width: 10, height: 10, borderRadius: 4, background: C.blue }} />Actual: <b>{nombreA}</b></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.text }}><i style={{ width: 10, height: 10, borderRadius: 4, background: C.dim }} />{nombreB}</span>
        </div>

        {cargando && <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13, padding: "30px 0", justifyContent: "center" }}><Loader2 size={16} className="op-girando" />Cargando la versión…</div>}
        {error && <div style={{ color: C.red, fontSize: 13, padding: "12px 0" }}>No se pudo cargar esa versión: {error}</div>}

        {!cargando && !error && kpisB && (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>
              {mejores === 0 && peores === 0 ? "Los dos escenarios salen iguales."
                : <>El actual sale <b style={{ color: C.green }}>mejor en {mejores}</b> y <b style={{ color: C.red }}>peor en {peores}</b> de {filas.length} cifras.</>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 110px", rowGap: 12, columnGap: 14, alignItems: "center" }}>
              {filas.map(f => {
                const max = Math.max(Math.abs(f.a || 0), Math.abs(f.b || 0)) || 1;
                const fmt = f.fmt || (n => num(n));
                const barra = (v, color) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 8, background: C.surface2, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(0, (v || 0) / max) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 12, color: C.text, width: 82, textAlign: "right" }}>{fmt(v)}</span>
                  </div>
                );
                return [
                  <div key={f.clave + "e"} style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{f.etiqueta}</div>,
                  <div key={f.clave + "b"} style={{ display: "flex", flexDirection: "column", gap: 4 }}>{barra(f.a, C.blue)}{barra(f.b, C.dim)}</div>,
                  <div key={f.clave + "d"} data-testid={`dif-${f.clave}`} style={{
                    fontFamily: mono, fontSize: 12, fontWeight: 600, textAlign: "right",
                    color: f.mejor === true ? C.green : f.mejor === false ? C.red : C.dim,
                  }}>{f.mejor == null ? "igual" : `${f.dif > 0 ? "+" : "−"}${fmt(Math.abs(f.dif))}`}</div>,
                ];
              })}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 16 }}>La diferencia es la del actual frente a la otra versión: verde si el actual sale mejor, rojo si sale peor.</div>
          </>
        )}
      </div>
    </div>
  );
}
