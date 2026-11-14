// Viajes de varios días (distribución por toda España, p. ej. Gambín): una
// semana de pedidos, camiones de distinto tamaño (palés) que se cargan una
// vez en la base, viajes que duran días durmiendo fuera, con la UE 561/2006
// y los horarios de recepción de cada cliente. Aparte del motor de rutas
// diarias (vrp-engine.js), que vuelve a la base cada jornada.
//
//  1) paradasDePedidos: los pedidos como paradas (islas, Ceuta y Melilla → su puerto de salida)
//  2) simularViaje: recorre un viaje como un conductor (conducción, pausas, entregas en horario, noches)
//  3) planificarSemana: agrupa en viajes (ahorros + mejora) y los reparte entre los camiones en la semana
//
// Tiempos en minutos desde el lunes a las 00:00 de la semana.

import { haversineKm } from "../vrp-engine.js";

// ── Normativa (UE 561/2006) ───────────────────────────────────────────────
export const NORMA = {
  conduccionDia: 9 * 60,      // conducción diaria
  tramoSinPausa: 4.5 * 60,    // conducción seguida antes de una pausa
  pausa: 45,                  // pausa
  descansoDiario: 11 * 60,    // descanso entre jornadas (se duerme fuera)
  amplitud: 13 * 60,          // de empezar la jornada a acabarla (24 h − 11 h de descanso)
  conduccionSemana: 56 * 60,  // conducción semanal
};

export const PARAMS = {
  base: { lat: 37.9922, lng: -1.1307, nombre: "Base (Murcia)" },
  horaSalida: 6 * 60,          // los camiones salen de la base a esta hora
  diasSemana: 5,               // lunes a viernes
  finSemana: 4 * 1440 + 22 * 60, // el viernes a las 22:00 todos en la base
  maxDiasViaje: 5,
  rodeo: 1.22,                 // km de carretera por km en línea recta (trayectos largos en España)
  kmh: 72,                     // velocidad media de un camión en ruta (autovía, nacionales, entradas a ciudades)
  servicioBase: 15,            // minutos por entrega…
  servicioPorPalet: 4,         // …más por palé descargado
  ventana: { desde: 8 * 60, hasta: 18 * 60 }, // horario de recepción si el pedido no trae otro
  costeKm: 0.9, costeHora: 22, dietaNoche: 55,
  segundosMejora: 2,
};

// ── Islas, Ceuta y Melilla: se entrega en el puerto de salida ─────────────
export const PUERTOS = {
  baleares: { nombre: "Puerto de Valencia (naviera a Baleares)", lat: 39.4446, lng: -0.3165 },
  canarias: { nombre: "Puerto de Cádiz (naviera a Canarias)", lat: 36.5350, lng: -6.2850 },
  ceuta: { nombre: "Puerto de Algeciras (naviera a Ceuta)", lat: 36.1306, lng: -5.4389 },
  melilla: { nombre: "Puerto de Almería (naviera a Melilla)", lat: 36.8331, lng: -2.4720 },
};
/** ¿Va por mar? → la zona (baleares, canarias, ceuta, melilla) o null */
export function zonaPorMar(lat, lng) {
  lat = +lat; lng = +lng;
  if (lat < 29.6 && lng < -13) return "canarias";
  if (lat > 38.6 && lat < 40.2 && lng > 1.1 && lng < 4.5) return "baleares";
  if (lat > 35.85 && lat < 35.93 && lng > -5.39 && lng < -5.26) return "ceuta";
  if (lat > 35.25 && lat < 35.33 && lng > -2.99 && lng < -2.89) return "melilla";
  return null;
}

/** Distancia y tiempo por carretera estimados entre dos puntos */
export function tramo(a, b, p = PARAMS) {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng) * p.rodeo;
  return { km, min: km < 0.05 ? 0 : km / p.kmh * 60 };
}

const capacidadMax = camiones => Math.max(0, ...camiones.map(c => +c.palets || 0));

/**
 * Los pedidos como paradas: uno por pedido (partido en cargas si no cabe ni en el camión más grande);
 * los que van por mar, juntos en una parada por puerto.
 * → { paradas: [{ id, nombre, lat, lng, palets, pedidos: [ids], servicio, ventana, puerto? }], fuera: [{ pedidoId, motivo }] }
 */
