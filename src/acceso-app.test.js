import { describe, expect, it } from "vitest";
import { correoDeUsuario, generarClave, rolAppDe, sugerirUsuario, usuarioDeCorreo, usuarioValido } from "./acceso-app.js";
import { puedeGestionar, leerPeticion, actualizarCuenta } from "../api/usuario-clave.js";

describe("acceso a la app del trabajador", () => {
  it("un usuario sin @ se completa con el dominio y se enseña corto", () => {
    expect(correoDeUsuario("  Juan.Perez ")).toBe("juan.perez@usuarios.operanzia.com");
    expect(correoDeUsuario("Ana@Empresa.com.")).toBe("ana@empresa.com");
    expect(usuarioDeCorreo("juan.perez@usuarios.operanzia.com")).toBe("juan.perez");
    expect(usuarioDeCorreo("ana@empresa.com")).toBe("ana@empresa.com");
  });
  it("propone nombre.apellido sin tildes ni eñes", () => {
    expect(sugerirUsuario({ nombre: "José María", apellidos: "Muñoz Pérez" })).toBe("jose.munoz");
    expect(sugerirUsuario({ nombre: "Ángela" })).toBe("angela");
  });
  it("valida el usuario", () => {
    expect(usuarioValido("jose.munoz")).toBe(true);
    expect(usuarioValido("jo")).toBe(false);
    expect(usuarioValido("jose muñoz")).toBe(false);
    expect(usuarioValido("ana@empresa.com")).toBe(true);
  });
  it("la contraseña inventada tiene 8 caracteres", () => {
    const c = generarClave();
    expect(c).toHaveLength(8);
    expect(c).toMatch(/^[A-Z][a-z]{4}[2-9]{3}$/);
  });
  it("un supervisor entra como intermedio solo si lo da de alta un admin", () => {
    expect(rolAppDe({ rol: "supervisor" }, "admin")).toBe("intermedio");
    expect(rolAppDe({ rol: "supervisor" }, "intermedio")).toBe("conductor");
    expect(rolAppDe({ rol: "conductor" }, "admin")).toBe("conductor");
  });
});

describe("/api/usuario-clave", () => {
  it("solo gestiona a los de su empresa (intermedio, solo conductores)", () => {
    expect(puedeGestionar({ rol: "admin", org_id: "a" }, { rol: "conductor", org_id: "a" })).toBe(true);
    expect(puedeGestionar({ rol: "admin", org_id: "a" }, { rol: "conductor", org_id: "b" })).toBe(false);
    expect(puedeGestionar({ rol: "intermedio", org_id: "a" }, { rol: "admin", org_id: "a" })).toBe(false);
    expect(puedeGestionar({ rol: "intermedio", org_id: "a" }, { rol: "conductor", org_id: "a" })).toBe(true);
    expect(puedeGestionar({ rol: "conductor", org_id: "a" }, { rol: "conductor", org_id: "a" })).toBe(false);
    expect(puedeGestionar({ rol: "admin", org_id: "a", activo: false }, { rol: "conductor", org_id: "a" })).toBe(false);
    expect(puedeGestionar({ rol: "superadmin" }, { rol: "admin", org_id: "x" })).toBe(true);
    expect(puedeGestionar({ rol: "admin", org_id: "a" }, null)).toBe(false);
  });
  it("lee la petición y rechaza contraseñas cortas", () => {
    expect(leerPeticion({ uid: "abcdef123", clave: "Secreta1" })).toEqual({ uid: "abcdef123", clave: "Secreta1" });
    expect(leerPeticion('{"uid":"abcdef123","bloquear":true}')).toEqual({ uid: "abcdef123", bloquear: true });
    expect(() => leerPeticion({ uid: "abcdef123", clave: "123" })).toThrow(/6 caracteres/);
    expect(() => leerPeticion({ uid: "abcdef123" })).toThrow();
    expect(() => leerPeticion({ uid: "../x" })).toThrow();
  });
  it("pide a Firebase Auth el cambio como administrador", async () => {
    const llamadas = [];
    const f = async (url, op) => {
      llamadas.push([url, op]);
      if (url.includes("oauth2")) return { ok: true, json: async () => ({ access_token: "T", expires_in: 3600 }) };
      return { ok: true, json: async () => ({}) };
    };
    const { generateKeyPair, exportPKCS8 } = await import("jose");
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const sa = { project_id: "p1", client_email: "x@p1.iam.gserviceaccount.com", private_key: await exportPKCS8(privateKey) };
    await actualizarCuenta(sa, { uid: "abcdef123", clave: "Secreta1" }, f);
    const [url, op] = llamadas.at(-1);
    expect(url).toBe("https://identitytoolkit.googleapis.com/v1/projects/p1/accounts:update");
    expect(JSON.parse(op.body)).toEqual({ localId: "abcdef123", password: "Secreta1" });
    expect(op.headers.Authorization).toBe("Bearer T");
  });
});
