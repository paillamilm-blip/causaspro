'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCLP, formatFecha, variacionPct } from '@/lib/finanzas'
import type { SaludFinanciera, CuotaPorCobrar } from '@/lib/types'

/**
 * Panel Financiero — la "salud del estudio".
 * Muestra: por cobrar, cuotas vencidas, ingresos del mes + lista de cobranza.
 * Este es el diferenciador que ningun competidor tiene integrado con el PJUD.
 */
export default function PanelFinanciero() {
  const [salud, setSalud] = useState<SaludFinanciera | null>(null)
  const [porCobrar, setPorCobrar] = useState<CuotaPorCobrar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setLoading(true)
    setError(null)
    try {
      // Salud financiera (vista con una sola fila)
      const { data: saludData, error: saludErr } = await supabase
        .from('v_salud_financiera')
        .select('*')
        .maybeSingle()
      if (saludErr) throw new Error(saludErr.message)
      setSalud(saludData as SaludFinanciera | null)

      // Cuotas por cobrar
      const { data: cuotasData, error: cuotasErr } = await supabase
        .from('v_cuotas_por_cobrar')
        .select('*')
      if (cuotasErr) throw new Error(cuotasErr.message)
      setPorCobrar((cuotasData || []) as CuotaPorCobrar[])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function marcarPagada(cuotaId: string) {
    try {
      const res = await fetch('/api/cuotas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cuotaId, accion: 'pagar' }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al marcar como pagada')
      await cargar()
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  function recordarWhatsApp(c: CuotaPorCobrar) {
    const tel = (c.cliente_telefono || '').replace(/[^0-9]/g, '')
    const saldo = formatCLP(c.saldo)
    const causa = c.rit ? ` de la causa ${c.rit}` : ''
    const msg = encodeURIComponent(
      `Hola ${c.cliente_nombre || ''}, le recuerdo el pago de la cuota ${c.numero}${causa} por ${saldo}. Quedo atento. Muchas gracias.`
    )
    const base = tel ? `https://wa.me/${tel.startsWith('56') ? tel : '56' + tel}` : 'https://wa.me/'
    window.open(`${base}?text=${msg}`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin text-3xl">💰</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-amber-800 font-medium">No se pudo cargar el panel financiero</p>
        <p className="text-amber-600 text-sm mt-1">{error}</p>
        <p className="text-amber-600 text-xs mt-3">
          ¿Ejecutaste <code className="bg-amber-100 px-1 rounded">schema-negocio.sql</code> en Supabase?
        </p>
      </div>
    )
  }

  const porCobrarTotal = salud?.por_cobrar_total ?? 0
  const vencido = salud?.monto_vencido_total ?? 0
  const ingresos = salud?.ingresos_mes ?? 0
  const variacion = variacionPct(ingresos, salud?.ingresos_mes_anterior ?? 0)
  const vencidas = porCobrar.filter((c) => c.estado_cuota === 'vencida')
  const pendientes = porCobrar.filter((c) => c.estado_cuota === 'pendiente')

  return (
    <div className="space-y-6">
      {/* Tarjetas de salud financiera */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          titulo="Por cobrar"
          valor={formatCLP(porCobrarTotal)}
          sub={`${salud?.honorarios_activos ?? 0} honorarios activos`}
          color="blue"
          icono="📥"
        />
        <StatCard
          titulo="Cuotas vencidas"
          valor={formatCLP(vencido)}
          sub={`${salud?.honorarios_con_mora ?? 0} clientes en mora`}
          color={vencido > 0 ? 'red' : 'green'}
          icono="⚠️"
        />
        <StatCard
          titulo="Ingresos del mes"
          valor={formatCLP(ingresos)}
          sub={variacion === null ? 'Sin comparación' : `${variacion >= 0 ? '↑' : '↓'} ${Math.abs(variacion)}% vs mes anterior`}
          color="green"
          icono="📈"
        />
      </div>

      {/* Cobranza pendiente */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800">💸 Cobranza pendiente</h3>
          <span className="text-xs text-gray-400">
            {vencidas.length} vencidas · {pendientes.length} por vencer
          </span>
        </div>

        {porCobrar.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-green-800 font-medium">Todo al día</p>
            <p className="text-green-600 text-sm mt-1">No hay cuotas pendientes de cobro.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...vencidas, ...pendientes].map((c) => (
              <CuotaRow key={c.id} cuota={c} onPagar={marcarPagada} onRecordar={recordarWhatsApp} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  titulo,
  valor,
  sub,
  color,
  icono,
}: {
  titulo: string
  valor: string
  sub: string
  color: 'blue' | 'red' | 'green'
  icono: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 text-sm opacity-80">
        <span>{icono}</span>
        <span>{titulo}</span>
      </div>
      <p className="text-2xl font-bold mt-1">{valor}</p>
      <p className="text-xs opacity-70 mt-0.5">{sub}</p>
    </div>
  )
}

function CuotaRow({
  cuota,
  onPagar,
  onRecordar,
}: {
  cuota: CuotaPorCobrar
  onPagar: (id: string) => void
  onRecordar: (c: CuotaPorCobrar) => void
}) {
  const esVencida = cuota.estado_cuota === 'vencida'
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
        esVencida ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${esVencida ? 'text-red-700' : 'text-gray-800'}`}>
            {cuota.cliente_nombre || 'Sin cliente'}
          </span>
          {cuota.rit && <span className="text-xs text-gray-400">· {cuota.rit}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Cuota {cuota.numero} · vence {formatFecha(cuota.fecha_vencimiento)}
          {esVencida && cuota.dias_vencida != null && (
            <span className="text-red-600 font-medium"> · hace {cuota.dias_vencida} días</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${esVencida ? 'text-red-700' : 'text-gray-700'}`}>
          {formatCLP(cuota.saldo)}
        </span>
        <button
          onClick={() => onRecordar(cuota)}
          className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 transition"
          title="Recordar por WhatsApp"
        >
          💬 Recordar
        </button>
        <button
          onClick={() => onPagar(cuota.id)}
          className="text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700 transition"
        >
          ✓ Pagada
        </button>
      </div>
    </div>
  )
}
