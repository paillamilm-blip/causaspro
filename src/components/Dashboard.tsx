'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { materiaDeTipo, materiaDeRit, type GrupoMateria } from '@/lib/materiasFamilia'
import { estadoSeguimientoNna, agruparGestionesPorCausa } from '@/lib/seguimientoNna'
import {
  IconRefresh, IconSearch, IconX, IconUsers, IconCalendar,
  IconAlert, IconDownload, IconChevron, IconClock, IconInbox,
  IconCheck, IconShield, IconSparkles, IconPause,
} from './icons'
import type { ComponentType, SVGProps } from 'react'

type IconoTipo = ComponentType<SVGProps<SVGSVGElement>>

// Motivo de urgencia con ÍCONO SVG formal (ligado al color del nivel) + texto.
// Reemplaza los emoji por iconos de una sola familia (más serio/profesional).
interface MotivoUrgencia { Icono: IconoTipo; texto: string }

// Filtro rápido activo desde las tarjetas KPI. 'todas' = sin filtro por urgencia.
type FiltroUrgencia = 'todas' | 'traslados' | 'seguimiento' | 'criticas' | 'atencion' | 'revisar' | 'estables' | 'fuera'

// Título y color de punto para la sección única que se muestra cuando hay un filtro rápido
// activo (clic en un KPI). 'todas' no aplica: en ese caso se muestran las secciones por nivel.
const FILTRO_SECCION: Record<Exclude<FiltroUrgencia, 'todas'>, { title: string; dotColor: string; tono: TonoBloque; Icono: IconoTipo }> = {
  traslados:   { title: 'Traslados al curador', dotColor: 'bg-violet-500', tono: 'violet', Icono: IconShield },
  seguimiento: { title: 'Seguimiento del NNA vencido', dotColor: 'bg-rose-500', tono: 'rose', Icono: IconUsers },
  criticas:    { title: 'Críticas — Acción inmediata', dotColor: 'bg-red-500', tono: 'red', Icono: IconAlert },
  atencion:    { title: 'Atención — Revisar esta semana', dotColor: 'bg-amber-400', tono: 'amber', Icono: IconClock },
  revisar:     { title: 'Revisar — Seguimiento pendiente', dotColor: 'bg-orange-400', tono: 'orange', Icono: IconPause },
  estables:    { title: 'Estables — Sin urgencia inmediata', dotColor: 'bg-green-500', tono: 'green', Icono: IconCheck },
  fuera:       { title: 'Fuera de monitoreo — relevadas / con sentencia de rechazo', dotColor: 'bg-slate-500', tono: 'slate', Icono: IconInbox },
}

// Color del chip de materia según su grupo práctico.
const GRUPO_CHIP: Record<GrupoMateria, string> = {
  contencioso: 'bg-violet-100 text-violet-700',
  proteccion: 'bg-rose-100 text-rose-700',
  voluntario: 'bg-teal-100 text-teal-700',
  sin_materia: 'bg-amber-100 text-amber-700',
  generico: 'bg-slate-100 text-slate-500',
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
  // Señales de curaduría (de la vista). Opcionales por compatibilidad con el fallback
  // de tabla directa, que no las trae (quedan undefined → no se muestran chips).
  tiene_orden_busqueda?: boolean | null
  tiene_no_adherencia?: boolean | null
  tiene_citacion_audiencia?: boolean | null
  ultimo_movimiento: string | null
  fecha_ultimo_movimiento: string | null
  adulto_nombre: string | null
  adulto_telefono: string | null
  // Notas de la causa. El bot escribe acá la marca [NO EN PORTAL] cuando la causa ya no
  // aparece en "Mis Causas" del portal (típicamente porque a Paula le relevaron la
  // curaduría). Se usa para marcarla "fuera de mi lista" y NO generar alarmas sobre ella.
  notas?: string | null
  // Marca calculada EN EL CLIENTE (no viene de la vista): el seguimiento del NNA está
  // vencido (>180 días sin "Entrevista al NNA", o nunca se registró una). Se completa en
  // loadCausas cruzando las causas con las gestiones. undefined hasta ese cruce.
  seguimiento_vencido?: boolean
}

// ¿La causa ya NO está en la lista del portal del curador? El bot marca [NO EN PORTAL] en
// `notas` cuando el portal confirmó que la causa no aparece en "Mis Causas" (normalmente
// porque le relevaron la curaduría a Paula). Estas causas siguen visibles (por si fue un
// error), pero NO deben generar alarmas (seguimiento vencido, urgencias): ya no son su
// responsabilidad. Comparación tolerante a mayúsculas/espacios.
function fueraDeMiLista(c: CausaResumen): boolean {
  return (c.notas ?? '').toUpperCase().includes('[NO EN PORTAL]')
}

// ¿La causa tiene SENTENCIA DE RECHAZO? En ese caso la protección se rechazó: la causa
// se destaca y sale de seguimiento/urgencias (ya no hay medida que monitorear). Se detecta
// de forma tolerante en el estado/síntesis/último movimiento (el portal usa textos como
// "sentencia de rechazo", "rechaza la solicitud", "se rechaza"). Se evita el falso positivo
// de "rechaza el incidente/recurso" exigiendo que hable de rechazo de la causa/solicitud/
// protección/demanda, o el patrón claro "sentencia ... rechaz".
function tieneSentenciaRechazo(c: CausaResumen): boolean {
  const texto = `${c.estado ?? ''} ${c.sintesis ?? ''} ${c.ultimo_movimiento ?? ''}`.toLowerCase()
  if (!texto.includes('rechaz')) return false
  if (/sentencia[^.]*rechaz/.test(texto)) return true
  return /rechaz\w*\s+(la\s+)?(solicitud|demanda|medida|protecci|causa|denuncia|requerimiento)/.test(texto)
}

// ¿La causa debe salir del monitoreo activo (no generar alarmas)? Sea porque le relevaron
// la curaduría (fuera de la lista del portal) o porque hay sentencia de rechazo.
function fueraDeMonitoreo(c: CausaResumen): boolean {
  return fueraDeMiLista(c) || tieneSentenciaRechazo(c)
}

