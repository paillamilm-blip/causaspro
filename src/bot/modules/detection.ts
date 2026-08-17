// ============================================================
// CAUSASPRO BOT - Detection Module
// Detecta patrones de urgencia: TRASLADO AL CURADOR, plazos fatales
// ============================================================

import type { CausaScrapedData, MovimientoPJUD, AudienciaPJUD } from '../types'
import { URGENCY_PATTERNS } from '../config'
import { log } from '../utils'

export interface UrgencyAnalysis {
  causa_id: string
  rit: string
  nivel_urgencia: number  // 1 = máxima urgencia, 10 = sin urgencia
  motivos: string[]
  tiene_traslado_curador: boolean
  audiencia_proxima?: string
  dias_para_audiencia?: number
  plazo_fatal_detectado: boolean
  requiere_accion_inmediata: boolean
}

/**
 * Analiza los datos scrapeados y determina urgencia
 */
export function analyzeCausaUrgency(data: CausaScrapedData): UrgencyAnalysis {
  const analysis: UrgencyAnalysis = {
    causa_id: data.causa_id,
    rit: data.rit,
    nivel_urgencia: 10,
    motivos: [],
    tiene_traslado_curador: false,
    plazo_fatal_detectado: false,
    requiere_accion_inmediata: false,
  }
  
  // 1. Detectar TRASLADO AL CURADOR (máxima urgencia)
  const trasladoDetected = detectTrasladoCuradorInData(data)
  if (trasladoDetected) {
    analysis.tiene_traslado_curador = true
    analysis.nivel_urgencia = Math.min(analysis.nivel_urgencia, 1)
    analysis.motivos.push('🔴 TRASLADO AL CURADOR detectado')
    analysis.requiere_accion_inmediata = true
    log('warn', `⚡ ${data.rit}: TRASLADO AL CURADOR DETECTADO`)
  }
  
  // 2. Audiencias próximas
  const proximaAudiencia = findProximaAudiencia(data.audiencias)
  if (proximaAudiencia) {
    analysis.audiencia_proxima = proximaAudiencia.fecha
    analysis.dias_para_audiencia = proximaAudiencia.diasRestantes
    
    if (proximaAudiencia.diasRestantes <= 2) {
      analysis.nivel_urgencia = Math.min(analysis.nivel_urgencia, 1)
      analysis.motivos.push(`⚡ Audiencia en ${proximaAudiencia.diasRestantes} días (${proximaAudiencia.tipo})`)
      analysis.requiere_accion_inmediata = true
    } else if (proximaAudiencia.diasRestantes <= 7) {
      analysis.nivel_urgencia = Math.min(analysis.nivel_urgencia, 3)
      analysis.motivos.push(`📅 Audiencia en ${proximaAudiencia.diasRestantes} días (${proximaAudiencia.tipo})`)
    }
  }
  
  // 3. Plazos fatales en movimientos recientes
  const plazoFatal = detectPlazoFatal(data.movimientos)
  if (plazoFatal) {
    analysis.plazo_fatal_detectado = true
    analysis.nivel_urgencia = Math.min(analysis.nivel_urgencia, 2)
    analysis.motivos.push(`⚠️ Plazo fatal detectado: ${plazoFatal}`)
    analysis.requiere_accion_inmediata = true
  }
  
  // 4. Apercibimientos
  const apercibimiento = detectApercibimiento(data.movimientos)
  if (apercibimiento) {
    analysis.nivel_urgencia = Math.min(analysis.nivel_urgencia, 2)
    analysis.motivos.push(`⚠️ Apercibimiento: ${apercibimiento}`)
    analysis.requiere_accion_inmediata = true
  }
  
  // 5. Si no hay motivos de urgencia específicos
  if (analysis.motivos.length === 0) {
    analysis.motivos.push('Sin alertas detectadas')
  }
  
  return analysis
}

// ============================================================
// DETECTORES ESPECÍFICOS
// ============================================================

/**
 * Detecta TRASLADO AL CURADOR en movimientos
 */
function detectTrasladoCuradorInData(data: CausaScrapedData): boolean {
  // Ya viene calculado del scraper
  if (data.tiene_traslado_curador) return true
  
  // Doble check en todos los textos
  for (const mov of data.movimientos) {
    const fullText = `${mov.tramite} ${mov.descripcion || ''} ${mov.etapa || ''}`
    for (const pattern of URGENCY_PATTERNS.trasladoCurador) {
      if (fullText.toUpperCase().includes(pattern)) {
        return true
      }
    }
  }
  
  // También revisar resoluciones
  for (const res of data.resoluciones) {
    const fullText = `${res.tipo} ${res.texto_resumen || ''}`
    for (const pattern of URGENCY_PATTERNS.trasladoCurador) {
      if (fullText.toUpperCase().includes(pattern)) {
        return true
      }
    }
  }
  
  return false
}

/**
 * Encuentra la audiencia futura más próxima
 */
function findProximaAudiencia(audiencias: AudienciaPJUD[]): { fecha: string; diasRestantes: number; tipo: string } | null {
  const now = new Date()
  let closest: { fecha: string; diasRestantes: number; tipo: string } | null = null
  
  for (const aud of audiencias) {
    const fecha = new Date(aud.fecha)
    if (isNaN(fecha.getTime())) continue
    
    // Solo audiencias futuras y no suspendidas
    if (fecha <= now) continue
    if (aud.estado?.toLowerCase().includes('suspendida')) continue
    if (aud.estado?.toLowerCase().includes('cancelada')) continue
    
    const diasRestantes = Math.ceil((fecha.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    
    if (!closest || diasRestantes < closest.diasRestantes) {
      closest = {
        fecha: aud.fecha,
        diasRestantes,
        tipo: aud.tipo,
      }
    }
  }
  
  return closest
}

/**
 * Detecta plazos fatales en movimientos recientes (últimos 30 días)
 */
function detectPlazoFatal(movimientos: MovimientoPJUD[]): string | null {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  for (const mov of movimientos) {
    const fecha = new Date(mov.fecha)
    if (fecha < thirtyDaysAgo) continue
    
    const fullText = `${mov.tramite} ${mov.descripcion || ''}`.toUpperCase()
    
    for (const pattern of URGENCY_PATTERNS.plazoFatal) {
      if (fullText.includes(pattern)) {
        return mov.tramite
      }
    }
  }
  
  return null
}

/**
 * Detecta apercibimientos en movimientos recientes
 */
function detectApercibimiento(movimientos: MovimientoPJUD[]): string | null {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  for (const mov of movimientos) {
    const fecha = new Date(mov.fecha)
    if (fecha < thirtyDaysAgo) continue
    
    const fullText = `${mov.tramite} ${mov.descripcion || ''}`.toUpperCase()
    
    if (fullText.includes('APERCIBIMIENTO') && fullText.includes('CURADOR')) {
      return mov.tramite
    }
  }
  
  return null
}

/**
 * Genera un resumen de texto para la alerta
 */
export function generateAlertSummary(analysis: UrgencyAnalysis): string {
  if (analysis.requiere_accion_inmediata) {
    return `🚨 URGENTE - ${analysis.rit}: ${analysis.motivos[0]}`
  }
  if (analysis.nivel_urgencia <= 3) {
    return `⚠️ ATENCIÓN - ${analysis.rit}: ${analysis.motivos[0]}`
  }
  return `ℹ️ ${analysis.rit}: ${analysis.motivos[0]}`
}
