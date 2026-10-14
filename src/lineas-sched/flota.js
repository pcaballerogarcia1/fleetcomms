// Scheduling de líneas · la flota real (Planning → Flota): cada autobús con su
// matrícula, tipo y autonomía (km). Sirve para dos cosas:
//  · al hacer los autobuses, que ninguna salida de cochera pase de los km que
//    aguanta la flota de ese tipo (si todos los de ese tipo tienen autonomía);
//  · después, poner a cada autobús del escenario un vehículo real: los
//    recorridos más largos, a los de más autonomía. Sin React ni Firebase.

export const flotaDe = cfg => (Array.isArray(cfg?._flota?.lista) ? cfg._flota.lista : []);
const autonomia = b => (Number(b.autonomiaKm) > 0 ? Number(b.autonomiaKm) : Infinity);

/** Km como mucho por salida de cochera según el tipo: { [tipo]: km, "*": km } (Infinity = sin límite) */
export function autonomiaPorTipo(flota) {
  const out = {};
  if (!flota.length) return out;
  const tipos = new Set(flota.map(b => b.tipo || null));
  for (const t of tipos) {
    const de = flota.filter(b => (b.tipo || null) === t);
    // si alguno de ese tipo no tiene límite, los recorridos largos los puede hacer él
    out[t ?? "*sin"] = Math.max(...de.map(autonomia));
  }
  out["*"] = Math.max(...flota.map(autonomia)); // un bloque sin tipo puede ir en cualquiera
  return out;
}
export const limiteKm = (porTipo, tipo) => (tipo != null && porTipo[tipo] != null ? porTipo[tipo] : porTipo["*"] ?? Infinity);

/**
 * Pone un vehículo de la flota a cada autobús del escenario.
 * @param cargaEntreSalidas true: se carga en cochera entre una salida y otra (cuenta la salida más larga); false: solo de noche (cuenta el día entero)
 * @returns { porAutobus: { [id]: { matricula, flotaId, autonomia, necesita, ok } }, faltan, noLlegan, sobran }
 */
export function asignarFlota(vehiculos, autobuses, flota, { cargaEntreSalidas = true } = {}) {
  if (!flota.length) return null;
  const kmBloque = v => v.viajes.reduce((s, x) => s + (x.km || 0), 0);
  const porId = new Map(vehiculos.map(v => [v.id, v]));
  const necesidades = autobuses.map(b => {
    const ks = b.bloques.map(id => porId.get(id)).filter(Boolean).map(kmBloque);
    return { b, necesita: Math.round((cargaEntreSalidas ? Math.max(0, ...ks) : ks.reduce((s, k) => s + k, 0)) * 10) / 10 };
  }).sort((x, y) => y.necesita - x.necesita);
  const libres = [...flota];
  const porAutobus = {};
  let faltan = 0, noLlegan = 0;
  const poner = (b, f, necesita) => {
    libres.splice(libres.indexOf(f), 1);
    const ok = autonomia(f) >= necesita;
    if (!ok) noLlegan++;
    porAutobus[b.id] = { matricula: f.matricula || `#${f.id}`, flotaId: f.id, autonomia: Number(f.autonomiaKm) > 0 ? Number(f.autonomiaKm) : null, necesita, ok };
  };
  const valenPara = b => libres.filter(f => !b.tipo || !f.tipo || f.tipo === b.tipo);
  // 1) los que caben en alguno: del más largo al más corto, cada uno en el que llega con menos sobra
  //    (los de más autonomía se guardan para los largos)
  const pendientes = [];
  for (const x of necesidades) {
    const llegan = valenPara(x.b).filter(f => autonomia(f) >= x.necesita).sort((u, v) => autonomia(u) - autonomia(v));
    if (llegan.length) poner(x.b, llegan[0], x.necesita); else pendientes.push(x);
  }
  // 2) los que no caben en ninguno: con lo que quede (el que más aguante), y con aviso
  for (const { b, necesita } of pendientes) {
    const valen = valenPara(b).sort((u, v) => autonomia(v) - autonomia(u));
    if (valen.length) poner(b, valen[0], necesita);
    else { faltan++; porAutobus[b.id] = { matricula: null, necesita, ok: false }; }
  }
  return { porAutobus, faltan, noLlegan, sobran: libres.length };
}
