// Compila la app apuntando a los emuladores de Firebase (dist-e2e/).
//   node e2e/compilar.mjs          → para las pruebas
//   node e2e/compilar.mjs --medir  → además con el medidor de lecturas
import { build } from "vite";

process.env.VITE_EMULADORES = "1";
process.env.VITE_FIREBASE_PROJECT_ID = "demo-operanzia";
process.env.VITE_FIREBASE_API_KEY = "demo";
process.env.VITE_FIREBASE_AUTH_DOMAIN = "demo-operanzia.firebaseapp.com";
if (process.argv.includes("--medir")) process.env.MEDIR = "1";

await build({ build: { outDir: "dist-e2e", emptyOutDir: true }, logLevel: "warn" });
console.log(`dist-e2e/ compilado para los emuladores${process.env.MEDIR ? " (con medidor)" : ""}`);
