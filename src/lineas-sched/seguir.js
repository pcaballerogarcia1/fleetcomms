// Scheduling de líneas · después de los turnos: que los autobuses sigan a los
// conductores. Donde un conductor deja un autobús y coge otro en la misma
// cabecera, se intercambia lo que les queda por hacer a los dos autobuses: el
// conductor sigue en el suyo y el otro autobús hace lo que hacía el primero.
// Los turnos (horas, piezas) y el número de autobuses no cambian; solo qué
// autobús hace cada trozo. Es lo que hacen las empresas a mano («reescribir
// los autobuses para que sigan a los turnos», Wren y Rousseau 1993).
import { entrePiezas, cerrarTurno, asignarTipos } from "./turnos.js";

const cambiosDe = piezas => { let n = 0; for (let k = 1; k < piezas.length; k++) if ((piezas[k].autobus ?? piezas[k].vehiculo) !== (piezas[k - 1].autobus ?? piezas[k - 1].vehiculo)) n++; return n; };

/**
 * @param vehiculos bloques (no se modifican: los que cambian se devuelven nuevos)
 * @param autobuses [{ id, bloques: [id] }]
 * @param turnos    turnos con sus piezas (se modifican las piezas y se cierran de nuevo)
 * @param cfg       configuración de las líneas (su regulación en cabecera)
 * @returns { vehiculos, turnos, intercambios }
 */
