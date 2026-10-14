// Scheduling de líneas · paso 2: cortar los autobuses en piezas y juntarlas en
// turnos de conductor (tipos de turno, partición, validación).

import { particionTurnos } from "../lineas-particion.js";
import { hm, reloj, kmRecta, claveMezclaTurno } from "./base.js";
import { clavePieza } from "./manual.js";

// 2) Turnos de conductor
// Puntos de relevo (Planning): cabeceras donde NO se puede cambiar de
// conductor (cfg._relevos.no, ids de parada). Sin ninguna, se puede en todas.
export const relevoPermitido = (p, find) => {
  const no = new Set((p.noRelevo || []).map(x => (find ? find(x) : x)));
  return loc => !no.size || !no.has(find ? find(loc) : loc);
};

// De la pieza: si sale de cochera, si vuelve y dónde está la cochera de su autobús
const datosCochera = (veh, viajes, geo) => ({
  saleDeCochera: viajes[0]?.vacio && viajes[0].tipo === "salida",
  vuelveACochera: viajes.at(-1)?.vacio && viajes.at(-1).tipo === "vuelta",
  cochera: veh.cochera ?? null,
  cocheraLL: veh.cochera != null ? geo?.coord?.get(veh.cochera) || null : null,
});

// La cabecera donde acaba un trozo de autobús (la llegada de su último viaje con viajeros)
export const dondeAcaba = viajes => { for (let i = viajes.length - 1; i >= 0; i--) if (!viajes[i].vacio) return viajes[i].d; return viajes.at(-1)?.d; };

// ── Entre dos piezas seguidas de un turno ──
// Seguir en el mismo autobús: nada. Cambiar de autobús en la misma cabecera:
// el relevo. En otra cabecera: el conductor tiene que llegar hasta allí; se
// tarda lo que diga la distancia (a la velocidad de los vacíos, con el
// rodeo), y como poco el mínimo de las restricciones. Ese viaje es trabajo:
// no cuenta como pausa ni como hueco sin pagar.
export function entrePiezas(a, b, p) {
  // seguir en el mismo autobús: la pieza siguiente de ese autobús (mientras se
  // calcula, `previa`); ya cerrado, el mismo autobús y donde lo dejó
  const sigue = a.uFin != null && b.uIni != null ? a.vehiculo === b.vehiculo && a.uFin + 1 === b.uIni
    : b.previa !== undefined ? b.previa === a : a.vehiculo === b.vehiculo && a.d === b.o;
  // cambio de autobús = otro autobús físico (volver a coger el mismo tras pasar por cochera no lo es)
  const cambio = (a.autobus ?? a.vehiculo) !== (b.autobus ?? b.vehiculo);
  if (sigue) return { sigue, cambio: false, viaje: 0, hace: 0, km: 0 };
  if (a.d != null && a.d === b.o) return { sigue, cambio, viaje: 0, hace: p.relevoMin, km: 0 };
  let km = null, viaje = p.desplazamiento;
  const t = p._tramo?.(a.d, b.o);
  if (t) { km = t.km; viaje = Math.max(p.desplazamiento, t.min); }
  else if (a.dLL && b.oLL) {
    km = Math.round(kmRecta(a.dLL, b.oLL) * (p.factorRodeo || 1.35) * 10) / 10;
    viaje = Math.max(p.desplazamiento, Math.ceil((km / Math.max(1, p.velocidadVacio || 25)) * 60));
  }
  return { sigue, cambio, viaje, hace: viaje, km };
}
// ── Toma y deje de servicio ──
// Minutos de presentación al empezar y de liquidación al acabar (convenio) y,
// si el conductor se presenta en cochera y coge el autobús en una cabecera
// (relevo en la calle), el viaje de la cochera hasta allí (y al revés al
// acabar). Todo es trabajo pagado: cuenta para jornada, amplitud y tipo.
const kmEntre = (a, b, p) => (a && b ? Math.round(kmRecta(a, b) * (p.factorRodeo || 1.35) * 10) / 10 : 0);
const minViaje = (km, p) => (km > 0.3 ? Math.ceil((km / Math.max(1, p.velocidadVacio || 25)) * 60) : 0);
export function tomaYDeje(primera, ultima, p) {
  const enCochera = !!p.presentacionEnCochera;
  const tramo = (x, y, xLL, yLL) => { const t = p._tramo?.(x, y); return t ? t.min : minViaje(kmEntre(xLL, yLL, p), p); };
  const ida = enCochera && !primera.saleDeCochera && primera.cocheraLL ? tramo(primera.cochera, primera.o, primera.cocheraLL, primera.oLL) : 0;
  const vuelta = enCochera && !ultima.vuelveACochera && ultima.cocheraLL ? tramo(ultima.d, ultima.cochera, ultima.dLL, ultima.cocheraLL) : 0;
  return { antes: (p.tomaServicio || 0) + ida, despues: (p.dejeServicio || 0) + vuelta, ida, vuelta };
}

