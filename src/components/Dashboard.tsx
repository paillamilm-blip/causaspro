'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface CausaResumen {
  id: string
  rit: string
  caratulado: string | null
  tipo: string | null
  estado: string | null
  programa_vigente: string | null
  sintesis: string | null
  total_nna: number
  nombres_nna: string | null
  proxima_audiencia: string | null
  dias_para_audiencia: number | null
  adulto_nombre: string | null
  adulto_telefono: string | null
}

function getSemaforo(dias: number | null): { color: string; label: string; bg: string } {
  if (dias === null) return { color: 'text-gray-400', label: '⚪', bg: 'bg-gray-50' }
  if (dias <= 2) return { color: 'text-red-600', label: '🔴', bg: 'bg-red-50 border-red-200' }
  if (dias <= 7) return { color: 'text-yellow-600', label: '🟡', bg: 'bg-yellow-50 border-yellow-200' }
  return { color: 'text-green-600', label: '🟢', bg: 'bg-green-50 border-green-200' }
}

function formatFecha(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const d = new Date(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function Dashboard() {
  const [causas, setCausas] = useState<CausaResumen[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [totalCausas, setTotalCausas] = useState(0)

  useEffect(() => {
    loadCausas()
  }, [])

  async function loadCausas() {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_causas_ranking')
      .select('*')
      .limit(500)

    if (!error && data) {
      setCausas(data)
      setTotalCausas(data.length)
    }
    setLoading(false)
  }

  const causasFiltradas = causas.filter(c => {
    if (!filtro) return true
    const q = filtro.toLowerCase()
    return (
      c.rit?.toLowerCase().includes(q) ||
      c.caratulado?.toLowerCase().includes(q) ||
      c.nombres_nna?.toLowerCase().includes(q) ||
      c.estado?.toLowerCase().includes(q)
    )
  })

  // Agrupar por urgencia
  const urgentes = causasFiltradas.filter(c => c.dias_para_audiencia !== null && c.dias_para_audiencia <= 2)
  const atencion = causasFiltradas.filter(c => c.dias_para_audiencia !== null && c.dias_para_audiencia > 2 && c.dias_para_audiencia <= 7)
  const estables = causasFiltradas.filter(c => c.dias_para_audiencia === null || c.dias_para_audiencia > 7)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin text-3xl">⚙️</div>
        <span className="ml-3 text-gray-500">Cargando causas...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-2xl font-bold">{totalCausas}</div>
          <div className="text-sm text-gray-500">Total causas</div>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-200">
          <div className="text-2xl font-bold text-red-700">{urgentes.length}</div>
          <div className="text-sm text-red-600">🔴 Urgentes</div>
        </div>
        <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
          <div className="text-2xl font-bold text-yellow-700">{atencion.length}</div>
          <div className="text-sm text-yellow-600">🟡 Atención</div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <div className="text-2xl font-bold text-green-700">{estables.length}</div>
          <div className="text-sm text-green-600">🟢 Estables</div>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative">
        <input
          type="text"
          placeholder="🔍 Buscar por RIT, caratulado, NNA..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border bg-white shadow-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
        />
      </div>

      {/* Secciones por urgencia */}
      {urgentes.length > 0 && (
        <Section title="🔴 VENCE HOY / MAÑANA" causas={urgentes} color="red" />
      )}
      {atencion.length > 0 && (
        <Section title="🟡 VENCE ESTA SEMANA" causas={atencion} color="yellow" />
      )}
      <Section title="🟢 SIN URGENCIA INMEDIATA" causas={estables} color="green" />
    </div>
  )
}

function Section({ title, causas, color }: { title: string; causas: CausaResumen[]; color: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">{title} ({causas.length})</h2>
      <div className="space-y-3">
        {causas.slice(0, 50).map((c) => (
          <CausaCard key={c.id} causa={c} />
        ))}
        {causas.length > 50 && (
          <p className="text-sm text-gray-400 text-center">... y {causas.length - 50} más</p>
        )}
      </div>
    </div>
  )
}

function CausaCard({ causa: c }: { causa: CausaResumen }) {
  const sem = getSemaforo(c.dias_para_audiencia)
  
  return (
    <Link href={`/causa/${c.id}`}>
      <div className={`border rounded-xl p-4 hover:shadow-md transition cursor-pointer ${sem.bg}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{sem.label}</span>
              <span className="font-mono font-bold text-sm">{c.rit}</span>
              <span className="font-semibold text-gray-700">{c.caratulado}</span>
              {c.programa_vigente && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{c.programa_vigente}</span>
              )}
            </div>
            <div className="mt-1 text-sm text-gray-600">
              <span>👶 {c.total_nna} NNA: {c.nombres_nna || '-'}</span>
            </div>
            {c.sintesis && (
              <p className="mt-1 text-xs text-gray-500 line-clamp-1">{c.sintesis}</p>
            )}
          </div>
          <div className="text-right text-xs text-gray-500 ml-4 whitespace-nowrap">
            {c.proxima_audiencia ? (
              <div>
                <div className="font-medium">📅 {formatFecha(c.proxima_audiencia)}</div>
                <div className={sem.color}>
                  {c.dias_para_audiencia !== null && c.dias_para_audiencia <= 0 ? 'HOY' : 
                   c.dias_para_audiencia === 1 ? 'Mañana' : 
                   `En ${Math.round(c.dias_para_audiencia!)} días`}
                </div>
              </div>
            ) : (
              <span className="text-gray-300">Sin audiencia</span>
            )}
          </div>
        </div>
        {c.estado && (
          <div className="mt-2 text-xs text-gray-400 italic">{c.estado}</div>
        )}
      </div>
    </Link>
  )
}
