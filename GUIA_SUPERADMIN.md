# GUÍA COMPLETA — SUPERADMIN Y PERMISOS POR CLIENTE
## Operanzia · Paso a paso milimétrico

---

## ÍNDICE

1. [Qué hace este sistema](#1-qué-hace-este-sistema)
2. [Paso 1 — Publicar las reglas de seguridad en Firebase](#2-paso-1--publicar-las-reglas-de-seguridad-en-firebase)
3. [Paso 2 — Convertir tu usuario existente en superadmin](#3-paso-2--convertir-tu-usuario-existente-en-superadmin)
4. [Paso 3 — Desplegar la app en Vercel](#4-paso-3--desplegar-la-app-en-vercel)
5. [Paso 4 — Acceder al panel de superadmin](#5-paso-4--acceder-al-panel-de-superadmin)
6. [Paso 5 — Dar de alta un nuevo cliente](#6-paso-5--dar-de-alta-un-nuevo-cliente)
7. [Paso 6 — El cliente crea sus propios usuarios](#7-paso-6--el-cliente-crea-sus-propios-usuarios)
8. [Paso 7 — Gestión diaria desde el panel superadmin](#8-paso-7--gestión-diaria-desde-el-panel-superadmin)
9. [Qué pasa si...](#9-qué-pasa-si)

---

## 1. Qué hace este sistema

Antes de empezar, entiende la estructura de 3 niveles:

```
TÚ (superadmin)
│
├── Empresa A  →  admin empresa A  →  operarios empresa A
├── Empresa B  →  admin empresa B  →  operarios empresa B
└── Empresa C  →  admin empresa C  →  operarios empresa C
```

- **Tú (superadmin):** Entras en `/superadmin`. Creas empresas, fijas cuántos usuarios pueden tener, las activas o suspendes.
- **Admin de empresa:** Entra en la app normal. Crea usuarios para sus operarios (hasta el límite que tú fijaste). NO puede ver datos de otras empresas.
- **Operario:** Entra en la app normal. Solo puede usar los módulos. No puede crear usuarios ni borrar datos.

Los datos de cada empresa están completamente aislados — ningún usuario puede ver ni tocar datos de otra empresa, ni aunque lo intente directamente desde el navegador.

---

## 2. PASO 1 — Publicar las reglas de seguridad en Firebase

Este es el paso más importante. Sin esto, los datos NO están protegidos.

### 2.1 Abrir la consola de Firebase

1. Abre el navegador y ve a: **https://console.firebase.google.com**
2. Inicia sesión con la cuenta de Google que usaste para crear el proyecto.
3. Verás una lista de tus proyectos. Haz clic en **fleetcomms-13d89**.

### 2.2 Ir a Firestore Database

1. En el menú de la izquierda, busca **"Build"** y haz clic.
2. Aparecerá un submenú. Haz clic en **"Firestore Database"**.
3. Se abre la vista de Firestore con tus datos.

### 2.3 Ir a la pestaña Reglas

1. En la parte superior, verás varias pestañas: **Datos | Reglas | Índices | Uso**
2. Haz clic en **"Reglas"**.
3. Verás un editor de texto con las reglas actuales (probablemente algo muy permisivo o vacío).

### 2.4 Pegar las nuevas reglas

1. Selecciona TODO el texto que hay en el editor (Ctrl+A).
2. Bórralo.
3. Abre el archivo `firestore.rules` que está en tu carpeta FLEETCOMMS con cualquier editor de texto (Bloc de notas, VS Code, etc.).
4. Copia todo el contenido (Ctrl+A, luego Ctrl+C).
5. Pégalo en el editor de la consola de Firebase (Ctrl+V).

### 2.5 Publicar

1. Haz clic en el botón azul **"Publicar"** (o "Publish" si está en inglés).
2. Aparecerá un mensaje de confirmación. Haz clic en **"Publicar"** de nuevo.
3. Verás un mensaje verde de éxito: "Reglas publicadas correctamente".

✅ **Las reglas ya están activas.** A partir de este momento, cada usuario solo puede ver los datos de su empresa.

---

## 3. PASO 2 — Convertir tu usuario existente en superadmin

Ya tienes un usuario creado. Solo hay que actualizar su documento en Firestore para darle el rol de superadmin.

### 3.1 Copiar el UID de tu usuario

1. En el menú izquierdo de Firebase, en **"Build"**, haz clic en **"Authentication"**.
2. Haz clic en la pestaña **"Users"**.
3. Verás la lista de usuarios. Localiza el tuyo por el email.
4. En esa misma fila, a la izquierda, hay una columna llamada **"Identifier"** y junto a ella el **"User UID"** — es una cadena larga de letras y números como `xKj7mN2pQr...`.
5. Haz clic en los tres puntos `⋮` al final de la fila → **"Copy UID"**. O simplemente selecciónalo y cópialo con Ctrl+C.

> Guarda ese UID copiado — lo necesitas en el siguiente paso.

### 3.2 Localizar tu documento en Firestore

1. En el menú izquierdo, haz clic en **"Firestore Database"** (lo que tú llamas Firestore).
2. Haz clic en la pestaña **"Datos"** (si no estás ya en ella).
3. En la columna de la izquierda verás las colecciones. Haz clic en **"usuarios"**.
4. En la columna del centro aparecen los documentos de esa colección. Busca el que tenga el mismo ID que tu UID.
   - Si lo encuentras: haz clic en él y ve al paso 3.3.
   - Si no existe todavía: ve al paso 3.3b para crearlo.

### 3.3a Si el documento ya existe — editar el rol

1. Haz clic en tu documento (el que tiene tu UID como nombre).
2. En la columna de la derecha verás todos los campos: nombre, email, rol, etc.
3. Busca el campo **`rol`**.
4. Haz clic en el icono del lápiz ✏️ que aparece al lado del valor actual.
5. Borra el valor que tenga y escribe exactamente: `superadmin`
6. Pulsa **"Actualizar"** o el icono de confirmación.
7. Si existe un campo **`org_id`**, haz clic en los tres puntos `⋮` al lado y selecciona **"Eliminar campo"** — el superadmin no pertenece a ninguna empresa.
8. Comprueba que el campo **`activo`** es `true` (tipo boolean). Si es `false` o no existe, edítalo o añádelo.

### 3.3b Si el documento NO existe — crearlo

1. Haz clic en **"+ Agregar documento"**.
2. En el campo **"ID de documento"**, borra el ID automático y pega tu UID copiado.
3. Haz clic en **"Guardar"**.
4. Ahora añade estos campos uno a uno con **"+ Agregar campo"**:

| Campo       | Tipo    | Valor              |
|-------------|---------|--------------------|
| `nombre`    | string  | Tu nombre          |
| `apellidos` | string  | Tus apellidos      |
| `email`     | string  | Tu email           |
| `rol`       | string  | `superadmin`       |
| `activo`    | boolean | `true`             |

> ⚠️ **No añadas el campo `org_id`** — el superadmin no pertenece a ninguna empresa.

Haz clic en **"Guardar"**.

✅ **Tu usuario ya es superadmin.**

---

## 4. PASO 3 — Desplegar la app en Vercel

Si ya tienes la app en Vercel, solo necesitas hacer un nuevo deploy para que los cambios del código se apliquen.

### 4.1 Si usas GitHub + Vercel (deploy automático)

1. Abre una terminal en la carpeta FLEETCOMMS.
2. Ejecuta:
   ```
   git add .
   git commit -m "superadmin panel y reglas de seguridad"
   git push
   ```
3. Vercel detectará el push automáticamente y hará el deploy. En 1-2 minutos estará listo.
4. Ve a **https://vercel.com/dashboard**, entra en tu proyecto y verifica que el deploy haya terminado (aparece "Ready" en verde).

### 4.2 Si subes manualmente con Vercel CLI

1. Abre una terminal en la carpeta FLEETCOMMS.
2. Ejecuta:
   ```
   npm run build
   ```
3. Cuando termine, ejecuta:
   ```
   vercel --prod
   ```
4. Sigue las instrucciones en pantalla.

### 4.3 Verificar que el archivo vercel.json funciona

El archivo `vercel.json` que hemos creado contiene esto:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
Esto es necesario para que al entrar directamente a `/superadmin` en el navegador, Vercel no devuelva un error 404. Sin este archivo, las URLs directas no funcionarían.

---

## 5. PASO 4 — Acceder al panel de superadmin

1. Abre el navegador.
2. Ve a tu URL de producción seguida de `/superadmin`.
   - Ejemplo: `https://operanzia.vercel.app/superadmin`
   - O en local: `http://localhost:5173/superadmin`
3. Verás una pantalla de login con el título **"Panel de Control — Acceso restringido"**.
4. Introduce el email y contraseña que creaste en el Paso 2.
5. Haz clic en **"Acceder"**.

Si introduces credenciales de un usuario que NO es superadmin, verás el error "Acceso denegado — solo superadmins" y no podrás entrar.

✅ **Estás dentro del panel de superadmin.**

Verás:
- **3 tarjetas de resumen:** total de organizaciones, cuántas están activas, total de usuarios activos en la plataforma.
- **Botón "+ Nueva organización"** para añadir clientes.
- **Lista de organizaciones** (vacía de momento).

---

## 6. PASO 5 — Dar de alta un nuevo cliente

Cada vez que tengas un nuevo cliente, haces esto desde el panel superadmin.

### 6.1 Crear la organización

1. Haz clic en **"+ Nueva organización"**.
2. Rellena el formulario:
   - **Nombre de la empresa:** el nombre oficial del cliente (ej: `Ayuntamiento de Palma`)
   - El sistema genera automáticamente el **ID** a partir del nombre (ej: `ayuntamiento-de-palma`). Verás una línea gris debajo del campo nombre que dice "ID que se generará: ayuntamiento-de-palma". Este ID es el que vincula todos los datos del cliente — no se puede cambiar después.
   - **Máximo de usuarios:** cuántos usuarios puede crear esta empresa en total (ej: `10`). Si intentan crear más, la app les bloqueará y les dirá que contacten contigo.
   - **Plan:** selecciona Basic, Pro o Enterprise (es solo informativo por ahora, pero útil para saber qué has vendido).
   - **Email de contacto:** el email del responsable del cliente (opcional, solo para tu referencia).
3. Haz clic en **"Crear organización"**.

La org aparece inmediatamente en la lista con una barra de uso de usuarios (0/10, por ejemplo).

### 6.2 Crear el primer usuario admin del cliente

El primer usuario de cada cliente tiene que crearlo tú, porque ellos aún no tienen acceso. Este usuario será el "admin" de su empresa, el que luego creará a los operarios.

**Opción A — Desde Firebase Console (más directo):**

1. Ve a Firebase → **Authentication** → **"Add user"**.
2. Rellena el email y contraseña del admin del cliente.
3. Copia el User UID.
4. Ve a Firestore → colección **"usuarios"** → **"+ Agregar documento"**.
5. Usa el User UID como ID del documento.
6. Añade estos campos:

| Campo        | Tipo    | Valor                              |
|--------------|---------|------------------------------------|
| `nombre`     | string  | Nombre del admin del cliente        |
| `apellidos`  | string  | Apellidos                           |
| `email`      | string  | Su email                            |
| `rol`        | string  | `admin`                             |
| `org_id`     | string  | El ID de la org (ej: `ayuntamiento-de-palma`) |
| `activo`     | boolean | `true`                              |
| `createdAt`  | timestamp | (haz clic en timestamp y usa la fecha actual) |

**Opción B — Desde la propia app (más cómodo a partir del segundo cliente):**

Una vez que el admin del cliente ya existe y puede entrar a la app, ellos mismos pueden crear sus operarios desde el módulo de Incidencias → botón "⚙️ Usuarios" → "+ Nuevo". El sistema les bloqueará cuando alcancen su límite.

### 6.3 Enviar credenciales al cliente

Envía al responsable del cliente:
- La URL de la app (ej: `https://operanzia.vercel.app`)
- Su email de acceso
- Su contraseña (dile que la cambie después, aunque la app no lo fuerza)
- Instrucciones básicas de uso

---

## 7. PASO 6 — El cliente crea sus propios usuarios

Una vez el admin del cliente tiene acceso, puede crear operarios él mismo sin que tú tengas que intervenir.

### Cómo lo hace el admin del cliente

1. Entra a la app con su email y contraseña.
2. Va al módulo **"Incidencias"** (el primer tab).
3. Hace clic en **"⚙️ Usuarios"** (solo visible para admins).
4. Hace clic en **"+ Nuevo"**.
5. Rellena nombre, apellidos, email, contraseña y rol (Conductor o Supervisor).
6. Hace clic en **"CREAR USUARIO"**.

**Qué pasa si intenta crear más usuarios de los permitidos:**
- La app le muestra el mensaje: *"Has alcanzado el límite de X usuarios de tu plan. Contacta con Operanzia para ampliarlo."*
- No puede crear más hasta que tú aumentes el `max_usuarios` desde el panel superadmin.

---

## 8. PASO 7 — Gestión diaria desde el panel superadmin

### Ver el estado de todos los clientes

Entra en `/superadmin` y en la lista de orgs verás para cada cliente:
- Nombre y ID
- Plan contratado
- Barra de uso de usuarios (verde = holgado, naranja = casi lleno, rojo = al límite)
- Si está activa o suspendida

### Modificar el límite de usuarios de un cliente

1. Haz clic en la tarjeta del cliente.
2. Estás en la pestaña **"⚙️ Configuración"**.
3. Cambia el número en **"Máximo de usuarios"**.
4. Haz clic en **"Guardar cambios"**.
5. El cliente podrá crear más usuarios inmediatamente.

### Suspender un cliente (impago, baja, etc.)

1. Entra en el detalle del cliente.
2. En **"Estado de la organización"**, haz clic en **"✕ Suspendida"**.
3. Haz clic en **"Guardar cambios"**.

**Qué pasa al suspender:**
- Los usuarios de esa empresa no pueden leer ni escribir ningún dato (las reglas de Firestore bloquean todo si `org.activo == false`).
- Si intentan entrar a la app, se quedarán en la pantalla de carga o verán un error.
- Sus datos siguen existiendo — no se borran nada. Si reactivas la org, todo vuelve a funcionar.

### Desactivar un usuario concreto (sin suspender toda la empresa)

1. Entra en el detalle del cliente.
2. Ve a la pestaña **"👥 Usuarios"**.
3. Busca el usuario en la lista.
4. Haz clic en el botón **"Activo"** que aparece a la derecha — cambiará a **"Inactivo"**.

Ese usuario específico no podrá volver a entrar (aunque tenga la contraseña correcta). El resto de usuarios de la empresa no se ven afectados.

### Ver cuántos usuarios tiene cada empresa

En la lista principal del panel superadmin, la barra debajo de cada org muestra los usuarios activos sobre el máximo. También puedes entrar en el detalle de cualquier org y ver la lista completa en la pestaña "Usuarios".

---

## 9. Qué pasa si...

### "Un cliente me dice que no puede entrar"

1. Entra en el panel superadmin.
2. Busca la org del cliente y comprueba que esté **activa** (no suspendida).
3. Entra en el detalle → pestaña "Usuarios".
4. Busca al usuario en cuestión y comprueba que esté **activo**.
5. Si ambas cosas están bien, el problema es la contraseña. Ve a Firebase → Authentication y haz clic en los 3 puntos del usuario → "Reset password" para enviarle un email de recuperación.

### "Quiero cambiarle el plan a un cliente"

1. Entra en el panel superadmin → detalle del cliente.
2. Cambia el **Plan** en el desplegable.
3. Cambia el **Máximo de usuarios** si corresponde.
4. Guarda.

### "Quiero borrar un cliente definitivamente"

Por seguridad, el panel superadmin no tiene botón de borrado de orgs (para evitar borrados accidentales). Si necesitas borrar una org:
1. Suspéndela primero desde el panel (para que no puedan acceder).
2. Ve a Firebase Console → Firestore → colección `orgs` → busca el documento → haz clic en los 3 puntos → "Borrar documento".
3. Ve a Firebase Console → Authentication y borra manualmente los usuarios de esa empresa.

### "Las reglas de Firestore me dan error al publicar"

Verifica que hayas copiado el contenido del archivo `firestore.rules` completo, empezando por `rules_version = '2';`. Si hay algún carácter raro, abre el archivo con VS Code en lugar del Bloc de notas.

### "Entro en /superadmin pero me dice 'Acceso denegado'"

Comprueba en Firebase → Firestore → colección `usuarios` → documento con tu UID:
- El campo `rol` debe ser exactamente `superadmin` (minúsculas, sin espacios extra).
- El campo `activo` debe ser `true` (tipo boolean, no string).
- NO debe existir el campo `org_id`.

### "La URL /superadmin da error 404 en Vercel"

Verifica que el archivo `vercel.json` existe en la raíz del proyecto y tiene este contenido exacto:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
Luego haz un nuevo deploy.

---

## RESUMEN RÁPIDO — Flujo completo nuevo cliente

```
1. Tú → /superadmin → "+ Nueva organización" → rellenas datos → "Crear"
2. Tú → Firebase Console → Authentication → "Add user" (email+password del admin del cliente)
3. Tú → Firebase Console → Firestore → usuarios → nuevo doc con UID → rol:admin, org_id:el-slug
4. Tú → envías email al cliente con URL + credenciales
5. Cliente → entra a la app → crea sus operarios desde "⚙️ Usuarios"
6. Operarios → usan la app normalmente
```

---

*Archivo generado el 24/06/2026 — Operanzia FLEETCOMMS*
