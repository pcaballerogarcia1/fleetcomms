// Panel «Salud» del superadmin: el resumen de los errores registrados
// (error-report.js). Sin React.
import { groupErrors } from "./error-report.js";

const DIA = 86400_000;

/** Resumen de los errores para el panel (puro, se prueba aparte) */
export function resumenSalud(lista, ahora = Date.now()) {
  const errores = lista.filter(e => e.tipo !== "lentitud");
  const lentos = lista.filter(e => e.tipo === "lentitud");
  const ult = (l, ms) => l.filter(e => (e.atMs || 0) >= ahora - ms);
  const contar = (l, f) => { const m = new Map(); for (const e of l) { const k = f(e) || "—"; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  return {
    h24: ult(errores, DIA).length, d7: ult(errores, 7 * DIA).length,
    lentos7: ult(lentos, 7 * DIA).length,
    porOrg: contar(ult(errores, 7 * DIA), e => e.org_id),
    porVersion: contar(ult(errores, 7 * DIA), e => e.version),
    grupos: groupErrors(ult(errores, 7 * DIA)).slice(0, 15),
    lentas: groupErrors(ult(lentos, 7 * DIA)).slice(0, 10),
  };
}

