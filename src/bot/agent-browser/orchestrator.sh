#!/bin/bash
# ============================================================
# CAUSASPRO - Orchestrator (agent-browser CLI)
# Script maestro que ejecuta el flujo completo:
#   1. Login (o reutiliza state)
#   2. Lista causas
#   3. Para cada causa: scrape detalle
#   4. Genera reporte completo
#
# Variables de entorno:
#   PJUD_RUT        - RUT (requerido)
#   PJUD_PASSWORD   - Contrasena (requerido)
#   MAX_CAUSAS      - Maximo de causas a scrapear (default: 10)
#   DELAY_MIN       - Delay minimo entre acciones en segundos (default: 5)
#   DELAY_MAX       - Delay maximo entre acciones en segundos (default: 15)
#   PJUD_YEARS      - Anos a buscar (default: "2026 2025 2024")
#   HEADLESS        - 1 para modo headless (default: 0)
# ============================================================
set -euo pipefail

# --- Configuracion ---
SESSION="pjud"
STATE_FILE="./pjud-state.json"
ERROR_DIR="/tmp/pjud-bot"
REPORT_DIR="/tmp/pjud-bot/reports"
MAX_CAUSAS="${MAX_CAUSAS:-10}"
DELAY_MIN="${DELAY_MIN:-5}"
DELAY_MAX="${DELAY_MAX:-15}"
HEADLESS="${HEADLESS:-0}"

# Directorio de este script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Crear directorios
mkdir -p "$ERROR_DIR" "$REPORT_DIR"

# Timestamp para reporte
RUN_ID="$(date +%Y%m%d_%H%M%S)"
REPORT_FILE="$REPORT_DIR/reporte-$RUN_ID.json"

# --- Funciones auxiliares ---
log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

error_screenshot() {
  local label="${1:-error}"
  agent-browser --session "$SESSION" screenshot "$ERROR_DIR/orch-${label}-$(date +%s).png" 2>/dev/null || true
}

# Delay humanizado (aleatorio entre min y max)
human_delay() {
  local min="${1:-$DELAY_MIN}"
  local max="${2:-$DELAY_MAX}"
  local delay
  delay=$(python3 -c "import random; print(random.randint($min, $max))" 2>/dev/null || echo "$min")
  log "  ⏳ Esperando ${delay}s..."
  sleep "$delay"
}

# --- Validar variables de entorno ---
if [ -z "${PJUD_RUT:-}" ]; then
  echo "❌ Error: Variable PJUD_RUT no definida" >&2
  echo "   Uso: PJUD_RUT=xxx PJUD_PASSWORD=yyy ./orchestrator.sh" >&2
  exit 1
fi

if [ -z "${PJUD_PASSWORD:-}" ]; then
  echo "❌ Error: Variable PJUD_PASSWORD no definida" >&2
  exit 1
fi

# --- INICIO ---
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "🤖 CAUSASPRO Bot (agent-browser) - Sesion $RUN_ID"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "   Max causas: $MAX_CAUSAS"
log "   Delay: ${DELAY_MIN}s - ${DELAY_MAX}s"
log "   Headless: $HEADLESS"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

# Contadores
TOTAL=0
EXITOSAS=0
FALLIDAS=0
ERRORES=""
START_TIME=$(date +%s)

# --- PASO 1: Login ---
log "═══════════════════════════════════════"
log "📌 PASO 1: Login"
log "═══════════════════════════════════════"

if ! bash "$SCRIPT_DIR/login-pjud.sh"; then
  log "❌ Login fallido. Abortando."
  error_screenshot "login-failed"

  # Generar reporte de error
  python3 -c "
import json
from datetime import datetime
report = {
    'run_id': '$RUN_ID',
    'started_at': datetime.now().isoformat(),
    'finished_at': datetime.now().isoformat(),
    'status': 'LOGIN_FAILED',
    'total_causas': 0,
    'procesadas': 0,
    'exitosas': 0,
    'fallidas': 0,
    'errores': ['Login fallido']
}
with open('$REPORT_FILE', 'w') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true

  log "📄 Reporte: $REPORT_FILE"
  exit 1
fi

human_delay 3 7

# --- PASO 2: Listar causas ---
log ""
log "═══════════════════════════════════════"
log "📌 PASO 2: Listar causas"
log "═══════════════════════════════════════"

CAUSAS_JSON=$(bash "$SCRIPT_DIR/list-causas.sh" 2>/dev/null || echo "[]")

