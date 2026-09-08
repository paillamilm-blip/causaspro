'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Decision, Prioridad } from '@/lib/copiloto'

/** Decision con el contexto de su causa (lo que devuelve /api/copiloto). */
interface DecisionCausa extends Decision {
  causa_id: string
  rit: string | null
  caratulado: string | null
  movimiento_fecha: string | null
  dias_restantes: number | null
}

interface RespuestaCopiloto {
  ok: boolean
  ia_disponible: boolean
  ia_usada: boolean
  total: number
  decisiones: DecisionCausa[]
  error?: string
}

/**
 * Dashboard "Que decidir hoy": el corazon del copiloto.
 * Muestra las decisiones priorizadas (critico / importante / oportunidad)
 * con accion sugerida, plazo y riesgo. No son datos: son decisiones.
 */
export default function CopilotoDecisiones() {
  const [data, setData] = useState<RespuestaCopiloto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usarIA, setUsarIA] = useState(false)

  useEffect(() => {
    cargar(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function cargar(ia: boolean) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/copiloto?dias=15${ia ? '&ia=1' : ''}`)
      const json = (await res.json()) as RespuestaCopiloto
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al cargar el copiloto')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <div className="animate-spin text-3xl">🧠</div>
        <p className="text-sm text-gray-400">Analizando tus causas...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-amber-800 font-medium">No se pudo cargar el copiloto</p>
        <p className="text-amber-600 text-sm mt-1">{error}</p>
        <p className="text-amber-600 text-xs mt-3">
          Necesitas movimientos cargados por el bot del PJUD para ver decisiones.
        </p>
      </div>
    )
  }

  const decisiones = data?.decisiones || []
  const criticas = decisiones.filter((d) => d.prioridad === 'critico')
  const importantes = decisiones.filter((d) => d.prioridad === 'importante')
  const oportunidades = decisiones.filter((d) => d.prioridad === 'oportunidad')

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">🧠 Qué decidir hoy</h2>
          <p className="text-sm text-gray-500">
            {decisiones.length === 0
              ? 'Sin decisiones pendientes'
              : `${decisiones.length} ${decisiones.length === 1 ? 'decisión' : 'decisiones'} · ${criticas.length} críticas`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.ia_disponible && (
            <button
              onClick={() => {
                const next = !usarIA
                setUsarIA(next)
                cargar(next)
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                usarIA ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-300'
              }`}
              title="Reescribe las decisiones críticas con IA en lenguaje claro"
            >
              ✨ {usarIA ? 'IA activada' : 'Mejorar con IA'}
            </button>
          )}
          <button
            onClick={() => cargar(usarIA)}
            className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            ↻ Actualizar
          </button>
        </div>
      </div>

      {decisiones.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-green-800 font-medium">Todo bajo control</p>
          <p className="text-green-600 text-sm mt-1">No hay decisiones urgentes en tus causas recientes.</p>
        </div>
      ) : (
        <>
          {criticas.length > 0 && (
            <Grupo titulo="🔴 Crítico — decide ahora" items={criticas} />
          )}
          {importantes.length > 0 && (
            <Grupo titulo="🟡 Importante — esta semana" items={importantes} />
          )}
          {oportunidades.length > 0 && (
            <Grupo titulo="🟢 Oportunidad" items={oportunidades} />
          )}
        </>
      )}

      {data?.ia_usada && (
        <p className="text-xs text-purple-400 text-center">✨ Decisiones críticas mejoradas con IA</p>
      )}
    </div>
  )
}

function Grupo({ titulo, items }: { titulo: string; items: DecisionCausa[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-600 mb-2">{titulo}</h3>
      <div className="space-y-2">
        {items.map((d, i) => (
          <TarjetaDecision key={`${d.causa_id}-${i}`} d={d} />
        ))}
      </div>
    </div>
  )
}

const ESTILO_PRIORIDAD: Record<Prioridad, string> = {
  critico: 'bg-red-50 border-red-200',
  importante: 'bg-amber-50 border-amber-200',
  oportunidad: 'bg-emerald-50 border-emerald-200',
  informativo: 'bg-white border-gray-200',
}

function TarjetaDecision({ d }: { d: DecisionCausa }) {
  return (
    <div className={`rounded-xl border p-4 ${ESTILO_PRIORIDAD[d.prioridad]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800">{d.titulo}</span>
            {d.fuente === 'ia' && <span className="text-[10px] text-purple-500">✨ IA</span>}
            {d.rit && <span className="text-xs text-gray-400 font-mono">{d.rit}</span>}
          </div>
          {d.caratulado && <p className="text-xs text-gray-400 truncate">{d.caratulado}</p>}
        </div>
        {d.fechaLimite && <PlazoBadge dias={d.dias_restantes} fatal={d.esFatal} />}
      </div>

      <p className="text-sm text-gray-600 mt-2">{d.explicacion}</p>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div className="bg-white/60 rounded-lg p-2">
          <span className="text-xs text-gray-400 uppercase">Acción sugerida</span>
          <p className="text-gray-700">👉 {d.accion}</p>
        </div>
        <div className="bg-white/60 rounded-lg p-2">
          <span className="text-xs text-gray-400 uppercase">Riesgo si no actúas</span>
          <p className="text-gray-700">{d.riesgo}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/causa/${d.causa_id}`}
          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
        >
          Ver causa
        </Link>
        {d.fechaLimite && (
          <span className="text-xs text-gray-500" title="Plazo referencial: no considera feriados móviles. Verifica en el expediente.">
            Vence aprox.: {formatFecha(d.fechaLimite)}
            {d.plazoDiasHabiles != null && ` (${d.plazoDiasHabiles} días hábiles)`}
          </span>
        )}
      </div>
    </div>
  )
}

function PlazoBadge({ dias, fatal }: { dias: number | null; fatal: boolean }) {
  if (dias == null) return null
  let texto: string
  let clase: string
  if (dias < 0) {
    texto = `Vencido hace ${Math.abs(dias)} d`
    clase = 'bg-red-600 text-white'
  } else if (dias === 0) {
    texto = 'Vence hoy'
    clase = 'bg-red-600 text-white'
  } else if (dias <= 2) {
    texto = `${dias} día${dias === 1 ? '' : 's'}`
    clase = 'bg-red-100 text-red-700'
  } else {
    texto = `${dias} días`
    clase = 'bg-amber-100 text-amber-700'
  }
  return (
    <span className={`whitespace-nowrap text-xs font-medium px-2 py-1 rounded-full ${clase}`}>
      ⏱ {texto}{fatal ? ' · fatal' : ''}
    </span>
  )
}

function formatFecha(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}
