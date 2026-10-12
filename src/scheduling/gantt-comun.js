// Gantt del Scheduling de puntos: medidas, columnas y textos que comparten sus piezas.






// ── GANTT CHART ───────────────────────────────────────────────────
export const ROW_H    = 52;

export const HEADER_H = 44;

export const LABEL_W_DEFAULT = 210;

export const LABEL_W_MIN = 150;

export const LABEL_W_MAX = 480;

// Vista "Tabla" del Gantt: columnas de datos por fila (como un planificador
// profesional): métricas del día que se está viendo, ordenables, con avisos
// de reglas (ver scenario-metrics.js) y fila de totales abajo.
export const TABLE_COLS = [
  { k: "avisos",     l: "",         w: 22, align: "center", t: "Avisos de reglas (pasa el ratón por el !)" },
  { k: "nombre",     l: "Recurso",  w: 150, align: "left" },
  { k: "turno",      l: "Turno",    w: 64, align: "left" },
  { k: "inicio",     l: "Inicio",   w: 50, t: "Primera tarea del día" },
  { k: "fin",        l: "Fin",      w: 50, t: "Última tarea del día" },
  { k: "amplitud",   l: "Amplitud", w: 62, t: "De la primera a la última tarea (tiempo pagado)" },
  { k: "conduccion", l: "Conduc.",  w: 58, t: "Tiempo conduciendo" },
  { k: "trabajo",    l: "Trabajo",  w: 58, t: "Tiempo en paradas" },
  { k: "pausas",     l: "Pausas",   w: 52 },
  { k: "km",         l: "Km",       w: 52 },
  { k: "kmVacio",    l: "Km vacío", w: 58, t: "Salida y vuelta a cochera" },
  { k: "paradas",    l: "Paradas",  w: 54 },
];

export const TABLE_W = TABLE_COLS.reduce((sum, c) => sum + c.w, 0) + 8;

export const COL_COLOR = { amplitud: "#34d399", km: "#fb923c", kmVacio: "#fb923c" };

export const rowName = r => [r?.nombre, r?.apellidos].filter(Boolean).join(" ") || r?.name || r?.matricula || "?";

export const turnoCorto = r => r?._virtual ? "—" : ((r?.turno || "").split(/[ (]/)[0] || "—");

// Explicación de cada indicador (al pasar el ratón)
export const KPI_AYUDA = {
  "Vehículos": "Vehículos con alguna ruta en el escenario. PVR: los que están en ruta a la vez en el momento de más actividad — los que necesitas de verdad.",
  "Turnos": "Jornadas de trabajo: cada conductor (o vehículo, si no hay conductores) en cada día con ruta.",
  "Eficiencia vehículo": "Km en ruta / km totales. Lo que falta hasta el 100 % son los km en vacío de salida y vuelta a cochera.",
  "Eficiencia personal": "Tiempo productivo (conducción + trabajo en paradas) / tiempo pagado (de inicio a fin de jornada). Lo que falta son pausas y esperas.",
  "Km": "Kilómetros totales del escenario; debajo, los recorridos en vacío (salida y vuelta a cochera).",
  "Paradas": "Paradas asignadas a alguna ruta; debajo, las que el algoritmo no pudo encajar (panel \"Sin asignar\").",
  "Coste estimado": "Horas pagadas × €/hora + km × €/km, con las tarifas de Restricciones. Es una estimación para comparar escenarios.",
  "Avisos": "Filas que incumplen alguna regla: conducción UE 561/2006, descanso del Estatuto (art. 34.4), jornada máxima o franja horaria. Detalle en la columna \"!\" de la tabla.",
};

export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8];

export const UNASSIGNED_RENDER_CAP = 300;

export const DAY_OPTIONS = [1, 2, 3, 5, 7, 14];
