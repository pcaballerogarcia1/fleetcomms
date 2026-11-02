// App del conductor · entregar una parada (reparto y distribución):
// «Entregado» con quién lo recibe, su firma y fotos, o «No entregado» con el
// motivo. Se guarda también la hora y dónde estaba el móvil. Funciona sin
// cobertura: la parada va por la cola de cambios (conductor/cola.js) y las
// fotos y la firma por la suya (pruebas.js); todo se envía solo al volver.
import { Camera, Check, ChevronLeft, PackageCheck, PackageX, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C, S } from "../conductor/comun.js";
import { MAX_FOTOS, MOTIVOS, faltaParaConfirmar, franjaTexto, nombreMotivo, queSeEntrega, registroEntrega } from "./datos.js";
import { PanelFirma } from "./firma.jsx";
import { comprimirFoto, guardarPrueba, posicionAhora } from "./pruebas.js";

const hora = t => (t ? new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");

/** Cabecera de la parada: dirección, qué se entrega y la franja */
function CabeceraParada({ ub }) {
  const que = queSeEntrega(ub), franja = franjaTexto(ub.franja);
  return (
    <div style={{ ...S.card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{[ub.calle, ub.num].filter(Boolean).join(" ") || ub.pa}</div>
      {ub.contacto && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{ub.contacto}</div>}
      {que && <div style={{ fontSize: 13, color: C.blueText, marginTop: 6, fontWeight: 600 }}>{que}</div>}
      {franja && <div style={{ fontSize: 12, color: C.amber, marginTop: 4 }}>Entregar {franja}</div>}
      {ub.comentari && <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{ub.comentari}</div>}
    </div>
  );
}

export function PantallaEntrega({ ub, plan, sesion, onConfirmar, onDeshacer, onClose }) {
  const hecha = ub.realizado ? ub.entrega : null;
  const [estado, setEstado] = useState(null); // "entregada" | "no_entregada"
  const [motivo, setMotivo] = useState("");
  const [recibe, setRecibe] = useState(ub.contacto || "");
  const [sinFirma, setSinFirma] = useState(false);
  const [nota, setNota] = useState("");
  const [firma, setFirma] = useState(null); // Blob
  const [fotos, setFotos] = useState([]);   // [{ blob, url }]
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const entradaFoto = useRef(null);
  // las vistas previas de las fotos se liberan al salir de la pantalla
  const vistas = useRef([]);
  useEffect(() => { vistas.current = fotos.map(f => f.url); }, [fotos]);
  useEffect(() => () => vistas.current.forEach(u => URL.revokeObjectURL(u)), []);

  async function anadirFoto(e) {
    const archivos = [...(e.target.files || [])].slice(0, MAX_FOTOS - fotos.length);
    e.target.value = "";
    try {
      const nuevas = [];
      for (const a of archivos) { const blob = await comprimirFoto(a); nuevas.push({ blob, url: URL.createObjectURL(blob) }); }
      setFotos(f => [...f, ...nuevas].slice(0, MAX_FOTOS));
      setAviso("");
    } catch (err) { setAviso(err.message || "No se pudo leer la foto"); }
  }

  const datos = { estado, motivo, recibe, nota, firma: !!firma, sinFirma, fotos: fotos.length };
  const falta = faltaParaConfirmar(datos);

  async function confirmar() {
    if (falta) { setAviso(falta); return; }
    setGuardando(true);
    try {
      const comun = { orgId: sesion.org_id, planId: plan._id, ubicId: ub.id, uid: sesion.uid };
      // primero las fotos y la firma (al móvil: es inmediato, y se envían solas)
      for (let k = 0; k < fotos.length; k++) await guardarPrueba({ ...comun, tipo: "foto", k, blob: fotos[k].blob });
      if (estado === "entregada" && !sinFirma && firma) await guardarPrueba({ ...comun, tipo: "firma", k: 0, blob: firma });
      const pos = await posicionAhora(4000);
      onConfirmar(registroEntrega(datos, pos));
    } catch (err) {
      setAviso(err.message || "No se pudo guardar");
      setGuardando(false);
    }
  }

  const titulo = <div style={{ ...S.header }}>
    <button onClick={onClose} style={{ ...S.btnGhost, fontSize: 12, padding: "5px 10px 5px 6px", display: "inline-flex", alignItems: "center", gap: 2 }}><ChevronLeft size={16} /> Volver</button>
    <div style={{ flex: 1, minWidth: 0, padding: "0 10px", fontSize: 14, fontWeight: 700 }}>Parada {ub.orden}</div>
  </div>;

  // ya hecha: lo que se guardó, y deshacer por si fue un error
  if (hecha) {
    const ok = hecha.estado !== "no_entregada";
    return (
      <div style={{ ...S.page, paddingBottom: 60 }}>
        {titulo}
        <div style={{ padding: "12px 14px" }}>
          <CabeceraParada ub={ub} />
          <div style={{ ...S.card, borderColor: (ok ? C.green : C.red) + "66" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: ok ? C.green : C.red, display: "flex", alignItems: "center", gap: 8 }}>
              {ok ? <PackageCheck size={18} /> : <PackageX size={18} />} {ok ? "Entregado" : "No entregado"} · {hora(hecha.en)}
            </div>
            {ok && hecha.recibe && <div style={{ fontSize: 13, marginTop: 6 }}>{hecha.sinFirma ? "Se deja en" : "Lo recibe"}: <b>{hecha.recibe}</b></div>}
            {!ok && <div style={{ fontSize: 13, marginTop: 6 }}>Motivo: <b>{nombreMotivo(hecha.motivo)}</b></div>}
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              {[hecha.firma && "con firma", hecha.fotos && `${hecha.fotos} ${hecha.fotos === 1 ? "foto" : "fotos"}`, hecha.lat == null && "sin posición GPS"].filter(Boolean).join(" · ")}
            </div>
            {hecha.nota && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{hecha.nota}</div>}
          </div>
          <button onClick={onDeshacer} style={{ ...S.btnGhost, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Undo2 size={15} /> Deshacer (dejarla pendiente)</button>
        </div>
      </div>
    );
  }

  const boton = (val, Icono, texto, color) => (
    <button type="button" onClick={() => { setEstado(val); setAviso(""); }} aria-pressed={estado === val}
      style={{ ...S.btnGhost, flex: 1, padding: "14px 8px", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        borderColor: estado === val ? color : C.border, color: estado === val ? color : C.text, background: estado === val ? color + "1f" : undefined }}>
      <Icono size={18} /> {texto}
    </button>
  );

  return (
    <div style={{ ...S.page, paddingBottom: 110 }}>
      {titulo}
      <div style={{ padding: "12px 14px" }}>
        <CabeceraParada ub={ub} />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {boton("entregada", PackageCheck, "Entregado", C.green)}
          {boton("no_entregada", PackageX, "No entregado", C.red)}
        </div>

        {estado === "no_entregada" && (
          <div style={{ ...S.card }}>
            <label style={S.label}>Motivo</label>
            <div style={{ display: "grid", gap: 6 }}>
              {MOTIVOS.map(([id, txt]) => (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "6px 4px", cursor: "pointer" }}>
                  <input type="radio" name="motivo" checked={motivo === id} onChange={() => { setMotivo(id); setAviso(""); }} /> {txt}
                </label>
              ))}
            </div>
          </div>
        )}

        {estado === "entregada" && (
          <div style={{ ...S.card }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={sinFirma} onChange={e => { setSinFirma(e.target.checked); setRecibe(e.target.checked ? "" : ub.contacto || ""); setAviso(""); }} />
              Nadie puede firmar: se deja en un sitio acordado
            </label>
            <label style={S.label} htmlFor="entrega-recibe">{sinFirma ? "Dónde se deja" : "Quién lo recibe"}</label>
            <input id="entrega-recibe" value={recibe} onChange={e => setRecibe(e.target.value)} placeholder={sinFirma ? "Portería, buzón, almacén…" : "Nombre y apellidos"} style={{ ...S.input, marginBottom: 12 }} />
            {!sinFirma && <><div style={S.label}>Firma</div><PanelFirma onCambio={b => { setFirma(b); setAviso(""); }} /></>}
          </div>
        )}

        {estado && (
          <div style={{ ...S.card }}>
            <div style={{ ...S.label, display: "flex", justifyContent: "space-between" }}><span>Fotos {estado === "entregada" && sinFirma ? "(al menos una)" : "(opcional)"}</span><span style={{ color: C.dim }}>{fotos.length}/{MAX_FOTOS}</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {fotos.map((f, i) => (
                <div key={f.url} style={{ position: "relative" }}>
                  <img src={f.url} alt={`Foto ${i + 1}`} style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                  <button type="button" aria-label={`Quitar la foto ${i + 1}`} onClick={() => { URL.revokeObjectURL(f.url); setFotos(x => x.filter((_, j) => j !== i)); }}
                    style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,.6)", border: "none", borderRadius: 6, color: "#fff", padding: 3, cursor: "pointer", display: "flex" }}><Trash2 size={13} /></button>
                </div>
              ))}
              {fotos.length < MAX_FOTOS && (
                <button type="button" onClick={() => entradaFoto.current?.click()} style={{ ...S.btnGhost, width: 84, height: 84, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11 }}>
                  <Camera size={20} /> Hacer foto
                </button>
              )}
              <input ref={entradaFoto} type="file" accept="image/*" capture="environment" multiple onChange={anadirFoto} style={{ display: "none" }} aria-label="Foto de la entrega" />
            </div>
            <label style={{ ...S.label, marginTop: 12 }} htmlFor="entrega-nota">Nota (opcional)</label>
            <textarea id="entrega-nota" value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder="Algo que deba saber la oficina" style={{ ...S.input, resize: "vertical" }} />
          </div>
        )}

        {aviso && <div role="alert" style={{ color: C.red, fontSize: 13, margin: "4px 2px 10px" }}>{aviso}</div>}
      </div>

      {estado && (
        <div style={{ padding: "0 14px" }}>
          <button onClick={confirmar} disabled={guardando}
            style={{ ...S.btn, width: "100%", padding: 14, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: falta ? 0.6 : 1,
              background: estado === "entregada" ? C.greenDim : C.red + "1f", borderColor: estado === "entregada" ? C.green : C.red, color: estado === "entregada" ? C.green : C.red }}>
            <Check size={18} /> {guardando ? "Guardando…" : estado === "entregada" ? "Confirmar entrega" : "Confirmar: no entregado"}
          </button>
        </div>
      )}
    </div>
  );
}
