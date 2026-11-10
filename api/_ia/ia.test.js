// Conectar con IA: el recorrido entero (registro de la IA → permiso → claves →
// consultas por MCP → desconectar), con Firebase de mentira en memoria. Las
// reglas de Firestore se prueban aparte (rules-tests/ia.rules.test.js).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aValor, desdeCampos } from "../_salud/google.js";
import mcp, { atender } from "../mcp.js";
import oauth, { claves, nuevoCodigo, registrar } from "../oauth.js";
import { herramientasPara, filaEntrega, resumenRuta } from "./herramientas.js";
import { redireccionValida, pkceValido } from "./claves.js";
import { ahoraEnEspana } from "./entorno.js";

const ENV = { MCP_SECRETO: "x".repeat(40) };
const VUELTA = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFICADOR = "verificador-de-prueba-con-mas-de-cuarenta-y-tres-caracteres-123";
const RETO = createHash("sha256").update(VERIFICADOR).digest("base64url");
const HOY = ahoraEnEspana().fecha;

// ── Firebase de mentira: sesiones y documentos ─────────────────────────────
let docs;
const SESIONES = { "ses-jefe": "jefeA", "ses-cond": "condA" };
function fetchFalso(url, op = {}) {
  const ok = (j, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => j });
  url = String(url);
  if (url.startsWith("https://securetoken.googleapis.com/")) {
    const ses = decodeURIComponent(String(op.body).match(/refresh_token=([^&]+)/)[1]);
    return SESIONES[ses] ? ok({ id_token: `id-${SESIONES[ses]}`, user_id: SESIONES[ses], expires_in: "3600" }) : ok({ error: { message: "TOKEN_EXPIRED" } }, 400);
  }
  if (url.startsWith("https://www.cartociudad.es/")) return ok({ tip_via: "CALLE", address: "MAYOR", portalNumber: 4, muni: "Salamanca" });
  const ruta = url.split("/documents")[1] || "";
  if (ruta.includes(":runQuery")) {
    const padre = ruta.split(":runQuery")[0].replace(/^\//, "");
    const q = JSON.parse(op.body).structuredQuery;
    const ws = q.where ? (q.where.compositeFilter?.filters || [q.where]) : [];
    const col = `${padre ? `${padre}/` : ""}${q.from[0].collectionId}`;
    const vale = (d, w) => {
      const v = JSON.stringify(aValor(d[w.fieldFilter.field.fieldPath]));
      return w.fieldFilter.op === "IN" ? w.fieldFilter.value.arrayValue.values.some(x => JSON.stringify(x) === v) : v === JSON.stringify(w.fieldFilter.value);
    };
    const fila = Object.entries(docs).filter(([k, d]) => k.startsWith(`${col}/`) && k.split("/").length === col.split("/").length + 1 && ws.every(w => vale(d, w)))
      .slice(0, q.limit || 1e9);
    return ok(fila.map(([k, d]) => ({ document: { name: `p/documents/${k}`, fields: Object.fromEntries(Object.entries(d).map(([c, v]) => [c, aValor(v)])) } })));
  }
  const [camino, qs] = ruta.slice(1).split("?");
  if (!op.method || op.method === "GET") {
    const d = docs[camino];
    return d ? ok({ name: `p/documents/${camino}`, fields: Object.fromEntries(Object.entries(d).map(([c, v]) => [c, aValor(v)])) }) : ok({ error: { message: "no" } }, 404);
  }
  if (op.method === "POST") {
    const id = new URLSearchParams(qs || "").get("documentId") || `auto${Object.keys(docs).length}`;
    docs[`${camino}/${id}`] = desdeCampos(JSON.parse(op.body).fields);
    return ok({ name: `p/documents/${camino}/${id}` });
  }
  if (op.method === "PATCH") {
    if (!docs[camino]) return ok({ error: { message: "no existe" } }, 404);
    Object.assign(docs[camino], desdeCampos(JSON.parse(op.body).fields));
    return ok({});
  }
  throw new Error(`fetch inesperado ${url}`);
}
const FIREBASE = { apiKey: "k", projectId: "p" };
const ctx = { firebase: FIREBASE, f: fetchFalso, env: ENV };

