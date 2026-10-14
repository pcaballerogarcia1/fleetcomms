// Scheduling de puntos · capacidad del camión y viajes a descargar.
// El optimizador reparte las paradas por tiempo; aquí se añade lo que en
// recogida manda tanto como el tiempo: el camión se llena.
//  · Antes de optimizar (reservarDescargas): a cada parada se le suma la parte
//    del viaje a la planta y la descarga que le toca según lo que llena, para
//    que el reparto ya cuente con ese tiempo.
//  · Después (aplicarDescargas): se recorre cada ruta sumando la carga parada a
//    parada; cuando la siguiente ya no cabe, el camión va a la planta más
//    cercana, descarga y vuelve. Al final del día descarga antes de volver al
//    depósito. Se rehacen las horas (con las franjas y las pausas) y se avisa
//    si alguna ruta se pasa de la jornada.
// Sin React ni Firebase.
import { haversineKm, hasCoords, windowWait, TRAVEL_SPEED_KMH } from "../vrp-engine.js";

export const CAPACIDAD_DEFECTO = { usarCapacidad: false, llenadoPct: 70, compactacion: 3, litrosPorDefecto: 1000, tiempoDescarga: 20 };
/** Las opciones de capacidad que hay en las restricciones del escenario */
export const capacidadDe = constraints => Object.fromEntries(Object.keys(CAPACIDAD_DEFECTO).map(k => [k, constraints?.[k] ?? CAPACIDAD_DEFECTO[k]]));
/** Una parada con su duración de verdad (sin la parte de descarga reservada) */
export const sinReserva = t => {
  if (t?._durOrig == null) return t;
  const { _durOrig, ...resto } = t;
  return { ...resto, duracion: _durOrig, ...(t._start != null ? { _end: t._start + _durOrig } : {}) };
};
const minutos = km => (km >= 0.05 ? Math.max(1, Math.ceil((km / TRAVEL_SPEED_KMH) * 60)) : 0);

/** Litros del contenedor: de una columna (litros / volumen / capacidad) o del tipo («Carga lateral 3200L») */
export function litrosDe(task) {
  const campos = task.campos || {};
  for (const [k, v] of Object.entries(campos)) {
    if (/^(litros|volumen|capacidad)/i.test(k)) { const n = parseFloat(String(v).replace(",", ".")); if (n > 0) return n < 20 ? n * 1000 : n; } // m³ o litros
  }
  const texto = `${task.contenedor || ""} ${campos.contenedor || campos["tipo contenedor"] || campos.tipo_contenedor || ""}`;
  const m = /(\d{1,2}[.,]\d{3}|\d{2,4})\s*(?:l\b|lts?\b|litros)/i.exec(texto) || /\b(80|120|240|330|360|660|770|800|1000|1100|1700|2200|2400|3000|3200|4000|5000)\b/.exec(texto);
  return m ? parseFloat(m[1].replace(/[.,]/, "")) : null;
}

/** m³ que ocupa en el camión una parada (con el llenado medio y la compactación) */
export function cargaDe(task, c) {
  const litros = litrosDe(task) ?? c.litrosPorDefecto;
  return (litros / 1000) * (c.llenadoPct / 100) / Math.max(1, c.compactacion);
}

const plantaMasCercana = (lat, lng, plantas) => {
  let mejor = null, d = Infinity;
  for (const pl of plantas) { const k = haversineKm(lat, lng, pl.lat, pl.lng); if (k < d) { d = k; mejor = pl; } }
  return mejor ? { planta: mejor, km: d } : null;
};

/**
 * Antes de optimizar: la duración de cada parada con su parte de descarga.
 * (Se guarda la original en _durOrig; aplicarDescargas la devuelve.)
 */
export function reservarDescargas(tasks, vehiculos, plantas, opciones) {
  const c = { ...CAPACIDAD_DEFECTO, ...opciones };
  const caps = vehiculos.map(v => Number(v.capacidad) || 0).filter(x => x > 0);
  if (!c.usarCapacidad || !caps.length) return tasks;
  const cap = caps.reduce((s, x) => s + x, 0) / caps.length; // la media de la flota
  // lo que cuesta un viaje a descargar: ida y vuelta a la planta desde el centro de las paradas + la descarga
  const conCoord = tasks.filter(t => hasCoords(t.lat, t.lng));
  let viaje = 0;
  if (conCoord.length && plantas.length) {
    const lat = conCoord.reduce((s, t) => s + +t.lat, 0) / conCoord.length, lng = conCoord.reduce((s, t) => s + +t.lng, 0) / conCoord.length;
    viaje = 2 * minutos(plantaMasCercana(lat, lng, plantas).km);
  }
  const porDescarga = viaje + c.tiempoDescarga;
  return tasks.map(t => {
    const dur = t.duracion || 15;
    return { ...t, _durOrig: dur, duracion: dur + Math.round(((cargaDe(t, c) / cap) * porDescarga) * 10) / 10 };
  });
}

