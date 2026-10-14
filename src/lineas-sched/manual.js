// Scheduling de líneas · cambios a mano: mover viajes y piezas entre autobuses y
// turnos, y volver a aplicarlos sobre un escenario recalculado.


import { PEGADAS_KM, hm, reloj, vacio } from "./base.js";
import { kpisServicio, perfilVehiculos } from "./kpis.js";
import { asignarTipos, cerrarTurno, dondeAcaba, relevoPermitido } from "./turnos.js";

// ── Cambios a mano ─────────────────────────────────────────────────────
// Mover una expedición de un autobús a otro (paso 1) o una pieza de un turno
// a otro (paso 2). Devuelven un escenario nuevo (no tocan el de entrada) o
// { error } si no se puede (se solapa). Lo que se puede hacer pero incumple
// algo (no llega a tiempo, amplitud…) se deja y queda como aviso.
// Las claves no dependen de la estrategia, así que los cambios se pueden
// guardar y volver a aplicar sobre el mismo escenario recalculado.
export const claveViaje = v => `${v.linea}|${v.dir}|${v.dep}`;

export const clavePieza = pz => `${pz.vehiculo}|${pz.inicio}`;

// Rehace un bloque con sus expediciones: vacíos entre cabeceras, salida y vuelta a cochera
export function montarBloque(veh, reales, r) {
  const { geo, cfg = {} } = r.ctx || {};
  const p = r.params, find = r.find || (x => x);
  const ord = [...reales].sort((a, b) => a.dep - b.dep);
  const viajes = [], avisos = [];
  ord.forEach((v, i) => {
    if (i > 0) {
      const a = ord[i - 1];
      const reg = cfg[a.linea]?.regulacion ?? p.regulacion;
      const km = find(a.d) === find(v.o) ? 0 : geo ? geo.km(a.d, v.o) : null;
      if (km == null) avisos.push(`De la ${a.nombre} a la ${v.nombre}: cabeceras distintas sin coordenadas para el vacío`);
      else if (km >= PEGADAS_KM) {
        const m = geo.min(km, a.d, v.o);
        viajes.push(vacio(a.d, v.o, Math.max(a.arr, Math.min(a.arr + reg, v.dep - m)), m, km, "cabecera", v.nombre));
        if (a.arr + reg + m > v.dep) avisos.push(`No llega a tiempo a la ${v.nombre} de las ${reloj(v.dep)}: vacío de ${String(km).replace(".", ",")} km (${m} min) y ${reg} min de regulación`);
      } else if (a.arr + reg > v.dep) avisos.push(`Solo ${v.dep - a.arr} min de regulación antes de la ${v.nombre} de las ${reloj(v.dep)} (mín. ${reg})`);
    }
    viajes.push(v);
  });
  veh.cochera = null;
  if (geo?.hayCocheras && ord.length) {
    const primero = ord[0], ultimo = ord.at(-1);
    veh.cochera = geo.cocheraDe(primero.linea, primero.o);
    const ida = geo.km(veh.cochera, primero.o), vuelta = geo.km(ultimo.d, veh.cochera);
    if (ida != null && ida >= PEGADAS_KM) { const m = geo.min(ida, veh.cochera, primero.o); viajes.unshift(vacio(veh.cochera, primero.o, primero.dep - m, m, ida, "salida", primero.nombre)); }
    if (vuelta != null && vuelta >= PEGADAS_KM) viajes.push(vacio(ultimo.d, veh.cochera, ultimo.arr, geo.min(vuelta, ultimo.d, veh.cochera), vuelta, "vuelta"));
  }
  veh.viajes = viajes;
  veh.inicio = viajes[0].dep;
  veh.fin = viajes.at(-1).arr;
  veh.lineas = [...new Set(ord.map(x => x.nombre))];
  veh.kmVacio = Math.round(viajes.reduce((t, x) => t + (x.vacio ? x.km : 0), 0) * 10) / 10;
  if (p.amplitudBusMax > 0 && veh.fin - veh.inicio > p.amplitudBusMax) avisos.push(`Amplitud del autobús de ${hm(veh.fin - veh.inicio)}: supera ${hm(p.amplitudBusMax)}`);
  veh.avisos = avisos;
  veh.manual = true;
  return veh;
}

