# Entorno de pruebas (staging) y copias de seguridad

Hoy cada push a `main` se publica directamente en app.operanzia.com, que es lo que usan los clientes. Esta guía explica cómo tener un entorno aparte para probar antes, con **datos separados**, y cómo activar las copias de seguridad automáticas.

## 1. Comprobaciones automáticas (ya activas)

En cada push, GitHub Actions (`.github/workflows/ci.yml`) ejecuta:

- los tests (`npm test`),
- la compilación (`npm run build`),
- los tests de las reglas de Firestore con el emulador (`npm run test:rules`).

Si algo falla, el commit sale en rojo en GitHub y te llega un email.

**Ojo:** Vercel despliega igualmente. Para que no se publique nada roto, prueba primero en la rama `pruebas` (ver el punto 3) y pásalo a `main` solo cuando esté en verde.

## 2. Entorno de pruebas (ya montado, 2026-10-07)

- **Proyecto de Firebase aparte:** `operanzia-pruebas` («Operanzia PRUEBAS»),
  con su propia base de datos, usuarios, reglas e índices. Nada de lo que
  pase ahí toca a los clientes ni gasta su cuota diaria.
  (La base de datos quedó en EE. UU. —`nam5`— en vez de Europa; da igual
  porque solo tiene datos inventados.)
- **La app elige sola el proyecto:** las vistas previas de Vercel (cualquier
  rama que no sea `main`) se compilan contra pruebas (`vite.config.js`), y
  salen con un cartel naranja «PRUEBAS» abajo y «[PRUEBAS]» en la pestaña.
  `main` sigue yendo a producción. No hace falta tocar nada en Vercel; si
  algún día se ponen allí variables `VITE_FIREBASE_*`, mandan esas.
- **Datos de ejemplo:** `node scripts/sembrar-pruebas.mjs` crea (o rehace)
  la empresa «pruebas» con 5 usuarios, flota, plantilla, rutas, incidencias e
  inventario. Contraseña de todos: `Pruebas-2026`.

  | Usuario | Rol |
  |---|---|
  | superadmin@operanzia-pruebas.test | superadmin |
  | admin@operanzia-pruebas.test | admin |
  | jefe@operanzia-pruebas.test | intermedio (jefe de tráfico) |
  | conductor1@operanzia-pruebas.test | conductor |
  | conductor2@operanzia-pruebas.test | conductor |

- **Al cambiar las reglas o los índices**, desplegarlos también en pruebas:
  `npx firebase deploy --only firestore --project operanzia-pruebas`.

## 3. Cómo se trabaja

1. Los cambios se suben a la rama **`pruebas`** (`git push origin HEAD:pruebas`).
2. Vercel la publica en la dirección de pruebas (fija para esa rama).
3. Se prueba ahí con los usuarios de arriba.
4. Si todo va bien, se pasa a `main` y se publica en app.operanzia.com.

## 4. Copias de seguridad automáticas de Firestore (5 min)

Requiere el plan Blaze (pago por uso).

1. https://console.cloud.google.com/firestore/databases → proyecto `fleetcomms-13d89` → base de datos `(default)`.
2. **Recuperación ante desastres** (Disaster recovery) → **Crear programación de copias de seguridad** → Diaria, retención de 14 días.
3. En la misma pantalla, activa también la **recuperación a un momento dado** (PITR, 7 días). Con ella se puede volver al estado de la base de datos de cualquier minuto de la última semana.

Coste orientativo: se paga el almacenamiento de las copias al precio normal de Firestore, céntimos al mes con el volumen actual.

Para restaurar una copia, desde la misma pantalla: **Restaurar** crea una base de datos nueva a partir de la copia. Nunca se sobrescribe la actual.

## 5. Simular autobuses en Control (proyectos de líneas)

Para enseñar Control de autobuses sin conductores reales:

1. En Scheduling (paso 2, Trabajadores) pulsa **Publicar a Control** y elige hoy.
2. Lanza el simulador con el identificador del proyecto (se ve en la dirección o en la base de datos):
   `node scripts/simular-autobuses.mjs <projectId> 25 120`
   (25 conductores ficticios durante 120 minutos; solo funciona contra pruebas).
3. Abre Control: cada autobús se mueve por su línea con su retraso, y el informe del día se va rellenando.

Con 25 conductores son unas 3.000 escrituras por hora, dentro de la cuota gratuita del proyecto de pruebas. Para pararlo antes: Ctrl+C (marca los autobuses como inactivos).
