// Conectar con IA (MCP) · más consultas, para que la oficina pueda preguntar
// casi de todo: dónde está cada uno (si la empresa lo permite), quién trabaja,
// fichajes, vacaciones, plantilla, pesadas, autobuses, proyectos, concursos y
// una búsqueda libre. Todo con la sesión del usuario (las reglas mandan) y
// pensado para gastar pocas lecturas: siempre por empresa y día o mes.
import { posiciones } from "../_gps/proveedores.js";
import { hhmm } from "../../src/entregas/datos.js";
import { ahoraEnEspana } from "./entorno.js";

const FECHA = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha AAAA-MM-DD. Si no se indica, hoy (hora de España)." };
const MES = { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Mes AAAA-MM. Si no se indica, el actual." };
const errorUsuario = m => Object.assign(new Error(m), { delUsuario: true });
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ""));
const fechaDe = (f, ctx) => { if (f == null || f === "") return ctx.hoy; if (!esFecha(f)) throw errorUsuario(`Fecha no válida: «${f}». Usa AAAA-MM-DD.`); return f; };
const mesDe = (m, ctx) => { if (m == null || m === "") return ctx.hoy.slice(0, 7); if (!/^\d{4}-\d{2}$/.test(String(m))) throw errorUsuario(`Mes no válido: «${m}». Usa AAAA-MM.`); return m; };
const enMs = x => (typeof x === "number" ? x : x ? Date.parse(x) || null : null);
const fechaHora = ms => { if (!ms) return null; const a = ahoraEnEspana(new Date(ms)); return `${a.fecha} ${hhmm(a.minutos)}`; };
const diaAntes = f => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
/** sin tildes ni mayúsculas, para buscar por nombre */
export const normal = s => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const contiene = (textos, buscado) => !buscado || textos.some(t => normal(t).includes(normal(buscado)));
const nombreDe = x => [x?.nombre, x?.apellidos].filter(Boolean).join(" ");
const soloOficina = "Esta consulta es solo para la oficina (administradores y jefes de tráfico).";
const sinPermiso = (e, texto) => { if (e.sinPermiso) return { error: texto || soloOficina }; throw e; };

export const TURNOS = { M: "Mañana", T: "Tarde", N: "Noche", L: "Libre", V: "Vacaciones", G: "Guardia", B: "Baja", D: "Disponible" };

// ── Dónde está cada uno ─────────────────────────────────────────────────────
const RECIENTE_MIN = 30; // tras salir de servicio, la última posición se enseña aún este rato
// las apps mandan la posición cada 20-30 s: si llevan más de esto sin mandarla, se cerraron
// sin avisar (móvil apagado, app cerrada a la fuerza) y no cuentan como en servicio
const SIN_SENAL_MIN = 60;

