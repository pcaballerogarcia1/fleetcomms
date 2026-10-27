// Piezas comunes de las pestañas de Análisis (Realizado, Cierre del mes)
import { C } from "../tema.js";
import { num } from "./formato.js";

/** Una cifra grande con su explicación */
export function Cifra({ label, value, sub, color, ayuda }) {
  return (
    <div title={ayuda} className="op-tarjeta" style={{ padding: "14px 18px", flex: 1, minWidth: 160, cursor: ayuda ? "help" : undefined }}>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 650, color: color || C.text, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Diferencia con color: más es peor (km, horas) salvo que se diga lo contrario */
export function Diferencia({ plan, real, fmt = v => num(v), masEsMejor = false }) {
  if (plan == null || real == null) return <span style={{ color: C.dim }}>—</span>;
  const d = real - plan;
  const pct = plan ? Math.round((d / plan) * 100) : 0;
  if (Math.abs(pct) < 3) return <span style={{ color: C.dim }}>igual</span>;
  const malo = masEsMejor ? d < 0 : d > 0;
  return <span style={{ color: malo ? C.red : C.green, fontWeight: 600 }}>{d > 0 ? "+" : "−"}{fmt(Math.abs(d))} ({d > 0 ? "+" : "−"}{Math.abs(pct)} %)</span>;
}
