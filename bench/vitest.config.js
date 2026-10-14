// Banco de pruebas de los motores (npm run bench): no son pruebas de sí/no,
// miden autobuses, turnos, km y tiempos con redes reales. Va aparte de las
// pruebas normales porque tarda minutos.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["bench/**/*.bench.test.js"], testTimeout: 3_600_000, hookTimeout: 3_600_000, pool: "forks" } });
