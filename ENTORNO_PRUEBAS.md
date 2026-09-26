# Entorno de pruebas (staging) y copias de seguridad

Hoy cada push a `main` se publica directamente en app.operanzia.com, que es lo que usan los clientes. Esta guía explica cómo tener un entorno aparte para probar antes, con **datos separados**, y cómo activar las copias de seguridad automáticas.

## 1. Comprobaciones automáticas (ya activas)

En cada push, GitHub Actions (`.github/workflows/ci.yml`) ejecuta:

- los tests (`npm test`),
- la compilación (`npm run build`),
- los tests de las reglas de Firestore con el emulador (`npm run test:rules`).

Si algo falla, el commit sale en rojo en GitHub y te llega un email.

**Ojo:** Vercel despliega igualmente. Para que no se publique nada roto, trabaja en una rama (ver el punto 3) y pásala a `main` solo cuando esté en verde.

## 2. Proyecto de Firebase de pruebas (una sola vez, unos 10 min)

1. En https://console.firebase.google.com, **Añadir proyecto** y llámalo `operanzia-pruebas`.
2. Dentro del proyecto:
   - **Firestore Database**: créala en la misma región que producción.
   - **Authentication**: activa Correo/contraseña.
3. **Configuración del proyecto** → Tus apps → **Web (`</>`)** → copia los valores de `firebaseConfig`.
4. Sube las reglas y los índices al proyecto de pruebas:

   ```
   firebase deploy --only firestore:rules,firestore:indexes --project operanzia-pruebas
   ```

5. Crea allí una organización y un usuario de prueba, igual que en producción, desde el panel de superadmin.

## 3. Vercel: vista previa apuntando a pruebas

Vercel ya crea un despliegue de vista previa (una URL propia) por cada rama que no sea `main`. Para que esas vistas previas usen la base de datos de pruebas:

1. Vercel → proyecto **fleetcomms** → Settings → Environment Variables.
2. Añade estas variables marcando **solo "Preview"** (no Production), con los valores del paso 2.3:

   | Variable | Valor |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | apiKey |
   | `VITE_FIREBASE_AUTH_DOMAIN` | authDomain |
   | `VITE_FIREBASE_PROJECT_ID` | projectId |
   | `VITE_FIREBASE_STORAGE_BUCKET` | storageBucket |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | messagingSenderId |
   | `VITE_FIREBASE_APP_ID` | appId |

3. A partir de ahí:
   - Cada cambio va en una rama, por ejemplo `git checkout -b mejora-x`, y luego `git push`.
   - Vercel te da una URL de vista previa que usa **la base de datos de pruebas**.
   - Cuando esté probado y la comprobación de GitHub en verde, se pasa a `main` y se publica.

Sin estas variables, la app usa producción (como hasta ahora), así que no cambia nada hasta que las añadas.

## 4. Copias de seguridad automáticas de Firestore (5 min)

Requiere el plan Blaze (pago por uso).

1. https://console.cloud.google.com/firestore/databases → proyecto `fleetcomms-13d89` → base de datos `(default)`.
2. **Recuperación ante desastres** (Disaster recovery) → **Crear programación de copias de seguridad** → Diaria, retención de 14 días.
3. En la misma pantalla, activa también la **recuperación a un momento dado** (PITR, 7 días). Con ella se puede volver al estado de la base de datos de cualquier minuto de la última semana.

Coste orientativo: se paga el almacenamiento de las copias al precio normal de Firestore, céntimos al mes con el volumen actual.

Para restaurar una copia, desde la misma pantalla: **Restaurar** crea una base de datos nueva a partir de la copia. Nunca se sobrescribe la actual.
