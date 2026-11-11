---
inclusion: always
---

# CausasPro — Memoria del proyecto

Este archivo es la **memoria viva** del proyecto: el agente lo lee automáticamente al
empezar cada sesión, así no hay que re-explicar el contexto. Mantenerlo actualizado.

> **Regla:** al cerrar un avance importante (feature, fix grande, decisión), actualizar
> este archivo. Ordenar el historial de más reciente a más antiguo.

---

## Qué es CausasPro

Micro-SaaS chileno para **abogados/curadores** que monitorea causas judiciales de **Familia**
en el portal PJUD (Oficina Judicial Virtual, `oficinajudicialvirtual.pjud.cl`). Un bot
Playwright hace login con Clave Única, entra a "Mis Causas > Familia", busca cada causa por
su RIT, scrapea los movimientos y detecta hitos urgentes (ej. **TRASLADO AL CURADOR**),
guardando todo en Supabase.

## Stack

- **Frontend/API:** Next.js + TypeScript (`src/app/`, `src/components/`), deploy en Vercel.
- **Bot:** Playwright + TypeScript, se ejecuta con `tsx` (`src/bot/`), `npm run bot`.
  Corre SOLO en la PC Windows del usuario, lanzado por el **Programador de tareas**
  (ver "Cómo se dispara el bot hoy"). GitHub Actions (`bot-pjud.yml`) es **solo manual**
  (`workflow_dispatch`, sin cron): las corridas en la nube chocaban con el bloqueo de IPs
  del portal y gastaban sesiones de Clave Única.
- **BD:** Supabase (Postgres). SQL versionado en `db/base/` y `db/migraciones/` (13
  migraciones). En la raíz quedan solo `schema-001-cobertura.sql` y
  `schema-email-logs.sql`.
- **Ingesta:** pegado de las causas asignadas en `/asignaciones` (`src/app/api/asignaciones/`).
  El módulo IMAP (`src/email/`) se dio de baja el 21-oct-2026: Exchange Online no acepta
  autenticación usuario+contraseña, así que nunca pudo leer el buzón.

## Dónde vive cada copia en esta PC (IMPORTANTE)

| Ruta | Estado | ¿Corre el bot desde ahí? |
|---|---|---|
| `Documents\Qoder\2026-10-26\003a5c0d\causaspro` | **LA COPIA VIVA**: tiene el `.env` con credenciales y `BOT_HORARIOS`, los `.bat` y las tareas apuntan aquí | **SÍ** (única) |
| `C:\Users\srtaj\causaspro` | copia al día (misma rama `main`) pero su `.env` NO tiene `BOT_HORARIOS` → ventana 6–18 | NO |
| `OneDrive\Escritorio\causaspro` | **VIEJA** (commit 14-sep) y con credenciales escritas a mano en `cargar-tanda.bat`. La tarea `CausasPro tanda` que la usaba está **Deshabilitada** | NO (solo riesgo) |

Antes de auditar o "arreglar" algo, confirmar en qué copia se está mirando: una versión
atrasada hace sacar conclusiones falsas (pasó el 11-nov-2026).

## Cómo se dispara el bot hoy (verificado 11-nov-2026)

Tareas del Programador de tareas (todas sobre la copia viva):

| Tarea | Horario Chile | Qué ejecuta | Tope de causas |
|---|---|---|---|
| `CausasPro-Mantenimiento` | 06:00 | `bot-programado.bat` → `bot-mantenimiento.bat` | 25 |
| `CausasPro-CargaMax` | 13:30 y 18:00 | `bot-carga-max.bat` ("TANDA UNICA") | 9999 (toda la cola) |
| `CausasPro tanda` | — | `OneDrive\...\cargar-tanda.bat` | **Deshabilitada** |

- Ventanas reales (`BOT_HORARIOS` en el `.env` de la copia viva):
  `06:00-08:30, 13:30-17:00, 18:00-20:00`. Con ~1,0 min/causa, la ventana de la tarde
  rinde ≈210 causas y la de la noche ≈120.
- Los `.bat` **no están en git** (los `.gitignore` a propósito: llevan credenciales).
  Son parte del sistema pero nadie los revisa ni los reproduce: cambiar el comportamiento
  del bot puede requerir editar un `.bat` que solo existe en esta PC.

## Convenciones de trabajo (preferencias del usuario)

- Comunicación **siempre en español** (usuario chileno).
- Cada cambio va en una **rama nueva desde `main`** + PR limpio (nunca commit directo a main,
  nunca reusar PRs).
- **Ultra Review** (semantic_reviewer) sobre el diff **antes de cada push**.
- El usuario ejecuta el bot en su PC; el sandbox NO puede correrlo (red cerrada,
  `INTEGRATIONS_ONLY`). Verificación de TS en el sandbox: `tsc --noEmit` filtrando errores
  de `node_modules` ausentes.

