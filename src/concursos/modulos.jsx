// Módulos propios de un concurso (además de Planning, Scheduling y Rostering,
// que son los de siempre trabajando en el espacio del concurso):
//  · Cálculo: flota, plantilla real y coste por año y por partida.
//  · Alternativas: varias versiones del servicio, lado a lado.
//  · Documentos: cuadro económico (Excel) y memoria técnica.
//  · Resumen: la foto final de la oferta.
// Por ahora, su ficha y lo que van a hacer; se rellenan por fases.
import { Calculator, ClipboardList, FileText, GitCompareArrows } from "lucide-react";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { C, font } from "../tema.js";
import { ESTADOS, TIPOS_CONCURSO } from "./store.js";

const MODULOS_CONCURSO = [
  { id: "calculo", ruta: "/calculo", nombre: "Cálculo", Icono: Calculator, que: "La flota que hace falta, la plantilla real (conductores de turno más vacaciones, bajas y descansos del convenio) y el coste de cada año del contrato por partidas: personal, vehículos, energía, mantenimiento, gastos generales y beneficio." },
  { id: "alternativas", ruta: "/alternativas", nombre: "Alternativas", Icono: GitCompareArrows, que: "Varias versiones del servicio lado a lado (diésel o eléctrico, 6 o 7 días, frecuencia diaria o en días alternos…) con su flota, su plantilla y su precio, para elegir la que se presenta." },
  { id: "documentos", ruta: "/documentos", nombre: "Documentos", Icono: FileText, que: "El cuadro económico en Excel con la estructura que piden los pliegos y la memoria técnica (dimensionamiento, rutas, turnos y justificación) lista para revisar." },
  { id: "resumen", ruta: "/resumen", nombre: "Resumen", Icono: ClipboardList, que: "La foto final de la oferta: precio anual y total, flota, plantilla, km y las cifras clave de la alternativa elegida." },
];

const euros = n => `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function useConcurso(id) {
  const [c, setC] = useState(null);
  useEffect(() => (id ? onSnapshot(doc(db, "concursos", id), s => setC(s.exists() ? { _id: s.id, ...s.data() } : null), () => setC(null)) : undefined), [id]);
  return c;
}

export function ModuloConcurso({ modulo, concursoId }) {
  const c = useConcurso(concursoId);
  const m = MODULOS_CONCURSO.find(x => x.id === modulo);
  if (!m) return null;
  const est = ESTADOS.find(e => e.id === c?.estado);
  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue }}><m.Icono size={19} /></div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>{m.nombre}</div>
          <div style={{ fontSize: 13, color: C.muted }}>{c?.nombre || "…"}</div>
        </div>
      </div>
      {modulo === "resumen" && c && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "18px 0" }}>
          {[["Organismo", c.organismo || "—"], ["Servicio", TIPOS_CONCURSO.find(t => t.id === c.tipo)?.nombre || "—"], ["Expediente", c.expediente || "—"],
            ["Duración", c.duracionMeses && c.duracionMeses % 12 ? `${c.duracionMeses} meses` : c.duracionAnios ? `${c.duracionAnios} años` : "—"],
            ["Presupuesto sin IVA", c.presupuestoSinIva != null ? euros(c.presupuestoSinIva) : "—"], ["Valor estimado", c.valorEstimado != null ? euros(c.valorEstimado) : "—"],
            ["Presentar antes del", c.fechaLimite ? new Date(`${c.fechaLimite}T12:00:00`).toLocaleDateString("es-ES") : "—"], ["Estado", est?.nombre || "—"]].map(([l, v]) => (
            <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: l === "Estado" ? est?.color || C.text : C.text, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <div className="op-tarjeta" style={{ padding: 20, marginTop: 18, maxWidth: 720 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Qué hará este módulo</div>
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>{m.que}</div>
        <div style={{ fontSize: 12.5, color: C.amber, marginTop: 12 }}>En preparación. Mientras tanto, ya puedes cargar los datos del servicio en Planning, calcular rutas en Scheduling y turnos en Rostering: todo queda dentro de este concurso.</div>
      </div>
    </div>
  );
}