export function paradasDePedidos(pedidos, camiones, p = PARAMS) {
  const cap = capacidadMax(camiones);
  const paradas = [], fuera = [], porPuerto = new Map();
  for (const o of pedidos) {
    const palets = Math.max(0, +o.palets || 0);
    if (!Number.isFinite(+o.lat) || !Number.isFinite(+o.lng)) { fuera.push({ pedidoId: o.id, motivo: "sin dirección situada en el mapa" }); continue; }
    if (!palets) { fuera.push({ pedidoId: o.id, motivo: "sin palés" }); continue; }
    const zona = zonaPorMar(o.lat, o.lng);
    if (zona) {
      const pu = porPuerto.get(zona) || { id: `puerto-${zona}`, nombre: PUERTOS[zona].nombre, lat: PUERTOS[zona].lat, lng: PUERTOS[zona].lng, palets: 0, pedidos: [], puerto: zona, ventana: { desde: 7 * 60, hasta: 20 * 60 } };
      pu.palets += palets; pu.pedidos.push(o.id);
      porPuerto.set(zona, pu);
      continue;
    }
    const ventana = o.ventana?.desde != null ? o.ventana : p.ventana;
    // un pedido más grande que el camión más grande: en cargas completas
    for (let resto = palets, i = 1; resto > 0; i++) {
      const carga = Math.min(resto, cap || resto);
      paradas.push({ id: palets > cap && cap ? `${o.id}#${i}` : o.id, nombre: o.cliente || o.nombre || String(o.id), lat: +o.lat, lng: +o.lng, palets: carga, pedidos: [o.id], ventana });
      resto -= carga;
    }
  }
  // un puerto con más palés de los que caben: en cargas
  for (const pu of porPuerto.values()) {
    for (let resto = pu.palets, i = 1; resto > 0; i++) {
      const carga = Math.min(resto, cap || resto);
      paradas.push({ ...pu, id: pu.palets > cap && cap ? `${pu.id}#${i}` : pu.id, palets: carga });
      resto -= carga;
    }
  }
  for (const s of paradas) s.servicio = p.servicioBase + p.servicioPorPalet * s.palets;
  return { paradas, fuera };
}

// ── Recorrer un viaje como un conductor ───────────────────────────────────
const enDia = t => ({ dia: Math.floor(t / 1440), min: t - Math.floor(t / 1440) * 1440 });
/** El primer momento ≥ t en que se puede empezar a descargar (horario y días de recepción) o null si no hay en la semana */
function inicioEnVentana(t, servicio, v, p) {
  for (let d = enDia(t).dia; d < p.diasSemana; d++) {
    const ini = Math.max(t, d * 1440 + v.desde);
    if (ini + servicio <= d * 1440 + v.hasta) return ini;
  }
  return null;
}

/**
 * Recorre el viaje base → paradas en orden → base, saliendo en `salida`.
 * → { bloques: [{ tipo: "conduccion"|"pausa"|"descanso"|"espera"|"entrega", inicio, fin, km?, lat, lng, paradaId? }],
 *     km, conduccion, inicio, fin, noches, llegadas: { paradaId: inicio de la descarga }, factible, motivo }
 */
