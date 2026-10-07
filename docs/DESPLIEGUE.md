# Despliegue del endurecimiento (puntos 3, 4 y 5)

Este cambio **no se puede desplegar solo con `git push`**: la app nueva hace
consultas que necesitan (1) que los planes antiguos tengan el campo
`conductorUid` y (2) unos índices compuestos nuevos. Si la app llega antes,
los conductores dejan de ver las rutas compartidas y algunas pantallas no
cargan. El orden es:

## 1. Migrar los planes antiguos (antes que nada)

Pone `conductorUid: null` en los planes que no tienen el campo. Primero sin
`--aplicar` (solo cuenta), luego con `--aplicar`. Se puede repetir sin
problema: la segunda vez dice «Nada que migrar».

Con un administrador de cada organización (las reglas solo dejan ver la
propia; una vez por organización):

```bash
MIGRAR_CLAVE='…' node scripts/migrar-planes-sin-conductor.mjs --proyecto fleetcomms-13d89 --email admin@empresa.com
MIGRAR_CLAVE='…' node scripts/migrar-planes-sin-conductor.mjs --proyecto fleetcomms-13d89 --email admin@empresa.com --aplicar
```

O todas de una vez con un token de Google de un propietario del proyecto
(`FIRESTORE_TOKEN=$(gcloud auth print-access-token)`), sin `--email`.

Lecturas: una por plan existente (cuenta en la cuota diaria; con unos pocos
miles de planes no es problema).

## 2. Desplegar los índices y esperar a que se construyan

```bash
npx firebase deploy --only firestore:indexes
```

En la consola de Firebase → Firestore → Índices, esperar a que los nuevos
pasen de «Compilando» a «Habilitado» (minutos). Los nuevos son:
fichajes (org_id, fecha) · fichajes (uid, horaEntrada ↓) · incidencias
(org_id, fecha) · incidencias (org_id, fecha ↓) · movimientos (org_id,
productoId, fecha ↓) · planes (org_id, tipo, fecha ↓).

## 3. Desplegar la app

Commit y push a `main` (Vercel despliega solo). Las reglas de Firestore no
cambian en este despliegue.

## 4. Comprobar después

- Con un conductor: ve sus rutas, las compartidas y las tareas correctivas.
- Analytics carga el mes y cambia de mes.
- Inventario del conductor: al abrir un producto salen sus movimientos.
- Historial de cambios → «Errores» (superadmin): no aparecen
  `failed-precondition` (falta un índice) ni `resource-exhausted` (cuota).
  Desde este cambio esos dos avisos se registran solos.

## Pruebas antes de desplegar (ya pasan en local; CI las repite)

```bash
npm test                 # unitarias
npm run test:rules       # reglas contra el emulador (necesita Java)
npm run e2e              # extremo a extremo con los emuladores (necesita Java)
npm run medir            # lecturas por pantalla → e2e/informe-lecturas.md
```
