// Conectar con IA · lo común a la página de permiso (/conectar-ia), la
// ventana de la oficina y el servidor (api/_ia/acceso.js): quién puede, qué
// puede hacer la IA y cómo se conecta cada una.

export const ROLES_POR_DEFECTO = ["admin", "intermedio"];
export const ROLES = [
  ["admin", "Administradores"],
  ["intermedio", "Jefes de tráfico"],
  ["conductor", "Conductores"],
];

/** El nivel que deja la empresa: "actuar" (consultar y hacer cambios) o "leer" (solo consultar) */
export const nivelDe = ajustes => (ajustes?.nivel === "actuar" ? "actuar" : "leer");

/** ¿Deja la empresa usar la IA a este perfil? El motivo si no; null si sí */
export function motivoSinAcceso(perfil, ajustes) {
  if (!perfil) return "Tu usuario no tiene perfil en Operanzia.";
  if (perfil.activo === false) return "Tu usuario está desactivado en Operanzia.";
  if (!perfil.org_id) return "Tu usuario no pertenece a ninguna empresa.";
  if (!ajustes?.activa) return "Tu empresa no tiene activado «Conectar con IA». Pídeselo a un administrador.";
  const roles = Array.isArray(ajustes.roles) ? ajustes.roles : ROLES_POR_DEFECTO;
  if (perfil.rol !== "superadmin" && !roles.includes(perfil.rol)) return "Tu empresa no permite conectar la IA a tu tipo de usuario.";
  return null;
}

/** Lo que podrá hacer la IA, en palabras (para la página de permiso) */
export function loQuePodra(nivel) {
  const l = [
    "Ver cómo van las rutas de cada día (hechas, pendientes, retrasos)",
    "Ver las entregas y no entregas, con su motivo",
    "Ver los pedidos, las incidencias y la flota",
  ];
  if (nivel === "actuar") l.push("Pasar los pedidos no entregados a otro día (te pedirá confirmación)");
  return l;
}

/** Los datos de la petición de la IA (la dirección de /conectar-ia); error si falta algo */
export function leerPeticion(buscar) {
  const q = new URLSearchParams(buscar);
  const p = Object.fromEntries(["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"].map(k => [k, q.get(k) || ""]));
  if (!p.client_id || !p.redirect_uri) return { error: "Falta información de la IA en el enlace. Vuelve a empezar la conexión desde tu IA." };
  if (p.response_type !== "code") return { error: "Esta IA pide un tipo de inicio de sesión que Operanzia no admite." };
  if (!p.code_challenge || (p.code_challenge_method && p.code_challenge_method !== "S256")) return { error: "Esta IA no usa el inicio de sesión seguro (PKCE S256) que pide Operanzia." };
  return { peticion: p };
}

/** La dirección de vuelta a la IA cuando el usuario dice que no */
export function vueltaDenegada(p) {
  const u = new URL(p.redirect_uri);
  u.searchParams.set("error", "access_denied");
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}

/** Cómo se añade la dirección en cada IA (los menús cambian a menudo: lo esencial es pegar la dirección) */
export const PASOS_IA = [
  ["ChatGPT", "Ajustes › Aplicaciones y conectores › Ajustes avanzados: activa el modo desarrollador. Luego «Crear», pega la dirección y elige OAuth."],
  ["Claude", "Ajustes › Conectores › «Añadir conector personalizado», pega la dirección y pulsa «Conectar»."],
  ["Gemini, Copilot, Grok y otras", "En su apartado de conectores, herramientas o MCP, añade un servidor remoto con esta dirección."],
];

/** «hace 5 min», «ayer a las 10:20»… (para la lista de conexiones) */
export function cuando(iso, ahora = Date.now()) {
  const t = Date.parse(iso || "");
  if (!t) return "—";
  const min = Math.round((ahora - t) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}
