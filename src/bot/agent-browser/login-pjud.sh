#!/bin/bash
# ============================================================
# CAUSASPRO - Login via Clave Unica (agent-browser CLI)
# Flujo:
#   1. Abrir portal PJUD
#   2. Cerrar modales
#   3. Click "Todos los servicios" -> "Clave Unica"
#   4. Redirige a accounts.claveunica.gob.cl
#   5. Llenar RUT + password
#   6. Submit
#   7. Guardar state para reutilizar sesion
#
# Variables de entorno requeridas:
#   PJUD_RUT      - RUT sin puntos, con guion (ej: 17692174-9)
#   PJUD_PASSWORD - Contrasena de Clave Unica
# ============================================================
set -euo pipefail

# --- Configuracion ---
SESSION="pjud"
STATE_FILE="./pjud-state.json"
ERROR_DIR="/tmp/pjud-bot"
URL_HOME="https://oficinajudicialvirtual.pjud.cl/home/index.php"
HEADLESS="${HEADLESS:-0}"
MAX_RETRIES=3

# Crear directorio de errores
mkdir -p "$ERROR_DIR"

# --- Validar variables de entorno ---
if [ -z "${PJUD_RUT:-}" ]; then
  echo "❌ Error: Variable PJUD_RUT no definida"
  echo "   Uso: PJUD_RUT=17692174-9 PJUD_PASSWORD=xxx ./login-pjud.sh"
  exit 1
fi

if [ -z "${PJUD_PASSWORD:-}" ]; then
  echo "❌ Error: Variable PJUD_PASSWORD no definida"
  exit 1
fi

# --- Funciones auxiliares ---
log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

error_screenshot() {
  local label="${1:-error}"
  agent-browser --session "$SESSION" screenshot "$ERROR_DIR/login-${label}-$(date +%s).png" 2>/dev/null || true
}

