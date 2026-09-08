'use client'
import { useEffect, useState } from 'react'
import { formatCLP, formatFecha, estadoCuota, calcularMontoPactado, labelModalidad } from '@/lib/finanzas'
import type { Honorario, Cuota, ModalidadHonorario, HonorarioResumen } from '@/lib/types'

/**
 * Gestion del honorario y las cuotas de UNA causa.
 * Permite pactar honorario (fijo/exito/mixto), generar plan de cuotas y marcar pagos.
 */
export default function HonorariosCausa({ causaId }: { causaId: string }) {
  const [honorario, setHonorario] = useState<Honorario | null>(null)
  const [cuotas, setCuotas] = useState<Cuota[]>([])
  const [resumen, setResumen] = useState<HonorarioResumen | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [causaId])

  async function cargar() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/honorarios?causa_id=${causaId}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al cargar honorario')
      setHonorario(data.honorario)
      setCuotas(data.cuotas || [])
      setResumen(data.resumen || null)
      setEditando(!data.honorario)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function marcarPagada(cuotaId: string, pagar: boolean) {
    try {
      const res = await fetch('/api/cuotas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cuotaId, accion: pagar ? 'pagar' : 'reabrir' }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      await cargar()
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="animate-spin text-2xl">💰</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        {error}
        <p className="text-xs mt-1">¿Ejecutaste <code className="bg-amber-100 px-1 rounded">schema-negocio.sql</code>?</p>
      </div>
    )
  }

  if (editando) {
    return <FormHonorario causaId={causaId} honorario={honorario} onSaved={cargar} onCancel={honorario ? () => setEditando(false) : undefined} />
  }

  const pactado = honorario ? calcularMontoPactado(honorario) : 0

  return (
    <div className="space-y-4">
      {/* Resumen del honorario */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">{honorario && labelModalidad(honorario.modalidad)}</p>
            <p className="text-xl font-bold text-gray-800">{formatCLP(pactado)}</p>
          </div>
          <button
            onClick={() => setEditando(true)}
            className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            ✏️ Editar
          </button>
        </div>
        {resumen && (
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <MiniStat label="Pagado" valor={formatCLP(resumen.total_pagado)} color="text-green-600" />
            <MiniStat label="Por cobrar" valor={formatCLP(Math.max(0, pactado - resumen.total_pagado))} color="text-blue-600" />
            <MiniStat
              label="Vencido"
              valor={formatCLP(resumen.monto_vencido)}
              color={resumen.monto_vencido > 0 ? 'text-red-600' : 'text-gray-400'}
            />
          </div>
        )}
      </div>

      {/* Plan de cuotas */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          Plan de cuotas ({resumen?.cuotas_pagadas ?? 0}/{cuotas.length} pagadas)
        </h4>
        {cuotas.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-3">
            Sin cuotas. Edita el honorario para generar un plan de pago.
          </p>
        ) : (
          <div className="space-y-1.5">
            {cuotas.map((cu) => {
              const est = estadoCuota(cu)
              return (
                <div
                  key={cu.id}
                  className={`flex items-center justify-between rounded-lg border p-2.5 text-sm ${
                    est === 'pagada'
                      ? 'bg-green-50 border-green-200'
                      : est === 'vencida'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div>
                    <span className="font-medium text-gray-700">Cuota {cu.numero}</span>
                    <span className="text-xs text-gray-400 ml-2">vence {formatFecha(cu.fecha_vencimiento)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-700">{formatCLP(cu.monto)}</span>
                    {est === 'pagada' ? (
                      <button
                        onClick={() => marcarPagada(cu.id, false)}
                        className="text-xs text-green-700 hover:underline"
                        title="Revertir pago"
                      >
                        ✓ Pagada
                      </button>
                    ) : (
                      <button
                        onClick={() => marcarPagada(cu.id, true)}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700 transition"
                      >
                        Marcar pagada
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, valor, color }: { label: string; valor: string; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{valor}</p>
    </div>
  )
}

function FormHonorario({
  causaId,
  honorario,
  onSaved,
  onCancel,
}: {
  causaId: string
  honorario: Honorario | null
  onSaved: () => void
  onCancel?: () => void
}) {
  const [modalidad, setModalidad] = useState<ModalidadHonorario>(honorario?.modalidad || 'fijo')
  const [montoTotal, setMontoTotal] = useState(String(honorario?.monto_total || ''))
  const [pctExito, setPctExito] = useState(String(honorario?.porcentaje_exito || ''))
  const [montoGanado, setMontoGanado] = useState(String(honorario?.monto_ganado || ''))
  const [numCuotas, setNumCuotas] = useState('1')
  const [primeraFecha, setPrimeraFecha] = useState(new Date().toISOString().slice(0, 10))
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    try {
      const res = await fetch('/api/honorarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          causa_id: causaId,
          modalidad,
          monto_total: Number(montoTotal) || 0,
          porcentaje_exito: Number(pctExito) || 0,
          monto_ganado: Number(montoGanado) || 0,
          num_cuotas: Number(numCuotas) || 1,
          primera_fecha: primeraFecha,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      onSaved()
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  const usaFijo = modalidad === 'fijo' || modalidad === 'mixto'
  const usaExito = modalidad === 'exito' || modalidad === 'mixto'

  return (
    <form onSubmit={guardar} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <span className="text-xs text-gray-500">Modalidad de cobro</span>
        <div className="flex gap-2 mt-1">
          {(['fijo', 'exito', 'mixto'] as ModalidadHonorario[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModalidad(m)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                modalidad === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {labelModalidad(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {usaFijo && (
          <NumInput label="Monto fijo (CLP)" value={montoTotal} onChange={setMontoTotal} placeholder="1200000" />
        )}
        {usaExito && (
          <>
            <NumInput label="% de éxito" value={pctExito} onChange={setPctExito} placeholder="20" />
            <NumInput label="Monto ganado (CLP)" value={montoGanado} onChange={setMontoGanado} placeholder="5000000" />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumInput label="N° de cuotas" value={numCuotas} onChange={setNumCuotas} placeholder="6" />
        <label className="block">
          <span className="text-xs text-gray-500">Primera cuota vence</span>
          <input
            type="date"
            value={primeraFecha}
            onChange={(e) => setPrimeraFecha(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={guardando}
          className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {guardando ? 'Guardando...' : 'Guardar honorario y generar cuotas'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

function NumInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    </label>
  )
}
