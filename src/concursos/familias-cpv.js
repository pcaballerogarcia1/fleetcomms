// Los tipos de contrato de los sectores de Operanzia, por su CPV, para comparar
// concursos parecidos con las adjudicaciones reales (bajas-referencia.json).
// Manda el CPV principal (el primero) y, dentro de él, el prefijo más largo:
// 90918000 es «Lavado de contenedores» aunque empiece como limpieza (9091).
// tipos: 1 = suministro, 2 = servicios (los de la Plataforma).
// titulo: para los CPV genéricos, solo cuentan si el título habla de eso (sin título, no).
export const FAMILIAS_CPV = [
  { clave: "9051", nombre: "Recogida y transporte de residuos", cpvs: ["9051"], tipos: ["2"] },
  { clave: "9050", nombre: "Residuos (general)", cpvs: ["9050"], tipos: ["2"] },
  { clave: "9052", nombre: "Residuos peligrosos y sanitarios", cpvs: ["9052"], tipos: ["2"] },
  { clave: "9061", nombre: "Limpieza viaria", cpvs: ["9061"], tipos: ["2"] },
  { clave: "9068", nombre: "Limpieza de playas", cpvs: ["9068"], tipos: ["2"] },
  { clave: "90918", nombre: "Lavado de contenedores", cpvs: ["90918"], tipos: ["2"] },
  { clave: "mant-contenedores", nombre: "Mantenimiento y reparación de contenedores", cpvs: ["50514", "50000000", "50800000"], tipos: ["2"], titulo: /contenedor|contenidor|soterrad/i },
  { clave: "sum-contenedores", nombre: "Suministro de contenedores", cpvs: ["34928480", "44613800", "44613700", "34928400", "45233293", "19640000"], tipos: ["1"], titulo: /contenedor|contenidor|cubos?\b|soterrad|papelera/i },
  { clave: "camiones-recogida", nombre: "Camiones de recogida y lavacontenedores", cpvs: ["34144511", "34144512", "34144900", "34144510"], tipos: ["1"] },
  { clave: "9091", nombre: "Limpieza de edificios", cpvs: ["9091"], tipos: ["2"] },
  { clave: "9092", nombre: "Limpieza e higienización", cpvs: ["9092"], tipos: ["2"] },
  { clave: "9090", nombre: "Limpieza (general)", cpvs: ["9090"], tipos: ["2"] },
  { clave: "7731", nombre: "Jardinería", cpvs: ["7731"], tipos: ["2"] },
  { clave: "6011", nombre: "Transporte en autobús", cpvs: ["6011"], tipos: ["2"] },
  { clave: "6013", nombre: "Transporte escolar y especial", cpvs: ["6013"], tipos: ["2"] },
  { clave: "6017", nombre: "Alquiler de autobuses con conductor", cpvs: ["6017"], tipos: ["2"] },
];

/**
 * La familia de un contrato por sus CPV (y, si se sabe, su título y tipo).
 * @param cpvs [código]; opciones { titulo, tipo } (tipo de la Plataforma: "1", "2"…; sin tipo no se mira)
 * @returns la familia de FAMILIAS_CPV o null
 */
export function familiaDeCpv(cpvs, { titulo = null, tipo = null } = {}) {
  const lista = (cpvs || []).map(c => String(c).replace(/\D/g, "")).filter(Boolean);
  const vale = f => (!tipo || f.tipos.includes(String(tipo))) && (!f.titulo || (titulo != null && f.titulo.test(titulo)));
  for (const c of lista) { // el principal primero
    let mejor = null, largo = 0;
    for (const f of FAMILIAS_CPV) for (const p of f.cpvs) if (c.startsWith(p) && p.length > largo && vale(f)) { mejor = f; largo = p.length; }
    if (mejor) return mejor;
  }
  return null;
}