// Chips de señales de curaduría que se muestran en cada tarjeta de causa.
// Cada uno resume una alerta de cumplimiento en un badge compacto y legible.
function chipsSenales(c: CausaResumen): { texto: string; clase: string }[] {
  const chips: { texto: string; clase: string }[] = []
  // Si la causa salió del monitoreo (relevaron curaduría o sentencia de rechazo), mostramos
  // SOLO ese chip: las demás señales (seguimiento, alertas) ya no aplican.
  if (tieneSentenciaRechazo(c)) {
    return [{ texto: 'Sentencia de rechazo', clase: 'bg-slate-800 text-white' }]
  }
  if (fueraDeMiLista(c)) {
    return [{ texto: 'Ya no en mi lista PJUD', clase: 'bg-slate-200 text-slate-600' }]
  }
  // Seguimiento del NNA vencido (>180d sin "Entrevista al NNA" o nunca). Va primero porque
  // es el recordatorio central de la curaduría: ver al NNA. Se calcula en el cliente.
  if (c.seguimiento_vencido) chips.push({ texto: 'Seguimiento NNA vencido', clase: 'bg-rose-100 text-rose-700' })
  if (c.tiene_orden_busqueda) chips.push({ texto: 'Orden de búsqueda', clase: 'bg-red-100 text-red-700' })
  if (c.tiene_no_adherencia) chips.push({ texto: 'No adherencia', clase: 'bg-amber-100 text-amber-700' })
  if (c.tiene_citacion_audiencia) chips.push({ texto: 'Citación audiencia', clase: 'bg-amber-100 text-amber-700' })
  // Estancamiento: sin movimiento hace más de 6 meses (criterio de Paula).
  // Solo si NO es nivel 6: en nivel 6 el motivo de urgencia ya dice "Sin movimiento hace N días
  // (estancada)", así que el chip sería redundante. En otros niveles (ej. una crítica por orden
  // de búsqueda que además está estancada) el chip sí aporta.
  if (c.dias_sin_actividad != null && c.dias_sin_actividad > 180 && c.nivel_urgencia !== 6) {
    chips.push({ texto: `Sin movimiento ${Math.round(c.dias_sin_actividad / 30)} meses`, clase: 'bg-orange-100 text-orange-700' })
  }
  return chips
}

