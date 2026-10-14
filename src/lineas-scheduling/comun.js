// Scheduling de líneas: colores, formatos y claves de escenario que comparten sus pantallas.


import { TIPOS_VEHICULO } from "../lineas-store.js";
import { clavePieza, PARAMS_DEFECTO, costeDia, OBJETIVOS, CAMPOS_VEHICULOS, CAMPOS_PRECIO, hayPrecios, minutosCoste, costeDeMinutos } from "../lineas-sched.js";
import { minToHHMM } from "../gtfs-parse.js";









// Mismos colores y tipografías que scheduling.jsx
export const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25",
  border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  blue: "#5b7cfa", blueDim: "#1a2142", blueText: "#b4c3ff",
  green: "#3fcf8e", greenDim: "#0f2a1f",
  orange: "#f59e5b", red: "#f26d6d", amber: "#f5b84a",
  text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
};

export const font = "var(--font)";
export const mono = "var(--mono)";
export const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const hm = m => (m == null ? "—" : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`);

// antes de las 00:00 (un autobús que sale de cochera la víspera): "23:40 (−1)"
export const hhmm = m => (m == null ? "—" : m < 0 ? `${minToHHMM(m + 1440).slice(0, 5)} (−1)` : minToHHMM(m).slice(0, 5));

export const horaEje = m => minToHHMM(((m % 1440) + 1440) % 1440).slice(0, 5);

export const num = n => Math.round(n).toLocaleString("es-ES");

export const nombreTipo = id => TIPOS_VEHICULO.find(t => t.id === id)?.nombre || "";

export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4];

export const PAGINA = 150;

export const ROW_H = 34;

// ── Filas del Gantt: autobuses (vista Vehículos) o turnos (Trabajadores) ──
export function filasDe(res, modo) {
  if (modo === "vehicles") {
    return res.autobuses.map(b => {
      const bloques = b.bloques.map(id => res.vehiculos.find(v => v.id === id)).filter(Boolean).sort((x, y) => x.inicio - y.inicio);
      const viajes = bloques.flatMap(x => x.viajes);
      const vacios = bloques.slice(1).map((x, i) => ({ inicio: bloques[i].fin, fin: x.inicio }));
      const relevos = bloques.flatMap(x => x.relevos);
      // con flota: la matrícula, y aviso si no le llega la autonomía
      const f = b.flota;
      const avisoFlota = f && !f.ok ? [f.matricula ? `Necesita ${f.necesita} km y el ${f.matricula} aguanta ${f.autonomia} km` : "No hay vehículo en la flota para este autobús"] : [];
      return fila(b.matricula || `Bus ${b.id}`, `${nombreTipo(b.tipo) || "—"}${b.matricula ? ` · bus ${b.id}` : ""}${f?.autonomia ? ` · ${f.necesita}/${f.autonomia} km` : ""}`, viajes, {
        id: b.id, vacios, relevos, bloques: bloques.length, avisos: [...avisoFlota, ...bloques.flatMap(x => x.avisos || [])], manual: bloques.some(x => x.manual),
      });
    });
  }
  return res.turnos.map(t => {
    const viajes = t.piezas.flatMap(pz => pz.viajes);
    // entre piezas: primero el viaje a la otra cabecera (si cambia de cabecera) y lo que queda, pausa
    const desplazamientos = t.desplazamientos || [];
    const tramosPausa = t.piezas.slice(1).map((pz, i) => {
      const d = desplazamientos.find(x => x.inicio === t.piezas[i].fin);
      return { inicio: d ? Math.min(d.fin, pz.inicio) : t.piezas[i].fin, fin: pz.inicio };
    }).filter(x => x.fin > x.inicio);
    // el split del partido: los huecos que ya no se pagan
    const splits = tramosPausa.filter(x => x.fin - x.inicio >= (res.params?.huecoNoPagado ?? 60));
    const buses = t.piezas.map(pz => res.vehiculos.find(v => v.id === pz.vehiculo)?.autobus);
    return fila(`T${t.id}`, `${t.tipoNombre ? `${t.tipoNombre} · ` : t.tipo === null ? "Sin tipo · " : ""}${t.piezas.length} pieza${t.piezas.length > 1 ? "s" : ""}${t.partidos && t.tipo !== "partido" ? " · partido" : ""}`, viajes, {
      id: t.id, tramosPausa, splits, desplazamientos, cambiosBus: t.cambiosBus || 0, avisos: t.avisos, tomaDeje: [t.toma, t.deje].filter(Boolean), trabajo: t.trabajo, detalle: `Bus ${[...new Set(buses)].join(" + ")}${t.desplazamientos?.length ? ` · ${t.desplazamientos.length} desplaz.` : ""}`, manual: !!t.manual,
      relevos: t.piezas.map(pz => ({ inicio: pz.inicio, turno: t.id })),
      piezaDe: new Map(t.piezas.flatMap(pz => pz.viajes.map(v => [v, clavePieza(pz)]))),
    });
  });
}

export function fila(nombre, tipo, viajes, extra) {
  const inicio = viajes[0]?.dep ?? 0, fin = viajes.at(-1)?.arr ?? 0;
  const conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  const pausas = (extra.tramosPausa || []).reduce((s, x) => s + (x.fin - x.inicio), 0);
  return {
    nombre, tipo, viajes, inicio, fin, amplitud: fin - inicio, conduccion, pausas,
    km: viajes.reduce((s, v) => s + v.km, 0), kmVacio: viajes.reduce((s, v) => s + (v.vacio ? v.km : 0), 0), nViajes: viajes.filter(v => !v.vacio).length,
    lineas: [...new Set(viajes.filter(v => !v.vacio).map(v => v.nombre))], avisos: [], relevos: [], vacios: [], tramosPausa: [], splits: [], ...extra,
  };
}

export const COLS = [
  { k: "avisos", l: "", w: 22, align: "center", t: "Avisos de reglas (pasa el ratón por el !)" },
  { k: "nombre", l: "Recurso", w: 92, align: "left" },
  { k: "tipo", l: "Tipo", w: 86, align: "left" },
  { k: "inicio", l: "Inicio", w: 80 },
  { k: "fin", l: "Fin", w: 50 },
  { k: "amplitud", l: "Amplitud", w: 62 },
  { k: "conduccion", l: "Conduc.", w: 58, t: "Tiempo con viajeros" },
  { k: "pausas", l: "Pausas", w: 52, t: "Pausa entre piezas del turno" },
  { k: "km", l: "Km", w: 52, t: "Km totales, con los vacíos" },
  { k: "kmVacio", l: "Vacío", w: 50, t: "Km en vacío (cochera y entre cabeceras)" },
  { k: "nViajes", l: "Viajes", w: 50 },
];

export const TABLE_W = COLS.reduce((s, c) => s + c.w, 0) + 8;

// ── Campo de número de las restricciones ────────────────────────────────
// No guarda mientras se escribe (antes, al borrar el número para poner otro,
// se guardaba 0 al instante y ahí se quedaba): se guarda al salir del campo o
// con Enter. Vacío = el valor por defecto (o sin límite si vacioEsNulo).
export const MINIMOS = { maxPiezas: 1, piezaMax: 30, amplitudMax: 60, jornadaMax: 60, huecoNoPagado: 1, conduccionContinuaMax: 30, conduccionDiariaMax: 60, velocidadVacio: 1 };

// ── Tipos de turno (duty types) ─────────────────────────────────────────
export const aHHMM = m => `${String(Math.floor((m ?? 0) / 60)).padStart(2, "0")}:${String((m ?? 0) % 60).padStart(2, "0")}`;

export const deHHMM = v => { const [a, b] = String(v || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };

// ── Página ─────────────────────────────────────────────────────────────
// Un escenario por calendario, en dos pasos (1 vehículos, 2 trabajadores),
// con su estrategia, indicadores y ▲▼ propios.
// lineasSched = { ...restricciones comunes, dia (el último visto),
//   porCalendario: { [dia]: { estrategia, objetivoV, objetivoT, resumen, claveV, clave } } }
// claveV resume con qué se hicieron los vehículos y clave, todo (también los
// turnos): si ya no coinciden, está desactualizado. resumen.turnos es null
// si solo se ha hecho el paso 1.
export const ESTRATEGIA_UI = ["eleccion", "corte", "emparejar", "metodo", "vacios", "vacioKm"]; // entreLineas además es restricción

const CAMPOS_COSTE = CAMPOS_PRECIO; // los precios no cambian el escenario: el coste se recalcula al verlo

// lo que cambia los vehículos (el resto solo cambia los turnos)
const CLAVES_VEHICULOS = ["dia", "lineas", "regulacion", "margenVacio", "margenCochera", "amplitudBusMax", "esperaMaxCabecera", "gruposLineas", "mezclaBuses", "vacioMaxKm", "factorRodeo", "velocidadVacio", "entreLineas", ...CAMPOS_VEHICULOS];

export const sinCampos = (o, campos) => Object.fromEntries(Object.entries(o).filter(([k]) => !campos.includes(k)));

export const soloCampos = (o, campos) => Object.fromEntries(Object.entries(o).filter(([k]) => campos.includes(k)));

function hashTexto(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export const claveEscenario = (p, cfgTxt) => hashTexto(JSON.stringify(Object.keys(p).filter(k => !CAMPOS_COSTE.includes(k)).sort().map(k => [k, p[k]])) + cfgTxt);

export const claveVehiculos = (p, cfgTxt) => hashTexto(JSON.stringify(CLAVES_VEHICULOS.map(k => [k, p[k] ?? null])) + cfgTxt);

export const mismos = (campos, a = {}, b = {}) => campos.every(k => (a[k] ?? PARAMS_DEFECTO[k]) === (b[k] ?? PARAMS_DEFECTO[k]));

export const baseDeResumen = (r, p) => (r ? {
  vehicleCount: r.autobuses, turnos: r.turnos, eficPersonal: r.eficienciaPersonal, totalKm: r.km, eficVehiculo: r.km ? (r.km - (r.kmVacio || 0)) / r.km : null, totalStops: r.viajes, avisos: r.avisos,
  coste: r.turnos == null ? null : costeDia(r, p),
} : null);

export const MAX_EN_MEMORIA = 5; // escenarios completos guardados en memoria (los de Roma ocupan)

export const nombreObjetivo = id => OBJETIVOS.find(o => o.id === id)?.nombre.toLowerCase();

// Indicadores en el formato de la KpiBar del Scheduling de puntos
export function kpisBarra(res, p) {
  const k = res.kpis;
  const turnos = res.turnos || [];
  const conduccion = turnos.reduce((s, t) => s + t.conduccion, 0);
  const pagado = turnos.reduce((s, t) => s + t.trabajo, 0);
  const coste = res.turnos ? costeDia({ horasPagadas: pagado / 60, km: k.km, autobuses: k.autobuses, costeMin: minutosCoste(turnos, p) }, p) : null;
  return {
    vehiculos: k.autobuses, pvr: k.pico, turnos: k.turnos, paradas: k.viajes, km: k.km, kmVacio: k.kmVacio || 0,
    conduccion, trabajo: 0, pagado, eficVehiculo: k.km ? (k.km - (k.kmVacio || 0)) / k.km : null, eficPersonal: k.eficienciaPersonal, coste,
    avisos: turnos.reduce((s, t) => s + t.avisos.length, 0), filasConAviso: k.turnosConAviso, sinAsignar: 0,
    // campos con los nombres que usa la comparación ▲▼
    vehicleCount: k.autobuses, totalKm: k.km, totalStops: k.viajes,
  };
}

// Todos los indicadores (el panel «Todos los indicadores»), como los de Optibus.
// (Km, viajes y avisos ya vienen de la barra: aquí no se repiten.)
export function kpisDetalle(res, p = res.params) {
  const k = res.kpis;
  const turnos = res.turnos || [];
  if (!res.turnos) return [{ l: "Turnos", v: "—", sub: "falta el paso 2 (turnos)" }];
  const suma = f => turnos.reduce((s, t) => s + (f(t) || 0), 0);
  const hmT = m => `${Math.floor(m / 60).toLocaleString("es-ES")}h${String(Math.round(m % 60)).padStart(2, "0")}`;
  const pagado = suma(t => t.trabajo), amplitud = suma(t => t.duracion), conduccion = suma(t => t.conduccion);
  const plataforma = suma(t => t.piezas.reduce((s, pz) => s + (pz.fin - pz.inicio), 0));
  const enVacio = suma(t => t.piezas.reduce((s, pz) => s + pz.viajes.filter(v => v.vacio).reduce((a, v) => a + (v.arr - v.dep), 0), 0));
  const sinPagar = amplitud - pagado;
  const desp = turnos.flatMap(t => t.desplazamientos || []);
  const enPartido = suma(t => t.piezas.slice(1).filter((pz, i) => (pz.autobus ?? pz.vehiculo) !== (t.piezas[i].autobus ?? t.piezas[i].vehiculo) && pz.inicio - t.piezas[i].fin >= (p.huecoNoPagado ?? 60)).length);
  const n = turnos.length || 1;
  const eur = v => v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const hayPrecio = hayPrecios(p);
  const cp = costeDeMinutos(minutosCoste(turnos, p), p);
  const tramo = m => (m < 300 ? "<5 h" : m < 420 ? "5-7 h" : m < 480 ? "7-8 h" : m <= 540 ? "8-9 h" : ">9 h");
  const cuenta = (lista, f, orden) => { const o = {}; for (const x of lista) { const c = f(x); o[c] = (o[c] || 0) + 1; } return (orden || Object.keys(o)).filter(c => o[c]).map(c => ({ n: c, v: o[c] })); };
  return [
    { l: "Partidos", v: num(k.turnosPartidos || 0), sub: `${hmT(sinPagar)} de hueco sin pagar · ${Math.round(((k.turnosPartidos || 0) / n) * 100)} % de los turnos` },
    { l: "Cambios de bus", v: num(k.cambiosBus || 0), sub: `${num(enPartido)} en el hueco del partido${res.intercambiosBus ? ` · ${num(res.intercambiosBus)} evitados (los autobuses siguen al conductor)` : ""}` },
    { l: "Media pagada por turno", v: hmT(pagado / n), sub: "trabajo pagado de media" },
    { l: "Horas pagadas", v: hmT(pagado), sub: "piezas + huecos cortos" },
    { l: "Amplitud total", v: hmT(amplitud), sub: `de la primera salida a la última llegada · media ${hmT(amplitud / n)}` },
    { l: "Conducción", v: hmT(conduccion), sub: `con viajeros + vacíos: ${hmT(conduccion - enVacio)} + ${hmT(enVacio)}` },
    { l: "Tiempo en plataforma", v: hmT(plataforma), sub: "con el autobús (piezas)" },
    { l: "Tiempo parado", v: hmT(Math.max(0, plataforma - conduccion)), sub: "con el autobús, sin conducir (regulación)" },
    { l: "Desplazamientos", v: desp.length ? hmT(desp.reduce((s, d) => s + (d.fin - d.inicio), 0)) : "—", sub: desp.length ? `${num(desp.length)} a otra cabecera · ${num(desp.reduce((s, d) => s + (d.km || 0), 0))} km` : "ninguno" },
    ...(hayPrecio ? [
      { l: "Coste de personal", v: eur(cp.total), sub: [`ordinario ${eur(cp.ordinario)}`, cp.extra && `extras ${eur(cp.extra)}`, cp.nocturnidad && `nocturnidad ${eur(cp.nocturnidad)}`, cp.partido && `partidos ${eur(cp.partido)}`, cp.festivo && `festivo ${eur(cp.festivo)}`, cp.fijo && `fijo ${eur(cp.fijo)}`].filter(Boolean).join(" · ") },
      { l: "Coste de autobuses", v: eur(k.autobuses * (p.costeVehiculoDia || 0) + k.km * (p.costeKm || 0)), sub: `${num(k.autobuses)} × ${p.costeVehiculoDia || 0} € + ${num(k.km)} km × ${String(p.costeKm || 0).replace(".", ",")} €` },
    ] : []),
    { l: "Tipos de turno", barras: Object.entries(k.turnosPorTipo || {}).sort((a, b) => b[1] - a[1]).map(([n2, v]) => ({ n: n2, v })) },
    { l: "Horas pagadas por turno", barras: cuenta(turnos, t => tramo(t.trabajo), ["<5 h", "5-7 h", "7-8 h", "8-9 h", ">9 h"]) },
    { l: "Piezas por turno", barras: cuenta(turnos, t => (t.piezas.length >= 4 ? "4+" : String(t.piezas.length)), ["1", "2", "3", "4+"]) },
    ...(Object.keys(k.porTipo || {}).length > 1 ? [{ l: "Tipos de autobús", barras: Object.entries(k.porTipo).map(([n2, v]) => ({ n: n2, v })) }] : []),
  ];
}

export function cambiosKpi(res, p = res.params) {
  const k = res.kpis;
  return {
    "Vehículos": { l: "Autobuses", sub: `pico ${k.pico} a la vez · ${num(k.bloques)} bloques${res.flota ? ` · flota: ${res.flota.faltan ? `faltan ${res.flota.faltan}` : `${num(res.flota.sobran)} libres`}${res.flota.noLlegan ? ` · ${res.flota.noLlegan} sin autonomía` : ""}` : ""}`, subColor: res.flota && (res.flota.faltan || res.flota.noLlegan) ? C.red : undefined, ayuda: "Autobuses necesarios: un mismo autobús puede hacer varios bloques si entre ellos hay margen para ir y volver de cochera. El pico es el máximo en servicio a la vez." },
    "Turnos": { sub: res.turnos ? (Object.keys(k.turnosPorTipo || {}).length ? Object.entries(k.turnosPorTipo).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${num(c)} ${n.toLowerCase()}`).join(" · ") : `${(k.piezasMedias || 0).toFixed(1).replace(".", ",")} piezas de media · ${num(k.turnosPartidos || 0)} partidos`) + (k.cambiosBus != null ? ` · ${num(k.cambiosBus)} cambios de bus${p.maxCambiosBusTotal != null && k.cambiosBus > p.maxCambiosBusTotal ? ` (máx. ${num(p.maxCambiosBusTotal)})` : ""}` : "") : "falta el paso 2 (turnos)", subColor: !res.turnos ? C.amber : p.maxCambiosBusTotal != null && k.cambiosBus > p.maxCambiosBusTotal ? C.red : undefined, ayuda: "Turnos de conductor: cada uno encadena las piezas (de cualquier autobús, con relevo en cabecera) que caben en su jornada y amplitud. Partido = con un hueco largo sin pagar." },
    "Eficiencia vehículo": { sub: `km con viajeros / km totales · ${num(k.km - (k.kmVacio || 0))} / ${num(k.km)}`, ayuda: "Parte de los km que se hacen con viajeros: el resto son vacíos (salir y volver a cochera, ir a otra cabecera)." },
    "Eficiencia personal": { sub: `conducción / trabajo · ${num(k.horasPagadas)} h`, ayuda: "Tiempo conduciendo con viajeros / tiempo de trabajo de los turnos (suma de sus piezas)." },
    "Km": { sub: `${num(k.kmVacio || 0)} en vacío · ${num(k.vacios || 0)} vacíos`, ayuda: "Kilómetros del día: los de los viajes y los vacíos (salida y vuelta a cochera, y entre cabeceras)." },
    "Paradas": { l: "Viajes", sub: res.diaNombre, subColor: C.dim, ayuda: "Viajes del calendario elegido en las líneas del escenario." },
    "Avisos": { ayuda: "Turnos que incumplen la conducción UE 561/2006 o el descanso del Estatuto (art. 34.4)." },
    ...(!res.turnos && hayPrecios(p) && { "Coste estimado": { v: "—", sub: "falta el paso 2 (turnos)" } }),
    ...(res.turnos && hayPrecios(p) && { "Coste estimado": { sub: "personal (convenio) + autobuses + km", ayuda: "Personal según el convenio de Restricciones (horas, pluses, extras, mínimo pagado) + autobuses × €/autobús·día + km × €/km." } }),
  };
}
