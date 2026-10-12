// Scheduling de líneas · paso 2: cortar los autobuses en piezas y juntarlas en
// turnos de conductor (tipos de turno, partición, validación).

import { particionTurnos } from "../lineas-particion.js";
import { hm, reloj } from "./base.js";
import { clavePieza } from "./manual.js";

// 2) Turnos de conductor
// Puntos de relevo (Planning): cabeceras donde NO se puede cambiar de
// conductor (cfg._relevos.no, ids de parada). Sin ninguna, se puede en todas.
export const relevoPermitido = (p, find) => {
  const no = new Set((p.noRelevo || []).map(x => (find ? find(x) : x)));
  return loc => !no.size || !no.has(find ? find(loc) : loc);
};

// La cabecera donde acaba un trozo de autobús (la llegada de su último viaje con viajeros)
export const dondeAcaba = viajes => { for (let i = viajes.length - 1; i >= 0; i--) if (!viajes[i].vacio) return viajes[i].d; return viajes.at(-1)?.d; };

function cortarPiezas(vehiculos, p, find) {
  const piezas = [];
  const puedeRelevar = relevoPermitido(p, find);
  for (const veh of vehiculos) {
    let lim = p.piezaMax;
    if (p.corte === "equilibrado") {
      // piezas de largo parecido (las muy cortas se aprovechan peor)
      const n = Math.ceil((veh.fin - veh.inicio) / p.piezaMax);
      lim = Math.min(p.piezaMax, Math.ceil((veh.fin - veh.inicio) / n) + 20);
    } else if (typeof p.corte === "number") lim = Math.min(p.piezaMax, p.corte);
    const minima = Math.min(p.piezaMin ?? 0, lim);
    // Se corta solo entre viajes con viajeros: cada viaje va con los vacíos que
    // lleva delante (salida de cochera, paso a otra cabecera) y la vuelta a
    // cochera va con el último. Así ninguna pieza es solo un vacío.
    const tramos = [];
    let sueltos = [];
    for (const v of veh.viajes) { sueltos.push(v); if (!v.vacio) { tramos.push(sueltos); sueltos = []; } }
    if (sueltos.length) { if (tramos.length) tramos.at(-1).push(...sueltos); else tramos.push(sueltos); }
    const conduccion = ts => ts.reduce((s, t) => s + t.reduce((a, v) => a + v.arr - v.dep, 0), 0);
    const largo = ts => ts.at(-1).at(-1).arr - ts[0][0].dep;
    const grupos = [];
    let actual = [], corteAtras = -1; // último sitio de la pieza en curso donde sí se puede relevar
    for (const tramo of tramos) {
      if (actual.length) {
        const con = [...actual, tramo];
        // obligatorio: conducción continua o pieza máxima; por estrategia, solo si la pieza ya tiene el mínimo
        const obligado = (p.aplicar561 && conduccion(con) > p.conduccionContinuaMax) || largo(con) > p.piezaMax;
        const quiere = largo(con) > lim && largo(actual) >= minima;
        const aqui = puedeRelevar(dondeAcaba(actual.flat()));
        if ((obligado || quiere) && aqui) { grupos.push(actual); actual = []; corteAtras = -1; }
        else if (obligado && corteAtras > 0) {
          // aquí no se puede relevar: se corta en el último punto de relevo de la pieza
          grupos.push(actual.slice(0, corteAtras)); actual = actual.slice(corteAtras); corteAtras = -1;
        } else if (aqui) corteAtras = actual.length;
      }
      actual.push(tramo);
    }
    if (actual.length) {
      // el final del autobús, si es más corto que el mínimo, se queda con la pieza anterior si cabe
      const ant = grupos.at(-1);
      if (ant && largo(actual) < minima && largo([...ant, ...actual]) <= p.piezaMax && (!p.aplicar561 || conduccion([...ant, ...actual]) <= p.conduccionContinuaMax)) ant.push(...actual);
      else grupos.push(actual);
    }
    let previa = null;
    for (const g of grupos) {
      const viajes = g.flat();
      const pz = {
        vehiculo: veh.id, inicio: viajes[0].dep, fin: viajes.at(-1).arr, conduccion: viajes.reduce((a, v) => a + v.arr - v.dep, 0), viajes, previa,
        o: find ? find(viajes[0].o) : viajes[0].o, d: find ? find(viajes.at(-1).d) : viajes.at(-1).d,
      };
      piezas.push(pz); previa = pz;
    }
  }
  return piezas;
}