// Semáforo basado en nivel_urgencia multi-criterio
function getSemaforo(nivel: number | null): { color: string; bg: string; texto: string; dotColor: string } {
  // Paleta unificada: Atención usa AMBER en TODO el dashboard (KPI, leyenda, header y aquí).
  // Antes esta función usaba yellow-* y el resto amber-* → inconsistencia visual. Ya alineado.
  if (nivel === null || nivel >= 10)
    return { color: 'text-green-600', bg: 'bg-green-50 border-green-200', texto: 'Estable', dotColor: 'bg-green-500' }
  if (nivel <= 2)
    return { color: 'text-red-600', bg: 'bg-red-50 border-red-200', texto: 'Crítica', dotColor: 'bg-red-500' }
  if (nivel <= 4)
    return { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', texto: 'Atención', dotColor: 'bg-amber-400' }
  if (nivel <= 6)
    return { color: 'text-orange-500', bg: 'bg-orange-50 border-orange-200', texto: 'Revisar', dotColor: 'bg-orange-400' }
  return { color: 'text-green-600', bg: 'bg-green-50 border-green-200', texto: 'Estable', dotColor: 'bg-green-500' }
}

// Motivo legible de la urgencia, alineado con el semáforo de la vista
// (schema-semaforo-proteccion.sql). Prioriza la señal más fuerte de la causa.
// Devuelve un ÍCONO SVG (formal) + el texto; el color lo pone la tarjeta según el nivel.
function getUrgenciaMotivo(causa: CausaResumen): MotivoUrgencia | null {
  const nivel = causa.nivel_urgencia
  if (!nivel || nivel >= 10) return null
  const d = causa.dias_para_audiencia
  // Solo consideramos "audiencia inminente" la que el CASE realmente usa para el nivel:
  // ≤2d en nivel 1, ≤7d en nivel 3. Así el mensaje coincide con la señal que disparó el nivel.
  const audienciaInminente = (limite: number): MotivoUrgencia | null =>
    causa.proxima_audiencia != null && d != null && d <= limite
      ? { Icono: IconCalendar, texto: `Audiencia en ${Math.max(0, Math.round(d))} días` }
      : null
  if (nivel === 1) {
    // El CASE llega a nivel 1 por audiencia ≤2d O por traslado curador ≤30d. Priorizamos la
    // audiencia inminente (más urgente en el tiempo); si no hay, es el traslado reciente.
    const aud = audienciaInminente(2)
    if (aud) return aud
    if (causa.tiene_traslado_curador) return { Icono: IconShield, texto: 'Traslado al curador (≤30 días)' }
    return { Icono: IconAlert, texto: 'Acción inmediata' }
  }
  if (nivel === 2) return { Icono: IconAlert, texto: `Medida cautelar vence en ${causa.dias_medida_vence} días` }
  if (nivel === 3) {
    // Nivel 3 = audiencia futura ≤7d O movimiento nuevo ≤7d. Solo mostramos la audiencia
    // si de verdad es ≤7d (si no, el nivel lo disparó el movimiento nuevo).
    const aud = audienciaInminente(7)
    if (aud) return aud
    const mov = causa.ultimo_movimiento ? `: ${causa.ultimo_movimiento}` : ''
    return { Icono: IconClock, texto: `Movimiento nuevo (últimos 7 días)${mov}` }
  }
  if (nivel === 4) return { Icono: IconShield, texto: 'Traslado al curador (revisar)' }
  if (nivel === 6) return { Icono: IconPause, texto: `Sin movimiento hace ${Math.round(causa.dias_sin_actividad || 0)} días (estancada)` }
  return null
}

function formatFecha(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Sin fecha'
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Etiqueta temporal de una audiencia según cuántos días faltan. Compartida por el
// calendario y la tarjeta de causa (antes estaba duplicada en ambos).
function etiquetaAudiencia(dias: number | null): string {
  if (dias == null) return ''
  if (dias <= 0) return 'Hoy'
  if (dias <= 1) return 'Mañana'
  return `En ${Math.round(dias)} días`
}

function formatFechaCorta(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
}

// Texto relativo tipo "hace 2 min" para el indicador de última actualización.
function haceCuanto(desde: Date | null, ahora: number): string {
  if (!desde) return ''
  const segs = Math.max(0, Math.round((ahora - desde.getTime()) / 1000))
  if (segs < 10) return 'recién'
  if (segs < 60) return `hace ${segs} s`
  const mins = Math.round(segs / 60)
  if (mins < 60) return `hace ${mins} min`
  const horas = Math.round(mins / 60)
  return `hace ${horas} h`
}

export default function Dashboard() {
  const [causas, setCausas] = useState<CausaResumen[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [filtroUrgencia, setFiltroUrgencia] = useState<FiltroUrgencia>('todas')
  // Estado del Asesor IA: la causa cuyo análisis se abrió + carga/resultado/error.
  // null = modal cerrado.
  const [asesorIA, setAsesorIA] = useState<{
    rit: string
    cargando: boolean
    resultado: { resumen: string; proximoPaso: string; riesgo: string } | null
    error: string | null
  } | null>(null)

  // Pide el análisis estratégico a /api/analisis/[id] y lo muestra en el modal.
  async function abrirAsesorIA(causaId: string, rit: string) {
    setAsesorIA({ rit, cargando: true, resultado: null, error: null })
    try {
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      const res = await fetch(`/api/analisis/${causaId}${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setAsesorIA({ rit, cargando: false, resultado: null, error: json?.error || `Error ${res.status}` })
        return
      }
      setAsesorIA({ rit, cargando: false, resultado: json, error: null })
    } catch (e: any) {
      setAsesorIA({ rit, cargando: false, resultado: null, error: e?.message || 'No se pudo conectar con el Asesor IA.' })
    }
  }

  // Cerrar el Asesor IA con la tecla Escape (accesibilidad).
  useEffect(() => {
    if (!asesorIA) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsesorIA(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [asesorIA])
  const [totalCausas, setTotalCausas] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // true si se cayó al fallback de tabla directa (sin la vista): en ese modo NO tenemos
  // fecha_ultimo_movimiento/ultima_audiencia, así que la barra de progreso no aplica.
  const [modoFallback, setModoFallback] = useState(false)
  // Marca de tiempo de la última carga exitosa (para el indicador "actualizado hace X").
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null)
  // Evita recargas encimadas (auto-refresco + clic manual + volver a la pestaña a la vez).
  const cargandoRef = useRef(false)
  // Espejo de ultimaActualizacion para leerlo dentro de listeners sin stale closure.
  const ultimaActualizacionRef = useRef<Date | null>(null)
  // "Reloj" que refresca solo el TEXTO "hace X min" (no recarga datos). Tick cada 30s.
  const [ahora, setAhora] = useState<number>(() => Date.now())

  // Cada cuánto se refresca solo el dashboard (ms). 5 minutos.
  const AUTO_REFRESH_MS = 5 * 60 * 1000

  useEffect(() => {
    loadCausas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresco periódico: el panel se recarga solo sin que el usuario apriete nada.
  // - Solo cuando la pestaña está VISIBLE (no gasta recursos en segundo plano).
  // - Al volver a la pestaña, refresca SOLO si ya pasó el intervalo (no en cada foco breve).
  useEffect(() => {
    let intervalo: ReturnType<typeof setInterval> | null = null

    const arrancar = () => {
      if (intervalo) return
      intervalo = setInterval(() => {
        // El guard cargandoRef dentro de loadCausas evita encimar recargas.
        if (!document.hidden) loadCausas()
      }, AUTO_REFRESH_MS)
    }
    const parar = () => {
      if (intervalo) { clearInterval(intervalo); intervalo = null }
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        parar()
      } else {
        // Al volver a la pestaña: refrescar solo si pasó el intervalo desde la última carga
        // (evita una consulta completa por cada cambio de foco de pocos segundos).
        const ult = ultimaActualizacionRef.current
        if (!ult || Date.now() - ult.getTime() >= AUTO_REFRESH_MS) loadCausas()
        arrancar()
      }
    }

    if (!document.hidden) arrancar()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      parar()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick del "hace X min": solo actualiza el texto, no recarga datos.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30 * 1000)
    return () => clearInterval(t)
  }, [])

  // Trae TODAS las filas de una tabla/vista paginando de a 1000 (límite por request de
  // Supabase/PostgREST). Antes se usaba .limit(500), que ocultaba causas: si había 633,
  // el panel solo veía 500 y NO evaluaba alertas de las otras 133 (riesgo real: perder
  // una audiencia urgente). Ahora traemos el 100%.
  //
  // ordenIdParaPaginar: agrega un desempate ÚNICO por id para que OFFSET/LIMIT sea estable
  // cuando hay >1000 filas (evita duplicar/saltar filas del borde entre páginas). SOLO se
  // debe usar sobre tablas físicas (id indexado, barato). NUNCA sobre v_causas_ranking:
  // esa vista tiene ~20 subqueries correlacionados por fila; un ORDER BY id externo obliga
  // a Postgres a materializar las 647 filas ANTES del LIMIT, lo que supera el
  // statement_timeout del rol anon (~8s) y lanza el error 57014 → el panel caía al fallback
  // (todo "Estable", sin barra de progreso). La vista ya trae su propio ORDER BY con
  // desempate final por c.id (orden total único), así que paginar sobre ella es estable
  // sin necesidad de un ORDER BY id externo.
  async function fetchAll(tabla: string, columnas: string, ordenar?: string, ordenIdParaPaginar = false) {
    const PAGE = 1000
    let desde = 0
    let todo: any[] = []
    for (;;) {
      let q = supabase.from(tabla).select(columnas)
      if (ordenar) q = q.order(ordenar, { ascending: false })
      if (ordenIdParaPaginar) q = q.order('id', { ascending: true })
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
    // Guard: evitar recargas encimadas (auto-refresco + clic manual + volver a la pestaña).
    if (cargandoRef.current) return
    cargandoRef.current = true
    // Si ya hay causas en pantalla, es una recarga manual: no borramos la vista con el
    // skeleton, solo mostramos el spinner en el botón. La primera carga sí usa skeleton.
    if (causas.length > 0) setRefreshing(true)
    else setLoading(true)
    setError(null)
    setModoFallback(false)

    // try/finally: pase lo que pase (incluido un rechazo de red no controlado por fetchAll),
    // SIEMPRE liberamos el guard y los flags de carga. Sin esto, un fetch rechazado dejaría
    // cargandoRef en true para siempre y el dashboard no volvería a recargar nunca.
    try {
    // Intentar con la vista (tiene el semáforo). Traemos TODAS las causas (paginado).
    // Ahora v_causas_ranking lee de una MATERIALIZED VIEW (mv_causas_ranking), así que ya
    // NO hay riesgo de timeout: el .order('id') externo es barato sobre la tabla materializada.
    // Lo pedimos para tener orden total estable en la paginación si algún día hay >1000 causas.
    let { data, error: err } = await fetchAll('v_causas_ranking', '*', undefined, true)

    // Si la consulta directa (rol anon) falla —típicamente por statement_timeout (57014)
    // sobre la vista pesada—, NO caemos de inmediato al fallback "todo Estable". Primero
    // intentamos el endpoint server-side /api/ranking, que corre con service_role (sin ese
    // timeout) y devuelve el MISMO semáforo real. Así el panel muestra datos correctos aunque
    // la vista sea lenta para el navegador anónimo.
    if (err) {
      console.warn(
        'Vista v_causas_ranking (anon) falló, probando /api/ranking (service_role):',
        JSON.stringify({ message: err.message, code: (err as any).code, details: (err as any).details, hint: (err as any).hint }),
      )
      try {
        // El endpoint exige token (sirve PII de menores). Se manda el token público.
        const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
        const qs = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/ranking${qs}`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          if (Array.isArray(json?.causas)) {
            data = json.causas
            err = null // recuperado con el semáforo real: NO es modo fallback
          } else {
            console.warn('/api/ranking respondió 200 pero sin arreglo causas:', json)
          }
        } else {
          console.warn('/api/ranking respondió con error:', res.status)
        }
      } catch (e) {
        console.warn('/api/ranking no disponible:', e)
      }
    }

    // Si NI la vista (anon) NI el endpoint server-side funcionaron, recién ahí usamos la
    // tabla directa (sin semáforo pero funciona: al menos muestra las causas).
    if (err) {
      setModoFallback(true)
      // Sobre la tabla física sí pedimos desempate por id: es barato (id indexado) y protege
      // la paginación si algún día hay >1000 causas.
      const { data: directData, error: directErr } = await fetchAll(
        'causas',
        'id, rit, caratulado, tipo, estado, programa_vigente, sintesis, notas, updated_at',
        'updated_at',
        true,
      )
      
      if (directErr) {
        setError(directErr.message)
        return // el finally libera guard + loading + refreshing
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
      // Cruce con GESTIONES para marcar el "seguimiento del NNA vencido" por causa.
      // La vista no trae gestiones, así que las pedimos en bloque (paginado) y calculamos
      // el estado en el cliente. Es una consulta liviana (tabla chica: bitácora de Paula).
      // Si falla, no rompemos el panel: simplemente no se marca ninguna (chip/KPI en 0).
      try {
        const { data: gest } = await fetchAll('gestiones', 'causa_id, tipo, fecha')
        // agruparGestionesPorCausa([]) devuelve un Map vacío, así que una causa sin
        // gestiones cae en `[]` → estadoSeguimientoNna lo marca vencido (nunca se
        // entrevistó al NNA). No hace falta un caso especial para "sin gestiones".
        const porCausa = agruparGestionesPorCausa((gest as any[]) || [])
        data = data.map((c: any) => ({
          ...c,
          seguimiento_vencido: estadoSeguimientoNna(porCausa.get(c.id) || []).vencido,
        }))
      } catch (e) {
        console.warn('No se pudieron cargar las gestiones para el seguimiento del NNA:', e)
      }
      setCausas(data)
      setTotalCausas(data.length)
      const ahoraFecha = new Date()
      setUltimaActualizacion(ahoraFecha) // registrar hora de la carga exitosa
      ultimaActualizacionRef.current = ahoraFecha
    }
    } catch (e) {
      // Rechazo inesperado (red caída, etc.). No dejamos el panel roto en silencio:
      // si aún no hay datos en pantalla, mostramos error; si ya había, se mantienen.
      console.warn('loadCausas: error inesperado:', e)
      if (causas.length === 0) setError('No se pudo cargar. Reintentá en un momento.')
    } finally {
      setLoading(false)
      setRefreshing(false)
      cargandoRef.current = false // SIEMPRE liberar el guard
    }
  }

  // Filtro por TEXTO (buscador). Base para los contadores KPI.
  const causasPorTexto = causas.filter(c => {
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

  // FUERA DE MONITOREO: causas donde relevaron la curaduría ([NO EN PORTAL]) o con
  // sentencia de rechazo. Se destacan aparte y NO generan alarmas (no cuentan en urgencias
  // ni en seguimiento vencido). Se separan ANTES de agrupar por urgencia.
  const fueraMonitoreo = causasPorTexto.filter(fueraDeMonitoreo)
  // Causas activas = las que Paula sí tiene que monitorear (base de urgencias/seguimiento).
  const causasActivas = causasPorTexto.filter(c => !fueraDeMonitoreo(c))

  // Agrupar por nivel de urgencia (solo causas ACTIVAS). Sobre el filtro de texto, así los
  // KPI no cambian cuando el usuario aplica el filtro rápido por urgencia.
  const criticas = causasActivas.filter(c => (c.nivel_urgencia || 10) <= 2)
  const atencion = causasActivas.filter(c => (c.nivel_urgencia || 10) > 2 && (c.nivel_urgencia || 10) <= 4)
  const revisar = causasActivas.filter(c => (c.nivel_urgencia || 10) > 4 && (c.nivel_urgencia || 10) <= 6)
  const estables = causasActivas.filter(c => (c.nivel_urgencia || 10) > 6)
  // Traslados al curador: lo más difícil/prioritario para Paula. Tienen su propia tarjeta.
  // Es un corte transversal (una causa con traslado puede ser crítica o de atención).
  const traslados = causasActivas.filter(c => c.tiene_traslado_curador)
  // Seguimiento del NNA vencido: corte transversal (como Traslados) — una causa acá puede
  // ser de cualquier nivel de urgencia. Es el recordatorio de "ver al NNA" cada 180 días.
  const seguimientoVencido = causasActivas.filter(c => c.seguimiento_vencido)

  // Próximas audiencias: causas ACTIVAS con audiencia futura, ordenadas por fecha (la más
  // próxima primero). Base del calendario de audiencias. Se calcula sobre el filtro de texto.
  const proximasAudiencias = causasActivas
    .filter(c => c.proxima_audiencia != null)
    .sort((a, b) => new Date(a.proxima_audiencia!).getTime() - new Date(b.proxima_audiencia!).getTime())

  // Filtro rápido por urgencia (clic en tarjeta KPI). No afecta los contadores de arriba.
  const causasFiltradas =
    filtroUrgencia === 'traslados' ? traslados :
    filtroUrgencia === 'seguimiento' ? seguimientoVencido :
    filtroUrgencia === 'criticas' ? criticas :
    filtroUrgencia === 'atencion' ? atencion :
    filtroUrgencia === 'revisar' ? revisar :
    filtroUrgencia === 'estables' ? estables :
    filtroUrgencia === 'fuera' ? fueraMonitoreo :
    causasPorTexto

  // Resumen ejecutivo: la frase que Paula lee primero.
  const pendientesHoy = criticas.length + atencion.length
  const saludo = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Buenos días'
    if (h < 20) return 'Buenas tardes'
    return 'Buenas noches'
  })()

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando causas">
        {/* Skeleton del header */}
        <div className="space-y-2">
          <div className="h-7 w-56 rounded-lg bg-slate-200 animate-pulse" />
          <div className="h-4 w-80 rounded bg-slate-100 animate-pulse" />
        </div>
        {/* Skeleton de los KPI (7, mismo grid que el real → no salta al cargar) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[76px] rounded-xl bg-slate-100 border border-slate-200 animate-pulse" />
          ))}
        </div>
        {/* Skeleton de la barra + tarjetas */}
        <div className="h-16 rounded-xl bg-slate-100 border border-slate-200 animate-pulse" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[86px] rounded-xl bg-slate-100 border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 mb-3">
          <IconAlert className="w-5 h-5" />
        </div>
        <p className="text-red-700 font-medium">No se pudieron cargar las causas</p>
        <p className="text-slate-500 text-sm mt-1">Puede ser un problema temporal de conexión. Reintentá en un momento.</p>
        <button
          onClick={loadCausas}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          <IconRefresh className="w-4 h-4" /> Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header ejecutivo: saludo + resumen inteligente + actualizar */}
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Panel de Control</h1>
          <p className="mt-1 text-sm text-slate-500">
            {saludo}, Paula.{' '}
            {pendientesHoy > 0 ? (
              <span className="text-slate-700">
                Hoy tienes{' '}
                {criticas.length > 0 && (
                  <span className="font-semibold text-red-600">{criticas.length} {criticas.length === 1 ? 'causa crítica' : 'causas críticas'}</span>
                )}
                {criticas.length > 0 && atencion.length > 0 && ' y '}
                {atencion.length > 0 && (
                  <span className="font-semibold text-amber-600">{atencion.length} {atencion.length === 1 ? 'en atención' : 'en atención'}</span>
                )}
                {'.'}
              </span>
            ) : (
              <span className="text-slate-700">Sin causas urgentes por ahora. Todo bajo control.</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={loadCausas}
            disabled={refreshing}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-60 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <IconRefresh className={`w-4 h-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
          {ultimaActualizacion && (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              Actualizado {haceCuanto(ultimaActualizacion, ahora)}
            </span>
          )}
        </div>
      </div>

      {/* Buscador: JUSTO debajo del título (lo primero después del encabezado), para poder
          buscar de inmediato sin scrollear. Sticky para que quede visible al recorrer causas. */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-slate-50/80 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60">
        <div className="relative">
          <IconSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por RIT, caratulado, NNA, programa…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 bg-white shadow-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-300 focus:border-slate-400 outline-none"
          />
          {filtro && (
            <button
              onClick={() => setFiltro('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 rounded p-0.5 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <IconX className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* KPIs clickeables (actúan como filtro rápido por urgencia). Íconos formales
          ligados al color del semáforo. "Traslados al curador" y "Seguimiento vencido"
          son cortes transversales (una causa puede caer en ellos con cualquier nivel). */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          label="Total causas" value={totalCausas}
          active={filtroUrgencia === 'todas'}
          onClick={() => setFiltroUrgencia('todas')}
          tone="neutral"
        />
        <KpiCard
          label="Traslados curador" value={traslados.length}
          active={filtroUrgencia === 'traslados'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'traslados' ? 'todas' : 'traslados')}
          tone="purple" Icono={IconShield}
        />
        <KpiCard
          label="Seguimiento vencido" value={seguimientoVencido.length}
          active={filtroUrgencia === 'seguimiento'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'seguimiento' ? 'todas' : 'seguimiento')}
          tone="rose" Icono={IconUsers}
        />
        <KpiCard
          label="Críticas" value={criticas.length}
          active={filtroUrgencia === 'criticas'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'criticas' ? 'todas' : 'criticas')}
          tone="red" Icono={IconAlert}
        />
        <KpiCard
          label="Atención" value={atencion.length}
          active={filtroUrgencia === 'atencion'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'atencion' ? 'todas' : 'atencion')}
          tone="amber" Icono={IconClock}
        />
        <KpiCard
          label="Revisar" value={revisar.length}
          active={filtroUrgencia === 'revisar'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'revisar' ? 'todas' : 'revisar')}
          tone="orange" Icono={IconPause}
        />
        <KpiCard
          label="Estables" value={estables.length}
          active={filtroUrgencia === 'estables'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'estables' ? 'todas' : 'estables')}
          tone="green" Icono={IconCheck}
        />
        {/* Solo aparece si hay causas fuera de monitoreo (relevadas o con sentencia de
            rechazo). No suma a las urgencias; es un corte aparte para revisar. */}
        {fueraMonitoreo.length > 0 && (
          <KpiCard
            label="Fuera de monitoreo" value={fueraMonitoreo.length}
            active={filtroUrgencia === 'fuera'}
            onClick={() => setFiltroUrgencia(filtroUrgencia === 'fuera' ? 'todas' : 'fuera')}
            tone="neutral" Icono={IconInbox}
          />
        )}
      </div>

      {/* RESULTADO DEL FILTRO: aparece JUSTO debajo de los KPI cuando Paula aprieta uno.
          Antes el resultado se renderizaba al fondo y "no pasaba nada" visible: había que
          scrollear mucho. Ahora aparece acá arriba, con un encabezado que confirma qué se
          está mostrando y un botón para quitar el filtro. */}
      {filtroUrgencia !== 'todas' && (
        <div className="space-y-3">
          {/* Botón para salir del filtro (el título/color va dentro del bloque unificado). */}
          <div className="flex justify-end">
            <button
              onClick={() => setFiltroUrgencia('todas')}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <IconX className="w-3.5 h-3.5" /> Quitar filtro
            </button>
          </div>
          {causasFiltradas.length > 0 ? (
            // Diseño LIMPIO y COHERENTE: todo el resultado pintado con el color del KPI
            // filtrado (mismo componente que los bloques destacados), en vez del CausaCard
            // multicolor que mezclaba los colores del semáforo y confundía.
            <BloqueCausasColapsable
              titulo={FILTRO_SECCION[filtroUrgencia].title}
              causas={causasFiltradas}
              tono={FILTRO_SECCION[filtroUrgencia].tono}
              Icono={FILTRO_SECCION[filtroUrgencia].Icono}
              defaultOpen={true}
              onAsesorIA={filtroUrgencia === 'traslados' ? abrirAsesorIA : undefined}
            />
          ) : (
            <div className="text-center py-10 px-4 bg-white border border-slate-200 rounded-xl">
              <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-2">
                <IconInbox className="w-5 h-5" />
              </div>
              <p className="text-slate-600 font-medium">No hay causas en este grupo{filtro ? ' con ese texto' : ''}.</p>
            </div>
          )}
        </div>
      )}

      {/* Progreso de llenado de datos por el bot (solo con la vista; el fallback de
          tabla directa no trae fecha_ultimo_movimiento/ultima_audiencia). */}
      {!modoFallback && (
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <IconDownload className="w-4 h-4 text-slate-400" />
            Datos cargados desde el portal
          </span>
          <span className="text-sm font-semibold text-slate-700 tabular-nums">
            {conDatos} de {totalCausas} <span className="text-slate-400">({pctDatos}%)</span>
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className="bg-slate-800 h-2 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pctDatos}%` }}
          />
        </div>
        {conDatos < totalCausas && (
          <p className="text-xs text-slate-400 mt-1.5">
            Faltan {totalCausas - conDatos} causas por revisar con el bot (movimientos/audiencias).
          </p>
        )}
      </div>
      )}

      {/* Leyenda del semáforo (íconos formales ligados al color). Solo en la vista general:
          cuando Paula filtra por un KPI, el encabezado del resultado ya dice qué está viendo,
          así que la leyenda sería ruido. */}
      {filtroUrgencia === 'todas' && (
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><IconShield className="w-3.5 h-3.5 text-violet-600" /> Traslado al curador (prioritario)</span>
        <span className="flex items-center gap-1.5"><IconUsers className="w-3.5 h-3.5 text-rose-600" /> Seguimiento del NNA vencido (&gt;180d)</span>
        <span className="flex items-center gap-1.5"><IconAlert className="w-3.5 h-3.5 text-red-500" /> Crítica: audiencia ≤2d / medida por vencer</span>
        <span className="flex items-center gap-1.5"><IconClock className="w-3.5 h-3.5 text-amber-500" /> Atención: movimiento o audiencia ≤7d</span>
        <span className="flex items-center gap-1.5"><IconPause className="w-3.5 h-3.5 text-orange-500" /> Revisar: estancada &gt;90d</span>
        <span className="flex items-center gap-1.5"><IconCheck className="w-3.5 h-3.5 text-green-500" /> Estable: actividad reciente</span>
      </div>
      )}

      {/* Bloques destacados transversales (Traslados / Seguimiento vencido). Ahora son
          COLAPSABLES (patrón del calendario) y solo se muestran en la vista general: al
          filtrar por un KPI, el detalle aparece arriba en la sección de resultado. */}
      {traslados.length > 0 && filtroUrgencia === 'todas' && (
        <BloqueCausasColapsable
          titulo="Traslados al curador"
          subtitulo="lo más prioritario"
          causas={traslados}
          tono="violet"
          Icono={IconShield}
          onAsesorIA={abrirAsesorIA}
        />
      )}

      {seguimientoVencido.length > 0 && filtroUrgencia === 'todas' && (
        <BloqueCausasColapsable
          titulo="Seguimiento del NNA vencido"
          subtitulo="más de 180 días sin ver al NNA"
          causas={seguimientoVencido}
          tono="rose"
          Icono={IconUsers}
        />
      )}

      {/* CALENDARIO DE AUDIENCIAS: próximas audiencias ordenadas por fecha. */}
      {proximasAudiencias.length > 0 && filtroUrgencia === 'todas' && (
        <CalendarioAudiencias causas={proximasAudiencias} />
      )}

      {/* Modal del Asesor Estratégico IA: resumen + próximo paso + riesgo por causa. */}
      {asesorIA && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAsesorIA(null)}
          role="dialog" aria-modal="true" aria-label={`Asesor IA ${asesorIA.rit}`}
        >
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-100 text-violet-700 shrink-0">
                <IconSparkles className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 leading-tight">Asesor de Curaduría IA</h3>
                <span className="font-mono text-xs text-slate-500">{asesorIA.rit}</span>
              </div>
              <button
                onClick={() => setAsesorIA(null)}
                aria-label="Cerrar"
                className="ml-auto shrink-0 text-slate-400 hover:text-slate-700 rounded-lg p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            {/* Cargando */}
            {asesorIA.cargando && (
              <div className="flex items-center gap-3 py-8 justify-center text-slate-500">
                <IconRefresh className="w-5 h-5 animate-spin motion-reduce:animate-none" />
                <span className="text-sm">Analizando la protección del NNA…</span>
              </div>
            )}

            {/* Error */}
            {!asesorIA.cargando && asesorIA.error && (
              <div className="py-4">
                <div className="flex items-start gap-2 text-red-600 text-sm">
                  <IconAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{asesorIA.error}</span>
                </div>
              </div>
            )}

            {/* Resultado */}
            {!asesorIA.cargando && asesorIA.resultado && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Estado de la protección</div>
                  <p className="text-sm text-slate-700">{asesorIA.resultado.resumen}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-violet-500 uppercase tracking-wide mb-1">Próxima gestión de curaduría</div>
                  <p className="text-sm text-slate-700">{asesorIA.resultado.proximoPaso}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Alerta de cumplimiento / riesgo del NNA</div>
                  <p className="text-sm text-slate-700">{asesorIA.resultado.riesgo}</p>
                </div>
                <div className="flex items-start gap-1.5 text-xs text-slate-400 border-t border-slate-100 pt-3">
                  <IconAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Sugerencia generada por IA con enfoque de curaduría, a partir de datos procesales
                  (sin nombres ni RUT). Es una lectura preliminar — la decisión profesional es de la curadora.</span>
                </div>
              </div>
            )}

            <button
              onClick={() => setAsesorIA(null)}
              className="mt-5 w-full py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Listado de causas.
          - SIN filtro ('todas'): se muestran agrupadas por nivel de urgencia (vista clásica).
          - CON un filtro activo (clic en un KPI): se muestra UNA sola sección con las causas
            de ese grupo (filtro rápido real). Así el clic en el KPI sí "despliega" solo esas. */}
      {/* Vista general (sin filtro): causas agrupadas por nivel de urgencia. El resultado
          de un filtro por KPI ya se muestra arriba, justo debajo de los KPI. */}
      {filtroUrgencia === 'todas' && (
        <>
          {criticas.length > 0 && (
            <Section title="CRÍTICAS - Acción inmediata" causas={criticas} defaultOpen={false} dotColor="bg-red-500" />
          )}
          {atencion.length > 0 && (
            <Section title="ATENCIÓN - Revisar esta semana" causas={atencion} defaultOpen={false} dotColor="bg-amber-400" />
          )}
          {revisar.length > 0 && (
            <Section title="REVISAR - Seguimiento pendiente" causas={revisar} defaultOpen={false} dotColor="bg-orange-400" />
          )}
          {estables.length > 0 && (
            <Section title="ESTABLES - Sin urgencia inmediata" causas={estables} defaultOpen={false} dotColor="bg-green-500" />
          )}
        </>
      )}

      {/* Vacío total (sin causas cargadas o el texto del buscador no encontró nada en la
          vista general). El caso "filtro por KPI sin resultados" ya se maneja arriba. */}
      {filtroUrgencia === 'todas' && causasPorTexto.length === 0 && (
        <div className="text-center py-14 px-4">
          <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-slate-100 text-slate-400 mb-3">
            <IconInbox className="w-6 h-6" />
          </div>
          <p className="text-slate-600 font-medium">
            {filtro ? 'No se encontraron causas con ese criterio' : 'Aún no hay causas cargadas'}
          </p>
          {filtro && (
            <button
              onClick={() => setFiltro('')}
              className="mt-3 text-sm text-slate-500 hover:text-slate-800 underline underline-offset-2"
            >
              Quitar búsqueda
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Tarjeta KPI clickeable que actúa como filtro rápido por urgencia.
function KpiCard({
  label, value, active, onClick, tone, Icono,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
  tone: 'neutral' | 'red' | 'amber' | 'orange' | 'green' | 'purple' | 'rose'
  Icono?: IconoTipo
}) {
  const tones: Record<typeof tone, { dot: string; num: string; ring: string; activeBg: string; icon: string }> = {
    neutral: { dot: 'bg-slate-400', num: 'text-slate-900', ring: 'focus-visible:ring-slate-400', activeBg: 'bg-slate-100 border-slate-400', icon: 'text-slate-400' },
    red:     { dot: 'bg-red-500',   num: 'text-red-700',   ring: 'focus-visible:ring-red-400',   activeBg: 'bg-red-50 border-red-400',    icon: 'text-red-500' },
    amber:   { dot: 'bg-amber-400', num: 'text-amber-700', ring: 'focus-visible:ring-amber-400', activeBg: 'bg-amber-50 border-amber-400', icon: 'text-amber-500' },
    orange:  { dot: 'bg-orange-400',num: 'text-orange-600',ring: 'focus-visible:ring-orange-400',activeBg: 'bg-orange-50 border-orange-400',icon: 'text-orange-500' },
    green:   { dot: 'bg-green-500', num: 'text-green-700', ring: 'focus-visible:ring-green-400', activeBg: 'bg-green-50 border-green-400',  icon: 'text-green-500' },
    purple:  { dot: 'bg-violet-500',num: 'text-violet-700',ring: 'focus-visible:ring-violet-400',activeBg: 'bg-violet-50 border-violet-400',icon: 'text-violet-600' },
    rose:    { dot: 'bg-rose-500',  num: 'text-rose-700',  ring: 'focus-visible:ring-rose-400',  activeBg: 'bg-rose-50 border-rose-400',   icon: 'text-rose-600' },
  }
  const t = tones[tone]
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex items-center gap-2 text-left rounded-lg px-2.5 py-2 border shadow-sm transition-colors cursor-pointer outline-none focus-visible:ring-2 ${t.ring} ${
        active ? t.activeBg : 'bg-white border-slate-200 hover:bg-slate-50'
      }`}
    >
      {/* Ícono/punto de color a la izquierda (compacto) */}
      {Icono ? (
        <Icono className={`w-4 h-4 shrink-0 ${t.icon}`} />
      ) : (
        tone !== 'neutral' && <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${t.dot}`} />
      )}
      {/* Número + etiqueta en columna, pero compactos: número mediano, label diminuto */}
      <span className="min-w-0">
        <span className={`block text-lg font-bold leading-none tabular-nums ${t.num}`}>{value}</span>
        <span className="block text-[11px] leading-tight text-slate-500 truncate">{label}</span>
      </span>
    </button>
  )
}