export function moverViaje(res, clave, busDestino) {
  const origen = res.vehiculos.find(b => b.viajes.some(v => !v.vacio && claveViaje(v) === clave));
  if (!origen) return { error: "No se encuentra esa expedición" };
  const viaje = origen.viajes.find(v => !v.vacio && claveViaje(v) === clave);
  if (busDestino != null && origen.autobus === busDestino) return { error: "Ya está en ese autobús" };
  let vehiculos = [...res.vehiculos];
  let autobuses = res.autobuses.map(b => ({ ...b, bloques: [...b.bloques] }));
  const bloque = id => vehiculos.find(v => v.id === id);
  let destino = null, bus = null;
  if (busDestino != null) {
    bus = autobuses.find(b => b.id === busDestino);
    if (!bus) return { error: `No existe el autobús ${busDestino}` };
    for (const b of bus.bloques.map(bloque)) for (const x of b.viajes) {
      if (!x.vacio && x.dep < viaje.arr && viaje.dep < x.arr) return { error: `Se solapa con la ${x.nombre} de las ${reloj(x.dep)}–${reloj(x.arr)} del autobús ${busDestino}` };
    }
    // el bloque de ese autobús en el que cae (o el más cercano a menos de 1 h)
    let mejor = Infinity;
    for (const b of bus.bloques.map(bloque)) {
      const d = viaje.dep < b.inicio ? b.inicio - viaje.arr : viaje.dep > b.fin ? viaje.dep - b.fin : 0;
      if (d <= 60 && d < mejor) { mejor = d; destino = b; }
    }
  }
  // quitarla de su bloque
  const resto = origen.viajes.filter(v => !v.vacio && v !== viaje);
  if (resto.length) vehiculos = vehiculos.map(v => (v === origen ? montarBloque({ ...origen }, resto, res) : v));
  else {
    vehiculos = vehiculos.filter(v => v !== origen);
    autobuses = autobuses.map(b => ({ ...b, bloques: b.bloques.filter(id => id !== origen.id) })).filter(b => b.bloques.length);
    if (bus) bus = autobuses.find(b => b.id === bus.id) || null;
  }
  // ponerla en el destino
  if (destino) {
    const d = vehiculos.find(v => v.id === destino.id);
    vehiculos = vehiculos.map(v => (v === d ? montarBloque({ ...d }, [...d.viajes.filter(x => !x.vacio), viaje], res) : v));
  } else {
    const id = Math.max(0, ...res.vehiculos.map(v => v.id)) + 1;
    if (!bus) {
      bus = { id: Math.max(0, ...res.autobuses.map(b => b.id)) + 1, tipo: origen.tipo, bloques: [], cochera: null };
      autobuses.push(bus);
    }
    bus.bloques.push(id);
    vehiculos.push(montarBloque({ id, tipo: origen.tipo, autobus: bus.id, relevos: [] }, [viaje], res));
  }
  // bloques del mismo autobús que se pisan (falta tiempo en cochera)
  for (const b of autobuses) {
    b.bloques.sort((x, y) => bloque(x).inicio - bloque(y).inicio);
    const lista = b.bloques.map(bloque);
    lista.slice(1).forEach((x, i) => {
      const margen = x.cochera ? res.params.margenCochera : res.params.margenVacio;
      if (lista[i].fin + margen > x.inicio) {
        const nuevo = { ...x, avisos: [...(x.avisos || []), `Empieza a las ${reloj(x.inicio)} y el bloque anterior de este autobús acaba a las ${reloj(lista[i].fin)}`] };
        vehiculos = vehiculos.map(v => (v === x ? nuevo : v));
      }
    });
    if (b.cochera == null) b.cochera = bloque(b.bloques[0])?.cochera ?? null;
    // varios bloques en el mismo autobús: de la primera salida a la última vuelta
    const ampMax = res.params.amplitudBusMax;
    if (ampMax > 0 && lista.length > 1 && lista.at(-1).fin - lista[0].inicio > ampMax) {
      const ultimo = lista.at(-1);
      const aviso = `El autobús ${b.id} está fuera ${hm(ultimo.fin - lista[0].inicio)}: supera la amplitud máxima de ${hm(ampMax)}`;
      vehiculos = vehiculos.map(v => (v.id === ultimo.id && !(v.avisos || []).includes(aviso) ? { ...v, avisos: [...(v.avisos || []), aviso] } : v));
    }
  }
  // los turnos eran de los vehículos de antes: hay que rehacerlos (paso 2)
  vehiculos = vehiculos.map(v => (v.relevos?.length ? { ...v, relevos: [] } : v));
  return { ...res, vehiculos, autobuses, turnos: null, kpis: kpisServicio(res.viajes, vehiculos, null, autobuses), perfil: perfilVehiculos(vehiculos) };
}

