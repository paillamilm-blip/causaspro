# CausasPro Bot - agent-browser CLI

Scripts de automatizacion web para el portal [Oficina Judicial Virtual (PJUD)](https://oficinajudicialvirtual.pjud.cl) usando [agent-browser](https://github.com/vercel-labs/agent-browser).

## Requisitos

### 1. Instalar agent-browser

```bash
npm install -g agent-browser
# o
npx agent-browser --help
```

### 2. Variables de entorno

| Variable | Requerida | Descripcion |
|----------|-----------|-------------|
| `PJUD_RUT` | Si | RUT sin puntos, con guion (ej: `17692174-9`) |
| `PJUD_PASSWORD` | Si | Contrasena de Clave Unica |
| `HEADLESS` | No | `1` para modo invisible (default: `0`, visible) |
| `MAX_CAUSAS` | No | Maximo de causas a scrapear (default: `10`) |
| `DELAY_MIN` | No | Delay minimo entre acciones en segundos (default: `5`) |
| `DELAY_MAX` | No | Delay maximo entre acciones en segundos (default: `15`) |
| `PJUD_YEARS` | No | Anos a buscar separados por espacio (default: `"2026 2025 2024"`) |

### 3. Dependencias del sistema

- **bash** (4.0+)
- **python3** (para procesamiento JSON)
- **agent-browser** (CLI global)

## Uso

### Preparar scripts

```bash
cd src/bot/agent-browser
chmod +x *.sh
```

### Flujo completo (recomendado)

```bash
# Ejecutar todo el flujo automatizado
PJUD_RUT=17692174-9 PJUD_PASSWORD=miClave ./orchestrator.sh
```

### Scripts individuales

```bash
# 1. Discovery: explorar la estructura del portal
./discovery.sh

# 2. Login: autenticarse via Clave Unica
PJUD_RUT=17692174-9 PJUD_PASSWORD=miClave ./login-pjud.sh

# 3. Listar causas (requiere login previo)
./list-causas.sh > causas.json

# 4. Scrape detalle de una causa especifica
./scrape-detail.sh C-4875-2025 > detalle.json
```

## Estructura de archivos

```
src/bot/agent-browser/
├── README.md           # Esta documentacion
├── discovery.sh        # Explorar estructura del portal
├── login-pjud.sh       # Login via Clave Unica
├── list-causas.sh      # Listar causas (Familia)
├── scrape-detail.sh    # Scrape detalle de una causa
└── orchestrator.sh     # Flujo completo automatizado
```

### Archivos generados

| Archivo | Ubicacion | Descripcion |
|---------|-----------|-------------|
| State | `./pjud-state.json` | Estado de sesion (reutilizable) |
| Screenshots | `/tmp/pjud-bot/` | Capturas de error/diagnostico |
| Reportes | `/tmp/pjud-bot/reports/` | JSON con resultados completos |

## Funcionamiento

### Sesion compartida

Todos los scripts usan la misma sesion de agent-browser (`pjud`). Esto permite:

- Login una vez, reutilizar en los demas scripts
- El state se guarda en `./pjud-state.json`
- Si el state expira, `login-pjud.sh` re-autentica automaticamente

### Patron de interaccion

Cada script sigue el patron: **snapshot -> refs -> interact -> re-snapshot**

```
1. Abrir pagina / cargar state
2. snapshot: obtener accessibility tree con refs (@eN)
3. Identificar elementos relevantes
4. Interactuar (click, type, fill)
5. wait --load networkidle
6. Re-snapshot para verificar resultado
```

### IMPORTANTE: No usar page.goto()

Despues del login, **NUNCA** se navega con URL directa. El portal PJUD pierde la sesion si se hace `navigate` a una URL. Siempre se usa click en los menus/links internos.

### Deteccion de TRASLADO AL CURADOR

El scraper detecta automaticamente los siguientes patrones en movimientos:

- `TRASLADO AL CURADOR`
- `TRASLADO CURADOR AD LITEM`
- `TRASLADO CURADOR`
- `TRASL. CURADOR`

Si se detecta, se marca como urgente en el reporte.

## Configuracion avanzada

### Modo headless

```bash
HEADLESS=1 PJUD_RUT=xxx PJUD_PASSWORD=yyy ./orchestrator.sh
```

### Limitar causas

```bash
MAX_CAUSAS=3 ./orchestrator.sh
```

### Solo un ano especifico

```bash
PJUD_YEARS="2025" ./list-causas.sh
```

### Delays mas cortos (testing)

```bash
DELAY_MIN=2 DELAY_MAX=5 MAX_CAUSAS=3 ./orchestrator.sh
```

### Delays mas largos (anti-deteccion)

```bash
DELAY_MIN=15 DELAY_MAX=45 ./orchestrator.sh
```

## Troubleshooting

### "No se encontro state"

El script de listado o scrape requiere login previo:

```bash
PJUD_RUT=xxx PJUD_PASSWORD=yyy ./login-pjud.sh
```

### "No se encontro boton Clave Unica"

El portal puede haber cambiado su estructura. Pasos:

1. Ejecutar `./discovery.sh` para ver los refs disponibles
2. Revisar screenshots en `/tmp/pjud-bot/`
3. Puede ser que el portal este en mantenimiento

### "No redigirio a Clave Unica"

Posibles causas:

- Portal PJUD caido o en mantenimiento
- Cambio en la URL de autenticacion
- Popup/modal bloqueando la interaccion

### "Login fallido despues de 3 intentos"

1. Verificar que `PJUD_RUT` y `PJUD_PASSWORD` son correctos
2. Probar manualmente en el navegador
3. Revisar si Clave Unica tiene algun aviso de mantenimiento

### "Tab Familia no encontrado"

El portal PJUD cambia frecuentemente los IDs de sus tabs. El script intenta multiples estrategias:

1. Buscar por ID (`#familiaTab`)
2. Buscar por texto en contenedor de tabs
3. Buscar texto directo "Familia"
4. Buscar por href (`tab7`)

Si todas fallan, revisar el snapshot para identificar la nueva estructura.

### "RIT no encontrado en tabla"

- Verificar que la causa existe en el ano buscado
- Puede requerir ajustar `PJUD_YEARS`
- Ejecutar `./list-causas.sh` para ver causas disponibles

### Screenshots de diagnostico

Todos los screenshots de error se guardan en `/tmp/pjud-bot/`:

```bash
ls -la /tmp/pjud-bot/*.png
```

## Relacion con el bot Playwright

Estos scripts replican la funcionalidad del bot Playwright (`src/bot/modules/`) pero usando agent-browser CLI. La ventaja es que no requieren Node.js ni compilacion TypeScript.

| Modulo Playwright | Script agent-browser |
|-------------------|---------------------|
| `login.ts` | `login-pjud.sh` |
| `search.ts` | `list-causas.sh` |
| `scraper.ts` | `scrape-detail.sh` |
| `detection.ts` | Integrado en `scrape-detail.sh` |
| `orchestrator.ts` | `orchestrator.sh` |
