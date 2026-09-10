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
- **Bot:** Playwright + TypeScript, se ejecuta con `tsx` (`src/bot/`). Corre en la PC Windows
  del usuario (`correr-bot-playwright.bat`, modo `test_single`) y en GitHub Actions
  (`.github/workflows/bot-pjud.yml`).
- **BD:** Supabase (Postgres). Schemas en la raíz: `schema*.sql`.
- **Email:** módulo IMAP (`src/email/`) para sincronizar asignaciones.

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
- Los **RIT del usuario NO tienen letra** (solo número-año, ej. `249240-2023`).
- El **campo RUT se llena solo** (RUT del curador) y **NO hay que tocarlo**.

## Estado del bot (búsqueda por RIT — `searchByRitExacto`)

Flujo implementado tras los PRs #16–#21:
`Familia → Filtros → (RUT intacto) → Tipo 5/5 → Estado 12/12 → Rol → Año → Buscar (con scroll + reintento)`.

- `parseRIT` acepta RIT con letra y **sin letra** (número-año).
- Matching por componentes (letra opcional + número + año); **fail-closed** ante ambigüedad.
- Diagnóstico: capturas en `bot-capturas/` (cross-OS) + volcado `[DIAG]` del portal cuando
  una búsqueda falla (desactivable con `BOT_DIAG=0`, así lo hace el CI).

## Historial de decisiones y avances (reciente → antiguo)

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

- Validar end-to-end que el bot ya extrae las 5 causas reales del usuario (esperando el log
  de la próxima corrida).
- `searchByYear` sigue limpiando el RUT (teoría opuesta a la confirmada) — corregir si se
  reactiva la búsqueda por año.
- Ejecutar en Supabase, en orden: `schema-bot.sql` → `schema-qa-trazabilidad.sql` →
  `schema-bot-aprendizaje.sql` (este último trae la columna `bloqueo_detectado`).

## Ver también

- `.kiro/steering/bot-errores-conocidos.md` — bitácora de errores del bot y sus soluciones.
