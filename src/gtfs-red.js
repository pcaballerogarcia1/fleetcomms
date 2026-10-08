// ── Red de líneas regulares desde un GTFS (proyectos "Líneas regulares") ─
// A diferencia de gtfs-parse.js (paradas sueltas para el mapa de puntos),
// aquí se saca lo que necesita planificar autobuses:
//   · cada línea con sus sentidos (ida / vuelta), la secuencia de paradas
//     del patrón más habitual, la cabecera y el recorrido;
//   · viajes por tipo de día (laborable, sábado, domingo/festivo), tomando
//     como referencia el día de cada tipo con más servicio del calendario;
//   · calendarios: los días del GTFS agrupados por el conjunto de servicios
//     que funcionan (mismo conjunto = mismo horario), con nombre legible
//     ("Lunes a viernes · 7 sep – 18 dic"); cada sentido guarda sus salidas
//     por servicio para sacar las de cualquier calendario;
//   · tiempo de recorrido de cabecera a cabecera por franja horaria
//     (mediana de los viajes de un laborable).
// Lee el zip por trozos (stop_times de cientos de MB) en el orden que
// conviene: paradas, viajes y calendario antes que stop_times.

import { zipEntries, leerCsv, tipoRuta, simplificar, minToHHMM, hhmm, r5, PALETA } from "./gtfs-parse.js";

export const FRANJAS = [
  { id: "00-06", desde: 0, hasta: 360 },
  { id: "06-09", desde: 360, hasta: 540 },
  { id: "09-13", desde: 540, hasta: 780 },
  { id: "13-16", desde: 780, hasta: 960 },
  { id: "16-20", desde: 960, hasta: 1200 },
  { id: "20-24", desde: 1200, hasta: 1440 },
];
export const TIPOS_DIA = [
  { id: "laborable", nombre: "Laborable" },
  { id: "sabado", nombre: "Sábado" },
  { id: "festivo", nombre: "Domingo / festivo" },
];
export const franjaDe = min => FRANJAS.find(f => (min % 1440) >= f.desde && (min % 1440) < f.hasta)?.id || FRANJAS[0].id;

const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const fecha = s => (/^\d{8}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))) : null);
const ymd = d => d.toISOString().slice(0, 10);
const claseDia = d => { const w = d.getUTCDay(); return w === 0 ? "festivo" : w === 6 ? "sabado" : "laborable"; };

const SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SEMANA_PL = ["Domingos", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábados"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaMes = f => `${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]}`;

/** Nombre de un calendario a partir de sus fechas (yyyy-mm-dd ordenadas) */
export function nombreCalendario(fechas) {
  if (!fechas.length) return "Sin días";
  const sem = f => new Date(f + "T00:00:00Z").getUTCDay();
  if (fechas.length === 1) return `Solo el ${SEMANA[sem(fechas[0])]} ${diaMes(fechas[0])}`;
  const cuenta = [0, 0, 0, 0, 0, 0, 0];
  for (const f of fechas) cuenta[sem(f)]++;
  const max = Math.max(...cuenta);
  // días de la semana "propios" del calendario; los demás son días sueltos (festivos, puentes…)
  const propios = cuenta.map((n, w) => (n >= 2 && n >= max * 0.3 ? w : -1)).filter(w => w >= 0);
  const sueltos = fechas.filter(f => !propios.includes(sem(f))).length;
  const orden = propios.map(w => (w + 6) % 7).sort((a, b) => a - b).map(x => (x + 1) % 7); // lunes primero
  let semana;
  const seguidos = orden.length > 2 && orden.every((w, i) => i === 0 || (w + 6) % 7 === (orden[i - 1] + 6) % 7 + 1);
  const lista = fs => fs.map((f, i) => (i < fs.length - 1 && f.slice(5, 7) === fs[i + 1].slice(5, 7) ? String(+f.slice(8, 10)) : diaMes(f))).join(", ").replace(/, ([^,]+)$/, " y $1");
  if (!orden.length) return fechas.length <= 5 ? `Días ${lista(fechas)}` : `${fechas.length} días sueltos · ${diaMes(fechas[0])} – ${diaMes(fechas.at(-1))}`;
  if (orden.length === 7) semana = "Todos los días";
  else if (seguidos) semana = `${SEMANA_PL[orden[0]]} a ${SEMANA[orden.at(-1)]}`;
  else semana = orden.map((w, i) => (i ? SEMANA[w] : SEMANA_PL[w])).join(orden.length === 2 ? " y " : ", ");
  if (orden.length === 1 && orden[0] === 0 && sueltos) semana = "Domingos y festivos";
  else if (sueltos) semana += ` y ${sueltos} día${sueltos > 1 ? "s" : ""} más`;
  return `${semana} · ${diaMes(fechas[0])} – ${diaMes(fechas.at(-1))}`;
}

export function kmTrazado(pts) {
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = pts[i - 1], [c, e] = pts[i];
    const dLat = (c - a) * Math.PI / 180, dLng = (e - b) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    km += 12742 * Math.asin(Math.sqrt(h));
  }
  return Math.round(km * 10) / 10;
}

