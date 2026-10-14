// Crear un GTFS desde Operanzia: la red tal y como está (importada y retocada,
// o dibujada a mano), con sus calendarios, las salidas (también las cambiadas
// a mano en Planning) y las horas de paso por cada parada. Sin React ni Firebase.
import { zipSync, strToU8 } from "fflate";
import { salidasDe, pasosPorParada } from "./lineas-sched/base.js";

const TIPO_GTFS = { "Tranvía": 0, "Metro": 1, "Tren": 2, "Autobús": 3, "Barco": 4, "Trolebús": 11, "Cable / funicular": 6 };
// CSV: comillas cuando hace falta
const campo = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cabecera, filas) => [cabecera.join(","), ...filas.map(f => f.map(campo).join(","))].join("\r\n") + "\r\n";
const hora = m => { const x = Math.max(0, Math.round(m)); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}:00`; };
const id = s => String(s).replace(/[^\w.-]+/g, "_");
const ymd = f => f.replaceAll("-", "");

/**
 * @param red      la red de Planning (lineas, paradas, calendarios)
 * @param cfg      configuración de las líneas (salidas y tiempos cambiados a mano)
 * @param opciones { operador, url, zonaHoraria }
 * @returns { zip: Uint8Array, resumen: { lineas, paradas, calendarios, expediciones, pasos } }
 */
export function crearGtfs(red, cfg = {}, { operador = "Operanzia", url = "https://operanzia.com", zonaHoraria = "Europe/Madrid" } = {}) {
  const cals = (red.calendarios || []).filter(c => (c.fechas || []).length);
  if (!cals.length) throw new Error("La red no tiene calendarios con fechas: hacen falta para saber qué días funciona cada expedición.");
  const usadas = new Set();
  const routes = [], trips = [], stopTimes = [], shapes = [];
  let pasosN = 0;
  // Servicios (como en el GTFS de origen: un viaje se escribe una vez aunque
  // funcione en varios calendarios): sus días = los de los calendarios que lo tienen
  const diasServicio = new Map();
  for (const c of cals) for (const k of c.servicios || []) { if (!diasServicio.has(k)) diasServicio.set(k, new Set()); for (const f of c.fechas) diasServicio.get(k).add(f); }
  const usadosServ = new Set(), usadosCal = new Set();
  const viaje = (l, s, rid, shp, servicio, m, k) => {
    const tid = `${rid}_${s.dir}_${id(servicio)}_${k + 1}`;
    trips.push([rid, id(servicio), tid, s.cabecera || "", s.dir, shp]);
    const { pasos } = pasosPorParada(s, m, red, cfg[l.id]);
    s.paradas.forEach((pid, i) => { usadas.add(pid); stopTimes.push([tid, hora(pasos[i]), hora(pasos[i]), id(pid), i + 1]); pasosN++; });
  };
  for (const l of red.lineas || []) {
    const rid = id(l.id);
    routes.push([rid, "op", l.nombre, l.largo || l.sentidos.map(s => s.cabecera).filter(Boolean).join(" - "), TIPO_GTFS[l.tipo] ?? 3, (l.color || "").replace("#", ""), "FFFFFF"]);
    for (const s of l.sentidos) {
      const shp = s.trazado?.length >= 2 ? `${rid}_${s.dir}` : "";
      if (shp) s.trazado.forEach(([la, lo], k) => shapes.push([shp, la, lo, k + 1]));
      // con salidas cambiadas a mano en algún calendario: ese sentido, calendario a calendario
      const editado = cals.some(c => Array.isArray(cfg[l.id]?.salidas?.[`${s.dir}|${c.id}`]));
      if (!editado && s.porServicio?.length) {
        for (const [k, lista] of s.porServicio) {
          if (!diasServicio.has(k)) continue;
          usadosServ.add(k);
          lista.forEach((m, n) => viaje(l, s, rid, shp, `s${k}`, m, n));
        }
      } else {
        for (const c of cals) {
          const salidas = salidasDe(s, c.id, red, cfg[l.id]).lista;
          if (salidas.length) usadosCal.add(c);
          salidas.forEach((m, n) => viaje(l, s, rid, shp, c.id, m, n));
        }
      }
    }
  }
  const stops = (red.paradas || []).filter(p => usadas.has(p.id)).map(p => [id(p.id), p.codigo || "", p.nombre || p.id, p.lat, p.lng]);
  const calDates = [
    ...[...usadosServ].flatMap(k => [...diasServicio.get(k)].sort().map(f => [id(`s${k}`), ymd(f), 1])),
    ...[...usadosCal].flatMap(c => c.fechas.map(f => [id(c.id), ymd(f), 1])),
  ];
  const fechas = cals.flatMap(c => c.fechas).sort();
  const hoy = new Date().toISOString().slice(0, 10);
  const archivos = {
    "agency.txt": csv(["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"], [["op", operador, url, zonaHoraria, "es"]]),
    "stops.txt": csv(["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"], stops),
    "routes.txt": csv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"], routes),
    "trips.txt": csv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"], trips),
    "stop_times.txt": csv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stopTimes),
    "calendar_dates.txt": csv(["service_id", "date", "exception_type"], calDates),
    "feed_info.txt": csv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"], [[operador, url, "es", ymd(fechas[0]), ymd(fechas.at(-1)), ymd(hoy)]]),
    ...(shapes.length ? { "shapes.txt": csv(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"], shapes) } : {}),
  };
  const zip = zipSync(Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
  return { zip, resumen: { lineas: routes.length, paradas: stops.length, calendarios: cals.length, servicios: usadosServ.size + usadosCal.size, expediciones: trips.length, pasos: pasosN } };
}
