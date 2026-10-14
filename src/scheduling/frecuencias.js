// Scheduling de puntos · ruta maestra semanal (frecuencias).
// En recogida cada contenedor tiene su frecuencia: diaria, L-X-V, 2 veces por
// semana… La ruta maestra es la semana tipo: cada camión con su zona fija
// (siempre la misma, para que el conductor la conozca) y, cada día, las
// paradas de su zona que tocan ese día.
//  · La frecuencia se lee de una columna del Excel («Frecuencia», «Días»…):
//    días concretos («L,X,V», «lunes y jueves», «L-V», «diaria») o un número
//    de veces («3», «3/semana», «semanal») que se reparte aquí.
//  · Las zonas se hacen una vez con todas las paradas, equilibradas por el
//    trabajo de la semana (visitas × duración).
//  · Las de «N veces» se colocan en días separados (L-X-V antes que L-M-X) y
//    en la combinación que deja más igualados los días de su zona.
//  · Cada día de cada zona lo resuelve el motor de rutas de siempre.
// Sin React ni Firebase.
import { haversineKm, hasCoords, kMeansCluster } from "../vrp-engine.js";

export const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
export const NOMBRE_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const FRECUENCIAS_DEFECTO = { usarFrecuencias: false, diasServicio: "LMXJVS", frecuenciaDefecto: "diaria" };

/** El nombre de un día del escenario: «Día 3» o, en la ruta maestra, «Miércoles» */
export const nombreDiaEscenario = (constraints, d) => {
  if (!constraints?.usarFrecuencias) return `Día ${d + 1}`;
  const dia = diasDeServicio(constraints.diasServicio ?? FRECUENCIAS_DEFECTO.diasServicio)[d];
  return dia != null ? NOMBRE_DIA[dia][0].toUpperCase() + NOMBRE_DIA[dia].slice(1) : `Día ${d + 1}`;
};

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const PALABRAS = [["lunes", 0], ["martes", 1], ["miercoles", 2], ["jueves", 3], ["viernes", 4], ["sabado", 5], ["domingo", 6]];

/** Los días de servicio de las restricciones («LMXJVS») → [0..6] */
export const diasDeServicio = txt => {
  const out = [...new Set([...String(txt || "").toUpperCase()].map(ch => DIAS.indexOf(ch)).filter(i => i >= 0))].sort((a, b) => a - b);
  return out.length ? out : [0, 1, 2, 3, 4];
};

/**
 * Lee una frecuencia escrita a mano.
 * @returns { dias: [0..6] } días fijos · { veces: n } n por semana (días libres) · null si no se entiende
 */
export function leerFrecuencia(valor, servicio) {
  const x = norm(valor);
  if (!x) return null;
  if (/diari|todos los dias|cada dia|^l-?d$/.test(x)) return { dias: [...servicio] };
  if (/laborable|lunes a viernes|^l ?- ?v$|^l a v$/.test(x)) return { dias: [0, 1, 2, 3, 4].filter(d => servicio.includes(d)) };
  if (/^l ?- ?s$|lunes a sabado/.test(x)) return { dias: [0, 1, 2, 3, 4, 5].filter(d => servicio.includes(d)) };
  const palabras = PALABRAS.filter(([p]) => x.includes(p)).map(([, d]) => d);
  if (palabras.length) return { dias: palabras };
  if (/semanal|1 ?vez|una vez|quincenal|mensual/.test(x)) return { veces: 1 };
  const n = /^(\d)\s*(?:\/|x|veces|por|v\b|$)/.exec(x);
  if (n) return { veces: Math.min(+n[1], servicio.length) };
  // letras de día: «L,X,V», «LXV», «L-X-V», «M J»
  const letras = x.toUpperCase().replace(/[^LMXJVSD]/g, "");
  if (letras && /^[LMXJVSD,;\s/-]+$/i.test(x.toUpperCase())) return { dias: [...new Set([...letras].map(ch => DIAS.indexOf(ch)))].sort((a, b) => a - b) };
  return null;
}

/** La frecuencia de una parada: su columna del Excel o la de por defecto */
export function frecuenciaDe(task, servicio, defecto = "diaria") {
  const campos = task.campos || {};
  const k = Object.keys(campos).find(c => /^(frecuen|dias|días|dia de|día de|periodicidad)/i.test(c.trim()));
  return (k && leerFrecuencia(campos[k], servicio)) || leerFrecuencia(task.frecuencia, servicio) || leerFrecuencia(defecto, servicio) || { dias: [...servicio] };
}

/** Las combinaciones de n días lo más separadas posible entre los días de servicio */
export function patronesSeparados(n, servicio) {
  const m = servicio.length;
  if (n >= m) return [[...servicio]];
  const out = new Map();
  for (let r = 0; r < m; r++) {
    const idx = Array.from({ length: n }, (_, i) => (r + Math.round((i * m) / n)) % m).sort((a, b) => a - b);
    const dias = [...new Set(idx)].map(i => servicio[i]);
    if (dias.length === n) out.set(dias.join(","), dias);
  }
  return [...out.values()];
}

