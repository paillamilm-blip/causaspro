# 🤖 CausasPro Bot PJUD

Bot automatizado para consultar causas en la **Oficina Judicial Virtual** del Poder Judicial de Chile.

## ¿Qué hace?

1. **Login** en oficinajudicialvirtual.pjud.cl con tus credenciales
2. **Busca** cada causa por RIT (de tu base de datos)
3. **Extrae**: movimientos, audiencias, resoluciones
4. **Detecta** automáticamente "TRASLADO AL CURADOR" → marca como 🔴 URGENTE
5. **Actualiza** Supabase con los datos frescos del portal
6. **Anti-detección**: 25 causas máximo por sesión, delays aleatorios 30-90s entre consultas

---

## ⚡ Inicio Rápido

### 1. Instalar dependencias
```bash
npm install
npx playwright install chromium
```

### 2. Configurar credenciales
```bash
# En .env.local agregar:
PJUD_RUT=12345678-9
PJUD_PASSWORD=tu_contraseña
```

### 3. Ejecutar
```bash
# Normal (hasta 100 causas cargadas por sesión, invisible)
npm run bot

# Solo urgentes (10 causas, más rápido)
npm run bot:urgent

# Test (5 causas, navegador VISIBLE) — recomendado para la primera prueba
npm run bot:test
```

> Los modos `test` y `urgent` usan `cross-env` para funcionar igual en Windows,
> Mac y Linux.

---

## 🪟 Cómo correrlo en Windows (paso a paso)

1. **Instalar dependencias** (una sola vez):
   ```cmd
   npm install
   npx playwright install chromium
   ```
2. **Crear tu archivo de credenciales** a partir de la plantilla:
   ```cmd
   copy correr-bot-playwright.bat.example correr-bot-playwright.bat
   ```
3. Abre `correr-bot-playwright.bat` con el Bloc de notas y reemplaza los `CAMBIAR_*`:
   - `PJUD_RUT` → tu RUT (ej: `17692174-9`)
   - `PJUD_PASSWORD` → tu contraseña de Clave Única
   - `SUPABASE_SERVICE_ROLE_KEY` → tu service role key (Supabase → Settings → API)
4. **Doble clic** en `correr-bot-playwright.bat` → arranca en modo prueba (5 causas,
   navegador visible). Verás el navegador hacer login, buscar y scrapear.

> ⚠️ **Requisito para que el modo prueba scrapee algo:** el bot revisa las causas
> que YA tienes cargadas en la base de datos (tabla `causas`). Si la BD está vacía,
> el bot hará login pero terminará sin scrapear (logueará "No hay causas cargadas").
> Primero sube tu Excel de causas desde la app. (Alternativa para probar contra todo
> el portal sin causas cargadas: agrega `set BOT_SEARCH_MODE=listado` al `.bat`, pero
> ojo que el listado masivo puede disparar el CAPTCHA — ver bitácora de errores.)

> ⚠️ El `.bat` con tus claves **NO se sube a git** (está en `.gitignore`). Solo se
> versiona el `.bat.example` sin secretos.

### Requisito de base de datos
Antes de la primera corrida, ejecuta en el SQL Editor de Supabase:
- `schema.sql` (tablas base: causas, audiencias, ...)
- `schema-bot.sql` (tablas `movimientos`, `bot_logs`, `bot_runs` + vista de urgencia)

### ⚠️ Si falla la descarga de Chromium (`npx playwright install`)
Si `npx playwright install chromium` da timeout o "Download failure", puedes usar el
**Google Chrome que ya tienes instalado** en vez de descargar el de Playwright:

1. Abre tu `correr-bot-playwright.bat` con el Bloc de notas.
2. Descomenta (quita el `REM `) esta línea:
   ```
   set BOT_USE_SYSTEM_CHROME=1
   ```
3. Guarda y corre el `.bat`. El bot usará tu Chrome del sistema.

> Alternativa avanzada: si el Chrome está en una ruta no estándar, usa
> `set CHROME_PATH=C:\ruta\a\chrome.exe` en vez de `BOT_USE_SYSTEM_CHROME`.

---

## 🔐 Seguridad

- Las credenciales **NUNCA** se guardan en el código
- Usar variables de entorno o GitHub Secrets
- El bot simula comportamiento humano para no ser detectado
- Solo opera en horario laboral chileno (8-18h)

