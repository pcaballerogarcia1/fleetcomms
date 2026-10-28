// Documentos para los trabajadores (ITs, DPTs…): la oficina los sube en
// Cuadrante → Documentos y cada trabajador los lee en la app y confirma
// «He leído y entendido». Sin almacenamiento de archivos en el plan gratuito
// de Firebase: el PDF va troceado en la base de datos (como el convenio).
//
//   documentos/{id}  { org_id, titulo, categoria, descripcion, version, activo,
//                      paraTodos, paraUids[], archivo: { nombre, tipo, bytes, n, v },
//                      subidoPor, subidoAt }
//   documentos/{id}/trozos/{v}_{i}  { org_id, v, i, data: Bytes }
//   documentos_lecturas/{docId}_{uid}  { org_id, docId, uid, nombre, version, leidoAt }

export const CATEGORIAS = [
  ["IT", "Instrucción técnica (IT)"],
  ["DPT", "Ficha de puesto y riesgos (DPT)"],
  ["otro", "Otro documento"],
];
export const nombreCategoria = c => (CATEGORIAS.find(x => x[0] === c) || [c, c])[1];
export const MAX_BYTES = 10 * 1024 * 1024;
export const TROZO = 900_000; // bytes por trozo (una ficha de Firestore admite < 1 MB)

/** Parte un archivo en trozos de `max` bytes */
export function trocear(bytes, max = TROZO) {
  const out = [];
  for (let i = 0; i < bytes.length; i += max) out.push(bytes.subarray(i, i + max));
  return out.length ? out : [new Uint8Array(0)];
}

/** Junta los trozos en orden */
export function juntar(trozos) {
  const total = trozos.reduce((x, t) => x + t.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const t of trozos) { out.set(t, p); p += t.length; }
  return out;
}

/** ¿Este documento es para este trabajador? */
export const esPara = (d, uid) => !!d?.activo && (d.paraTodos || (d.paraUids || []).includes(uid));

/** ¿Lo ha leído en su versión actual? (una lectura de una versión vieja no vale) */
export const leidoAlDia = (d, lectura) => !!lectura && (lectura.version || 0) >= (d.version || 1);

/**
 * Quién lo ha leído (en su versión actual) y quién no, de los destinatarios.
 * @param usuarios  [{ _id | uid, nombre, apellidos, rol }] de la empresa (solo cuentan los de la app)
 * @param lecturas  [{ docId, uid, version, leidoAt }]
 */
export function estadoLectura(d, usuarios = [], lecturas = []) {
  const destino = usuarios.filter(u => u.rol !== "superadmin" && (d.paraTodos ? u.rol === "conductor" || u.rol === "intermedio" : (d.paraUids || []).includes(u._id || u.uid)));
  const mias = new Map(lecturas.filter(l => l.docId === d.id).map(l => [l.uid, l]));
  const leidos = [], pendientes = [];
  for (const u of destino) {
    const l = mias.get(u._id || u.uid);
    (leidoAlDia(d, l) ? leidos : pendientes).push({ ...u, leidoAt: l?.leidoAt || null });
  }
  return { leidos, pendientes, total: destino.length };
}

/** Los documentos de un trabajador, los pendientes de leer primero */
export function misDocumentos(docs = [], lecturas = [], uid) {
  const mias = new Map(lecturas.filter(l => l.uid === uid).map(l => [l.docId, l]));
  return docs.filter(d => esPara(d, uid))
    .map(d => ({ ...d, leido: leidoAlDia(d, mias.get(d.id)) }))
    .sort((a, b) => (a.leido ? 1 : 0) - (b.leido ? 1 : 0) || (b.subidoAt || 0) - (a.subidoAt || 0));
}

/** Comprueba lo que se va a subir; el texto del problema o null */
export function problemaDocumento({ titulo, categoria, archivo, paraTodos, paraUids }) {
  if (!String(titulo || "").trim()) return "Ponle un título";
  if (!CATEGORIAS.some(c => c[0] === categoria)) return "Elige el tipo de documento";
  if (!archivo) return "Elige el archivo";
  if (archivo.size > MAX_BYTES) return "El archivo pasa de 10 MB";
  if (!/pdf$/i.test(archivo.type || "") && !/\.pdf$/i.test(archivo.name || "")) return "Tiene que ser un PDF";
  if (!paraTodos && !(paraUids || []).length) return "Elige a quién va dirigido";
  return null;
}
