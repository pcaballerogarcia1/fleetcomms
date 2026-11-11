// Qué partes de Operanzia tiene cada empresa. El superadmin las enciende o
// apaga en su panel (orgs/{org}.modulos = { clave: true|false }); lo que no
// está apuntado está encendido, así las empresas de antes siguen igual.
// Y si la empresa está suspendida (orgs/{org}.activo === false), nadie de
// ella entra.

export const MODULOS = [
  { clave: "planning", nombre: "Planificación", detalle: "Mapa de puntos, capas, depots e importar datos", ruta: "/planning" },
  { clave: "scheduling", nombre: "Rutas", detalle: "Escenarios, optimizar rutas y turnos, publicar", ruta: "/scheduling" },
  { clave: "rostering", nombre: "Cuadrante", detalle: "Turnos de la plantilla, salida del día", ruta: "/rostering" },
  { clave: "control", nombre: "Control", detalle: "Seguimiento en vivo de rutas y autobuses", ruta: "/control" },
  { clave: "analytics", nombre: "Análisis", detalle: "Producción, realizado, cierre del mes, pesadas", ruta: "/analytics" },
  { clave: "concursos", nombre: "Concursos", detalle: "Licitaciones: pliegos, cálculo y oferta", ruta: "/concursos" },
];

export const FUNCIONES = [
  { clave: "app_conductor", nombre: "App del conductor", detalle: "Que la plantilla entre en la app del móvil (rutas, turnos, fichar)" },
  { clave: "lineas", nombre: "Líneas regulares (autobuses)", detalle: "Crear proyectos de líneas con horarios y turnos" },
  { clave: "reparto", nombre: "Reparto y pedidos", detalle: "Proyectos de reparto: pedidos, firma y fotos de entrega" },
  { clave: "gps", nombre: "GPS de la flota", detalle: "Conectar el GPS de los vehículos en Control" },
  { clave: "documentos", nombre: "Documentos para la plantilla", detalle: "Subir documentos con confirmación de lectura" },
  { clave: "vacaciones", nombre: "Vacaciones y permisos", detalle: "Solicitudes desde la app y aprobación en el Cuadrante" },
  { clave: "ia", nombre: "Conectar con IA", detalle: "ChatGPT, Claude, Copilot… consultan Operanzia (luego lo activa el admin de la empresa)" },
];

export const TODAS = [...MODULOS, ...FUNCIONES];

/** ¿Tiene la empresa esta parte? (lo no apuntado, sí) */
export const moduloActivo = (empresa, clave) => empresa?.modulos?.[clave] !== false;

/** ¿Está suspendida la empresa? (solo si se marcó así) */
export const empresaSuspendida = empresa => empresa?.activo === false;

/** El módulo de una pantalla de la oficina (null si no es de ninguno: Proyectos, etc.) */
export const moduloDeRuta = ruta => MODULOS.find(m => m.ruta === ruta)?.clave || null;

/** La primera pantalla de un proyecto que la empresa tiene (o Proyectos si ninguna) */
export function primeraRuta(empresa) {
  return MODULOS.find(m => m.clave !== "concursos" && moduloActivo(empresa, m.clave))?.ruta || "/projects";
}

/** Para guardar: todas las claves con su valor (true/false), desde lo marcado */
export const modulosParaGuardar = marcados => Object.fromEntries(TODAS.map(m => [m.clave, marcados[m.clave] !== false]));
