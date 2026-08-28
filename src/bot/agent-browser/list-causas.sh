#!/bin/bash
# ============================================================
# CAUSASPRO - Listar Causas (agent-browser CLI)
# Despues del login, navega a "Mis Causas" > tab "Familia"
# y lista todas las causas por ano.
#
# Prerequisito: ejecutar login-pjud.sh primero
# Output: JSON con causas encontradas (stdout)
# ============================================================
set -euo pipefail

# --- Configuracion ---
SESSION="pjud"
STATE_FILE="./pjud-state.json"
ERROR_DIR="/tmp/pjud-bot"
HEADLESS="${HEADLESS:-0}"
# Anos a buscar (configurable)
YEARS="${PJUD_YEARS:-2026 2025 2024}"

# Crear directorio de errores
mkdir -p "$ERROR_DIR"

# --- Funciones auxiliares ---
log() {
  echo "[$(date '+%H:%M:%S')] $1" >&2
}

error_screenshot() {
  local label="${1:-error}"
  agent-browser --session "$SESSION" screenshot "$ERROR_DIR/list-${label}-$(date +%s).png" 2>/dev/null || true
}

# --- Verificar state ---
if [ ! -f "$STATE_FILE" ]; then
  log "❌ No se encontro state. Ejecutar login-pjud.sh primero."
  exit 1
fi

log "📂 State cargado: $STATE_FILE"

# --- PASO 1: Navegar a "Mis Causas" ---
log "📋 Navegando a 'Mis Causas'..."

# IMPORTANTE: NO usar navigate/goto directo porque pierde la sesion.
# En su lugar, hacer click en el menu.
agent-browser --session "$SESSION" eval "
  const links = document.querySelectorAll('a');
  let clicked = false;
  for (const link of links) {
    const text = (link.textContent || '').trim();
    if (text === 'Mis Causas' || text === 'Mis causas') {
      link.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    const altLinks = document.querySelectorAll('a[href*=\"indexN\"], a[href*=\"mis_causas\"]');
    if (altLinks.length > 0) { altLinks[0].click(); clicked = true; }
  }
  clicked;
" 2>/dev/null || true

agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
sleep 5

# --- PASO 2: Click en tab "Familia" ---
log "👨‍👩‍👧 Seleccionando tab 'Familia'..."

# Intentar multiples estrategias para encontrar el tab
agent-browser --session "$SESSION" eval "
  let found = false;

  // Estrategia 1: Buscar en contenedor con tabs conocidos
  const containers = document.querySelectorAll('ul, nav, div, ol');
  for (const container of containers) {
    const text = container.textContent || '';
    if (text.includes('Corte Suprema') && text.includes('Civil') && text.includes('Familia')) {
      const children = container.querySelectorAll('a, li, button, span, div');
      for (const child of children) {
        const childText = (child.textContent || '').trim();
        if (childText === 'Familia') {
          child.click();
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // Estrategia 2: Buscar por ID
  if (!found) {
    const familiaTab = document.querySelector('#familiaTab, a[href*=\"tab7\"], a[id*=\"familia\"]');
    if (familiaTab) { familiaTab.click(); found = true; }
  }

  // Estrategia 3: Buscar texto directo 'Familia' en cualquier elemento clickeable
  if (!found) {
    const allElements = document.querySelectorAll('a, button, li, span');
    for (const el of allElements) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent?.trim())
        .join('');
      if (directText === 'Familia') {
        el.click();
        found = true;
        break;
      }
    }
  }

  found;
" 2>/dev/null || true

sleep 5

# Verificar que estamos en Familia (buscar indicadores en tabla)
FAMILIA_OK=$(agent-browser --session "$SESSION" eval "
  const tables = document.querySelectorAll('table');
  let found = false;
  for (const table of tables) {
    const text = table.textContent || '';
    if (text.includes('Juzgado de Familia') || text.includes('Familia Santiago') ||
        text.includes('Familia San Miguel') || text.includes('Centro de Medidas Cautelares')) {
      found = true;
      break;
    }
  }
  found;
" 2>/dev/null || echo "false")

if [ "$FAMILIA_OK" = "false" ]; then
  log "⚠️  Tab Familia no confirmado. Reintentando click..."
  # Reintentar click
  agent-browser --session "$SESSION" eval "
    const els = document.querySelectorAll('a, li, button, span');
    for (const el of els) {
      if ((el.textContent || '').trim() === 'Familia') { el.click(); break; }
    }
  " 2>/dev/null || true
  sleep 5
fi

# --- PASO 3: Leer tabla de causas ---
log "📊 Extrayendo datos de la tabla..."

# Funcion para leer la tabla actual
read_table() {
  agent-browser --session "$SESSION" eval "
    const rows = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const headers = table.querySelectorAll('th');
      let isCorrect = false;
      for (const th of headers) {
        const text = (th.textContent || '').trim().toLowerCase();
        if (text.includes('rit') || text.includes('rol')) { isCorrect = true; break; }
      }
      if (!isCorrect) continue;

      const trs = table.querySelectorAll('tbody tr, tr');
      for (const tr of trs) {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 4) continue;

        const cells = Array.from(tds).map(td => (td.textContent || '').trim());
        let rit = '', startIdx = 0;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].match(/^[A-Z]?-?\\d+-\\d{4}$/)) {
            rit = cells[i];
            startIdx = i;
            break;
          }
        }
        if (!rit) continue;

        rows.push({
          rit: rit,
          tribunal: cells[startIdx + 1] || '',
          caratulado: cells[startIdx + 2] || '',
          fecha_ingreso: cells[startIdx + 3] || '',
          estado_procesal: cells[startIdx + 4] || '',
          institucion: cells[startIdx + 5] || ''
        });
      }
      if (rows.length > 0) break;
    }
    JSON.stringify(rows);
  " 2>/dev/null || echo "[]"
}

