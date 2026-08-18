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
  dias_sin_actividad: number | null
  nivel_urgencia: number | null
  ultima_audiencia: string | null
  proxima_medida_vence: string | null
  dias_medida_vence: number | null
  tiene_medida_vigente: boolean
  adulto_nombre: string | null
  adulto_telefono: string | null
}

// Semáforo basado en nivel_urgencia multi-criterio
function getSemaforo(nivel: number | null): { color: string; label: string; bg: string; texto: string; dotColor: string } {
  if (nivel === null || nivel >= 10) 
    return { color: 'text-green-600', label: '', bg: 'bg-green-50 border-green-200', texto: 'Estable', dotColor: 'bg-green-500' }
  if (nivel <= 2) 
    return { color: 'text-red-600', label: '', bg: 'bg-red-50 border-red-200', texto: 'Crítico', dotColor: 'bg-red-500' }
  if (nivel <= 4) 
    return { color: 'text-yellow-600', label: '', bg: 'bg-yellow-50 border-yellow-200', texto: 'Atención', dotColor: 'bg-yellow-400' }
  if (nivel <= 6) 
    return { color: 'text-orange-500', label: '', bg: 'bg-orange-50 border-orange-200', texto: 'Revisar', dotColor: 'bg-orange-400' }
  return { color: 'text-green-600', label: '', bg: 'bg-green-50 border-green-200', texto: 'Estable', dotColor: 'bg-green-500' }
}

function getUrgenciaMotivo(causa: CausaResumen): string {
  const nivel = causa.nivel_urgencia
  if (!nivel || nivel >= 10) return ''
  if (nivel === 1) return `⚡ Audiencia en ${Math.max(0, Math.round(causa.dias_para_audiencia || 0))} días`
  if (nivel === 2) return `⚠️ Medida cautelar vence en ${causa.dias_medida_vence} días`
  if (nivel === 3) return `📅 Audiencia en ${Math.round(causa.dias_para_audiencia || 0)} días`
  if (nivel === 4) return `😴 Sin actividad hace ${Math.round(causa.dias_sin_actividad || 0)} días`
  if (nivel === 5) return `⏳ Sin actividad hace ${Math.round(causa.dias_sin_actividad || 0)} días`
  if (nivel === 6) return '📋 Sin audiencia programada'
  return ''
}

function formatFecha(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Sin fecha'
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatFechaCorta(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
}

export default function Dashboard() {
  const [causas, setCausas] = useState<CausaResumen[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [totalCausas, setTotalCausas] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCausas()
  }, [])

  async function loadCausas() {
    setLoading(true)
    setError(null)
    
    // Intentar con la vista (tiene el semáforo)
    let { data, error: err } = await supabase
      .from('v_causas_ranking')
      .select('*')
      .limit(500)

    // Si la vista falla, usar tabla directa (sin semáforo pero funciona)
    if (err) {
      console.warn('Vista v_causas_ranking no disponible, usando tabla directa:', err.message)
      const { data: directData, error: directErr } = await supabase
        .from('causas')
        .select('id, rit, caratulado, tipo, estado, programa_vigente, sintesis, notas, updated_at')
        .order('updated_at', { ascending: false })
        .limit(500)
      
      if (directErr) {
        setError(directErr.message)
        setLoading(false)
        return
      }
      
      // Mapear a formato compatible (sin campos de urgencia)
      data = (directData || []).map((c: any) => ({
        ...c,
        total_nna: 0,
        nombres_nna: null,
        proxima_audiencia: null,
        dias_para_audiencia: null,
        dias_sin_actividad: null,
        nivel_urgencia: 10, // Verde por defecto
        ultima_audiencia: null,
        proxima_medida_vence: null,
        dias_medida_vence: null,
        tiene_medida_vigente: false,
        adulto_nombre: null,
        adulto_telefono: null,
      }))
    }
    
    if (data) {
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
      c.estado?.toLowerCase().includes(q) ||
      c.programa_vigente?.toLowerCase().includes(q)
    )
  })

  // Agrupar por nivel de urgencia
  const criticas = causasFiltradas.filter(c => (c.nivel_urgencia || 10) <= 2)
  const atencion = causasFiltradas.filter(c => (c.nivel_urgencia || 10) > 2 && (c.nivel_urgencia || 10) <= 4)
  const revisar = causasFiltradas.filter(c => (c.nivel_urgencia || 10) > 4 && (c.nivel_urgencia || 10) <= 6)
  const estables = causasFiltradas.filter(c => (c.nivel_urgencia || 10) > 6)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin text-3xl">⚙️</div>
        <span className="ml-3 text-gray-500">Cargando causas...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-700 font-medium">Error al cargar datos</p>
        <p className="text-red-500 text-sm mt-1">{error}</p>
        <p className="text-gray-500 text-xs mt-3">
          Si ves un error sobre la vista, ejecuta el SQL de actualización en Supabase.
        </p>
        <button onClick={loadCausas} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con fecha */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Panel de Control</h1>
          <p className="text-sm text-gray-400">
            Actualizado: {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button onClick={loadCausas} className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">
          🔄 Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="text-2xl font-bold text-gray-800">{totalCausas}</div>
          <div className="text-xs text-gray-500">Total causas</div>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-200">
          <div className="text-2xl font-bold text-red-700">{criticas.length}</div>
          <div className="text-xs text-red-600 flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span> Críticas
          </div>
        </div>
        <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
          <div className="text-2xl font-bold text-yellow-700">{atencion.length}</div>
          <div className="text-xs text-yellow-600 flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-yellow-400"></span> Atención
          </div>
        </div>
        <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
          <div className="text-2xl font-bold text-orange-600">{revisar.length}</div>
          <div className="text-xs text-orange-500 flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-orange-400"></span> Revisar
          </div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <div className="text-2xl font-bold text-green-700">{estables.length}</div>
          <div className="text-xs text-green-600 flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span> Estables
          </div>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative">
        <input
          type="text"
          placeholder="🔍 Buscar por RIT, caratulado, NNA, programa..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border bg-white shadow-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
        />
        {filtro && (
          <button 
            onClick={() => setFiltro('')}
            className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span> Audiencia ≤2d / Medida por vencer</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400"></span> Audiencia ≤7d / Sin actividad &gt;30d</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400"></span> Sin actividad &gt;15d / Sin audiencia</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span> Sin alertas</span>
      </div>

      {/* Secciones por urgencia */}
      {criticas.length > 0 && (
        <Section title="CRÍTICAS - Acción inmediata" causas={criticas} defaultOpen={true} dotColor="bg-red-500" />
      )}
      {atencion.length > 0 && (
        <Section title="ATENCIÓN - Revisar esta semana" causas={atencion} defaultOpen={true} dotColor="bg-yellow-400" />
      )}
      {revisar.length > 0 && (
        <Section title="REVISAR - Seguimiento pendiente" causas={revisar} defaultOpen={false} dotColor="bg-orange-400" />
      )}
      {estables.length > 0 && (
        <Section title="ESTABLES - Sin urgencia inmediata" causas={estables} defaultOpen={false} dotColor="bg-green-500" />
      )}

      {causasFiltradas.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">🔍</p>
          <p>No se encontraron causas con ese criterio</p>
        </div>
      )}
    </div>
  )
}

