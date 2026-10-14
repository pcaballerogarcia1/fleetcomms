// ── Turnos de conductor por partición de conjuntos (como Optibus / GoalSystem) ──
// En vez de ir pieza a pieza dándosela al conductor que menos espera (voraz),
// se generan muchos turnos posibles (combinaciones de 1 a 4 piezas que
// cumplen todas las reglas: tipos de turno, pausas UE 561, amplitud…) y se
// elige el conjunto que cubre cada pieza UNA vez con el menor coste
// (conductores y horas pagadas). Es un problema de partición de conjuntos;
// se resuelve con relajación lagrangiana (subgradiente) y una heurística
// voraz guiada por los multiplicadores, que es la técnica clásica de los
// optimizadores de turnos de conductor.
//
// Funciones puras: no sabe nada de autobuses ni de reglas. Recibe las piezas
// y tres funciones:
//   valida(listaDePiezas) → estado del turno ({ trabajo, … }) o null si no vale
//   extiende(estado, pieza) → estado con la pieza añadida al final, o null
//     (lo mismo que valida con una pieza más, sin volver a comprobar las de antes)
//   coste(estado, listaDePiezas) → número (menor es mejor)
// y devuelve los turnos como listas de índices de pieza.
//
// Con `unidades` (cortes flexibles) las piezas pueden solaparse: cada una
// cubre unas unidades de trabajo (pz.u, índices de 0 a unidades-1) y lo que
// se cubre UNA vez son las unidades, no las piezas. Así el optimizador elige
// también dónde se corta cada autobús. Tiene que haber, para cada unidad, una
// pieza que sea solo esa unidad (la de reserva).

/**
 * @param piezas   [{ inicio, fin, o, d }] ordenadas o no
 * @param opciones { valida, extiende, coste, desplazamiento, amplitudMax, huecoNoPagado, jornadaMax,
 *                   porPrimera, porPareja, porTrio, maxPiezas = 4, iteraciones = 120,
 *                   rondas = 0, iteracionesRonda = 60 (refinado, «a fondo»), onProgreso, onInfo }
 */
