// ============================================================
// CAUSASPRO - Sesion de abogado (temporal, SIN auth)
// Guarda en localStorage quien es el abogado activo. Es un puente hasta el
// Paso 2 (auth real con Supabase). NO es seguridad: solo filtra la vista.
// ============================================================

const KEY = 'causaspro:abogado_activo'
const EVENTO = 'causaspro:abogado-cambio'

/** Devuelve el id del abogado activo, o null si no hay. */
export function getAbogadoActivo(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Fija (o limpia con null) el abogado activo y emite un evento para que la UI reaccione. */
export function setAbogadoActivo(abogadoId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (abogadoId) window.localStorage.setItem(KEY, abogadoId)
    else window.localStorage.removeItem(KEY)
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: abogadoId }))
  } catch {
    /* localStorage no disponible: no-op */
  }
}

/** Suscribe a cambios del abogado activo. Devuelve una funcion para desuscribir. */
export function onAbogadoCambio(cb: (abogadoId: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => cb((e as CustomEvent).detail ?? null)
  window.addEventListener(EVENTO, handler)
  return () => window.removeEventListener(EVENTO, handler)
}
