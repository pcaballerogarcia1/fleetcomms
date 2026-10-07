# Despliegue del endurecimiento (puntos 3, 4 y 5)

La app nueva hace consultas que necesitan unos índices compuestos nuevos:
hay que desplegarlos antes que la app (si no, algunas pantallas no cargan).
El orden es:

## 1. Planes antiguos: se arreglan solos

Los planes antiguos no tienen `conductorUid`. La app los arregla sola
(`src/reparar-planes.js`): cuando entra alguien que gestiona rutas (admin,
intermedio o superadmin), en la oficina o en Rutas, pone `conductorUid: null`
a los planes de los 300 más recientes de su organización que no lo tienen.
Una vez por organización y navegador; cuesta ≤300 lecturas esa primera vez.

Hasta que entre un gestor de esa organización, sus conductores no ven las
rutas compartidas antiguas (las nuevas sí). Si hace falta antes, o para
planes más antiguos, sigue estando el script manual (solo cuenta sin
`--aplicar`):

```bash
MIGRAR_CLAVE='…' node scripts/migrar-planes-sin-conductor.mjs --proyecto fleetcomms-13d89 --email admin@empresa.com [--aplicar]
```

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
