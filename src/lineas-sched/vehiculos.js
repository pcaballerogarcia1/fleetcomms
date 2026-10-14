// Scheduling de líneas · paso 1: encadenar los viajes en autobuses (voraz u óptimo)
// y repartir los bloques entre autobuses físicos.


import { PEGADAS_KM, admite, hm, tipoDeLinea, vacio, autobusPuedeSeguir } from "./base.js";
import { montarBloque } from "./manual.js";

// Lo que puede estar un autobús fuera de cochera: la restricción (amplitud
// máxima del autobús) y, si la estrategia lo pide, el largo de un turno
// (bloqueMax: así cada conductor puede hacer el autobús entero sin cambiar)
const amplitudBus = p => Math.min(p.amplitudBusMax > 0 ? p.amplitudBusMax : Infinity, p.bloqueMax > 0 ? p.bloqueMax : Infinity);

// 1) Vehículos: bloques de viajes encadenados en cabecera
function programarVehiculos(viajes, cfg, find, p, geo) {
  const vehiculos = [];
  const esperando = new Map(); // cabecera → [vehículo]
  const vmax = p.vacios === false || !geo ? 0 : Math.min(p.vacioMaxKm || 0, p.vacioKm ?? Infinity);
  const raices = [...new Set(viajes.flatMap(v => [find(v.o), find(v.d)]))];
  const vecinos = new Map(); // cabecera → [[otra, km, min]] a menos de vmax km
  const vecinosDe = r => {
    if (!vecinos.has(r)) {
      const l = [];
      for (const x of raices) {
        if (x === r) continue;
        const k = geo.km(r, x);
        if (k != null && k <= vmax) l.push([x, k, k < PEGADAS_KM ? 0 : geo.min(k, r, x)]); // paradas pegadas: es la misma cabecera
      }
      vecinos.set(r, l.sort((a, b) => a[1] - b[1]).slice(0, 30));
    }
    return vecinos.get(r);
  };
  // Amplitud máxima del autobús: desde que sale de cochera (o del primer
  // viaje, sin cocheras) hasta que vuelve tras el último viaje
  const ampMax = amplitudBus(p);
  const minCochera = (a, b) => { const k = geo?.hayCocheras ? geo.km(a, b) : null; return k != null && k >= PEGADAS_KM ? geo.min(k, a, b) : 0; };
  const cocheraDe = v => (geo?.hayCocheras ? geo.cocheraDe(v.linea, v.o) : null);
  const cabe = (veh, v) => ampMax === Infinity || v.arr + (veh.cocheraEst ? minCochera(v.d, veh.cocheraEst) : 0) - veh.salida0 <= ampMax;
  // espera larga en cabecera: el autobús se va a cochera (si le da tiempo a ir y volver) y este viaje lo empieza otro bloque
  const aCochera = (veh, v) => {
    if (!(p.esperaMaxCabecera > 0) || v.dep - veh.libre <= p.esperaMaxCabecera) return false;
    const ultimo = veh.viajes.at(-1), ci = cocheraDe(v) || cocheraDe(ultimo);
    const ida = ci ? minCochera(ultimo.d, ci) + p.margenCochera + minCochera(ci, v.o) : p.margenVacio;
    return v.dep - ultimo.arr >= ida;
  };
  const sigue = autobusPuedeSeguir(p);
  const vale = (veh, v, c) => (veh.linea === v.linea || sigue(veh.nombreLinea, v.nombre)) && admite(c, veh.tipo) && cabe(veh, v) && !aCochera(veh, v);
  for (const v of viajes) {
    const c = cfg[v.linea];
    const donde = find(v.o);
    const cola = esperando.get(donde) || [];
    let mejor = -1;
    for (let k = 0; k < cola.length; k++) {
      const veh = cola[k];
      if (veh.libre > v.dep || !vale(veh, v, c)) continue;
      if (mejor < 0 || (p.eleccion === "primero" ? veh.libre < cola[mejor].libre : veh.libre > cola[mejor].libre)) mejor = k;
    }
    let veh = null;
    if (mejor >= 0) { veh = cola[mejor]; cola.splice(mejor, 1); }
    else if (vmax > 0) {
      // nadie libre aquí: uno de una cabecera cercana que llegue en vacío
      let elegido = null;
      for (const [otra, km, minutos] of vecinosDe(donde)) {
        const q = esperando.get(otra);
        if (!q?.length) continue;
        for (let k = 0; k < q.length; k++) {
          const x = q[k];
          if (x.libre + minutos > v.dep || !vale(x, v, c)) continue;
          if (!elegido || km < elegido.km || (km === elegido.km && x.libre > elegido.x.libre)) elegido = { x, q, k, km, minutos, otra };
        }
        if (elegido) break; // los vecinos van por distancia: el primero que tiene alguno es el más cerca
      }
      if (elegido) {
        veh = elegido.x; elegido.q.splice(elegido.k, 1);
        if (elegido.km >= PEGADAS_KM) veh.viajes.push(vacio(veh.viajes.at(-1).d, v.o, veh.libre, elegido.minutos, elegido.km, "cabecera", v.nombre));
      }
    }
    if (!veh) {
      const cochera = ampMax < Infinity ? cocheraDe(v) : null;
      veh = { id: vehiculos.length + 1, tipo: tipoDeLinea(c), viajes: [], libre: 0, linea: v.linea, cocheraEst: cochera, salida0: v.dep - (cochera ? minCochera(cochera, v.o) : 0) };
      vehiculos.push(veh);
    }
    veh.viajes.push(v);
    veh.linea = v.linea; veh.nombreLinea = v.nombre;
    veh.libre = v.arr + (c?.regulacion ?? p.regulacion);
    const fin = find(v.d);
    if (!esperando.has(fin)) esperando.set(fin, []);
    esperando.get(fin).push(veh);
  }
  for (const veh of vehiculos) {
    const reales = veh.viajes.filter(x => !x.vacio);
    // salida de cochera y vuelta a cochera
    if (geo?.hayCocheras) {
      const primero = reales[0], ultimo = reales.at(-1);
      veh.cochera = geo.cocheraDe(primero.linea, primero.o);
      const ida = geo.km(veh.cochera, primero.o), vuelta = geo.km(ultimo.d, veh.cochera);
      if (ida != null && ida >= PEGADAS_KM) { const m = geo.min(ida, veh.cochera, primero.o); veh.viajes.unshift(vacio(veh.cochera, primero.o, primero.dep - m, m, ida, "salida", primero.nombre)); }
      if (vuelta != null && vuelta >= PEGADAS_KM) veh.viajes.push(vacio(ultimo.d, veh.cochera, ultimo.arr, geo.min(vuelta, ultimo.d, veh.cochera), vuelta, "vuelta"));
    }
    veh.inicio = veh.viajes[0].dep;
    veh.fin = veh.viajes.at(-1).arr;
    veh.lineas = [...new Set(reales.map(x => x.nombre))];
    veh.kmVacio = Math.round(veh.viajes.reduce((s, x) => s + (x.vacio ? x.km : 0), 0) * 10) / 10;
    // un solo viaje (con la salida y la vuelta) ya más largo que el máximo: no se puede partir, se avisa
    if (ampMax < Infinity && veh.fin - veh.inicio > ampMax) veh.avisos = [`Amplitud del autobús de ${hm(veh.fin - veh.inicio)}: supera ${hm(ampMax)}`];
    delete veh.libre; delete veh.linea; delete veh.nombreLinea; delete veh.cocheraEst; delete veh.salida0;
  }
  return vehiculos;
}