const conLimiteCambios = p => p.maxCambiosBus != null && p.maxCambiosBus !== "" && p.maxCambiosBus >= 0;
const conLimiteTotal = p => p.maxCambiosBusTotal != null && p.maxCambiosBusTotal !== "" && p.maxCambiosBusTotal >= 0;

// La línea de unos viajes (por nombre: las variantes de una línea cuentan como
// la misma); los vacíos no cuentan. null si no hay ninguno con viajeros.
const lineaDe = viajes => { for (const v of viajes) if (!v.vacio) return v.nombre ?? v.linea; return null; };
const lineasDe = viajes => [...new Set(viajes.filter(v => !v.vacio).map(v => v.nombre ?? v.linea))];

function cortarPiezas(vehiculos, p, find, geo = null) {
  const piezas = [];
  const puedeRelevar = relevoPermitido(p, find);
  const clave = claveMezclaTurno(p); // lo que no se mezcla en un turno (línea o grupo), o null
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
        // y, si los turnos no mezclan líneas, donde el autobús cambia de línea
        const cambiaLinea = !!clave && lineaDe(tramo) != null && lineaDe(actual.at(-1)) != null && clave(lineaDe(tramo)) !== clave(lineaDe(actual.at(-1)));
        const obligado = (p.aplicar561 && conduccion(con) > p.conduccionContinuaMax) || largo(con) > p.piezaMax || cambiaLinea;
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
      if (ant && largo(actual) < minima && largo([...ant, ...actual]) <= p.piezaMax && (!clave || new Set(lineasDe([...ant, ...actual].flat()).map(clave)).size <= 1) && (!p.aplicar561 || conduccion([...ant, ...actual]) <= p.conduccionContinuaMax)) ant.push(...actual);
      else grupos.push(actual);
    }
    let previa = null;
    for (const g of grupos) {
      const viajes = g.flat();
      const pz = {
        vehiculo: veh.id, autobus: veh.autobus ?? null, inicio: viajes[0].dep, fin: viajes.at(-1).arr, conduccion: viajes.reduce((a, v) => a + v.arr - v.dep, 0), viajes, previa,
        o: find ? find(viajes[0].o) : viajes[0].o, d: find ? find(viajes.at(-1).d) : viajes.at(-1).d,
        // dónde coge y deja el autobús el conductor (para lo que tarda en ir de una pieza a otra)
        oLL: geo?.coord?.get(viajes[0].o) || null, dLL: geo?.coord?.get(viajes.at(-1).d) || null,
        ...datosCochera(veh, viajes, geo),
        lineas: lineasDe(viajes),
      };
      piezas.push(pz); previa = pz;
    }
  }
  return piezas;
}