// ── Tipos de turno ──
const enFranja = (min, desde, hasta) => { const m = ((min % 1440) + 1440) % 1440; return desde <= hasta ? m >= desde && m <= hasta : m >= desde || m <= hasta; };

/** ¿Cabe el turno (inicio, fin, trabajo, partidos) en el tipo? final: además llega al trabajo mínimo */
export function encajaTipo(t, tipo, final = false) {
  if (!enFranja(t.inicio, tipo.desde, tipo.hasta)) return false;
  if (t.fin - t.inicio > tipo.amplitudMax || t.trabajo > tipo.trabajoMax) return false;
  if (t.partidos > (tipo.partido ? 1 : 0)) return false;
  if (t.partidos && tipo.splitMax > 0 && (t.split || 0) > tipo.splitMax) return false; // hueco del partido demasiado largo
  if (final && tipo.partido && !t.partidos) return false; // un partido tiene que tener su hueco (sin él, es otro tipo)
  return !final || t.trabajo >= tipo.trabajoMin;
}

const tiposActivos = p => (p.tiposTurno || []).filter(x => x.activo !== false);

/** El tipo de un turno ya cerrado (el primero que encaja), o null */
export const tipoDeTurno = (t, p) => tiposActivos(p).find(x => encajaTipo(t, x, true)) || null;

// Con tipos de turno, los límites generales pasan a ser los más amplios de los
// tipos (para no descartar nada que algún tipo admita) y cada estado se
// comprueba contra los tipos.
const efectivosCache = new WeakMap();

function efectivos(p) {
  if (p._tipos) return p;
  if (efectivosCache.has(p)) return efectivosCache.get(p);
  const tipos = tiposActivos(p);
  const e = tipos.length ? {
    ...p, _tipos: tipos,
    amplitudMax: Math.max(...tipos.map(x => x.amplitudMax)),
    jornadaMax: Math.max(...tipos.map(x => x.trabajoMax)),
    maxPartidos: tipos.some(x => x.partido) ? 1 : 0,
  } : p;
  efectivosCache.set(p, e);
  return e;
}

