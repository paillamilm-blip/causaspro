'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { materiaDeTipo, materiaDeRit, type GrupoMateria } from '@/lib/materiasFamilia'

// Color del chip de materia según su grupo práctico.
const GRUPO_CHIP: Record<GrupoMateria, string> = {
  contencioso: 'bg-purple-100 text-purple-700',
  proteccion: 'bg-rose-100 text-rose-700',
  voluntario: 'bg-teal-100 text-teal-700',
  sin_materia: 'bg-amber-100 text-amber-700',
  generico: 'bg-gray-100 text-gray-500',
}

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
  tiene_traslado_curador: boolean
  ultimo_movimiento: string | null
  fecha_ultimo_movimiento: string | null
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

// Motivo legible de la urgencia, alineado con el semáforo de la vista
// (schema-semaforo-proteccion.sql). Prioriza la señal más fuerte de la causa.
function getUrgenciaMotivo(causa: CausaResumen): string {
  const nivel = causa.nivel_urgencia
  if (!nivel || nivel >= 10) return ''
  const d = causa.dias_para_audiencia
  // Solo consideramos "audiencia inminente" la que el CASE realmente usa para el nivel:
  // ≤2d en nivel 1, ≤7d en nivel 3. Así el mensaje coincide con la señal que disparó el nivel.
  const audienciaInminente = (limite: number) =>
    causa.proxima_audiencia != null && d != null && d <= limite
      ? `📅 Audiencia en ${Math.max(0, Math.round(d))} días`
      : ''
  if (nivel === 1) {
    // El CASE llega a nivel 1 por audiencia ≤2d O por traslado curador ≤30d. Priorizamos la
    // audiencia inminente (más urgente en el tiempo); si no hay, es el traslado reciente.
    const aud = audienciaInminente(2)
    if (aud) return aud
    if (causa.tiene_traslado_curador) return '🔴 Traslado al curador (≤30 días)'
    return '🔴 Acción inmediata'
  }
  if (nivel === 2) return `⚠️ Medida cautelar vence en ${causa.dias_medida_vence} días`
  if (nivel === 3) {
    // Nivel 3 = audiencia futura ≤7d O movimiento nuevo ≤7d. Solo mostramos la audiencia
    // si de verdad es ≤7d (si no, el nivel lo disparó el movimiento nuevo).
    const aud = audienciaInminente(7)
    if (aud) return aud
    const mov = causa.ultimo_movimiento ? `: ${causa.ultimo_movimiento}` : ''
    return `🆕 Movimiento nuevo (últimos 7 días)${mov}`
  }
  if (nivel === 4) return '🔴 Traslado al curador (revisar)'
  if (nivel === 6) return `😴 Sin movimiento hace ${Math.round(causa.dias_sin_actividad || 0)} días (estancada)`
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
  // true si se cayó al fallback de tabla directa (sin la vista): en ese modo NO tenemos
  // fecha_ultimo_movimiento/ultima_audiencia, así que la barra de progreso no aplica.
  const [modoFallback, setModoFallback] = useState(false)

  useEffect(() => {
    loadCausas()
  }, [])

  // Trae TODAS las filas de una tabla/vista paginando de a 1000 (límite por request de
  // Supabase/PostgREST). Antes se usaba .limit(500), que ocultaba causas: si había 633,
  // el panel solo veía 500 y NO evaluaba alertas de las otras 133 (riesgo real: perder
  // una audiencia urgente). Ahora traemos el 100%.
  async function fetchAll(tabla: string, columnas: string, ordenar?: string) {
    const PAGE = 1000
    let desde = 0
    let todo: any[] = []
    for (;;) {
      let q = supabase.from(tabla).select(columnas)
      if (ordenar) q = q.order(ordenar, { ascending: false })
      // Desempate ÚNICO por id: con >1000 filas, OFFSET/LIMIT solo es estable si el orden
      // es total. Sin esto, una fila del borde podría duplicarse o saltarse entre páginas
      // (reintroduciría el bug de "causa invisible"). id es único → orden reproducible.
      q = q.order('id', { ascending: true })
      const { data, error } = await q.range(desde, desde + PAGE - 1)
      if (error) return { data: null as any[] | null, error }
      const lote = data || []
      todo = todo.concat(lote)
      if (lote.length < PAGE) break // última página
      desde += PAGE
    }
    // Defensa extra: deduplicar por id por si el orden del backend varió entre páginas.
    const vistos = new Set<string>()
    const unicos = todo.filter((r: any) => {
      const k = String(r?.id ?? '')
      if (!k) return true
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
    return { data: unicos, error: null }
  }

  async function loadCausas() {
    setLoading(true)
    setError(null)
    setModoFallback(false)
    
    // Intentar con la vista (tiene el semáforo). Traemos TODAS las causas (paginado).
    let { data, error: err } = await fetchAll('v_causas_ranking', '*')

    // Si la vista falla, usar tabla directa (sin semáforo pero funciona)
    if (err) {
      setModoFallback(true)
      console.warn('Vista v_causas_ranking no disponible, usando tabla directa:', err.message)
      const { data: directData, error: directErr } = await fetchAll(
        'causas',
        'id, rit, caratulado, tipo, estado, programa_vigente, sintesis, notas, updated_at',
        'updated_at',
      )
      
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

  // Progreso de llenado por el bot: una causa está "con datos del portal" si tiene
  // al menos un movimiento (fecha_ultimo_movimiento) o una audiencia registrada.
  // Se calcula sobre TODAS las causas (no las filtradas) para reflejar el avance real.
  const conDatos = causas.filter(c => c.fecha_ultimo_movimiento || c.ultima_audiencia).length
  const pctDatos = totalCausas > 0 ? Math.round((conDatos / totalCausas) * 100) : 0

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

      {/* Progreso de llenado de datos por el bot (solo con la vista; el fallback de
          tabla directa no trae fecha_ultimo_movimiento/ultima_audiencia). */}
      {!modoFallback && (
      <div className="bg-white rounded-xl p-4 border shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            📥 Datos cargados desde el portal
          </span>
          <span className="text-sm font-semibold text-blue-600">
            {conDatos} de {totalCausas} causas ({pctDatos}%)
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${pctDatos}%` }}
          />
        </div>
        {conDatos < totalCausas && (
          <p className="text-xs text-gray-400 mt-1.5">
            Faltan {totalCausas - conDatos} causas por revisar con el bot (movimientos/audiencias).
          </p>
        )}
      </div>
      )}

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
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span> Traslado curador ≤30d / Audiencia ≤2d / Medida por vencer</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400"></span> Movimiento nuevo ≤7d / Audiencia ≤7d / Traslado curador</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400"></span> Estancada: sin movimiento &gt;90d</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span> Con actividad reciente</span>
      </div>

      {/* 🚨 ALERTA: TRASLADOS AL CURADOR */}
      {causasFiltradas.filter(c => c.tiene_traslado_curador).length > 0 && (
        <div className="bg-red-100 border-2 border-red-400 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🚨</span>
            <h2 className="font-bold text-red-800 text-lg">NUEVOS TRASLADOS AL CURADOR</h2>
            <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
              {causasFiltradas.filter(c => c.tiene_traslado_curador).length}
            </span>
          </div>
          <div className="space-y-2">
            {causasFiltradas.filter(c => c.tiene_traslado_curador).map(c => (
              <Link key={c.id} href={`/causa/${c.id}`}>
                <div className="bg-white border border-red-300 rounded-lg p-3 hover:shadow-md transition cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-red-700">{c.rit}</span>
                      {c.caratulado && <span className="ml-2 text-gray-700">{c.caratulado}</span>}
                    </div>
                    <div className="text-xs text-red-600 font-medium">
                      {c.ultimo_movimiento || 'TRASLADO AL CURADOR'}
                    </div>
                  </div>
                  {c.nombres_nna && (
                    <div className="text-xs text-gray-500 mt-1">👶 {c.nombres_nna.substring(0, 60)}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

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
  // Materia de la causa (del tipo/letra o del RIT). Nunca se inventa.
  const materia = materiaDeTipo(c.tipo) || materiaDeRit(c.rit)
  
  return (
    <Link href={`/causa/${c.id}`}>
      <div className={`border rounded-xl p-4 hover:shadow-md transition cursor-pointer ${sem.bg}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block w-4 h-4 rounded-full ${sem.dotColor} shadow-sm`}></span>
              <span className="font-mono font-bold text-sm text-gray-800">{c.rit}</span>
              {materia && (
                <span
                  title={materia.descripcion}
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${GRUPO_CHIP[materia.grupo]}`}
                >
                  {materia.materia}
                </span>
              )}
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