// ── Cortes flexibles ──
// En vez de cortar cada autobús por su cuenta (largo de pieza fijo), se parte
// en unidades de trabajo entre puntos de relevo y se proponen muchas piezas
// posibles (tramos seguidos de unidades); la partición elige a la vez dónde
// cortar y cómo juntar las piezas en turnos, mirando todos los autobuses
// (como HASTUS: dónde conviene cortar un autobús depende de los demás).
// Cada unidad tiene además su pieza de reserva (ella sola), para que todo
// se pueda cubrir. → { piezas, unidades }
export const esFlexible = p => p.corte === "flexible";
function cortarCandidatas(vehiculos, p, find, geo = null) {
  const piezas = [];
  const puedeRelevar = relevoPermitido(p, find);
  const clave = claveMezclaTurno(p);
  // unidad mínima: tramos de hora y media como poco (más finos, la partición tarda más y no sale mejor)
  const largoMin = Math.min(90, Math.max(30, Math.round((p.piezaMax || 240) / 2)));
  // la pieza mínima no se aplica a las posibles: si no, los trozos del medio no encajan y se fragmenta
  let nU = 0;
  for (const veh of vehiculos) {
    const tramos = [];
    let sueltos = [];
    for (const v of veh.viajes) { sueltos.push(v); if (!v.vacio) { tramos.push(sueltos); sueltos = []; } }
    if (sueltos.length) { if (tramos.length) tramos.at(-1).push(...sueltos); else tramos.push(sueltos); }
    // unidades: tramos seguidos hasta un punto de relevo, de largoMin como poco
    const unidades = [];
    let actual = [];
    tramos.forEach((tramo, k) => {
      // antes de pasarse de la pieza máxima, se cierra donde se pueda relevar
      if (actual.length && tramo.at(-1).arr - actual[0].dep > p.piezaMax && puedeRelevar(dondeAcaba(tramos[k - 1]))) { unidades.push({ viajes: actual }); actual = []; }
      actual.push(...tramo);
      const ultimo = k === tramos.length - 1;
      const sigLinea = !ultimo && clave && lineaDe(tramos[k + 1]) != null && lineaDe(tramo) != null && clave(lineaDe(tramos[k + 1])) !== clave(lineaDe(tramo));
      const aqui = !ultimo && puedeRelevar(dondeAcaba(tramo));
      if (ultimo || (aqui && (sigLinea || actual.at(-1).arr - actual[0].dep >= largoMin))) { unidades.push({ viajes: actual, corteLinea: sigLinea }); actual = []; }
    });
    if (actual.length) { if (unidades.length) unidades.at(-1).viajes.push(...actual); else unidades.push({ viajes: actual }); }
    // la última, si es muy corta, con la anterior (salvo que ahí cambie de línea y no se pueda mezclar)
    if (unidades.length > 1) {
      const u = unidades.at(-1), ant = unidades.at(-2);
      if (u.viajes.at(-1).arr - u.viajes[0].dep < largoMin / 2 && !ant.corteLinea && u.viajes.at(-1).arr - ant.viajes[0].dep <= p.piezaMax) { ant.viajes.push(...u.viajes); unidades.pop(); }
    }
    const base = nU;
    nU += unidades.length;
    const ult = unidades.length - 1;
    for (let i = 0; i <= ult; i++) {
      for (let j = i; j <= ult; j++) {
        if (j > i && unidades[j - 1].corteLinea) break; // no cruzar un cambio de línea que no se puede mezclar
        const viajes = unidades.slice(i, j + 1).flatMap(x => x.viajes);
        const dur = viajes.at(-1).arr - viajes[0].dep;
        if (j > i && dur > p.piezaMax) break;
        // todas las de una unidad (las de reserva) hasta la pieza máxima
                piezas.push({
          vehiculo: veh.id, autobus: veh.autobus ?? null, inicio: viajes[0].dep, fin: viajes.at(-1).arr,
          conduccion: viajes.reduce((a, v) => a + v.arr - v.dep, 0), viajes,
          o: find ? find(viajes[0].o) : viajes[0].o, d: find ? find(viajes.at(-1).d) : viajes.at(-1).d,
          oLL: geo?.coord?.get(viajes[0].o) || null, dLL: geo?.coord?.get(viajes.at(-1).d) || null,
          ...datosCochera(veh, viajes, geo),
          lineas: lineasDe(viajes), u: Array.from({ length: j - i + 1 }, (_, k) => base + i + k), uIni: base + i, uFin: base + j,
        });
      }
    }
  }
  return { piezas, unidades: nU };
}
// clave para pasar los grupos del worker: con cortes flexibles hay piezas que empiezan igual
const claveGrupo = pz => (pz.uIni != null ? `${clavePieza(pz)}|${pz.fin}` : clavePieza(pz));

// ── Tipos de turno ──
const enFranja = (min, desde, hasta) => { const m = ((min % 1440) + 1440) % 1440; return desde <= hasta ? m >= desde && m <= hasta : m >= desde || m <= hasta; };

