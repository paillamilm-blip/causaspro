#!/bin/bash
# ============================================================
# CAUSASPRO - Discovery Script (agent-browser CLI)
# Abre la pagina de login del PJUD, hace snapshot para
# identificar la estructura del formulario y refs disponibles.
# Usa state para no re-loguearse cada vez.
# ============================================================
set -euo pipefail

# --- Configuracion ---
SESSION="pjud"
STATE_FILE="./pjud-state.json"
ERROR_DIR="/tmp/pjud-bot"
URL_HOME="https://oficinajudicialvirtual.pjud.cl/home/index.php"
HEADLESS="${HEADLESS:-0}"

# Crear directorio de errores
mkdir -p "$ERROR_DIR"

# --- Funciones auxiliares ---
log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

error_screenshot() {
  local label="${1:-error}"
  agent-browser --session "$SESSION" screenshot "$ERROR_DIR/discovery-${label}-$(date +%s).png" 2>/dev/null || true
}

# --- Verificar si hay state guardado ---
if [ -f "$STATE_FILE" ]; then
  log "📂 State encontrado: $STATE_FILE"
  log "   Cargando sesion previa..."

  # Abrir navegador con state
  if [ "$HEADLESS" = "1" ]; then
    agent-browser --session "$SESSION" open "$URL_HOME" --headless 2>/dev/null || true
  else
    agent-browser --session "$SESSION" open "$URL_HOME" 2>/dev/null || true
  fi

  # Esperar carga
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 2

  log "📸 Snapshot con sesion cargada:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  agent-browser --session "$SESSION" snapshot
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  log "✅ Discovery completado (con state previo)"
  exit 0
fi

# --- Sin state: abrir desde cero ---
log "🌐 Abriendo portal PJUD (sin state previo)..."

if [ "$HEADLESS" = "1" ]; then
  agent-browser --session "$SESSION" open "$URL_HOME" --headless
else
  agent-browser --session "$SESSION" open "$URL_HOME"
fi

# Esperar carga completa
log "⏳ Esperando carga completa..."
agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
sleep 3

# Snapshot inicial - muestra la estructura del formulario
log "📸 Snapshot inicial (pagina de login):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
agent-browser --session "$SESSION" snapshot
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Screenshot visual para referencia
agent-browser --session "$SESSION" screenshot "$ERROR_DIR/discovery-inicial-$(date +%s).png"
log "📷 Screenshot guardado en $ERROR_DIR/"

# Intentar cerrar modales si aparecen
log "🔍 Intentando cerrar modales/avisos..."
agent-browser --session "$SESSION" eval "
  document.querySelectorAll('.modal, .modal-backdrop, [role=\"dialog\"]').forEach(el => {
    el.style.display = 'none';
    el.remove();
  });
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
" 2>/dev/null || true
sleep 2

# Snapshot despues de cerrar modales
log "📸 Snapshot post-modales:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
agent-browser --session "$SESSION" snapshot
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log "✅ Discovery completado"
log ""
log "💡 Usa los refs (@eN) mostrados arriba para interactuar."
log "   Ejemplo: agent-browser --session pjud click '@e5'"
log ""
log "   Siguiente paso: ejecutar login-pjud.sh"
