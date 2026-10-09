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

/**
 * @param piezas   [{ inicio, fin, o, d }] ordenadas o no
 * @param opciones { valida, extiende, coste, desplazamiento, amplitudMax, huecoNoPagado, jornadaMax,
 *                   porPrimera, porPareja, porTrio, maxPiezas = 4, iteraciones = 120, onProgreso, onInfo }
 */
export function particionTurnos(piezas, opciones) {
  const { valida, extiende = (e, pz, lista) => valida(lista), coste, desplazamiento = 20, amplitudMax = 540, huecoNoPagado = 60, jornadaMax = Infinity,
    huecoMax = Infinity, tipoDe = null, topes = [],
    porPrimera = 16, porPareja = 5, porTrio = 2, iteraciones = 120, onProgreso, maxPiezas = 4 } = opciones;
  const n = piezas.length;
  if (!n) return [];
  const orden = [...piezas.keys()].sort((a, b) => piezas[a].inicio - piezas[b].inicio);
  const inicios = orden.map(i => piezas[i].inicio);

  // 1) Columnas: turnos posibles
  const cols = []; // { p: [índices], c: coste }
  const sola = new Int32Array(n); // columna de la pieza sola (siempre existe: así toda pieza se puede cubrir)
  const anade = (lista, estado) => {
    if (lista.length === 1) sola[lista[0]] = cols.length;
    cols.push({ p: lista, c: coste(estado, lista.map(i => piezas[i])), t: tipoDe && !estado.sinValidar ? tipoDe(estado) : -1 });
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
  const coste_ = new Float64Array(m), ini = new Int32Array(m + 1), tipoCol = new Int16Array(m);
  let total = 0;
  for (let j = 0; j < m; j++) { coste_[j] = cols[j].c; tipoCol[j] = cols[j].t; ini[j] = total; total += cols[j].p.length; }
  // Máximo de turnos por tipo: un "precio" v_k ≥ 0 por tipo con tope, que sube
  // mientras la solución relajada se pasa del tope (multiplicador de Lagrange)
  const K = topes.length, v = new Float64Array(K), conTope = topes.map(Number.isFinite);
  ini[m] = total;
  const elem = new Int32Array(total);
  for (let j = 0, q = 0; j < m; j++) for (const i of cols[j].p) elem[q++] = i;
  const deLaPieza = Array.from({ length: n }, () => []);
  for (let j = 0; j < m; j++) for (let q = ini[j]; q < ini[j + 1]; q++) deLaPieza[elem[q]].push(j);

  // 2) Relajación lagrangiana: u_i = "precio" de cubrir la pieza i
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) { let mejor = Infinity; for (const j of deLaPieza[i]) mejor = Math.min(mejor, coste_[j] / (ini[j + 1] - ini[j])); u[i] = mejor; }
  const rc = new Float64Array(m);
  const reducidos = () => {
    for (let j = 0; j < m; j++) {
      let s = coste_[j] + (tipoCol[j] >= 0 ? v[tipoCol[j]] : 0);
      for (let q = ini[j]; q < ini[j + 1]; q++) s -= u[elem[q]];
      rc[j] = s;
    }
  };

  // Heurística: todas las columnas por coste reducido por pieza (de mejor a
  // peor); se coge una si todas sus piezas están libres (partición); las piezas
  // que queden, cada una en su turno de una pieza. Ordenadas por bits (radix):
  // con cientos de miles de columnas, la ordenación normal era lo más lento.
  const clave = new Float64Array(m);
  function construir() {
    for (let j = 0; j < m; j++) clave[j] = rc[j] / (ini[j + 1] - ini[j]);
    const cand = ordenPorClave(clave);
    const usada = new Uint8Array(n), elegidas = [], cuenta = new Int32Array(K);
    let valor = 0;
    const coger = (j, forzar = false) => {
      const k = tipoCol[j];
      if (!forzar && k >= 0 && conTope[k] && cuenta[k] >= topes[k]) return; // ese tipo ya está lleno
      for (let q = ini[j]; q < ini[j + 1]; q++) if (usada[elem[q]]) return;
      for (let q = ini[j]; q < ini[j + 1]; q++) usada[elem[q]] = 1;
      if (k >= 0) cuenta[k]++;
      elegidas.push(j); valor += coste_[j];
    };
    for (const j of cand) coger(j);
    for (let i = 0; i < n; i++) if (!usada[i]) coger(sola[i], true);
    return { elegidas, valor };
  }

  let mejor = null, paso = 2, mejorCota = -Infinity, sinMejora = 0;
  for (let it = 0; it < iteraciones; it++) {
    reducidos();
    // cota inferior y subgradiente: g_i = 1 - columnas elegidas (rc < 0) que cubren i
    let cota = 0;
    const g = new Float64Array(n).fill(1), gv = new Float64Array(K);
    for (let i = 0; i < n; i++) cota += u[i];
    for (let k = 0; k < K; k++) if (conTope[k]) { cota -= v[k] * topes[k]; gv[k] = -topes[k]; }
    for (let j = 0; j < m; j++) if (rc[j] < 0) {
      cota += rc[j];
      for (let q = ini[j]; q < ini[j + 1]; q++) g[elem[q]] -= 1;
      if (tipoCol[j] >= 0) gv[tipoCol[j]] += 1;
    }
    if (cota > mejorCota + 1e-6) { mejorCota = cota; sinMejora = 0; } else if (++sinMejora >= 8) { paso /= 2; sinMejora = 0; }
    if (it % 5 === 0 || it === iteraciones - 1) {
      const s = construir();
      if (!mejor || s.valor < mejor.valor) mejor = s;
    }
    let norma = 0;
    for (let i = 0; i < n; i++) norma += g[i] * g[i];
    for (let k = 0; k < K; k++) if (conTope[k] && (v[k] > 0 || gv[k] > 0)) norma += gv[k] * gv[k];
    if (norma === 0 || paso < 1e-4) break;
    const objetivo = mejor ? mejor.valor : cota * 1.1;
    const t = paso * Math.max(objetivo - cota, 1e-6) / norma;
    for (let i = 0; i < n; i++) u[i] = Math.max(u[i] + t * g[i], -1e9);
    for (let k = 0; k < K; k++) if (conTope[k]) v[k] = Math.max(0, v[k] + t * gv[k]);
    if (onProgreso && it % 5 === 0) onProgreso(0.4 + 0.6 * it / iteraciones);
  }
  onProgreso?.(1);
  opciones.onInfo?.({ columnas: m, cota: mejorCota, valor: mejor.valor });
  return mejor.elegidas.map(j => Array.from(elem.subarray(ini[j], ini[j + 1])));
}

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