/** ¿Cabe el turno (inicio, fin, trabajo, partidos) en el tipo? final: además llega al trabajo mínimo */
export function encajaTipo(t, tipo, final = false) {
  if (!enFranja(t.inicio - (t.antes || 0), tipo.desde, tipo.hasta)) return false;
  if (t.fin - t.inicio + (t.antes || 0) + (t.despues || 0) > tipo.amplitudMax || t.trabajo > tipo.trabajoMax) return false;
  if (t.partidos > (tipo.partido ? 1 : 0)) return false;
  if (t.partidos && tipo.splitMax > 0 && (t.split || 0) > tipo.splitMax) return false; // hueco del partido demasiado largo
  if (tipo.cambiosBus != null && (t.cambios || 0) > tipo.cambiosBus) return false; // este tipo no permite (tantos) cambios de autobús
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
  let hueco = 0, partido = false, viaje = 0, cambios = t ? t.cambios || 0 : 0;
  // turnos de una sola línea: la pieza nueva, de la misma línea que el turno
  const lineas = t ? (t.lineas || []) : (pz.lineas || []);
  const clave = claveMezclaTurno(p);
  if (t && clave && lineas.length && (pz.lineas || []).some(l => clave(l) !== clave(lineas[0]))) return null;
  if (t) {
    const ultima = t.piezas[t.piezas.length - 1];
    hueco = pz.inicio - t.fin;
    const e = entrePiezas(ultima, pz, p);
    if (hueco < e.hace) return null;
    if (t.piezas.length >= p.maxPiezas) return null;
    viaje = e.viaje; // ir a la otra cabecera: trabajo, no pausa
    partido = hueco - viaje >= p.huecoNoPagado;
    if (partido && t.partidos >= p.maxPartidos) return null;
    if (e.cambio) { cambios++; if (!p._tipos && conLimiteCambios(p) && cambios > p.maxCambiosBus) return null; }
  }
  const inicio = t ? t.inicio : pz.inicio;
  // toma (de la primera pieza) y deje (de la última, la que se añade): trabajo y amplitud
  const td = tomaYDeje(t ? t.piezas[0] : pz, pz, p);
  const antes = t ? t.antes ?? td.antes : td.antes, despues = td.despues;
  if (pz.fin - inicio + antes + despues > p.amplitudMax) return null;
  const trabajoBase = (t ? t.trabajoBase ?? t.trabajo : 0) + (partido ? viaje : hueco) + (pz.fin - pz.inicio);
  const trabajo = trabajoBase + antes + despues;
  if (trabajo > p.jornadaMax) return null;
  const conduccion = (t ? t.conduccion : 0) + pz.conduccion;
  if (p.aplicar561 && conduccion > p.conduccionDiariaMax) return null;
  // conducción continua: se acumula hasta juntar la pausa (puede partirse en 15 + 30)
  let seguido = t ? t.seguido : 0, pausaAcum = t ? t.pausaAcum : 0, hay15 = t ? t.hay15 : false, finPrev = t ? t.fin : null;
  for (const v of pz.viajes) {
    if (finPrev != null) {
      const h = v.dep - finPrev - (v === pz.viajes[0] ? viaje : 0); // el viaje a la otra cabecera no es descanso
      if (h >= 15) pausaAcum += h; // la pausa de conducción se puede partir 15 + 30
      if (h >= (p.pausaJornadaMin || 15)) hay15 = true; // descanso de jornada (Estatuto / convenio)
      if (pausaAcum >= p.pausaConduccionMin) { seguido = 0; pausaAcum = 0; }
    }
    seguido += v.arr - v.dep;
    if (p.aplicar561 && seguido > p.conduccionContinuaMax) return null;
    finPrev = v.arr;
  }
  if (p.jornadaSinPausaMax > 0 && pz.fin - inicio + antes + despues > p.jornadaSinPausaMax && !hay15) return null; // descanso si la jornada pasa de X (sin valor: no se exige)
  const estado = { inicio, fin: pz.fin, d: pz.d, trabajo, trabajoBase, antes, despues, conduccion, seguido, pausaAcum, hay15, cambios, lineas: t ? [...new Set([...lineas, ...(pz.lineas || [])])] : lineas, partidos: (t ? t.partidos : 0) + (partido ? 1 : 0), split: Math.max(t ? t.split || 0 : 0, partido ? hueco - viaje : 0) };
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
    else t.avisos.push(`No encaja en ningún tipo de turno: ${hm(t.trabajo)} de trabajo, de ${reloj(t.inicio)} a ${reloj(t.fin)}${t.partidos ? `, partido con ${hm(t.split || 0)} de hueco` : ""}${t.cambios ? `, ${t.cambios} cambio${t.cambios > 1 ? "s" : ""} de autobús` : ""}`);
  }
  return turnos;
}