export function moverPieza(res, clave, turnoDestino) {
  if (!res.turnos) return { error: "Aún no hay turnos" };
  const origen = res.turnos.find(t => t.piezas.some(pz => clavePieza(pz) === clave));
  if (!origen) return { error: "No se encuentra esa pieza" };
  const pz = origen.piezas.find(x => clavePieza(x) === clave);
  if (turnoDestino === origen.id) return { error: "Ya está en ese turno" };
  const p = res.params;
  let destino = null;
  if (turnoDestino != null) {
    destino = res.turnos.find(t => t.id === turnoDestino);
    if (!destino) return { error: `No existe el turno T${turnoDestino}` };
    const choca = destino.piezas.find(x => x.inicio < pz.fin && pz.inicio < x.fin);
    if (choca) return { error: `Se solapa con la pieza de las ${reloj(choca.inicio)}–${reloj(choca.fin)} del turno T${turnoDestino}` };
  }
  const id = destino ? destino.id : Math.max(0, ...res.turnos.map(t => t.id)) + 1;
  const movida = { ...pz, turno: id };
  const orden = l => l.sort((a, b) => a.inicio - b.inicio);
  let turnos = [];
  for (const t of res.turnos) {
    if (t === origen) { const resto = t.piezas.filter(x => x !== pz); if (resto.length) turnos.push(cerrarTurno({ id: t.id, piezas: resto }, p)); }
    else if (t === destino) turnos.push(cerrarTurno({ id: t.id, piezas: orden([...t.piezas, movida]) }, p));
    else turnos.push({ ...t }); // copia: asignarTipos no toca el escenario anterior
  }
  if (!destino) turnos.push(cerrarTurno({ id, piezas: [movida] }, p));
  asignarTipos(turnos, p); // los máximos por tipo dependen de todos los turnos
  for (const t of turnos) t.manual = t.manual || t.id === id || t.id === origen.id;
  // relevos del autobús de la pieza
  const piezasBus = orden(turnos.flatMap(t => t.piezas.filter(x => x.vehiculo === pz.vehiculo)));
  const vehiculos = res.vehiculos.map(v => (v.id === pz.vehiculo ? { ...v, relevos: piezasBus.map(x => ({ inicio: x.inicio, fin: x.fin, turno: x.turno })) } : v));
  return { ...res, vehiculos, turnos, kpis: kpisServicio(res.viajes, vehiculos, turnos, res.autobuses) };
}

/** Vuelve a aplicar cambios guardados ([{ tipo: "viaje" | "pieza", clave, destino }]); los que ya no encajan se saltan */
/**
 * Varias expediciones a la vez al mismo autobús (o a uno nuevo, el mismo para
 * todas). Todo o nada: si alguna no cabe, no se mueve ninguna.
 */
export function moverViajes(res, claves, busDestino) {
  let r = res, destino = busDestino;
  const orden = [...claves].sort((a, b) => Number(a.split("|")[2]) - Number(b.split("|")[2]));
  for (const clave of orden) {
    const antes = new Set(r.autobuses.map(b => b.id));
    const x = moverViaje(r, clave, destino);
    if (x.error) {
      if (/Ya está en ese autobús/.test(x.error)) continue;
      return { error: x.error };
    }
    // la primera crea el autobús nuevo: las demás van a ese mismo
    if (destino == null) destino = x.autobuses.find(b => !antes.has(b.id))?.id ?? x.vehiculos.find(v => v.viajes.some(y => !y.vacio && claveViaje(y) === clave))?.autobus;
    r = x;
  }
  return r;
}

// Una pieza en tramos: cada viaje con los vacíos que lleva delante; los del
// final (vuelta a cochera) con el último. Igual que al cortar piezas.
function tramosDe(viajes) {
  const tramos = [];
  let sueltos = [];
  for (const v of viajes) { sueltos.push(v); if (!v.vacio) { tramos.push(sueltos); sueltos = []; } }
  if (sueltos.length) { if (tramos.length) tramos.at(-1).push(...sueltos); else tramos.push(sueltos); }
  return tramos;
}

/**
 * Varios viajes (de uno o varios turnos) a otro turno, o a uno nuevo. Las
 * piezas de origen se parten donde empiezan y acaban los viajes elegidos
 * (relevos nuevos); cada vacío va con su viaje.
 */
