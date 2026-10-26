// ── Red de líneas creada a mano en Operanzia (sin GTFS) ───────────────
// El planificador dibuja paradas, líneas (ida y vuelta), calendarios y
// horarios por frecuencias; de ese "diseño" se construye una red con la
// misma forma que la que sale de un GTFS (gtfs-red.js), así que Scheduling,
// Horarios, puntos de relevo y Control funcionan igual con las dos.
// El diseño viaja dentro de la propia red (red.diseno) para poder seguir
// editándola. Sin React ni Firebase.
//
// diseno = {
//   v: 1, operador,
//   paradas:     [{ id, nombre, lat, lng }],
//   calendarios: [{ id: "cal:…", nombre, dias: [0–6] (0 = domingo), desde, hasta, sin: [fechas], con: [fechas] }],
//   lineas:      [{ id, nombre, largo, color, sentidos: [{
//                   dir: 0|1, paradas: [ids], trazado: [[lat,lng]] | null (null = rectas entre paradas),
//                   tiempo: min de cabecera a cabecera, tiempos: { franja: min } (corrección por franja),
//                   horarios: { [calId]: [{ desde: min, hasta: min, cada: min }] } }] }]
// }

import { FRANJAS, TIPOS_DIA, nombreCalendario, kmTrazado, franjaDe } from "./gtfs-red.js";
import { C } from "./tema.js";

export const PALETA_LINEAS = [C.blue, C.green, C.orange, C.red, C.violet, C.amber, "#f472b6", "#22d3ee", "#84cc16", "#e879f9", "#38bdf8", "#facc15"];
const r5 = x => Math.round(x * 1e5) / 1e5;
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const diaSemana = f => new Date(f + "T00:00:00Z").getUTCDay();
const claseDia = f => { const w = diaSemana(f); return w === 0 ? "festivo" : w === 6 ? "sabado" : "laborable"; };
export const hhmmMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Identificador corto y único (paradas, líneas, calendarios) */
export const nuevoId = (prefijo, existentes = []) => {
  const usados = new Set(existentes);
  for (let i = 0; i < 1000; i++) { const id = `${prefijo}${Math.random().toString(36).slice(2, 7)}`; if (!usados.has(id)) return id; }
  return `${prefijo}${Date.now()}`;
};

/** Diseño vacío con los tres calendarios de siempre (desde hoy, un año) */
export function disenoNuevo(hoy = new Date()) {
  const desde = ymd(new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())));
  const hasta = ymd(new Date(Date.UTC(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate() - 1)));
  return {
    v: 1, operador: "",
    paradas: [],
    calendarios: [
      { id: "cal:lab", nombre: "Laborables", dias: [1, 2, 3, 4, 5], desde, hasta, sin: [], con: [] },
      { id: "cal:sab", nombre: "Sábados", dias: [6], desde, hasta, sin: [], con: [] },
      { id: "cal:dom", nombre: "Domingos y festivos", dias: [0], desde, hasta, sin: [], con: [] },
    ],
    lineas: [],
  };
}

/** Las fechas de un calendario (yyyy-mm-dd, ordenadas) */
export function fechasCalendario(c) {
  const out = new Set();
  if (c.desde && c.hasta && c.desde <= c.hasta) {
    const dias = new Set(c.dias || []);
    const sin = new Set(c.sin || []);
    const d = new Date(c.desde + "T00:00:00Z"), fin = new Date(c.hasta + "T00:00:00Z");
    for (let n = 0; d <= fin && n < 3000; n++, d.setUTCDate(d.getUTCDate() + 1)) {
      const f = ymd(d);
      if (dias.has(d.getUTCDay()) && !sin.has(f)) out.add(f);
    }
  }
  for (const f of c.con || []) if (/^\d{4}-\d\d-\d\d$/.test(f)) out.add(f);
  return [...out].sort();
}

/** Las salidas de unos tramos de frecuencia: de 06:00 a 22:00 cada 15 → 06:00, 06:15… 22:00 */
export function salidasDeTramos(tramos) {
  const s = new Set();
  for (const t of tramos || []) {
    const cada = Math.max(1, Math.round(t.cada || 0));
    if (t.desde == null || t.hasta == null || !t.cada) continue;
    const hasta = t.hasta < t.desde ? t.hasta + 1440 : t.hasta; // tramo que pasa de medianoche
    for (let m = t.desde; m <= hasta && s.size < 2000; m += cada) s.add(Math.round(m));
  }
  return [...s].sort((a, b) => a - b);
}

/** Recorrido de un sentido: el dibujado, o rectas entre sus paradas */
export function trazadoSentido(s, paradaPorId) {
  if (s.trazado?.length >= 2) return s.trazado;
  return (s.paradas || []).map(id => paradaPorId.get(id)).filter(Boolean).map(p => [r5(p.lat), r5(p.lng)]);
}
/** Tiempo de recorrido que se propone si no se ha puesto: a 18 km/h de media, mínimo 5 min */
export const tiempoPropuesto = km => Math.max(5, Math.round((km / 18) * 60));

/** Problemas del diseño que impiden usarlo (o que conviene revisar) */
export function revisarDiseno(d) {
  const avisos = [];
  if (!d.lineas.length) avisos.push("Aún no hay ninguna línea.");
  for (const l of d.lineas) {
    if (!l.sentidos.length) avisos.push(`La línea ${l.nombre} no tiene recorrido.`);
    for (const s of l.sentidos) {
      const nom = `${l.nombre} (${s.dir === 0 ? "ida" : "vuelta"})`;
      if ((s.paradas || []).length < 2) avisos.push(`${nom}: necesita al menos 2 paradas.`);
      const conHorario = Object.values(s.horarios || {}).some(t => salidasDeTramos(t).length);
      if (!conHorario) avisos.push(`${nom}: sin horarios (no saldrá ningún viaje).`);
    }
  }
  for (const c of d.calendarios) if (!fechasCalendario(c).length) avisos.push(`El calendario «${c.nombre}» no tiene ningún día.`);
  return avisos;
}