/** La calle de una posición (CartoCiudad, gratis); null si no responde */
export async function calleDe(lat, lng, f = fetch) {
  try {
    const r = await f(`https://www.cartociudad.es/geocoder/api/geocoder/reverseGeocode?lon=${lng}&lat=${lat}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.address) return null;
    const via = [j.tip_via, j.address].filter(Boolean).join(" ").toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());
    return [via + (j.portalNumber ? ` ${j.portalNumber}` : ""), j.muni].filter(Boolean).join(", ");
  } catch { return null; }
}

/** Una posición en el formato de la IA: dónde, de cuándo y cuánto lleva parado; sin lugar si es vieja y fuera de servicio */
export function posicionParaIA(p, ahora) {
  const hace = p.hora ? Math.max(0, Math.round((ahora - p.hora) / 60000)) : null;
  const enServicio = p.activo !== false && (hace == null || hace <= SIN_SENAL_MIN);
  const visible = enServicio || (hace != null && hace <= RECIENTE_MIN);
  return {
    quien: p.nombre || null, origen: p.origen, vehiculo: p.vehiculo || null, ...(p.linea ? { linea: p.linea } : {}), ...(p.viaje ? { viaje: p.viaje } : {}),
    en_servicio: enServicio,
    posicion_hace_min: hace,
    ...(visible ? { lat: p.lat, lng: p.lng, mapa: `https://www.google.com/maps?q=${p.lat},${p.lng}` } : { aviso: "Fuera de servicio: no se muestra dónde está." }),
    ...(visible && p.paradoDesde ? { parado_min: Math.max(0, Math.round((ahora - p.paradoDesde) / 60000)) } : {}),
    ...(p.velocidad != null ? { velocidad_kmh: p.velocidad } : {}),
    ...(p.retraso != null ? { retraso_min: p.retraso } : {}),
    _planId: p.planId || null,
  };
}

async function todasLasPosiciones(ctx) {
  const avisos = [];
  const [rutas, buses, gps] = await Promise.all([
    ctx.fs.consultar("ubicaciones_activas", [["org_id", "==", ctx.org]], 1000).catch(() => { avisos.push("No se pudieron leer las posiciones de la app de rutas."); return []; }),
    ctx.fs.consultar("ubicaciones_lineas", [["org_id", "==", ctx.org]], 1000).catch(() => { avisos.push("No se pudieron leer las posiciones de los autobuses."); return []; }),
    ctx.fs.leer(`gps_conexiones/${ctx.org}`).then(async c => {
      if (!c?.activa || !c?.proveedor) return [];
      try { return await posiciones(c.proveedor, c.cred || {}, (u, o = {}) => ctx.f(u, { ...o, signal: AbortSignal.timeout(8000) })); }
      catch (e) { avisos.push(`El GPS de los vehículos no responde ahora (${e.message}).`); return []; }
    }).catch(() => []),
  ]);
  const lista = [
    ...rutas.map(u => ({ origen: "app de rutas", nombre: u.nombre, lat: u.lat, lng: u.lng, hora: enMs(u.updatedAt), paradoDesde: enMs(u.lastMovedAt), activo: u.activo, planId: u.planId })),
    ...buses.map(u => ({ origen: "app de autobús", nombre: u.nombre, vehiculo: u.bus ? `Bus ${u.bus}` : null, linea: u.linea, viaje: u.viaje, lat: u.lat, lng: u.lng, hora: enMs(u.updatedAt), activo: u.activo, retraso: u.retraso })),
    ...gps.map(v => ({ origen: "GPS del vehículo", nombre: null, vehiculo: [v.nombre, v.matricula].filter(Boolean).join(" · "), lat: v.lat, lng: v.lng, hora: enMs(v.hora) || ctx.ahora.getTime(), velocidad: v.velocidad ?? null, activo: true })),
  ].filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng));
  return { lista, avisos };
}