export function moverViajesTurno(res, claves, turnoDestino) {
  if (!res.turnos) return { error: "Aún no hay turnos" };
  const elegidos = new Set(claves);
  const p = res.params, find = res.find || (x => x);
  const esElegido = tramo => tramo.some(v => !v.vacio && elegidos.has(claveViaje(v)));
  const puedeRelevar = relevoPermitido(p, find);
  const afectadas = new Map(); // pieza → turno
  for (const t of res.turnos) for (const pz of t.piezas) if (pz.viajes.some(v => !v.vacio && elegidos.has(claveViaje(v)))) afectadas.set(pz, t);
  if (!afectadas.size) return { error: "No se encuentran esos viajes" };
  let destino = null;
  if (turnoDestino != null) {
    destino = res.turnos.find(t => t.id === turnoDestino);
    if (!destino) return { error: `No existe el turno T${turnoDestino}` };
    if ([...afectadas.values()].every(t => t === destino)) return { error: "Ya están en ese turno" };
  }
  const id = destino ? destino.id : Math.max(0, ...res.turnos.map(t => t.id)) + 1;
  const pieza = (vehiculo, viajes, turno) => ({
    vehiculo, turno, viajes, inicio: viajes[0].dep, fin: viajes.at(-1).arr,
    conduccion: viajes.reduce((s, v) => s + (v.arr - v.dep), 0), o: find(viajes[0].o), d: find(viajes.at(-1).d),
  });
  const quedan = new Map(), movidas = [];
  for (const [pz, t] of afectadas) {
    if (t === destino) continue; // los que ya están en el destino se quedan como están
    let grupo = [], marca = null;
    const cerrar = () => {
      if (!grupo.length) return;
      if (marca) movidas.push(pieza(pz.vehiculo, grupo, id));
      else { if (!quedan.has(t)) quedan.set(t, []); quedan.get(t).push(pieza(pz.vehiculo, grupo, t.id)); }
      grupo = [];
    };
    for (const tramo of tramosDe(pz.viajes)) {
      const e = esElegido(tramo);
      if (marca !== null && e !== marca) {
        if (!puedeRelevar(dondeAcaba(grupo))) return { error: "Para eso habría que relevar en una cabecera donde no se puede (Planning → Puntos de relevo)" };
        cerrar();
      }
      marca = e; grupo.push(...tramo);
    }
    cerrar();
  }
  if (!movidas.length) return { error: "Ya están en ese turno" };
  if (destino) {
    for (const m of movidas) {
      const choca = destino.piezas.find(x => x.inicio < m.fin && m.inicio < x.fin);
      if (choca) return { error: `Se solapa con la pieza de las ${reloj(choca.inicio)}–${reloj(choca.fin)} del turno T${turnoDestino}` };
    }
  }
  const orden = l => l.sort((a, b) => a.inicio - b.inicio);
  const turnos = [];
  for (const t of res.turnos) {
    const origen = [...afectadas.values()].includes(t) && t !== destino;
    if (!origen && t !== destino) { turnos.push({ ...t }); continue; }
    const piezas = [...t.piezas.filter(x => !afectadas.has(x) || t === destino), ...(quedan.get(t) || []), ...(t === destino ? movidas : [])];
    if (piezas.length) turnos.push({ ...cerrarTurno({ id: t.id, piezas: orden(piezas) }, p), manual: true });
  }
  if (!destino) turnos.push({ ...cerrarTurno({ id, piezas: orden([...movidas]) }, p), manual: true });
  for (const t of turnos) for (const x of t.piezas) x.turno = t.id;
  asignarTipos(turnos, p);
  // relevos de los autobuses tocados
  const buses = new Set(movidas.map(x => x.vehiculo));
  const vehiculos = res.vehiculos.map(v => (buses.has(v.id)
    ? { ...v, relevos: orden(turnos.flatMap(t => t.piezas.filter(x => x.vehiculo === v.id))).map(x => ({ inicio: x.inicio, fin: x.fin, turno: x.turno })) }
    : v));
  return { ...res, vehiculos, turnos, kpis: kpisServicio(res.viajes, vehiculos, turnos, res.autobuses) };
}

/** Cambios a mano: los de vehículos (paso 1) y los de turnos (paso 2) */
export const esCambioVehiculos = c => c.tipo === "viaje" || c.tipo === "viajes";

export const esCambioTurnos = c => c.tipo === "pieza" || c.tipo === "viajesTurno";

export function aplicarCambios(res, cambios = []) {
  let r = res;
  const fallidos = [];
  for (const c of cambios) {
    const x = c.tipo === "viaje" ? moverViaje(r, c.clave, c.destino)
      : c.tipo === "viajes" ? moverViajes(r, c.claves, c.destino)
        : c.tipo === "viajesTurno" ? moverViajesTurno(r, c.claves, c.destino)
          : moverPieza(r, c.clave, c.destino);
    if (x.error) fallidos.push({ ...c, error: x.error }); else r = x;
  }
  return { res: r, fallidos };
}
