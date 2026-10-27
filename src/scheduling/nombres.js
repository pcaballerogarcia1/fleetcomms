// Nombres de los vehículos y conductores que crea el cálculo («Vehículo
// necesario 2», «Conductor necesario 1»…). Se pueden cambiar en Rutas (por
// ejemplo, una matrícula para la demo); los de la organización no, que se
// cambian en su ficha. El nombre se recuerda por su id (estable al volver a
// generar) en constraints.nombresVirtuales.

const idDe = r => r?._id || r?.id;

/** Pone a cada vehículo o conductor del cálculo el nombre que se le dio */
export function ponerNombres(rows, nombres) {
  if (!rows || !nombres) return rows;
  return rows.map(r => (r._virtual && nombres[idDe(r)] ? { ...r, nombre: nombres[idDe(r)], apellidos: "", _renombrado: true } : r));
}

/** El escenario con ese vehículo o conductor renombrado (solo si es del cálculo) */
export function renombrarEnEscenario(schedules, id, nombre) {
  const cambiar = rows => rows?.map(r => (r._virtual && idDe(r) === id
    ? (nombre ? { ...r, nombre, apellidos: "", _renombrado: true } : r)
    : r));
  return { ...schedules, vehicles: cambiar(schedules.vehicles), workers: cambiar(schedules.workers) };
}
