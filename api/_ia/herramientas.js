// Conectar con IA (MCP) · lo que puede consultar (y, si la empresa lo deja,
// hacer) la IA del usuario. Cada herramienta lee con la sesión del usuario
// (firestore-usuario.js): lo mismo que vería él en Operanzia. Las cuentas son
// las de la app (entregas, pedidos, hora prevista), para que la IA diga lo
// mismo que se ve en pantalla.
import { estadoEntrega, hhmm, nombreMotivo, queSeEntrega } from "../../src/entregas/datos.js";
import { masDias, reprogramado, resultadosPorPedido } from "../../src/pedidos/datos.js";
import { ahoraEnEspana, minutosEnEspana } from "./entorno.js";
import { BUSCAR_DATOS, HERRAMIENTAS_MAS } from "./herramientas-mas.js";

// (igual que diaDelPlan de src/publicar-rutas.js, que no se puede importar aquí: carga Firebase de la app)
const diaDelPlan = d => d?.diaNum ?? (Number(String(d?.diaServicio || "").replace(/\D/g, "")) || null);
// un instante guardado como número (ms) o como fecha de Firestore (texto) → ms, o null
const enMs = x => (typeof x === "number" ? x : x ? Date.parse(x) || null : null);

const FECHA = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha AAAA-MM-DD. Si no se indica, hoy (hora de España)." };
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || "")) && !Number.isNaN(new Date(`${f}T12:00:00Z`).getTime());
const fechaDe = (args, ctx) => {
  if (args?.fecha == null || args.fecha === "") return ctx.hoy;
  if (!esFecha(args.fecha)) throw Object.assign(new Error(`Fecha no válida: «${args.fecha}». Usa AAAA-MM-DD.`), { delUsuario: true });
  return args.fecha;
};
const direccion = u => [u.calle, u.num].filter(Boolean).join(" ") || u.pa || "";
const horaReal = u => (enMs(u.realizadoEn) ? hhmm(minutosEnEspana(enMs(u.realizadoEn))) : null);

/** Las rutas publicadas de un día (las de reparto llevan su fecha; las del mes, su día) */
// Solo las de ese día (no todo el mes: con cientos de vehículos serían miles de rutas por pregunta)
export async function rutasDelDia(fs, org, fecha) {
  const dia = Number(fecha.slice(8, 10));
  const [porFecha, porDia] = await Promise.all([
    fs.consultar("planes", [["org_id", "==", org], ["fecha", "==", fecha]], 1000),
    fs.consultar("planes", [["org_id", "==", org], ["mes", "==", fecha.slice(0, 7)], ["diaNum", "==", dia]], 1000),
  ]);
  const planes = [...new Map([...porFecha, ...porDia].map(p => [p._id, p])).values()];
  return planes.filter(p => p.tipo !== "corr" && (p.fecha ? p.fecha === fecha : Number(diaDelPlan(p)) === dia))
    .sort((a, b) => String(a.vehiculoNombre || a.nombre).localeCompare(String(b.vehiculoNombre || b.nombre)));
}

/** Resumen de una ruta (para resumen_del_dia) */
export function resumenRuta(p, { esHoy, minutosAhora }) {
  const ubs = p.ubicaciones || [];
  const conEntrega = ubs.some(u => u.entrega);
  const c = { entregadas: 0, no_entregadas: 0, hechas: 0, pendientes: 0 };
  for (const u of ubs) {
    const e = estadoEntrega(u);
    if (u.realizado) c.hechas++; else c.pendientes++;
    if (e === "entregada" && conEntrega) c.entregadas++;
    if (e === "no_entregada") c.no_entregadas++;
  }
  const proxima = [...ubs].filter(u => !u.realizado).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))[0] || null;
  const previstaProx = Number.isFinite(proxima?.horaPlan) ? proxima.horaPlan : null;
  return {
    ruta: p.nombre || p.archivo || "Ruta", vehiculo: p.vehiculoNombre || null, conductor: p.conductorNombre || null,
    trabajo: p.trabajo || null, paradas: ubs.length, hechas: c.hechas, pendientes: c.pendientes,
    ...(conEntrega || c.no_entregadas ? { entregadas: c.entregadas, no_entregadas: c.no_entregadas } : {}),
    porcentaje: ubs.length ? Math.round((c.hechas / ubs.length) * 100) : 0,
    proxima_parada: proxima ? { orden: proxima.orden ?? null, direccion: direccion(proxima), hora_prevista: previstaProx != null ? hhmm(previstaProx) : null } : null,
    // retraso estimado: solo hoy, si la próxima parada ya debería estar hecha
    retraso_minutos: esHoy && previstaProx != null && minutosAhora > previstaProx ? minutosAhora - previstaProx : 0,
  };
}

