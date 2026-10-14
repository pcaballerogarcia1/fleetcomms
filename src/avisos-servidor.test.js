import { describe, it, expect } from "vitest";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { verificarToken, parsePeticion, enviarATodos } from "../api/_avisos/core.js";

const sub = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/x/${n}`, keys: { p256dh: "p", auth: "a" } });

describe("servidor de avisos", () => {
  it("solo acepta tokens de sesión de nuestros proyectos de Firebase", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const claves = createLocalJWKSet({ keys: [jwk] });
    const token = proyecto => new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject("uid1")
      .setIssuer(`https://securetoken.google.com/${proyecto}`).setAudience(proyecto).setIssuedAt().setExpirationTime("1h").sign(privateKey);
    expect(await verificarToken(await token("operanzia-pruebas"), ["fleetcomms-13d89", "operanzia-pruebas"], { claves })).toBe("uid1");
    await expect(verificarToken(await token("otro-proyecto"), ["fleetcomms-13d89"], { claves })).rejects.toMatchObject({ status: 401 });
    await expect(verificarToken("", ["fleetcomms-13d89"], { claves })).rejects.toMatchObject({ status: 401 });
  });
  it("revisa la petición: móviles válidos, título, enlace interno y topes", () => {
    expect(parsePeticion({ subs: [], titulo: "x" }).error).toMatch(/móviles/);
    expect(parsePeticion({ subs: [sub()], titulo: " " }).error).toMatch(/título/);
    expect(parsePeticion({ subs: Array.from({ length: 501 }, (_, i) => sub(i)), titulo: "x" }).error).toMatch(/500/);
    const p = parsePeticion(JSON.stringify({ subs: [sub(), { endpoint: "http://malo" }], titulo: "Ruta nueva", cuerpo: "y".repeat(400), url: "https://fuera.com" }));
    expect(p.subs).toHaveLength(1);
    expect(p.mensaje).toMatchObject({ titulo: "Ruta nueva", url: "/rutas" });
    expect(p.mensaje.cuerpo).toHaveLength(300);
  });
  it("envía a todos y separa los móviles caducados", async () => {
    const r = await enviarATodos([sub(1), sub(2), sub(3)], { titulo: "x" }, async s => {
      if (s.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("/3")) throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    expect(r).toEqual({ enviados: 1, fallidos: 2, caducados: [sub(2).endpoint] });
  });
});
