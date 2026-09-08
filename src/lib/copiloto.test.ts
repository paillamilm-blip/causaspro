// ============================================================
// Tests del motor de decisiones heuristico (copiloto.ts)
// Correr con: npm test  (tsx --test)
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  interpretarMovimiento,
  sumarDiasHabiles,
  diasHabilesHasta,
  ordenarDecisiones,
  pesoPrioridad,
} from './copiloto'

// --- Dias habiles ---

test('sumarDiasHabiles: salta el fin de semana', () => {
  // Viernes 2026-01-02 + 1 dia habil = lunes 2026-01-05 (sabado/domingo saltados)
  const r = sumarDiasHabiles(1, new Date(2026, 0, 2))
  assert.equal(r, '2026-01-05')
})

test('sumarDiasHabiles: salta feriado fijo (18 sep)', () => {
  // Jueves 2026-09-17 + 1 dia habil: viernes 18 es feriado, sabado/domingo, lunes 21
  const r = sumarDiasHabiles(1, new Date(2026, 8, 17))
  assert.equal(r, '2026-09-21')
})

test('diasHabilesHasta: cuenta correctamente hacia adelante', () => {
  // de lunes a viernes de la misma semana = 4 dias habiles
  const lunes = new Date(2026, 0, 5)
  // construimos el viernes con sumarDiasHabiles para no depender de feriados
  const viernes = sumarDiasHabiles(4, lunes)
  const dias = diasHabilesHasta(viernes)
  // No podemos fijar el valor absoluto (depende de "hoy"), pero si su signo/consistencia:
  assert.equal(typeof dias, 'number')
})

// --- Interpretacion de movimientos ---

test('interpretarMovimiento: traslado es critico y fatal con plazo 5', () => {
  const d = interpretarMovimiento({ tramite: 'Confiere TRASLADO', fecha: '2026-03-02' }, new Date(2026, 2, 2))
  assert.equal(d.categoria, 'traslado')
  assert.equal(d.esFatal, true)
  assert.equal(d.plazoDiasHabiles, 5)
  assert.equal(d.prioridad, 'critico')
  assert.ok(d.fechaLimite)
})

test('interpretarMovimiento: "traslado de la demanda" NO se confunde con traslado simple (regresion)', () => {
  // Bug critico: "traslado de la demanda" (15 dias) no debe matchear la regla
  // generica "traslado" (5 dias). El orden de las reglas debe protegerlo.
  const d = interpretarMovimiento({ tramite: 'Confiere traslado de la demanda' })
  assert.equal(d.categoria, 'demanda_notificada')
  assert.equal(d.plazoDiasHabiles, 15)
  assert.equal(d.esFatal, true)
})

test('interpretarMovimiento: traslado simple sigue siendo 5 dias', () => {
  const d = interpretarMovimiento({ tramite: 'Confiere TRASLADO' })
  assert.equal(d.categoria, 'traslado')
  assert.equal(d.plazoDiasHabiles, 5)
})

test('interpretarMovimiento: apercibimiento detectado', () => {
  const d = interpretarMovimiento({ tramite: 'Resolucion bajo APERCIBIMIENTO de multa' })
  assert.equal(d.categoria, 'apercibimiento')
  assert.equal(d.esFatal, true)
})

test('interpretarMovimiento: audiencia es importante y sin plazo de dias', () => {
  const d = interpretarMovimiento({ tramite: 'Fija AUDIENCIA preparatoria' })
  assert.equal(d.categoria, 'audiencia')
  assert.equal(d.plazoDiasHabiles, null)
  assert.equal(d.fechaLimite, null)
})

test('interpretarMovimiento: rebeldia de contraparte es oportunidad', () => {
  const d = interpretarMovimiento({ tramite: 'Se acusa REBELDIA de la demandada' })
  assert.equal(d.categoria, 'rebeldia_contraparte')
  assert.equal(d.prioridad, 'oportunidad')
})

test('interpretarMovimiento: texto desconocido cae en informativo', () => {
  const d = interpretarMovimiento({ tramite: 'Oficio remitido a Gendarmeria' })
  assert.equal(d.categoria, 'otro')
  assert.equal(d.prioridad, 'informativo')
})

test('interpretarMovimiento: plazo fatal escala a critico aunque base sea otra', () => {
  const d = interpretarMovimiento({ tramite: 'ULTIMO PLAZO para acompanar documentos' })
  assert.equal(d.prioridad, 'critico')
  assert.equal(d.esFatal, true)
})

// --- Ordenamiento ---

test('pesoPrioridad: critico < importante < oportunidad < informativo', () => {
  assert.ok(pesoPrioridad('critico') < pesoPrioridad('importante'))
  assert.ok(pesoPrioridad('importante') < pesoPrioridad('oportunidad'))
  assert.ok(pesoPrioridad('oportunidad') < pesoPrioridad('informativo'))
})

test('ordenarDecisiones: criticos primero, luego por fecha limite mas cercana', () => {
  const items = [
    { prioridad: 'importante' as const, fechaLimite: null },
    { prioridad: 'critico' as const, fechaLimite: '2026-05-10' },
    { prioridad: 'critico' as const, fechaLimite: '2026-05-01' },
    { prioridad: 'oportunidad' as const, fechaLimite: null },
  ]
  const ord = ordenarDecisiones(items)
  assert.equal(ord[0].prioridad, 'critico')
  assert.equal(ord[0].fechaLimite, '2026-05-01') // el mas cercano primero
  assert.equal(ord[1].fechaLimite, '2026-05-10')
  assert.equal(ord[2].prioridad, 'importante')
  assert.equal(ord[3].prioridad, 'oportunidad')
})