// 1-bis) Vehículos con el mínimo de autobuses (como Optibus / GoalSystem).
// Cada viaje se puede enlazar con uno posterior que haga el mismo autobús:
// en la misma cabecera (tras la regulación), con un vacío a una cabecera
// cercana, o pasando por cochera (huecos largos; sin cocheras, con el
// margen del vacío). El mínimo de autobuses es el número de viajes menos el
// emparejamiento máximo de esos enlaces (cobertura mínima por caminos,
// Hopcroft–Karp). Los enlaces se prueban de más barato a más caro (misma
// cabecera y poca espera primero), así que entre las soluciones con el
// mínimo de autobuses salen pocos vacíos.
function programarVehiculosOptimo(viajes, cfg, find, p, geo) {
  const n = viajes.length;
  const vmax = p.vacios === false || !geo ? 0 : Math.min(p.vacioMaxKm || 0, p.vacioKm ?? Infinity);
  const reg = v => cfg[v.linea]?.regulacion ?? p.regulacion;
  const tipoDe = v => tipoDeLinea(cfg[v.linea]);
  const sigue = autobusPuedeSeguir(p);
  const compatibles = (a, b) => { const ta = tipoDe(a), tb = tipoDe(b); return admite(cfg[b.linea], ta) && admite(cfg[a.linea], tb) && (ta == null || tb == null || ta === tb); };
  const cocheraDe = v => (geo?.hayCocheras ? geo.cocheraDe(v.linea, v.o) : null);
  const minK = (a, b) => { const k = geo ? geo.km(a, b) : null; return k != null && k >= PEGADAS_KM ? geo.min(k, a, b) : 0; };
  const deps = viajes.map(v => v.dep); // ya vienen por hora de salida
  const desde = (lista, t, dep) => { let lo = 0, hi = lista.length; while (lo < hi) { const mm = (lo + hi) >> 1; if (dep(lista[mm]) < t) lo = mm + 1; else hi = mm; } return lo; };
  const porLugar = new Map();
  viajes.forEach((v, i) => { const r = find(v.o); if (!porLugar.has(r)) porLugar.set(r, []); porLugar.get(r).push(i); });
  const raices = [...porLugar.keys()];
  const vecinos = new Map();
  const vecinosDe = r => {
    if (!vecinos.has(r)) {
      const l = [];
      if (vmax > 0) for (const x of raices) { if (x === r) continue; const k = geo.km(r, x); if (k != null && k <= vmax) l.push([x, k, k < PEGADAS_KM ? 0 : geo.min(k, r, x)]); }
      vecinos.set(r, l.sort((a, b) => a[1] - b[1]).slice(0, 12));
    }
    return vecinos.get(r);
  };
  const K = 10;
  const adyA = new Array(n), adyB = new Array(n), adyC = new Array(n); // misma cabecera · vacío · cochera
  for (let i = 0; i < n; i++) {
    const a = viajes[i], t0 = a.arr + reg(a), puesto = new Set();
    let l = adyA[i] = [];
    const poner = j => { if (!puesto.has(j)) { puesto.add(j); l.push(j); } };
    const mismaLinea = b => b.linea === a.linea || sigue(a.nombre, b.nombre);
    // 1) en la misma cabecera, la siguiente que sale
    const aqui = porLugar.get(find(a.d)) || [];
    // (en cabeceras con mucho tráfico, las siguientes K salen en minutos: se mira una ventana de 2 h)
    for (let k = desde(aqui, t0, j => deps[j]), c = 0; k < aqui.length && c < 40 && (c < K || deps[aqui[k]] <= t0 + 120); k++) { const j = aqui[k]; if (compatibles(a, viajes[j]) && mismaLinea(viajes[j])) { poner(j); c++; } }
    // 2) con un vacío a una cabecera cercana
    l = adyB[i] = [];
    let cv = 0;
    for (const [r2, , mins] of vecinosDe(find(a.d))) {
      const alli = porLugar.get(r2) || [];
      for (let k = desde(alli, t0 + mins, j => deps[j]), c = 0; k < alli.length && c < 2; k++) { const j = alli[k]; if (compatibles(a, viajes[j]) && mismaLinea(viajes[j])) { poner(j); c++; cv++; } }
      if (cv >= K) break;
    }
    // 3) pasando por cochera (o un descanso largo, sin cocheras): cualquier viaje que dé tiempo
    l = adyC[i] = [];
    const ci = cocheraDe(a);
    const tmin = ci ? a.arr + minK(a.d, ci) + p.margenCochera : a.arr + p.margenVacio;
    for (let k = desde(deps, tmin, x => x), c = 0, mirados = 0; k < n && c < K && mirados < 400; k++, mirados++) {
      const b = viajes[k];
      if (!compatibles(a, b)) continue;
      if (ci && (cocheraDe(b) !== ci || b.dep - minK(ci, b.o) < tmin)) continue;
      poner(k); c++;
    }
  }
  // Los enlaces de la solución voraz también son candidatos: así el
  // emparejamiento trabaja sobre algo que la contiene y nunca da más autobuses
  {
    const idx = new Map(viajes.map((v, i) => [v, i]));
    const voraz = programarVehiculos(viajes, cfg, find, { ...p, eleccion: "ultimo" }, geo);
    const buses = repartirAutobuses(voraz, p);
    const porId = new Map(voraz.map(v => [v.id, v]));
    for (const b of buses) {
      const l = b.bloques.map(id => porId.get(id)).sort((x, y) => x.inicio - y.inicio).flatMap(v => v.viajes.filter(x => !x.vacio)).map(x => idx.get(x));
      l.slice(1).forEach((j, k) => {
        const i = l[k], a = viajes[i], b2 = viajes[j];
        const lista = find(a.d) === find(b2.o) && b2.dep >= a.arr + reg(a) ? adyA : vmax > 0 && geo.km(a.d, b2.o) != null && geo.km(a.d, b2.o) <= vmax ? adyB : adyC;
        if (!adyA[i].includes(j) && !adyB[i].includes(j) && !adyC[i].includes(j)) lista[i].push(j);
      });
    }
  }
  // Hopcroft–Karp sin recursión (con decenas de miles de viajes la pila no da)
  const mL = new Int32Array(n).fill(-1), mR = new Int32Array(n).fill(-1), dist = new Int32Array(n), it = new Int32Array(n);
  const INF = 1 << 30;
  const bfs = () => {
    const cola = [];
    for (let i = 0; i < n; i++) { if (mL[i] < 0) { dist[i] = 0; cola.push(i); } else dist[i] = INF; }
    let libre = false;
    for (let h = 0; h < cola.length; h++) {
      const u = cola[h];
      for (const v of ady[u]) { const w = mR[v]; if (w < 0) libre = true; else if (dist[w] === INF) { dist[w] = dist[u] + 1; cola.push(w); } }
    }
    return libre;
  };
  const aumentar = raiz => {
    const pila = [raiz], via = [];
    while (pila.length) {
      const u = pila[pila.length - 1];
      let bajo = false;
      while (it[u] < ady[u].length) {
        const v = ady[u][it[u]++], w = mR[v];
        if (w < 0) {
          via.push(v);
          for (let k = pila.length - 1; k >= 0; k--) { mL[pila[k]] = via[k]; mR[via[k]] = pila[k]; }
          return true;
        }
        if (dist[w] === dist[u] + 1) { via.push(v); pila.push(w); bajo = true; break; }
      }
      if (!bajo) { dist[u] = INF; pila.pop(); via.pop(); }
    }
    return false;
  };
  // Por fases: primero solo los enlaces baratos; los vacíos y las idas a cochera
  // entran después, solo si hacen falta para quitar autobuses (el resultado es
  // el mismo mínimo de autobuses, con menos km en vacío)
  let ady = adyA;
  for (const fase of [[adyA], [adyA, adyC], [adyA, adyC, adyB]]) {
    ady = fase.length === 1 ? adyA : Array.from({ length: n }, (_, i) => fase.flatMap(x => x[i]));
    while (bfs()) { it.fill(0); for (let i = 0; i < n; i++) if (mL[i] < 0) aumentar(i); }
  }
  // Repaso de intercambios: con el mismo número de autobuses, cambiar quién
  // hace el viaje siguiente si así se ahorran km en vacío (a→b y c→d pasan a
  // a→d y c→b). El emparejamiento da el mínimo de autobuses, pero no mira
  // los km; sin esto, en redes grandes metía muchos vacíos innecesarios.
  const costeEnlace = (a, b) => {
    if (b.dep < a.arr + reg(a) || !compatibles(a, b)) return Infinity;
    const misma = b.linea === a.linea || sigue(a.nombre, b.nombre);
    if (misma && find(a.d) === find(b.o)) return 0;
    if (misma && vmax > 0) { const k = geo.km(a.d, b.o); if (k != null && k <= vmax && b.dep >= a.arr + reg(a) + (k < PEGADAS_KM ? 0 : geo.min(k, a.d, b.o))) return k; }
    const ci = cocheraDe(a);
    if (ci) {
      if (cocheraDe(b) !== ci) return Infinity;
      const kv = geo.km(a.d, ci) ?? 0, ks = geo.km(ci, b.o) ?? 0;
      return b.dep - minK(ci, b.o) >= a.arr + minK(a.d, ci) + p.margenCochera ? kv + ks : Infinity;
    }
    return b.dep >= a.arr + p.margenVacio ? 0.5 : Infinity; // descanso largo sin cocheras: casi gratis
  };
  for (let pasada = 0; pasada < 12; pasada++) {
    let mejoras = 0;
    for (let a = 0; a < n; a++) {
      const b = mL[a];
      if (b < 0) continue;
      const cab = costeEnlace(viajes[a], viajes[b]);
      if (cab === 0) continue;
      // candidatos d: los de la misma cabecera donde acaba a y los de cabeceras más cerca que b
      for (const d of adyA[a].concat(adyB[a])) {
        if (d === b) continue;
        const c = mR[d];
        const cad = costeEnlace(viajes[a], viajes[d]);
        if (cad === Infinity) continue;
        if (c < 0) {
          // d empieza un autobús: a se queda d y b pasa a empezar autobús (mismo número)
          if (cad < cab) { mL[a] = d; mR[d] = a; mR[b] = -1; mejoras++; break; }
          continue;
        }
        const ccd = costeEnlace(viajes[c], viajes[d]), ccb = costeEnlace(viajes[c], viajes[b]);
        if (ccb === Infinity || cad + ccb >= cab + ccd - 1e-9) continue;
        mL[a] = d; mR[d] = a; mL[c] = b; mR[b] = c; mejoras++;
        break;
      }
    }
    if (!mejoras) break;
  }

  // Caminos = autobuses; se parten en bloques donde el enlace pasa por cochera
  const enLinea = (a, b) => {
    if (b.dep < a.arr + reg(a)) return false;
    if (p.esperaMaxCabecera > 0 && b.dep - (a.arr + reg(a)) > p.esperaMaxCabecera) {
      // espera larga: a cochera, si da tiempo a ir y volver (si no, espera en la cabecera)
      const ci = cocheraDe(a);
      const ida = ci ? minK(a.d, ci) + p.margenCochera + minK(ci, b.o) : p.margenVacio;
      if (b.dep - a.arr >= ida) return false;
    }
    if (b.linea !== a.linea && !sigue(a.nombre, b.nombre)) return false; // cambiar de línea sin pasar por cochera (o fuera del grupo) no se permite
    if (find(a.d) === find(b.o)) return true;
    const k = vmax > 0 ? geo.km(a.d, b.o) : null;
    return k != null && k <= vmax && b.dep >= a.arr + reg(a) + (k < PEGADAS_KM ? 0 : geo.min(k, a.d, b.o));
  };
  const ampMax = amplitudBus(p);
  const caminos = [];
  for (let i = 0; i < n; i++) {
    if (mR[i] >= 0) continue;
    let actual = [];
    for (let j = i; j >= 0; j = mL[j]) {
      const v = viajes[j];
      // amplitud máxima del autobús: si el siguiente viaje la pasa, empieza otro autobús
      if (actual.length && ampMax < Infinity) {
        const ci = cocheraDe(viajes[actual[0]]);
        const ini = viajes[actual[0]].dep - (ci ? minK(ci, viajes[actual[0]].o) : 0);
        if (v.arr + (ci ? minK(v.d, ci) : 0) - ini > ampMax) { caminos.push(actual); actual = []; }
      }
      actual.push(j);
    }
    caminos.push(actual);
  }
  caminos.sort((x, y) => viajes[x[0]].dep - viajes[y[0]].dep);
  const ctx = { ctx: { geo, cfg }, params: p, find };
  const vehiculos = [], autobuses = [];
  for (const c of caminos) {
    const bus = { id: autobuses.length + 1, tipo: tipoDe(viajes[c[0]]), bloques: [], cochera: null };
    let bloque = [];
    const cerrar = () => {
      if (!bloque.length) return;
      const veh = montarBloque({ id: vehiculos.length + 1, tipo: bus.tipo, autobus: bus.id, relevos: [] }, bloque.map(j => viajes[j]), ctx);
      veh.manual = false;
      if (!veh.avisos.length) delete veh.avisos;
      vehiculos.push(veh); bus.bloques.push(veh.id);
      if (bus.cochera == null) bus.cochera = veh.cochera || null;
      bloque = [];
    };
    c.forEach((j, k) => { if (k && !enLinea(viajes[c[k - 1]], viajes[j])) cerrar(); bloque.push(j); });
    cerrar();
    autobuses.push(bus);
  }
  return { vehiculos, autobuses };
}

