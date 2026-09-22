# 🤖 CausasPro Bot PJUD

Bot automatizado para consultar causas en la **Oficina Judicial Virtual** (OJV) del
Poder Judicial de Chile y volcar los datos al panel de CausasPro.

> ✅ **Estado (sep 2026): FUNCIONANDO.** Este bot (Playwright/TypeScript, `npm run bot`)
> es el que se usa en producción. Escrapeó correctamente muchas causas **entre el 12 y el
> 17 de septiembre de 2026**, después de que se corrigieran los 9 bugs históricos del
> flujo de Familia (ver "Historia" más abajo). **No usar** ningún otro bot: el intento con
> Nova Act (Python) quedó descartado y nunca se integró al repo.

---

## ¿Qué hace?

1. **Login** en oficinajudicialvirtual.pjud.cl con Clave Única (RUN + contraseña).
2. Entra a **Mis Causas → pestaña Familia** (no Corte Suprema).
3. Activa **Filtros** → Tipo Causa "Seleccionar Todos" → Estado "Seleccionar Todos" →
   escribe el **Año** → **Buscar**.
4. **Extrae** por causa: movimientos (fecha/etapa/trámite/descripción), y de ahí deriva
   audiencias y resoluciones.
5. **Detecta** "TRASLADO AL CURADOR" → lo marca como 🔴 urgente.
6. **Actualiza** Supabase con los datos frescos.
7. **Anti-detección**: límite de causas por sesión, delays aleatorios (10–25 s), tipeo
   humano, fingerprint de Chrome real, horario laboral opcional.

---

## 🚀 Cómo correrlo — PASO A PASO (Windows, terminal `cmd`)

> Se corre **localmente** en la PC de Paula. El portal PJUD **bloquea IPs de nube**
> (GitHub Actions / servidores), por eso NO se puede correr en la nube.

### Paso 0 — Requisitos (una sola vez en la PC)
Instalar, si no están:
- **Git** → https://git-scm.com/download/win
- **Node.js LTS** (incluye `npm` y `npx`) → https://nodejs.org

Verificar en una terminal `cmd`:
```cmd
node -v
npm -v
git --version
```
Si los tres responden con un número de versión, está OK.

### Paso 1 — Traer el proyecto y el código más nuevo
```cmd
cd %USERPROFILE%\Desktop
git clone https://github.com/paillamilm-blip/causaspro.git
cd causaspro
```
Si ya lo tenías clonado, en su lugar:
```cmd
cd %USERPROFILE%\Desktop\causaspro
git pull
```

### Paso 2 — Instalar dependencias (una sola vez)
```cmd
npm install
npx playwright install chromium
```
> Si `npx playwright install chromium` falla con timeout / "Download failure", NO pasa
> nada: más abajo (Paso 5) se explica usar el Chrome que ya tenés instalado.

### Paso 3 — Preparar la base de datos (una sola vez, en Supabase)
En **Supabase → SQL Editor**, ejecutar (si no se hizo antes):
- `schema.sql` (tablas base: causas, nna, adultos, audiencias, …)
- `schema-bot.sql` (tablas `movimientos`, `bot_logs`, `bot_runs` + vista de urgencia)

### Paso 4 — Crear tu `.bat` con tus datos
```cmd
copy bot-100-causas.bat.example bot-100-causas.bat
notepad bot-100-causas.bat
```
En el Bloc de notas, reemplazar los `CAMBIAR_*`:
- `PJUD_RUT` → tu RUT (ej: `17692174-9`)
- `PJUD_PASSWORD` → tu contraseña de Clave Única
- `SUPABASE_SERVICE_ROLE_KEY` → tu service role key (Supabase → Settings → API)

Guardar y cerrar.

> ⚠️ El `.bat` con tus claves **NO se sube a git** (está en `.gitignore`). Solo se
> versiona `bot-100-causas.bat.example` (sin secretos).

### Paso 5 — (Recomendado) Probar con pocas causas ANTES de largar las 100
Para confirmar que el login y el scraping andan, corré una prueba visible (5 causas,
navegador a la vista):
```cmd
set PJUD_RUT=tu-rut
set PJUD_PASSWORD=tu-clave
set NEXT_PUBLIC_SUPABASE_URL=https://ggwpikokzhckjpwyltye.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
set SKIP_HOUR_CHECK=1
npm run bot:test
```
Vas a ver el navegador hacer login, entrar a Familia, buscar y leer causas. Si eso anda,
seguí con el Paso 6.