TOTAL=$(echo "$CAUSAS_JSON" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

if [ "$TOTAL" = "0" ]; then
  log "⚠️  No se encontraron causas. Verificar portal."
  error_screenshot "no-causas"
fi

log "📋 Total causas encontradas: $TOTAL"
log "   Procesando hasta $MAX_CAUSAS..."

human_delay 3 5

# --- PASO 3: Scrape de cada causa ---
log ""
log "═══════════════════════════════════════"
log "📌 PASO 3: Scrape de detalles"
log "═══════════════════════════════════════"

# Obtener lista de RITs
RITS=$(echo "$CAUSAS_JSON" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
for causa in data[:$MAX_CAUSAS]:
    print(causa.get('rit', ''))
" 2>/dev/null || echo "")

# Almacenar resultados
ALL_DETAILS="[]"
COUNTER=0
URGENTES=""

while IFS= read -r RIT; do
  [ -z "$RIT" ] && continue
  COUNTER=$((COUNTER + 1))

  log ""
  log "  [$COUNTER/$MAX_CAUSAS] Scraping: $RIT"
  log "  ─────────────────────────────────────"

  # Intentar scrape con reintento
  DETAIL=""
  for attempt in 1 2 3; do
    DETAIL=$(bash "$SCRIPT_DIR/scrape-detail.sh" "$RIT" 2>/dev/null || echo "")
    if [ -n "$DETAIL" ] && echo "$DETAIL" | python3 -c "import sys,json; json.loads(sys.stdin.read())" 2>/dev/null; then
      break
    fi
    log "  ⚠️  Intento $attempt fallido. Reintentando..."
    sleep 5
    DETAIL=""
  done

  if [ -n "$DETAIL" ]; then
    # Verificar si tiene error
    HAS_ERROR=$(echo "$DETAIL" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('true' if 'error' in d else 'false')" 2>/dev/null || echo "true")

    if [ "$HAS_ERROR" = "true" ]; then
      FALLIDAS=$((FALLIDAS + 1))
      ERROR_MSG=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('error','unknown'))" 2>/dev/null || echo "unknown")
      ERRORES="${ERRORES}${RIT}: ${ERROR_MSG}\n"
      log "  ❌ Error: $ERROR_MSG"
    else
      EXITOSAS=$((EXITOSAS + 1))

      # Verificar TRASLADO AL CURADOR
      TRASLADO=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tiene_traslado_curador', False))" 2>/dev/null || echo "False")
      if [ "$TRASLADO" = "True" ]; then
        URGENTES="${URGENTES}${RIT}\n"
        log "  🔴 URGENTE: TRASLADO AL CURADOR en $RIT"
      fi

      log "  ✅ Scrape exitoso"
    fi

    # Agregar al array de detalles
    ALL_DETAILS=$(echo "$ALL_DETAILS" | python3 -c "
import sys, json
existing = json.loads(sys.stdin.read())
new_item = json.loads('''$DETAIL''')
existing.append(new_item)
print(json.dumps(existing))
" 2>/dev/null || echo "$ALL_DETAILS")
  else
    FALLIDAS=$((FALLIDAS + 1))
    ERRORES="${ERRORES}${RIT}: scrape fallido\n"
    log "  ❌ Scrape fallido (sin output)"
  fi

  # Verificar si alcanzamos el maximo
  if [ $COUNTER -ge "$MAX_CAUSAS" ]; then
    log ""
    log "  ⏹️  Limite de $MAX_CAUSAS causas alcanzado"
    break
  fi

  # Delay humanizado entre causas
  human_delay

done <<< "$RITS"

# --- PASO 4: Generar reporte final ---
log ""
log "═══════════════════════════════════════"
log "📌 PASO 4: Generando reporte"
log "═══════════════════════════════════════"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

python3 -c "
import json
from datetime import datetime

causas = json.loads('''$(echo "$CAUSAS_JSON" | head -c 50000)''')
detalles = json.loads('''$(echo "$ALL_DETAILS" | head -c 100000)''')

report = {
    'run_id': '$RUN_ID',
    'started_at': datetime.fromtimestamp($START_TIME).isoformat(),
    'finished_at': datetime.fromtimestamp($END_TIME).isoformat(),
    'duracion_segundos': $DURATION,
    'status': 'COMPLETADO',
    'config': {
        'max_causas': $MAX_CAUSAS,
        'delay_min': $DELAY_MIN,
        'delay_max': $DELAY_MAX,
        'headless': '$HEADLESS' == '1'
    },
    'resumen': {
        'total_causas_portal': len(causas),
        'procesadas': $COUNTER,
        'exitosas': $EXITOSAS,
        'fallidas': $FALLIDAS,
    },
    'urgentes': [d.get('rit') for d in detalles if d.get('tiene_traslado_curador')],
    'causas_portal': causas,
    'detalles_scrapeados': detalles,
    'errores': [e for e in '''$(echo -e "$ERRORES")'''.strip().split('\n') if e]
}

with open('$REPORT_FILE', 'w') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)

print(json.dumps(report['resumen'], indent=2))
" 2>/dev/null || log "⚠️  Error generando reporte JSON"

# --- Resumen final ---
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "📊 RESUMEN - Sesion $RUN_ID"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "   Total en portal:  $TOTAL"
log "   Procesadas:       $COUNTER"
log "   Exitosas:         $EXITOSAS"
log "   Fallidas:         $FALLIDAS"
log "   Duracion:         ${DURATION}s"
log ""

if [ -n "$URGENTES" ]; then
  log "   🔴 CAUSAS URGENTES (TRASLADO AL CURADOR):"
  echo -e "$URGENTES" | while read -r u; do
    [ -n "$u" ] && log "      - $u"
  done
  log ""
fi

log "   📄 Reporte completo: $REPORT_FILE"
log "   📷 Screenshots: $ERROR_DIR/"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Exit con error si hubo mas del 50% de fallos
if [ $COUNTER -gt 0 ] && [ $FALLIDAS -gt $((COUNTER / 2)) ]; then
  log "⚠️  Mas del 50% de causas fallaron"
  exit 1
fi

exit 0
