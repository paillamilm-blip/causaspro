'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { IconRefresh, IconAlert, IconCheck, IconDownload, IconInbox, IconClock, IconChevron } from './icons'

// ============================================================
// COBERTURA — la métrica única del sistema
// ------------------------------------------------------------
// Responde la pregunta que la curadora NO puede responder hoy: "¿están TODAS mis causas
// cargadas y al día, o me falta algo?". Antes el panel decía "faltan N causas por revisar
// con el bot" contando MOVIMIENTOS, que es otra cosa (una causa puede estar escaneada y sin
// movimientos nuevos) y dejaba la barra clavada sin motivo.
//
// Acá se lee el estado REAL de la cola de escaneo (v_cobertura), que el bot escribe causa
// por causa. Un solo número manda: PENDIENTES DE ESCANEO. Si es 0, está todo al día y no
// hay que correr nada.
//
// OJO: "pendientes = 0" responde "¿está todo al día?", NO "¿están todas tus causas".
// La cola solo conoce las causas ya cargadas; una que el portal te asignó y nunca pegaste
// no aparece. Eso lo responde la conciliación (v_conciliacion) contra el inventario que el
// bot saca del portal con BOT_INVENTARIO=1, y se muestra abajo. Son dos preguntas distintas
// y este panel las separa a propósito.
//
// Honestidad sobre el "en vivo": el bot corre en la compu de la curadora, así que el panel
// NO puede saber qué pasa si el bot está apagado. Mientras corre, el bot publica progreso
// (bot_runs + bot_run_items) y este panel lo consulta cada 5 s; apagado, cada 60 s solo
// para detectar que arrancó.
// ============================================================

interface CoberturaFila {
  total_causas: number
  pendientes: number
  nunca_escaneadas: number
  en_progreso: number
  ok: number
  sin_datos: number
  con_error: number
  descatalogadas: number
  vencidas: number
  escaneo_mas_antiguo: string | null
  rezago_maximo_dias: number | null
  medido_en: string | null
  // Columnas nuevas de v_cobertura. OPCIONALES a propósito: el panel se despliega en Vercel
  // antes de que la curadora pegue el SQL en Supabase, y en esa ventana la vista vieja no las
  // trae. Si faltan, el panel cae al cálculo anterior en vez de mostrar cualquier cosa.
  fuera_de_cola?: number
  por_escanear?: number
}

interface RunFila {
  run_id: string | null
  started_at: string | null
  finished_at: string | null
  total_causas: number | null
  procesadas: number | null
  exitosas: number | null
  fallidas: number | null
  detenido_por: string | null
  items_ok: number | null
  items_sin_mov: number | null
  items_no_encontrada: number | null
  items_error: number | null
  ultimo_item_en: string | null
}

interface ColaItem {
  id: string
  rit: string | null
  caratulado: string | null
  escaneo_estado: string | null
  ultima_escaneada: string | null
  pendientes_desde: string | null
}

// v_conciliacion: qué ve el PORTAL contra qué tenés VOS. Es la única fuente que puede
// responder "¿me falta alguna causa?", porque v_cobertura solo cuenta causas ya cargadas.
interface Conciliacion {
  corrida_en: string | null
  rits_portal: number | null
  coinciden: number | null
  faltan_en_bd: number | null
  letra_distinta: number | null
  en_bd_no_vistas_en_portal: number | null
}

interface FaltaItem {
  rit: string | null
  caratulado: string | null
}

type Modo = 'cargando' | 'listo' | 'sin_migracion' | 'error'

// Por qué se cortó la última corrida (los códigos los escribe el bot en detenido_por).
const MOTIVOS_DETENCION: Record<string, string> = {
  completado: 'terminó bien',
  limite_sesion: 'se agotó la sesión del portal: hay que volver a entrar con ClaveÚnica',
  error_critico: 'se cortó por un error del bot',
  captcha: 'el portal pidió captcha',
  bloqueado: 'el portal bloqueó el acceso',
}