> Si la descarga de Chromium falló en el Paso 2, agregá antes de `npm run bot:test`:
> ```cmd
> set BOT_USE_SYSTEM_CHROME=1
> ```
> (usa tu Google Chrome instalado). Si tu Chrome está en una ruta rara:
> `set CHROME_PATH=C:\ruta\a\chrome.exe`

### Paso 6 — Correr las 100 causas (4 tandas de 33, descanso de 30 min)
**Doble clic** en `bot-100-causas.bat` (o desde la terminal: `bot-100-causas.bat`).
- Corre 4 tandas de **33 causas** con **30 minutos de descanso** entre cada una.
- **NO cierres la ventana negra** hasta que diga `PROCESO COMPLETO` (tarda varias horas
  por los descansos).
- Para detener antes: `Ctrl + C`.

Al terminar, revisá el panel en **https://causaspro.vercel.app**.

---

## 🔁 Uso diario (una vez cargada la base): `bot-mantenimiento.bat`

`bot-100-causas.bat` es para la **carga inicial** (llenar las ~647 de cero, en pocos días).
Cuando la base ya está cargada, para el **día a día** usá `bot-mantenimiento.bat`:

- Corre **UNA tanda de 25 causas** (trae las nuevas + refresca las más viejas).
- **Solo corre entre 8 y 18 h (hora Chile)**: fuera de ese horario se auto-cancela.
  Correr "de día, como una persona" reduce el riesgo de que el portal marque el bot.
- Bajo perfil: sin ráfagas de 100. Ideal **1 vez al día**.

Configuración (una sola vez):
```cmd
copy bot-mantenimiento.bat.example bot-mantenimiento.bat
notepad bot-mantenimiento.bat
```
Poné tus datos (RUT, clave, service role key), guardá, y doble clic cada día.

> Comparte el mismo lock que `bot-100-causas.bat`, así **nunca** corren los dos a la vez.

> ⚠️ **Volumen y detección:** para la carga inicial, 100/día está OK por unos días (mejor
> con algún día de descanso). Para el uso normal, 25/día en horario laboral es mucho más
> seguro. Si ves "CAPTCHA detectado" o la tasa se desploma, cerrá el bot ese día y retomá
> al siguiente.

---

## ⚙️ Ajustes del `.bat` (opcional)

| Querés… | Editá en `bot-100-causas.bat` |
|---|---|
| Cambiar el tamaño de tanda | `set BOT_MAX_CAUSAS=33` |
| Cambiar el descanso | los `timeout /t 1800` (1800 s = 30 min) |
| Más / menos tandas | copiá o borrá un bloque `==== TANDA N ====` |
| Correr solo en horario laboral (8–18h Chile) | poné `REM ` adelante de `set SKIP_HOUR_CHECK=1` |
| Usar tu Chrome instalado | descomentá `set BOT_USE_SYSTEM_CHROME=1` |

**Seguridad incorporada:**
- **Lock anti-solape** (`bot-100-causas.lock`): si una tanda aún corre, no arranca otra
  → nunca dos bots del mismo RUT a la vez.
- Los descansos de 30 min entre tandas espacian la actividad (menos marca de bot).

> ⚠️ Si Paula usa el **portal del PJUD** (no el dashboard) al mismo tiempo, pueden pisarse
> la sesión. El dashboard (causaspro.vercel.app) NO toca el PJUD, así que puede usarlo sin
> problema mientras corren las tandas.
> Si aparece **CAPTCHA** o la tasa se desploma: **cerrá el bot** ese día y retomá al
> siguiente (el descanso "limpia" la marca de bot).

---

## 🧑‍💻 Comandos de terminal (referencia rápida)

```cmd
npm run bot          :: corrida normal (hasta 100 causas cargadas, invisible)
npm run bot:test     :: prueba: 5 causas, navegador VISIBLE (primera vez)
npm run bot:urgent   :: solo causas urgentes (más rápido)
```
> `test` y `urgent` usan `cross-env`, así funcionan igual en Windows, Mac y Linux.

Variables de entorno que reconoce el bot:

| Variable | Para qué |
|---|---|
| `PJUD_RUT`, `PJUD_PASSWORD` | Credenciales Clave Única |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Conexión a la base |
| `BOT_MAX_CAUSAS` | Máx. causas por tanda (el `.bat` usa 33) |
| `SKIP_HOUR_CHECK=1` | Ignorar el chequeo de horario (correr a cualquier hora) |
| `BOT_USE_SYSTEM_CHROME=1` | Usar el Chrome instalado en vez del de Playwright |
| `CHROME_PATH=...` | Ruta explícita a chrome.exe |
| `BOT_MAX_DETAILS` | Máx. de detalles a scrapear por sesión (default 50) |

---

## 📊 Semáforo de Urgencia (lo que alimenta el panel)

