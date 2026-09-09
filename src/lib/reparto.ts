// ============================================================
// CAUSASPRO - Logica de reparto de honorarios (funciones puras)
// ============================================================

import type { RepartoItemInput } from './types'

export interface ValidacionReparto {
  ok: boolean
  error?: string
  total: number
}

/**
 * Valida un reparto de honorario entre abogados.
 * Reglas:
 *  - al menos un item
 *  - sin abogados repetidos
 *  - cada porcentaje entre 0 y 100
 *  - la suma debe ser 100 (con tolerancia de 0.01 por redondeo)
 */
export function validarReparto(items: RepartoItemInput[]): ValidacionReparto {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'El reparto debe tener al menos un abogado', total: 0 }
  }

  const vistos = new Set<string>()
  let total = 0
  for (const it of items) {
    if (!it.abogado_id) {
      return { ok: false, error: 'Hay un item de reparto sin abogado', total }
    }
    if (vistos.has(it.abogado_id)) {
      return { ok: false, error: 'Un abogado aparece repetido en el reparto', total }
    }
    vistos.add(it.abogado_id)

    const pct = Number(it.porcentaje)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'Cada porcentaje debe estar entre 0 y 100', total }
    }
    total += pct
  }

  // Tolerancia por redondeo
  if (Math.abs(total - 100) > 0.01) {
    return { ok: false, error: `Los porcentajes deben sumar 100% (suman ${total.toFixed(2)}%)`, total }
  }

  return { ok: true, total }
}

/**
 * Reparte un monto entre los items segun su porcentaje, ajustando el ultimo
 * para que la suma en pesos cuadre exacta (evita perder/ganar pesos por redondeo).
 * Devuelve un mapa abogado_id -> monto en CLP entero.
 */
export function repartirMonto(monto: number, items: RepartoItemInput[]): Record<string, number> {
  const total = Math.round(Number(monto) || 0)
  const out: Record<string, number> = {}
  let acumulado = 0

  items.forEach((it, i) => {
    const esUltimo = i === items.length - 1
    const parte = esUltimo ? total - acumulado : Math.round((total * Number(it.porcentaje)) / 100)
    acumulado += parte
    out[it.abogado_id] = parte
  })

  return out
}