/** Zonas fijas: una por vehículo, equilibradas por el trabajo de la semana */
export async function territorios(stops, k, peso) {
  const pts = stops.map(s => ({ lat: +s.lat, lng: +s.lng }));
  const asgn = Array.from(await kMeansCluster(pts, k));
  if (k <= 1) return asgn;
  const cent = () => Array.from({ length: k }, (_, c) => {
    const de = pts.filter((_, i) => asgn[i] === c);
    return de.length ? { lat: de.reduce((s, p) => s + p.lat, 0) / de.length, lng: de.reduce((s, p) => s + p.lng, 0) / de.length } : pts[0];
  });
  const carga = new Array(k).fill(0);
  stops.forEach((s, i) => { carga[asgn[i]] += peso(s); });
  const objetivo = carga.reduce((a, b) => a + b, 0) / k;
  let C = cent();
  // se pasan paradas de la zona más cargada a la vecina con menos, empezando por las del borde
  for (let it = 0; it < stops.length; it++) {
    const c = carga.indexOf(Math.max(...carga));
    if (carga[c] <= objetivo * 1.08) break;
    let mejor = null;
    for (let i = 0; i < pts.length; i++) {
      if (asgn[i] !== c) continue;
      const dPropio = haversineKm(pts[i].lat, pts[i].lng, C[c].lat, C[c].lng);
      for (let j = 0; j < k; j++) {
        if (j === c || carga[j] + peso(stops[i]) > objetivo * 1.08) continue;
        const coste = haversineKm(pts[i].lat, pts[i].lng, C[j].lat, C[j].lng) - dPropio;
        if (!mejor || coste < mejor.coste) mejor = { i, j, coste };
      }
    }
    if (!mejor) break;
    carga[c] -= peso(stops[mejor.i]); carga[mejor.j] += peso(stops[mejor.i]); asgn[mejor.i] = mejor.j;
    if (it % 25 === 24) C = cent();
  }
  return asgn;
}

/**
 * Los días de cada parada dentro de su zona.
 * @returns Map(stop → [días 0..6])
 */
export function repartirDias(stops, servicio, defecto) {
  const out = new Map();
  const carga = new Map(servicio.map(d => [d, 0]));
  const flexibles = [];
  for (const s of stops) {
    const f = frecuenciaDe(s, servicio, defecto);
    if (f.dias) {
      const dias = f.dias.filter(d => servicio.includes(d));
      out.set(s, dias);
      for (const d of dias) carga.set(d, carga.get(d) + (s.duracion || 15));
    } else flexibles.push([s, f.veces]);
  }
  // primero las que más veces van (son las que menos opciones tienen)
  flexibles.sort((a, b) => b[1] - a[1]);
  for (const [s, n] of flexibles) {
    let mejor = null;
    for (const p of patronesSeparados(n, servicio)) {
      const max = Math.max(...p.map(d => carga.get(d)));
      const suma = p.reduce((t, d) => t + carga.get(d), 0);
      if (!mejor || max < mejor.max || (max === mejor.max && suma < mejor.suma)) mejor = { p, max, suma };
    }
    out.set(s, mejor.p);
    for (const d of mejor.p) carga.set(d, carga.get(d) + (s.duracion || 15));
  }
  return out;
}

/**
 * La ruta maestra: la semana tipo, con cada vehículo en su zona.
 * @param generar  el motor de rutas (generateScenario o su versión en segundo plano)
 * @returns la misma forma que generateScenario ({ schedule, unassigned, daysUsed }) + resumen
 *          (el día i del escenario es servicio[i]: Día 1 = lunes…)
 */
export async function generarRutaMaestra(tasks, vehiculos, constraints, generar) {
  const servicio = diasDeServicio(constraints.diasServicio ?? FRECUENCIAS_DEFECTO.diasServicio);
  const defecto = constraints.frecuenciaDefecto || FRECUENCIAS_DEFECTO.frecuenciaDefecto;
  const conCoord = tasks.filter(t => hasCoords(t.lat, t.lng));
  const sinCoord = tasks.filter(t => !hasCoords(t.lat, t.lng));
  const veh = vehiculos.map(v => ({ ...v, _dayWindows: undefined, _coverDays: undefined })); // la semana tipo no mira el cuadrante del mes
  const k = Math.max(1, veh.length);
  const visitas = s => frecuenciaDe(s, servicio, defecto);
  const peso = s => { const f = visitas(s); return (f.dias ? f.dias.length : f.veces) * (s.duracion || 15); };
  const zona = await territorios(conCoord, k, peso);
  const schedule = veh.map(v => ({ ...v, assignments: [], totalKm: 0 }));
  const unassigned = [...sinCoord];
  const porDia = servicio.map(() => 0);
  let visitasTotal = 0;
  const cons1 = { ...constraints, days: 1, maxDays: 1 };
  for (let z = 0; z < k; z++) {
    const deZona = conCoord.filter((_, i) => zona[i] === z);
    const dias = repartirDias(deZona, servicio, defecto);
    for (let di = 0; di < servicio.length; di++) {
      const hoy = deZona.filter(s => dias.get(s).includes(servicio[di])).map(s => ({ ...s, _diaSemana: servicio[di] }));
      if (!hoy.length) continue;
      visitasTotal += hoy.length;
      const r = await generar(hoy, [veh[z]], cons1);
      const fila = r.schedule[0];
      const off = di * 1440;
      if (fila) {
        schedule[z].assignments.push(...fila.assignments.map(a => ({ ...a, _start: a._start + off, _end: a._end + off })));
        schedule[z].totalKm += fila.totalKm || 0;
        schedule[z].shiftStart ??= fila.shiftStart;
        schedule[z].shiftEnd ??= fila.shiftEnd;
        porDia[di] += fila.assignments.filter(a => !a._travel && !a._break && !a._wait).length;
      }
      unassigned.push(...(r.unassigned || []));
    }
  }
  return {
    schedule, unassigned, daysUsed: servicio.length,
    resumen: { dias: servicio, visitas: visitasTotal, paradas: conCoord.length, porDia },
  };
}