| Nivel | Color | Criterio |
|-------|-------|----------|
| 1 | 🔴 | **TRASLADO AL CURADOR** (≤30 días) o audiencia en ≤2 días |
| 2 | 🔴 | Medida cautelar vence en ≤7 días |
| 3 | 🟡 | Audiencia en ≤7 días o movimiento nuevo (≤7 días) |
| 4 | 🟣 | Traslado al curador (a revisar) |
| 6 | 🟠 | Sin movimiento hace más de 90 días (estancada) |
| 10 | 🟢 | Sin alertas |

> El **seguimiento del NNA vencido** (>180 días sin "Entrevista al NNA" o nunca) es un
> corte transversal aparte, marcado en rosa en el panel.

---

## 🕓 Historia — por qué HOY funciona

El bot Playwright tuvo, en sus primeras versiones, 9 bugs que lo hacían fallar contra el
portal (la pestaña Familia no cargaba, el botón Buscar reseteaba a Corte Suprema, la
sesión se destruía, etc.). Esos bugs se corrigieron en una tanda de PRs (#23 → #61), y a
partir de ahí el bot **funcionó de forma estable y escrapeó muchas causas entre el 12 y
el 17 de septiembre de 2026**. Los fixes clave, ya presentes en el código:

- **Anclar la búsqueda al panel de Familia** usando el enlace real `#familiaTab` /
  `a[href="#tab7"]`, con métodos de respaldo (fix del bug "quedaba en Corte Suprema").
- **Toggle "Filtros"** activado por texto, con reintentos y verificación de estado.
- **Tipo Causa / Estado** tratados como `<select multiple>` nativo → "Seleccionar Todos".
- **Extraer movimientos de Familia** mapeando columnas por encabezado.
- **Cola de scraping** que prioriza causas sin datos y salta el ruido ya confirmado
  (por eso avanza rápido en tandas).
- **Blindaje anti-loop** para tandas desatendidas (cuarentena revisable).

> El intento con **Nova Act (Python)** se probó pero **se descartó**; su código nunca se
> integró al repo. El bot vigente y soportado es **este** (Playwright, `npm run bot`).

---

## 🛡️ Anti-Detección

| Técnica | Descripción |
|---------|-------------|
| **Delays aleatorios** | 10–25 s entre consultas |
| **Límite de sesión** | Por tanda (el `.bat` usa 33; el máximo por defecto es 100) |
| **Tipeo humano** | Caracteres uno a uno con velocidad variable |
| **Fingerprint** | User-Agent, viewport, idioma de un Chrome real |
| **Horario laboral** | 8–18h Chile (se puede omitir con `SKIP_HOUR_CHECK=1`) |
| **Stealth** | Oculta `navigator.webdriver`, simula plugins de Chrome |

> ⚠️ En julio 2026 un abogado colapsó el sistema con 38.000 escritos automatizados: el
> PJUD está atento a bots. Mantené tandas moderadas y los descansos entre ellas.

---

## 🐛 Troubleshooting

| Error | Solución |
|-------|----------|
| "CAPTCHA detectado" | Cerrar el bot, esperar 1–2 horas (o al día siguiente) y reintentar. |
| "No hay causas cargadas" | La tabla `causas` está vacía → subí tu Excel desde la app primero. |
| "Fuera de horario permitido" | Agregá `set SKIP_HOUR_CHECK=1` (ya viene en el `.bat`). |
| Descarga de Chromium falla | `set BOT_USE_SYSTEM_CHROME=1` (usa tu Chrome instalado). |
| "Login fallido" | Verificá RUT/clave. Probá login manual en el portal 1 vez. |
| Queda en "Corte Suprema" / 0 resultados | Reintentar; el bot ancla a `#familiaTab`. Si persiste, el portal cambió el HTML → avisar. |

---

## 📁 Estructura del Bot

```
src/bot/
├── index.ts              # Entry point + CLI runner (lee BOT_MODE, BOT_MAX_CAUSAS)
├── types/index.ts        # Interfaces TypeScript
├── config/index.ts       # URLs, selectores, configuración (delays, límites)
├── utils/index.ts        # Helpers (delays, parsers, formatters)
└── modules/
    ├── login.ts          # Autenticación OJV (Clave Única, stealth)
    ├── search.ts         # Mis Causas → Familia → Filtros → Buscar (los 9 fixes)
    ├── scraper.ts        # Extracción de datos (movimientos → audiencias/resoluciones)
    ├── detection.ts      # Detección "TRASLADO AL CURADOR"
    ├── supabaseSync.ts   # Sincronización con Supabase
    └── orchestrator.ts   # Control principal del flujo
```
