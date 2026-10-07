// Colores, tipografías y estilos comunes de Scheduling.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)

// ── DESIGN TOKENS ─────────────────────────────────────────────────
export const C = {
  bg:"#0f1623", card:"#172035", surface2:"#1e2d48",
  border:"rgba(88,130,225,0.22)", border2:"rgba(88,130,225,0.40)",
  blue:"#5c9bff", blueDim:"#0d2550", blueText:"#b0ccff",
  green:"#34d399", greenDim:"#082a18",
  orange:"#fb923c", red:"#f87171", amber:"#fbbf24",
  text:"#e2eeff", muted:"#8aa5cc", dim:"#4a5f82",
};
export const font = "'Inter',system-ui,sans-serif";
export const mono = "'JetBrains Mono','Courier New',monospace";

if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
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
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _barrioCache = {};
export function barrioColor(b) {
  if (!b) return "#8b95a5";
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
