// Control de rutas por puntos: tarjetas de ruta y actividad reciente.
import { memo } from "react";
import { C, mono, timeAgo, userName } from "./datos.js";

// ── PLAN CARD ─────────────────────────────────────────────────────
export const PlanCard = memo(function PlanCard({ plan, selected, onSelect }) {
  const ubs   = plan.ubicaciones || [];
  const total = ubs.length;
  const done  = ubs.filter(u => u.realizado).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  const color = pct === 100 ? C.green : pct > 50 ? C.blue : pct > 0 ? C.orange : C.dim;

  return (
    <div
      onClick={() => onSelect(plan._id === selected ? null : plan._id)}
      style={{
        background: selected ? C.surface2 : C.card,
        border: `1px solid ${selected ? C.blue + "55" : C.border}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
        transition: "all .15s", marginBottom: 8,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.border2; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {plan.nombre || plan.archivo || "Plan"}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            {[plan.turno, plan.diaServicio, plan.mes].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: mono, marginLeft: 8, flexShrink: 0 }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width .5s" }} />
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        {[
          { l: "Total",  v: total,        c: C.muted   },
          { l: "Hechas", v: done,          c: C.green   },
          { l: "Pend.",  v: total - done,  c: total - done > 0 ? C.orange : C.dim },
        ].map(s => (
          <div key={s.l} style={{ fontSize: 10, color: s.c, fontFamily: mono }}>
            <span style={{ fontWeight: 700 }}>{s.v}</span>
            <span style={{ color: C.dim, marginLeft: 3 }}>{s.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── ACTIVITY FEED ─────────────────────────────────────────────────
export function ActivityFeed({ events, usuarios }) {
  if (events.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontSize: 13 }}>
        Sin actividad registrada
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events.map((ev, i) => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: "9px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {ev.calle ? `${ev.calle}${ev.num ? " " + ev.num : ""}` : (ev.pa || `Parada ${ev.orden}`)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                {ev.planNombre}{ev.barri ? ` · ${ev.barri}` : ""}
              </div>
              {ev.nota && (
                <div style={{ fontSize: 10, color: C.dim, marginTop: 3, fontStyle: "italic" }}>"{ev.nota}"</div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>{timeAgo(ev.realizadoEn)}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{userName(ev.realizadoPor, usuarios)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