/**
 * Después de optimizar: las descargas en cada ruta y las horas de nuevo.
 * Se respeta el orden del optimizador, sus pausas y sus viajes (con los km de
 * carretera si ya los tienen); solo cambian los tramos donde se mete una
 * descarga: de la última parada a la planta y de la planta a la siguiente.
 * @param schedule  filas de vehículo con sus assignments (se devuelven nuevas)
 * @param plantas   [{ lat, lng, nombre }] (si no hay, se descarga en el depósito del vehículo)
 * @returns { schedule, resumen: { descargas, kmDescarga, rutasPasadas, minPasados } }
 */
export function aplicarDescargas(schedule, plantas, opciones) {
  const c = { ...CAPACIDAD_DEFECTO, ...opciones };
  const capFlota = Math.max(0, ...schedule.map(r => Number(r.capacidad) || 0));
  const resumen = { descargas: 0, kmDescarga: 0, rutasPasadas: 0, minPasados: 0 };
  const restaurar = sinReserva;
  const nuevo = schedule.map(row => {
    const a0 = row.assignments || [];
    const cap = Number(row.capacidad) || capFlota;
    if (!c.usarCapacidad || !a0.length || !(cap > 0)) return { ...row, assignments: a0.map(restaurar) };
    const depot = row.depotLat && row.depotLng ? { lat: +row.depotLat, lng: +row.depotLng, nombre: "depósito" } : null;
    const destinos = plantas.filter(pl => hasCoords(pl.lat, pl.lng)).map(pl => ({ ...pl, lat: +pl.lat, lng: +pl.lng }));
    if (!destinos.length && depot) destinos.push(depot);
    const porDia = new Map();
    for (const a of a0) { const d = Math.floor(a._start / 1440); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); }
    const salida = [];
    let pasadoFila = 0;
    for (const [dia, lista0] of [...porDia.entries()].sort((x, y) => x[0] - y[0])) {
      const lista = [...lista0].sort((x, y) => x._start - y._start || (x._travel ? -1 : 0));
      const off = dia * 1440;
      const finPrevisto = lista[lista.length - 1]._end;
      const out = [];
      let cursor = lista[0]._start;
      let pos = lista[0]._depot_exit && depot ? depot : null;
      let carga = 0, pend = null;
      const poner = b => { out.push({ ...b, _start: cursor, _end: cursor + b.duracion }); cursor += b.duracion; };
      const viajeA = (hacia, extra = {}) => {
        if (!pos || !hasCoords(hacia.lat, hacia.lng)) return 0;
        const km = haversineKm(pos.lat, pos.lng, +hacia.lat, +hacia.lng), m = minutos(km);
        if (m > 0) poner({ _travel: true, duracion: m, km: +km.toFixed(3), ...extra });
        return km;
      };
      const descargar = () => {
        const p = pos && destinos.length ? plantaMasCercana(pos.lat, pos.lng, destinos) : null;
        if (p) { resumen.kmDescarga += viajeA(p.planta, { _a_planta: true }); pos = p.planta; }
        poner({ _wait: true, _descarga: true, duracion: c.tiempoDescarga, planta: p?.planta?.nombre || "planta", carga: Math.round(carga * 10) / 10 });
        carga = 0; resumen.descargas++;
      };
      for (const a of lista) {
        if (a._travel) {
          if (a._depot_return) {
            if (carga > 0) { descargar(); if (depot) { viajeA(depot, { _depot_return: true }); pos = depot; } }
            else { poner(a); if (depot) pos = depot; }
            pend = null;
          } else pend = a;
          continue;
        }
        if (a._wait) continue; // las esperas a la franja se vuelven a calcular
        if (a._break) { poner(a); continue; }
        const t = restaurar(a), q = cargaDe(t, c);
        if (carga > 0 && carga + q > cap) {
          descargar();
          viajeA(t, pend?._depot_exit ? { _depot_exit: true } : {});
        } else if (pend) poner(pend);
        pend = null;
        const espera = windowWait(t, cursor, off);
        if (espera > 0) poner({ _wait: true, duracion: espera });
        poner({ ...t, duracion: t.duracion || 15, _carga: Math.round((carga + q) * 10) / 10 });
        carga += q;
        if (hasCoords(t.lat, t.lng)) pos = { lat: +t.lat, lng: +t.lng };
      }
      if (carga > 0) descargar();
      const pasado = cursor - finPrevisto;
      if (pasado > 0) pasadoFila = Math.max(pasadoFila, pasado);
      salida.push(...out);
    }
    if (pasadoFila > 0) { resumen.rutasPasadas++; resumen.minPasados = Math.max(resumen.minPasados, pasadoFila); }
    const km = salida.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
    return { ...row, assignments: salida, totalKm: Math.round(km * 1000) / 1000, _pasadoDescargas: pasadoFila };
  });
  resumen.kmDescarga = Math.round(resumen.kmDescarga * 10) / 10;
  return { schedule: nuevo, resumen };
}