## Flujo REAL de búsqueda del bot (confirmado con el usuario)

El formulario de la pestaña Familia exige este orden para devolver resultados:

1. Mis Causas → click **Familia** → **scroll**.
2. Activar el **toggle "Filtros"** (es un *switch* verde; su `<input>` está oculto).
3. **Tipo Causa** → dropdown → "Seleccionar Todos" (queda **"5 de 5"**).
4. **Estado** → dropdown → "Seleccionar Todos" (queda **"12 de 12"**).
5. **Año** y **Rol** (el Rol es solo número, puede tener **más de 4 dígitos**, ej. `249240`).
6. **Buscar** (a veces hay que **scrollear y reapretar** el filtro para que aparezca la tabla).

Datos clave del dominio:
- **CORREGIDO 11-nov-2026:** los RIT de la base viva **SÍ llevan letra** en 1967 de 1975
  casos (P 1174, X 775, C 15, F 2, E 1). Solo 8 van sin letra (`14678-2022`, etc.). La
  nota antigua ("los RIT del usuario no tienen letra") venía de la carga inicial de Excel
  y ya no describe la base: es la causa de las marcas `REVISAR LETRA`.
- **La letra puede estar mal en la base**: el 11-nov el bot registró
  `X-5062-2023: el portal lo tiene como C-5062-2023 — verificar`. Número y año calzan;
  cambia la letra.
- El **campo RUT se llena solo** (RUT del curador) y **NO hay que tocarlo**.

## Estado del bot (búsqueda por RIT — `searchByRitExacto`)

✅ **FUNCIONANDO END-TO-END** — corrida `run_20260910_1821_kde4` (10-sep-2026):
**5/5 causas exitosas, 100% de éxito.** Scrapeó los movimientos reales (5, 6, 13, 13, 6 mov).

Flujo implementado y verificado:
`Familia → Filtros → (RUT intacto) → Tipo 5/5 → Estado 12/12 → Rol → Año → Buscar (con scroll + reintento)`.

- `parseRIT` acepta RIT con letra y **sin letra** (número-año).
- Matching por componentes (letra opcional + número + año); **fail-closed** ante ambigüedad.
- Toggle "Filtros" localizado por texto (`hermano`) y activado con click real + verificación.
- Diagnóstico: capturas en `bot-capturas/` (cross-OS) + volcado `[DIAG]` del portal cuando
  una búsqueda falla (desactivable con `BOT_DIAG=0`, así lo hace el CI).

## Estado operativo (medido en vivo el 11-nov-2026, 14:23 Chile)

Corrida en curso `run_20261111_1630_vhko` (lanzada 13:30 por la tarea `CausasPro-CargaMax`):
a las **15:06** llevaba 100 procesadas, 99 ok y 1 fallida, ritmo 1,0 min/causa. La ventana
cierra a las 17:00 con ~120 pendientes → las alcanza justas en la ventana de 18:00–20:00.
**No hay margen: cualquier retraso se arrastra al día siguiente.**

`v_cobertura` a las 15:06 de ese mismo día (foto, no constante: la corrida mueve los
números cada minuto — una hora antes estaba en 1366 pendientes / 476 ok):

| total | ok | sin_datos | error | descatalogadas | vencidas | fuera de cola | por escanear | nunca escaneadas | rezago máx |
|---|---|---|---|---|---|---|---|---|---|
| 1975 | 522 | 32 | 61 | 41 | 43 | 1154 | 269 | 935 | **61,5 días** |

- De dónde sale cada número (y no se suman entre sí):
  - **1.423** = filas de `v_cola_escaneo` (la vista de cola, que todavía arrastra las causas
    marcadas como ruido). **NO** es `v_cobertura.pendientes`.
  - **pendientes** (`v_cobertura`) = solo `escaneo_estado='pendiente'`; iba 1366 → 1319
    mientras la corrida avanzaba.
  - **por escanear** 269 y **fuera de cola** 1154 son baldes de la misma vista y ya
    descuentan el ruido (`[TERMINADA]`, `[NO EN PORTAL]`, `[REVISAR: no scrapeada]`,
    `[REVISAR LETRA]` — los cuatro literales están en `supabaseSync.ts:47-62`).
  - Conclusión igual que antes: **"1.423 pendientes" no es un agujero de cobertura**; la cola
    real eran ~270-292 y nunca-escaneada-sin-marca = 0. Pero al citarlo hay que decir **de
    qué vista** sale, porque las tres cifras se parecen y no son la misma cuenta.
- Lo que sí duele: una causa con último escaneo del 11-sep (**61 días**) y 935 que el portal
  conoce pero la cola aún no prioriza.