export function simularViaje(paradas, salida, p = PARAMS) {
  const bloques = [], llegadas = {};
  let t = salida, dia = 0, seguido = 0, jornada = salida, km = 0, conduccion = 0, noches = 0;
  let aqui = { lat: p.base.lat, lng: p.base.lng };
  const push = b => { if (b.fin > b.inicio) bloques.push(b); };
  const dormir = (lat, lng) => {
    push({ tipo: "descanso", inicio: t, fin: t + NORMA.descansoDiario, lat, lng });
    t += NORMA.descansoDiario; dia = 0; seguido = 0; jornada = t; noches++;
  };
  // conduce de `aqui` a `b` respetando pausas, conducción diaria y amplitud; duerme por el camino si hace falta
  const conducir = b => {
    const { km: k, min } = tramo(aqui, b, p);
    let falta = min, hecho = 0;
    const punto = f => ({ lat: aqui.lat + (b.lat - aqui.lat) * f, lng: aqui.lng + (b.lng - aqui.lng) * f });
    while (falta > 1e-6) {
      if (seguido >= NORMA.tramoSinPausa) {
        const pt = punto(min ? hecho / min : 1);
        push({ tipo: "pausa", inicio: t, fin: t + NORMA.pausa, ...pt }); t += NORMA.pausa; seguido = 0;
      }
      const cabeHoy = Math.min(NORMA.conduccionDia - dia, jornada + NORMA.amplitud - t);
      if (cabeHoy <= 1) { const pt = punto(min ? hecho / min : 1); dormir(pt.lat, pt.lng); continue; }
      const trozo = Math.min(falta, NORMA.tramoSinPausa - seguido, cabeHoy);
      const pt = punto(min ? (hecho + trozo) / min : 1);
      push({ tipo: "conduccion", inicio: t, fin: t + trozo, km: k * (min ? trozo / min : 1), ...pt });
      t += trozo; falta -= trozo; hecho += trozo; dia += trozo; seguido += trozo;
    }
    km += k; conduccion += min; aqui = { lat: b.lat, lng: b.lng };
  };
  for (const s of paradas) {
    conducir(s);
    // descargar dentro del horario; si no da tiempo hoy (horario o amplitud), duerme aquí y descarga mañana
    for (let intento = 0; ; intento++) {
      const ini = inicioEnVentana(t, s.servicio, s.ventana || p.ventana, p);
      if (ini == null) return { bloques, km, conduccion, inicio: salida, fin: t, noches, llegadas, factible: false, motivo: `no llega a ${s.nombre} en horario esta semana` };
      if (ini + s.servicio <= jornada + NORMA.amplitud && (ini - t) < NORMA.descansoDiario) {
        push({ tipo: "espera", inicio: t, fin: ini, lat: s.lat, lng: s.lng, paradaId: s.id });
        t = ini;
        break;
      }
      if (intento > 8) return { bloques, km, conduccion, inicio: salida, fin: t, noches, llegadas, factible: false, motivo: `no encaja la descarga en ${s.nombre}` };
      dormir(s.lat, s.lng); // la noche aquí y se descarga al abrir
    }
    llegadas[s.id] = t;
    push({ tipo: "entrega", inicio: t, fin: t + s.servicio, lat: s.lat, lng: s.lng, paradaId: s.id });
    t += s.servicio;
  }
  conducir(p.base);
  const factible = t <= p.finSemana;
  return { bloques, km, conduccion, inicio: salida, fin: t, noches, llegadas, factible, motivo: factible ? null : "no vuelve a la base antes del fin de semana" };
}

/** Lo que cuesta un viaje: km + horas de trabajo del conductor + dietas */
export function costeViaje(v, p = PARAMS) {
  const trabajo = v.bloques.filter(b => b.tipo !== "descanso").reduce((s, b) => s + (b.fin - b.inicio), 0);
  return v.km * p.costeKm + trabajo / 60 * p.costeHora + v.noches * p.dietaNoche;
}

// ── Agrupar en viajes y repartir la semana ────────────────────────────────
const sumaPalets = ruta => ruta.reduce((s, x) => s + x.palets, 0);

/** El viaje tal como queda saliendo el lunes: para comparar rutas al construirlas (km y si cabe en los días máximos) */
function evaluar(ruta, p) {
  const v = simularViaje(ruta, p.horaSalida, p);
  const ok = v.factible && v.fin - v.inicio <= p.maxDiasViaje * 1440;
  return { v, ok, coste: ok ? costeViaje(v, p) : Infinity };
}

/** Ahorros de Clarke y Wright: juntar dos viajes por sus extremos si cabe en el camión más grande y en los días */
function ahorros(paradas, cap, p) {
  const d0 = paradas.map(s => tramo(p.base, s, p).km);
  const pares = [];
  for (let i = 0; i < paradas.length; i++) for (let j = i + 1; j < paradas.length; j++) {
    const s = d0[i] + d0[j] - tramo(paradas[i], paradas[j], p).km;
    if (s > 0) pares.push([s, i, j]);
  }
  pares.sort((a, b) => b[0] - a[0]);
  const rutaDe = paradas.map((_, i) => i);
  const rutas = new Map(paradas.map((s, i) => [i, [s]]));
  for (const [, i, j] of pares) {
    const ri = rutaDe[i], rj = rutaDe[j];
    if (ri === rj) continue;
    const A = rutas.get(ri), B = rutas.get(rj);
    if (sumaPalets(A) + sumaPalets(B) > cap) continue;
    const si = paradas[i], sj = paradas[j];
    // solo por los extremos: …i + j… (dando la vuelta a una si hace falta)
    const finA = A.at(-1) === si ? A : A[0] === si ? [...A].reverse() : null;
    const iniB = B[0] === sj ? B : B.at(-1) === sj ? [...B].reverse() : null;
    if (!finA || !iniB) continue;
    const unida = [...finA, ...iniB];
    // que el viaje unido quepa en los días (en uno de los dos sentidos)
    const ida = evaluar(unida, p), vuelta = ida.ok ? null : evaluar([...unida].reverse(), p);
    const buena = ida.ok ? unida : vuelta?.ok ? [...unida].reverse() : null;
    if (!buena) continue;
    rutas.set(ri, buena); rutas.delete(rj);
    for (const s of buena) rutaDe[paradas.indexOf(s)] = ri;
  }
  return [...rutas.values()];
}

