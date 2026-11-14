// Rutas › Semana (viajes de varios días): de los pedidos y la flota de
// Operanzia a lo que pide el motor (viajes-largos.js), y de sus viajes a lo
// que se ve (días, horas) y a las rutas del móvil de cada conductor.
import { masDias } from "../pedidos/datos.js";

export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** El lunes de la semana de una fecha «AAAA-MM-DD» */
export function lunesDe(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  return masDias(fecha, -((f.getDay() + 6) % 7));
}
/** Las fechas de los días de trabajo de la semana */
export const diasDeSemana = (lunes, n = 5) => Array.from({ length: n }, (_, i) => masDias(lunes, i));

/** «09:30» → 570; "" → null */
const aMin = h => { const m = String(h || "").match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };

/** Los pedidos de la semana en el formato del motor (sin anulados ni pasados a otra fecha); `unidad`: "bultos" (palés, cajas…) o "kg" */
export function pedidosParaViajes(pedidos, unidad = "bultos") {
  return (pedidos || []).filter(p => p.estado !== "anulado" && !p.reprogramadoA).map(p => {
    const desde = aMin(p.desde), hasta = aMin(p.hasta);
    return {
      id: p.id || p._id, cliente: p.cliente?.nombre || p.ref || "Cliente", ref: p.ref || null,
      lat: +p.cliente?.lat, lng: +p.cliente?.lng,
      palets: +(unidad === "kg" ? p.kg : p.bultos) || 0,
      ...(desde != null ? { ventana: { desde, hasta: hasta != null && hasta > desde ? hasta : desde + 60 } } : {}),
    };
  });
}

/** Los camiones con capacidad (su «carga máxima» en la ficha del vehículo); los demás, aparte para avisar */
export function camionesDe(vehicles) {
  const activos = (vehicles || []).filter(v => v.activo !== false);
  return {
    camiones: activos.filter(v => +v.cargaMax > 0).map(v => ({ id: v._id || v.id, nombre: v.nombre || v.matricula || "Camión", palets: +v.cargaMax })),
    sinCapacidad: activos.filter(v => !(+v.cargaMax > 0)).map(v => v.nombre || v.matricula || "Camión"),
  };
}

/** Minuto de la semana → «lun 06:00» */
export function cuando(t) {
  const d = Math.floor(t / 1440), m = Math.round(t - d * 1440);
  return `${DIAS_CORTOS[d] || `día ${d + 1}`} ${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export const horas = min => `${Math.floor(min / 60)} h${Math.round(min % 60) ? ` ${String(Math.round(min % 60)).padStart(2, "0")}` : ""}`;

/** Dónde duerme: la parada más cercana (o «en ruta, cerca de …») */
export function lugarDe(b, viaje, base) {
  const cerca = [...viaje.paradas, { nombre: base?.nombre || "la base", lat: base?.lat, lng: base?.lng }]
    .map(s => ({ s, d: Math.hypot((s.lat - b.lat) * 111, (s.lng - b.lng) * 85) }))
    .sort((x, y) => x.d - y.d)[0];
  if (!cerca) return "en ruta";
  return cerca.d < 5 ? cerca.s.nombre : `en ruta, a ${Math.round(cerca.d)} km de ${cerca.s.nombre}`;
}

/** Lo que pasa en el viaje, en orden: salida, entregas, noches y vuelta (para leerlo como una agenda) */
export function agenda(viaje, base) {
  const out = [{ t: viaje.inicio, tipo: "salida", texto: `Sale de ${base?.nombre || "la base"}` }];
  for (const b of viaje.bloques) {
    if (b.tipo === "entrega") {
      const s = viaje.paradas.find(x => x.id === b.paradaId);
      out.push({ t: b.inicio, tipo: "entrega", texto: `${s?.puerto ? "Deja en " : "Entrega en "}${s?.nombre || "cliente"} · ${s?.palets ?? "?"} ${s?.palets === 1 ? "palé" : "palés"}` });
    }
    if (b.tipo === "descanso") out.push({ t: b.inicio, tipo: "noche", texto: `Noche: ${lugarDe(b, viaje, base)} (hasta ${cuando(b.fin)})` });
  }
  out.push({ t: viaje.fin, tipo: "vuelta", texto: `Vuelve a ${base?.nombre || "la base"}` });
  return out;
}

/**
 * Las rutas del móvil del conductor: una por cada día del viaje con entregas (las de un puerto, una
 * parada por pedido), con la hora prevista y una nota con dónde duerme esa noche.
 */
export function planesDeViaje(viaje, { lunes, orgId, projectId, sector, base, pedidosPorId = new Map() }) {
  const porDia = new Map();
  for (const b of viaje.bloques.filter(x => x.tipo === "entrega")) {
    const d = Math.floor(b.inicio / 1440);
    (porDia.get(d) || porDia.set(d, []).get(d)).push(b);
  }
  const noches = viaje.bloques.filter(x => x.tipo === "descanso");
  const totalDias = viaje.dias;
  return [...porDia.entries()].map(([d, entregas]) => {
    const fecha = masDias(lunes, d);
    const noche = noches.find(n => Math.floor(n.inicio / 1440) === d);
    let orden = 0;
    const ubicaciones = entregas.flatMap(b => {
      const s = viaje.paradas.find(x => x.id === b.paradaId);
      return (s?.pedidos || []).map(pid => {
        const p = pedidosPorId.get(pid);
        orden++;
        return {
          id: `${viaje.id}-${pid}`, orden, lat: s.lat, lng: s.lng, pa: s.nombre, cliente: p?.cliente?.nombre || s.nombre,
          pedidoId: pid, pedido: p?.ref || null, bultos: p?.bultos ?? (s.pedidos.length === 1 ? s.palets : null), kg: p?.kg ?? null,
          horaPlan: Math.round(b.inicio - d * 1440), realizado: false, elementos: [],
          comentari: s.puerto ? "Entrega en el puerto a la naviera" : (p?.notas || ""),
        };
      });
    });
    return {
      org_id: orgId, projectId, sector: sector || null, tipo: "ruta", origenViajes: true, viajeId: viaje.id,
      nombre: `${viaje.camion} · viaje ${viaje.id} · día ${d - Math.floor(viaje.inicio / 1440) + 1} de ${totalDias}`,
      vehiculoNombre: viaje.camion, conductorUid: null,
      fecha, mes: fecha.slice(0, 7), diaNum: Number(fecha.slice(8, 10)), diaServicio: `Día ${fecha.slice(8, 10)}`,
      nota: noche ? `Esta noche duermes: ${lugarDe(noche, viaje, base)}` : `Vuelves a ${base?.nombre || "la base"}`,
      ubicaciones, fechaSubida: Date.now(),
    };
  });
}