export function seguirConductores(vehiculos, autobuses, turnos, p, cfg = {}) {
  if (p.busSigueConductor === false || !turnos?.length) return { vehiculos, turnos, intercambios: 0 };
  const bloque = new Map(vehiculos.map(v => [v.id, v]));
  const lista = new Map(vehiculos.map(v => [v.id, []])); // bloque → sus piezas por hora
  const turnoDe = new Map();
  for (const t of turnos) for (const pz of t.piezas) { lista.get(pz.vehiculo)?.push(pz); turnoDe.set(pz, t); }
  for (const l of lista.values()) l.sort((a, b) => a.inicio - b.inicio);
  // el bloque siguiente del mismo autobús físico (no se puede pisar)
  const siguienteDe = new Map();
  for (const bus of autobuses || []) {
    const bs = bus.bloques.map(id => bloque.get(id)).filter(Boolean).sort((a, b) => a.inicio - b.inicio);
    bs.forEach((b, i) => siguienteDe.set(b.id, bs[i + 1] || null));
  }
  const ampMax = Math.min(p.amplitudBusMax > 0 ? p.amplitudBusMax : Infinity, p.bloqueMax > 0 ? p.bloqueMax : Infinity);
  const margen = vehiculos.some(v => v.cochera) ? p.margenCochera : p.margenVacio;
  const iniDe = id => lista.get(id)[0]?.inicio ?? bloque.get(id).inicio;
  const regDe = pz => { const v = pz.viajes.find(q => !q.vacio); return cfg?.[v?.linea]?.regulacion ?? p.regulacion ?? 0; };
  const cabeEnElAutobus = (id, fin) => { const s = siguienteDe.get(id); return !s || fin + (margen || 0) <= s.inicio; };
  // ¿siguen valiendo los turnos tocados? (relevos con tiempo y su tipo de turno)
  const validos = ts => [...ts].every(t => {
    for (let k = 1; k < t.piezas.length; k++) {
      const a = t.piezas[k - 1], b = t.piezas[k];
      if (b.inicio - a.fin < entrePiezas(a, b, p).hace) return false;
    }
    if (t.tipo) {
      const tipo = (p.tiposTurno || []).find(x => x.id === t.tipo);
      if (tipo?.cambiosBus != null && cambiosDe(t.piezas) > tipo.cambiosBus) return false;
    } else if (!(p.tiposTurno || []).some(x => x.activo !== false) && p.maxCambiosBus != null && p.maxCambiosBus !== "" && cambiosDe(t.piezas) > p.maxCambiosBus) return false;
    return true;
  });
  const mover = (pzs, id) => pzs.map(pz => { const antes = [pz.vehiculo, pz.autobus]; pz.vehiculo = id; pz.autobus = bloque.get(id).autobus ?? null; return antes; });
  const deshacer = (pzs, antes) => pzs.forEach((pz, i) => { [pz.vehiculo, pz.autobus] = antes[i]; });

  let intercambios = 0;
  for (let pasada = 0; pasada < 4; pasada++) {
    let hechos = 0;
    for (const t of turnos) {
      for (let k = 1; k < t.piezas.length; k++) {
        const a = t.piezas[k - 1], b = t.piezas[k];
        if ((a.autobus ?? a.vehiculo) === (b.autobus ?? b.vehiculo) || a.d !== b.o || a.vehiculo === b.vehiculo) continue;
        const X = a.vehiculo, Y = b.vehiculo, LX = lista.get(X), LY = lista.get(Y);
        const ia = LX.indexOf(a), ib = LY.indexOf(b);
        if (ia < 0 || ib < 0 || ia === LX.length - 1 || ib === 0) continue; // a acaba su bloque o b lo empieza: hay cochera de por medio
        const x = LX[ia + 1], y = LY[ib - 1];
        // cada autobús, con la regulación de la línea que va a hacer (o el margen que ya tenía, si era menor)
        if (b.inicio - a.fin < Math.min(regDe(b), x.inicio - a.fin) || x.inicio - y.fin < Math.min(regDe(x), b.inicio - y.fin)) continue;
        if (b.inicio < a.fin || x.inicio < y.fin) continue;
        if ((bloque.get(X).cochera ?? null) !== (bloque.get(Y).cochera ?? null)) continue; // la vuelta tiene que ser a la misma cochera
        const finX = LY.at(-1).fin, finY = LX.at(-1).fin;
        if (finX - iniDe(X) > ampMax || finY - iniDe(Y) > ampMax) continue;
        if (!cabeEnElAutobus(X, finX) || !cabeEnElAutobus(Y, finY)) continue;
        const colaX = LX.slice(ia + 1), colaY = LY.slice(ib);
        const tocados = new Set([...colaX, ...colaY].map(pz => turnoDe.get(pz)));
        const antesN = [...tocados].reduce((s, tt) => s + cambiosDe(tt.piezas), 0);
        const ax = mover(colaY, X), ay = mover(colaX, Y);
        const despuesN = [...tocados].reduce((s, tt) => s + cambiosDe(tt.piezas), 0);
        if (despuesN < antesN && validos(tocados)) {
          lista.set(X, LX.slice(0, ia + 1).concat(colaY));
          lista.set(Y, LY.slice(0, ib).concat(colaX));
          hechos++;
        } else { deshacer(colaY, ax); deshacer(colaX, ay); }
      }
    }
    intercambios += hechos;
    if (!hechos) break;
  }
  if (!intercambios) return { vehiculos, turnos, intercambios };
  // bloques rehechos con sus piezas nuevas
  const nuevos = vehiculos.map(v => {
    const pzs = lista.get(v.id);
    const viajes = pzs.flatMap(pz => pz.viajes);
    if (!viajes.length || viajes.length === v.viajes.length && viajes.every((x, i) => x === v.viajes[i])) return v;
    const reales = viajes.filter(x => !x.vacio);
    return {
      ...v, viajes, inicio: viajes[0].dep, fin: viajes.at(-1).arr,
      lineas: [...new Set(reales.map(x => x.nombre))],
      kmVacio: Math.round(viajes.reduce((s, x) => s + (x.vacio ? x.km || 0 : 0), 0) * 10) / 10,
    };
  });
  const cerrados = asignarTipos(turnos.map(t => cerrarTurno({ id: t.id, piezas: t.piezas }, p)), p);
  return { vehiculos: nuevos, turnos: cerrados, intercambios };
}