/** Una parada como «entrega» para la IA */
export function filaEntrega(p, u) {
  const e = estadoEntrega(u);
  return {
    ruta: p.nombre || null, vehiculo: p.vehiculoNombre || null, orden: u.orden ?? null,
    cliente: u.cliente || u.contacto || u.pa || null, direccion: direccion(u) || null,
    pedido: u.pedido || null, que_se_entrega: queSeEntrega({ ...u, pedido: null }) || null,
    estado: e === "pendiente" ? "pendiente" : e === "no_entregada" ? "no entregada" : u.entrega ? "entregada" : "hecha",
    motivo: e === "no_entregada" ? nombreMotivo(u.entrega?.motivo) : null,
    recibe: u.entrega?.recibe || null, hora_prevista: Number.isFinite(u.horaPlan) ? hhmm(u.horaPlan) : null,
    hora_real: horaReal(u), nota: u.entrega?.nota || u.nota || null,
  };
}

const sinPermisoPedidos = "Tu usuario no puede ver los pedidos (solo la oficina).";

export const HERRAMIENTAS = [
  {
    name: "resumen_del_dia",
    title: "Cómo van las rutas de un día",
    description: "Resumen de las rutas publicadas de un día en Operanzia: por cada ruta, vehículo, conductor, paradas hechas y pendientes, entregadas y no entregadas, próxima parada con su hora prevista y retraso estimado (solo hoy). Úsala para «¿cómo van las rutas?», «¿qué camiones van con retraso?».",
    inputSchema: { type: "object", properties: { fecha: FECHA }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args, ctx);
      const rutas = (await rutasDelDia(ctx.fs, ctx.org, fecha)).map(p => resumenRuta(p, { esHoy: fecha === ctx.hoy, minutosAhora: ctx.minutosAhora }));
      const tot = rutas.reduce((s, r) => ({ paradas: s.paradas + r.paradas, hechas: s.hechas + r.hechas, no_entregadas: s.no_entregadas + (r.no_entregadas || 0) }), { paradas: 0, hechas: 0, no_entregadas: 0 });
      return { fecha, rutas: rutas.length, ...tot, con_retraso: rutas.filter(r => r.retraso_minutos > 15).length, detalle: rutas };
    },
  },
  {
    name: "entregas",
    title: "Entregas y paradas de un día",
    description: "Las paradas de las rutas de un día con su resultado: entregada (quién lo recibió y a qué hora), no entregada (con el motivo), hecha o pendiente, frente a su hora prevista. Filtra por estado. Úsala para «¿qué no se entregó ayer y por qué?», «¿quién recibió el pedido X?».",
    inputSchema: { type: "object", properties: { fecha: FECHA, estado: { type: "string", enum: ["todas", "no_entregadas", "entregadas", "pendientes"], description: "Cuáles: todas (por defecto), no_entregadas, entregadas o pendientes." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args, ctx);
      const filtro = args?.estado || "todas";
      const filas = [];
      for (const p of await rutasDelDia(ctx.fs, ctx.org, fecha)) {
        for (const u of p.ubicaciones || []) {
          const e = estadoEntrega(u);
          if (filtro === "no_entregadas" && e !== "no_entregada") continue;
          if (filtro === "entregadas" && !(e === "entregada" && u.realizado)) continue;
          if (filtro === "pendientes" && u.realizado) continue;
          filas.push(filaEntrega(p, u));
        }
      }
      return { fecha, estado: filtro, total: filas.length, ...(filas.length > 300 ? { aviso: "Solo se muestran las 300 primeras." } : {}), entregas: filas.slice(0, 300) };
    },
  },
  {
    name: "pedidos",
    oficina: true,
    title: "Pedidos de un día (reparto)",
    description: "La bandeja de pedidos de un día (proyectos de reparto): cliente, dirección, número de pedido, bultos, kilos, franja horaria, si está anulado, en qué ruta va y qué pasó con la entrega. Úsala para «¿cuántos pedidos tenemos mañana?», «¿qué pedidos de hoy faltan por entregar?».",
    inputSchema: { type: "object", properties: { fecha: FECHA }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const fecha = fechaDe(args, ctx);
      let pedidos;
      try { pedidos = await ctx.fs.consultar("pedidos", [["org_id", "==", ctx.org], ["fecha", "==", fecha]]); }
      catch (e) { if (e.sinPermiso) return { fecha, error: sinPermisoPedidos }; throw e; }
      const resultados = resultadosPorPedido(await rutasDelDia(ctx.fs, ctx.org, fecha));
      const filas = pedidos.map(p => {
        const r = resultados.get(p._id);
        const resultado = p.estado === "anulado" ? "anulado" : p.reprogramadoA ? `pasado al ${p.reprogramadoA}` : !r ? (p.ruta ? "en ruta" : "sin planificar")
          : r.estado === "entregada" ? "entregado" : r.estado === "no_entregada" ? `no entregado: ${nombreMotivo(r.ub.entrega?.motivo)}` : "en ruta";
        return { cliente: p.cliente?.nombre || null, direccion: p.cliente?.direccion || null, pedido: p.ref || null, bultos: p.bultos ?? null, kg: p.kg ?? null,
          franja: p.desde ? `${p.desde}${p.hasta && p.hasta !== p.desde ? `-${p.hasta}` : ""}` : null, notas: p.notas || null, origen: p.origen || null,
          ruta: r?.plan?.vehiculoNombre || p.ruta || null, resultado, recibe: r?.ub?.entrega?.recibe || null };
      });
      const vivos = filas.filter(f => f.resultado !== "anulado");
      return { fecha, pedidos: vivos.length, anulados: filas.length - vivos.length, bultos: vivos.reduce((s, f) => s + (f.bultos || 0), 0), kg: vivos.reduce((s, f) => s + (f.kg || 0), 0), detalle: filas };
    },
  },
  {
    name: "incidencias",
    title: "Incidencias",
    description: "Incidencias de la empresa (averías, problemas en ruta…): título, descripción, prioridad, estado y fecha. Por defecto, solo las abiertas.",
    inputSchema: { type: "object", properties: { estado: { type: "string", enum: ["abiertas", "todas"], description: "abiertas (por defecto) o todas." }, limite: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      const todas = await ctx.fs.consultar("incidencias", [["org_id", "==", ctx.org]], 500);
      const lista = todas.filter(i => args?.estado === "todas" || i.estado !== "cerrada")
        .sort((a, b) => (enMs(b.fecha) || 0) - (enMs(a.fecha) || 0))
        .slice(0, args?.limite || 50)
        .map(i => ({ titulo: i.titulo || null, descripcion: i.descripcion || null, prioridad: i.prioridad || null, estado: i.estado || null, vehiculo: i.vehiculo || null, fecha: enMs(i.fecha) ? ahoraEnEspana(new Date(enMs(i.fecha))).fecha : null, comentarios: (i.comentarios || []).length }));
      return { total: lista.length, incidencias: lista };
    },
  },
  {
    name: "vehiculos",
    oficina: true,
    title: "Flota de vehículos",
    description: "Los vehículos de la empresa con su ficha: nombre, matrícula, tipo, combustible, autonomía, carga máxima y fecha de la próxima ITV.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async ejecutar(args, ctx) {
      let vs;
      try { vs = await ctx.fs.consultar("scheduling_vehicles", [["org_id", "==", ctx.org]], 1000); }
      catch (e) { if (e.sinPermiso) return { error: "Tu usuario no puede ver la flota (solo la oficina)." }; throw e; }
      const lista = vs.filter(v => v.activo !== false).map(v => ({ nombre: v.nombre || null, matricula: v.matricula || null, tipo: v.tipo || null, combustible: v.combustible || null,
        autonomia_km: Number(v.autonomiaKm) || null, carga_maxima: Number(v.cargaMax) || null, proxima_itv: v.proximaITV || null, marca: v.marca || null, modelo: v.modelo || null }))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      return { total: lista.length, vehiculos: lista };
    },
  },
  {
    name: "pasar_no_entregados",
    oficina: true,
    title: "Pasar los no entregados a otro día",
    description: "Reparto: los pedidos no entregados de un día se vuelven a apuntar para otra fecha (iguales, marcados «del día X»); el original queda como «pasado al …». Solo los que aún no se han pasado. Cambia datos: confirma con el usuario la fecha de destino antes de usarla.",
    inputSchema: { type: "object", properties: { fecha_origen: { ...FECHA, description: "Día de los no entregados (AAAA-MM-DD)." }, fecha_destino: { ...FECHA, description: "Día al que se pasan (AAAA-MM-DD). Si no se indica, el siguiente." } }, required: ["fecha_origen"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    actuar: true,
    async ejecutar(args, ctx) {
      const origen = fechaDe({ fecha: args?.fecha_origen }, ctx);
      const destino = args?.fecha_destino ? fechaDe({ fecha: args.fecha_destino }, ctx) : masDias(origen, 1);
      if (destino <= origen) throw Object.assign(new Error("La fecha de destino tiene que ser posterior a la de origen."), { delUsuario: true });
      let pedidos;
      try { pedidos = await ctx.fs.consultar("pedidos", [["org_id", "==", ctx.org], ["fecha", "==", origen]]); }
      catch (e) { if (e.sinPermiso) return { error: sinPermisoPedidos }; throw e; }
      const resultados = resultadosPorPedido(await rutasDelDia(ctx.fs, ctx.org, origen));
      const aPasar = pedidos.filter(p => p.estado !== "anulado" && !p.reprogramadoA && resultados.get(p._id)?.estado === "no_entregada");
      const ahora = Date.now();
      for (const [i, p] of aPasar.entries()) {
        await ctx.fs.crear("pedidos", { ...reprogramado({ ...p, id: p._id }, destino), creadoPor: { uid: ctx.uid, nombre: `${ctx.nombre} (con IA)` }, creadoEn: ahora + i });
        await ctx.fs.actualizar(`pedidos/${p._id}`, { reprogramadoA: destino });
      }
      return { de: origen, a: destino, pasados: aPasar.length, pedidos: aPasar.map(p => ({ cliente: p.cliente?.nombre || null, pedido: p.ref || null })) };
    },
  },
];
// las de personal, ubicación, autobuses… (herramientas-mas.js), antes de la acción; y la búsqueda libre al final
HERRAMIENTAS.splice(HERRAMIENTAS.length - 1, 0, ...HERRAMIENTAS_MAS);
HERRAMIENTAS.push(BUSCAR_DATOS);

const OFICINA = ["admin", "intermedio", "superadmin"];
/** Por qué este usuario no puede usar esta herramienta (null si puede) */
function motivoHerramienta(h, { nivel, ubicacion, rol }) {
  if (h.actuar && nivel !== "actuar") return "Tu empresa solo permite consultar con la IA, no hacer cambios.";
  if (h.oficina && rol && !OFICINA.includes(rol)) return "Esta consulta es solo para la oficina (administradores y jefes de tráfico).";
  if (h.ubicacion && !ubicacion) return "Tu empresa no permite preguntar a la IA dónde está cada uno. Un administrador lo puede activar en Operanzia: menú de la foto › «Conectar con IA».";
  return null;
}
/** Las herramientas que puede usar este usuario: según lo que deja su empresa y su rol. Vale pasar solo el nivel. */
export const herramientasPara = permisos => {
  const p = typeof permisos === "string" ? { nivel: permisos } : permisos || {};
  return HERRAMIENTAS.filter(h => !motivoHerramienta(h, p));
};

/** Ejecuta una herramienta y la deja en el formato de MCP (texto + datos) */
export async function ejecutarHerramienta(nombre, args, ctx) {
  const h = HERRAMIENTAS.find(x => x.name === nombre);
  const motivo = h ? motivoHerramienta(h, { nivel: ctx.nivel, ubicacion: ctx.ubicacion, rol: ctx.perfil?.rol }) : `No existe la herramienta «${nombre}».`;
  if (motivo) return { isError: true, content: [{ type: "text", text: motivo }] };
  try {
    const { fecha: hoy, minutos } = ahoraEnEspana(ctx.ahora);
    const datos = await h.ejecutar(args || {}, { f: fetch, ...ctx, hoy, minutosAhora: minutos });
    return { content: [{ type: "text", text: JSON.stringify(datos) }], structuredContent: datos, ...(datos?.error ? { isError: true } : {}) };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.delUsuario ? e.message : `No se pudo consultar Operanzia: ${e.message}` }] };
  }
}
