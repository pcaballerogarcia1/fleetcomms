// Medidor de lecturas y escrituras por pantalla (npm run medir): la misma
// configuración que las pruebas, solo con e2e/medir.spec.js.
import base from "./playwright.config.js";
export default { ...base, testMatch: ["medir.spec.js"], testIgnore: [], timeout: 600_000 };