// Estado de un turno al añadirle una pieza (null si no cabe)
function anadir(t, pz, p) {
  let hueco = 0, partido = false;
  if (t) {
    const ultima = t.piezas[t.piezas.length - 1];
    hueco = pz.inicio - t.fin;
    const sigue = pz.previa === ultima; // sigue en el mismo autobús: no hay relevo
    if (hueco < (sigue ? 0 : t.d === pz.o ? p.relevoMin : p.desplazamiento)) return null;
    if (t.piezas.length >= p.maxPiezas) return null;
    partido = hueco >= p.huecoNoPagado;
    if (partido && t.partidos >= p.maxPartidos) return null;
  }
  const inicio = t ? t.inicio : pz.inicio;
  if (pz.fin - inicio > p.amplitudMax) return null;
  const trabajo = (t ? t.trabajo : 0) + (partido ? 0 : hueco) + (pz.fin - pz.inicio);
  if (trabajo > p.jornadaMax) return null;
  const conduccion = (t ? t.conduccion : 0) + pz.conduccion;
  if (p.aplicar561 && conduccion > p.conduccionDiariaMax) return null;
  // conducción continua: se acumula hasta juntar la pausa (puede partirse en 15 + 30)
  let seguido = t ? t.seguido : 0, pausaAcum = t ? t.pausaAcum : 0, hay15 = t ? t.hay15 : false, finPrev = t ? t.fin : null;
  for (const v of pz.viajes) {
    if (finPrev != null) {
      const h = v.dep - finPrev;
      if (h >= 15) pausaAcum += h; // la pausa de conducción se puede partir 15 + 30
      if (h >= (p.pausaJornadaMin || 15)) hay15 = true; // descanso de jornada (Estatuto / convenio)
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    if (p.aplicar561 && seguido > p.conduccionContinuaMax) return null;
    finPrev = v.arr;
  }
  if (p.jornadaSinPausaMax > 0 && pz.fin - inicio > p.jornadaSinPausaMax && !hay15) return null; // descanso si la jornada pasa de X (sin valor: no se exige)
  const estado = { inicio, fin: pz.fin, d: pz.d, trabajo, conduccion, seguido, pausaAcum, hay15, partidos: (t ? t.partidos : 0) + (partido ? 1 : 0), split: Math.max(t ? t.split || 0 : 0, partido ? hueco : 0) };
  if (p._tipos && !p._tipos.some(x => encajaTipo(estado, x))) return null; // ningún tipo de turno lo admite
  return estado;
}

/**
 * Pone el tipo a cada turno respetando el máximo de cada tipo: primero los
 * turnos que encajan en menos tipos (los que menos alternativas tienen), cada
 * uno en el primer tipo de la lista en el que encaja y aún queda sitio. El que
 * no encaja en ninguno, o solo en tipos ya llenos, queda sin tipo y con aviso.
 */
export function asignarTipos(turnos, pOriginal) {
  const p = efectivos(pOriginal);
  if (!p._tipos) return turnos;
  const usados = new Map();
  const encajan = new Map(turnos.map(t => [t, p._tipos.filter(x => encajaTipo(t, x, true))]));
  const orden = [...turnos].sort((a, b) => encajan.get(a).length - encajan.get(b).length || a.inicio - b.inicio);
  for (const t of orden) {
    t.avisos = (t.avisos || []).filter(a => !/^No encaja en ningún tipo|^Ya hay el máximo de turnos/.test(a));
    const posibles = encajan.get(t);
    const tipo = posibles.find(x => !(x.maximo > 0) || (usados.get(x.id) || 0) < x.maximo);
    t.tipo = tipo?.id || null; t.tipoNombre = tipo?.nombre || null;
    if (tipo) usados.set(tipo.id, (usados.get(tipo.id) || 0) + 1);
    else if (posibles.length) t.avisos.push(`Ya hay el máximo de turnos de tipo ${posibles.map(x => `${x.nombre} (${x.maximo})`).join(" / ")}`);
    else t.avisos.push(`No encaja en ningún tipo de turno: ${hm(t.trabajo)} de trabajo, de ${reloj(t.inicio)} a ${reloj(t.fin)}${t.partidos ? `, partido con ${hm(t.split || 0)} de hueco` : ""}`);
  }
  return turnos;
}

// Coste de un turno para la partición: un conductor pesa mucho (o poco si el
// objetivo son las horas), más las horas pagadas; un turno que no encaja en
// ningún tipo, muchísimo (solo se usa si no hay otra forma de cubrir la pieza).
function costeTurno(e, piezas, p) {
  const porConductor = p.objetivoTurnos === "horas" ? 60 : 600;
  let c = porConductor + e.trabajo + piezas.length * 5;
  if (e.sinValidar) c += 5000;
  else if (p._tipos && !tipoDeTurno(e, p)) c += 900;
  return c;
}

function estadoSuelto(pz) {
  return { piezas: [pz], inicio: pz.inicio, fin: pz.fin, d: pz.d, trabajo: pz.fin - pz.inicio, conduccion: pz.conduccion, seguido: 0, pausaAcum: 0, hay15: true, partidos: 0 };
}

function turnosPorParticion(piezas, p) {
  const topes = p._tipos ? p._tipos.map(x => (x.maximo > 0 ? x.maximo : Infinity)) : [];
  const conTope = topes.some(Number.isFinite);
  const partidos = (p._tipos || []).filter(x => x.partido);
  const splitMax = partidos.length && partidos.every(x => x.splitMax > 0) ? Math.max(...partidos.map(x => x.splitMax)) : Infinity;
  const grupos = particionTurnos(piezas, {
    valida: l => validar(l, p), coste: (e, l) => costeTurno(e, l, p),
    ...(conTope ? { topes, tipoDe: e => p._tipos.findIndex(x => encajaTipo(e, x, true)) } : {}),
    huecoMax: splitMax,
    extiende: (e, pz) => { const x = anadir(e, pz, p); return x && { ...x, piezas: [...e.piezas, pz] }; },
    desplazamiento: p.desplazamiento, amplitudMax: p.amplitudMax, huecoNoPagado: p.huecoNoPagado, jornadaMax: p.jornadaMax,
    maxPiezas: Math.min(4, p.maxPiezas),
  });
  return grupos.map(g => { const l = g.map(i => piezas[i]); return validar(l, p) || estadoSuelto(l[0]); });
}

// La partición calculada en otro sitio (el worker) llega como grupos de
// claves de pieza; aquí se montan los turnos con las piezas de este cálculo.
function turnosDeGrupos(piezas, grupos, p) {
  const porClave = new Map(piezas.map(pz => [clavePieza(pz), pz]));
  const puestas = new Set();
  const turnos = [];
  for (const g of grupos) {
    const l = g.map(k => porClave.get(k)).filter(pz => pz && !puestas.has(pz));
    if (!l.length) continue;
    l.forEach(pz => puestas.add(pz));
    turnos.push(validar(l, p) || estadoSuelto(l[0]));
    if (!validar(l, p)) for (const pz of l.slice(1)) turnos.push(estadoSuelto(pz)); // no debería pasar
  }
  for (const pz of piezas) if (!puestas.has(pz)) turnos.push(validar([pz], p) || estadoSuelto(pz));
  return turnos;
}

/** Solo la partición (lo pesado), para hacerla en el worker: grupos de claves de pieza */
export function gruposTurnos(resVehiculos, opciones = {}) {
  const r = resVehiculos;
  const p = efectivos({ ...r.params, ...opciones });
  const piezas = cortarPiezas(r.vehiculos, p, r.find);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  return turnosPorParticion(piezas, p).map(t => t.piezas.map(clavePieza));
}

// Rehace un turno desde cero con sus piezas en orden (null si no vale)
export function validar(piezas, p) {
  const orden = [...piezas].sort((a, b) => a.inicio - b.inicio);
  let t = null;
  for (let i = 0; i < orden.length; i++) {
    const x = anadir(t, orden[i], p);
    if (!x) return null;
    t = { ...x, piezas: orden.slice(0, i + 1) };
  }
  return t;
}

export function programarTurnos(vehiculos, pOriginal, find, grupos = null) {
  const p = efectivos(pOriginal);
  const piezas = cortarPiezas(vehiculos, p, find);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  const turnos = p.metodo === "voraz" ? [] : grupos ? turnosDeGrupos(piezas, grupos, p) : turnosPorParticion(piezas, p);
  // Voraz: cada pieza va al conductor que mejor la aprovecha: el que sigue en
  // ese autobús, si no el que menos espera ("primera") o el que lleva más
  // horas ("llena"); si no cabe en ninguno, entra un conductor nuevo.
  let activos = [];
  const deLaPieza = new Map(); // pieza → turno (para seguir en el mismo autobús)
  for (let i = 0; i < (p.metodo === "voraz" ? piezas.length : 0); i++) {
    const pz = piezas[i];
    if (i % 200 === 0) activos = activos.filter(t => t.inicio + p.amplitudMax > pz.inicio);
    let mejor = null, nuevo = null, nota = -Infinity;
    const previo = pz.previa && deLaPieza.get(pz.previa);
    if (previo) { const x = anadir(previo, pz, p); if (x) { mejor = previo; nuevo = x; nota = Infinity; } }
    if (!mejor) {
      for (const t of activos) {
        if (t.fin > pz.inicio || t.inicio + p.amplitudMax < pz.fin) continue;
        const x = anadir(t, pz, p);
        if (!x) continue;
        const n = p.emparejar === "llena" ? x.trabajo * 1000 - (pz.inicio - t.fin) : -(pz.inicio - t.fin) * 1000 + x.trabajo;
        if (n > nota) { nota = n; mejor = t; nuevo = x; }
      }
    }
    if (mejor) { Object.assign(mejor, nuevo); mejor.piezas.push(pz); deLaPieza.set(pz, mejor); continue; }
    const t0 = anadir(null, pz, p);
    const t = t0 ? { ...t0, piezas: [pz] } : { piezas: [pz], inicio: pz.inicio, fin: pz.fin, d: pz.d, trabajo: pz.fin - pz.inicio, conduccion: pz.conduccion, seguido: 0, pausaAcum: 0, hay15: true, partidos: 0 };
    turnos.push(t); activos.push(t); deLaPieza.set(pz, t);
  }
  // Repaso: deshacer los turnos cortos metiendo sus piezas en otros
  const porInicio = () => [...turnos].sort((a, b) => a.inicio - b.inicio);
  let lista = porInicio();
  // cortos: los que no llegan a ningún tipo de turno, y los de poco trabajo
  const cortos = [...turnos].filter(t => t.trabajo < p.jornadaMax * 0.6 || (p._tipos && !tipoDeTurno(t, p))).sort((a, b) => a.trabajo - b.trabajo);
  const quitados = new Set();
  let intentos = 0;
  for (const c of cortos) {
    if (quitados.has(c) || intentos > 400000) continue;
    const cambios = []; // [turno, estado anterior]
    let ok = true;
    for (const pz of c.piezas) {
      let destino = null, estado = null;
      for (const t of lista) {
        // en las dos direcciones: también turnos que empiezan después (así salen los partidos de mañana + tarde)
        if (t.inicio - pz.inicio > p.amplitudMax) break;
        if (t === c || quitados.has(t) || t.fin + p.amplitudMax < pz.inicio || Math.max(t.fin, pz.fin) - Math.min(t.inicio, pz.inicio) > p.amplitudMax) continue;
        if (t.piezas.some(x => x.inicio < pz.fin && pz.inicio < x.fin)) continue;
        intentos++;
        const x = validar([...t.piezas, pz], p);
        // con tipos de turno, el turno que recibe la pieza tiene que seguir encajando en uno
        if (x && p._tipos && !tipoDeTurno(x, p)) continue;
        if (x && (!estado || x.trabajo > estado.trabajo)) { destino = t; estado = x; }
      }
      if (!destino) { ok = false; break; }
      cambios.push([destino, { ...destino }]);
      Object.assign(destino, estado);
    }
    if (ok) quitados.add(c);
    else for (const [t, antes] of cambios.reverse()) Object.assign(t, antes);
    if (ok) lista = lista.filter(t => t !== c);
  }
  const finales = asignarTipos(turnos.filter(t => !quitados.has(t)).map(t => cerrarTurno({ piezas: [...t.piezas].sort((a, b) => a.inicio - b.inicio) }, p)), p);
  finales.sort((x, y) => x.inicio - y.inicio);
  finales.forEach((t, i) => { t.id = i + 1; for (const pz of t.piezas) pz.turno = t.id; });
  for (const pz of piezas) { delete pz.previa; }
  return { turnos: finales, piezas };
}

export function cerrarTurno(t, pOriginal) {
  const p = efectivos(pOriginal);
  const viajes = t.piezas.flatMap(pz => pz.viajes);
  t.inicio = t.piezas[0].inicio;
  t.fin = t.piezas.at(-1).fin;
  t.duracion = t.fin - t.inicio; // amplitud
  t.trabajo = t.duracion - t.piezas.slice(1).reduce((s, pz, i) => { const h = pz.inicio - t.piezas[i].fin; return s + (h >= p.huecoNoPagado ? h : 0); }, 0);
  t.partidos = t.piezas.slice(1).filter((pz, i) => pz.inicio - t.piezas[i].fin >= p.huecoNoPagado).length;
  t.split = Math.max(0, ...t.piezas.slice(1).map((pz, i) => pz.inicio - t.piezas[i].fin).filter(h => h >= p.huecoNoPagado));
  t.conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  t.vehiculos = [...new Set(t.piezas.map(pz => pz.vehiculo))];
  // Conducción continua: se acumula hasta una pausa de pausaConduccionMin
  // (puede partirse en 15 + 30); la pausa entre piezas y las esperas largas cuentan
  let seguido = 0, peor = 0, pausaAcum = 0, hayPausa15 = false;
  viajes.forEach((v, i) => {
    if (i > 0) {
      const hueco = v.dep - viajes[i - 1].arr;
      if (hueco >= 15) pausaAcum += hueco;
      if (hueco >= (p.pausaJornadaMin || 15)) hayPausa15 = true;
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    peor = Math.max(peor, seguido);
  });
  t.avisos = [];
  if (p.aplicar561 && peor > p.conduccionContinuaMax) t.avisos.push(`${hm(peor)} de conducción sin la pausa de ${p.pausaConduccionMin} min (máx. ${hm(p.conduccionContinuaMax)}, UE 561/2006)`);
  if (p.aplicar561 && t.conduccion > p.conduccionDiariaMax) t.avisos.push(`Conducción de ${hm(t.conduccion)}: supera ${hm(p.conduccionDiariaMax)} (UE 561/2006)`);
  if (p.jornadaSinPausaMax > 0 && t.duracion > p.jornadaSinPausaMax && !hayPausa15) t.avisos.push(`Jornada de ${hm(t.duracion)} sin descanso de ${p.pausaJornadaMin} min (lo exige a partir de ${hm(p.jornadaSinPausaMax)})`);
  // lo que el cálculo automático ya cumple siempre, pero un cambio a mano puede romper
  if (p._tipos) {
    // el tipo: asignarTipos (con los máximos de cada tipo, que dependen de todos los turnos)
    const tipo = tipoDeTurno(t, p);
    t.tipo = tipo?.id || null; t.tipoNombre = tipo?.nombre || null;
  } else {
    if (t.duracion > p.amplitudMax) t.avisos.push(`Amplitud de ${hm(t.duracion)}: supera ${hm(p.amplitudMax)}`);
    if (t.trabajo > p.jornadaMax) t.avisos.push(`Jornada de trabajo de ${hm(t.trabajo)}: supera ${hm(p.jornadaMax)}`);
    if (t.partidos > p.maxPartidos) t.avisos.push(`${t.partidos} jornadas partidas: más de ${p.maxPartidos}`);
  }
  if (t.piezas.length > p.maxPiezas) t.avisos.push(`${t.piezas.length} piezas: más de ${p.maxPiezas}`);
  t.piezas.slice(1).forEach((pz, i) => {
    const a = t.piezas[i], hueco = pz.inicio - a.fin;
    if (hueco < 0) { t.avisos.push(`Las piezas de las ${reloj(a.inicio)} y las ${reloj(pz.inicio)} se solapan`); return; }
    const sigue = a.vehiculo === pz.vehiculo; // sigue en el mismo autobús: no hay relevo
    const hace = sigue ? 0 : a.d != null && a.d === pz.o ? p.relevoMin : p.desplazamiento;
    if (hueco < hace) t.avisos.push(`Solo ${hueco} min para ${a.d === pz.o ? "relevar" : "ir a otra cabecera"} a las ${reloj(pz.inicio)} (hacen falta ${hace})`);
  });
  return t;
}