beforeEach(() => {
  docs = {
    "usuarios/jefeA": { rol: "intermedio", org_id: "orgA", nombre: "Jefa de tráfico" },
    "usuarios/condA": { rol: "conductor", org_id: "orgA", nombre: "Conductor" },
    "ia_ajustes/orgA": { org_id: "orgA", activa: true, nivel: "leer", roles: ["admin", "intermedio"] },
    "planes/r1": { org_id: "orgA", mes: HOY.slice(0, 7), fecha: HOY, nombre: "Ruta 1", vehiculoNombre: "Camión 1", conductorNombre: "Ana", ubicaciones: [
      { orden: 1, pa: "Bar Sol", calle: "C/ Mayor", num: "1", realizado: true, horaPlan: 480, pedidoId: "p1", pedido: "4471", entrega: { estado: "entregada", recibe: "Luis" } },
      { orden: 2, pa: "Bar Luna", realizado: true, horaPlan: 500, pedidoId: "p2", entrega: { estado: "no_entregada", motivo: "cerrado" } },
      { orden: 3, pa: "Bar Mar", realizado: false, horaPlan: 520 },
    ] },
    "pedidos/p1": { org_id: "orgA", projectId: "pA", fecha: HOY, cliente: { nombre: "Bar Sol", direccion: "C/ Mayor 1", lat: 1, lng: 2 }, ref: "4471", bultos: 3, kg: 40, estado: "pendiente" },
    "pedidos/p2": { org_id: "orgA", projectId: "pA", fecha: HOY, cliente: { nombre: "Bar Luna", direccion: "C/ Luna 2", lat: 1, lng: 2 }, ref: "4472", bultos: 1, kg: 10, estado: "pendiente" },
  };
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubEnv("MCP_SECRETO", ENV.MCP_SECRETO);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const resFalsa = () => {
  const r = { code: 0, body: undefined, h: {} };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.h[k] = v; };
  return r;
};
const llamarMcp = async (token, body) => {
  const res = resFalsa();
  await mcp({ method: "POST", headers: { authorization: token ? `Bearer ${token}` : "", host: "app.operanzia.com" }, body }, res);
  return res;
};
async function conectar(sesion = "ses-jefe", registro = { client_name: "ChatGPT", redirect_uris: [VUELTA] }) {
  const cli = await registrar(registro, ENV);
  const { redirect } = await nuevoCodigo({ sesion, client_id: cli.client_id, redirect_uri: VUELTA, code_challenge: RETO, code_challenge_method: "S256", state: "abc" }, ctx);
  const u = new URL(redirect);
  expect(u.searchParams.get("state")).toBe("abc");
  const t = await claves({ grant_type: "authorization_code", code: u.searchParams.get("code"), code_verifier: VERIFICADOR, redirect_uri: VUELTA, client_id: cli.client_id, client_secret: cli.client_secret }, null, ctx);
  return { cli, t };
}
const conexionUnica = () => Object.entries(docs).find(([k]) => k.startsWith("ia_conexiones/"));

describe("inicio de sesión (OAuth)", () => {
  it("registro, permiso y claves: la conexión queda apuntada", async () => {
    const { t } = await conectar();
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "operanzia.leer" });
    const [, c] = conexionUnica();
    expect(c).toMatchObject({ org_id: "orgA", uid: "jefeA", cliente: "ChatGPT", nivel: "leer", activa: true });
  });
  it("PKCE, dirección de vuelta y código de otra IA: rechazados", async () => {
    const cli = await registrar({ client_name: "X", redirect_uris: [VUELTA] }, ENV);
    await expect(nuevoCodigo({ sesion: "ses-jefe", client_id: cli.client_id, redirect_uri: "https://malo.com/cb", code_challenge: RETO }, ctx)).rejects.toThrow(/vuelta/);
    const { redirect } = await nuevoCodigo({ sesion: "ses-jefe", client_id: cli.client_id, redirect_uri: VUELTA, code_challenge: RETO }, ctx);
    const code = new URL(redirect).searchParams.get("code");
    await expect(claves({ grant_type: "authorization_code", code, code_verifier: "otro", client_id: cli.client_id }, null, ctx)).rejects.toThrow(/PKCE/);
    const otra = await registrar({ client_name: "Y", redirect_uris: [VUELTA] }, ENV);
    await expect(claves({ grant_type: "authorization_code", code, code_verifier: VERIFICADOR, client_id: otra.client_id }, null, ctx)).rejects.toThrow(/otra IA/);
    await expect(claves({ grant_type: "authorization_code", code: "inventado", code_verifier: VERIFICADOR, client_id: cli.client_id }, null, ctx)).rejects.toThrow(/caducada/);
  });
  it("IA con contraseña (ChatGPT): sin ella o mal, no; por Basic, sí", async () => {
    const reg = { client_name: "ChatGPT", redirect_uris: [VUELTA], token_endpoint_auth_method: "client_secret_basic" };
    const { cli, t } = await conectar("ses-jefe", reg);
    expect(cli.client_secret).toBeTruthy();
    await expect(claves({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: cli.client_id }, null, ctx)).rejects.toThrow(/Contraseña/);
    const basic = `Basic ${Buffer.from(`${cli.client_id}:${cli.client_secret}`).toString("base64")}`;
    await expect(claves({ grant_type: "refresh_token", refresh_token: t.refresh_token }, basic, ctx)).resolves.toMatchObject({ token_type: "Bearer" });
  });
  it("sin permiso de la empresa no se conecta: rol no permitido o desactivado", async () => {
    const cli = await registrar({ client_name: "X", redirect_uris: [VUELTA] }, ENV);
    const p = { client_id: cli.client_id, redirect_uri: VUELTA, code_challenge: RETO };
    await expect(nuevoCodigo({ ...p, sesion: "ses-cond" }, ctx)).rejects.toThrow(/tipo de usuario/);
    docs["ia_ajustes/orgA"].activa = false;
    await expect(nuevoCodigo({ ...p, sesion: "ses-jefe" }, ctx)).rejects.toThrow(/no tiene activado/);
    await expect(nuevoCodigo({ ...p, sesion: "ses-caducada" }, ctx)).rejects.toThrow(/ya no es válida/);
  });
  it("direcciones de vuelta: https o el propio ordenador", () => {
    expect(redireccionValida("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redireccionValida("http://localhost:6274/oauth/callback")).toBe(true);
    expect(redireccionValida("http://malo.com/cb")).toBe(false);
    expect(redireccionValida("https://a.com/cb#x")).toBe(false);
    expect(pkceValido(VERIFICADOR, RETO)).toBe(true);
    expect(pkceValido("x", RETO)).toBe(false);
  });
  it("los metadatos y el registro por HTTP", async () => {
    const res = resFalsa();
    await oauth({ method: "GET", query: { accion: "meta-as" }, headers: { host: "app.operanzia.com" } }, res);
    expect(res.body).toMatchObject({ issuer: "https://app.operanzia.com", authorization_endpoint: "https://app.operanzia.com/conectar-ia", code_challenge_methods_supported: ["S256"] });
    const r2 = resFalsa();
    await oauth({ method: "POST", query: { accion: "register" }, headers: { host: "app.operanzia.com" }, body: { redirect_uris: ["http://malo.com/cb"] } }, r2);
    expect(r2.code).toBe(400);
    expect(r2.body.error).toBe("invalid_redirect_uri");
  });
});

describe("MCP", () => {
  it("sin clave: 401 con la dirección del inicio de sesión", async () => {
    const r = await llamarMcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(r.code).toBe(401);
    expect(r.h["WWW-Authenticate"]).toContain('resource_metadata="https://app.operanzia.com/.well-known/oauth-protected-resource"');
    expect((await llamarMcp("inventada", { jsonrpc: "2.0", id: 1, method: "ping" })).code).toBe(401);
  });
  it("initialize, avisos y herramientas según el nivel", async () => {
    const { t } = await conectar();
    const ini = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(ini.body.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "operanzia" } });
    expect((await llamarMcp(t.access_token, { jsonrpc: "2.0", method: "notifications/initialized" })).code).toBe(202);
    const l = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(l.body.result.tools.map(x => x.name)).not.toContain("pasar_no_entregados");
    expect(l.body.result.tools[0]).not.toHaveProperty("ejecutar");
    docs["ia_ajustes/orgA"].nivel = "actuar";
    const l2 = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(l2.body.result.tools.map(x => x.name)).toContain("pasar_no_entregados");
  });
  it("resumen del día, entregas y pedidos con las cuentas de la app", async () => {
    const { t } = await conectar();
    const r = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "resumen_del_dia", arguments: {} } });
    const d = r.body.result.structuredContent;
    expect(d).toMatchObject({ fecha: HOY, rutas: 1, paradas: 3, hechas: 2, no_entregadas: 1 });
    expect(d.detalle[0]).toMatchObject({ vehiculo: "Camión 1", conductor: "Ana", entregadas: 1, no_entregadas: 1, proxima_parada: { orden: 3, hora_prevista: "08:40" } });
    const e = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "entregas", arguments: { estado: "no_entregadas" } } });
    expect(e.body.result.structuredContent.entregas).toEqual([expect.objectContaining({ cliente: "Bar Luna", estado: "no entregada", motivo: expect.any(String) })]);
    const p = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pedidos", arguments: { fecha: HOY } } });
    expect(p.body.result.structuredContent).toMatchObject({ pedidos: 2, bultos: 4, kg: 50 });
    expect(p.body.result.structuredContent.detalle.map(x => x.resultado)).toEqual(["entregado", expect.stringMatching(/^no entregado/)]);
    const mala = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "entregas", arguments: { fecha: "ayer" } } });
    expect(mala.body.result).toMatchObject({ isError: true });
  });
  it("pasar los no entregados: solo si la empresa deja hacer cambios, y una sola vez", async () => {
    const { t } = await conectar();
    const llamar = () => llamarMcp(t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pasar_no_entregados", arguments: { fecha_origen: HOY } } });
    expect((await llamar()).body.result.content[0].text).toMatch(/solo permite consultar/);
    docs["ia_ajustes/orgA"].nivel = "actuar";
    const r = await llamar();
    expect(r.body.result.structuredContent).toMatchObject({ pasados: 1, pedidos: [{ cliente: "Bar Luna", pedido: "4472" }] });
    expect(docs["pedidos/p2"].reprogramadoA).toBeTruthy();
    const nuevos = Object.entries(docs).filter(([k, d]) => k.startsWith("pedidos/") && d.desdePedido === "p2");
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0][1]).toMatchObject({ fecha: docs["pedidos/p2"].reprogramadoA, origen: "reprogramado", creadoPor: { uid: "jefeA" } });
    expect((await llamar()).body.result.structuredContent.pasados).toBe(0);
  });
  it("desconectar: la IA tiene que volver a conectar; si es la empresa la que lo quita, se le explica", async () => {
    const { cli, t } = await conectar();
    docs["ia_ajustes/orgA"].activa = false;
    const r = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vehiculos", arguments: {} } });
    expect(r.body.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/no tiene activado/) }] });
    await expect(claves({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: cli.client_id }, null, ctx)).resolves.toMatchObject({ scope: "operanzia.leer" });
    docs["ia_ajustes/orgA"].activa = true;
    conexionUnica()[1].activa = false;
    const r2 = await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(r2.code).toBe(401);
    expect(r2.h["WWW-Authenticate"]).toContain('error="invalid_token"');
    await expect(claves({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: cli.client_id }, null, ctx)).rejects.toThrow(/desconectado/);
  });
  it("métodos desconocidos y mensajes rotos", async () => {
    expect(await atender({ jsonrpc: "2.0", id: 1, method: "nada" }, async () => ({}))).toMatchObject({ error: { code: -32601 } });
    expect(await atender({ id: 1 }, async () => ({}))).toMatchObject({ error: { code: -32600 } });
  });
});

