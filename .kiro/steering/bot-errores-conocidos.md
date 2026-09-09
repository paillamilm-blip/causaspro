# 🧠 Bitácora de errores conocidos del Bot PJUD

Registro vivo de problemas encontrados en el bot de scraping (portal Oficina Judicial
Virtual — `oficinajudicialvirtual.pjud.cl`) y sus soluciones, para **no repetir el mismo
error dos veces**.

> **Regla:** cada vez que se resuelve un problema nuevo del bot, agregar una entrada aquí
> (y también actualizar el learning global de Kiro). Ordenar de más reciente a más antiguo.
>
> **Formato de cada entrada:** Síntoma → Causa raíz → Solución que FUNCIONÓ → (captura si aplica).

---

## ERROR #5 — 🌐 `ERR_NAME_NOT_RESOLVED` / el portal no responde

**Síntoma:** el bot lanza el navegador, intenta el login y falla con
`page.goto: net::ERR_NAME_NOT_RESOLVED at https://oficinajudicialvirtual.pjud.cl/...`.
Un `ping oficinajudicialvirtual.pjud.cl` responde "no pudo encontrar el host", pero
`ping google.com` sí funciona.

**Causa raíz:** el dominio del PJUD no se resuelve. Puede ser (a) **el portal está caído /
en mantenimiento** (lo más común — le pasa seguido al PJUD), o (b) el DNS del proveedor de
internet no resuelve ese dominio `.cl`.

**Solución que funcionó / diagnóstico:**
1. `ping google.com` → si responde, hay internet; el problema es específico del dominio.
2. `nslookup oficinajudicialvirtual.pjud.cl 8.8.8.8` → si el DNS de Google SÍ lo resuelve,
   el problema es tu DNS local → cambiar DNS a `8.8.8.8` / `8.8.4.4`. Si Google tampoco lo
   resuelve o no abre a mano en el navegador → **el portal está caído: reintentar más tarde.**
3. `ipconfig /flushdns` limpia la caché DNS (probar primero, aunque no siempre basta).

**Importante:** este NO es un error del bot ni del código — el bot funcionó correcto hasta
el punto de conectar. Es conectividad al sitio. **No perder tiempo tocando el bot por esto.**

---

## ERROR #4 — 📥 Chromium de Playwright no se descarga (timeout)

**Síntoma:** `npx playwright install chromium` falla con
`Request to https://cdn.playwright.dev/... timed out after 30000ms` / `Download failure`.
Al correr el bot: `browserType.launch: Executable doesn't exist at ...\ms-playwright\...`.

**Causa raíz:** la descarga de Chromium (~150 MB) se corta por timeout (conexión lenta o
inestable en ese momento).

**Solución que funcionó:** usar el **Google Chrome ya instalado** en el PC en vez de
descargar el de Playwright. En el `.bat` (o env vars):
- `set BOT_USE_SYSTEM_CHROME=1` → el bot usa `channel: 'chrome'` (Chrome del sistema).
- Alternativa: `set CHROME_PATH=C:\ruta\a\chrome.exe` para un ejecutable específico.
(Implementado en `orchestrator.ts`, en el bloque de `chromium.launch`.)
Alternativa secundaria: reintentar `npx playwright install chromium` varias veces / con más
timeout, pero usar el Chrome del sistema es lo que destrabó de inmediato.

---

## ERROR #3 — 🪟 `"cross-env" no se reconoce` (Windows)

**Síntoma:** al correr `npm run bot:test` en Windows: `"cross-env" no se reconoce como un
comando interno o externo`.

**Causa raíz:** dos partes. (a) `cross-env` estaba en `package.json` pero **no se había
corrido `npm install`** después de actualizar el repo (la dependencia no estaba instalada).
(b) Sin `cross-env`, la sintaxis `BOT_MODE=x tsx ...` NO funciona en `cmd.exe` (es sintaxis
Unix); por eso los scripts se envuelven con `cross-env`.

**Solución que funcionó:** correr `npm install` tras cada `git pull` que cambie dependencias.
Regla: **si cambia `package.json`, hay que `npm install`.** Un `git pull` que dice "Already
up to date" NO instala dependencias nuevas por sí solo.

**Nota relacionada:** los scripts `bot:test`/`bot:urgent` pasaban `BOT_MODE=test`/`urgent`,
pero el código solo reconoce `test_single`/`urgent_only` → con los valores viejos caían al
modo producción sin avisar. Corregido en `package.json`.

---

## ERROR #2 — 🤖 Nova Act: enfoque descartado (resolución de pantalla, lentitud, límites)

**Síntoma:** el bot en Python + Nova Act fallaba con `InvalidScreenResolution` en modo
visible, era lento (versión Free con límites), y se intentó un parámetro inexistente
(`ignore_screen_dims_check`).