/** Mejora: dar la vuelta a tramos (2-opt) y mover paradas de un viaje a otro, mientras baje el coste */
function mejorar(rutasIniciales, cap, p) {
  const hasta = Date.now() + (p.segundosMejora ?? 2) * 1000;
  let rutas = rutasIniciales.map(r => [...r]);
  let costes = rutas.map(r => evaluar(r, p).coste);
  let mejoro = true;
  while (mejoro && Date.now() < hasta) {
    mejoro = false;
    // 2-opt dentro de cada viaje
    for (let k = 0; k < rutas.length && Date.now() < hasta; k++) {
      for (let a = 0; a < rutas[k].length - 1; a++) for (let b = a + 1; b < rutas[k].length; b++) {
        const r = rutas[k];
        const nueva = [...r.slice(0, a), ...r.slice(a, b + 1).reverse(), ...r.slice(b + 1)];
        const c = evaluar(nueva, p).coste;
        if (c < costes[k] - 0.5) { rutas[k] = nueva; costes[k] = c; mejoro = true; }
      }
    }
    // mover una parada a otro viaje (o dejar ese viaje vacío)
    for (let k = 0; k < rutas.length && Date.now() < hasta; k++) {
      for (let i = 0; i < rutas[k].length; i++) {
        const s = rutas[k][i];
        const sin = rutas[k].filter((_, x) => x !== i);
        const cSin = sin.length ? evaluar(sin, p).coste : 0;
        let mejor = null;
        for (let m = 0; m < rutas.length; m++) {
          if (m === k || sumaPalets(rutas[m]) + s.palets > cap) continue;
          for (let pos = 0; pos <= rutas[m].length; pos++) {
            const con = [...rutas[m].slice(0, pos), s, ...rutas[m].slice(pos)];
            const c = evaluar(con, p).coste;
            const ganancia = costes[k] + costes[m] - cSin - c;
            if (ganancia > 0.5 && (!mejor || ganancia > mejor.ganancia)) mejor = { m, con, c, ganancia };
          }
        }
        if (mejor) {
          rutas[mejor.m] = mejor.con; costes[mejor.m] = mejor.c;
          rutas[k] = sin; costes[k] = cSin; mejoro = true;
          break;
        }
      }
    }
    const vivas = rutas.map((r, i) => [r, costes[i]]).filter(([r]) => r.length);
    rutas = vivas.map(x => x[0]); costes = vivas.map(x => x[1]);
  }
  return rutas;
}

/**
 * Reparte los viajes entre los camiones a lo largo de la semana: los más cargados primero, al camión
 * libre antes en el que caben (a igualdad, el más pequeño); un camión que vuelve sale otra vez al día
 * siguiente. Respeta la conducción semanal. → { asignados: [{ camion, ruta, v }], sinCamion: [ruta] }
 */
function repartir(rutas, camiones, p, estado) {
  const { libre, conducido } = estado; // cuándo puede salir otra vez cada camión, y lo que lleva conducido
  const asignados = [], sinCamion = [];
  const duracion = new Map(rutas.map(r => [r, evaluar(r, p).v.fin]));
  const orden = [...rutas].sort((a, b) => sumaPalets(b) - sumaPalets(a) || duracion.get(b) - duracion.get(a));
  const porTamano = [...camiones].sort((a, b) => a.palets - b.palets);
  for (const ruta of orden) {
    const pal = sumaPalets(ruta);
    let mejor = null;
    for (const c of porTamano) {
      if (c.palets < pal) continue;
      const v = simularViaje(ruta, libre.get(c.id), p);
      if (!v.factible || conducido.get(c.id) + v.conduccion > NORMA.conduccionSemana) continue;
      if (!mejor || v.fin < mejor.v.fin - 60) mejor = { c, v };
    }
    if (!mejor) { sinCamion.push(ruta); continue; }
    asignados.push({ camion: mejor.c, ruta, v: mejor.v });
    conducido.set(mejor.c.id, conducido.get(mejor.c.id) + mejor.v.conduccion);
    // vuelve a salir al día siguiente a su hora (o tras el descanso diario, si vuelve tarde)
    const fin = mejor.v.fin;
    libre.set(mejor.c.id, Math.max(Math.floor(fin / 1440) * 1440 + 1440 + p.horaSalida, fin + NORMA.descansoDiario));
  }
  return { asignados, sinCamion };
}

/**
 * La semana: pedidos [{ id, cliente, lat, lng, palets, ventana? }] y camiones [{ id, nombre, palets }].
 * opciones: cambia PARAMS (base, horaSalida, diasSemana, finSemana, costes…).
 * → { viajes, sinAsignar: [{ pedidoId, motivo }], resumen }
 */