export function particionTurnos(piezas, opciones) {
  const { valida, extiende = (e, pz, lista) => valida(lista), coste, desplazamiento = 20, amplitudMax = 540, huecoNoPagado = 60, jornadaMax = Infinity,
    huecoMax = Infinity, tipoDe = null, topes = [], recurso = null,
    porPrimera = 16, porPareja = 5, porTrio = 2, iteraciones = 120, rondas = 0, iteracionesRonda = 60, onProgreso, maxPiezas = 4 } = opciones;
  const n = piezas.length;
  if (!n) return [];
  const nU = opciones.unidades ?? n; // lo que hay que cubrir una vez: las piezas, o sus unidades
  const unidadesDe = i => piezas[i].u ?? [i];
  const orden = [...piezas.keys()].sort((a, b) => piezas[a].inicio - piezas[b].inicio);
  const inicios = orden.map(i => piezas[i].inicio);

  // 1) Columnas: turnos posibles
  const cols = []; // { p: [índices], c: coste }
  const sola = new Int32Array(nU).fill(-1); // columna de la pieza (o unidad) sola: así todo se puede cubrir
  const anade = (lista, estado) => {
    if (lista.length === 1) { const us = unidadesDe(lista[0]); if (us.length === 1) sola[us[0]] = cols.length; }
    cols.push({ p: lista, c: coste(estado, lista.map(i => piezas[i])), t: tipoDe && !estado.sinValidar ? tipoDe(estado) : -1, r: recurso && !estado.sinValidar ? recurso.usa(estado) : 0 });
  };
  // Siguientes candidatas de una pieza: las que empiezan tras el relevo (o el
  // desplazamiento si es en otra cabecera) dentro de la amplitud, en dos
  // ventanas: seguido (con la pausa) y partido (hueco largo). Primero las de la
  // misma cabecera (índice por cabecera: no hay que recorrer todas), luego las
  // primeras de otras; como mucho `cuantas` por ventana.
  const porLugar = new Map(); // cabecera → { idx: [pieza], ini: [inicio] } por hora de inicio
  for (const i of orden) {
    const o = piezas[i].o;
    if (!porLugar.has(o)) porLugar.set(o, { idx: [], ini: [] });
    const l = porLugar.get(o); l.idx.push(i); l.ini.push(piezas[i].inicio);
  }
  const desdeEn = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const mm = (lo + hi) >> 1; if (arr[mm] < t) lo = mm + 1; else hi = mm; } return lo; };
  const siguientes = (ultima, primeraInicio, cuantas, trabajo = 0) => {
    const a = piezas[ultima];
    const res = [];
    const cabe = b => b.fin - primeraInicio <= amplitudMax
      // filtro rápido antes de comprobar todas las reglas: se pasaría de la jornada
      && trabajo + (b.fin - b.inicio) + (b.inicio - a.fin < huecoNoPagado ? b.inicio - a.fin : 0) <= jornadaMax;
    // en la misma cabecera desde el mismo minuto: seguir en el mismo autobús no
    // necesita relevo (lo decide valida); en otra, con el desplazamiento
    for (const [desde, hasta] of [[a.fin, a.fin + huecoNoPagado - 1], [a.fin + huecoNoPagado, Math.min(primeraInicio + amplitudMax, a.fin + huecoMax)]]) {
      let puestas = 0;
      const lugar = porLugar.get(a.d);
      if (lugar) {
        for (let k = desdeEn(lugar.ini, desde); k < lugar.idx.length && lugar.ini[k] <= hasta && puestas < cuantas; k++) {
          const j = lugar.idx[k];
          if (cabe(piezas[j])) { res.push(j); puestas++; }
        }
      }
      // otras cabeceras: las primeras que llegan a tiempo (con el desplazamiento)
      let mirados = 0;
      for (let k = desdeEn(inicios, Math.max(desde, a.fin + desplazamiento)); k < n && inicios[k] <= hasta && puestas < cuantas && mirados < cuantas * 8; k++, mirados++) {
        const j = orden[k], b = piezas[j];
        if (b.o === a.d || !cabe(b)) continue;
        res.push(j); puestas++;
      }
    }
    return res;
  };
  for (let x = 0; x < n; x++) {
    const i = orden[x];
    const solo = valida([piezas[i]]);
    anade([i], solo || { trabajo: piezas[i].fin - piezas[i].inicio, sinValidar: true });
    if (maxPiezas < 2) continue;
    const parejas = [];
    if (!solo) continue;
    for (const j of siguientes(i, piezas[i].inicio, porPrimera, solo.trabajo)) {
      const e = extiende(solo, piezas[j], [piezas[i], piezas[j]]);
      if (e) parejas.push([j, e]);
    }
    // las que más llenan el turno primero
    parejas.sort((u, v) => v[1].trabajo - u[1].trabajo);
    for (const [j, e] of parejas.slice(0, porPrimera)) {
      anade([i, j], e);
      if (maxPiezas < 3) continue;
      let hechas = 0;
      for (const k of siguientes(j, piezas[i].inicio, porPareja * 2, e.trabajo)) {
        const e3 = extiende(e, piezas[k], [piezas[i], piezas[j], piezas[k]]);
        if (!e3) continue;
        anade([i, j, k], e3);
        // con piezas cortas un turno completo necesita cuatro
        if (maxPiezas >= 4) {
          let cuartas = 0;
          for (const q of siguientes(k, piezas[i].inicio, porTrio * 2, e3.trabajo)) {
            const e4 = extiende(e3, piezas[q], [piezas[i], piezas[j], piezas[k], piezas[q]]);
            if (e4) { anade([i, j, k, q], e4); if (++cuartas >= porTrio) break; }
          }
        }
        if (++hechas >= porPareja) break;
      }
    }
    if (onProgreso && x % 200 === 0) onProgreso(x / n * 0.4);
  }

  // Estructuras planas para ir rápido
  const m = cols.length;
  const coste_ = new Float64Array(m), ini = new Int32Array(m + 1), tipoCol = new Int16Array(m), usoCol = new Float64Array(m);
  let total = 0;
  for (let j = 0; j < m; j++) { cols[j].e = cols[j].p.flatMap(unidadesDe); coste_[j] = cols[j].c; tipoCol[j] = cols[j].t; usoCol[j] = cols[j].r; ini[j] = total; total += cols[j].e.length; }
  // Recurso de todo el escenario con tope (p. ej. cambios de autobús): otro
  // "precio" w ≥ 0 por unidad que se usa, igual que el de los tipos
  const R = recurso ? recurso.max : Infinity, conR = Number.isFinite(R);
  let w = 0;
  // Máximo de turnos por tipo: un "precio" v_k ≥ 0 por tipo con tope, que sube
  // mientras la solución relajada se pasa del tope (multiplicador de Lagrange)
  const K = topes.length, v = new Float64Array(K), conTope = topes.map(Number.isFinite);
  ini[m] = total;
  const elem = new Int32Array(total);
  for (let j = 0, q = 0; j < m; j++) for (const i of cols[j].e) elem[q++] = i;
  const deLaPieza = Array.from({ length: nU }, () => []);
  for (let j = 0; j < m; j++) for (let q = ini[j]; q < ini[j + 1]; q++) deLaPieza[elem[q]].push(j);

  // 2) Relajación lagrangiana: u_i = "precio" de cubrir la pieza i
  const u = new Float64Array(nU);
  for (let i = 0; i < nU; i++) { let mejor = Infinity; for (const j of deLaPieza[i]) mejor = Math.min(mejor, coste_[j] / (ini[j + 1] - ini[j])); u[i] = mejor; }
  const rc = new Float64Array(m);
  // activa: columnas que se pueden elegir · libre: piezas aún por cubrir (las
  // demás ya las cubren los turnos fijados al refinar). Al principio, todo.
  const activa = new Uint8Array(m).fill(1), libre = new Uint8Array(nU).fill(1);
  const reducidos = () => {
    for (let j = 0; j < m; j++) {
      if (!activa[j]) { rc[j] = Infinity; continue; }
      let s = coste_[j] + (tipoCol[j] >= 0 ? v[tipoCol[j]] : 0) + w * usoCol[j];
      for (let q = ini[j]; q < ini[j + 1]; q++) s -= u[elem[q]];
      rc[j] = s;
    }
  };

  // Heurística: todas las columnas por coste reducido por pieza (de mejor a
  // peor); se coge una si todas sus piezas están libres (partición); las piezas
  // que queden, cada una en su turno de una pieza. Ordenadas por bits (radix):
  // con cientos de miles de columnas, la ordenación normal era lo más lento.
  // `fijo`: los turnos ya fijados (se parte de ellos).
  const clave = new Float64Array(m);
  function construir(fijo) {
    for (let j = 0; j < m; j++) clave[j] = activa[j] ? rc[j] / (ini[j + 1] - ini[j]) : Infinity;
    const cand = ordenPorClave(clave);
    const usada = new Uint8Array(nU), elegidas = [...fijo.elegidas], cuenta = Int32Array.from(fijo.cuenta);
    for (let i = 0; i < nU; i++) usada[i] = libre[i] ? 0 : 1;
    let valor = fijo.valor, gastado = fijo.gastado;
    const coger = (j, forzar = false) => {
      const k = tipoCol[j];
      if (!forzar && k >= 0 && conTope[k] && cuenta[k] >= topes[k]) return; // ese tipo ya está lleno
      if (!forzar && conR && gastado + usoCol[j] > R) return; // se pasaría del tope del recurso
      for (let q = ini[j]; q < ini[j + 1]; q++) if (usada[elem[q]]) return;
      for (let q = ini[j]; q < ini[j + 1]; q++) usada[elem[q]] = 1;
      if (k >= 0) cuenta[k]++;
      gastado += usoCol[j];
      elegidas.push(j); valor += coste_[j];
    };
    for (const j of cand) { if (!activa[j]) break; coger(j); } // las no activas van al final
    for (let i = 0; i < nU; i++) if (!usada[i] && sola[i] >= 0) coger(sola[i], true);
    return { elegidas, valor };
  }

  // Subgradiente sobre lo que queda libre, partiendo de los turnos fijados
  function subgradiente(iters, fijo, progreso) {
    let mejor = null, paso = 2, mejorCota = -Infinity, sinMejora = 0;
    const g = new Float64Array(nU), gv = new Float64Array(K);
    for (let it = 0; it < iters; it++) {
      reducidos();
      // cota inferior y subgradiente: g_i = 1 - columnas elegidas (rc < 0) que cubren i
      let cota = fijo.valor;
      for (let i = 0; i < nU; i++) { g[i] = libre[i]; if (libre[i]) cota += u[i]; }
      for (let k = 0; k < K; k++) { gv[k] = 0; if (conTope[k]) { const queda = topes[k] - fijo.cuenta[k]; cota -= v[k] * queda; gv[k] = -queda; } }
      const quedaR = R - fijo.gastado;
      let gw = conR ? -quedaR : 0;
      if (conR) cota -= w * quedaR;
      for (let j = 0; j < m; j++) if (rc[j] < 0) {
        cota += rc[j];
        for (let q = ini[j]; q < ini[j + 1]; q++) g[elem[q]] -= 1;
        if (tipoCol[j] >= 0) gv[tipoCol[j]] += 1;
        gw += usoCol[j];
      }
      if (cota > mejorCota + 1e-6) { mejorCota = cota; sinMejora = 0; } else if (++sinMejora >= 8) { paso /= 2; sinMejora = 0; }
      if (it % 5 === 0 || it === iters - 1) {
        const s = construir(fijo);
        if (!mejor || s.valor < mejor.valor) mejor = s;
      }
      let norma = 0;
      for (let i = 0; i < nU; i++) norma += g[i] * g[i];
      for (let k = 0; k < K; k++) if (conTope[k] && (v[k] > 0 || gv[k] > 0)) norma += gv[k] * gv[k];
      if (conR && (w > 0 || gw > 0)) norma += gw * gw;
      if (norma === 0 || paso < 1e-4) break;
      const objetivo = mejor ? mejor.valor : cota * 1.1;
      const t = paso * Math.max(objetivo - cota, 1e-6) / norma;
      for (let i = 0; i < nU; i++) if (libre[i]) u[i] = Math.max(u[i] + t * g[i], -1e9);
      for (let k = 0; k < K; k++) if (conTope[k]) v[k] = Math.max(0, v[k] + t * gv[k]);
      if (conR) w = Math.max(0, w + t * gw);
      if (progreso && it % 5 === 0) progreso(it / iters);
    }
    return { mejor: mejor || construir(fijo), cota: mejorCota };
  }

  const vacio = { elegidas: [], valor: 0, cuenta: new Int32Array(K), gastado: 0 };
  const conRondas = rondas > 0 && n > 1;
  const parteInicial = conRondas ? 0.3 : 0.6;
  const primera = subgradiente(iteraciones, vacio, onProgreso && (x => onProgreso(0.4 + parteInicial * x)));
  let mejor = primera.mejor;
  const valorInicial = mejor.valor;

  // 3) Refinar (como Caprara-Fischetti-Toth): se fijan los turnos más claros
  // de la mejor solución (los de menor coste reducido) y se vuelve a resolver
  // solo lo que queda, con su propia relajación. La heurística voraz se
  // equivoca sobre todo al final, con las piezas que sobran; resolviendo de
  // nuevo ese resto con los precios ajustados a él salen turnos más llenos.
  // Cada ronda fija una parte distinta de la mejor solución hasta ahora.
  if (conRondas) {
    const uBase = Float64Array.from(u), vBase = Float64Array.from(v), wBase = w;
    for (let ronda = 0; ronda < rondas; ronda++) {
      const fraccion = FRACCIONES[ronda % FRACCIONES.length];
      u.set(uBase); v.set(vBase); w = wBase;
      activa.fill(1); libre.fill(1);
      reducidos();
      const orden = [...mejor.elegidas].sort((a, b) => rc[a] - rc[b]);
      const fijo = { elegidas: [], valor: 0, cuenta: new Int32Array(K), gastado: 0 };
      let cubiertas = 0;
      for (const j of orden) {
        if (cubiertas >= fraccion * nU) break;
        fijo.elegidas.push(j); fijo.valor += coste_[j]; fijo.gastado += usoCol[j];
        if (tipoCol[j] >= 0) fijo.cuenta[tipoCol[j]]++;
        for (let q = ini[j]; q < ini[j + 1]; q++) libre[elem[q]] = 0;
        cubiertas += ini[j + 1] - ini[j];
      }
      for (let j = 0; j < m; j++) {
        let ok = 1;
        for (let q = ini[j]; q < ini[j + 1]; q++) if (!libre[elem[q]]) { ok = 0; break; }
        activa[j] = ok;
      }
      const r = subgradiente(iteracionesRonda, fijo);
      if (r.mejor.valor < mejor.valor - 1e-9) mejor = r.mejor;
      onProgreso?.(0.4 + parteInicial + (0.6 - parteInicial) * (ronda + 1) / rondas);
    }
  }
  onProgreso?.(1);
  opciones.onInfo?.({ piezas: n, columnas: m, cota: primera.cota, valor: mejor.valor, valorInicial });
  return mejor.elegidas.map(j => cols[j].p.slice());
}