function Section({ title, causas, defaultOpen, dotColor }: { title: string; causas: CausaResumen[]; defaultOpen: boolean; dotColor: string }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  // Colapsa de VERDAD: cerrado oculta toda la lista (como el calendario y los bloques
  // destacados). Antes, "cerrado" igual mostraba 5 causas, así que en secciones con ≤5
  // el botón parecía no hacer nada. Abierto muestra hasta 50 (con aviso si hay más).
  const showing = causas.slice(0, 50)

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 text-sm font-bold text-slate-600 uppercase tracking-wide mb-3 hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
      >
        <IconChevron className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        <span className={`inline-block w-3 h-3 rounded-full ${dotColor}`}></span>
        <span>{title} <span className="text-slate-400 tabular-nums">({causas.length})</span></span>
      </button>
      {expanded && showing.length > 0 && (
        <div className="space-y-2">
          {showing.map((c) => (
            <CausaCard key={c.id} causa={c} />
          ))}
          {causas.length > 50 && (
            <p className="text-sm text-slate-400 text-center">Mostrando 50 de {causas.length}. Afiná con el buscador.</p>
          )}
        </div>
      )}
    </div>
  )
}

// Bloque colapsable de causas destacadas (Traslados al curador / Seguimiento del NNA vencido).
// Mismo patrón visual que el calendario: encabezado con chevron + ícono + título + badge de
// conteo, y el listado se puede plegar/desplegar. Antes estos bloques mostraban TODAS las
// causas de una, sin poder cerrarlos: Paula pedía un botón para agruparlos como el calendario.
// Cada fila enlaza al detalle de la causa; opcionalmente muestra el botón del Asesor IA.
type TonoBloque = 'violet' | 'rose' | 'red' | 'amber' | 'orange' | 'green' | 'slate'

