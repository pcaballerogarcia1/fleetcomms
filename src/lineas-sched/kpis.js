// Scheduling de líneas · indicadores: autobuses a la vez por hora y KPIs del escenario.



/** Vehículos en servicio a la vez cada 15 minutos (el pico es la flota necesaria) */
export function perfilVehiculos(vehiculos, paso = 15) {
  if (!vehiculos.length) return [];
  const ini = Math.floor(Math.min(...vehiculos.map(v => v.inicio)) / paso) * paso;
  const fin = Math.ceil(Math.max(...vehiculos.map(v => v.fin)) / paso) * paso;
  const n = Math.max(1, (fin - ini) / paso);
  const cuenta = new Int32Array(n + 1);
  for (const v of vehiculos) {
    cuenta[Math.floor((v.inicio - ini) / paso)]++;
    cuenta[Math.min(n, Math.ceil((v.fin - ini) / paso))]--;
  }
  const out = [];
  let c = 0;
  for (let k = 0; k < n; k++) { c += cuenta[k]; out.push({ min: ini + k * paso, vehiculos: c }); }
  return out;
}

export function kpisServicio(viajes, vehiculos, turnosODeNull, autobuses = []) {
  const sinTurnos = turnosODeNull == null;
  const turnos = turnosODeNull || [];
  const kmVacio = vehiculos.reduce((s, v) => s + (v.kmVacio || 0), 0);
  const servicio = viajes.reduce((s, v) => s + (v.arr - v.dep), 0);
  const enLinea = vehiculos.reduce((s, v) => s + (v.fin - v.inicio), 0);
  const pagado = turnos.reduce((s, t) => s + t.trabajo, 0);
  const conduccion = turnos.reduce((s, t) => s + t.conduccion, 0);
  const porTipo = {};
  for (const b of autobuses) porTipo[b.tipo || "sin tipo"] = (porTipo[b.tipo || "sin tipo"] || 0) + 1;
  return {
    viajes: viajes.length,
    bloques: vehiculos.length,
    autobuses: autobuses.length,
    pico: Math.max(0, ...perfilVehiculos(vehiculos).map(x => x.vehiculos)),
    horasServicio: servicio / 60,
    horasVehiculo: enLinea / 60,
    eficiencia: enLinea ? servicio / enLinea : null, // tiempo con viajeros / tiempo del autobús en línea
    km: viajes.reduce((s, v) => s + v.km, 0) + kmVacio, // con los vacíos
    kmVacio,
    vacios: vehiculos.reduce((s, v) => s + v.viajes.filter(x => x.vacio).length, 0),
    turnos: sinTurnos ? null : turnos.length,
    turnosDosPiezas: turnos.filter(t => t.piezas.length >= 2).length, // con relevo (dos o más piezas)
    piezasMedias: turnos.length ? turnos.reduce((s, t) => s + t.piezas.length, 0) / turnos.length : 0,
    turnosPartidos: turnos.filter(t => t.partidos > 0).length,
    turnosConAviso: sinTurnos ? null : turnos.filter(t => t.avisos.length).length,
    turnosPorTipo: turnos.reduce((o, t) => { const k = t.tipoNombre || (t.tipo === null ? "Sin tipo" : null); if (k) o[k] = (o[k] || 0) + 1; return o; }, {}),
    horasPagadas: sinTurnos ? null : pagado / 60,
    eficienciaPersonal: pagado ? conduccion / pagado : null, // conducción / tiempo de trabajo
    porTipo,
  };
}