function haceCuantoCorto(desdeIso: string | null, ahora: number): string {
  if (!desdeIso) return ''
  const ms = ahora - new Date(desdeIso).getTime()
  if (isNaN(ms)) return ''
  const segs = Math.max(0, Math.round(ms / 1000))
  if (segs < 10) return 'recién'
  if (segs < 60) return `hace ${segs} s`
  const mins = Math.round(segs / 60)
  if (mins < 60) return `hace ${mins} min`
  const horas = Math.round(mins / 60)
  if (horas < 48) return `hace ${horas} h`
  return `hace ${Math.round(horas / 24)} días`
}

// ¿Es LA corrida que está corriendo ahora mismo? finished_at NULL no alcanza: si mataron el
// bot con CTRL+C la fila queda sin finished_at para siempre y el panel mostraría "en curso"
// eterno. La señal real de vida es que escribió algo hace poco (publica progreso cada 5
// causas y un bot_run_item por causa). 15 minutos de silencio = corrida muerta; la próxima
// corrida las reclama y las devuelve a 'pendiente'.
function corridaViva(r: RunFila, ahora: number): boolean {
  if (r.finished_at) return false
  const ultimaEscritura = r.ultimo_item_en || r.started_at
  if (!ultimaEscritura) return false
  return ahora - new Date(ultimaEscritura).getTime() < 15 * 60 * 1000
}

interface Props {
  // Causas que el bot NO puede cargar (relevadas / archivadas / RIT a revisar). Se muestra
  // como referencia para que la curadora entienda por qué la barra no cuenta todas sus causas.
  fueraDeLaCola: number
  // Se llama cuando una corrida que estaba en curso termina: el Dashboard recarga las causas
  // para que los movimientos recién raspados aparezcan sin esperar el auto-refresco de 5 min.
  onRunTermino?: () => void
}

