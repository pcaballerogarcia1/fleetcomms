# Despliegue Operanzia en Vercel + operanzia.com

**Qué vamos a montar:**
- `operanzia.com` → landing page (carpeta `landing/`)
- `app.operanzia.com` → aplicación (carpeta raíz)

---

## PARTE 1 — Landing page (operanzia.com)

### Paso 1 — Importar el repo
1. En Vercel, haz clic en **"Add New Project"**
2. Haz clic en **"Import"** junto al repo `fleetcomms`

### Paso 2 — Configurar antes de desplegar
En la pantalla de configuración, cambia **solo esto**:
- **Root Directory** → haz clic en "Edit" y escribe: `landing`
- El resto (Framework, Build Command, Output Directory) déjalo como detecta automáticamente

### Paso 3 — Desplegar
- Haz clic en **"Deploy"**
- Espera ~1 minuto hasta que aparezca el tick verde
- Vercel te da una URL tipo `fleetcomms-xxx.vercel.app` — ahí está el landing funcionando

### Paso 4 — Asignar el dominio operanzia.com
1. Dentro del proyecto del landing, ve a **Settings** (menú superior)
2. Haz clic en **Domains** (menú lateral izquierdo)
3. En el campo de texto escribe: `operanzia.com` → clic en **Add**
4. Repite y añade también: `www.operanzia.com` → clic en **Add**
5. Vercel te mostrará los registros DNS que necesitas configurar — **deja esta pantalla abierta**

### Paso 5 — Configurar DNS en tu registrador de dominio
> Abre en otra pestaña el panel de tu registrador (GoDaddy, Namecheap, etc.)

Vercel te pedirá añadir estos registros. Los valores exactos los ves en Vercel, pero el formato es:

| Tipo  | Host/Nombre | Valor                  |
|-------|-------------|------------------------|
| A     | @           | 76.76.21.21            |
| CNAME | www         | cname.vercel-dns.com   |

Cómo añadirlos (en la mayoría de registradores):
1. Ve a **DNS** o **Gestión de DNS** de tu dominio
2. Borra cualquier registro A que ya exista para `@`
3. Añade el registro **A** con los datos de arriba
4. Añade el registro **CNAME** con los datos de arriba
5. Guarda

> El DNS puede tardar entre 5 minutos y 24 horas en propagarse.
> Vercel te avisará con un tick verde cuando lo detecte.

---

## PARTE 2 — Aplicación (app.operanzia.com)

### Paso 6 — Importar el repo otra vez
1. En Vercel, haz clic en **"Add New Project"**
2. Importa el mismo repo `fleetcomms` otra vez

### Paso 7 — Configurar
Esta vez **no toques nada** — deja el Root Directory vacío (la raíz del repo).
- Haz clic en **"Deploy"**

### Paso 8 — Asignar el subdominio app.operanzia.com
1. Dentro de este segundo proyecto, ve a **Settings → Domains**
2. Escribe: `app.operanzia.com` → clic en **Add**
3. Vercel te pedirá añadir un registro CNAME en tu registrador:

| Tipo  | Host/Nombre | Valor                |
|-------|-------------|----------------------|
| CNAME | app         | cname.vercel-dns.com |

4. Añádelo en el panel DNS de tu registrador igual que antes
5. Espera el tick verde en Vercel

---

## RESULTADO FINAL

| URL | Qué es |
|-----|--------|
| `operanzia.com` | Landing page — página de marketing |
| `www.operanzia.com` | Redirige a operanzia.com |
| `app.operanzia.com` | La aplicación (login, módulos, etc.) |

---

## Actualizaciones futuras

Cada vez que hagas cambios y ejecutes:
```
git add -A
git commit -m "descripción del cambio"
git push origin main
```
Vercel redeploya los dos sitios automáticamente en ~1 minuto. No hay que hacer nada más.

---

## Si algo falla

- **DNS no propaga** — espera hasta 24h, es normal. Puedes comprobar en https://dnschecker.org
- **Build falla en la app** — comprueba que el Root Directory del segundo proyecto está vacío
- **Build falla en el landing** — comprueba que el Root Directory es exactamente `landing` (sin barra)
