#!/bin/bash
# ============================================================
# CAUSASPRO - Scrape Detalle de Causa (agent-browser CLI)
# Recibe un RIT como argumento, abre el detalle de esa causa
# y extrae: estado, movimientos, audiencias, resoluciones.
# Detecta TRASLADO AL CURADOR.
#
# Uso: ./scrape-detail.sh <RIT>
#   Ejemplo: ./scrape-detail.sh C-4875-2025
#
# Prerequisito: login-pjud.sh + list-causas.sh (sesion activa)
# Output: JSON con datos completos (stdout)
# ============================================================
set -euo pipefail

# --- Configuracion ---
SESSION="pjud"
STATE_FILE="./pjud-state.json"
ERROR_DIR="/tmp/pjud-bot"
HEADLESS="${HEADLESS:-0}"

# Patrones de TRASLADO AL CURADOR (mismos que detection.ts)
TRASLADO_PATTERNS="TRASLADO AL CURADOR|TRASLADO CURADOR AD LITEM|TRASLADO CURADOR|TRASL\\. CURADOR"

# Crear directorio de errores
mkdir -p "$ERROR_DIR"

# --- Validar argumentos ---
if [ -z "${1:-}" ]; then
  echo "❌ Error: Falta argumento RIT" >&2
  echo "   Uso: ./scrape-detail.sh <RIT>" >&2
  echo "   Ejemplo: ./scrape-detail.sh C-4875-2025" >&2
  exit 1
fi

RIT="$1"

# --- Funciones auxiliares ---
log() {
  echo "[$(date '+%H:%M:%S')] $1" >&2
}

error_screenshot() {
  local label="${1:-error}"
  agent-browser --session "$SESSION" screenshot "$ERROR_DIR/detail-${label}-$(date +%s).png" 2>/dev/null || true
}

# --- Verificar state ---
if [ ! -f "$STATE_FILE" ]; then
  log "❌ No se encontro state. Ejecutar login-pjud.sh primero."
  exit 1
fi

log "🔍 Scraping detalle de causa: $RIT"

# --- PASO 1: Buscar la causa en la tabla y hacer click ---
log "  1️⃣  Buscando $RIT en la tabla..."

CLICK_OK=$(agent-browser --session "$SESSION" eval "
  const rows = document.querySelectorAll('table tr');
  let clicked = false;
  for (const row of rows) {
    const text = row.textContent || '';
    if (text.includes('$RIT')) {
      // Buscar link o boton dentro de la fila
      const link = row.querySelector('a[href], button, .btn');
      if (link) {
        link.click();
        clicked = true;
        break;
      }
      // Si no hay link, intentar click en la primera celda
      const firstTd = row.querySelector('td');
      if (firstTd) {
        firstTd.click();
        clicked = true;
        break;
      }
    }
  }
  clicked;
" 2>/dev/null || echo "false")

if [ "$CLICK_OK" = "false" ]; then
  log "  ❌ No se encontro $RIT en la tabla"
  error_screenshot "rit-not-found"
  echo '{"error": "RIT no encontrado en tabla", "rit": "'"$RIT"'"}' 
  exit 1
fi

# Esperar carga del detalle
agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
sleep 4

log "  ✓ Detalle de $RIT abierto"

# --- PASO 2: Extraer estado actual ---
log "  2️⃣  Extrayendo estado actual..."

ESTADO=$(agent-browser --session "$SESSION" eval "
  let estado = '';
  // Buscar en varios selectores
  const selectors = ['.estado-causa', 'span', 'td', 'dd', 'div'];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const prev = el.previousElementSibling;
      const prevText = prev ? (prev.textContent || '').trim() : '';
      if (prevText.includes('Estado') && el.textContent.trim() && el.textContent.trim() !== 'Estado') {
        estado = el.textContent.trim();
        break;
      }
    }
    if (estado) break;
  }
  // Buscar en dt/dd
  if (!estado) {
    const dts = document.querySelectorAll('dt, th, label');
    for (const dt of dts) {
      if ((dt.textContent || '').trim().includes('Estado')) {
        const next = dt.nextElementSibling;
        if (next) { estado = next.textContent.trim(); break; }
      }
    }
  }
  estado;
" 2>/dev/null || echo "")

log "  ✓ Estado: ${ESTADO:-'(no encontrado)'}"

# --- PASO 3: Extraer movimientos/historial ---
log "  3️⃣  Extrayendo movimientos..."

# Intentar click en tab Historial/Tramitacion
agent-browser --session "$SESSION" eval "
  const tabs = document.querySelectorAll('a, li, button');
  for (const tab of tabs) {
    const text = (tab.textContent || '').trim();
    if (text.includes('Historial') || text.includes('Tramitación') || text.includes('Movimientos')) {
      if (tab.offsetParent !== null) { tab.click(); break; }
    }
  }
" 2>/dev/null || true
sleep 3

