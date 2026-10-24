import { describe, expect, it } from "vitest";
import { correoDeUsuario, generarClave, rolAppDe, sugerirUsuario, usuarioDeCorreo, usuarioValido } from "./acceso-app.js";
import { esCorreoReal } from "./cambio-clave.js";

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

describe("cambiar la contraseña por correo", () => {
  it("solo a un correo de verdad, no a un usuario sin correo", () => {
    expect(esCorreoReal("ana@empresa.com")).toBe(true);
    expect(esCorreoReal("juan.perez@usuarios.operanzia.com")).toBe(false);
    expect(esCorreoReal("juan.perez")).toBe(false);
    expect(esCorreoReal("")).toBe(false);
  });
});
