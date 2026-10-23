// El sector del proyecto (residuos, contadores, mantenimiento urbano, otros):
// cambia las palabras de las pantallas (contenedor / contador / elemento…) y
// oculta lo que no aplica (pesadas, capacidad del camión, plantas de
// descarga). El motor de rutas, los turnos y el cuadrante son los mismos.
// Sin campo «sector», un proyecto es de residuos (como hasta ahora).
import { useSyncExternalStore } from "react";

export const SECTORES = [
  {
    id: "residuos", nombre: "Residuos y limpieza", detalle: "Contenedores, fracciones, plantas de descarga y pesadas",
    t: { elemento: "contenedor", elementos: "contenedores", Elemento: "Contenedor", Elementos: "Contenedores", tipoElemento: "Tipo de contenedor", categoria: "Fracción", tipoCategoria: "Tipo de fracción", revision: "Lavado", codigo: "código del contenedor" },
    ver: { pesadas: true, capacidad: true, plantas: true, volumen: true },
  },
  {
    id: "contadores", nombre: "Contadores y redes", detalle: "Lectura, cambio e inspección de contadores de agua o gas",
    t: { elemento: "contador", elementos: "contadores", Elemento: "Contador", Elementos: "Contadores", tipoElemento: "Tipo de contador", categoria: "Calibre", tipoCategoria: "Calibre", revision: "Última lectura", codigo: "número de serie del contador" },
    ver: { pesadas: false, capacidad: false, plantas: false, volumen: false },
  },
  {
    id: "mantenimiento", nombre: "Mantenimiento urbano", detalle: "Alumbrado, parques, mobiliario urbano e instalaciones",
    t: { elemento: "elemento", elementos: "elementos", Elemento: "Elemento", Elementos: "Elementos", tipoElemento: "Tipo de elemento", categoria: "Categoría", tipoCategoria: "Categoría", revision: "Última revisión", codigo: "código del elemento" },
    ver: { pesadas: false, capacidad: false, plantas: false, volumen: false },
  },
  {
    id: "otros", nombre: "Otros servicios con rutas", detalle: "Visitas, servicio técnico, reparto",
    t: { elemento: "punto", elementos: "puntos", Elemento: "Punto", Elementos: "Puntos", tipoElemento: "Tipo de punto", categoria: "Categoría", tipoCategoria: "Categoría", revision: "Última visita", codigo: "código del punto" },
    ver: { pesadas: false, capacidad: false, plantas: false, volumen: false },
  },
];

/** El sector de un proyecto (o de un plan publicado): residuos si no dice nada */
export const sectorDe = p => SECTORES.find(s => s.id === (typeof p === "string" ? p : p?.sector)) || SECTORES[0];

// El sector del proyecto abierto, para las pantallas que no reciben el proyecto
let actual = SECTORES[0];
const oyentes = new Set();
export function fijarSector(id) {
  const s = sectorDe(id || null);
  if (s === actual) return;
  actual = s;
  for (const f of oyentes) f();
}
const suscribir = f => { oyentes.add(f); return () => oyentes.delete(f); };
/** El sector del proyecto abierto: { id, nombre, t: palabras, ver: qué se enseña } */
export const useSector = () => useSyncExternalStore(suscribir, () => actual, () => actual);