function Section({ title, causas, defaultOpen, dotColor }: { title: string; causas: CausaResumen[]; defaultOpen: boolean; dotColor: string }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const showing = expanded ? causas.slice(0, 50) : causas.slice(0, 5)

  return (
    <div>
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-bold text-gray-600 uppercase tracking-wide mb-3 hover:text-gray-800"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span className={`inline-block w-3 h-3 rounded-full ${dotColor}`}></span>
        <span>{title} ({causas.length})</span>
      </button>
      {showing.length > 0 && (
        <div className="space-y-2">
          {showing.map((c) => (
            <CausaCard key={c.id} causa={c} />
          ))}
          {!expanded && causas.length > 5 && (
            <button 
              onClick={() => setExpanded(true)}
              className="w-full text-center py-2 text-sm text-blue-500 hover:text-blue-700 bg-blue-50 rounded-lg"
            >
              Ver {causas.length - 5} más...
            </button>
          )}
          {expanded && causas.length > 50 && (
            <p className="text-sm text-gray-400 text-center">Mostrando 50 de {causas.length}</p>
          )}
        </div>
      )}
    </div>
  )
}

function CausaCard({ causa: c }: { causa: CausaResumen }) {
  const sem = getSemaforo(c.nivel_urgencia)
  const motivo = getUrgenciaMotivo(c)
  
  return (
    <Link href={`/causa/${c.id}`}>
      <div className={`border rounded-xl p-4 hover:shadow-md transition cursor-pointer ${sem.bg}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block w-4 h-4 rounded-full ${sem.dotColor} shadow-sm`}></span>
              <span className="font-mono font-bold text-sm text-gray-800">{c.rit}</span>
              {c.caratulado && (
                <span className="font-semibold text-gray-700 truncate">{c.caratulado}</span>
              )}
              {c.programa_vigente && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0">{c.programa_vigente}</span>
              )}
            </div>
            <div className="mt-1 text-sm text-gray-600">
              <span>👶 {c.total_nna} NNA</span>
              {c.nombres_nna && <span className="ml-1 text-gray-500">- {c.nombres_nna.substring(0, 60)}{c.nombres_nna.length > 60 ? '...' : ''}</span>}
            </div>
            {/* Motivo de urgencia */}
            {c.nivel_urgencia !== null && c.nivel_urgencia <= 6 && (
              <div className={`mt-1 text-xs font-medium ${sem.color}`}>
                {motivo}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-gray-500 ml-3 whitespace-nowrap shrink-0">
            {c.proxima_audiencia ? (
              <div>
                <div className="font-medium">📅 {formatFecha(c.proxima_audiencia)}</div>
                <div className={`font-bold ${sem.color}`}>
                  {c.dias_para_audiencia !== null && c.dias_para_audiencia <= 0 ? '¡HOY!' : 
                   c.dias_para_audiencia !== null && c.dias_para_audiencia <= 1 ? '¡Mañana!' : 
                   c.dias_para_audiencia !== null ? `En ${Math.round(c.dias_para_audiencia)} días` : ''}
                </div>
              </div>
            ) : c.ultima_audiencia ? (
              <div>
                <div className="text-gray-400">Última: {formatFechaCorta(c.ultima_audiencia)}</div>
                {c.dias_sin_actividad && c.dias_sin_actividad > 15 && (
                  <div className="text-orange-500 font-medium">{Math.round(c.dias_sin_actividad)}d inactiva</div>
                )}
              </div>
            ) : (
              <span className="text-gray-300">Sin audiencia</span>
            )}
          </div>
        </div>
        {c.estado && (
          <div className="mt-2 text-xs text-gray-400 italic truncate">{c.estado}</div>
        )}
      </div>
    </Link>
  )
}
