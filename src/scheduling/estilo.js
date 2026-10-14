// Colores, tipografías y estilos comunes de Scheduling.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)

// ── DESIGN TOKENS ─────────────────────────────────────────────────
export const C = {
  bg:"#0b0d12", card:"#12151c", surface2:"#181c25",
  border:"rgba(255,255,255,0.08)", border2:"rgba(255,255,255,0.14)",
  blue:"#5b7cfa", blueDim:"#1a2142", blueText:"#b4c3ff",
  green:"#3fcf8e", greenDim:"#0f2a1f",
  orange:"#f59e5b", red:"#f26d6d", amber:"#f5b84a",
  text:"#e6e8ee", muted:"#9aa3b2", dim:"#5d6574",
};
export const font = "var(--font)";
export const mono = "var(--mono)";
if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    @keyframes sched-fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sched-spin{to{transform:rotate(360deg)}}
    @keyframes sched-shimmer{0%,100%{opacity:1}50%{opacity:.6}}
    @keyframes sched-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .sched-block{transition:filter .1s,box-shadow .1s;}
    .sched-block:hover{filter:brightness(1.15);box-shadow:0 2px 8px rgba(0,0,0,.4);}
  `;
  document.head.appendChild(s);
}


const BARRIO_PALETTE = [
  "#5b7cfa","#3fcf8e","#f59e5b","#f26d6d",
  "#a78bfa","#f5b84a","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _barrioCache = {};
export function barrioColor(b) {
  if (!b) return "#9aa3b2";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

// Minutos -> "8h" / "8h30" — mismo formato que ya se usa en cada fila del Gantt
export function fmtDurHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}`;
}

export const VEHICLE_TYPES = ["Camión lateral","Camión trasero","Furgón","Barredora","Cisterna","Otro"];
export const TURNO_TYPES   = ["Mañana (06-14)","Tarde (14-22)","Noche (22-06)","Jornada completa"];
