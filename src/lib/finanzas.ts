// ============================================================
// CAUSASPRO - Calculos financieros (funciones puras)
// Sin dependencias de red: facil de testear y reutilizar.
// ============================================================

import type {
  Cuota,
  CuotaInput,
  EstadoCuota,
  Honorario,
  ModalidadHonorario,
} from './types'

/** Formatea un monto en pesos chilenos: 1200000 -> "$1.200.000" */
export function formatCLP(monto: number | null | undefined): string {
  const n = Math.round(Number(monto) || 0)
  return '$' + n.toLocaleString('es-CL')
}

/** Formatea una fecha ISO a formato chileno corto: "05 mar 2026" */
export function formatFecha(iso: string | null | undefined): string {
  if (!iso) return 'Sin fecha'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Sin fecha'
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Devuelve la fecha de hoy a medianoche (para comparar vencimientos sin hora). */
function hoy(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Parsea una fecha 'YYYY-MM-DD' a Date local a medianoche (evita corrimiento por zona horaria). */
function parseFecha(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Calcula el monto pactado de un honorario segun su modalidad.
 * - fijo:  monto_total
 * - exito: monto_ganado * porcentaje_exito / 100
 * - mixto: monto_total + (monto_ganado * porcentaje_exito / 100)
 */
export function calcularMontoPactado(h: Pick<Honorario, 'modalidad' | 'monto_total' | 'porcentaje_exito' | 'monto_ganado'>): number {
  const fijo = Number(h.monto_total) || 0
  const pct = Number(h.porcentaje_exito) || 0
  const ganado = Number(h.monto_ganado) || 0
  const exito = Math.round((ganado * pct) / 100)

  switch (h.modalidad) {
    case 'fijo':
      return fijo
    case 'exito':
      return exito
    case 'mixto':
      return fijo + exito
    default:
      return fijo
  }
}

/** Determina el estado de una cuota (pendiente / pagada / vencida). */
export function estadoCuota(cuota: Pick<Cuota, 'pagada' | 'fecha_vencimiento'>): EstadoCuota {
  if (cuota.pagada) return 'pagada'
  const venc = parseFecha(cuota.fecha_vencimiento)
  if (venc && venc < hoy()) return 'vencida'
  return 'pendiente'
}

/** Dias de atraso de una cuota vencida (0 o positivo). null si no aplica. */
export function diasVencida(cuota: Pick<Cuota, 'pagada' | 'fecha_vencimiento'>): number | null {
  if (cuota.pagada) return null
  const venc = parseFecha(cuota.fecha_vencimiento)
  if (!venc) return null
  const diff = Math.floor((hoy().getTime() - venc.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : null
}

/** Saldo pendiente de una cuota (monto - monto_pagado, nunca negativo). */
export function saldoCuota(cuota: Pick<Cuota, 'monto' | 'monto_pagado'>): number {
  const saldo = (Number(cuota.monto) || 0) - (Number(cuota.monto_pagado) || 0)
  return saldo > 0 ? saldo : 0
}

/**
 * Genera un plan de cuotas dividiendo un monto en N cuotas.
 * Reparte los pesos de forma pareja y ajusta la ultima cuota con el resto,
 * para que la suma sea EXACTA (sin perder pesos por redondeo).
 *
 * @param montoTotal  monto a dividir (CLP)
 * @param numCuotas   cantidad de cuotas (>= 1)
 * @param primeraFecha fecha de vencimiento de la primera cuota (ISO 'YYYY-MM-DD')
 * @param frecuenciaDias dias entre cuotas (default 30)
 */
export function generarPlanCuotas(
  montoTotal: number,
  numCuotas: number,
  primeraFecha: string | null,
  frecuenciaDias = 30
): CuotaInput[] {
  const total = Math.round(Number(montoTotal) || 0)
  const n = Math.max(1, Math.floor(numCuotas))

  const base = Math.floor(total / n)
  const cuotas: CuotaInput[] = []
  const inicio = parseFecha(primeraFecha)

  let acumulado = 0
  for (let i = 0; i < n; i++) {
    const esUltima = i === n - 1
    // La ultima cuota se lleva el resto para que la suma cuadre exacta.
    const monto = esUltima ? total - acumulado : base
    acumulado += monto

    let fechaVenc: string | null = null
    if (inicio) {
      const f = new Date(inicio)
      f.setDate(f.getDate() + i * frecuenciaDias)
      fechaVenc = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
    }

    cuotas.push({ numero: i + 1, monto, fecha_vencimiento: fechaVenc })
  }

  return cuotas
}

/** Resumen de pagos de un conjunto de cuotas. */
export function resumenCuotas(cuotas: Array<Pick<Cuota, 'monto' | 'monto_pagado' | 'pagada' | 'fecha_vencimiento'>>) {
  let totalEnCuotas = 0
  let totalPagado = 0
  let montoVencido = 0
  let cuotasPagadas = 0
  let cuotasVencidas = 0

  for (const c of cuotas) {
    totalEnCuotas += Number(c.monto) || 0
    totalPagado += Number(c.monto_pagado) || 0
    if (c.pagada) {
      cuotasPagadas++
    } else if (estadoCuota(c) === 'vencida') {
      cuotasVencidas++
      montoVencido += saldoCuota(c)
    }
  }

  return {
    totalEnCuotas,
    totalPagado,
    saldoPendiente: Math.max(0, totalEnCuotas - totalPagado),
    montoVencido,
    cuotasPagadas,
    cuotasVencidas,
    numCuotas: cuotas.length,
  }
}

/** Variacion porcentual entre dos montos (para la tendencia de ingresos). null si no calculable. */
export function variacionPct(actual: number, anterior: number): number | null {
  if (!anterior || anterior === 0) return null
  return Math.round(((actual - anterior) / anterior) * 100)
}

/** Etiqueta legible de la modalidad. */
export function labelModalidad(m: ModalidadHonorario): string {
  switch (m) {
    case 'fijo':
      return 'Precio fijo'
    case 'exito':
      return 'Honorario de exito'
    case 'mixto':
      return 'Mixto (fijo + exito)'
    default:
      return m
  }
}
