// Los documentos del trabajador con su estado de lectura, en vivo (app)
import { useEffect, useMemo, useState } from "react";
import { misDocumentos } from "./datos.js";
import { escucharMisDocumentos, escucharMisLecturas } from "./store.js";

/** Los documentos del trabajador con su estado de lectura (en vivo) */
export function useMisDocumentos(sesion) {
  const [docs, setDocs] = useState(null);
  const [lecturas, setLecturas] = useState([]);
  useEffect(() => { if (!sesion?.org_id || !sesion?.uid) return; return escucharMisDocumentos(sesion.org_id, sesion.uid, setDocs); }, [sesion?.org_id, sesion?.uid]);
  useEffect(() => { if (!sesion?.org_id || !sesion?.uid) return; return escucharMisLecturas(sesion.org_id, sesion.uid, setLecturas); }, [sesion?.org_id, sesion?.uid]);
  return useMemo(() => (docs ? misDocumentos(docs, lecturas, sesion?.uid) : null), [docs, lecturas, sesion?.uid]);
}