// qué parte de la mejor solución se fija en cada ronda del refinado
const FRACCIONES = [0.3, 0.5, 0.7, 0.4, 0.6, 0.8, 0.2, 0.9];

// Índices ordenados por clave ascendente, por bits (LSD radix de 4 pasadas de
// 8 bits sobre la clave en float32): lineal, mucho más rápido que sort().
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function ordenPorClave(clave) {
  const m = clave.length;
  let k = new Uint32Array(m), idx = new Int32Array(m);
  for (let j = 0; j < m; j++) {
    f32[0] = clave[j];
    const b = u32[0];
    k[j] = b & 0x80000000 ? ~b >>> 0 : (b | 0x80000000) >>> 0; // orden de los float como enteros sin signo
    idx[j] = j;
  }
  let k2 = new Uint32Array(m), idx2 = new Int32Array(m);
  const cuenta = new Int32Array(256);
  for (let desp = 0; desp < 32; desp += 8) {
    cuenta.fill(0);
    for (let j = 0; j < m; j++) cuenta[(k[j] >>> desp) & 255]++;
    for (let c = 0, s = 0; c < 256; c++) { const t = cuenta[c]; cuenta[c] = s; s += t; }
    for (let j = 0; j < m; j++) { const pos = cuenta[(k[j] >>> desp) & 255]++; k2[pos] = k[j]; idx2[pos] = idx[j]; }
    [k, k2] = [k2, k]; [idx, idx2] = [idx2, idx];
  }
  return idx;
}
