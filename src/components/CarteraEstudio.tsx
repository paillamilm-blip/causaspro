'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCLP } from '@/lib/finanzas'
import SelectorAbogado from './SelectorAbogado'
import { getAbogadoActivo } from '@/lib/sesionAbogado'
import type { CarteraAbogado, CarteraEstudio as CarteraEstudioRow } from '@/lib/types'

/**
 * Vista de cartera del estudio: consolidado + desglose por abogado.
 * El selector de arriba define "quien eres"; abajo se ve la cartera de cada
 * abogado y el total del estudio. Base para el reparto de honorarios entre socios.
 */
export default function CarteraEstudio() {
  const [porAbogado, setPorAbogado] = useState<CarteraAbogado[]>([])
  const [estudios, setEstudios] = useState<CarteraEstudioRow[]>([])
  const [activo, setActivo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setActivo(getAbogadoActivo())
    cargar()
  }, [])

  async function cargar() {
    setLoading(true)
    setError(null)
    try {
      const [abg, est] = await Promise.all([
        supabase.from('v_cartera_abogado').select('*'),
        supabase.from('v_cartera_estudio').select('*'),
      ])
      if (abg.error) throw new Error(abg.error.message)
      if (est.error) throw new Error(est.error.message)
      setPorAbogado((abg.data || []) as CarteraAbogado[])
      setEstudios((est.data || []) as CarteraEstudioRow[])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin text-3xl">🏛️</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <SelectorAbogado onChange={setActivo} />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-amber-800 font-medium">No se pudo cargar la cartera</p>
          <p className="text-amber-600 text-sm mt-1">{error}</p>
          <p className="text-amber-600 text-xs mt-3">
            ¿Ejecutaste <code className="bg-amber-100 px-1 rounded">schema-multiabogado.sql</code> en Supabase?
          </p>
        </div>
      </div>
    )
  }

  const abogadosMostrados = activo ? porAbogado.filter((a) => a.abogado_id === activo) : porAbogado

  return (
    <div className="space-y-5">
      <SelectorAbogado onChange={setActivo} />

      {/* Consolidado del estudio */}
      {estudios.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">🏛️ Consolidado del estudio</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {estudios.map((e) => (
              <div key={e.estudio_id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800">{e.nombre}</p>
                  <span className="text-xs text-gray-400">{e.total_abogados} abogados</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <Mini label="Causas" valor={String(e.total_causas)} />
                  <Mini label="Por cobrar" valor={formatCLP(e.por_cobrar)} color="text-blue-600" />
                  <Mini label="Vencido" valor={formatCLP(e.vencido)} color={e.vencido > 0 ? 'text-red-600' : 'text-gray-400'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desglose por abogado */}
      <div>
        <h3 className="text-sm font-medium text-gray-600 mb-2">
          {activo ? '👤 Mi cartera' : '👥 Cartera por abogado'}
        </h3>
        {abogadosMostrados.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-3xl mb-2">🗂️</p>
            <p className="text-gray-700 font-medium">Sin datos de cartera</p>
            <p className="text-gray-500 text-sm mt-1">
              Crea abogados y asígnales causas para ver su cartera.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {abogadosMostrados.map((a) => (
              <div key={a.abogado_id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{a.nombre}</span>
                    {a.rol === 'socio' && (
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">SOCIO</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {a.total_causas} causas · {a.total_clientes} clientes
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Mini label="Por cobrar (atribuido)" valor={formatCLP(a.por_cobrar)} color="text-blue-600" />
                  <Mini label="Vencido" valor={formatCLP(a.vencido)} color={a.vencido > 0 ? 'text-red-600' : 'text-gray-400'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center border-t pt-4">
        El "por cobrar atribuido" reparte cada honorario según su reparto entre socios (si existe),
        o se asigna 100% al abogado responsable de la causa.
      </p>
    </div>
  )
}

function Mini({ label, valor, color = 'text-gray-700' }: { label: string; valor: string; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2 px-2 text-center">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{valor}</p>
    </div>
  )
}