export function planificarSemana(pedidos, camiones, opciones = {}) {
  const p = { ...PARAMS, ...opciones, base: { ...PARAMS.base, ...(opciones.base || {}) } };
  const t0 = Date.now();
  const flota = camiones.filter(c => +c.palets > 0).map(c => ({ ...c, palets: +c.palets }));
  const cap = capacidadMax(flota);
  const { paradas, fuera } = paradasDePedidos(pedidos, flota, p);
  const sinAsignar = [...fuera];
  // las que ni solas caben en la semana (demasiado lejos para el horario): fuera, con su motivo
  const viables = [];
  for (const s of paradas) {
    const e = evaluar([s], p);
    if (e.ok) viables.push(s);
    else for (const id of s.pedidos) sinAsignar.push({ pedidoId: id, motivo: e.v.motivo || "no cabe en los días de viaje" });
  }
  // agrupar y repartir; lo que no cabe en ningún camión libre se vuelve a agrupar a la medida
  // de los camiones que aún tienen semana (más pequeños), hasta que todo cabe o ya no hay sitio
  const estado = { libre: new Map(flota.map(c => [c.id, p.horaSalida])), conducido: new Map(flota.map(c => [c.id, 0])) };
  const asignados = [];
  let pendientes = viables, capRonda = cap, sinCamion = [];
  for (let ronda = 0; ronda < 6 && pendientes.length; ronda++) {
    const rutas = mejorar(ahorros(pendientes, capRonda, p), capRonda, p);
    const r = repartir(rutas, flota, p, estado);
    asignados.push(...r.asignados);
    sinCamion = r.sinCamion;
    pendientes = sinCamion.flat();
    if (!pendientes.length) break;
    // la próxima ronda, a la medida del camión más grande que aún puede salir esta semana;
    // si con ese tamaño no se colocó nada, más pequeño (viajes más cortos caben en los huecos)
    const conSemana = flota.filter(c => estado.libre.get(c.id) < p.finSemana - 6 * 60).map(c => c.palets);
    if (!conSemana.length) break;
    const mayorLibre = Math.max(...conSemana);
    capRonda = r.asignados.length ? Math.min(capRonda, mayorLibre) : Math.min(mayorLibre, Math.floor(capRonda / 2));
    if (capRonda < 1) break;
  }
  for (const r of sinCamion) for (const s of r) for (const id of s.pedidos) sinAsignar.push({ pedidoId: id, motivo: "no hay camión libre esta semana (faltaría uno más)" });
  const viajes = asignados
    .sort((a, b) => String(a.camion.nombre || a.camion.id).localeCompare(String(b.camion.nombre || b.camion.id)) || a.v.inicio - b.v.inicio)
    .map(({ camion, ruta, v }, i) => ({
      id: `V${i + 1}`, camionId: camion.id, camion: camion.nombre || camion.id, capacidad: camion.palets,
      paradas: ruta.map(s => ({ id: s.id, nombre: s.nombre, lat: s.lat, lng: s.lng, palets: s.palets, pedidos: s.pedidos, puerto: s.puerto || null, llegada: v.llegadas[s.id] })),
      palets: sumaPalets(ruta), ocupacion: sumaPalets(ruta) / camion.palets,
      inicio: v.inicio, fin: v.fin, dias: Math.floor(v.fin / 1440) - Math.floor(v.inicio / 1440) + 1, noches: v.noches,
      km: Math.round(v.km), conduccion: Math.round(v.conduccion), coste: Math.round(costeViaje(v, p)), bloques: v.bloques,
    }));
  const paletsTotal = pedidos.reduce((s, o) => s + Math.max(0, +o.palets || 0), 0);
  const paletsServidos = viajes.reduce((s, v) => s + v.palets, 0);
  return {
    viajes, sinAsignar,
    resumen: {
      viajes: viajes.length, camionesUsados: new Set(viajes.map(v => v.camionId)).size, camiones: flota.length,
      km: viajes.reduce((s, v) => s + v.km, 0), noches: viajes.reduce((s, v) => s + v.noches, 0),
      coste: viajes.reduce((s, v) => s + v.coste, 0), paletsServidos, paletsTotal,
      ocupacionMedia: viajes.length ? viajes.reduce((s, v) => s + v.ocupacion, 0) / viajes.length : 0,
      pedidosSinAsignar: new Set(sinAsignar.map(x => x.pedidoId)).size, ms: Date.now() - t0,
    },
  };
}
