// Lo guardado de un concurso, escuchado en vivo, para Cálculo, Alternativas y Resumen
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebase.js";
import { escucharDimension, escucharFicha, escucharRequisito, guardarRequisito } from "./store.js";

export function useDatosConcurso(id) {
  const [concurso, setConcurso] = useState(undefined);
  const [ficha, setFicha] = useState(null);
  const [dim, setDim] = useState(null);
  const [calc, setCalc] = useState(null);
  const [oferta, setOferta] = useState(null);
  useEffect(() => (id ? onSnapshot(doc(db, "concursos", id), s => setConcurso(s.exists() ? { _id: s.id, ...s.data() } : null), () => setConcurso(null)) : undefined), [id]);
  useEffect(() => (id ? escucharFicha(id, setFicha) : undefined), [id]);
  useEffect(() => (id ? escucharDimension(id, setDim) : undefined), [id]);
  useEffect(() => (id ? escucharRequisito(id, "calculo", setCalc) : undefined), [id]);
  useEffect(() => (id ? escucharRequisito(id, "oferta", setOferta) : undefined), [id]);
  return { concurso, ficha, dim, calc, oferta, listo: concurso !== undefined && ficha && dim && calc && oferta };
}

/**
 * Cambios que se guardan solos un momento después del último (como en Planning).
 * @returns [lo guardado + lo pendiente, cambiar(fn(previo) → nuevo pendiente)]
 */
export function useGuardadoDiferido(concursoId, nombre, guardado) {
  const [local, setLocal] = useState(null);
  const tmr = useRef();
  useEffect(() => {
    if (!local) return;
    clearTimeout(tmr.current);
    tmr.current = setTimeout(() => { guardarRequisito(concursoId, nombre, local).then(() => setLocal(null)).catch(e => console.warn(`[${nombre}]`, e)); }, 700);
    return () => clearTimeout(tmr.current);
  }, [local, concursoId, nombre]);
  const mezcla = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) ? mezcla(out[k], v) : v;
    return out;
  };
  return [mezcla(guardado, local), cambio => setLocal(l => mezcla(l, typeof cambio === "function" ? cambio(mezcla(guardado, l)) : cambio))];
}
