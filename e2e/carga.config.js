// Prueba de carga de líneas (e2e/carga-lineas.spec.js): aparte de las pruebas normales.
import base from "./playwright.config.js";
export default { ...base, testMatch: ["carga-lineas.spec.js"], testIgnore: [], timeout: 1_800_000 };