export async function parseGtfsRed(blob, { onProgress = () => {} } = {}) {
  const entries = await zipEntries(blob);
  for (const f of ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
    if (!entries.has(f)) throw new Error(`No parece un GTFS: falta ${f}`);
  }
  const total = [...entries.values()].reduce((s, e) => s + e.csize, 0) || 1;
  let leidos = 0, ultimo = 0, fase = "";
  const bytes = n => { leidos += n; const f = leidos / total; if (f - ultimo > 0.01) { ultimo = f; onProgress(Math.min(f, 0.99), fase); } };
  const paso = t => { fase = t; onProgress(Math.min(leidos / total, 0.99), t); };

  // Operadores y líneas
  paso("Leyendo operadores y líneas…");
  const agencias = new Map();
  await leerCsv(blob, entries, "agency.txt", (c, i) => agencias.set(c[i.agency_id] ?? "", c[i.agency_name] ?? ""), bytes);
  const lineas = [], rutaIdx = new Map();
  await leerCsv(blob, entries, "routes.txt", (c, i) => {
    const id = c[i.route_id];
    if (!id || rutaIdx.has(id)) return;
    const corto = (c[i.route_short_name] || "").trim(), largo = (c[i.route_long_name] || "").trim();
    const col = (c[i.route_color] || "").trim().replace(/^#/, "");
    rutaIdx.set(id, lineas.length);
    lineas.push({
      id, nombre: corto || largo || id, largo: corto ? largo : "",
      color: /^[0-9a-f]{6}$/i.test(col) ? `#${col.toLowerCase()}` : PALETA[lineas.length % PALETA.length],
      tipo: tipoRuta(c[i.route_type]),
      agencia: agencias.get(c[i.agency_id] ?? "") || (agencias.size === 1 ? [...agencias.values()][0] : ""),
    });
  }, bytes);

  // Paradas (antes que stop_times: se guardan por índice)
  paso("Leyendo paradas…");
  const paradas = [], paradaIdx = new Map();
  await leerCsv(blob, entries, "stops.txt", (c, i) => {
    const tipo = i.location_type != null ? c[i.location_type] : "";
    if (tipo && tipo !== "0") return;
    const lat = parseFloat(c[i.stop_lat]), lng = parseFloat(c[i.stop_lon]);
    if (!isFinite(lat) || !isFinite(lng) || (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5)) return;
    const id = c[i.stop_id];
    paradaIdx.set(id, paradas.length);
    paradas.push({ id, nombre: (c[i.stop_name] || "").trim() || id, codigo: (i.stop_code != null && c[i.stop_code]) || id, lat, lng });
  }, bytes);

  // Calendario: qué días funciona cada servicio
  paso("Leyendo calendario…");
  const servIdx = new Map(), servDias = []; // servicio → Set(yyyy-mm-dd)
  const serv = id => { if (!servIdx.has(id)) { servIdx.set(id, servDias.length); servDias.push(new Set()); } return servIdx.get(id); };
  const DIAS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  await leerCsv(blob, entries, "calendar.txt", (c, i) => {
    const k = serv(c[i.service_id]);
    const ini = fecha(c[i.start_date]), fin = fecha(c[i.end_date]);
    if (!ini || !fin) return;
    for (let d = new Date(ini), n = 0; d <= fin && n < 400; d.setUTCDate(d.getUTCDate() + 1), n++) {
      if (c[i[DIAS[d.getUTCDay()]]] === "1") servDias[k].add(ymd(d));
    }
  }, bytes);
  await leerCsv(blob, entries, "calendar_dates.txt", (c, i) => {
    const k = serv(c[i.service_id]), d = fecha(c[i.date]);
    if (!d) return;
    if (c[i.exception_type] === "2") servDias[k].delete(ymd(d)); else servDias[k].add(ymd(d));
  }, bytes);

  // Viajes
  paso("Leyendo viajes…");
  const viajeIdx = new Map();
  const vRuta = [], vDir = [], vCab = [], vServ = [], vShape = [];
  await leerCsv(blob, entries, "trips.txt", (c, i) => {
    const r = rutaIdx.get(c[i.route_id]);
    if (r === undefined) return;
    viajeIdx.set(c[i.trip_id], vRuta.length);
    vRuta.push(r);
    vDir.push(i.direction_id != null && c[i.direction_id] === "1" ? 1 : 0);
    vCab.push(i.trip_headsign != null ? (c[i.trip_headsign] || "").trim() : "");
    vServ.push(serv(c[i.service_id]));
    vShape.push(i.shape_id != null ? c[i.shape_id] || "" : "");
  }, bytes);
  const nV = vRuta.length;
  const vPat = new Int32Array(nV).fill(-1), vIni = new Int32Array(nV).fill(-1), vFin = new Int32Array(nV).fill(-1);

  // Horarios de paso: patrón de paradas y hora de salida/llegada de cada viaje.
  // Las filas de un viaje suelen venir seguidas. Si algún viaje aparece en
  // dos tandas separadas, se marca y se recompone con una segunda pasada
  // que solo recoge las filas de esos viajes (en GTFS ordenados no hace falta).
  paso("Cruzando horarios de paso (puede tardar con redes grandes)…");
  const patrones = [], patronIdx = new Map();
  const cerrar = (v, rows) => {
    rows.sort((x, y) => x[0] - y[0]);
    const seq = rows.map(r => r[1]).filter(st => st >= 0);
    const key = seq.join(",");
    let pt = patronIdx.get(key);
    if (pt === undefined) { pt = patrones.length; patronIdx.set(key, pt); patrones.push(seq); }
    vPat[v] = pt;
    const ini = rows.find(r => r[2] >= 0), fin = [...rows].reverse().find(r => r[3] >= 0);
    vIni[v] = ini ? ini[2] : -1; vFin[v] = fin ? fin[3] : -1;
  };
  const fila = (c, i) => [Number(c[i.stop_sequence]), paradaIdx.get(c[i.stop_id]) ?? -1,
    hhmm(c[i.departure_time] || c[i.arrival_time]) ?? -1, hhmm(c[i.arrival_time] || c[i.departure_time]) ?? -1];
  const partidos = new Set();
  let cur = -1, filas = [];
  await leerCsv(blob, entries, "stop_times.txt", (c, i) => {
    const v = viajeIdx.get(c[i.trip_id]);
    if (v === undefined) return;
    if (v === cur) { filas.push(fila(c, i)); return; }
    if (cur >= 0 && !partidos.has(cur)) cerrar(cur, filas);
    cur = v; filas = [fila(c, i)];
    if (vPat[v] >= 0) partidos.add(v); // ya visto antes: viene en dos tandas
  }, bytes);
  if (cur >= 0 && !partidos.has(cur)) cerrar(cur, filas);
  if (partidos.size) {
    paso("Recomponiendo viajes que vienen partidos…");
    const resto = new Map([...partidos].map(v => [v, []]));
    await leerCsv(blob, entries, "stop_times.txt", (c, i) => {
      const v = viajeIdx.get(c[i.trip_id]);
      if (v !== undefined && resto.has(v)) resto.get(v).push(fila(c, i));
    });
    for (const [v, rows] of resto) cerrar(v, rows);
  }

  // Día de referencia de cada tipo: el que más viajes tiene
  const viajesPorServ = new Int32Array(servDias.length);
  for (let v = 0; v < nV; v++) viajesPorServ[vServ[v]]++;
  const porFecha = new Map();
  servDias.forEach((dias, k) => { for (const d of dias) porFecha.set(d, (porFecha.get(d) || 0) + viajesPorServ[k]); });
  const dias = {};
  for (const [d, n] of porFecha) {
    const cl = claseDia(new Date(d + "T00:00:00Z"));
    if (!dias[cl] || n > dias[cl].n || (n === dias[cl].n && d < dias[cl].d)) dias[cl] = { d, n };
  }
  const activo = {}; // clase → Set(servicio)
  for (const t of TIPOS_DIA) {
    activo[t.id] = new Set();
    if (dias[t.id]) servDias.forEach((s, k) => { if (s.has(dias[t.id].d)) activo[t.id].add(k); });
  }
  const sinCalendario = !porFecha.size; // feeds sin calendario: todo cuenta como laborable

  // Calendarios: fechas con el mismo conjunto de servicios (con viajes)
  const servDeFecha = new Map();
  servDias.forEach((ds, k) => {
    if (!viajesPorServ[k]) return;
    for (const d of ds) { if (!servDeFecha.has(d)) servDeFecha.set(d, []); servDeFecha.get(d).push(k); }
  });
  const servNombre = [];
  for (const [id, k] of servIdx) servNombre[k] = id;
  const porConjunto = new Map();
  for (const [d, ks] of [...servDeFecha].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const clave = ks.sort((a, b) => a - b).join(",");
    if (!porConjunto.has(clave)) porConjunto.set(clave, { servicios: ks, fechas: [] });
    porConjunto.get(clave).fechas.push(d);
  }
  const calendarios = [...porConjunto.values()]
    .sort((a, b) => b.fechas.length - a.fechas.length || (a.fechas[0] < b.fechas[0] ? -1 : 1))
    .map((c, i) => ({
      id: `cal:${i + 1}`, nombre: nombreCalendario(c.fechas), servicios: c.servicios, fechas: c.fechas,
      codigos: c.servicios.slice(0, 4).map(k => servNombre[k]), // service_id del GTFS (en muchas empresas, ya es el nombre)
      viajes: c.servicios.reduce((n, k) => n + viajesPorServ[k], 0),
    }));

  // Agregados por línea y sentido
  paso("Calculando sentidos y tiempos de recorrido…");
  const grupos = new Map(); // "r|dir" → [viajes]
  for (let v = 0; v < nV; v++) {
    if (vPat[v] < 0) continue;
    const k = `${vRuta[v]}|${vDir[v]}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(v);
  }
  const shapesQuiero = new Map(); // shape → [[r, dir]]
  const sentidos = new Map(); // r → [sentido]
  for (const [k, vs] of grupos) {
    const [r, dir] = k.split("|").map(Number);
    const enLab = sinCalendario ? vs : vs.filter(v => activo.laborable.has(vServ[v]));
    const base = enLab.length ? enLab : vs;
    const masComun = arr => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
    const pat = patrones[masComun(base.map(v => vPat[v]))] || [];
    const cab = masComun(base.map(v => vCab[v]).filter(Boolean)) || paradas[pat[pat.length - 1]]?.nombre || "";
    const sh = masComun(base.map(v => vShape[v]).filter(Boolean));
    if (sh) { if (!shapesQuiero.has(sh)) shapesQuiero.set(sh, []); shapesQuiero.get(sh).push([r, dir]); }
    // Viajes y horas de salida (minutos desde las 00:00, >1440 = madrugada
    // del día siguiente) de cada tipo de día: lo que encadena el Scheduling
    const viajes = {}, salidas = {};
    // salidas por servicio: [[servicio, [min…]], …] (las de cualquier calendario)
    const porServ = new Map();
    for (const v of vs) {
      if (vIni[v] < 0) continue;
      if (!porServ.has(vServ[v])) porServ.set(vServ[v], []);
      porServ.get(vServ[v]).push(vIni[v]);
    }
    const porServicio = [...porServ].map(([k, l]) => [k, l.sort((a, b) => a - b)]);
    for (const t of TIPOS_DIA) {
      const delDia = sinCalendario ? (t.id === "laborable" ? vs : []) : vs.filter(v => activo[t.id].has(vServ[v]));
      viajes[t.id] = delDia.length;
      salidas[t.id] = delDia.map(v => vIni[v]).filter(x => x >= 0).sort((a, b) => a - b);
    }
    const porFranja = new Map();
    let primera = null, ultima = null;
    for (const v of base) {
      if (vIni[v] < 0) continue;
      if (primera == null || vIni[v] < primera) primera = vIni[v];
      if (ultima == null || vIni[v] > ultima) ultima = vIni[v];
      if (vFin[v] < vIni[v]) continue;
      const f = franjaDe(vIni[v]);
      if (!porFranja.has(f)) porFranja.set(f, []);
      porFranja.get(f).push(vFin[v] - vIni[v]);
    }
    const s = {
      dir, nombre: dir === 0 ? "Ida" : "Vuelta", cabecera: cab,
      paradas: pat.map(p => paradas[p].id), trazado: [], km: null, viajes, salidas, porServicio,
      primera: minToHHMM(primera), ultima: minToHHMM(ultima),
      tiempos: FRANJAS.filter(f => porFranja.has(f.id)).map(f => ({ franja: f.id, min: mediana(porFranja.get(f.id)), viajes: porFranja.get(f.id).length })),
    };
    if (!sentidos.has(r)) sentidos.set(r, []);
    sentidos.get(r).push(s);
  }

  // Recorridos (el más usado de cada línea y sentido)
  if (shapesQuiero.size && entries.has("shapes.txt")) {
    paso("Leyendo recorridos…");
    const pts = new Map();
    await leerCsv(blob, entries, "shapes.txt", (c, i) => {
      const sh = c[i.shape_id];
      if (!shapesQuiero.has(sh)) return;
      let a = pts.get(sh); if (!a) pts.set(sh, (a = []));
      a.push([Number(c[i.shape_pt_sequence]), parseFloat(c[i.shape_pt_lat]), parseFloat(c[i.shape_pt_lon])]);
    }, bytes);
    for (const [sh, usos] of shapesQuiero) {
      const a = pts.get(sh);
      if (!a?.length) continue;
      a.sort((x, y) => x[0] - y[0]);
      const completo = a.map(p => [p[1], p[2]]);
      const km = kmTrazado(completo);
      const linea = simplificar(completo).map(([y, x]) => [r5(y), r5(x)]);
      for (const [r, dir] of usos) {
        const s = sentidos.get(r)?.find(x => x.dir === dir);
        if (s) { s.trazado = linea; s.km = km; }
      }
    }
  }
  // Sin recorrido en el GTFS: se une la secuencia de paradas
  for (const ss of sentidos.values()) for (const s of ss) {
    if (!s.trazado.length && s.paradas.length > 1) {
      s.trazado = s.paradas.map(id => paradas[paradaIdx.get(id)]).map(p => [r5(p.lat), r5(p.lng)]);
      s.km = kmTrazado(s.trazado);
    }
  }

  const salida = lineas
    .map((l, r) => ({ ...l, sentidos: (sentidos.get(r) || []).sort((a, b) => a.dir - b.dir) }))
    .filter(l => l.sentidos.length)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  const usadas = new Set(salida.flatMap(l => l.sentidos.flatMap(s => s.paradas)));
  onProgress(1, "Listo");
  return {
    paradas: paradas.filter(p => usadas.has(p.id)),
    lineas: salida,
    dias: Object.fromEntries(TIPOS_DIA.map(t => [t.id, dias[t.id]?.d || null])),
    calendarios,
    agencias: [...agencias.values()].filter(Boolean),
    viajesPartidos: partidos.size,
  };
}

/** Viajes de un sentido en un conjunto de servicios (los de los calendarios elegidos) */
const viajesEn = (s, servicios) => (s.porServicio || []).reduce((n, [k, l]) => n + (servicios.has(k) ? l.length : 0), 0);

/** Viajes de una línea en los calendarios elegidos (para la ventana de importar) */
export function viajesLinea(linea, calendarios) {
  const servicios = new Set(calendarios.flatMap(c => c.servicios));
  return linea.sentidos.reduce((n, s) => n + viajesEn(s, servicios), 0);
}

/**
 * Lo que se guarda al importar: solo las líneas y los calendarios elegidos.
 * Los calendarios conservan su id (cal:N); cada sentido se queda con los
 * servicios de esos calendarios; las paradas, solo las de esas líneas; y los
 * viajes de cada calendario se recuentan con las líneas que quedan.
 */
export function filtrarRed(red, { lineas, calendarios }) {
  const ls = new Set(lineas), cs = new Set(calendarios);
  const cals = (red.calendarios || []).filter(c => cs.has(c.id));
  const servicios = new Set(cals.flatMap(c => c.servicios));
  const hayCalendarios = (red.calendarios || []).length > 0;
  const lineasF = red.lineas.filter(l => ls.has(l.id)).map(l => ({
    ...l,
    sentidos: l.sentidos.map(s => (hayCalendarios && s.porServicio ? { ...s, porServicio: s.porServicio.filter(([k]) => servicios.has(k)) } : s)),
  }));
  const usadas = new Set(lineasF.flatMap(l => l.sentidos.flatMap(s => s.paradas)));
  const sentidos = lineasF.flatMap(l => l.sentidos);
  return {
    ...red,
    lineas: lineasF,
    paradas: red.paradas.filter(p => usadas.has(p.id)),
    calendarios: cals.map(c => {
      const propios = new Set(c.servicios);
      return { ...c, viajes: sentidos.reduce((n, s) => n + viajesEn(s, propios), 0) };
    }),
  };
}