// Coste de un turno para la partición: un conductor pesa mucho (o poco si el
// objetivo son las horas), más las horas pagadas; un turno que no encaja en
// ningún tipo, muchísimo (solo se usa si no hay otra forma de cubrir la pieza).
function costeTurno(e, piezas, p) {
  const porConductor = p.objetivoTurnos === "horas" ? 60 : 600;
  let c = porConductor + e.trabajo + piezas.length * 5 + (e.cambios || 0) * 5;
  if (e.sinValidar) c += 5000;
  else if (p._tipos && !tipoDeTurno(e, p)) c += 900;
  return c;
}

function estadoSuelto(pz) {
  return { piezas: [pz], inicio: pz.inicio, fin: pz.fin, d: pz.d, trabajo: pz.fin - pz.inicio, antes: 0, despues: 0, conduccion: pz.conduccion, seguido: 0, pausaAcum: 0, hay15: true, partidos: 0, cambios: 0, lineas: pz.lineas || [] };
}

function turnosPorParticion(piezas, p, unidades = null) {
  const topes = p._tipos ? p._tipos.map(x => (x.maximo > 0 ? x.maximo : Infinity)) : [];
  const conTope = topes.some(Number.isFinite);
  const partidos = (p._tipos || []).filter(x => x.partido);
  const splitMax = partidos.length && partidos.every(x => x.splitMax > 0) ? Math.max(...partidos.map(x => x.splitMax)) : Infinity;
  const grupos = particionTurnos(piezas, {
    valida: l => validar(l, p), coste: (e, l) => costeTurno(e, l, p),
    // cambios de autobús de todo el escenario, como mucho
    ...(conLimiteTotal(p) ? { recurso: { usa: e => e.cambios || 0, max: p.maxCambiosBusTotal } } : {}),
    ...(conTope ? { topes, tipoDe: e => p._tipos.findIndex(x => encajaTipo(e, x, true)) } : {}),
    huecoMax: splitMax,
    extiende: (e, pz) => { const x = anadir(e, pz, p); return x && { ...x, piezas: [...e.piezas, pz] }; },
    desplazamiento: p.desplazamiento, amplitudMax: p.amplitudMax, huecoNoPagado: p.huecoNoPagado, jornadaMax: p.jornadaMax,
    maxPiezas: Math.min(4, p.maxPiezas),
    ...(unidades != null ? { unidades } : {}),
  });
  // (si un grupo no valiera, cada pieza en su turno: no se pierde ninguna)
  return grupos.flatMap(g => { const l = g.map(i => piezas[i]); const t = validar(l, p); return t ? [t] : l.map(estadoSuelto); });
}

// La partición calculada en otro sitio (el worker) llega como grupos de
// claves de pieza; aquí se montan los turnos con las piezas de este cálculo.
function turnosDeGrupos(piezas, grupos, p) {
  const porClave = new Map(piezas.map(pz => [claveGrupo(pz), pz]));
  const puestas = new Set();
  const turnos = [];
  for (const g of grupos) {
    const l = g.map(k => porClave.get(k)).filter(pz => pz && !puestas.has(pz));
    if (!l.length) continue;
    l.forEach(pz => puestas.add(pz));
    turnos.push(validar(l, p) || estadoSuelto(l[0]));
    if (!validar(l, p)) for (const pz of l.slice(1)) turnos.push(estadoSuelto(pz)); // no debería pasar
  }
  if (piezas.some(pz => pz.u)) {
    // cortes flexibles: lo que quede sin cubrir, con las piezas de reserva (una unidad)
    const cubiertas = new Set([...puestas].flatMap(pz => pz.u));
    for (const pz of piezas) if (pz.u.length === 1 && !cubiertas.has(pz.u[0])) turnos.push(validar([pz], p) || estadoSuelto(pz));
  } else for (const pz of piezas) if (!puestas.has(pz)) turnos.push(validar([pz], p) || estadoSuelto(pz));
  return turnos;
}