---

## 📅 Ejecución Automática (Cron)

### Opción A: GitHub Actions (RECOMENDADO)
El archivo `.github/workflows/bot-pjud.yml` ejecuta el bot automáticamente:
- **10:00 AM** Chile (Lunes a Viernes)
- **4:00 PM** Chile (Lunes a Viernes)

#### Configurar Secrets en GitHub:
1. Ve a tu repo → Settings → Secrets and variables → Actions
2. Agrega:
   - `PJUD_RUT` = tu RUT
   - `PJUD_PASSWORD` = tu contraseña PJUD
   - `SUPABASE_URL` = https://ggwpikokzhckjpwyltye.supabase.co
   - `SUPABASE_SERVICE_ROLE_KEY` = tu service role key

### Opción B: VPS con crontab
```bash
# Editar crontab
crontab -e

# Agregar (10AM y 4PM Chile):
0 14 * * 1-5 cd /path/to/causaspro && npm run bot >> /var/log/causaspro-bot.log 2>&1
0 20 * * 1-5 cd /path/to/causaspro && npm run bot >> /var/log/causaspro-bot.log 2>&1
```

---

## 🛡️ Anti-Detección

El bot usa múltiples técnicas para parecer un usuario real:

| Técnica | Descripción |
|---------|-------------|
| **Delays aleatorios** | 30-90 segundos entre consultas (distribución no uniforme) |
| **Límite de sesión** | Máximo 25 causas por sesión |
| **Tipeo humano** | Caracteres uno a uno con velocidad variable |
| **Fingerprint** | User-Agent, viewport, plugins, idioma de Chrome real |
| **Horario laboral** | Solo opera 8-18h Chile (lunes a viernes) |
| **Stealth mode** | Oculta `navigator.webdriver`, simula Chrome plugins |

### ⚠️ IMPORTANTE
En julio 2026, un abogado colapsó el sistema con 38.000 escritos automatizados. El PJUD está atento a bots. **NO aumentes el límite de 25 causas por sesión**.

---

## 📊 Semáforo de Urgencia

El bot alimenta el semáforo del dashboard:

| Nivel | Color | Criterio |
|-------|-------|----------|
| 1 | 🔴 | **TRASLADO AL CURADOR** detectado (últimos 30 días) |
| 1 | 🔴 | Audiencia en ≤2 días |
| 2 | 🔴 | Medida cautelar vence en ≤7 días |
| 3 | 🟡 | Audiencia en ≤7 días |
| 4 | 🟡 | TRASLADO AL CURADOR antiguo / Sin actividad >30 días |
| 5 | 🟠 | Sin actividad >15 días |
| 6 | 🟠 | Sin audiencia programada |
| 10 | 🟢 | Sin alertas |

---

## 🗄️ Base de Datos

Antes de usar el bot, ejecutar `schema-bot.sql` en Supabase SQL Editor para crear las tablas:
- `movimientos` - Historial de trámites del PJUD
- `bot_logs` - Log por causa scrapeada
- `bot_runs` - Log por sesión del bot

---

## 🐛 Troubleshooting

| Error | Solución |
|-------|----------|
| "CAPTCHA detectado" | Esperar 1-2 horas y reintentar. Si persiste, hacer login manual 1 vez. |
| "Sesión expirada" | Normal si el bot tarda mucho. Se reintentará en el próximo cron. |
| "Campo RUT no encontrado" | El portal cambió su HTML. Actualizar selectores en `config/index.ts`. |
| "Login fallido" | Verificar credenciales. Probar login manual en el portal. |

---

## 📁 Estructura del Bot

```
src/bot/
├── index.ts              # Entry point + CLI runner
├── types/index.ts        # Interfaces TypeScript
├── config/index.ts       # URLs, selectores, configuración
├── utils/index.ts        # Helpers (delays, parsers, formatters)
└── modules/
    ├── login.ts          # Autenticación OJV (stealth)
    ├── search.ts         # Búsqueda por RIT
    ├── scraper.ts        # Extracción de datos
    ├── detection.ts      # Detección "TRASLADO AL CURADOR"
    ├── supabaseSync.ts   # Sincronización con BD
    └── orchestrator.ts   # Control principal del flujo
```