// Paleta por tono: cada grupo/urgencia se pinta con UN solo color en todo el bloque
// (fondo, borde, ícono, título, badge, RIT). Así el resultado de un filtro es coherente
// con el color del KPI que lo abrió, en vez de mezclar los colores del semáforo.
const PALETA_BLOQUE: Record<TonoBloque, {
  bg: string; border: string; chip: string; chipTxt: string; title: string; badge: string; sub: string; rit: string; card: string
}> = {
  violet: { bg: 'bg-violet-50', border: 'border-violet-300', chip: 'bg-violet-100', chipTxt: 'text-violet-700', title: 'text-violet-900', badge: 'bg-violet-600', sub: 'text-violet-700/70', rit: 'text-violet-700', card: 'border-violet-200' },
  rose:   { bg: 'bg-rose-50',   border: 'border-rose-300',   chip: 'bg-rose-100',   chipTxt: 'text-rose-700',   title: 'text-rose-900',   badge: 'bg-rose-600',   sub: 'text-rose-700/70',   rit: 'text-rose-700',   card: 'border-rose-200' },
  red:    { bg: 'bg-red-50',    border: 'border-red-300',    chip: 'bg-red-100',    chipTxt: 'text-red-700',    title: 'text-red-900',    badge: 'bg-red-600',    sub: 'text-red-700/70',    rit: 'text-red-700',    card: 'border-red-200' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-300',  chip: 'bg-amber-100',  chipTxt: 'text-amber-700',  title: 'text-amber-900',  badge: 'bg-amber-600',  sub: 'text-amber-700/70',  rit: 'text-amber-700',  card: 'border-amber-200' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-300', chip: 'bg-orange-100', chipTxt: 'text-orange-700', title: 'text-orange-900', badge: 'bg-orange-600', sub: 'text-orange-700/70', rit: 'text-orange-700', card: 'border-orange-200' },
  green:  { bg: 'bg-green-50',  border: 'border-green-300',  chip: 'bg-green-100',  chipTxt: 'text-green-700',  title: 'text-green-900',  badge: 'bg-green-600',  sub: 'text-green-700/70',  rit: 'text-green-700',  card: 'border-green-200' },
  slate:  { bg: 'bg-slate-50',  border: 'border-slate-300',  chip: 'bg-slate-200', chipTxt: 'text-slate-700',  title: 'text-slate-900',  badge: 'bg-slate-600',  sub: 'text-slate-600/70',  rit: 'text-slate-800',  card: 'border-slate-200' },
}