/**
 * Construye la red (la misma forma que parseGtfsRed) a partir del diseño.
 * Cada calendario hace de "servicio" de sí mismo: las salidas de un sentido
 * van en porServicio por calendario, como en un GTFS.
 */
export function construirRed(d) {
  const paradaPorId = new Map(d.paradas.map(p => [p.id, p]));
  const calendarios = d.calendarios.map(c => ({ ...c, fechas: fechasCalendario(c) }));
  // día de referencia de cada tipo (laborable, sábado, festivo): el de más viajes
  const salidasPorCal = (s, calId) => salidasDeTramos(s.horarios?.[calId]);
  const viajesCal = new Map(calendarios.map(c => [c.id, d.lineas.reduce((n, l) => n + l.sentidos.reduce((m, s) => m + ((s.paradas || []).length >= 2 ? salidasPorCal(s, c.id).length : 0), 0), 0)]));
  const porFecha = new Map();
  for (const c of calendarios) for (const f of c.fechas) { if (!porFecha.has(f)) porFecha.set(f, []); porFecha.get(f).push(c.id); }
  const dias = {};
  for (const [f, cals] of porFecha) {
    const n = cals.reduce((x, id) => x + viajesCal.get(id), 0);
    const cl = claseDia(f);
    if (n && (!dias[cl] || n > dias[cl].n || (n === dias[cl].n && f < dias[cl].f))) dias[cl] = { f, n };
  }
  const calsDeTipo = Object.fromEntries(TIPOS_DIA.map(t => [t.id, new Set(dias[t.id] ? porFecha.get(dias[t.id].f) : [])]));

  const lineas = d.lineas.map(l => ({
    id: l.id, nombre: l.nombre || "?", largo: l.largo || "", color: l.color || PALETA_LINEAS[0], tipo: "Autobús", agencia: d.operador || "",
    sentidos: l.sentidos.filter(s => (s.paradas || []).length >= 2).map(s => {
      const trazado = trazadoSentido(s, paradaPorId);
      const km = kmTrazado(trazado);
      const base = s.tiempo > 0 ? Math.round(s.tiempo) : tiempoPropuesto(km);
      const porServicio = calendarios.map(c => [c.id, salidasPorCal(s, c.id)]).filter(([, lst]) => lst.length);
      const viajes = {}, salidas = {};
      for (const t of TIPOS_DIA) {
        const lst = porServicio.filter(([k]) => calsDeTipo[t.id].has(k)).flatMap(([, x]) => x).sort((a, b) => a - b);
        viajes[t.id] = lst.length; salidas[t.id] = lst;
      }
      const todas = porServicio.flatMap(([, x]) => x);
      const porFranja = new Map();
      for (const m of todas) porFranja.set(franjaDe(m), (porFranja.get(franjaDe(m)) || 0) + 1);
      const ultima = paradaPorId.get(s.paradas.at(-1));
      return {
        dir: s.dir, nombre: s.dir === 0 ? "Ida" : "Vuelta", cabecera: ultima?.nombre || "",
        paradas: [...s.paradas], trazado, km, viajes, salidas, porServicio,
        primera: todas.length ? hhmmMin(Math.min(...todas) % 1440) : null, ultima: todas.length ? hhmmMin(Math.max(...todas) % 1440) : null,
        tiempos: FRANJAS.map(f => ({ franja: f.id, min: s.tiempos?.[f.id] > 0 ? Math.round(s.tiempos[f.id]) : base, viajes: porFranja.get(f.id) || 0 })),
      };
    }).sort((a, b) => a.dir - b.dir),
  })).filter(l => l.sentidos.length).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));

  const usadas = new Set(lineas.flatMap(l => l.sentidos.flatMap(s => s.paradas)));
  return {
    paradas: d.paradas.filter(p => usadas.has(p.id)).map(p => ({ id: p.id, nombre: p.nombre, codigo: p.codigo || "", lat: r5(p.lat), lng: r5(p.lng) })),
    lineas,
    dias: Object.fromEntries(TIPOS_DIA.map(t => [t.id, dias[t.id]?.f || null])),
    calendarios: calendarios.filter(c => c.fechas.length && viajesCal.get(c.id)).map(c => ({
      id: c.id, nombre: c.nombre?.trim() || nombreCalendario(c.fechas), servicios: [c.id], fechas: c.fechas, codigos: [], viajes: viajesCal.get(c.id),
    })),
    agencias: d.operador ? [d.operador] : [],
    viajesPartidos: 0,
    diseno: d,
  };
}

/** La vuelta de un sentido: las mismas paradas al revés (y el recorrido al revés) */
export function vueltaDe(ida) {
  return {
    dir: 1, paradas: [...(ida.paradas || [])].reverse(), trazado: ida.trazado ? [...ida.trazado].reverse() : null,
    tiempo: ida.tiempo || null, tiempos: { ...(ida.tiempos || {}) }, horarios: JSON.parse(JSON.stringify(ida.horarios || {})),
  };
}

/** Quita una parada del diseño (y de todos los recorridos que la usan) */
export function quitarParada(d, id) {
  return {
    ...d,
    paradas: d.paradas.filter(p => p.id !== id),
    lineas: d.lineas.map(l => ({ ...l, sentidos: l.sentidos.map(s => (s.paradas.includes(id) ? { ...s, paradas: s.paradas.filter(x => x !== id), trazado: null } : s)) })),
  };
}