/** Solo la partición (lo pesado), para hacerla en el worker: grupos de claves de pieza */
export function gruposTurnos(resVehiculos, opciones = {}) {
  const r = resVehiculos;
  const p = efectivos({ ...r.params, ...opciones, ...(r.ctx?.geo?.tramo ? { _tramo: r.ctx.geo.tramo } : {}) });
  if (esFlexible(p)) {
    const { piezas, unidades } = cortarCandidatas(r.vehiculosBase || r.vehiculos, p, r.find, r.ctx?.geo);
    return turnosPorParticion(piezas, p, unidades).map(t => t.piezas.map(claveGrupo));
  }
  const piezas = cortarPiezas(r.vehiculosBase || r.vehiculos, p, r.find, r.ctx?.geo);
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

export function programarTurnos(vehiculos, pOriginal, find, grupos = null, geo = null) {
  if (geo?.tramo && !pOriginal._tramo) pOriginal = { ...pOriginal, _tramo: geo.tramo };
  const p0 = efectivos(pOriginal);
  // los cortes flexibles solo tienen sentido con la partición
  const p = esFlexible(p0) && p0.metodo === "voraz" ? efectivos({ ...pOriginal, metodo: "particion" }) : p0;
  const flex = esFlexible(p) ? cortarCandidatas(vehiculos, p, find, geo) : null;
  const piezas = flex ? flex.piezas : cortarPiezas(vehiculos, p, find, geo);
  piezas.sort((x, y) => x.inicio - y.inicio || x.fin - y.fin);
  const turnos = p.metodo === "voraz" ? [] : grupos ? turnosDeGrupos(piezas, grupos, p) : turnosPorParticion(piezas, p, flex ? flex.unidades : null);
  // Voraz: cada pieza va al conductor que mejor la aprovecha: el que sigue en
  // ese autobús, si no el que menos espera ("primera") o el que lleva más
  // horas ("llena"); si no cabe en ninguno, entra un conductor nuevo.
  let activos = [];
  const deLaPieza = new Map(); // pieza → turno (para seguir en el mismo autobús)
  // cambios de autobús de todo el escenario: lo que llevan los turnos hechos
  const topeTotal = conLimiteTotal(p) ? p.maxCambiosBusTotal : Infinity;
  let usados = 0;
  const cabeTotal = (antes, despues) => usados - (antes?.cambios || 0) + (despues?.cambios || 0) <= topeTotal;
  for (let i = 0; i < (p.metodo === "voraz" ? piezas.length : 0); i++) {
    const pz = piezas[i];
    if (i % 200 === 0) activos = activos.filter(t => t.inicio + p.amplitudMax > pz.inicio);
    let mejor = null, nuevo = null, nota = -Infinity;
    const previo = pz.previa && deLaPieza.get(pz.previa);
    if (previo) { const x = anadir(previo, pz, p); if (x && cabeTotal(previo, x)) { mejor = previo; nuevo = x; nota = Infinity; } }
    if (!mejor) {
      for (const t of activos) {
        if (t.fin > pz.inicio || t.inicio + p.amplitudMax < pz.fin) continue;
        const x = anadir(t, pz, p);
        if (!x || !cabeTotal(t, x)) continue;
        const n = p.emparejar === "llena" ? x.trabajo * 1000 - (pz.inicio - t.fin) : -(pz.inicio - t.fin) * 1000 + x.trabajo;
        if (n > nota) { nota = n; mejor = t; nuevo = x; }
      }
    }
    if (mejor) { usados += (nuevo.cambios || 0) - (mejor.cambios || 0); Object.assign(mejor, nuevo); mejor.piezas.push(pz); deLaPieza.set(pz, mejor); continue; }
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
  let totalCambios = turnos.reduce((s, t) => s + (t.cambios || 0), 0);
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
        if (x && totalCambios - (t.cambios || 0) + (x.cambios || 0) > topeTotal) continue; // se pasaría del total de cambios de autobús
        if (x && (!estado || x.trabajo > estado.trabajo)) { destino = t; estado = x; }
      }
      if (!destino) { ok = false; break; }
      cambios.push([destino, { ...destino }]);
      totalCambios += (estado.cambios || 0) - (destino.cambios || 0);
      Object.assign(destino, estado);
    }
    if (ok) { quitados.add(c); totalCambios -= c.cambios || 0; }
    else for (const [t, antes] of cambios.reverse()) { totalCambios += (antes.cambios || 0) - (t.cambios || 0); Object.assign(t, antes); }
    if (ok) lista = lista.filter(t => t !== c);
  }
  const finales = asignarTipos(turnos.filter(t => !quitados.has(t)).map(t => cerrarTurno({ piezas: [...t.piezas].sort((a, b) => a.inicio - b.inicio) }, p)), p);
  finales.sort((x, y) => x.inicio - y.inicio);
  finales.forEach((t, i) => { t.id = i + 1; for (const pz of t.piezas) pz.turno = t.id; });
  // con cortes flexibles, las piezas son las elegidas (no todas las posibles)
  const usadas = flex ? finales.flatMap(t => t.piezas) : piezas;
  for (const pz of usadas) { delete pz.previa; delete pz.u; delete pz.uIni; delete pz.uFin; }
  return { turnos: finales, piezas: usadas };
}

