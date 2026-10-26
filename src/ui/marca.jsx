// La marca de Operanzia: el cuadrado con la «O» en el degradado azul →
// violeta de operanzia.com, y el nombre al lado.
import { MARCA } from "../tema.js";
import { C } from "../tema.js";

export function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <defs>
        <linearGradient id="op-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={MARCA.desde} /><stop offset="1" stopColor={MARCA.hasta} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#op-logo)" />
      <circle cx="16" cy="16" r="7.2" fill="none" stroke="#fff" strokeWidth="3.6" />
    </svg>
  );
}

export function Marca({ size = 22, texto = true, color = C.text }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Logo size={size} />
      {texto && <span style={{ fontSize: Math.round(size * 0.68), fontWeight: 650, letterSpacing: "-0.01em", color }}>Operanzia</span>}
    </span>
  );
}