MOVIMIENTOS=$(agent-browser --session "$SESSION" eval "
  const movimientos = [];
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('th')).map(th => (th.textContent||'').trim().toLowerCase());
    const hasTramite = headers.some(h => h.includes('trámite') || h.includes('tramite') || h.includes('actuación'));
    if (!hasTramite) continue;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td')).map(td => (td.textContent||'').trim());
      if (cells.length < 2) continue;

      // Detectar fecha (dd/mm/yyyy o dd-mm-yyyy)
      let fecha = '', etapa = '', tramite = '', descripcion = '';
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].match(/\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{4}/)) {
          fecha = cells[i];
          etapa = cells[i+1] || '';
          tramite = cells[i+2] || '';
          descripcion = cells[i+3] || '';
          break;
        }
      }
      if (!fecha && cells.length >= 3) {
        fecha = cells[0]; etapa = cells[1]; tramite = cells[2]; descripcion = cells[3] || '';
      }
      if (fecha || tramite) {
        movimientos.push({fecha, etapa, tramite, descripcion});
      }
    }
    if (movimientos.length > 0) break;
  }
  JSON.stringify(movimientos);
" 2>/dev/null || echo "[]")

MOV_COUNT=$(echo "$MOVIMIENTOS" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")
log "  ✓ $MOV_COUNT movimientos encontrados"

# Delay humanizado
sleep 2

# --- PASO 4: Extraer audiencias ---
log "  4️⃣  Extrayendo audiencias..."

# Click en tab Audiencias
agent-browser --session "$SESSION" eval "
  const tabs = document.querySelectorAll('a, li, button');
  for (const tab of tabs) {
    const text = (tab.textContent || '').trim();
    if (text.includes('Audiencia')) {
      if (tab.offsetParent !== null) { tab.click(); break; }
    }
  }
" 2>/dev/null || true
sleep 3

AUDIENCIAS=$(agent-browser --session "$SESSION" eval "
  const audiencias = [];
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('th')).map(th => (th.textContent||'').trim().toLowerCase());
    const hasAud = headers.some(h => h.includes('audiencia') || h.includes('tipo'));
    if (!hasAud) continue;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td')).map(td => (td.textContent||'').trim());
      if (cells.length < 2) continue;

      let fecha = '', tipo = '', sala = '', estado = '';
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].match(/\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{4}/)) {
          fecha = cells[i];
          tipo = cells[i+1] || '';
          sala = cells[i+2] || '';
          estado = cells[i+3] || '';
          break;
        }
      }
      if (!fecha && cells.length >= 2) {
        fecha = cells[0]; tipo = cells[1]; sala = cells[2] || ''; estado = cells[3] || '';
      }
      if (fecha || tipo) {
        audiencias.push({fecha, tipo, sala, estado});
      }
    }
    if (audiencias.length > 0) break;
  }
  JSON.stringify(audiencias);
" 2>/dev/null || echo "[]")

AUD_COUNT=$(echo "$AUDIENCIAS" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")
log "  ✓ $AUD_COUNT audiencias encontradas"

sleep 2

# --- PASO 5: Detectar TRASLADO AL CURADOR ---
log "  5️⃣  Analizando patrones de urgencia..."

TIENE_TRASLADO=$(echo "$MOVIMIENTOS" | python3 -c "
import sys, json, re
data = json.loads(sys.stdin.read())
patterns = ['TRASLADO AL CURADOR', 'TRASLADO CURADOR AD LITEM', 'TRASLADO CURADOR', 'TRASL. CURADOR']
found = False
for mov in data:
    full_text = ' '.join([mov.get('tramite',''), mov.get('descripcion',''), mov.get('etapa','')]).upper()
    for pattern in patterns:
        if pattern in full_text:
            found = True
            break
    if found:
        break
print('true' if found else 'false')
" 2>/dev/null || echo "false")

if [ "$TIENE_TRASLADO" = "true" ]; then
  log "  🔴 ¡TRASLADO AL CURADOR DETECTADO!"
else
  log "  ✓ Sin traslado al curador"
fi

# --- PASO 6: Generar JSON de salida ---
log "  6️⃣  Generando JSON de salida..."

OUTPUT=$(python3 -c "
import json, sys
from datetime import datetime

movimientos = json.loads('''$MOVIMIENTOS''')
audiencias = json.loads('''$AUDIENCIAS''')

result = {
    'rit': '$RIT',
    'estado_actual': '$ESTADO' if '$ESTADO' else None,
    'tiene_traslado_curador': $TIENE_TRASLADO,
    'fecha_scraping': datetime.now().isoformat(),
    'movimientos': movimientos,
    'audiencias': audiencias,
    'total_movimientos': len(movimientos),
    'total_audiencias': len(audiencias)
}

print(json.dumps(result, ensure_ascii=False, indent=2))
" 2>/dev/null)

if [ -z "$OUTPUT" ]; then
  # Fallback si python3 falla
  OUTPUT="{\"rit\":\"$RIT\",\"estado_actual\":\"$ESTADO\",\"tiene_traslado_curador\":$TIENE_TRASLADO,\"movimientos\":$MOVIMIENTOS,\"audiencias\":$AUDIENCIAS}"
fi

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✅ SCRAPE COMPLETADO: $RIT"
log "   Estado: ${ESTADO:-'N/A'}"
log "   Movimientos: $MOV_COUNT | Audiencias: $AUD_COUNT"
if [ "$TIENE_TRASLADO" = "true" ]; then
  log "   🔴 TRASLADO AL CURADOR: SI"
else
  log "   ✓ Traslado al curador: No"
fi
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Output JSON a stdout
echo "$OUTPUT"

# --- PASO 7: Volver a la lista (para permitir scrape de otra causa) ---
log "  ↩️  Volviendo a la lista..."
agent-browser --session "$SESSION" eval "window.history.back()" 2>/dev/null || true
agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
sleep 3
