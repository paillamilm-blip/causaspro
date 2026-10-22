// ============================================================
// CAUSASPRO - Autorización compartida para APIs que ESCRIBEN o BORRAN
// ------------------------------------------------------------
// Motivación concreta (auditado): /api/upload y /api/admin/reset NO tenían ningún
// control de acceso. Como el proyecto se despliega en Vercel con URL pública,
// `DELETE /api/admin/reset` borraba TODAS las causas, movimientos, NNA y adultos
// desde cualquiera que conociera la dirección, y `POST /api/upload` además
// DELETE-aba los hijos de las causas existentes. Un endpoint que borra la base
// no puede depender de que nadie sepa que existe.
//
// Patrón: el MISMO que ya usaban /api/reporte, /api/ranking y /api/asignaciones
// (fail-closed: si no hay token configurado, se rechaza todo). Se centraliza acá
// en vez de copiarlo por cuarta vez porque las rutas destructivas necesitan que
// la regla sea idéntica y no se le olvide ponerla a nadie.
//
// Nota: NEXT_PUBLIC_REPORTE_TOKEN está expuesto en el bundle del navegador a
// propósito (lo usa la pantalla /asignaciones para llamarse a sí misma). Sirve
// como "puerta cerrada", no como secreto fuerte. Las rutas que escriben en masa
// aceptan ADEMÁS REPORTE_API_TOKEN por header Authorization, que sí es privado.
// ============================================================

import type { NextRequest } from 'next/server'

/** True si la request trae un token válido. Fail-closed si no hay ninguno configurado. */
export function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const qToken = new URL(req.url).searchParams.get('token') || ''

  const tokenPublico = process.env.NEXT_PUBLIC_REPORTE_TOKEN
  if (tokenPublico && qToken && qToken === tokenPublico) return true

  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) return false
  const min = esperado.slice(0, 20)
  return header.includes(min) || qToken === esperado || qToken.slice(0, 20) === min
}

// Rate-limit en memoria (por instancia del servidor). No es exacto en serverless,
// pero corta un abuso repetido desde la misma IP, que es el riesgo real acá.
const ventanas = new Map<string, number[]>()

/**
 * Devuelve true si la IP ya superó `limite` llamadas en los últimos `ventanaMs`.
 * @param clave  Identificador de la ruta (para no compartir contador entre endpoints).
 */
export function excedeRateLimit(req: NextRequest, clave: string, limite = 10, ventanaMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  const id = `${clave}|${ip}`
  const ahora = Date.now()
  const previos = (ventanas.get(id) || []).filter(t => ahora - t < ventanaMs)
  if (previos.length >= limite) {
    ventanas.set(id, previos)
    return true
  }
  previos.push(ahora)
  ventanas.set(id, previos)
  return false
}
