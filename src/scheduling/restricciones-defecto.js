// Restricciones del Scheduling de puntos: cómo vienen (para «en uso» del panel).
export const RESTRICCIONES_DEFECTO = {
  maxShiftMin: 0, maxStops: 0, breakAfter: 240, breakDur: 30,
  startMin: 360, endMin: 1320, days: 1, maxDays: 0, circular: false,
  optimizeWeight: 0, virtualShiftMin: 0, rosterMode: "cuadrante",
  costeHora: null, costeKm: null, sin561: false,
  // mejora de las rutas después del motor (scheduling/mejora-rutas.js): «a fondo» busca 90 s en vez de 6
  optimizarAFondo: false,
  // capacidad del camión y viajes a descargar (scheduling/capacidad.js)
  // ruta maestra semanal con frecuencias (scheduling/frecuencias.js)
  usarFrecuencias: false, diasServicio: "LMXJVS", frecuenciaDefecto: "diaria",
  usarCapacidad: false, llenadoPct: 70, compactacion: 3, litrosPorDefecto: 1000, tiempoDescarga: 20,
};