- Corridas raras del 10 y 11-nov (`_1425_i0pr` 11:25→13:00 y `_1525_sume` 12:25→07:16)
  arrancaron y se cortaron en horas que **no caen en ninguna ventana del `.env`**. Son las
  dos que dejaron `tanda-ahora-log.txt` / `carga-ahora-log.txt` en la copia viva. Ojo: **el
  `.bat` que las lanzó no existe ni en la copia viva ni en git** (solo quedan sus logs), así
  que nadie sabe qué variables le pasó. La explicación más probable: esa consola traía
  `BOT_HORARIOS` puesta a mano, y el cargador del `.env` (`src/bot/loadEnv.ts:69`) **no pisa**
  lo que el entorno ya tiene.
  Queda sin confirmación porque **ningún run guarda las ventanas que usó** → ver Pendientes.

## Historial de decisiones y avances (reciente → antiguo)

- **11-nov-2026 — auditoría de toda la app + docs corregidas** (**PR #110**, rama
  `docs/estado-proyecto-y-horarios-reales`):
  se actualizan `BOT-PJUD.md` (decía "6–18 h" y "la ventana se cambia en el .bat": son
  ventanas `BOT_HORARIOS` del `.env`, con fallback 6–18) y `.vercelignore` (pedía excluir
  7 rutas inexistentes y **no** excluía el `.env` ni los `.bat` con credenciales). Se
  corrigen también las dos afirmaciones falsas de este archivo (copia que corre el bot y
  RIT sin letra).
- **PR #109** (10-nov) — `BOT_MAX_CAUSAS=9999` en `bot-carga-max.bat` + **chequeo de hora
  por causa**: la tanda se para sola al cerrar la ventana y deja el resto en `pendiente`.
  Antes el corte era solo al arrancar. ⚠️ Aclaración medida el 11-nov sobre el log de esa
  corrida de 19 h: **16 de esas 19 h fueron un bloqueo** en `Seleccionando tab Familia`, no
  espera de ventana (ver P1). El chequeo por causa no sirve mientras la página esté trabada.
- **PR #24** — 🟢 **BUG DE FONDO RESUELTO**: `ReferenceError: __name is not defined` en
  `page.evaluate` (tsx/esbuild con keepNames inserta `__name()`, inexistente en el navegador).
  Shim `window.__name` global vía `addInitScript`. Esto era lo que rompía "Activando filtros"
  y enmascaraba todo. Tras esto: **bot 100% funcional**.
- **PR #23** — Toggle "Filtros" por TEXTO (genérico, no por clases CSS) + `dumpZonaFiltros` diag.
- **PR #22** — Steering `estado-proyecto.md` (memoria del proyecto en el repo).
- **PR #21** — Toggle "Filtros" robusto (click real de Playwright sobre el elemento visible
  del switch, verificación + reintentos, fail-closed).
- **PR #20** — NO limpiar el campo RUT (se llena por defecto y así debe quedar).
  *Pendiente:* `searchByYear` todavía lo limpia con la teoría opuesta — revisar aparte.
- **PR #19** — Aplicar filtros Tipo Causa (5/5) y Estado (12/12) también en la búsqueda por RIT
  (antes solo lo hacía `searchByYear`).
- **PR #18** — Buscar por **número + año** y reapretar filtro con scroll dentro del polling.
- **PR #17** — Capturas cross-OS (`bot-capturas/`) + diagnóstico `[DIAG]` del portal.
- **PR #16** — `parseRIT` acepta RIT sin letra.

## Pendientes conocidos

### 🔴 P0 — Seguridad (ninguno está resuelto; verificado 11-nov-2026)

1. **RLS desactivado en toda la base.** Con la `anon key` (la que va en el navegador del
   sitio publicado) se leen completo `nna` (1696), `adultos` (1330), `causas` (1975),
   `movimientos` (34721) y `bot_runs` (761). Solo `configuracion` no responde. Hay 16
   `DISABLE ROW LEVEL SECURITY` y **cero** `CREATE POLICY` en los 17 archivos SQL. El repo
   es público.
2. **Credenciales nunca rotadas y duplicadas.** `PJUD_PASSWORD` y
   `SUPABASE_SERVICE_ROLE_KEY` de `OneDrive\Escritorio\causaspro\cargar-tanda.bat:12-15`
   son **idénticas** a las del `.env` vivo (comparadas en memoria, nunca impresas). La
   rotación que exige `DEPLOY.md:96` nunca se hizo y el archivo se sincroniza a la nube.
3. **`DELETE /api/admin/reset`** borra 8 tablas y lo protege el mismo helper que acepta el
   **token por query string** y por coincidencia de 20 caracteres
   (`src/lib/apiAuth.ts:25-38`); el token del reporte es público a propósito. **Hoy no es
   explotable**: de 179 literales tipo token en el bundle publicado, **0** abren la API. Es
   un mecanismo latente, no un agujero abierto.
