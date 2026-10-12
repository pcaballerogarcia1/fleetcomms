# Copias de seguridad de la base de datos (producción)

Proyecto `fleetcomms-13d89`, base de datos `(default)`, en Europa (`eur3`).
Necesita el plan **Blaze** (pago por uso). Lo configura todo
`node scripts/copias-seguridad.mjs`, que se puede lanzar cuantas veces se quiera:
cada vez hace solo lo que falta.

## Qué hay

| Qué | Para qué |
|---|---|
| Copia **diaria** (se guardan 14 días) | Recuperar el estado de un día concreto |
| Copia **semanal**, los domingos (12 semanas) | Volver más atrás |
| **Vuelta atrás a cualquier minuto** de los últimos 7 días (PITR) | Deshacer un borrado o un error reciente con precisión de minuto |
| **Protección contra borrado** de la base de datos entera | Que no se pueda borrar por error |

Además, la primera vez se hace un **ensayo de recuperación**: la primera copia
se recupera en una base de datos aparte (`prueba-restauracion`), se deja 2 días
para poder mirarla y se borra sola.

Mientras el proyecto esté en el plan gratuito, una tarea de Windows
(«Operanzia - copias de seguridad») lanza el programa cada hora; en cuanto se
pasa a Blaze lo activa todo, deja el informe en el escritorio
(«Copias de seguridad Operanzia.txt») y la tarea se borra sola al terminar.
Registro: `%USERPROFILE%\.operanzia\copias.log`.

## Si hay que recuperar algo

**Nunca se recupera encima de la base de datos buena.** Siempre se saca una
copia a una base de datos nueva, se comprueba ahí y luego se pasa lo que haga
falta.

### Algo de los últimos 7 días (al minuto)

1. Saber la hora (aproximada) de antes del error, en hora UTC (en España, restar 1 h en invierno y 2 h en verano).
2. Clonar la base de datos tal y como estaba a esa hora:
   ```
   npx firebase firestore:databases:clone "(default)" recuperacion-AAAAMMDD --snapshot-time 2026-10-12T09:41:00Z --project fleetcomms-13d89
   ```
3. Mirar en la consola (Firestore → elegir la base de datos `recuperacion-…`) que lo que se perdió está ahí.
4. Copiar de vuelta solo los documentos afectados (pedir ayuda: se hace con un script, documento a documento).
5. Borrar la base de datos de recuperación cuando ya no haga falta:
   `npx firebase firestore:databases:delete recuperacion-AAAAMMDD --force --project fleetcomms-13d89`

### Algo de hace más de 7 días

1. Ver las copias que hay:
   `npx firebase firestore:backups:list --project fleetcomms-13d89`
2. Recuperar la de la fecha elegida en una base de datos nueva:
   ```
   npx firebase firestore:databases:restore --database recuperacion-AAAAMMDD --backup "projects/fleetcomms-13d89/locations/eur3/backups/…" --project fleetcomms-13d89
   ```
3. Igual que antes: comprobar, copiar de vuelta lo necesario y borrarla.

## Coste

Con el tamaño actual de los datos, céntimos al mes (se paga el espacio que
ocupan las copias y el de la vuelta atrás de 7 días). El plan Blaze mantiene
las mismas cuotas gratuitas diarias que el gratuito.
