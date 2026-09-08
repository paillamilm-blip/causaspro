// ============================================================
// Tests de finanzas.ts (funciones puras)
// Correr con: node --test (transpilado) o tsx --test src/lib/finanzas.test.ts
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatCLP,
  calcularMontoPactado,
  estadoCuota,
  diasVencida,
  saldoCuota,
  generarPlanCuotas,
  resumenCuotas,
  variacionPct,
} from './finanzas'

test('formatCLP formatea con separador de miles chileno', () => {
  assert.equal(formatCLP(1200000), '$1.200.000')
  assert.equal(formatCLP(0), '$0')
  assert.equal(formatCLP(null), '$0')
  assert.equal(formatCLP(999), '$999')
})

test('calcularMontoPactado: modalidad fijo', () => {
  assert.equal(
    calcularMontoPactado({ modalidad: 'fijo', monto_total: 1200000, porcentaje_exito: 20, monto_ganado: 5000000 }),
    1200000
  )
})

test('calcularMontoPactado: modalidad exito', () => {
  assert.equal(
    calcularMontoPactado({ modalidad: 'exito', monto_total: 0, porcentaje_exito: 20, monto_ganado: 5000000 }),
    1000000
  )
})

test('calcularMontoPactado: modalidad mixto', () => {
  assert.equal(
    calcularMontoPactado({ modalidad: 'mixto', monto_total: 500000, porcentaje_exito: 10, monto_ganado: 3000000 }),
    800000
  )
})

test('generarPlanCuotas: la suma cuadra exacta aun con residuo', () => {
  const plan = generarPlanCuotas(1000000, 3, '2026-01-01')
  const suma = plan.reduce((acc, c) => acc + c.monto, 0)
  assert.equal(suma, 1000000)
  assert.equal(plan.length, 3)
  // primeras dos = floor(1000000/3) = 333333, ultima = resto
  assert.equal(plan[0].monto, 333333)
  assert.equal(plan[2].monto, 333334)
})

test('generarPlanCuotas: n=1 devuelve el total en una cuota', () => {
  const plan = generarPlanCuotas(750000, 1, '2026-03-05')
  assert.equal(plan.length, 1)
  assert.equal(plan[0].monto, 750000)
  assert.equal(plan[0].fecha_vencimiento, '2026-03-05')
})

test('generarPlanCuotas: fechas espaciadas por frecuenciaDias', () => {
  const plan = generarPlanCuotas(300000, 3, '2026-01-15', 30)
  assert.equal(plan[0].fecha_vencimiento, '2026-01-15')
  assert.equal(plan[1].fecha_vencimiento, '2026-02-14')
  assert.equal(plan[2].fecha_vencimiento, '2026-03-16')
})

test('generarPlanCuotas: sin fecha deja vencimiento null', () => {
  const plan = generarPlanCuotas(100000, 2, null)
  assert.equal(plan[0].fecha_vencimiento, null)
})

test('estadoCuota: pagada > vencida > pendiente', () => {
  assert.equal(estadoCuota({ pagada: true, fecha_vencimiento: '2020-01-01' }), 'pagada')
  assert.equal(estadoCuota({ pagada: false, fecha_vencimiento: '2020-01-01' }), 'vencida')
  assert.equal(estadoCuota({ pagada: false, fecha_vencimiento: '2999-01-01' }), 'pendiente')
  assert.equal(estadoCuota({ pagada: false, fecha_vencimiento: null }), 'pendiente')
})

test('diasVencida: positivo si atrasada, null si al dia o pagada', () => {
  assert.ok((diasVencida({ pagada: false, fecha_vencimiento: '2020-01-01' }) ?? 0) > 0)
  assert.equal(diasVencida({ pagada: true, fecha_vencimiento: '2020-01-01' }), null)
  assert.equal(diasVencida({ pagada: false, fecha_vencimiento: '2999-01-01' }), null)
})

test('saldoCuota: monto - pagado, nunca negativo', () => {
  assert.equal(saldoCuota({ monto: 100000, monto_pagado: 30000 }), 70000)
  assert.equal(saldoCuota({ monto: 100000, monto_pagado: 150000 }), 0)
})

test('resumenCuotas: agrega pagos, saldo y vencidas', () => {
  const r = resumenCuotas([
    { monto: 100000, monto_pagado: 100000, pagada: true, fecha_vencimiento: '2020-01-01' },
    { monto: 100000, monto_pagado: 0, pagada: false, fecha_vencimiento: '2020-01-01' }, // vencida
    { monto: 100000, monto_pagado: 0, pagada: false, fecha_vencimiento: '2999-01-01' }, // pendiente
  ])
  assert.equal(r.totalEnCuotas, 300000)
  assert.equal(r.totalPagado, 100000)
  assert.equal(r.saldoPendiente, 200000)
  assert.equal(r.montoVencido, 100000)
  assert.equal(r.cuotasPagadas, 1)
  assert.equal(r.cuotasVencidas, 1)
  assert.equal(r.numCuotas, 3)
})

test('variacionPct: calcula variacion y maneja division por cero', () => {
  assert.equal(variacionPct(120, 100), 20)
  assert.equal(variacionPct(80, 100), -20)
  assert.equal(variacionPct(100, 0), null)
})
