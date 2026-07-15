// Script para desplegar las reglas de Firestore
// Abre el navegador automaticamente, solo hay que hacer click en "Permitir"

import http from "http";
import { exec } from "child_process";
import { readFileSync } from "fs";

const CLIENT_ID     = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJECT_ID    = "fleetcomms-13d89";
const PORT          = 9005;
const REDIRECT      = `http://localhost:${PORT}`;
const SCOPE         = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase";

const RULES = readFileSync("firestore.rules", "utf8");

async function postForm(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return r.json();
}

async function apiCall(method, url, token, body) {
  const r = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

// Step 1: get auth code via local server
const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get("code");
    const err  = url.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (code) {
      res.end("<h2>Autorizado. Puedes cerrar esta pestana.</h2>");
      server.close();
      resolve(code);
    } else {
      res.end("<h2>Error: " + (err || "desconocido") + "</h2>");
      server.close();
      reject(new Error(err || "auth cancelled"));
    }
  });
  server.listen(PORT, () => {
    const authUrl = `https://accounts.google.com/o/oauth2/auth?` + new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
    });
    console.log("\n=== Desplegando reglas de Firestore ===\n");
    console.log("Abriendo navegador para autorizacion...");
    console.log("(Si no se abre solo, visita: " + authUrl + ")\n");
    exec(`start "" "${authUrl}"`);
  });
  server.on("error", reject);
});

// Step 2: exchange code for token
const t = await postForm("https://oauth2.googleapis.com/token", {
  code,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  redirect_uri: REDIRECT,
  grant_type: "authorization_code",
});

if (!t.access_token) { console.error("Error obteniendo token:", t); process.exit(1); }
console.log("Autorizado! Desplegando reglas...\n");

// Step 3: create ruleset
const rs = await apiCall("POST",
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`,
  t.access_token,
  { source: { files: [{ name: "firestore.rules", content: RULES }] } }
);
if (!rs.ok) { console.error("Error creando ruleset:", rs.body); process.exit(1); }
const rulesetName = JSON.parse(rs.body).name;

// Step 4: update Firestore release — exact format used by firebase-tools internally
const rel = await apiCall("PATCH",
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
  t.access_token,
  { release: { name: `projects/${PROJECT_ID}/releases/cloud.firestore`, rulesetName } }
);
if (!rel.ok) {
  // If release doesn't exist yet, create it
  if (rel.status === 404) {
    const rel2 = await apiCall("POST",
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`,
      t.access_token,
      { name: `projects/${PROJECT_ID}/releases/cloud.firestore`, rulesetName }
    );
    if (!rel2.ok) { console.error("Error creando release:", rel2.body); process.exit(1); }
  } else {
    console.error("Error actualizando release:", rel.body); process.exit(1);
  }
}

console.log("=== REGLAS DESPLEGADAS CORRECTAMENTE ===");
console.log("Ya puedes crear usuarios en app.operanzia.com/superadmin\n");