// Los dos pasos del paso 1 según la estrategia: el óptimo o el voraz de siempre
export function vehiculosYAutobuses(viajes, cfg, find, p, geo) {
  if (p.eleccion === "optimo") return programarVehiculosOptimo(viajes, cfg, find, p, geo);
  const vehiculos = programarVehiculos(viajes, cfg, find, p, geo);
  return { vehiculos, autobuses: repartirAutobuses(vehiculos, p) };
}

// Autobuses físicos: bloques sin solaparse (con el margen del vacío)
function repartirAutobuses(vehiculos, p) {
  const autobuses = [];
  for (const veh of [...vehiculos].sort((x, y) => x.inicio - y.inicio)) {
    let mejor = null;
    for (const bus of autobuses) {
      // con cocheras los bloques ya llevan la ida y la vuelta: solo el rato en cochera
      if (bus.libre + (veh.cochera ? p.margenCochera : p.margenVacio) > veh.inicio) continue;
      if (veh.cochera && bus.cochera !== veh.cochera) continue;
      if (bus.tipo != null && veh.tipo != null && bus.tipo !== veh.tipo) continue;
      // amplitud máxima del autobús (la restricción, para el día entero; el
      // largo de bloque de la estrategia es por salida de cochera y no cuenta aquí)
      if (p.amplitudBusMax > 0 && veh.fin - bus.inicio > p.amplitudBusMax) continue;
      if (!mejor || bus.libre > mejor.libre) mejor = bus;
    }
    if (!mejor) { mejor = { id: autobuses.length + 1, tipo: veh.tipo, bloques: [], libre: 0, inicio: veh.inicio, cochera: veh.cochera || null }; autobuses.push(mejor); }
    mejor.bloques.push(veh.id);
    mejor.libre = veh.fin;
    if (mejor.tipo == null) mejor.tipo = veh.tipo;
    veh.autobus = mejor.id;
  }
  autobuses.forEach(b => { delete b.libre; delete b.inicio; });
  return autobuses;
}