function BloqueCausasColapsable({
  titulo, subtitulo, causas, tono, Icono, defaultOpen = true, onAsesorIA, maximo = 50,
}: {
  titulo: string
  subtitulo?: string
  causas: CausaResumen[]
  tono: TonoBloque
  Icono: IconoTipo
  defaultOpen?: boolean
  onAsesorIA?: (causaId: string, rit: string) => void
  maximo?: number
}) {
  const [abierto, setAbierto] = useState(defaultOpen)
  const t = PALETA_BLOQUE[tono]
  const mostradas = causas.slice(0, maximo)

  return (
    <div className={`${t.bg} border ${t.border} rounded-xl p-4`}>
      <button
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        className="w-full flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
      >
        <IconChevron className={`w-4 h-4 ${t.chipTxt} transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
        <span className={`flex items-center justify-center w-8 h-8 rounded-full ${t.chip} ${t.chipTxt}`}>
          <Icono className="w-4 h-4" />
        </span>
        <h2 className={`font-bold ${t.title} text-base`}>{titulo}</h2>
        <span className={`${t.badge} text-white text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums`}>{causas.length}</span>
        {subtitulo && <span className={`text-xs ${t.sub} ml-1 hidden sm:inline`}>{subtitulo}</span>}
      </button>
      {abierto && (
        <div className="space-y-2 mt-3">
          {mostradas.map(c => (
            <div key={c.id} className={`bg-white border ${t.card} rounded-lg p-3`}>
              <div className="flex items-center justify-between gap-3">
                <Link href={`/causa/${c.id}`} className="min-w-0 group flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mono font-bold ${t.rit} group-hover:underline`}>{c.rit}</span>
                    {c.caratulado && <span className="text-slate-700 truncate">{c.caratulado}</span>}
                  </div>
                  {c.nombres_nna && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <IconUsers className="w-3.5 h-3.5 text-slate-400" />
                      {c.nombres_nna.substring(0, 60)}
                    </div>
                  )}
                </Link>
                {onAsesorIA && (
                  <button
                    type="button"
                    onClick={() => onAsesorIA(c.id, c.rit)}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-violet-300 bg-white text-violet-700 hover:bg-violet-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    <IconSparkles className="w-3.5 h-3.5" />
                    Estrategias del Asesor IA
                  </button>
                )}
              </div>
            </div>
          ))}
          {causas.length > maximo && (
            <p className={`text-xs ${t.sub} text-center pt-1`}>Mostrando {maximo} de {causas.length}. Usá el filtro para verlas todas.</p>
          )}
        </div>
      )}
    </div>
  )
}