# Acumular todas las causas de todos los anos
ALL_CAUSAS="[]"

for YEAR in $YEARS; do
  log "  📅 Buscando causas del ano $YEAR..."

  # Activar filtros (toggle)
  agent-browser --session "$SESSION" eval "
    const toggles = document.querySelectorAll('input[type=\"checkbox\"], .custom-switch input');
    for (const toggle of toggles) {
      if (toggle.offsetParent === null) continue;
      const parent = toggle.closest('.custom-switch, .form-check, label, div');
      const parentText = parent ? (parent.textContent || '') : '';
      if (parentText.includes('Filtro') || parentText.includes('filtro')) {
        if (!toggle.checked) toggle.click();
        break;
      }
    }
  " 2>/dev/null || true
  sleep 2

  # Setear ano
  agent-browser --session "$SESSION" eval "
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      if (input.offsetParent === null) continue;
      const name = (input.getAttribute('name') || '').toLowerCase();
      const id = (input.getAttribute('id') || '').toLowerCase();
      const ph = (input.getAttribute('placeholder') || '').toLowerCase();
      if (name.includes('ano') || name.includes('año') || id.includes('ano') || ph.includes('año')) {
        input.value = '$YEAR';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        break;
      }
    }
  " 2>/dev/null || true
  sleep 1

  # Click Buscar (solo visible)
  agent-browser --session "$SESSION" eval "
    const btns = document.querySelectorAll('button, input[type=\"submit\"], input[type=\"button\"]');
    for (const btn of btns) {
      if (btn.offsetParent === null) continue;
      const text = (btn.textContent || '').trim();
      const val = btn.value || '';
      if (text === 'Buscar' || val === 'Buscar') { btn.click(); break; }
    }
  " 2>/dev/null || true

  # Esperar resultados
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 8

  # Leer tabla
  YEAR_DATA=$(read_table)

  # Merge con resultados previos
  ALL_CAUSAS=$(echo "$ALL_CAUSAS" "$YEAR_DATA" | python3 -c "
import sys, json
parts = sys.stdin.read().split(']')
all_items = []
for part in parts:
    part = part.strip()
    if part.startswith('['):
        try:
            items = json.loads(part + ']')
            all_items.extend(items)
        except:
            pass
# Deduplicar por RIT
seen = set()
unique = []
for item in all_items:
    if item.get('rit') not in seen:
        seen.add(item.get('rit'))
        unique.append(item)
print(json.dumps(unique))
" 2>/dev/null || echo "$ALL_CAUSAS")

  COUNT=$(echo "$YEAR_DATA" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")
  log "  ✓ $COUNT causas encontradas para $YEAR"

  # Delay humanizado entre busquedas
  sleep 3
done

# --- PASO 4: Filtrar solo causas de Familia ---
FILTERED=$(echo "$ALL_CAUSAS" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
familia = [c for c in data if any(kw in c.get('tribunal','').lower() for kw in ['familia', 'medida', 'cautelar'])]
# Si filtro elimina todo, mantener original (puede ser que el tribunal no dice 'familia')
if len(familia) == 0 and len(data) > 0:
    familia = data
print(json.dumps(familia, ensure_ascii=False, indent=2))
" 2>/dev/null || echo "$ALL_CAUSAS")

TOTAL=$(echo "$FILTERED" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✅ LISTADO COMPLETADO: $TOTAL causas de Familia"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Output JSON a stdout (logs van a stderr)
echo "$FILTERED"
