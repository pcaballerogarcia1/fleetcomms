// Una fila del Gantt de Scheduling dibujada en un lienzo (canvas) en vez de
// con un elemento por parada. Se usa cuando las paradas son estrechas (día
// entero a la vista): con 150 rutas eran ~45.000 elementos en pantalla y
// cada botón (zoom, ordenar, vista) tardaba segundos en repintar. Se puede
// hacer lo mismo que con los bloques: pasar el ratón (detalle), pulsar
// (panel de la parada) y arrastrar a otra fila.
import { useEffect, useRef } from "react";
import { barrioColor } from "./estilo.js";
import { ROW_H } from "./gantt-comun.js";

// El nombre que se enseña de la parada: el suyo, o su código, o el barrio
const CODIGOS = ["pa", "idsap", "id_sap", "codigopoint", "codigo"];
const etiqueta = t => t.nombre || Object.entries(t.campos || {}).find(([k]) => CODIGOS.includes(k.toLowerCase()))?.[1] || t.barrio || "";

// Medidas iguales a las de los bloques (gantt.jsx)
const ALTO = ROW_H - 10;

function dibujar(cv, { tareas, dayOffset, pxPerMin, chartW, activa, arrastrada }) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.ceil(chartW));
  if (cv.width !== w * dpr || cv.height !== ROW_H * dpr) { cv.width = w * dpr; cv.height = ROW_H * dpr; }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, ROW_H);
  for (const t of tareas) {
    const x = (t._start - dayOffset) * pxPerMin;
    const dur = t.duracion || 15;
    const bw = Math.max(dur * pxPerMin - 2, 3);
    if (t._break || t._wait) {
      const c = t._break ? "251,146,60" : t._descarga ? "52,211,153" : "34,211,238";
      g.fillStyle = `rgba(${c},0.15)`; g.strokeStyle = `rgba(${c},0.5)`;
      g.fillRect(x, ROW_H * 0.3, bw, ROW_H * 0.4); g.strokeRect(x + 0.5, ROW_H * 0.3 + 0.5, bw - 1, ROW_H * 0.4 - 1);
    } else if (t._travel) {
      const deposito = t._depot_exit || t._depot_return;
      const h = ROW_H * 0.38;
      g.fillStyle = deposito ? "#b45309" : "#7a1010";
      g.fillRect(x, (ROW_H - h) / 2, Math.max(bw, 4), h);
    } else {
      const color = barrioColor(t.barrio);
      g.globalAlpha = arrastrada === t ? 0.4 : 1;
      g.fillStyle = activa === t ? color : color + "d0";
      g.fillRect(x, 5, bw, ALTO);
      g.strokeStyle = activa === t ? "#ffffff" : color;
      g.lineWidth = activa === t ? 2 : 1;
      g.strokeRect(x + 0.5, 5.5, bw - 1, ALTO - 1);
      g.lineWidth = 1;
      if (bw >= 22) { // con sitio, el nombre de la parada (como en los bloques)
        const txt = etiqueta(t);
        if (txt) {
          g.save(); g.beginPath(); g.rect(x + 3, 5, bw - 6, ALTO); g.clip();
          g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(x + 4, 5 + ALTO * 0.2, 3, ALTO * 0.6);
          g.fillStyle = "#fff"; g.font = `600 ${Math.min(10, bw / 5)}px Inter, system-ui, sans-serif`; g.textBaseline = "middle";
          g.fillText(bw >= 60 ? txt : txt.slice(0, Math.max(2, Math.floor(bw / 7))), x + 10, 5 + ALTO / 2);
          g.restore();
        }
      }
      if (t.windowStart != null) { // con franja horaria: el puntito amarillo del reloj
        g.fillStyle = "#fbbf24"; g.beginPath(); g.arc(x + bw, 5, 3.5, 0, 2 * Math.PI); g.fill();
      }
      g.globalAlpha = 1;
    }
  }
}

/** La parada (no tramos ni pausas) que hay en la posición x (px dentro de la fila). */
function paradaEn(tareas, dayOffset, pxPerMin, x) {
  let mejor = null, dist = Infinity;
  for (const t of tareas) {
    if (t._travel || t._break || t._wait) continue;
    const x0 = (t._start - dayOffset) * pxPerMin;
    const x1 = x0 + Math.max((t.duracion || 15) * pxPerMin - 2, 3);
    const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    if (d < dist) { dist = d; mejor = t; }
  }
  return dist <= 2 ? mejor : null; // 2 px de margen: las paradas son finas
}

export function FilaLienzo({ tareas, dayOffset, pxPerMin, chartW, activa, arrastrada, onAbrir, onTooltip, onArrastrar, onSoltar }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) dibujar(ref.current, { tareas, dayOffset, pxPerMin, chartW, activa, arrastrada });
  }, [tareas, dayOffset, pxPerMin, chartW, activa, arrastrada]);
  const bajo = e => paradaEn(tareas, dayOffset, pxPerMin, e.clientX - e.currentTarget.getBoundingClientRect().left);
  return (
    <canvas ref={ref} draggable
      style={{ position: "absolute", left: 0, top: 0, width: Math.ceil(chartW), height: ROW_H, zIndex: 4 }}
      onMouseMove={e => {
        const t = bajo(e);
        e.currentTarget.style.cursor = t ? "grab" : "default";
        onTooltip(t ? { task: t, x: e.clientX, y: e.clientY } : null);
      }}
      onMouseLeave={() => onTooltip(null)}
      onClick={e => { const t = bajo(e); if (!t) return; e.stopPropagation(); onTooltip(null); onAbrir(t); }}
      onDragStart={e => {
        const t = bajo(e);
        if (!t) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        onTooltip(null);
        onArrastrar(t);
      }}
      onDragEnd={onSoltar} />
  );
}