wait_for_url() {
  local pattern="$1"
  local max_wait="${2:-30}"
  local waited=0
  while [ $waited -lt $max_wait ]; do
    local url
    url=$(agent-browser --session "$SESSION" eval "window.location.href" 2>/dev/null || echo "")
    if echo "$url" | grep -q "$pattern"; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# --- Verificar si ya hay sesion activa ---
if [ -f "$STATE_FILE" ]; then
  log "📂 State encontrado. Verificando sesion activa..."

  if [ "$HEADLESS" = "1" ]; then
    agent-browser --session "$SESSION" open "$URL_HOME" --headless 2>/dev/null || true
  else
    agent-browser --session "$SESSION" open "$URL_HOME" 2>/dev/null || true
  fi
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 3

  # Verificar si hay indicador de sesion activa
  LOGGED_IN=$(agent-browser --session "$SESSION" eval "
    const indicators = document.querySelectorAll('a');
    let found = false;
    indicators.forEach(a => {
      const text = (a.textContent || '').trim();
      if (text.includes('Cerrar Sesión') || text.includes('Salir') || text.includes('Mis Causas')) {
        found = true;
      }
    });
    found;
  " 2>/dev/null || echo "false")

  if [ "$LOGGED_IN" = "true" ]; then
    log "✅ Sesion ya activa (state valido). No es necesario re-login."
    exit 0
  else
    log "⚠️  State expirado. Procediendo con login completo..."
  fi
fi

# --- Login completo ---
login_attempt() {
  local attempt="$1"
  log "🔑 Intento de login $attempt/$MAX_RETRIES..."

  # PASO 1: Abrir portal
  log "  1️⃣  Abriendo portal PJUD..."
  if [ "$HEADLESS" = "1" ]; then
    agent-browser --session "$SESSION" open "$URL_HOME" --headless
  else
    agent-browser --session "$SESSION" open "$URL_HOME"
  fi
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 4

  # PASO 2: Cerrar modales/popups
  log "  2️⃣  Cerrando modales..."
  agent-browser --session "$SESSION" eval "
    document.querySelectorAll('.modal, .modal-backdrop, [role=\"dialog\"]').forEach(el => {
      el.style.display = 'none';
      el.remove();
    });
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    try { if (window.jQuery) jQuery('.modal').modal('hide'); } catch(e) {}
  " 2>/dev/null || true
  sleep 2

  # PASO 3: Click en "Todos los servicios"
  log "  3️⃣  Buscando 'Todos los servicios'..."
  agent-browser --session "$SESSION" eval "
    const allElements = document.querySelectorAll('a, button, span, div');
    let clicked = false;
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (text === 'Todos los servicios' || text.includes('Todos los servicios')) {
        el.click();
        clicked = true;
        break;
      }
    }
    clicked;
  " 2>/dev/null || true
  sleep 3

  # Snapshot para ver estado despues de "Todos los servicios"
  agent-browser --session "$SESSION" snapshot > /dev/null 2>&1 || true

  # PASO 4: Click en "Clave Unica"
  log "  4️⃣  Buscando boton 'Clave Unica'..."
  CLICK_RESULT=$(agent-browser --session "$SESSION" eval "
    const allElements = document.querySelectorAll('a, span, div, button, li, p');
    let result = null;
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (text === 'Clave Única' || text === 'Clave Unica' || text === 'ClaveÚnica') {
        if (el.tagName === 'A') { el.click(); result = 'clicked-a'; break; }
        const parentLink = el.closest('a');
        if (parentLink) { parentLink.click(); result = 'clicked-parent'; break; }
        el.click(); result = 'clicked-direct'; break;
      }
    }
    if (!result) {
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.includes('claveunica') || href.includes('autenticacion')) {
          link.click(); result = 'clicked-href'; break;
        }
      }
    }
    result || 'not-found';
  " 2>/dev/null || echo "error")

  if [ "$CLICK_RESULT" = "not-found" ] || [ "$CLICK_RESULT" = "error" ]; then
    log "  ❌ No se encontro boton 'Clave Unica'"
    error_screenshot "no-claveunica-$attempt"
    return 1
  fi
  log "  ✓ Click Clave Unica: $CLICK_RESULT"

  # PASO 5: Esperar redireccion a accounts.claveunica.gob.cl
  log "  5️⃣  Esperando redireccion a Clave Unica..."
  if ! wait_for_url "claveunica" 40; then
    log "  ❌ No redirigió a Clave Unica"
    error_screenshot "no-redirect-$attempt"
    return 1
  fi
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 3
  log "  ✓ En pagina de Clave Unica"

  # PASO 6: Ingresar RUT
  log "  6️⃣  Ingresando RUT..."
  agent-browser --session "$SESSION" eval "
    const selectors = ['input[name=\"run\"]', 'input[id=\"run\"]', 'input[name=\"rut\"]', 'input[id=\"rut\"]', 'input[placeholder*=\"RUN\"]', 'input[placeholder*=\"RUT\"]'];
    let input = null;
    for (const sel of selectors) {
      input = document.querySelector(sel);
      if (input) break;
    }
    if (!input) {
      const inputs = document.querySelectorAll('input[type=\"text\"]');
      if (inputs.length > 0) input = inputs[0];
    }
    if (input) { input.focus(); input.value = ''; }
    !!input;
  " 2>/dev/null || true
  sleep 1

  # Usar type para simular escritura humana
  agent-browser --session "$SESSION" eval "
    const selectors = ['input[name=\"run\"]', 'input[id=\"run\"]', 'input[name=\"rut\"]', 'input[id=\"rut\"]', 'input[type=\"text\"]'];
    let input = null;
    for (const sel of selectors) {
      input = document.querySelector(sel);
      if (input) break;
    }
    if (input) {
      input.value = '${PJUD_RUT}';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    !!input;
  " 2>/dev/null || true
  sleep 2

  # PASO 7: Click en Continuar (si hay paso intermedio)
  log "  7️⃣  Buscando boton Continuar/Siguiente..."
  agent-browser --session "$SESSION" eval "
    const btns = document.querySelectorAll('button, input[type=\"submit\"]');
    for (const btn of btns) {
      const text = (btn.textContent || btn.value || '').trim();
      if (text === 'Continuar' || text === 'Siguiente') {
        btn.click();
        break;
      }
    }
  " 2>/dev/null || true
  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 3

  # PASO 8: Ingresar contrasena
  log "  8️⃣  Ingresando contrasena..."
  agent-browser --session "$SESSION" eval "
    const selectors = ['input[type=\"password\"]', 'input[name=\"password\"]', 'input[name=\"clave\"]', 'input[id=\"password\"]'];
    let input = null;
    for (const sel of selectors) {
      input = document.querySelector(sel);
      if (input && input.offsetParent !== null) break;
      input = null;
    }
    if (input) {
      input.focus();
      input.value = '${PJUD_PASSWORD}';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    !!input;
  " 2>/dev/null || true
  sleep 2

  # PASO 9: Submit
  log "  9️⃣  Enviando formulario..."
  agent-browser --session "$SESSION" eval "
    const selectors = ['button[type=\"submit\"]', 'input[type=\"submit\"]', 'button:not([type])', '#login-submit', '.btn-primary'];
    let btn = null;
    for (const sel of selectors) {
      btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) { btn.click(); break; }
      btn = null;
    }
    if (!btn) {
      const allBtns = document.querySelectorAll('button');
      for (const b of allBtns) {
        const text = (b.textContent || '').trim().toLowerCase();
        if (text.includes('ingresar') || text.includes('autenticar') || text.includes('acceder') || text.includes('entrar')) {
          b.click(); break;
        }
      }
    }
  " 2>/dev/null || true

  # PASO 10: Esperar redireccion de vuelta al portal PJUD
  log "  🔄 Esperando autenticacion y redireccion..."
  if ! wait_for_url "pjud.cl" 40; then
    # Puede que siga en claveunica por error de credenciales
    ERROR_MSG=$(agent-browser --session "$SESSION" eval "
      const els = document.querySelectorAll('.error, .alert-danger, .msg-error, p.text-danger');
      let msg = '';
      els.forEach(el => { if (el.textContent.trim()) msg = el.textContent.trim(); });
      msg;
    " 2>/dev/null || echo "")

    if [ -n "$ERROR_MSG" ]; then
      log "  ❌ Error de credenciales: $ERROR_MSG"
      error_screenshot "credenciales-$attempt"
      return 1
    fi

    log "  ❌ No redirigió al portal PJUD"
    error_screenshot "no-return-$attempt"
    return 1
  fi

  agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
  sleep 5

  # PASO 11: Verificar login exitoso
  log "  🔍 Verificando login exitoso..."
  VERIFIED=$(agent-browser --session "$SESSION" eval "
    const indicators = document.querySelectorAll('a, span, div');
    let found = false;
    indicators.forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.includes('Cerrar Sesión') || text.includes('Salir') || text.includes('Mis Causas') || text.includes('Bienvenido')) {
        found = true;
      }
    });
    found;
  " 2>/dev/null || echo "false")

  if [ "$VERIFIED" = "true" ]; then
    log "  ✅ Login exitoso!"
    return 0
  fi

  # Segundo intento de verificacion (esperar mas)
  sleep 5
  VERIFIED2=$(agent-browser --session "$SESSION" eval "
    const url = window.location.href;
    url.includes('pjud.cl') && !url.includes('home/index.php');
  " 2>/dev/null || echo "false")

  if [ "$VERIFIED2" = "true" ]; then
    log "  ✅ Login exitoso (por URL)"
    return 0
  fi

  log "  ❌ No se pudo confirmar login"
  error_screenshot "no-confirm-$attempt"
  return 1
}

# --- Ejecutar con reintentos ---
for attempt in $(seq 1 $MAX_RETRIES); do
  if login_attempt "$attempt"; then
    # Guardar state para reutilizar sesion
    log "💾 Guardando state en $STATE_FILE..."
    agent-browser --session "$SESSION" eval "
      JSON.stringify({
        url: window.location.href,
        timestamp: new Date().toISOString(),
        logged_in: true
      });
    " > "$STATE_FILE" 2>/dev/null || echo '{"logged_in":true}' > "$STATE_FILE"

    log ""
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "✅ LOGIN COMPLETADO"
    log "   State guardado en: $STATE_FILE"
    log "   Sesion: $SESSION"
    log "   Siguiente paso: ./list-causas.sh"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  fi

  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    log "⏳ Reintentando en 10 segundos..."
    sleep 10
  fi
done

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "❌ LOGIN FALLIDO despues de $MAX_RETRIES intentos"
log "   Revisar screenshots en: $ERROR_DIR/"
log "   Posibles causas:"
log "   - RUT o contrasena incorrectos"
log "   - Portal PJUD caido/mantenimiento"
log "   - Clave Unica con problemas"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1