// ── Las herramientas ────────────────────────────────────────────────────────
export const HERRAMIENTAS_MAS = [
  {
    name: "donde_esta",
    title: "Dónde está cada conductor o vehículo",
    description: "Posición en vivo de los conductores (app de rutas y de autobús) y de los vehículos con GPS: calle, de hace cuántos minutos es, si está parado y cuánto tiempo, y cómo va su ruta. Busca por nombre de la persona, vehículo o matrícula; sin «quien», todos. Con «parados_mas_de» solo los que llevan parados al menos esos minutos. Fuera de servicio no se enseña dónde está. Di siempre de cuándo es la posición.",
    inputSchema: { type: "object", properties: { quien: { type: "string", description: "Nombre de la persona, del vehículo o matrícula (vale una parte)." }, parados_mas_de: { type: "integer", minimum: 1, description: "Solo los parados al menos estos minutos." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true, ubicacion: true,
    async ejecutar(args, ctx) {
      const ahora = ctx.ahora.getTime();
      const { lista, avisos } = await todasLasPosiciones(ctx);
      const planes = new Map();
      await Promise.all([...new Set(lista.map(p => p.planId).filter(Boolean))].slice(0, 30).map(async id => planes.set(id, await ctx.fs.leer(`planes/${id}`).catch(() => null))));
      for (const p of lista) { const pl = planes.get(p.planId); if (pl && !p.vehiculo) p.vehiculo = pl.vehiculoNombre || null; }
      let sel = lista.filter(p => contiene([p.nombre, p.vehiculo], args?.quien)).map(p => posicionParaIA(p, ahora));
      if (args?.parados_mas_de) sel = sel.filter(p => (p.parado_min ?? -1) >= args.parados_mas_de);
      sel.sort((a, b) => Number(b.en_servicio) - Number(a.en_servicio) || String(a.quien || a.vehiculo).localeCompare(String(b.quien || b.vehiculo)));
      sel = sel.slice(0, 60);
      // la calle y la ruta, para los primeros (sin gastar de más)
      await Promise.all(sel.slice(0, 6).map(async p => { if (p.lat != null) p.calle = await calleDe(p.lat, p.lng, ctx.f); }));
      for (const p of sel) {
        const pl = planes.get(p._planId);
        if (pl) {
          const ubs = pl.ubicaciones || [];
          const sig = ubs.filter(u => !u.realizado).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))[0];
          p.ruta = { nombre: pl.nombre || null, hechas: ubs.filter(u => u.realizado).length, paradas: ubs.length,
            siguiente: sig ? { orden: sig.orden ?? null, sitio: sig.cliente || sig.pa || null, hora_prevista: Number.isFinite(sig.horaPlan) ? hhmm(sig.horaPlan) : null } : null };
        }
        delete p._planId;
      }
      return {
        hora_consulta: fechaHora(ahora), encontrados: sel.length, ...(avisos.length ? { avisos } : {}),
        ...(!lista.length ? { nota: "Nadie está mandando su posición ahora (la app solo la manda en jornada, con la ruta o el turno abiertos)." } : {}),
        posiciones: sel,
      };
    },
  },
  {
    name: "personal_del_dia",
    title: "Quién trabaja un día",
    description: "El cuadrante publicado de un día: quién trabaja (turno, horario y vehículo), quién libra, está de vacaciones, de baja o de guardia, y quién ha fichado ya. Úsala para «¿quién trabaja mañana?», «¿quién está de vacaciones hoy?», «¿falta alguien por fichar?».",
    inputSchema: { type: "object", properties: { fecha: FECHA, quien: { type: "string", description: "Solo esta persona (vale una parte del nombre)." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args?.fecha, ctx);
      const d = String(Number(fecha.slice(8, 10)));
      let cuadrantes, fichajes;
      try {
        [cuadrantes, fichajes] = await Promise.all([
          ctx.fs.consultar("cuadrantes", [["org_id", "==", ctx.org], ["mes", "==", fecha.slice(0, 7)]], 2000),
          fichajesDelDia(ctx, fecha),
        ]);
      } catch (e) { return sinPermiso(e); }
      const fichado = new Map(fichajes.map(f => [f.uid, f]));
      const personas = cuadrantes.filter(c => contiene([c.nombre], args?.quien)).map(c => {
        const v = c.dias?.[d];
        const f = fichado.get(c.uid);
        return {
          nombre: c.nombre || null, turno: v ? TURNOS[v.c] || v.c : "Sin turno publicado",
          ...(v?.s != null ? { horario: `${hhmm(v.s)}-${hhmm(v.e)}` } : {}), ...(v?.v ? { vehiculo: v.v } : {}),
          fichaje: f ? (f.horaSalida ? `entrada ${fechaHora(f.horaEntrada).slice(11)}, salida ${fechaHora(f.horaSalida).slice(11)}` : `dentro desde ${fechaHora(f.horaEntrada).slice(11)}`) : "sin fichar",
          _c: v?.c || null,
        };
      }).sort((a, b) => a.nombre?.localeCompare(b.nombre || "") || 0);
      const cuenta = {};
      for (const p of personas) { const k = p.turno; cuenta[k] = (cuenta[k] || 0) + 1; }
      const trabajan = personas.filter(p => "MTNGD".includes(p._c || "x"));
      personas.forEach(p => delete p._c);
      return {
        fecha, personas: personas.length, por_turno: cuenta,
        trabajan_sin_fichar: trabajan.filter(p => p.fichaje === "sin fichar").map(p => p.nombre),
        ...(cuadrantes.length ? {} : { nota: "No hay cuadrantes publicados ese mes (se publican desde Rostering)." }),
        detalle: personas,
      };
    },
  },
  {
    name: "fichajes",
    title: "Fichajes de un día",
    description: "Entradas y salidas de un día: hora de entrada y salida, horas trabajadas, matrícula y kilómetros. Indica quién sigue dentro sin fichar la salida.",
    inputSchema: { type: "object", properties: { fecha: FECHA, quien: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args?.fecha, ctx);
      let l;
      try { l = await fichajesDelDia(ctx, fecha); } catch (e) { return sinPermiso(e); }
      const filas = l.filter(f => contiene([f.nombre, f.matricula], args?.quien)).map(f => ({
        nombre: f.nombre || null, entrada: fechaHora(f.horaEntrada)?.slice(11) || null, salida: f.horaSalida ? fechaHora(f.horaSalida).slice(11) : null,
        horas: f.horaSalida ? +((f.horaSalida - f.horaEntrada) / 3600000).toFixed(2) : null, dentro: !f.horaSalida,
        matricula: f.matricula || null, km: f.kmRecorridos ?? null,
      })).sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)));
      return { fecha, fichajes: filas.length, dentro_ahora: filas.filter(f => f.dentro).map(f => f.nombre), km_total: +filas.reduce((s, f) => s + (+f.km || 0), 0).toFixed(1), detalle: filas };
    },
  },
  {
    name: "ausencias",
    title: "Vacaciones y permisos",
    description: "Las solicitudes de vacaciones y permisos de la plantilla (desde la app): quién, tipo, desde, hasta, días y estado. Por defecto, las pendientes de contestar; también se puede pedir las de un periodo.",
    inputSchema: { type: "object", properties: { estado: { type: "string", enum: ["pendientes", "aprobadas", "rechazadas", "todas"] }, desde: FECHA, hasta: FECHA, quien: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      const estado = args?.estado || "pendientes";
      const filtro = { pendientes: "pendiente", aprobadas: "aprobada", rechazadas: "rechazada" }[estado];
      let l;
      try { l = await ctx.fs.consultar("solicitudes_ausencia", [["org_id", "==", ctx.org], ...(filtro ? [["estado", "==", filtro]] : [])], 1000); }
      catch (e) { return sinPermiso(e); }
      const desde = args?.desde ? fechaDe(args.desde, ctx) : null, hasta = args?.hasta ? fechaDe(args.hasta, ctx) : null;
      const filas = l.filter(s => contiene([s.nombre], args?.quien) && (!desde || String(s.hasta) >= desde) && (!hasta || String(s.desde) <= hasta))
        .sort((a, b) => String(a.desde).localeCompare(String(b.desde)))
        .map(s => ({ nombre: s.nombre || null, tipo: s.tipo || null, desde: s.desde || null, hasta: s.hasta || null, dias: s.dias ?? null, estado: s.estado || null, comentario: s.comentario || null, ...(s.motivo ? { motivo_respuesta: s.motivo } : {}) }));
      return { estado, total: filas.length, solicitudes: filas.slice(0, 200) };
    },
  },
  {
    name: "trabajadores",
    title: "Plantilla",
    description: "Las personas de la plantilla con su ficha de trabajo: nombre, categoría, teléfono, correo, permiso de conducir, turno habitual y fecha de alta (sin DNI ni domicilio). Busca por nombre.",
    inputSchema: { type: "object", properties: { buscar: { type: "string", description: "Parte del nombre." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      let l;
      try { l = await ctx.fs.consultar("scheduling_workers", [["org_id", "==", ctx.org]], 2000); } catch (e) { return sinPermiso(e); }
      const filas = l.filter(w => w.activo !== false && contiene([nombreDe(w)], args?.buscar)).map(w => ({
        nombre: nombreDe(w) || null, categoria: w.categoria || null, telefono: w.telefono || null, email: w.email || null,
        carnet: w.carnet || null, turno_habitual: w.turno || null, puesto: w.rol || null, alta: w.fechaAlta || null,
      })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      return { total: filas.length, trabajadores: filas.slice(0, 300) };
    },
  },
  {
    name: "pesadas",
    title: "Pesadas de báscula",
    description: "Los kilos pesados en báscula en un mes (o entre dos fechas): totales por vehículo, por planta y por fracción, y la lista de pesadas.",
    inputSchema: { type: "object", properties: { mes: MES, desde: FECHA, hasta: FECHA }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const mes = mesDe(args?.mes || (args?.desde ? String(args.desde).slice(0, 7) : null), ctx);
      const l = await ctx.fs.consultar("pesadas", [["org_id", "==", ctx.org], ["mes", "==", mes]], 3000);
      const sel = l.filter(p => (!args?.desde || p.fecha >= args.desde) && (!args?.hasta || p.fecha <= args.hasta));
      const suma = k => { const m = {}; for (const p of sel) { const c = p[k] || "(sin indicar)"; m[c] = +((m[c] || 0) + (+p.kg || 0)).toFixed(1); } return m; };
      return {
        mes, pesadas: sel.length, kg_total: +sel.reduce((s, p) => s + (+p.kg || 0), 0).toFixed(1),
        por_vehiculo: suma("vehiculo"), por_planta: suma("planta"), por_fraccion: suma("fraccion"),
        lista: sel.sort((a, b) => `${b.fecha}${b.hora}`.localeCompare(`${a.fecha}${a.hora}`)).slice(0, 100).map(p => ({ fecha: p.fecha, hora: p.hora || null, vehiculo: p.vehiculo || null, planta: p.planta || null, fraccion: p.fraccion || null, kg: p.kg ?? null, ticket: p.ticket || null })),
      };
    },
  },
  {
    name: "autobuses_del_dia",
    title: "Servicio de autobuses de un día",
    description: "Líneas regulares: los turnos publicados de un día con su horario, autobús y líneas, quién hace cada uno, cuáles están sin conductor y, hoy, los que van con retraso.",
    inputSchema: { type: "object", properties: { fecha: FECHA }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args?.fecha, ctx);
      const servicios = await ctx.fs.consultar("servicio_lineas", [["org_id", "==", ctx.org], ["fecha", "==", fecha]], 50, { campos: ["proyecto", "fecha", "nombreDia", "resumen"] });
      const vivos = fecha === ctx.hoy ? await ctx.fs.consultar("ubicaciones_lineas", [["org_id", "==", ctx.org]], 1000).catch(() => []) : [];
      const retrasoDe = new Map(vivos.filter(u => u.activo !== false && u.turnoId).map(u => [`${u.servicioId}|${u.turnoId}`, u]));
      const salida = [];
      for (const s of servicios) {
        const turnos = await ctx.fs.consultar("turnos", [["org_id", "==", ctx.org]], 2000, { padre: `servicio_lineas/${s._id}`, campos: ["num", "tipo", "inicio", "fin", "buses", "lineas", "conductorNombre", "inicioReal", "finReal"] });
        const filas = turnos.map(t => {
          const v = retrasoDe.get(`${s._id}|${t._id}`);
          return { turno: t.num ?? t._id, horario: t.inicio != null ? `${hhmm(t.inicio)}-${hhmm(t.fin)}` : null, autobuses: t.buses || null, lineas: t.lineas || null,
            conductor: t.conductorNombre || null, estado: t.finReal ? "terminado" : t.inicioReal ? "en marcha" : "sin empezar", ...(v ? { retraso_min: v.retraso ?? null, ahora: v.viaje || null } : {}) };
        }).sort((a, b) => String(a.horario).localeCompare(String(b.horario)));
        salida.push({ proyecto: s.proyecto || null, dia: s.nombreDia || null, turnos: filas.length, sin_conductor: filas.filter(f => !f.conductor).map(f => f.turno),
          con_retraso: filas.filter(f => (f.retraso_min || 0) >= 5).map(f => ({ turno: f.turno, conductor: f.conductor, retraso_min: f.retraso_min })), detalle: filas });
      }
      return { fecha, servicios: salida.length, ...(salida.length ? {} : { nota: "No hay servicio de autobuses publicado ese día." }), detalle: salida };
    },
  },
  {
    name: "proyectos",
    title: "Proyectos",
    description: "Los proyectos de la empresa (rutas, recogidas, reparto, líneas…): nombre, tipo, sector, mes y estado.",
    inputSchema: { type: "object", properties: { buscar: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      let l;
      try { l = await ctx.fs.consultar("scheduling_projects", [["org_id", "==", ctx.org]], 500, { campos: ["nombre", "descripcion", "tipo", "sector", "mes", "status"] }); } catch (e) { return sinPermiso(e); }
      const filas = l.filter(p => contiene([p.nombre, p.descripcion], args?.buscar)).map(p => ({ nombre: p.nombre || null, descripcion: p.descripcion || null, tipo: p.tipo || null, sector: p.sector || null, mes: p.mes || null, estado: p.status || null }));
      return { total: filas.length, proyectos: filas };
    },
  },
  {
    name: "concursos",
    title: "Concursos (licitaciones)",
    description: "Los concursos públicos que estudia la empresa: nombre, organismo, tipo, fecha límite, duración y estado.",
    inputSchema: { type: "object", properties: { buscar: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    oficina: true,
    async ejecutar(args, ctx) {
      let l;
      try { l = await ctx.fs.consultar("concursos", [["org_id", "==", ctx.org]], 500, { campos: ["nombre", "organismo", "tipo", "fechaLimite", "duracionAnios", "estado", "presupuesto"] }); } catch (e) { return sinPermiso(e); }
      const filas = l.filter(c => contiene([c.nombre, c.organismo], args?.buscar)).map(c => ({ nombre: c.nombre || null, organismo: c.organismo || null, tipo: c.tipo || null, fecha_limite: c.fechaLimite || null, duracion_anios: c.duracionAnios ?? null, estado: c.estado || null, ...(c.presupuesto != null ? { presupuesto: c.presupuesto } : {}) }))
        .sort((a, b) => String(a.fecha_limite || "9").localeCompare(String(b.fecha_limite || "9")));
      return { total: filas.length, concursos: filas };
    },
  },
];

// ── Búsqueda libre (para lo que no cubren las demás) ────────────────────────
const COLECCIONES = {
  incidencias: "título, descripción, prioridad (alta/media/baja), estado (abierta/en revisión/cerrada), vehiculo",
  pedidos: "fecha, ref (nº de pedido), cliente.nombre, bultos, kg, estado, ruta, reprogramadoA",
  pedidos_fijos: "cliente.nombre, dias (1=lunes…7=domingo), bultos, kg, activo",
  pesadas: "fecha, mes, vehiculo, planta, fraccion, kg, ticket",
  fichajes: "fecha, nombre, matricula, horaEntrada, horaSalida, kmRecorridos, estado (abierto/cerrado)",
  solicitudes_ausencia: "nombre, tipo, desde, hasta, dias, estado",
  scheduling_vehicles: "nombre, matricula, tipo, combustible, proximaITV, activo",
  scheduling_workers: "nombre, apellidos, categoria, telefono, turno",
  scheduling_projects: "nombre, tipo, sector, mes, status",
  concursos: "nombre, organismo, tipo, estado, fechaLimite",
  cuadrantes: "nombre, mes (AAAA-MM), dias {día: {c: turno, s, e: minutos, v: vehículo}}",
  planes: "nombre, vehiculoNombre, conductorNombre, mes, diaNum, fecha (las paradas se resumen)",
  documentos: "titulo, tipo, activo, paraTodos",
};
const PRIVADOS = new Set(["dni", "fechaNacimiento", "direccion", "nacionalidad", "edad", "cred", "data", "firma", "fotos"]);
/** Un documento sin lo pesado ni lo privado: listas largas → cuántas, textos largos → recortados */
export function aligerar(x, n = 0) {
  if (Array.isArray(x)) return x.length > 20 ? `(${x.length} elementos)` : x.map(v => aligerar(v, n + 1));
  if (x && typeof x === "object") {
    if (n > 3) return "(…)";
    return Object.fromEntries(Object.entries(x).filter(([k]) => !PRIVADOS.has(k) && k !== "org_id").map(([k, v]) => [k, aligerar(v, n + 1)]));
  }
  if (typeof x === "string" && x.length > 400) return `${x.slice(0, 400)}…`;
  return x;
}

export const BUSCAR_DATOS = {
  name: "buscar_datos",
  title: "Buscar en los datos de Operanzia",
  description: `Búsqueda libre, para preguntas que no cubren las otras herramientas: lee documentos de una colección de la empresa con filtros de igualdad (campo = valor). Colecciones y campos principales:\n${Object.entries(COLECCIONES).map(([c, d]) => `- ${c}: ${d}`).join("\n")}\nUsa antes las herramientas específicas si sirven.`,
  inputSchema: {
    type: "object",
    properties: {
      coleccion: { type: "string", enum: Object.keys(COLECCIONES) },
      filtros: { type: "array", maxItems: 4, items: { type: "object", properties: { campo: { type: "string" }, valor: { type: ["string", "number", "boolean"] } }, required: ["campo", "valor"], additionalProperties: false }, description: "Campo = valor (todos a la vez). Ej.: [{campo: \"estado\", valor: \"abierta\"}]" },
      limite: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["coleccion"], additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async ejecutar(args, ctx) {
    if (!COLECCIONES[args?.coleccion]) throw errorUsuario("Colección no disponible.");
    const filtros = (args.filtros || []).filter(f => f?.campo && f.campo !== "org_id" && !PRIVADOS.has(f.campo)).map(f => [f.campo, "==", f.valor]);
    let l;
    try { l = await ctx.fs.consultar(args.coleccion, [["org_id", "==", ctx.org], ...filtros], args.limite || 30); }
    catch (e) {
      if (e.sinPermiso) return { error: "Tu usuario no puede ver esos datos." };
      if (/index/i.test(e.message)) return { error: "Esa combinación de filtros no se puede buscar: prueba con menos filtros." };
      throw e;
    }
    // las rutas, sin la lista de paradas (pesada): cuántas hay y cuántas hechas
    const sinParadas = ({ ubicaciones = [], ...d }) => ({ ...d, paradas: ubicaciones.length, hechas: ubicaciones.filter(u => u.realizado).length });
    return { coleccion: args.coleccion, encontrados: l.length, documentos: l.map(d => aligerar(args.coleccion === "planes" ? sinParadas(d) : d)) };
  },
};

/** Los fichajes de un día en España (la app los guarda con la fecha UTC: se miran también los del día anterior) */
async function fichajesDelDia(ctx, fecha) {
  const l = await ctx.fs.consultar("fichajes", [["org_id", "==", ctx.org], ["fecha", "in", [diaAntes(fecha), fecha]]], 3000);
  return l.filter(f => f.horaEntrada && ahoraEnEspana(new Date(enMs(f.horaEntrada))).fecha === fecha);
}

