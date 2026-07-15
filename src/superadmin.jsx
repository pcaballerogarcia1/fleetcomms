import { useState, useEffect } from "react";
import { db, auth, secondaryAuth, secondaryDb } from "./firebase.js";
import {
  collection, onSnapshot, doc, setDoc, updateDoc,
  serverTimestamp, query, where, getDoc, getDocFromServer, writeBatch, runTransaction,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from "firebase/auth";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  blue: "#5c9bff", blueDim: "#0d2550", blueText: "#b0ccff",
  green: "#34d399", greenDim: "#082a18",
  orange: "#fb923c", red: "#f87171", amber: "#fbbf24",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
};
const font = '"Inter", system-ui, sans-serif';
const mono = '"JetBrains Mono", monospace';

const S = {
  input: {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`, color: C.text,
    padding: "10px 13px", borderRadius: 7, fontSize: 13,
    boxSizing: "border-box", fontFamily: font, outline: "none",
  },
  label: {
    fontSize: 10, color: C.muted, letterSpacing: 1.5,
    textTransform: "uppercase", display: "block", marginBottom: 6,
    fontFamily: font, fontWeight: 500,
  },
  btn: {
    background: C.blueDim, border: `1px solid ${C.blue}44`,
    color: C.blueText, padding: "10px 18px", borderRadius: 7,
    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font,
  },
  btnGhost: {
    background: "none", border: `1px solid ${C.border}`,
    color: C.muted, padding: "7px 14px", borderRadius: 7,
    fontSize: 12, cursor: "pointer", fontFamily: font,
  },
  card: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: "16px", marginBottom: 10,
  },
};

function slugify(str) {
  return str.toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PlanBadge({ plan }) {
  const colors = { basic: C.muted, pro: C.blue, enterprise: C.amber };
  const color = colors[plan] ?? C.dim;
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", borderRadius: 10,
      background: `${color}22`, color,
      border: `1px solid ${color}44`,
      textTransform: "uppercase", letterSpacing: 1,
    }}>{plan ?? "basic"}</span>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
function LoginSA({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pw, setPw]       = useState("");
  const [err, setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!email || !pw) { setErr("Introduce email y contraseña"); return; }
    setLoading(true); setErr("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), pw);
      const snap = await getDocFromServer(doc(db, "usuarios", cred.user.uid));
      if (!snap.exists() || snap.data().rol !== "superadmin") {
        await signOut(auth);
        setErr("Acceso denegado — solo superadmins");
      } else {
        onLogin({ uid: cred.user.uid, ...snap.data() });
      }
    } catch (e) {
      const msgs = {
        "auth/invalid-credential": "Credenciales incorrectas",
        "auth/too-many-requests":  "Demasiados intentos, espera un momento",
      };
      setErr(msgs[e.code] ?? "Error al iniciar sesión");
    }
    setLoading(false);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: font }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Operanzia</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>Panel de Control</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Acceso restringido — superadmin</div>
        </div>
        <div style={S.card}>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email"
              onKeyDown={e => e.key === "Enter" && go()} style={S.input} autoComplete="email" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Contraseña</label>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password"
              onKeyDown={e => e.key === "Enter" && go()} style={S.input} autoComplete="current-password" />
          </div>
          {err && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: C.red, borderRadius: 7, padding: "9px 13px", fontSize: 12, marginBottom: 16 }}>
              ⚠ {err}
            </div>
          )}
          <button onClick={go} disabled={loading} style={{ ...S.btn, width: "100%", padding: 12, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Accediendo…" : "Acceder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DETALLE ORG ───────────────────────────────────────────────────
function OrgDetail({ org, onBack, onUpdate }) {
  const [tab, setTab] = useState("info");
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({
    nombre:       org.nombre,
    max_usuarios: org.max_usuarios,
    plan:         org.plan ?? "basic",
    contacto:     org.contacto ?? "",
    activo:       org.activo,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [showAdd,  setShowAdd]  = useState(false);
  const [addForm,  setAddForm]  = useState({ nombre: "", apellidos: "", email: "", password: "", rol: "admin" });
  const [addErr,   setAddErr]   = useState("");
  const [addBusy,  setAddBusy]  = useState(false);

  useEffect(() => {
    const q = query(collection(db, "usuarios"), where("org_id", "==", org.org_id));
    return onSnapshot(q, snap => {
      setUsuarios(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
    });
  }, [org.org_id]);

  async function guardar() {
    if (!form.nombre.trim()) { setErr("El nombre no puede estar vacío"); return; }
    setSaving(true); setErr("");
    try {
      const updates = {
        nombre:       form.nombre.trim(),
        max_usuarios: parseInt(form.max_usuarios) || 5,
        plan:         form.plan,
        contacto:     form.contacto.trim(),
        activo:       form.activo,
        updatedAt:    serverTimestamp(),
      };
      await updateDoc(doc(db, "orgs", org.org_id), updates);
      onUpdate({ ...org, ...updates });
    } catch (e) { setErr("Error guardando: " + e.message); }
    setSaving(false);
  }

  async function toggleUsuario(u) {
    await updateDoc(doc(db, "usuarios", u._id), { activo: !u.activo });
  }

  const activos = usuarios.filter(u => u.activo).length;

  async function crearUsuario() {
    const { nombre, apellidos, email, password, rol } = addForm;
    if (!nombre.trim() || !email.trim() || !password) { setAddErr("Rellena todos los campos obligatorios."); return; }
    if (password.length < 6) { setAddErr("La contraseña debe tener al menos 6 caracteres."); return; }
    if (activos >= org.max_usuarios) { setAddErr(`Límite alcanzado (${org.max_usuarios} usuarios activos).`); return; }
    const emailNorm = email.trim().toLowerCase();
    if (usuarios.some(u => u.email === emailNorm)) { setAddErr("Ya existe un usuario con ese email en esta organización."); return; }
    setAddBusy(true); setAddErr("");

    const perfil = {
      nombre: nombre.trim(), apellidos: apellidos.trim(),
      email: emailNorm, rol, org_id: org.org_id, activo: true,
      createdAt: serverTimestamp(),
    };

    try {
      let uid;
      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, emailNorm, password);
        uid = cred.user.uid;
      } catch (authErr) {
        if (authErr.code === "auth/email-already-in-use") {
          // Auth account exists but Firestore doc is missing — sign in to get UID
          const cred2 = await signInWithEmailAndPassword(secondaryAuth, emailNorm, password);
          uid = cred2.user.uid;
          // If Firestore doc already exists and is active, abort
          const existing = await getDoc(doc(db, "usuarios", uid));
          if (existing.exists() && existing.data().activo !== false) {
            setAddErr("Este usuario ya existe y tiene perfil. No es necesario recrearlo.");
            await secondaryAuth.signOut().catch(() => {});
            return;
          }
        } else {
          throw authErr;
        }
      }

      await runTransaction(db, async (tx) => {
        tx.set(doc(db, "usuarios", uid), perfil);
      });
      await secondaryAuth.signOut().catch(() => {});
      setShowAdd(false);
      setAddForm({ nombre: "", apellidos: "", email: "", password: "", rol: "admin" });
    } catch (e) {
      await secondaryAuth.signOut().catch(() => {});
      setAddErr(
        e.code === "auth/wrong-password" || e.code === "auth/invalid-credential"
          ? "La cuenta de Auth ya existe con otra contraseña. Ve a Firebase Console → Authentication y elimina el usuario, luego vuelve a crearlo aquí."
          : (e.message || "Error al crear el usuario.")
      );
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: font }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ ...S.btnGhost, padding: "5px 12px" }}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{org.nombre}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{org.org_id}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: activos >= org.max_usuarios ? C.orange : C.green }}>
            {activos}/{org.max_usuarios} usuarios activos
          </span>
          <PlanBadge plan={org.plan} />
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: org.activo ? `${C.green}22` : `${C.red}22`,
            color: org.activo ? C.green : C.red,
            border: `1px solid ${org.activo ? C.green : C.red}44`,
          }}>
            {org.activo ? "Activa" : "Suspendida"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "0 24px", background: C.card }}>
        {[["info", "⚙️ Configuración"], ["usuarios", `👥 Usuarios (${usuarios.length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 13,
            color: tab === k ? C.blueText : C.muted, fontWeight: tab === k ? 600 : 400,
            padding: "10px 16px", borderBottom: `2px solid ${tab === k ? C.blue : "transparent"}`,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: 24, maxWidth: 640 }}>
        {tab === "info" && (
          <>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={S.label}>Nombre de la empresa</label>
                  <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Máximo de usuarios</label>
                  <input value={form.max_usuarios} onChange={e => setForm({ ...form, max_usuarios: e.target.value })} type="number" min="1" style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Plan</label>
                  <select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} style={S.input}>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={S.label}>Email de contacto</label>
                  <input value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} type="email" placeholder="admin@empresa.com" style={S.input} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>Estado de la organización</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[true, false].map(v => (
                    <button key={String(v)} onClick={() => setForm({ ...form, activo: v })} style={{
                      flex: 1, padding: 10, borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: font,
                      background: form.activo === v ? (v ? `${C.green}22` : `${C.red}22`) : "none",
                      border: `1px solid ${form.activo === v ? (v ? C.green : C.red) : C.border}`,
                      color: form.activo === v ? (v ? C.green : C.red) : C.muted,
                    }}>
                      {v ? "✓ Activa" : "✕ Suspendida"}
                    </button>
                  ))}
                </div>
              </div>
              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>⚠ {err}</div>}
              <button onClick={guardar} disabled={saving} style={{ ...S.btn, width: "100%", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
            <div style={{ ...S.card, background: C.surface2 }}>
              <div style={S.label}>Identificador de org (inmutable)</div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.blueText }}>{org.org_id}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
                Este ID vincula todos los datos de esta empresa. No se puede cambiar.
              </div>
            </div>
          </>
        )}

        {tab === "usuarios" && (
          <div>
            {/* Botón añadir usuario */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <button onClick={() => { setShowAdd(true); setAddErr(""); }} style={{
                ...S.btn, display: "flex", alignItems: "center", gap: 6, fontSize: 12,
              }}>
                + Añadir usuario
              </button>
            </div>

            {/* Modal crear usuario */}
            {showAdd && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.7)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{
                  width: 420, background: C.card, borderRadius: 12,
                  border: `1px solid ${C.border2}`, padding: "28px 24px",
                  boxShadow: "0 24px 64px rgba(0,0,0,.6)",
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 20 }}>
                    Nuevo usuario — {org.nombre}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={S.label}>Nombre *</label>
                      <input value={addForm.nombre} onChange={e => setAddForm({ ...addForm, nombre: e.target.value })} style={S.input} placeholder="Ana" />
                    </div>
                    <div>
                      <label style={S.label}>Apellidos</label>
                      <input value={addForm.apellidos} onChange={e => setAddForm({ ...addForm, apellidos: e.target.value })} style={S.input} placeholder="García" />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={S.label}>Email *</label>
                      <input value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} type="email" style={S.input} placeholder="ana@empresa.com" />
                    </div>
                    <div>
                      <label style={S.label}>Contraseña *</label>
                      <input value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} type="password" style={S.input} placeholder="Mín. 6 caracteres" />
                    </div>
                    <div>
                      <label style={S.label}>Rol</label>
                      <select value={addForm.rol} onChange={e => setAddForm({ ...addForm, rol: e.target.value })} style={S.input}>
                        <option value="admin">Admin</option>
                        <option value="user">Usuario</option>
                        <option value="driver">Conductor</option>
                      </select>
                    </div>
                  </div>
                  {addErr && <div style={{ color: C.red, fontSize: 12, marginTop: 12 }}>⚠ {addErr}</div>}
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setShowAdd(false)} disabled={addBusy} style={{ ...S.btnGhost, flex: 1 }}>Cancelar</button>
                    <button onClick={crearUsuario} disabled={addBusy} style={{ ...S.btn, flex: 1, opacity: addBusy ? 0.6 : 1 }}>
                      {addBusy ? "Creando…" : "Crear usuario"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {usuarios.length === 0 && !showAdd && (
              <div style={{ textAlign: "center", padding: "50px 0", color: C.dim }}>
                Sin usuarios — pulsa "Añadir usuario" para crear el primero
              </div>
            )}
            {usuarios.map(u => (
              <div key={u._id} style={{
                ...S.card, opacity: u.activo ? 1 : 0.5,
                borderLeft: `3px solid ${u.activo ? C.green : C.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                    background: C.blueDim, border: `1px solid ${C.blue}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: C.blueText,
                  }}>
                    {((u.nombre?.[0] ?? "") + (u.apellidos?.[0] ?? "")).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                      {u.nombre} {u.apellidos}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {u.email} · <span style={{ color: C.blueText }}>{u.rol}</span>
                    </div>
                  </div>
                  <button onClick={() => toggleUsuario(u)} style={{
                    ...S.btnGhost, fontSize: 11, padding: "5px 12px",
                    color:       u.activo ? C.green : C.muted,
                    borderColor: u.activo ? `${C.green}44` : C.border,
                  }}>
                    {u.activo ? "Activo" : "Inactivo"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PANEL PRINCIPAL ───────────────────────────────────────────────
function SuperAdminPanel({ sesion }) {
  const [orgs, setOrgs]             = useState([]);
  const [userCounts, setUserCounts] = useState({});
  const [orgActiva, setOrgActiva]   = useState(null);
  const [showCrear, setShowCrear]   = useState(false);
  const [form, setForm]             = useState({ nombre: "", max_usuarios: 5, plan: "basic", contacto: "" });
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState("");

  useEffect(() => {
    return onSnapshot(
      collection(db, "orgs"),
      snap => { setOrgs(snap.docs.map(d => ({ org_id: d.id, ...d.data() }))); },
      err  => { setErr("ERROR LEYENDO ORGS: " + err.code + " — " + err.message); }
    );
  }, []);

  // Contar usuarios activos por org en tiempo real
  useEffect(() => {
    if (orgs.length === 0) return;
    const unsubs = orgs.map(org => {
      const q = query(
        collection(db, "usuarios"),
        where("org_id", "==", org.org_id),
        where("activo", "==", true),
      );
      return onSnapshot(q, snap => {
        setUserCounts(prev => ({ ...prev, [org.org_id]: snap.size }));
      });
    });
    return () => unsubs.forEach(u => u());
  }, [orgs.length]);

  async function crearOrg() {
    if (!form.nombre.trim()) { setErr("El nombre es obligatorio"); return; }
    const slug = slugify(form.nombre);
    if (!slug) { setErr("Nombre inválido para generar ID"); return; }
    setSaving(true); setErr("");
    try {
      await runTransaction(db, async (tx) => {
        tx.set(doc(db, "orgs", slug), {
          nombre:       form.nombre.trim(),
          org_id:       slug,
          activo:       true,
          max_usuarios: parseInt(form.max_usuarios) || 5,
          plan:         form.plan,
          contacto:     form.contacto.trim(),
          createdAt:    serverTimestamp(),
        });
      });
      setForm({ nombre: "", max_usuarios: 5, plan: "basic", contacto: "" });
      setShowCrear(false);
    } catch (e) {
      setErr(
        (e.code === "permission-denied" || (e.message||"").includes("permission"))
          ? "Reglas de Firestore bloqueando escritura. Vuelve a ejecutar EJECUTAR-PARA-REGLAS.bat."
          : (e.message || "Error desconocido")
      );
    }
    finally { setSaving(false); }
  }

  if (orgActiva) {
    return (
      <OrgDetail
        org={orgActiva}
        onBack={() => setOrgActiva(null)}
        onUpdate={updated => setOrgActiva(updated)}
      />
    );
  }

  const totalUsuarios = Object.values(userCounts).reduce((s, v) => s + v, 0);
  const orgsActivas   = orgs.filter(o => o.activo).length;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: font }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase" }}>Operanzia</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Panel de Control</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: C.text }}>{sesion.nombre}</div>
            <div style={{ fontSize: 10, color: C.blue, letterSpacing: 1, textTransform: "uppercase" }}>Superadmin</div>
          </div>
          <button onClick={() => signOut(auth)} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px" }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      <div style={{ padding: "24px", maxWidth: 800, margin: "0 auto" }}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { l: "Organizaciones",    v: orgs.length,    c: C.blueText },
            { l: "Activas",           v: orgsActivas,    c: C.green },
            { l: "Usuarios activos",  v: totalUsuarios,  c: C.amber },
          ].map(s => (
            <div key={s.l} style={{ ...S.card, textAlign: "center", marginBottom: 0 }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Botón + formulario crear */}
        <button onClick={() => { setShowCrear(v => !v); setErr(""); }} style={{
          ...S.btn, marginBottom: 16,
          background:   showCrear ? "none" : C.blueDim,
          borderColor:  showCrear ? C.border : `${C.blue}44`,
          color:        showCrear ? C.muted : C.blueText,
        }}>
          {showCrear ? "✕ Cancelar" : "+ Nueva organización"}
        </button>

        {showCrear && (
          <div style={{ ...S.card, borderColor: `${C.blue}44`, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.blueText, marginBottom: 16 }}>
              Nueva organización
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={S.label}>Nombre de la empresa *</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Ayuntamiento de Palma" style={S.input}
                  onKeyDown={e => e.key === "Enter" && crearOrg()} />
                {form.nombre && (
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 5, fontFamily: mono }}>
                    ID que se generará: <span style={{ color: C.blueText }}>{slugify(form.nombre) || "—"}</span>
                  </div>
                )}
              </div>
              <div>
                <label style={S.label}>Máximo de usuarios</label>
                <input value={form.max_usuarios} onChange={e => setForm({ ...form, max_usuarios: e.target.value })}
                  type="number" min="1" style={S.input} />
              </div>
              <div>
                <label style={S.label}>Plan</label>
                <select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} style={S.input}>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={S.label}>Email de contacto (opcional)</label>
                <input value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })}
                  type="email" placeholder="admin@empresa.com" style={S.input} />
              </div>
            </div>
            {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>⚠ {err}</div>}
            <button onClick={crearOrg} disabled={saving} style={{ ...S.btn, width: "100%", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creando…" : "Crear organización"}
            </button>
          </div>
        )}

        {err && (
          <div style={{ background: "#3b0000", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#f87171", fontSize: 13, wordBreak: "break-all" }}>
            ⚠ {err}
          </div>
        )}

        {/* Lista de orgs */}
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
          Organizaciones ({orgs.length})
        </div>

        {orgs.length === 0 && !showCrear && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.dim }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🏢</div>
            <div style={{ fontSize: 14 }}>Sin organizaciones — crea la primera</div>
          </div>
        )}

        {[...orgs]
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
          .map(org => {
            const activos = userCounts[org.org_id] ?? 0;
            const pct = org.max_usuarios ? Math.round(activos / org.max_usuarios * 100) : 0;
            const usageColor = pct >= 90 ? C.red : pct >= 70 ? C.orange : C.green;
            return (
              <div key={org.org_id}
                onClick={() => setOrgActiva(org)}
                style={{
                  ...S.card, cursor: "pointer",
                  borderLeft: `4px solid ${org.activo ? C.blue : C.border}`,
                  opacity: org.activo ? 1 : 0.55,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = org.activo ? C.blue : C.border; }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{org.nombre}</div>
                      <PlanBadge plan={org.plan} />
                      {!org.activo && (
                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: `${C.red}22`, color: C.red, border: `1px solid ${C.red}44` }}>
                          Suspendida
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, fontFamily: mono, marginBottom: 10 }}>
                      {org.org_id}
                    </div>
                    {/* Barra de uso */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 4, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: usageColor, borderRadius: 2, transition: "width .3s" }} />
                      </div>
                      <div style={{ fontSize: 11, color: usageColor, whiteSpace: "nowrap", minWidth: 80, textAlign: "right" }}>
                        {activos}/{org.max_usuarios} usuarios
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 20, color: C.border, flexShrink: 0, alignSelf: "center" }}>›</div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── ENTRY POINT ───────────────────────────────────────────────────
export default function SuperAdminApp() {
  const [sesion, setSesion] = useState(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getDocFromServer(doc(db, "usuarios", user.uid));
          if (snap.exists() && snap.data().rol === "superadmin") {
            setSesion({ uid: user.uid, ...snap.data() });
          } else {
            await signOut(auth); setSesion(null);
          }
        } catch { setSesion(null); }
      } else {
        setSesion(null);
      }
    });
  }, []);

  if (sesion === undefined) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
      <div style={{ color: C.muted }}>Cargando…</div>
    </div>
  );

  if (!sesion) return <LoginSA onLogin={setSesion} />;
  return <SuperAdminPanel sesion={sesion} />;
}