describe("cuentas de las herramientas", () => {
  it("retraso solo hoy y con la próxima parada ya pasada de hora", () => {
    const p = { nombre: "R", ubicaciones: [{ orden: 1, realizado: false, horaPlan: 600 }] };
    expect(resumenRuta(p, { esHoy: true, minutosAhora: 640 }).retraso_minutos).toBe(40);
    expect(resumenRuta(p, { esHoy: false, minutosAhora: 640 }).retraso_minutos).toBe(0);
    expect(resumenRuta(p, { esHoy: true, minutosAhora: 590 }).retraso_minutos).toBe(0);
  });
  it("una parada sin entrega (recogida) sale como hecha", () => {
    expect(filaEntrega({}, { realizado: true, pa: "Contenedor" }).estado).toBe("hecha");
    expect(herramientasPara("leer").every(h => !h.actuar)).toBe(true);
  });
});

describe("más consultas: personal, ubicación, autobuses, búsqueda libre", () => {
  const MES = HOY.slice(0, 7), D = String(Number(HOY.slice(8, 10)));
  beforeEach(() => {
    const ahora = Date.now();
    Object.assign(docs, {
      "usuarios/condA": { rol: "conductor", org_id: "orgA", nombre: "Carlos" },
      "ubicaciones_activas/condA": { org_id: "orgA", nombre: "Carlos Conductor", lat: 40.96, lng: -5.66, planId: "r1", activo: true, updatedAt: ahora - 2 * 60000, lastMovedAt: ahora - 25 * 60000 },
      "ubicaciones_activas/condB": { org_id: "orgA", nombre: "Clara Conductora", lat: 40.1, lng: -5.1, activo: false, updatedAt: ahora - 3 * 3600000, lastMovedAt: ahora - 3 * 3600000 },
      "ubicaciones_activas/ajeno": { org_id: "orgB", nombre: "Carlos de otra empresa", lat: 1, lng: 1, activo: true, updatedAt: ahora },
      "ubicaciones_lineas/ana": { org_id: "orgA", nombre: "Ana Bus", bus: "12", linea: "L1", servicioId: "s1", turnoId: "T1", retraso: 7, lat: 40.4, lng: -3.7, activo: true, updatedAt: ahora },
      [`cuadrantes/orgA_${MES}_condA`]: { org_id: "orgA", mes: MES, uid: "condA", nombre: "Carlos Conductor", dias: { [D]: { c: "M", s: 360, e: 840, v: "Camión 1" } } },
      [`cuadrantes/orgA_${MES}_condB`]: { org_id: "orgA", mes: MES, uid: "condB", nombre: "Clara Conductora", dias: { [D]: { c: "V" } } },
      "fichajes/f1": { org_id: "orgA", uid: "condA", nombre: "Carlos Conductor", fecha: HOY, horaEntrada: ahora - 60000, horaSalida: null, matricula: "1234ABC", kmRecorridos: null, estado: "abierto" },
      "solicitudes_ausencia/s1": { org_id: "orgA", uid: "condB", nombre: "Clara Conductora", tipo: "vacaciones", desde: HOY, hasta: HOY, dias: 1, estado: "pendiente" },
      "scheduling_workers/w1": { org_id: "orgA", nombre: "Carlos", apellidos: "Conductor", telefono: "600000000", dni: "12345678Z", direccion: "Calle Secreta 1", categoria: "Conductor C" },
      "pesadas/p1": { org_id: "orgA", mes: MES, fecha: HOY, hora: "10:00", vehiculo: "Camión 1", planta: "Planta A", fraccion: "Resto", kg: 1000 },
      "pesadas/p2": { org_id: "orgA", mes: MES, fecha: HOY, hora: "12:00", vehiculo: "Camión 2", planta: "Planta A", fraccion: "Envases", kg: 500.5 },
      "servicio_lineas/s1": { org_id: "orgA", fecha: HOY, proyecto: "Urbano", nombreDia: "Laborable" },
      "servicio_lineas/s1/turnos/T1": { org_id: "orgA", num: 1, inicio: 360, fin: 840, buses: ["12"], lineas: ["L1"], conductorNombre: "Ana Bus", inicioReal: ahora },
      "servicio_lineas/s1/turnos/T2": { org_id: "orgA", num: 2, inicio: 840, fin: 1320, buses: ["14"], lineas: ["L2"], conductorNombre: null },
    });
  });
  const usar = async (t, name, args = {}) => (await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).body.result;
  const nombres = async t => (await llamarMcp(t.access_token, { jsonrpc: "2.0", id: 8, method: "tools/list" })).body.result.tools.map(x => x.name);

  it("dónde está: solo si la empresa lo activa", async () => {
    const { t } = await conectar();
    expect(await nombres(t)).not.toContain("donde_esta");
    expect((await usar(t, "donde_esta", { quien: "carlos" })).content[0].text).toMatch(/no permite preguntar/);
    docs["ia_ajustes/orgA"].ubicacion = true;
    expect(await nombres(t)).toContain("donde_esta");
  });
  it("dónde está: calle, de cuándo, parado y su ruta; fuera de servicio no se enseña; nunca de otra empresa", async () => {
    docs["ia_ajustes/orgA"].ubicacion = true;
    const { t } = await conectar();
    const r = (await usar(t, "donde_esta", { quien: "carlos" })).structuredContent;
    expect(r.encontrados).toBe(1);
    expect(r.posiciones[0]).toMatchObject({ quien: "Carlos Conductor", vehiculo: "Camión 1", en_servicio: true, posicion_hace_min: 2, parado_min: 25, calle: "Calle Mayor 4, Salamanca", ruta: { hechas: 2, paradas: 3, siguiente: { sitio: "Bar Mar", hora_prevista: "08:40" } } });
    expect(r.posiciones[0].mapa).toContain("40.96,-5.66");
    const todos = (await usar(t, "donde_esta")).structuredContent.posiciones;
    expect(todos.map(p => p.quien)).toEqual(["Ana Bus", "Carlos Conductor", "Clara Conductora"]);
    const clara = todos.find(p => p.quien === "Clara Conductora");
    expect(clara).not.toHaveProperty("lat");
    expect(clara.aviso).toMatch(/Fuera de servicio/);
    expect(todos.find(p => p.quien === "Ana Bus")).toMatchObject({ origen: "app de autobús", retraso_min: 7, linea: "L1" });
    const parados = (await usar(t, "donde_esta", { parados_mas_de: 20 })).structuredContent.posiciones;
    expect(parados.map(p => p.quien)).toEqual(["Carlos Conductor"]);
  });
  it("un conductor conectado no ve las consultas de la oficina", async () => {
    docs["ia_ajustes/orgA"].roles = ["admin", "intermedio", "conductor"];
    docs["ia_ajustes/orgA"].ubicacion = true;
    const { t } = await conectar("ses-cond");
    const l = await nombres(t);
    expect(l).toEqual(expect.arrayContaining(["resumen_del_dia", "entregas", "incidencias", "pesadas", "autobuses_del_dia", "buscar_datos"]));
    for (const n of ["donde_esta", "personal_del_dia", "fichajes", "trabajadores", "pedidos", "vehiculos"]) expect(l).not.toContain(n);
    expect((await usar(t, "donde_esta")).content[0].text).toMatch(/solo para la oficina/);
  });
  it("quién trabaja hoy y quién ha fichado", async () => {
    const { t } = await conectar();
    const r = (await usar(t, "personal_del_dia")).structuredContent;
    expect(r.por_turno).toEqual({ Mañana: 1, Vacaciones: 1 });
    expect(r.detalle.find(p => p.nombre === "Carlos Conductor")).toMatchObject({ turno: "Mañana", horario: "06:00-14:00", vehiculo: "Camión 1", fichaje: expect.stringMatching(/^dentro desde/) });
    expect(r.trabajan_sin_fichar).toEqual([]);
    expect((await usar(t, "fichajes")).structuredContent).toMatchObject({ fichajes: 1, dentro_ahora: ["Carlos Conductor"] });
  });
  it("vacaciones pendientes y plantilla (sin DNI ni domicilio)", async () => {
    const { t } = await conectar();
    expect((await usar(t, "ausencias")).structuredContent.solicitudes).toEqual([expect.objectContaining({ nombre: "Clara Conductora", tipo: "vacaciones", estado: "pendiente" })]);
    const w = (await usar(t, "trabajadores", { buscar: "carlos" })).structuredContent.trabajadores[0];
    expect(w).toMatchObject({ nombre: "Carlos Conductor", telefono: "600000000", categoria: "Conductor C" });
    expect(JSON.stringify(w)).not.toMatch(/12345678Z|Secreta/);
  });
  it("pesadas y autobuses del día", async () => {
    const { t } = await conectar();
    expect((await usar(t, "pesadas")).structuredContent).toMatchObject({ pesadas: 2, kg_total: 1500.5, por_vehiculo: { "Camión 1": 1000, "Camión 2": 500.5 }, por_fraccion: { Resto: 1000, Envases: 500.5 } });
    const b = (await usar(t, "autobuses_del_dia")).structuredContent;
    expect(b.detalle[0]).toMatchObject({ proyecto: "Urbano", turnos: 2, sin_conductor: [2], con_retraso: [{ turno: 1, conductor: "Ana Bus", retraso_min: 7 }] });
  });
  it("búsqueda libre: con filtros, solo de su empresa, sin lo privado ni lo pesado", async () => {
    const { t } = await conectar();
    const p = (await usar(t, "buscar_datos", { coleccion: "pedidos", filtros: [{ campo: "ref", valor: "4472" }] })).structuredContent;
    expect(p.encontrados).toBe(1);
    expect(p.documentos[0]).not.toHaveProperty("org_id");
    const pl = (await usar(t, "buscar_datos", { coleccion: "planes" })).structuredContent.documentos[0];
    expect(pl).toMatchObject({ paradas: 3, hechas: 2 });
    expect(pl).not.toHaveProperty("ubicaciones");
    const w = (await usar(t, "buscar_datos", { coleccion: "scheduling_workers" })).structuredContent.documentos[0];
    expect(w).not.toHaveProperty("dni");
    expect((await usar(t, "buscar_datos", { coleccion: "usuarios" })).isError).toBe(true);
  });
});

describe("posiciones", () => {
  it("una app que lleva más de una hora sin mandar posición no cuenta como en servicio ni se enseña", async () => {
    const { posicionParaIA } = await import("./herramientas-mas.js");
    const ahora = Date.now();
    const vieja = posicionParaIA({ nombre: "X", activo: true, lat: 1, lng: 2, hora: ahora - 13 * 24 * 3600000 }, ahora);
    expect(vieja).toMatchObject({ en_servicio: false, aviso: expect.stringMatching(/Fuera de servicio/) });
    expect(vieja).not.toHaveProperty("lat");
    expect(posicionParaIA({ nombre: "Y", activo: false, lat: 1, lng: 2, hora: ahora - 10 * 60000 }, ahora)).toMatchObject({ en_servicio: false, lat: 1 });
    expect(posicionParaIA({ nombre: "Z", activo: true, lat: 1, lng: 2, hora: ahora - 5 * 60000 }, ahora)).toMatchObject({ en_servicio: true, lat: 1 });
  });
});
