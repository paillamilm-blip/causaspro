// ============================================================
// Tests de la logica de reparto (reparto.ts)
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarReparto, repartirMonto } from './reparto'

test('validarReparto: suma 100 es valida', () => {
  const r = validarReparto([
    { abogado_id: 'a', porcentaje: 60 },
    { abogado_id: 'b', porcentaje: 40 },
  ])
  assert.equal(r.ok, true)
  assert.equal(r.total, 100)
})

test('validarReparto: suma distinta de 100 falla', () => {
  const r = validarReparto([
    { abogado_id: 'a', porcentaje: 60 },
    { abogado_id: 'b', porcentaje: 30 },
  ])
  assert.equal(r.ok, false)
  assert.match(r.error || '', /100/)
})

test('validarReparto: lista vacia falla', () => {
  const r = validarReparto([])
  assert.equal(r.ok, false)
})

test('validarReparto: abogado repetido falla', () => {
  const r = validarReparto([
    { abogado_id: 'a', porcentaje: 50 },
    { abogado_id: 'a', porcentaje: 50 },
  ])
  assert.equal(r.ok, false)
  assert.match(r.error || '', /repetido/)
})

test('validarReparto: porcentaje fuera de rango falla', () => {
  const r = validarReparto([
    { abogado_id: 'a', porcentaje: 120 },
    { abogado_id: 'b', porcentaje: -20 },
  ])
  assert.equal(r.ok, false)
})

test('validarReparto: tolera pequeno error de redondeo (33.33 x3)', () => {
  const r = validarReparto([
    { abogado_id: 'a', porcentaje: 33.33 },
    { abogado_id: 'b', porcentaje: 33.33 },
    { abogado_id: 'c', porcentaje: 33.34 },
  ])
  assert.equal(r.ok, true)
})

test('repartirMonto: la suma en pesos cuadra exacta', () => {
  const items = [
    { abogado_id: 'a', porcentaje: 33.33 },
    { abogado_id: 'b', porcentaje: 33.33 },
    { abogado_id: 'c', porcentaje: 33.34 },
  ]
  const r = repartirMonto(1000000, items)
  const suma = r.a + r.b + r.c
  assert.equal(suma, 1000000) // el ultimo absorbe el residuo
})

test('repartirMonto: 60/40 de 1.000.000', () => {
  const r = repartirMonto(1000000, [
    { abogado_id: 'a', porcentaje: 60 },
    { abogado_id: 'b', porcentaje: 40 },
  ])
  assert.equal(r.a, 600000)
  assert.equal(r.b, 400000)
})
