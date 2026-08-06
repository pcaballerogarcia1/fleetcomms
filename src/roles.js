// ── Roles ────────────────────────────────────────────────────────
// Los valores de rol guardados en Firestore (usuarios.rol) se quedan como
// están ("conductor"/"admin"/"intermedio"/"superadmin") para no migrar
// datos existentes — este módulo solo centraliza cómo se muestran y qué
// puede ver cada uno, para no repetir la lista en cada archivo que la
// necesita.
export const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Administrador",
  intermedio: "Intermedio",
  conductor: "Field",
};

export function roleLabel(rol) {
  return ROLE_LABELS[rol] || rol;
}

// Roles con acceso al workspace de gestión (Planning/Scheduling/Rostering/
// Control/Analytics, y gestión completa de Rutas) — todo lo que no sea
// Field. superadmin ya tiene acceso total vía las reglas de Firestore
// (match /{document=**}), pero se incluye aquí también para que los
// componentes no tengan que tratarlo como caso aparte.
export const WORKSPACE_ROLES = ["admin", "superadmin", "intermedio"];

export function puedeUsarWorkspace(rol) {
  return WORKSPACE_ROLES.includes(rol);
}

// Dentro del módulo Rutas (App.jsx.jsx): quién puede subir/borrar planes y
// gestionar tareas, no solo verlas.
export function puedeGestionarRutas(rol) {
  return rol === "admin" || rol === "intermedio" || rol === "superadmin";
}

// Qué roles puede asignar cada uno al dar de alta un usuario nuevo desde el
// panel de Usuarios. Intermedio solo puede crear Field (conductores) — ni
// otros Intermedios ni Administradores.
export function rolesAsignablesPor(rol) {
  if (rol === "admin" || rol === "superadmin") return ["conductor", "intermedio", "admin"];
  if (rol === "intermedio") return ["conductor"];
  return [];
}