4. `DEPLOY.md:19` manda correr `db/migraciones/schema-v2.sql`, que **elimina** columnas que
   el código lee (`tiene_traslado_curador`, `ultimo_movimiento`). No ejecutarlo a ciegas.

### 🟠 P1 — Robustez y trazabilidad del bot

- **Ningún run registra las ventanas horarias que usó** (ni en `bot_runs` ni en consola: el
  arranque imprime `Modo` y `Max causas`, nunca el horario). Es lo que impide explicar los
  cortes fuera de ventana. Arreglar esto primero.
  Medido el 11-nov: las tandas **programadas** calzan exactas con el `.env` (`mllt`
  07:17→08:31, `vhko` 13:30 en curso). Las **manuales** no: `tanda-ahora` cortó a las 13:00
  en punto habiendo arrancado a las 11:25, y ninguna ventana de ningún archivo de ninguna
  copia cubre ese tramo (lo revisamos: ningún `.bat` fija `BOT_HORARIOS`, `.env.local` no lo
  tiene). Como `SKIP_HOUR_CHECK` desactiva también el chequeo por causa (`orchestrator.ts:120`
  y `:416`) y esas dos tandas imprimieron "se cerró la ventana", es seguro que **no**
  corrieron con skip: el horario lo traían a mano en la consola, y `loadEnv.ts:69` deja
  ganar al entorno sobre el `.env`. Ese `.bat` ya no existe, así que no se puede probar.
- `retryWithBackoff` (`src/bot/utils/index.ts:216`) **no se llama en ningún lado**: una
  búsqueda que falla no reintenta dentro de la corrida.
- Selectores de CAPTCHA definidos (`src/bot/config/index.ts:94`) y **nunca usados**: el
  bloqueo solo se infiere del texto del error (`src/bot/utils/index.ts:204`). Escalar a
  varios abogados aumenta el riesgo.
- Falsas "no encontradas" por la letra del RIT (regex estricta en `src/bot/modules/search.ts`).
- `searchByYear` sigue limpiando el RUT (`src/bot/modules/search.ts:611`), teoría opuesta a
  la confirmada. Inofensivo mientras `BOT_SEARCH_MODE=rit`.
- Lock de tanda con revisión-escritura no atómicas (`bot-carga-max.bat:20-29`). Y los dos
  lanzadores que dejaron `tanda-ahora-log.txt` / `carga-ahora-log.txt` **no existen como
  `.bat`** en ninguna parte: ni en git ni en la copia viva. Queda solo su output, así que la
  forma en que corrieron esas dos tandas no está escrita en ningún archivo revisable.
- Detalles abiertos desde sep-2026, **re-verificados el 11-nov-2026 sobre los logs**:
  `⚠️ Familia no confirmado en tabla` ya no es de "≈20 s". En `tanda-ahora-log.txt`
  (11-nov, 11:25→13:00) no aparece ni una vez y no hay ningún silencio ≥5 min. En
  `carga-ahora-log.txt` (10-nov) hay **3 silencios que suman 16 h** dentro del mismo paso:
  14 min en `Seleccionando tab Familia`, **586 min** (línea 3702→3703) y **360 min**
  (3704→3705) después de `Tab Familia: link: #familiaTab`, y la corrida cierra con
  `bot_error_familia_fail.png`. Un click en una pestaña se comió media jornada de cola, y
  mientras está colgado el bot **no evalúa el horario**: por eso esa tanda "se cortó" a las
  07:16 del día siguiente. El patrón (una línea y horas de silencio) es más compatible con
  el PC dormido que con el portal lento; revisar la energía de Windows en horas de tanda.

### 🟡 P2 — Reproducibilidad

- `package-lock.json` **sin versionar** (no se puede `npm ci`) y Playwright instalado
  **1.64.1** contra el `^1.44.0` declarado en `package.json:17`: el motor del scraping
  cambia de versión sin que nadie lo elija.
- `v_causas_ranking` redefinida con cuerpo distinto en **6** archivos SQL; sin índice único
  en `nna`/`adultos`; `mv_causas_ranking` refresca cada 15 min (los paneles pueden ir 15 min
  desfasados).
- SQL real hoy: `db/base/` (2) y `db/migraciones/` (13). La instrucción antigua de este
  archivo ("ejecutar `schema-bot.sql` de la raíz") quedó obsoleta: en la raíz solo quedan
  `schema-001-cobertura.sql` y `schema-email-logs.sql`.

### Cerrados

- ✅ Validar end-to-end — HECHO: 5/5 exitosas el 10-sep-2026; revalidado el 11-nov-2026 con
  tandas de 55/100/186 causas al 100 % de éxito.

## Ver también

- `.kiro/steering/bot-errores-conocidos.md` — bitácora de errores del bot y sus soluciones.