**Causa raíz / decisión:** Nova Act (IA que maneja el navegador) es lento y de pago a escala,
y su ventaja (adaptarse a sitios que cambian) no se aprovecha en un portal estable como el
PJUD. **Decisión de arquitectura (ver `PLAN-ARQUITECTURA.md`):** el scraping mecánico se hace
con **Playwright** (mapa: rápido, gratis, confiable) y la IA se reserva SOLO para el análisis
(cerebro, espacio pequeño). El bot Python + Nova Act quedó **descartado** (PR #9 cerrado).

**Solución que funcionó:** volver al bot Playwright (`src/bot/`) como bot oficial. No reabrir
el enfoque Nova Act para el scraping.

---

## ERROR #1 — 🔴 CAPTCHA al buscar en el portal

**Síntoma:** el portal muestra un CAPTCHA (o bloquea) durante el login o la búsqueda de
causas. La búsqueda no devuelve resultados o pide verificación humana.

**Causa raíz:** el PJUD detecta comportamiento de bot — búsquedas demasiado rápidas,
demasiadas causas por sesión, o patrón no humano. Contexto: en julio 2026 un abogado
colapsó el sistema con 38.000 escritos automatizados, así que el portal vigila bots
activamente.

**Soluciones / mitigaciones (prevención):**
- ✅ **NO subir** el límite de ~25 causas por sesión (`maxCausasPorSesion`). Es el freno anti-detección más importante.
- ✅ Mantener **delays aleatorios** de 10–25 s (o más) entre acciones (`delayMin`/`delayMax`).
- ✅ Operar **solo en horario laboral chileno (8–18 h)** — el bot ya lo valida (`isWithinAllowedHours`).
- ✅ **Tipeo humano** carácter por carácter con velocidad variable (ya implementado en `login.ts`).
- ✅ Repartir el trabajo en **varias corridas al día** (cron de GitHub Actions) en vez de una masiva.

**Solución (cuando YA apareció el CAPTCHA):**
1. **Esperar 1–2 horas** y reintentar (la marca de sospecha caduca).
2. Si persiste: hacer **login manual una vez** en el navegador con esas credenciales para "limpiar" la marca.
3. Verificar que no se haya subido el límite de causas por sesión sin querer.

**Estado del código:**
- Hay selectores de CAPTCHA en `src/bot/config/index.ts` → `OJV_SELECTORS.captcha`.
- ⚠️ **Pendiente:** la detección *activa* del CAPTCHA en el flujo `login`/`search` no está
  completamente implementada. Hoy el bot puede seguir a ciegas si aparece. Mejora propuesta:
  detectar el selector de CAPTCHA, **abortar la sesión limpiamente** y registrar el motivo
  en `bot_runs` (en vez de fallar de forma opaca o insistir y empeorar el bloqueo).

---

## Notas de arquitectura relevantes al scraping

- **Qué causas revisa el bot (actualizado):** por defecto el bot usa
  `BOT_SEARCH_MODE=rit` → `runBusquedaPorRit`, que lee **solo las causas ya cargadas** en la
  BD (`getCausasToScrape`) y busca cada una por su **RIT individual** (tipo + rol + año).
  Esto evita el CAPTCHA que dispara el listado masivo (~17.500 registros).
- El modo `BOT_SEARCH_MODE=listado` (legacy) lista todo el portal por año; solo usar si se
  necesita descubrir causas nuevas, sabiendo que puede disparar el CAPTCHA (ver ERROR #1).
- **Nunca navegar por URL directa ni `history.back()`** después del login: el portal OJV
  pierde la sesión. Siempre navegar con clicks en los menús internos.

## Cómo correr el bot (recordatorio)

- Windows: usar `correr-bot-playwright.bat` (copia de `.bat.example`, con secretos como env
  vars, NO versionado). Modo prueba: `npm run bot:test` (5 causas, navegador visible).
- Requisitos: `npm install` (incluye `cross-env`) + Chromium (o `BOT_USE_SYSTEM_CHROME=1`).
- Antes de la 1ª corrida: ejecutar `schema.sql` + `schema-bot.sql` en Supabase.

## 📸 Trazabilidad: capturas y logs de errores

- En los **puntos de fallo instrumentados** (login, navegación, error crítico, y el
  detalle de cada causa), el bot toma una **screenshot en ese momento** y guarda la ruta
  junto al registro del error. El nombre incluye el `run_id` y el paso, ej:
  `/tmp/bot_error_<run_id>_login.png`, `..._navegacion.png`, `..._detalle_<rit>.png`.
  Así la captura corresponde exactamente al error registrado (no a otra corrida).
- Además, `login.ts` y `search.ts` generan capturas propias por modo de fallo
  (`bot_error_no_redirect.png`, `bot_error_buscar_<año>.png`, etc.) útiles para depurar.
- Cada corrida y cada error se registran en Supabase:
  - `bot_runs` → resumen de la sesión (total, exitosas, fallidas, `detenido_por`, errores).
  - `bot_logs` → por evento: `paso`, `error`, `screenshot_path`, `run_id`, `rit`, timestamp.
  - Vista `v_bot_errores` → lista los errores recientes de un vistazo.
- **Al depurar un fallo:** mirar `v_bot_errores` (o `bot_logs`) → abrir la screenshot de
  esa fila → buscar el error en esta bitácora. Si es nuevo, documentarlo aquí con su solución.