export default function CoberturaPanel({ fueraDeLaCola, onRunTermino }: Props) {
  const [modo, setModo] = useState<Modo>('cargando')
  const [cob, setCob] = useState<CoberturaFila | null>(null)
  const [runs, setRuns] = useState<RunFila[]>([])
  const [cola, setCola] = useState<ColaItem[]>([])
  const [conc, setConc] = useState<Conciliacion | null>(null)
  const [faltan, setFaltan] = useState<FaltaItem[]>([])
  // La vista de conciliación no existe todavía (falta re-correr la migración): caso distincto
  // de "existe pero nunca se corrió un inventario".
  const [concSinMigrar, setConcSinMigrar] = useState(false)
  const [faltanAbiertas, setFaltanAbiertas] = useState(false)
  const [errorTexto, setErrorTexto] = useState<string | null>(null)
  const [ahora, setAhora] = useState<number>(() => Date.now())
  const [refrescando, setRefrescando] = useState(false)
  const [abierta, setAbierta] = useState(false)

  const cargandoRef = useRef(false)
  // ¿Ya dibujamos datos alguna vez? Define si un error nuevo merece borrar la pantalla
  // o dejar la última lectura visible.
  const tieneDatosRef = useRef(false)

  const cargar = useCallback(async (manual = false) => {
    if (cargandoRef.current) return
    cargandoRef.current = true
    if (manual) setRefrescando(true)
    try {
      // Lectura DIRECTA con rol anon: son conteos, es barato y no pasa por el servidor.
      const [cobRes, runRes, colaRes, concRes, faltanRes] = await Promise.all([
        supabase.from('v_cobertura').select('*').limit(1),
        supabase.from('v_run_activo').select('*').limit(20),
        supabase.from('v_cola_escaneo')
          .select('id, rit, caratulado, escaneo_estado, ultima_escaneada, pendientes_desde')
          .limit(8),
        supabase.from('v_conciliacion').select('*').limit(1),
        supabase.from('v_conciliacion_detalle')
          .select('rit, caratulado')
          .eq('situacion', 'falta_en_bd')
          .limit(300),
      ])

      // La conciliación es un PLUS: si sus vistas no existen todavía, el panel sigue
      // funcionando y avisa que no puede responder "¿están todas?".
      const codigoConc = String(concRes.error?.code || '')
      setConcSinMigrar(codigoConc === '42P01' || codigoConc === '42703')
      if (!concRes.error) setConc((concRes.data?.[0] as Conciliacion) || null)
      if (!faltanRes.error) setFaltan((faltanRes.data as FaltaItem[]) || [])

      const codigo = String(cobRes.error?.code || runRes.error?.code || '')
      if (cobRes.error || !cobRes.data?.[0]) {
        // 42P01 (vista inexistente) / 42703 (columna inexistente) = la migración no se aplicó.
        if (codigo === '42P01' || codigo === '42703') {
          setModo('sin_migracion')
          setErrorTexto(cobRes.error?.message || runRes.error?.message || null)
          return
        }
        // Otro error (timeout del rol anon, permisos): red de seguridad server-side.
        const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
        const qs = token ? `?token=${encodeURIComponent(token)}` : ''
        try {
          const res = await fetch(`/api/cobertura${qs}`, { cache: 'no-store' })
          const json = await res.json()
          if (json?.motivo === 'migracion_pendiente') {
            setModo('sin_migracion')
            setErrorTexto(json.error || null)
            return
          }
          if (res.ok && json?.ok && json.cobertura) {
            setCob(json.cobertura)
            setRuns(Array.isArray(json.runs) ? json.runs : [])
            setCola(Array.isArray(json.cola) ? json.cola : [])
            setConc(json.conciliacion || null)
            setFaltan(Array.isArray(json.faltan) ? json.faltan : [])
            setConcSinMigrar(json.conc_error === '42P01' || json.conc_error === '42703')
            setModo('listo')
            setErrorTexto(null)
            tieneDatosRef.current = true
            return
          }
        } catch {
          // endpoint no disponible: se muestra el error de la lectura directa
        }
        setErrorTexto(cobRes.error?.message || 'No se pudo leer la cobertura.')
        setModo(tieneDatosRef.current ? 'listo' : 'error')
        return
      }

      setCob(cobRes.data[0] as CoberturaFila)
      setRuns((runRes.data as RunFila[]) || [])
      setCola((colaRes.data as ColaItem[]) || [])
      setModo('listo')
      setErrorTexto(null)
      tieneDatosRef.current = true
    } catch (e: any) {
      setErrorTexto(e?.message || 'No se pudo conectar.')
      setModo(tieneDatosRef.current ? 'listo' : 'error')
    } finally {
      cargandoRef.current = false
      setRefrescando(false)
      setAhora(Date.now())
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // La corrida viva se recalcula contra `ahora` para que un bot colgado deje de contar como
  // "en curso" aunque nadie recargue los datos.
  const runVivo = modo === 'listo' ? runs.find((r) => corridaViva(r, ahora)) || null : null

  // Detección del FIN de corrida: estaba en curso en la lectura anterior y ahora no →
  // avisar una sola vez para que el Dashboard recargue las causas.
  const antesEnCurso = useRef(false)
  useEffect(() => {
    if (antesEnCurso.current && !runVivo) onRunTermino?.()
    antesEnCurso.current = !!runVivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runVivo])

  // Auto-refresco: 5 s con el bot corriendo (es lo que la curadora quiere VER moverse),
  // 60 s apagado (solo para detectar que arrancó una corrida).
  useEffect(() => {
    const ms = runVivo ? 5_000 : 60_000
    const t = setInterval(() => {
      if (!document.hidden) cargar()
    }, ms)
    return () => clearInterval(t)
  }, [runVivo, cargar])

  // Reloj del "hace X s": solo texto, no recarga datos.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), runVivo ? 2_000 : 30_000)
    return () => clearInterval(t)
  }, [runVivo])

  if (modo === 'cargando') {
    return <div className="h-[120px] rounded-xl bg-slate-100 border border-slate-200 animate-pulse" />
  }

  if (modo === 'sin_migracion') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
          <IconAlert className="w-4 h-4" /> La métrica de escaneo todavía no está activa
        </p>
        <p className="text-xs text-amber-800/80 mt-1">
          Falta aplicar <span className="font-mono">schema-001-cobertura.sql</span> en Supabase
          (SQL Editor → pegar el archivo → Run). Crea la cola de escaneo; sin ella el bot y esta
          pantalla no pueden decirte si están todas las causas al día.
        </p>
        {errorTexto && <p className="text-[11px] text-amber-700/70 mt-1 font-mono break-all">{errorTexto}</p>}
      </div>
    )
  }

  if (modo === 'error' || !cob) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          No se pudo leer el estado del escaneo.
          {errorTexto ? <span className="text-xs text-slate-400"> {errorTexto}</span> : null}
        </p>
        <button
          onClick={() => cargar(true)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          <IconRefresh className={`w-3.5 h-3.5 ${refrescando ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          Reintentar
        </button>
      </div>
    )
  }

  // ---- Números (única fuente de verdad: v_cobertura) ----
  const enProgreso = cob.en_progreso || 0
  const conError = cob.con_error || 0
  const fuera = cob.descatalogadas || 0
  // Causas marcadas en `notas` que el bot ya NO reintenta ([REVISAR LETRA], cuarentena,
  // [TERMINADA]…). Necesitan una decisión humana, no otra corrida: si contaran acá, el
  // número grande nunca podría llegar a 0 por más que el bot trabajara.
  const bloqueadas = cob.fuera_de_cola || 0
  // 'vencidas' y 'pendientes' no se pisan: el bot las re-encola al arrancar, así que una causa
  // vieja está en UNO de los dos bolsillos. Sumarlos da el trabajo total sin contar dos veces.
  const vencidas = cob.vencidas || 0
  // Si la vista ya trae por_escanear, ESA es la cifra (la calcula Postgres con el mismo
  // criterio que la cola del bot). Si no, la base todavía tiene la vista vieja y se suma acá.
  const pendientes =
    typeof cob.por_escanear === 'number'
      ? cob.por_escanear
      : (cob.pendientes || 0) + enProgreso + conError + vencidas
  const universo = Math.max(0, (cob.total_causas || 0) - fuera - bloqueadas)
  const alDia = Math.max(0, (cob.ok || 0) + (cob.sin_datos || 0) - vencidas)
  const pct = universo > 0 ? Math.min(100, Math.round((alDia / universo) * 100)) : 0
  const ultimoRun = runs.find((r) => r.finished_at) || null
  const rezago = cob.rezago_maximo_dias == null ? null : Number(cob.rezago_maximo_dias)
  // Causas que el PORTAL muestra y la base no. null = todavía no se puede saber (nunca se
  // corrió inventario, o falta la migración). Es lo que separa "0 pendientes" de "están todas".
  const hayInventario = !!conc?.corrida_en && !concSinMigrar
  const faltanDelPortal = hayInventario ? (conc!.faltan_en_bd || 0) : null

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <IconDownload className="w-4 h-4 text-slate-400" />
              Estado del escaneo del portal
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  pendientes === 0 ? 'text-green-700' : pendientes > 20 ? 'text-amber-600' : 'text-slate-900'
                }`}
              >
                {pendientes}
              </span>
              <span className="text-sm font-medium text-slate-600">
                {pendientes === 1 ? 'causa pendiente de escaneo' : 'causas pendientes de escaneo'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {pendientes === 0 ? (
                faltanDelPortal === 0 ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <IconCheck className="w-3.5 h-3.5" /> Están todas y al día. No hace falta correr el bot.
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <IconCheck className="w-3.5 h-3.5" /> Al día las causas cargadas.{' '}
                    {faltanDelPortal == null
                      ? 'Aún no puedo afirmar que están TODAS (falta el inventario del portal).'
                      : `Pero faltan ${faltanDelPortal} por cargar: veo más abajo.`}
                  </span>
                )
              ) : (
                <>
                  {(cob.nunca_escaneadas || 0) > 0 && (
                    <span className="text-amber-700">{cob.nunca_escaneadas} nunca fueron escaneadas. </span>
                  )}
                  {alDia} de {universo} al día ({pct}%).{' '}
                  {rezago != null && rezago > 7 && (
                    <span className="text-slate-500">La más atrasada hace {Math.round(rezago)} días.</span>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={() => cargar(true)}
              disabled={refrescando}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <IconRefresh className={`w-3.5 h-3.5 ${refrescando ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              Verificar ahora
            </button>
            <span className="text-[11px] text-slate-400">
              {cob.medido_en ? `Contado ${haceCuantoCorto(cob.medido_en, ahora)}` : ''}
            </span>
          </div>
        </div>

        <div className="mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-[width] duration-500 ease-out ${
              pendientes === 0 ? 'bg-green-500' : 'bg-slate-800'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Desglose: ningún número sin explicación (tooltip = qué significa y si preocupa) */}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <Chip etiqueta="Al día" valor={alDia} clase="bg-green-50 text-green-700 border-green-200"
            ayuda="El bot las escaneó en los últimos 7 días. Incluye causas escaneadas que no tienen movimientos (archivadas o dormidas)." />
          {(cob.pendientes || 0) > 0 && (
            <Chip etiqueta="Pendientes" valor={cob.pendientes} clase="bg-amber-50 text-amber-700 border-amber-200"
              ayuda="En la cola: las va a buscar el próximo lote del bot." />
          )}
          {vencidas > 0 && (
            <Chip etiqueta="Vencidas (+7 días)" valor={vencidas} clase="bg-orange-50 text-orange-700 border-orange-200"
              ayuda="Escaneadas hace más de 7 días: el portal puede tener movimientos nuevos (audiencias, traslados) que todavía no están acá. Es lo que hay que refrescar." />
          )}
          {enProgreso > 0 && (
            <Chip etiqueta="En curso" valor={enProgreso} clase="bg-violet-50 text-violet-700 border-violet-200"
              ayuda="El bot las está trayendo ahora. Si el bot NO está corriendo, quedaron colgadas de una corrida cortada: la próxima corrida las retoma solas." />
          )}
          {conError > 0 && (
            <Chip etiqueta="Con error" valor={conError} clase="bg-red-50 text-red-700 border-red-200"
              ayuda="El último intento falló (sesión, captcha, RIT cambiado). El bot reintenta solo; las que ya necesitan tu decisión están en el chip amarillo y NO cuentan en el número grande." />
          )}
          {fuera > 0 && (
            <Chip etiqueta="Fuera del portal" valor={fuera} clase="bg-slate-100 text-slate-500 border-slate-200"
              ayuda="Ya no aparecen en tu lista del portal (te relevaron la curaduría o se cerraron). No se escanean ni se cuentan." />
          )}
          {(bloqueadas > 0 || (fueraDeLaCola > 0 && fueraDeLaCola !== fuera)) && (
            <Chip etiqueta="Esperan tu decisión" valor={bloqueadas > 0 ? bloqueadas : fueraDeLaCola}
              clase="bg-amber-50 text-amber-700 border-amber-200"
              ayuda="El bot las marcó y ya NO las reintenta, porque ninguna corrida las puede resolver: el RIT de la base no coincide con el del portal ([REVISAR LETRA]), o están en cuarentena tras varios fallos ([REVISAR: no scrapeada]), o vos las cerraste ([TERMINADA]). Por eso no cuentan en el número grande." />
          )}
        </div>

        {/* ¿ESTÁN TODAS? — conciliación contra el portal. Sin esto, "0 pendientes" solo
            significa "lo que cargaste está al día", que es otra pregunta. */}
        {concSinMigrar ? (
          <p className="mt-3 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Para comparar contra el portal falta volver a correr{' '}
            <span className="font-mono">schema-001-cobertura.sql</span> (agrega las vistas de
            conciliación). Sin eso este panel no puede decir si te faltan causas.
          </p>
        ) : !hayInventario ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">
              <IconInbox className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              Nunca corrí un inventario del portal
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              El número de arriba cuenta <span className="font-medium">tus causas cargadas</span>.
              Una causa que el portal te asignó y nunca pegaste es invisible para él, así que
              «0 pendientes» no significa «están todas». Para saberlo: doble clic en{' '}
              <span className="font-mono">bot-inventario.bat</span> (tarda minutos, una vez por
              mes alcanza).
            </p>
          </div>
        ) : (
          <div
            className={`mt-3 rounded-lg border p-3 ${
              faltanDelPortal && faltanDelPortal > 0
                ? 'border-amber-200 bg-amber-50'
                : 'border-green-200 bg-green-50'
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                faltanDelPortal && faltanDelPortal > 0 ? 'text-amber-800' : 'text-green-800'
              }`}
            >
              {faltanDelPortal && faltanDelPortal > 0 ? (
                <>
                  {faltanDelPortal} {faltanDelPortal === 1 ? 'causa está' : 'causas están'} en el
                  portal y no en tu base
                </>
              ) : (
                <>Están todas: el portal no muestra ninguna causa que no tengas cargada</>
              )}
            </p>
            <p
              className={`text-[11px] mt-1 ${
                faltanDelPortal && faltanDelPortal > 0 ? 'text-amber-800/80' : 'text-green-800/80'
              }`}
            >
              Comparado con el inventario de {haceCuantoCorto(conc!.corrida_en, ahora)}:{' '}
              {conc!.rits_portal || 0} causas visibles en Mis Causas. Si el inventario es viejo,
              lo que se asignó después no está contabilizado.
            </p>

            {faltanDelPortal && faltanDelPortal > 0 && faltan.length > 0 && (
              <>
                <button
                  onClick={() => setFaltanAbiertas((v) => !v)}
                  aria-expanded={faltanAbiertas}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:text-amber-950 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  <IconChevron
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${faltanAbiertas ? 'rotate-90' : ''}`}
                  />
                  {faltanAbiertas ? 'Ocultar' : 'Ver'} cuáles son
                </button>
                {faltanAbiertas && (
                  <ul className="mt-2 space-y-1 max-h-56 overflow-auto">
                    {faltan.map((f, i) => (
                      <li key={`${f.rit}-${i}`} className="flex items-baseline gap-2 text-xs">
                        <span className="font-mono text-amber-900 shrink-0">{f.rit}</span>
                        <span className="text-amber-800/70 truncate">{f.caratulado || ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-amber-800/80 mt-2">
                  Solución: buscá el correo de ASIGNACIONES que las menciona y pegalo en la
                  pantalla Asignaciones. El bot no crea causas, solo las actualiza.
                </p>
              </>
            )}

            {(conc!.letra_distinta || 0) > 0 && (
              <p className="text-[11px] text-slate-600 mt-1">
                {conc!.letra_distinta} con el mismo número pero otra letra en el portal (P↔X). Se
                arreglan con el mantenimiento de letra.
              </p>
            )}
            {(conc!.en_bd_no_vistas_en_portal || 0) > 0 && (
              <p className="text-[11px] text-slate-600 mt-1">
                {conc!.en_bd_no_vistas_en_portal} en tu base que el portal ya no muestra en Mis
                Causas. Pueden estar archivadas o relevadas: revisar antes de darlas de baja.
              </p>
            )}
          </div>
        )}

        {/* CORRIDA EN VIVO: lo que la curadora quiere ver moverse */}
        {runVivo && (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-violet-800">
                <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse motion-reduce:animate-none" />
                El bot está escaneando ahora
              </span>
              <span className="text-xs text-violet-700 tabular-nums">
                {(runVivo.procesadas || 0)} de {(runVivo.total_causas || 0)} causas
              </span>
            </div>
            <div className="mt-2 w-full bg-violet-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-violet-600 h-1.5 rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${runVivo.total_causas
                    ? Math.min(100, Math.round(((runVivo.procesadas || 0) / runVivo.total_causas) * 100))
                    : 0}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-violet-700 mt-1.5 tabular-nums">
              OK {runVivo.exitosas || 0} · con problemas {runVivo.fallidas || 0}
              {runVivo.items_no_encontrada ? ` · no encontradas ${runVivo.items_no_encontrada}` : ''}
              {runVivo.ultimo_item_en ? ` · último resultado hace ${haceCuantoCorto(runVivo.ultimo_item_en, ahora)}` : ''}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Esta pantalla se actualiza sola mientras corre. Cuando termine, las causas se recargan solas.
            </p>
          </div>
        )}

        {/* ÚLTIMA CORRIDA: sirve para detectar que el bot se cortó a mitad */}
        {!runVivo && ultimoRun && ultimoRun.finished_at && (
          <div className="mt-3 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
            <IconClock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              Última corrida:{' '}
              {new Date(ultimoRun.finished_at).toLocaleString('es-CL', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}{' '}
              — {(ultimoRun.procesadas || 0)} causas, {ultimoRun.exitosas || 0} OK, {ultimoRun.fallidas || 0} con problemas
              {ultimoRun.detenido_por
                ? ` (${MOTIVOS_DETENCION[ultimoRun.detenido_por] || ultimoRun.detenido_por})`
                : ''}
            </span>
          </div>
        )}

        {/* QUÉ VA A BUSCAR EL PRÓXIMO LOTE (control, no misterio) */}
        {pendientes > 0 && cola.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <button
              onClick={() => setAbierta((v) => !v)}
              aria-expanded={abierta}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <IconChevron className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${abierta ? 'rotate-90' : ''}`} />
              {abierta ? 'Ocultar' : 'Ver'} las primeras causas que va a buscar el bot
            </button>
            {abierta && (
              <ul className="mt-2 space-y-1">
                {cola.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-700 shrink-0">{c.rit}</span>
                    <span className="text-slate-400 truncate flex-1">{c.caratulado || ''}</span>
                    <span className="text-slate-500 shrink-0">
                      {c.ultima_escaneada
                        ? `escaneada ${haceCuantoCorto(c.ultima_escaneada, ahora)}`
                        : 'nunca escaneada'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pendientes === 0 && cola.length === 0 && (
          <p className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1.5">
            <IconInbox className="w-3.5 h-3.5" /> Cola vacía: el bot no tiene nada que traer.
          </p>
        )}
      </div>

      {/* Nota de honestidad: el bot es local, el panel no puede inventar actividad */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
        <p className="text-[11px] text-slate-500">
          El bot corre en tu computadora: si no está corriendo, no llega información nueva del portal.
          {pendientes > 0 && !runVivo && (
            <span className="font-medium text-slate-700">
              {' '}Para poner al día las {pendientes} pendientes, ejecutá{' '}
              <span className="font-mono">bot-mantenimiento.bat</span>.
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

function Chip({ etiqueta, valor, clase, ayuda }: {
  etiqueta: string; valor: number; clase: string; ayuda: string
}) {
  return (
    <span
      title={ayuda}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border tabular-nums ${clase}`}
    >
      <span className="font-semibold">{valor}</span>
      <span className="opacity-80">{etiqueta}</span>
    </span>
  )
}