// Calendario de audiencias: lista las próximas audiencias agrupadas por horizonte temporal
// (esta semana / este mes / más adelante). Plegable; arranca abierto porque son citas que
// Paula debe tener presentes. Los datos ya vienen ordenados por fecha desde el padre.
function CalendarioAudiencias({ causas }: { causas: CausaResumen[] }) {
  const [abierto, setAbierto] = useState(true)

  // Agrupar por horizonte: <=7 días, <=30 días, resto. dias_para_audiencia ya viene calculado.
  const dias = (c: CausaResumen) => c.dias_para_audiencia ?? 9999
  const estaSemana = causas.filter(c => dias(c) <= 7)
  const esteMes = causas.filter(c => dias(c) > 7 && dias(c) <= 30)
  const masAdelante = causas.filter(c => dias(c) > 30)

  const grupo = (titulo: string, lista: CausaResumen[], acento: string) => lista.length > 0 && (
    <div className="mb-3 last:mb-0">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{titulo} <span className="tabular-nums">({lista.length})</span></div>
      <div className="space-y-1.5">
        {lista.map(c => (
          <Link key={c.id} href={`/causa/${c.id}`} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2 hover:shadow-sm transition-shadow group">
            <div className="min-w-0 flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-slate-800 group-hover:underline shrink-0">{c.rit}</span>
              {c.caratulado && <span className="text-sm text-slate-600 truncate">{c.caratulado}</span>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-medium text-slate-700">{formatFecha(c.proxima_audiencia)}</div>
              <div className={`text-xs font-bold ${acento}`}>{etiquetaAudiencia(c.dias_para_audiencia)}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
      <button
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        className="w-full flex items-center gap-2 mb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
      >
        <IconChevron className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
        <IconCalendar className="w-4 h-4 text-slate-500" />
        <h2 className="font-bold text-slate-800 text-base">Próximas audiencias</h2>
        <span className="bg-slate-700 text-white text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums">{causas.length}</span>
      </button>
      {abierto && (
        <div className="mt-3">
          {grupo('Esta semana', estaSemana, 'text-red-600')}
          {grupo('Este mes', esteMes, 'text-amber-600')}
          {grupo('Más adelante', masAdelante, 'text-slate-500')}
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
  // Chips de señales de cumplimiento (orden de búsqueda, no adherencia, etc.).
  const senales = chipsSenales(c)
  
  return (
    <Link href={`/causa/${c.id}`} className="block group">
      <div className={`border rounded-xl p-4 transition-shadow duration-200 group-hover:shadow-md motion-reduce:transition-none ${sem.bg}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block w-3 h-3 rounded-full ${sem.dotColor} shadow-sm`}></span>
              <span className="font-mono font-bold text-sm text-slate-800">{c.rit}</span>
              {materia && (
                <span
                  title={materia.descripcion}
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${GRUPO_CHIP[materia.grupo]}`}
                >
                  {materia.materia}
                </span>
              )}
              {c.caratulado && (
                <span className="font-semibold text-slate-700 truncate">{c.caratulado}</span>
              )}
              {c.programa_vigente && (
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">{c.programa_vigente}</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
              <IconUsers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="tabular-nums">{c.total_nna} NNA</span>
              {c.nombres_nna && <span className="text-slate-500 truncate">— {c.nombres_nna.substring(0, 60)}{c.nombres_nna.length > 60 ? '…' : ''}</span>}
            </div>
            {/* Motivo de urgencia (ícono formal + texto, color según nivel) */}
            {motivo && (
              <div className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium ${sem.color}`}>
                <motivo.Icono className="w-3.5 h-3.5 shrink-0" />
                <span>{motivo.texto}</span>
              </div>
            )}
            {/* Chips de señales de cumplimiento de la medida (curaduría) */}
            {senales.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {senales.map((s, i) => (
                  <span key={i} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.clase}`}>
                    {s.texto}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-slate-500 whitespace-nowrap shrink-0">
            {c.proxima_audiencia ? (
              <div>
                <div className="inline-flex items-center gap-1 font-medium text-slate-600">
                  <IconCalendar className="w-3.5 h-3.5 text-slate-400" />
                  {formatFecha(c.proxima_audiencia)}
                </div>
                <div className={`font-bold ${sem.color}`}>
                  {etiquetaAudiencia(c.dias_para_audiencia)}
                </div>
              </div>
            ) : c.ultima_audiencia ? (
              <div>
                <div className="text-slate-400">Última: {formatFechaCorta(c.ultima_audiencia)}</div>
                {c.dias_sin_actividad && c.dias_sin_actividad > 15 && (
                  <div className="inline-flex items-center gap-1 text-orange-500 font-medium">
                    <IconClock className="w-3 h-3" />
                    {Math.round(c.dias_sin_actividad)}d inactiva
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-300">Sin audiencia</span>
            )}
          </div>
        </div>
        {c.estado && (
          <div className="mt-2 text-xs text-slate-400 italic truncate">{c.estado}</div>
        )}
      </div>
    </Link>
  )
}