export function cerrarTurno(t, pOriginal) {
  const p = efectivos(pOriginal);
  const viajes = t.piezas.flatMap(pz => pz.viajes);
  t.inicio = t.piezas[0].inicio;
  t.fin = t.piezas.at(-1).fin;
  const td = tomaYDeje(t.piezas[0], t.piezas.at(-1), p);
  t.antes = td.antes; t.despues = td.despues;
  t.toma = td.antes ? { que: "Toma", inicio: t.inicio - td.antes, fin: t.inicio, min: td.antes, viaje: td.ida } : null;
  t.deje = td.despues ? { que: "Deje", inicio: t.fin, fin: t.fin + td.despues, min: td.despues, viaje: td.vuelta } : null;
  t.duracion = t.fin - t.inicio + td.antes + td.despues; // amplitud (con la toma y el deje)
  // entre cada dos piezas: el cambio de autobús y lo que se tarda en ir a la otra cabecera
  const entre = t.piezas.slice(1).map((pz, i) => ({ ...entrePiezas(t.piezas[i], pz, p), hueco: pz.inicio - t.piezas[i].fin, a: t.piezas[i], b: pz }));
  const sinPagar = entre.map(e => e.hueco - e.viaje).filter(h => h >= p.huecoNoPagado);
  t.trabajo = t.duracion - sinPagar.reduce((s, h) => s + h, 0);
  t.partidos = sinPagar.length;
  t.split = Math.max(0, ...sinPagar);
  t.cambiosBus = t.cambios = entre.filter(e => e.cambio).length;
  t.desplazamientos = entre.filter(e => e.viaje > 0).map(e => ({ inicio: e.a.fin, fin: e.a.fin + e.viaje, km: e.km, desde: e.a.d, hasta: e.b.o }));
  t.conduccion = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  t.vehiculos = [...new Set(t.piezas.map(pz => pz.vehiculo))];
  const viajeAntes = new Map(entre.map(e => [e.b.viajes[0], e.viaje])); // el viaje a la otra cabecera no es descanso
  // Conducción continua: se acumula hasta una pausa de pausaConduccionMin
  // (puede partirse en 15 + 30); la pausa entre piezas y las esperas largas cuentan
  let seguido = 0, peor = 0, pausaAcum = 0, hayPausa15 = false;
  viajes.forEach((v, i) => {
    if (i > 0) {
      const hueco = v.dep - viajes[i - 1].arr - (viajeAntes.get(v) || 0);
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
  t.lineas = lineasDe(viajes);
  const clave = claveMezclaTurno(p);
  if (clave && new Set(t.lineas.map(clave)).size > 1) t.avisos.push(`Mezcla líneas${p.turnoUnaLinea || p.mezclaTurnos === "linea" ? "" : " de distintos grupos"}: ${t.lineas.join(", ")}`);
  if (!p._tipos && conLimiteCambios(p) && t.cambiosBus > p.maxCambiosBus) t.avisos.push(`${t.cambiosBus} cambios de autobús: más de ${p.maxCambiosBus}`);
  for (const e of entre) {
    if (e.hueco < 0) { t.avisos.push(`Las piezas de las ${reloj(e.a.inicio)} y las ${reloj(e.b.inicio)} se solapan`); continue; }
    if (e.hueco < e.hace) t.avisos.push(`Solo ${e.hueco} min para ${e.viaje ? `ir a otra cabecera${e.km ? ` (${String(e.km).replace(".", ",")} km)` : ""}` : "relevar"} a las ${reloj(e.b.inicio)} (hacen falta ${e.hace})`);
  }
  return t;
}
