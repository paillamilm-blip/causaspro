'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { materiaDeTipo, materiaDeRit, type GrupoMateria } from '@/lib/materiasFamilia'
import { estadoSeguimientoNna, agruparGestionesPorCausa } from '@/lib/seguimientoNna'
import {
  MARCA_ESCRITO_TRASLADO, TIPO_ESCRITO, DIAS_PLAZO_CIERRE,
  escritoTrasladoMasReciente, estadoCierreTraslado, textoCierreTraslado, textoChipCierre,
} from '@/lib/cierreTraslado'
import { estaTerminada, MARCA_TERMINADA, ETAPA_TERMINADA } from '@/lib/monitoreo'
import {
  IconRefresh, IconSearch, IconX, IconUsers, IconCalendar,
  IconAlert, IconChevron, IconClock, IconInbox,
  IconCheck, IconShield, IconSparkles, IconPause, IconLink, IconHourglass,
} from './icons'
import CoberturaPanel from './CoberturaPanel'
import type { ComponentType, SVGProps, ReactNode } from 'react'

type IconoTipo = ComponentType<SVGProps<SVGSVGElement>>

// Motivo de urgencia con ÍCONO SVG formal (ligado al color del nivel) + texto.
// Reemplaza los emoji por iconos de una sola familia (más serio/profesional).
interface MotivoUrgencia { Icono: IconoTipo; texto: string }

// Filtro rápido activo desde las tarjetas KPI. 'todas' = sin filtro por urgencia.
type FiltroUrgencia = 'todas' | 'activas' | 'traslados' | 'cierre' | 'seguimiento' | 'criticas' | 'atencion' | 'revisar' | 'estables' | 'fuera' | 'vinculantes'

// Título y color de punto para la sección única que se muestra cuando hay un filtro rápido
// activo (clic en un KPI). 'todas' no aplica: en ese caso se muestran las secciones por nivel.
const FILTRO_SECCION: Record<Exclude<FiltroUrgencia, 'todas'>, { title: string; dotColor: string; tono: TonoBloque; Icono: IconoTipo }> = {
  activas:     { title: 'Causas activas — por orden de vencimiento', dotColor: 'bg-green-500', tono: 'green', Icono: IconClock },
  traslados:   { title: 'Traslados al curador — sin responder', dotColor: 'bg-violet-500', tono: 'violet', Icono: IconShield },
  cierre:      { title: 'Esperando cierre del tribunal', dotColor: 'bg-violet-500', tono: 'violet', Icono: IconHourglass },
  seguimiento: { title: 'Seguimiento del NNA vencido', dotColor: 'bg-rose-500', tono: 'rose', Icono: IconUsers },
  criticas:    { title: 'Críticas — Acción inmediata', dotColor: 'bg-red-500', tono: 'red', Icono: IconAlert },
  atencion:    { title: 'Atención — Revisar esta semana', dotColor: 'bg-amber-400', tono: 'amber', Icono: IconClock },
  revisar:     { title: 'Revisar — Seguimiento pendiente', dotColor: 'bg-orange-400', tono: 'orange', Icono: IconPause },
  estables:    { title: 'Estables — Sin urgencia inmediata', dotColor: 'bg-green-500', tono: 'green', Icono: IconCheck },
  fuera:       { title: 'Causas terminadas', dotColor: 'bg-slate-500', tono: 'slate', Icono: IconInbox },
  vinculantes: { title: 'Vinculantes — P que vincula a una X', dotColor: 'bg-violet-500', tono: 'violet', Icono: IconLink },
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
  // Demás expedientes anotados en la MISMA celda del Excel ("X-3615-2022//P-7664-2022").
  // El parser lo guarda en causas.datos_extra.rits_vinculados; el panel lo crucea en el
  // cliente para marcar las vinculantes (criterio de la curadora: P vincula a X).
  rits_vinculados?: string | null
  // Marca calculada EN EL CLIENTE (no viene de la vista): el seguimiento del NNA está
  // vencido (>180 días sin "Entrevista al NNA", o nunca se registró una). Se completa en
  // loadCausas cruzando las causas con las gestiones. undefined hasta ese cruce.
  seguimiento_vencido?: boolean
  // También calculada en el cliente: el PORTAL marcó la causa como terminada (tiene un
  // movimiento con etapa "Terminada"). La vista expone el `tramite` del último movimiento
  // pero no su `etapa`, así que se cruza aparte en loadCausas. undefined hasta ese cruce.
  terminada_portal?: boolean
  // Calculada en el cliente: fecha (ISO) en que la curadora marcó "Escrito enviado" al
  // traslado. Sale de la bitácora (gestiones tipo 'Presentación de escrito' con la marca
  // [ESCRITO TRASLADO]); la marca se puede deshacer y eso borra la gestión. undefined hasta
  // el cruce de gestiones en loadCausas.
  traslado_escrito_fecha?: string | null
  // Id de ESA gestión concreta (la más reciente), para poder borrarla al desmarcar.
  traslado_escrito_gestion_id?: string | null
}

// ¿La causa ya NO está en la lista del portal del curador? El bot marca [NO EN PORTAL] en
// `notas` cuando el portal confirmó que la causa no aparece en "Mis Causas" (normalmente
// porque le relevaron la curaduría a Paula). Estas causas siguen visibles (por si fue un
// error), pero NO deben generar alarmas (seguimiento vencido, urgencias): ya no son su
// responsabilidad. Comparación tolerante a mayúsculas/espacios.
function fueraDeMiLista(c: CausaResumen): boolean {
  return (c.notas ?? '').toUpperCase().includes('[NO EN PORTAL]')
}

// ¿El bot NO puede traer datos de esta causa, haga lo que haga? Se usa SOLO para la barra
// de progreso: son las causas que están fuera de la cola de scraping, así que si contaran en
// el denominador la barra nunca podría llegar al 100%.
//
// Es a propósito distinta de fueraDeMiLista(): esa significa "le relevaron la curaduría" y
// además silencia alarmas. Acá el criterio es más amplio y solo habla de lo que el bot puede
// cargar (mantener alineado con esRuido() en src/bot/modules/supabaseSync.ts):
//   [NO EN PORTAL]          → el portal confirmó que no aparece en Mis Causas
//   [REVISAR: no scrapeada] → en cuarentena tras varios fallos transitorios
//   [REVISAR LETRA]         → el RIT de la base no coincide con el del portal (otra letra)
function noCargablePorBot(c: CausaResumen): boolean {
  const n = (c.notas ?? '').toUpperCase()
  return n.includes('[NO EN PORTAL]')
    || n.includes('[REVISAR: NO SCRAPEADA]')
    || n.includes('[REVISAR LETRA]')
    || n.includes(MARCA_TERMINADA)   // la curadora la cerró: el bot ya no la revisa
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

// ============================================================
// ESTADO DE LA CAUSA — modelo de 2 estados pedido por la curadora
// ------------------------------------------------------------
// Solo hay dos: VIGENTE (se monitorea, trae sus alertas) y TERMINADA (cerrada, no genera
// alertas). Una causa terminada SIEMPRE trae el MOTIVO del cierre. La jerga es técnica a
// propósito (la curadora la maneja y la prefiere).
// ============================================================

type MotivoTermino =
  | 'rechazo'         // sentencia rechazó la protección
  | 'incompetencia'   // el tribunal se declaró incompetente
  | 'cese_medida'     // cesó / se dejó sin efecto la medida de protección
  | 'terminada'       // el portal la marca "Terminada" sin sub-motivo distinguible
  | 'relevada'        // le relevaron la curaduría (ya no es su causa)
  | 'cerrada_manual'  // la curadora la cerró a mano

/** ¿El portal declaró INCOMPETENCIA como cierre? Solo cuenta si es el ESTADO de la causa,
 *  no un movimiento intermedio (una causa puede pasar por incompetencia y seguir). */
function tieneIncompetencia(c: CausaResumen): boolean {
  const texto = `${c.estado ?? ''} ${c.ultimo_movimiento ?? ''}`.toLowerCase()
  return /incompeten/.test(texto)
}

/** ¿Cesó la medida de protección? Textos del portal: "cesa/cese de la medida",
 *  "deja sin efecto la medida de protección", "término de la medida". */
function tieneCeseMedida(c: CausaResumen): boolean {
  const texto = `${c.estado ?? ''} ${c.sintesis ?? ''} ${c.ultimo_movimiento ?? ''}`.toLowerCase()
  return /(cesa|cese|termino|término|deja sin efecto)[^.]*\bmedida/.test(texto)
    || /medida[^.]*(cesad|dejada sin efecto|terminad)/.test(texto)
}

/**
 * Estado de la causa: vigente o terminada + motivo. Es la ÚNICA distinción de primer nivel.
 * Orden de prioridad del motivo (del más específico al más genérico): la marca manual de la
 * curadora manda; después los motivos jurídicos concretos; "terminada" genérica al final.
 */
function estadoCausa(c: CausaResumen): { vigente: boolean; motivo?: MotivoTermino } {
  if (estaTerminada(c.notas)) return { vigente: false, motivo: 'cerrada_manual' }
  if (fueraDeMiLista(c)) return { vigente: false, motivo: 'relevada' }
  if (tieneSentenciaRechazo(c)) return { vigente: false, motivo: 'rechazo' }
  if (tieneCeseMedida(c)) return { vigente: false, motivo: 'cese_medida' }
  // La incompetencia y la etapa "Terminada" del portal solo cierran si NO hubo actividad
  // posterior. Como señal simple usamos el estado/último movimiento (incompetencia) y el
  // flag terminada_portal (que ya se calculó mirando la etapa del expediente).
  if (tieneIncompetencia(c)) return { vigente: false, motivo: 'incompetencia' }
  if (c.terminada_portal === true) return { vigente: false, motivo: 'terminada' }
  return { vigente: true }
}

/** Texto técnico + tooltip para cada motivo de término. Jerga jurídica a propósito. */
const MOTIVO_TERMINO: Record<MotivoTermino, { texto: string; ayuda: string }> = {
  rechazo:        { texto: 'Terminada · Rechazo', ayuda: 'Sentencia que rechazó la solicitud de protección. No hay medida que monitorear.' },
  incompetencia:  { texto: 'Terminada · Incompetencia', ayuda: 'El tribunal se declaró incompetente. La causa salió de este tribunal.' },
  cese_medida:    { texto: 'Terminada · Cese de medida', ayuda: 'Cesó o se dejó sin efecto la medida de protección. Ya no hay medida vigente.' },
  terminada:      { texto: 'Terminada', ayuda: 'El portal registró la causa en etapa "Terminada".' },
  relevada:       { texto: 'Terminada · Relevada', ayuda: 'Te relevaron la curaduría: la causa ya no aparece en tu lista del portal.' },
  cerrada_manual: { texto: 'Terminada · Cerrada por vos', ayuda: 'La marcaste como terminada a mano. Podés reactivarla desde el detalle.' },
}

// Compat: se mantiene el nombre viejo, ahora derivado del modelo de 2 estados. Todo lo que
// antes preguntaba "¿está fuera de monitoreo?" sigue funcionando igual.
function fueraDeMonitoreo(c: CausaResumen): boolean {
  return !estadoCausa(c).vigente
}

// VÍNCULO P↔X (criterio de la curadora, 27-10-2026): cuando el Excel anotó dos expedientes
// en una misma celda, la causa de PROTECCIÓN (P) VINCULA a la de VARIOS (X). Se revisan
// juntas, así que ambas se marcan desde la pantalla principal.
function ritVinculadosLista(c: CausaResumen): string[] {
  const raw = c.rits_vinculados
    ?? (typeof (c as any).datos_extra?.rits_vinculados === 'string' ? (c as any).datos_extra.rits_vinculados : null)
  if (!raw) return []
  return String(raw).split(',').map((s: string) => s.trim()).filter(Boolean)
}
// Si es P y entre sus vinculados hay una X, devuelve esa X (es VINCULANTE).
function xVinculadaPorP(c: CausaResumen): string | null {
  if (!c.rit.toUpperCase().startsWith('P-')) return null
  return ritVinculadosLista(c).find((r) => r.toUpperCase().startsWith('X-')) ?? null
}
// Si es X y entre sus vinculados hay una P, devuelve esa P (está VINCULADA por ella).
function pQueVinculaX(c: CausaResumen): string | null {
  if (!c.rit.toUpperCase().startsWith('X-')) return null
  return ritVinculadosLista(c).find((r) => r.toUpperCase().startsWith('P-')) ?? null
}
function chipVinculo(c: CausaResumen): Chip | null {
  const x = xVinculadaPorP(c)
  if (x) return { texto: `Vinculante ↔ ${x}`, clase: 'bg-violet-200 text-violet-800',
    ayuda: `Causa de protección que vincula a ${x}. Son el mismo caso: se revisan juntas.` }
  const p = pQueVinculaX(c)
  if (p) return { texto: `Vinculada por ${p}`, clase: 'bg-indigo-100 text-indigo-700',
    ayuda: `${p} (protección) vincula a esta de varios. Comparten NNA y hechos.` }
  return null
}

// Chips de señales de curaduría que se muestran en cada tarjeta de causa.
// Cada uno resume una alerta de cumplimiento en un badge compacto y legible.
// Un chip: texto corto + color + explicación (tooltip) de qué significa y qué hacer.
// El `title` es clave para una usuaria no programadora: al pasar el mouse (o mantener
// pulsado en el celu) ve la explicación en palabras, sin jerga jurídica ni técnica.
interface Chip { texto: string; clase: string; ayuda: string }

function chipsSenales(c: CausaResumen): Chip[] {
  // PRIMERA Y ÚNICA distinción de primer nivel: vigente o terminada.
  // Si está TERMINADA, un solo chip gris con el MOTIVO. Las alertas de una causa vigente
  // (traslado, seguimiento) ya no aplican y solo confundirían — por eso return acá.
  const estado = estadoCausa(c)
  if (!estado.vigente && estado.motivo) {
    const m = MOTIVO_TERMINO[estado.motivo]
    // El vínculo P↔X NO se pierde al terminarse: la curadora igual necesita saber con qué
    // expediente hermano estaba atada esta causa.
    const vinc = chipVinculo(c)
    return [{ texto: m.texto, clase: 'bg-slate-600 text-white', ayuda: m.ayuda }, ...(vinc ? [vinc] : [])]
  }

  // VIGENTE: sus alertas, ordenadas de más a menos urgente. Terminología técnica (Paula
  // la maneja); el tooltip agrega el contexto de qué hacer.
  const chips: Chip[] = []

  if (c.tiene_orden_busqueda) chips.push({ texto: 'Orden de búsqueda', clase: 'bg-red-100 text-red-700',
    ayuda: 'El tribunal decretó orden de búsqueda: el NNA no está ubicado. Máxima urgencia.' })

  if (c.tiene_traslado_curador) {
    if (c.traslado_escrito_fecha) {
      // La curadora YA respondió el traslado: deja de ser un pendiente y pasa a esperar
      // el cierre del tribunal (plazo de 14 días desde el envío, criterio de Paula).
      const e = estadoCierreTraslado(c.traslado_escrito_fecha)
      chips.push({
        texto: textoChipCierre(e),
        clase: e.vencido ? 'bg-red-100 text-red-700' : e.diasRestantes === 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
        ayuda: e.vencido
          ? `Escrito enviado el ${formatFechaDia(c.traslado_escrito_fecha)}; superó los ${DIAS_PLAZO_CIERRE} días de cierre y el portal no registra resolución. Preguntar al tribunal.`
          : `Escrito enviado el ${formatFechaDia(c.traslado_escrito_fecha)}. El tribunal cierra en ~${DIAS_PLAZO_CIERRE} días (${textoCierreTraslado(e)}).`,
      })
    } else {
      chips.push({ texto: 'Traslado al curador', clase: 'bg-violet-100 text-violet-700',
        ayuda: 'El tribunal confirió traslado al curador (últimos 30 días). Requiere que te pronuncies.' })
    }
  }

  if (c.seguimiento_vencido) chips.push({ texto: 'Seguimiento NNA vencido', clase: 'bg-rose-100 text-rose-700',
    ayuda: 'Más de 180 días sin entrevista al NNA (o sin registro). Corresponde diligencia de seguimiento.' })

  if (c.tiene_no_adherencia) chips.push({ texto: 'No adherencia del programa', clase: 'bg-amber-100 text-amber-700',
    ayuda: 'El programa (OPD/PPF/PIE/PRM) informó inasistencia, abandono o no adherencia. Evaluar reunión técnica o re-derivación.' })

  if (c.tiene_citacion_audiencia) chips.push({ texto: 'Citación a audiencia', clase: 'bg-sky-100 text-sky-700',
    ayuda: 'Hay citación a audiencia reciente. Verificar fecha y preparar.' })

  if (c.dias_sin_actividad != null && c.dias_sin_actividad > 180 && c.nivel_urgencia !== 6) {
    chips.push({ texto: `Estancada ${Math.round(c.dias_sin_actividad / 30)} meses`, clase: 'bg-orange-100 text-orange-700',
      ayuda: `Sin movimiento hace ~${Math.round(c.dias_sin_actividad / 30)} meses. Corresponde impulsar o solicitar estado de la causa.` })
  }

  // Vinculante/Vinculada al final: no es una urgencia, es información de con qué causa hermana
  // hay que mirar ésta (criterio de la curadora: P vincula a X).
  const vinc = chipVinculo(c)
  if (vinc) chips.push(vinc)

  return chips
}

// Leyenda desplegable que explica QUÉ significa cada chip. Pensada para que la curadora la
// tenga siempre a mano: separa las ALERTAS de una causa activa (colores vivos) de los
// ESTADOS DE CIERRE (grises), que es justo la confusión que reportó ("no entiendo si una
// está en traslado pero ya se cerró"). Arranca cerrada para no ocupar espacio.
function LeyendaChips() {
  const [abierta, setAbierta] = useState(false)
  const item = (chipClase: string, texto: string, explica: string) => (
    <div className="flex items-start gap-2">
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${chipClase}`}>{texto}</span>
      <span className="text-xs text-slate-500">{explica}</span>
    </div>
  )
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <button
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded-xl"
      >
        <IconChevron className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${abierta ? 'rotate-90' : ''}`} />
        ¿Qué significan las etiquetas de colores?
      </button>
      {abierta && (
        <div className="px-4 pb-4 space-y-4">
          <div>
            <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span> Causa vigente — sus alertas
            </p>
            <div className="space-y-2">
              {item('bg-red-100 text-red-700', 'Orden de búsqueda', 'El NNA no está ubicado. Máxima urgencia.')}
              {item('bg-violet-100 text-violet-700', 'Traslado al curador', 'El tribunal confirió traslado: requiere que te pronuncies.')}
              {item('bg-emerald-100 text-emerald-700', 'Cierre en N días', 'Ya enviaste el escrito; el tribunal cierra en ~14 días. Nada que hacer hasta que venza.')}
              {item('bg-red-100 text-red-700', 'Cierre vencido — revisar', 'Pasaron los 14 días del cierre sin resolución registrada. Preguntar al tribunal.')}
              {item('bg-rose-100 text-rose-700', 'Seguimiento NNA vencido', 'Más de 180 días sin entrevista al NNA. Corresponde diligencia de seguimiento.')}
              {item('bg-amber-100 text-amber-700', 'No adherencia del programa', 'El programa informó inasistencia o abandono. Evaluar reunión técnica o re-derivación.')}
              {item('bg-sky-100 text-sky-700', 'Citación a audiencia', 'Hay citación reciente. Verificar fecha.')}
              {item('bg-orange-100 text-orange-700', 'Estancada N meses', 'Sin movimiento hace meses. Corresponde impulsar o solicitar estado.')}
              {item('bg-violet-200 text-violet-800', 'Vinculante ↔ X-…', 'Causa de protección (P) que vincula a una de varios (X): se revisan juntas.')}
              {item('bg-indigo-100 text-indigo-700', 'Vinculada por P-…', 'Una causa de protección vincula a esta de varios: comparten NNA y hechos.')}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span> Causa terminada — motivo del cierre
            </p>
            <p className="text-xs text-slate-400 mb-2">No generan alertas. El motivo lo dice la etiqueta:</p>
            <div className="space-y-2">
              {item('bg-slate-600 text-white', 'Terminada · Rechazo', 'Sentencia que rechazó la protección.')}
              {item('bg-slate-600 text-white', 'Terminada · Incompetencia', 'El tribunal se declaró incompetente.')}
              {item('bg-slate-600 text-white', 'Terminada · Cese de medida', 'Cesó o se dejó sin efecto la medida de protección.')}
              {item('bg-slate-600 text-white', 'Terminada · Relevada', 'Te relevaron la curaduría: ya no está en tu lista del portal.')}
              {item('bg-slate-600 text-white', 'Terminada · Cerrada por vos', 'La marcaste a mano. Reactivable desde el detalle.')}
            </div>
          </div>
          <p className="text-xs text-slate-400 pt-1 border-t border-slate-100">
            Tip: en cada causa, pasá el mouse por encima de una etiqueta (o mantené pulsado en el celular) para ver esta explicación.
          </p>
        </div>
      )}
    </div>
  )
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
// (db/migraciones/schema-semaforo-proteccion.sql). Prioriza la señal más fuerte de la causa.
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

// Fecha para columnas DATE puras de Postgres ("2026-10-27", sin hora ni zona). formatFecha
// arriba NO sirve acá: new Date('2026-10-27') se interpreta como medianoche UTC y en Chile
// (UTC-3) muestra un día antes — habría dicho "enviado 26-10" de un escrito mandado el 27.
// Se parsea como fecha LOCAL, igual que hace el módulo de cierre.
function formatFechaDia(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return formatFecha(iso)
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
  // Cuántas causas ve el PORTAL y no están en la base (lo reporta CoberturaPanel, que ya
  // lee v_conciliacion). null = todavía no se puede afirmar (falta inventario). La agenda
  // lo usa para la única fila que el Dashboard no puede calcular solo.
  const [faltanPortal, setFaltanPortal] = useState<number | null>(null)
  // Estado del Asesor IA: la causa cuyo análisis se abrió + carga/resultado/error.
  // null = modal cerrado.
  const [asesorIA, setAsesorIA] = useState<{
    rit: string
    cargando: boolean
    resultado: { resumen: string; proximoPaso: string; riesgo: string; acciones?: string[]; preguntasPrograma?: string[]; resumenCausa?: string; resumenProgramas?: string } | null
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
        // `detalle` (si viene) dice QUÉ falló por modelo: ej. "HTTP 429 (límite de uso)".
        // Se muestra para poder diagnosticar sin leer logs del servidor.
        const base = json?.error || `Error ${res.status}`
        setAsesorIA({
          rit,
          cargando: false,
          resultado: null,
          error: json?.detalle ? `${base}\n\nDetalle técnico: ${json.detalle}` : base,
        })
        return
      }
      setAsesorIA({ rit, cargando: false, resultado: json, error: null })
    } catch (e: any) {
      setAsesorIA({ rit, cargando: false, resultado: null, error: e?.message || 'No se pudo conectar con el Asesor IA.' })
    }
  }

  // Saca una causa de monitoreo (o la reactiva) y recarga la lista para que se recategorice.
  // El portal NO informa cuándo una causa terminó, así que esta marca manual de la curadora es
  // la única fuente. Va por el endpoint (server-side) porque `notas` es un canal compartido con
  // el bot y hay que agregar una línea sin pisar sus marcas.
  async function toggleMonitoreo(causaId: string, terminada: boolean) {
    try {
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      const res = await fetch(`/api/causa/${causaId}/monitoreo${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminada }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json?.error || `No se pudo guardar (error ${res.status}).`)
        return
      }
      await loadCausas()
    } catch (e: any) {
      alert(e?.message || 'No se pudo conectar con el servidor.')
    }
  }

  // Marca/desmarca "Escrito enviado" en un traslado. NO toca las causas: agrega (o borra)
  // una gestión a la bitácora de la causa — tipo 'Presentación de escrito' con la marca
  // [ESCRITO TRASLADO] y fecha de hoy. Misma tabla y mismo mecanismo que la ficha de causa,
  // así la bitácora queda a la vista y el historial manda: si se desmarca, se borra solo
  // la fila que marcó este botón (traslado_escrito_gestion_id), nunca otra gestión.
  async function toggleEscrito(causaId: string, enviado: boolean, gestionId?: string | null, rit?: string) {
    try {
      let err: { message: string } | null = null
      if (enviado) {
        const hoy = new Date().toISOString().slice(0, 10)
        const { error } = await supabase
          .from('gestiones')
          .insert({
            causa_id: causaId,
            tipo: TIPO_ESCRITO,
            fecha: hoy,
            contenido: `${MARCA_ESCRITO_TRASLADO} Escrito de respuesta al traslado conferido por el tribunal. Enviado y firmado por la curadora.`,
          })
        err = error
      } else {
        if (!gestionId) {
          alert('No encontré el registro del escrito en la bitácora, así que no puedo deshacerlo. Revisalo desde la ficha de la causa.')
          return
        }
        const { error } = await supabase.from('gestiones').delete().eq('id', gestionId)
        err = error
      }
      if (err) {
        alert(`No se pudo guardar (error ${err.message || 'desconocido'}).`)
        return
      }
      await loadCausas()
    } catch (e: any) {
      alert(e?.message || 'No se pudo conectar con el servidor.')
    }
  }

  // Cerrar el Asesor IA con la tecla Escape (accesibilidad).
  useEffect(() => {
    if (!asesorIA) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsesorIA(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [asesorIA])
  const [error, setError] = useState<string | null>(null)
  // true si se cayó al fallback de tabla directa (sin la vista): en ese modo el semáforo
  // NO es real (todas salen 'Estable') y hay que avisarlo arriba.
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
  async function fetchAll(
    tabla: string,
    columnas: string,
    ordenar?: string,
    ordenIdParaPaginar = false,
    // Filtro opcional de igualdad (columna → valor). Se aplica ANTES de paginar, así que
    // solo viajan las filas que interesan (ej. movimientos con etapa = 'Terminada').
    filtroIgual?: Record<string, string>,
  ) {
    const PAGE = 1000
    let desde = 0
    let todo: any[] = []
    for (;;) {
      let q = supabase.from(tabla).select(columnas)
      if (filtroIgual) for (const [col, val] of Object.entries(filtroIgual)) q = q.eq(col, val)
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
      //
      // CERO MENTIRAS: una causa NUNCA ESCANEADA no tiene gestiones porque el bot todavía
      // no la trajo, no porque Paula nunca entrevistó al NNA. Marcarla "vencida" inflaba el
      // KPI (801 = todas las activas). Solo marcamos vencido donde HAY datos reales del
      // portal (escaneo ok o ya fue escaneada alguna vez); las demás quedan sin marcar.
      try {
        const [gestRes, estRes] = await Promise.all([
          // contenido: necesario para reconocer la marca [ESCRITO TRASLADO] (idem id).
          fetchAll('gestiones', 'id, causa_id, tipo, fecha, contenido'),
          // rits_vinculados vive en el JSONB datos_extra; PostgREST lo expone como columna plana.
          fetchAll('causas', 'id, escaneo_estado, ultima_escaneada, datos_extra->>rits_vinculados'),
        ])
        const conDatos = new Set(
          ((estRes.data as any[]) || [])
            .filter((c) => c.escaneo_estado === 'ok' || c.ultima_escaneada != null)
            .map((c) => c.id),
        )
        const vinculosPorId = new Map<string, string>(
          ((estRes.data as any[]) || [])
            .filter((c) => c.rits_vinculados)
            .map((c) => [c.id, c.rits_vinculados as string]),
        )
        const gestionesPorCausa = agruparGestionesPorCausa((gestRes.data as any[]) || [])
        // Escrito de traslado enviado (cuadradito "Escrito enviado"): se agrupan las gestiones
        // COMPLETAS (con contenido e id) y el módulo puro elige la marcada más reciente.
        const crudosPorCausa = new Map<string, { id: string | null; tipo: string | null; fecha: string | null; contenido: string | null }[]>()
        for (const g of (gestRes.data as any[]) || []) {
          if (!g.causa_id) continue
          const lista = crudosPorCausa.get(g.causa_id)
          const item = { id: g.id ?? null, tipo: g.tipo ?? null, fecha: g.fecha ?? null, contenido: g.contenido ?? null }
          if (lista) lista.push(item)
          else crudosPorCausa.set(g.causa_id, [item])
        }
        const escritosPorCausa = new Map<string, { id: string | null; fecha: string }>()
        for (const [causaId, gs] of crudosPorCausa) {
          const e = escritoTrasladoMasReciente(gs)
          if (e) escritosPorCausa.set(causaId, e)
        }
        data = data.map((c: any) => ({
          ...c,
          seguimiento_vencido: conDatos.has(c.id)
            ? estadoSeguimientoNna(gestionesPorCausa.get(c.id) || []).vencido
            : undefined,
          rits_vinculados: vinculosPorId.get(c.id) ?? null,
          traslado_escrito_fecha: escritosPorCausa.get(c.id)?.fecha ?? null,
          traslado_escrito_gestion_id: escritosPorCausa.get(c.id)?.id ?? null,
        }))
      } catch (e) {
        console.warn('No se pudieron cargar las gestiones para el seguimiento del NNA:', e)
      }

      // CAUSAS TERMINADAS SEGÚN EL PORTAL. Se trae aparte porque la vista v_causas_ranking
      // expone el `tramite` del último movimiento pero NO su `etapa`, y la etapa es donde
      // está la señal.
      //
      // Medido sobre los datos reales (23-sep-2026): la etapa "Terminada" aparece en 167
      // movimientos de 52 causas, y esas 52 la tienen como ÚLTIMO movimiento (47 con trámite
      // "Resolución" + 5 con "Actuación"). O sea que es un estado TERMINAL: después no pasa
      // nada más. Por eso alcanza con "¿tiene algún movimiento en etapa Terminada?" sin
      // comparar fechas.
      //
      // Ojo con las etapas que NO son terminales, aunque lo parezcan:
      //   · "Sentencia" (42 causas) → puede seguir con cumplimiento; NO es el fin.
      //   · "Incompetencia" (47 causas) → solo 2 la tienen como último movimiento, las otras
      //     45 siguieron después. Tampoco es terminal.
      // Es una consulta liviana (167 filas). Si falla, no se marca ninguna y el panel sigue.
      try {
        const { data: terms } = await fetchAll('movimientos', 'causa_id', undefined, false, { etapa: ETAPA_TERMINADA })
        const idsTerminadas = new Set(((terms as any[]) || []).map((m) => m.causa_id))
        data = data.map((c: any) => ({ ...c, terminada_portal: idsTerminadas.has(c.id) }))
      } catch (e) {
        console.warn('No se pudieron cargar las causas terminadas según el portal:', e)
      }
      setCausas(data)
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

  // Causas que el bot NO puede cargar (fuera de su cola). Se pasa al panel de cobertura solo
  // como referencia: explica por qué el total de la barra es menor que la lista de la curadora.
  // La métrica de escaneo REAL (pendientes/ok/error) la lee el panel de v_cobertura, no de acá:
  // contar movimientos para decir "faltan causas" estaba mal — una causa puede estar escaneada
  // y sin movimientos nuevos, y las relevadas clavaban la barra sin llegar nunca al 100%.
  const fueraDelPortal = causas.filter(noCargablePorBot).length

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
  // Traslados al curador POR RESPONDER: lo más prioritario para Paula. Tienen su propia
  // tarjeta. Es un corte transversal (puede ser crítica o de atención). Una vez que la
  // curadora marca "Escrito enviado" deja de estar acá y pasa a ESPERANDO CIERRE abajo —
  // si no, el KPI seguiría contando trabajo que ya está hecho (cero mentiras).
  const traslados = causasActivas.filter(c => c.tiene_traslado_curador && !c.traslado_escrito_fecha)
  // Esperando cierre del tribunal: traslado ya respondido con escrito; quedan ~14 días de
  // plazo (criterio de Paula). Vencido el plazo la causa SE QUEDA acá con chip rojo —
  // no vuelve a Traslados: el trabajo de la curadora está hecho, lo que falta es del tribunal.
  const cierrePendiente = causasActivas.filter(c => !!c.traslado_escrito_fecha)
  // Seguimiento del NNA vencido: corte transversal (como Traslados) — una causa acá puede
  // ser de cualquier nivel de urgencia. Es el recordatorio de "ver al NNA" cada 180 días.
  const seguimientoVencido = causasActivas.filter(c => c.seguimiento_vencido)
  // Vinculantes: causas de protección (P) que en el Excel aparecieron atadas a una de
  // varios (X) en la misma celda. Corte transversal, como Traslados.
  const vinculantes = causasActivas.filter(c => xVinculadaPorP(c) !== null)

  // ACTIVAS POR VENCIMIENTO: el orden de trabajo que pidió la curadora. Primero las que ya
  // tienen la medida VENCIDA (tiene medida vigente pero sin fecha futura: se pasó), después
  // por la fecha más próxima entre medida y audiencia, y al final las sin fecha ninguna.
  const fechaVencimiento = (c: CausaResumen): number | null => {
    const fechas = [c.proxima_medida_vence, c.proxima_audiencia]
      .filter((f): f is string => !!f)
      .map(f => new Date(f).getTime())
      .filter(t => !Number.isNaN(t))
    return fechas.length ? Math.min(...fechas) : null
  }
  const medidaVencida = (c: CausaResumen): boolean => c.tiene_medida_vigente === true && !c.proxima_medida_vence
  const causasActivasPorVencimiento = [...causasActivas].sort((a, b) => {
    const ga = medidaVencida(a) ? 0 : fechaVencimiento(a) !== null ? 1 : 2
    const gb = medidaVencida(b) ? 0 : fechaVencimiento(b) !== null ? 1 : 2
    if (ga !== gb) return ga - gb
    if (ga === 1) {
      const d = (fechaVencimiento(a) as number) - (fechaVencimiento(b) as number)
      if (d !== 0) return d
    }
    const ua = a.nivel_urgencia ?? 10
    const ub = b.nivel_urgencia ?? 10
    if (ua !== ub) return ua - ub
    return a.id.localeCompare(b.id)
  })

  // AGENDA DE HOY: las tareas que exigen una acción, en un solo lugar y orden. Se calcula
  // sobre TODAS las activas (no sobre el filtro de texto): buscar una causa no debe cambiar
  // la agenda. Un grupo vacío no se muestra; una causa aparece UNA sola vez, en el grupo de
  // mayor prioridad (audiencia > traslado > seguimiento > crítica), con el botón "Ver todas"
  // que lleva al corte completo de ese grupo. Cero mentiras: el grupo "seguimiento" solo
  // contiene causas con datos reales del portal (seguimiento_vencido === true).
  const causasAgenda = causas.filter(c => !fueraDeMonitoreo(c))
  const agendaAudiencias = causasAgenda
    .filter(c => c.dias_para_audiencia != null && c.dias_para_audiencia <= 7)
    .sort((a, b) => (a.dias_para_audiencia ?? 0) - (b.dias_para_audiencia ?? 0))
  const agendaTraslados = causasAgenda
    .filter(c => c.tiene_traslado_curador && !c.traslado_escrito_fecha)
    .sort((a, b) => (a.nivel_urgencia ?? 10) - (b.nivel_urgencia ?? 10))
  const agendaSeguimiento = causasAgenda
    .filter(c => c.seguimiento_vencido === true)
    .sort((a, b) => (a.nivel_urgencia ?? 10) - (b.nivel_urgencia ?? 10))
  const agendaCriticas = causasAgenda
    .filter(c => (c.nivel_urgencia ?? 10) <= 2)
    .sort((a, b) => (a.dias_para_audiencia ?? 999) - (b.dias_para_audiencia ?? 999))
  // Dedupe preservando prioridad: cada id queda en el primer grupo donde aparece.
  const vistosEnAgenda = new Set<string>()
  const takeAgenda = (lista: CausaResumen[], max: number) => {
    const out: CausaResumen[] = []
    for (const c of lista) {
      if (out.length >= max) break
      if (!vistosEnAgenda.has(c.id)) { vistosEnAgenda.add(c.id); out.push(c) }
    }
    return out
  }
  const agenda = {
    audiencias: takeAgenda(agendaAudiencias, 7),
    traslados: takeAgenda(agendaTraslados, 3),
    seguimiento: takeAgenda(agendaSeguimiento, 3),
    criticas: takeAgenda(agendaCriticas, 3),
  }
  const agendaVacia =
    agendaAudiencias.length === 0 && agendaTraslados.length === 0 &&
    agendaSeguimiento.length === 0 && agendaCriticas.length === 0 &&
    !(faltanPortal && faltanPortal > 0)

  // Próximas audiencias: causas ACTIVAS con audiencia futura, ordenadas por fecha (la más
  // próxima primero). Base del calendario de audiencias. Se calcula sobre el filtro de texto.
  const proximasAudiencias = causasActivas
    .filter(c => c.proxima_audiencia != null)
    .sort((a, b) => new Date(a.proxima_audiencia!).getTime() - new Date(b.proxima_audiencia!).getTime())

  // Filtro rápido por urgencia (clic en tarjeta KPI). No afecta los contadores de arriba.
  const causasFiltradas =
    filtroUrgencia === 'activas' ? causasActivasPorVencimiento :
    filtroUrgencia === 'traslados' ? traslados :
    filtroUrgencia === 'cierre' ? cierrePendiente :
    filtroUrgencia === 'seguimiento' ? seguimientoVencido :
    filtroUrgencia === 'criticas' ? criticas :
    filtroUrgencia === 'atencion' ? atencion :
    filtroUrgencia === 'revisar' ? revisar :
    filtroUrgencia === 'estables' ? estables :
    filtroUrgencia === 'fuera' ? fueraMonitoreo :
    filtroUrgencia === 'vinculantes' ? vinculantes :
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

      {/* AGENDA DE HOY: la tarjeta de tarea única, arriba de todo lo demás. Cada línea abre
          la causa; cada grupo chico se puede expandir con su botón (activa el filtro ya
          existente, no duplica la lista). */}
      {!loading && (
        <AgendaHoy
          agenda={agenda}
          totales={{
            audiencias: agendaAudiencias.length,
            traslados: agendaTraslados.length,
            seguimiento: agendaSeguimiento.length,
            criticas: agendaCriticas.length,
          }}
          faltan={faltanPortal}
          vacia={agendaVacia}
          onVer={(tipo) => setFiltroUrgencia(filtroUrgencia === tipo ? 'todas' : tipo)}
        />
      )}

      {/* DISTINCIÓN DE PRIMER NIVEL (pedido de la curadora): Vigentes vs Terminadas.
          Todo lo demás (urgencias, traslados) es un sub-corte de las VIGENTES. Los dos
          botones grandes actúan como filtro maestro; abajo, los sub-filtros de urgencia. */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'activas' ? 'todas' : 'activas')}
          className={`rounded-xl p-4 border-2 text-left transition-colors ${
            filtroUrgencia === 'activas'
              ? 'border-green-500 bg-green-50'
              : 'border-slate-200 bg-white hover:border-green-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-green-500 shadow-sm"></span>
            <span className="text-sm font-semibold text-slate-700">Causas activas</span>
          </div>
          <div className="mt-1 text-3xl font-bold text-green-700 tabular-nums">{causasActivas.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">En monitoreo. Apretá para verlas por orden de vencimiento.</div>
        </button>
        <button
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'fuera' ? 'todas' : 'fuera')}
          className={`rounded-xl p-4 border-2 text-left transition-colors ${
            filtroUrgencia === 'fuera'
              ? 'border-slate-500 bg-slate-100'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-slate-400 shadow-sm"></span>
            <span className="text-sm font-semibold text-slate-700">Causas terminadas</span>
          </div>
          <div className="mt-1 text-3xl font-bold text-slate-600 tabular-nums">{fueraMonitoreo.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Rechazo, incompetencia, cese de medida o cerradas por vos.</div>
        </button>
      </div>

      {/* Sub-filtros de las causas VIGENTES por urgencia. "Traslados" y "Seguimiento" son
          cortes transversales (una causa puede caer en ellos con cualquier nivel). Todos
          operan solo sobre vigentes. */}
      {filtroUrgencia !== 'fuera' && (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          label="Traslados curador" value={traslados.length}
          active={filtroUrgencia === 'traslados'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'traslados' ? 'todas' : 'traslados')}
          tone="purple" Icono={IconShield}
        />
        <KpiCard
          label="Esperando cierre" value={cierrePendiente.length}
          active={filtroUrgencia === 'cierre'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'cierre' ? 'todas' : 'cierre')}
          tone="emerald" Icono={IconHourglass}
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
        <KpiCard
          label="Vinculantes" value={vinculantes.length}
          active={filtroUrgencia === 'vinculantes'}
          onClick={() => setFiltroUrgencia(filtroUrgencia === 'vinculantes' ? 'todas' : 'vinculantes')}
          tone="purple" Icono={IconLink}
        />
      </div>
      )}

      {/* COBERTURA DEL BOT — la métrica única ("¿están todas cargadas y al día?"). Va arriba
          del resultado del filtro para que nunca quede enterrada bajo la lista de causas.
          Lee v_cobertura/v_run_activo (cola real del bot), no movimientos. */}
      <CoberturaPanel fueraDeLaCola={fueraDelPortal} onRunTermino={loadCausas} onFaltanDelPortal={setFaltanPortal} />

      {/* Semáforo degradado: si ni la vista ni /api/ranking respondieron, TODO sale "Estable"
          y las urgencias de arriba NO son reales. Hay que decirlo, no dejarlo en silencio. */}
      {modoFallback && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <IconAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            El semáforo de urgencias no se pudo calcular, así que todas figuran como 'Estable'.
            Las causas igual están todas en pantalla; solo falta el color. Reintentá con
            Actualizar en un momento.
          </p>
        </div>
      )}

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
              onToggleEscrito={filtroUrgencia === 'traslados' || filtroUrgencia === 'cierre' ? toggleEscrito : undefined}
              onToggleMonitoreo={toggleMonitoreo}
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

      {/* Leyenda del semáforo (íconos formales ligados al color). Solo en la vista general:
          cuando Paula filtra por un KPI, el encabezado del resultado ya dice qué está viendo,
          así que la leyenda sería ruido. */}
      {filtroUrgencia === 'todas' && <LeyendaChips />}

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
          onToggleEscrito={toggleEscrito}
        />
      )}

      {cierrePendiente.length > 0 && filtroUrgencia === 'todas' && (
        <BloqueCausasColapsable
          titulo="Esperando cierre del tribunal"
          subtitulo={`escrito enviado; cierra en ~${DIAS_PLAZO_CIERRE} días`}
          causas={cierrePendiente}
          tono="violet"
          Icono={IconHourglass}
          onToggleEscrito={toggleEscrito}
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
                  {/* whitespace-pre-line: el mensaje puede traer el "Detalle técnico"
                      en una línea aparte (separado por \n\n). */}
                  <span className="whitespace-pre-line">{asesorIA.error}</span>
                </div>
              </div>
            )}

            {/* Resultado */}
            {!asesorIA.cargando && asesorIA.resultado && (
              <div className="space-y-4">
                {asesorIA.resultado.resumenCausa && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Resumen actual de la causa</div>
                    <p className="text-sm text-slate-700">{asesorIA.resultado.resumenCausa}</p>
                  </div>
                )}
                {asesorIA.resultado.resumenProgramas && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Qué dicen / piden los programas</div>
                    <p className="text-sm text-slate-700">{asesorIA.resultado.resumenProgramas}</p>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Estado de la protección</div>
                  <p className="text-sm text-slate-700">{asesorIA.resultado.resumen}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-violet-500 uppercase tracking-wide mb-1">Gestiones de curaduría sugeridas</div>
                  {asesorIA.resultado.acciones && asesorIA.resultado.acciones.length > 0 ? (
                    <ol className="text-sm text-slate-700 space-y-1 list-decimal list-inside">
                      {asesorIA.resultado.acciones.map((a, i) => <li key={i}>{a}</li>)}
                    </ol>
                  ) : (
                    <p className="text-sm text-slate-700">{asesorIA.resultado.proximoPaso}</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Alerta de cumplimiento / riesgo del NNA</div>
                  <p className="text-sm text-slate-700">{asesorIA.resultado.riesgo}</p>
                </div>
                {asesorIA.resultado.preguntasPrograma && asesorIA.resultado.preguntasPrograma.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Preguntas para el programa</div>
                    <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                      {asesorIA.resultado.preguntasPrograma.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
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
            <Section title="CRÍTICAS - Acción inmediata" causas={criticas} defaultOpen={false} dotColor="bg-red-500" onToggleMonitoreo={toggleMonitoreo} />
          )}
          {atencion.length > 0 && (
            <Section title="ATENCIÓN - Revisar esta semana" causas={atencion} defaultOpen={false} dotColor="bg-amber-400" onToggleMonitoreo={toggleMonitoreo} />
          )}
          {revisar.length > 0 && (
            <Section title="REVISAR - Seguimiento pendiente" causas={revisar} defaultOpen={false} dotColor="bg-orange-400" onToggleMonitoreo={toggleMonitoreo} />
          )}
          {estables.length > 0 && (
            <Section title="ESTABLES - Sin urgencia inmediata" causas={estables} defaultOpen={false} dotColor="bg-green-500" onToggleMonitoreo={toggleMonitoreo} />
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
  tone: 'neutral' | 'red' | 'amber' | 'orange' | 'green' | 'purple' | 'rose' | 'emerald'
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
    emerald: { dot: 'bg-emerald-500', num: 'text-emerald-700', ring: 'focus-visible:ring-emerald-400', activeBg: 'bg-emerald-50 border-emerald-400', icon: 'text-emerald-600' },
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

function Section({ title, causas, defaultOpen, dotColor, onToggleMonitoreo }: {
  title: string
  causas: CausaResumen[]
  defaultOpen: boolean
  dotColor: string
  onToggleMonitoreo?: (causaId: string, terminada: boolean) => void
}) {
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
            <CausaCard key={c.id} causa={c} onToggleMonitoreo={onToggleMonitoreo} />
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
  titulo, subtitulo, causas, tono, Icono, defaultOpen = true, onAsesorIA, onToggleMonitoreo, onToggleEscrito, maximo = 50,
}: {
  titulo: string
  subtitulo?: string
  causas: CausaResumen[]
  tono: TonoBloque
  Icono: IconoTipo
  defaultOpen?: boolean
  onAsesorIA?: (causaId: string, rit: string) => void
  onToggleMonitoreo?: (causaId: string, terminada: boolean) => void
  onToggleEscrito?: (causaId: string, enviado: boolean, gestionId?: string | null, rit?: string) => void
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
                    {(() => {
                      // En las filas de bloques (sin chips) el vínculo va como texto breve:
                      // "P-7664 ↔ X-3615" para ver el hermano sin abrir la causa.
                      const hermano = xVinculadaPorP(c) ?? pQueVinculaX(c)
                      return hermano ? (
                        <span className="text-[11px] font-mono text-violet-600">↔ {hermano}</span>
                      ) : null
                    })()}
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
                {/* Cuadradito "Escrito enviado" (traslados). Se muestra SIEMPRE que la causa
                    tenga traslado, incluso en bloques sin este callback (filtro "todas"), para
                    que el estado nunca quede invisible: sin callback solo no se puede tocar. */}
                {c.tiene_traslado_curador && (() => {
                  const enviado = !!c.traslado_escrito_fecha
                  const e = enviado ? estadoCierreTraslado(c.traslado_escrito_fecha as string) : null
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (!onToggleEscrito) return
                        const hoy = new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
                        const pregunta = enviado
                          ? `¿Deshacer "Escrito enviado" de ${c.rit}?\n\nVuelve a la lista de traslados pendientes y se quita el registro de la bitácora.`
                          : `¿Marcar que YA enviaste el escrito de ${c.rit}?\n\nQueda registrado con fecha ${hoy} en la bitácora de la causa y empieza el plazo de ${DIAS_PLAZO_CIERRE} días de cierre del tribunal.`
                        if (window.confirm(pregunta)) onToggleEscrito(c.id, !enviado, c.traslado_escrito_gestion_id ?? null, c.rit)
                      }}
                      className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                        enviado
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-emerald-50 hover:border-emerald-300'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${enviado ? 'bg-emerald-500 border-emerald-500' : 'border-slate-400 bg-white'}`}>
                        {enviado && <IconCheck className="w-2.5 h-2.5 text-white" />}
                      </span>
                      {enviado && e
                        ? `${textoCierreTraslado(e)} · enviado ${formatFechaDia(c.traslado_escrito_fecha as string)}`
                        : 'Escrito enviado'}
                    </button>
                  )
                })()}
                {/* Sacar/volver a monitoreo. Importa especialmente en el filtro "Fuera de
                    monitoreo": es desde donde la curadora reactiva una causa que cerró por
                    error. Acá el botón está FUERA del <Link>, así que no hace falta frenar
                    la navegación. */}
                {onToggleMonitoreo && (
                  <button
                    type="button"
                    onClick={() => {
                      const cerrada = estaTerminada(c.notas)
                      const pregunta = cerrada
                        ? `¿Volver a monitorear ${c.rit}?`
                        : `¿Sacar ${c.rit} de monitoreo?\n\nDejará de generar alertas y el bot no la va a revisar más. Podés revertirlo cuando quieras.`
                      if (window.confirm(pregunta)) onToggleMonitoreo(c.id, !cerrada)
                    }}
                    className="shrink-0 text-[11px] text-slate-500 hover:text-slate-900 underline decoration-dotted px-1 py-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  >
                    {estaTerminada(c.notas) ? 'Volver a monitorear' : 'Sacar de monitoreo'}
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

function CausaCard({ causa: c, onToggleMonitoreo }: {
  causa: CausaResumen
  /** Si se pasa, la tarjeta muestra el botón de sacar/volver a monitoreo. */
  onToggleMonitoreo?: (causaId: string, terminada: boolean) => void
}) {
  const terminada = estaTerminada(c.notas)
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
                  <span key={i} title={s.ayuda} className={`text-[11px] font-medium px-2 py-0.5 rounded-full cursor-help ${s.clase}`}>
                    {s.texto}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-slate-500 whitespace-nowrap shrink-0">
            {c.tiene_medida_vigente && !c.proxima_medida_vence && (
              <div className="font-bold text-red-600">Medida VENCIDA</div>
            )}
            {c.proxima_medida_vence && (
              <div>
                <div className="inline-flex items-center gap-1 font-medium text-slate-600">
                  <IconClock className="w-3.5 h-3.5 text-slate-400" />
                  Medida: {formatFechaCorta(c.proxima_medida_vence)}
                </div>
                <div className={`font-bold ${(c.dias_medida_vence ?? 99) <= 7 ? 'text-red-600' : 'text-slate-600'}`}>
                  Vence en {c.dias_medida_vence}d
                </div>
              </div>
            )}
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
        <div className="mt-2 flex items-end justify-between gap-3">
          {c.estado ? (
            <div className="text-xs text-slate-400 italic truncate">{c.estado}</div>
          ) : <div />}
          {/* Sacar de monitoreo / reactivar. Va DENTRO del <Link>, así que hay que frenar la
              navegación con preventDefault + stopPropagation, y se pide confirmación porque
              cambia si la causa genera alarmas. */}
          {onToggleMonitoreo && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const pregunta = terminada
                  ? `¿Volver a monitorear ${c.rit}?`
                  : `¿Sacar ${c.rit} de monitoreo?\n\nDejará de generar alertas y el bot no la va a revisar más. Podés revertirlo cuando quieras.`
                if (window.confirm(pregunta)) onToggleMonitoreo(c.id, !terminada)
              }}
              className="text-[11px] text-slate-500 hover:text-slate-900 underline decoration-dotted shrink-0 px-1 py-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              {terminada ? 'Volver a monitorear' : 'Sacar de monitoreo'}
            </button>
          )}
        </div>
      </div>
    </Link>
  )
}

// ============================================================
// AGENDA DE HOY — la tarjeta de tareas única del panel.
// Grupos en orden de prioridad; un grupo vacío no se dibuja. Cada fila: causa + plazo,
// clic para abrirla. Si el grupo tiene más causas que las mostradas, un botón activa el
// corte completo (reusa filtroUrgencia, no duplica datos).
// ============================================================
type AgendaTipo = 'traslados' | 'seguimiento' | 'criticas'

function AgendaHoy({
  agenda, totales, faltan, vacia, onVer,
}: {
  agenda: { audiencias: CausaResumen[]; traslados: CausaResumen[]; seguimiento: CausaResumen[]; criticas: CausaResumen[] }
  totales: { audiencias: number; traslados: number; seguimiento: number; criticas: number }
  // null = no se puede afirmar todavía (falta inventario del portal): NO se muestra fila.
  faltan: number | null
  vacia: boolean
  onVer: (tipo: AgendaTipo) => void
}) {
  const linea = (c: CausaResumen, textoDerecha: ReactNode, derechaClase = 'text-slate-600') => (
    <li key={c.id}>
      <Link
        href={`/causa/${c.id}`}
        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-xs font-semibold text-slate-700 shrink-0">{c.rit}</span>
          <span className="text-xs text-slate-500 truncate">{c.caratulado || c.nombres_nna || ''}</span>
        </span>
        <span className={`text-xs font-medium shrink-0 text-right ${derechaClase}`}>{textoDerecha}</span>
      </Link>
    </li>
  )

  const grupo = (
    Icono: IconoTipo,
    titulo: string,
    lista: CausaResumen[],
    total: number,
    tipo: AgendaTipo,
    plazo: (c: CausaResumen) => [ReactNode, string],
  ) => lista.length === 0 ? null : (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Icono className="w-3.5 h-3.5" /> {titulo}
        </p>
        {total > lista.length && (
          <button
            onClick={() => onVer(tipo)}
            className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline decoration-dotted focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
          >
            Ver las {total}
          </button>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {lista.map((c) => {
          const [texto, clase] = plazo(c)
          return linea(c, texto, clase)
        })}
      </ul>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <IconCalendar className="w-4 h-4 text-slate-400" />
        Tu agenda de hoy
      </p>

      {vacia ? (
        <p className="mt-2 text-sm text-slate-600">
          Hoy no hay nada urgente: ninguna audiencia esta semana, ningún traslado pendiente y
          ninguna causa crítica. El detalle del escaneo sigue más abajo.
        </p>
      ) : (
        <>
          {/* 1. Audiencias esta semana: se muestran todas (≤7 suelen ser pocas) */}
          {agenda.audiencias.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <IconClock className="w-3.5 h-3.5" /> Audiencias esta semana
              </p>
              <ul className="mt-1 space-y-0.5">
                {agenda.audiencias.map((c) => linea(
                  c,
                  <>
                    {formatFechaCorta(c.proxima_audiencia)}
                    <span className={`ml-2 font-bold ${c.dias_para_audiencia! <= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                      {etiquetaAudiencia(c.dias_para_audiencia)}
                    </span>
                  </>,
                ))}
              </ul>
            </div>
          )}

          {/* 2. Traslados al curador (piden pronunciamiento) */}
          {grupo(IconShield, 'Traslados al curador', agenda.traslados, totales.traslados, 'traslados',
            () => ['Requiere tu pronunciamiento', 'text-violet-700'])}

          {/* 3. Seguimiento del NNA vencido — solo causas CON datos del portal */}
          {grupo(IconUsers, 'Ver al NNA (seguimiento vencido)', agenda.seguimiento, totales.seguimiento, 'seguimiento',
            () => ['+180 días sin entrevista', 'text-rose-700'])}

          {/* 4. Críticas sin causa anterior más específica */}
          {grupo(IconAlert, 'Acción inmediata', agenda.criticas, totales.criticas, 'criticas',
            (c) => [c.dias_para_audiencia != null ? etiquetaAudiencia(c.dias_para_audiencia) : 'Revisar hoy', 'text-red-600'])}

          {/* 5. Causas que el portal muestra y la base no (la única que el Dashboard no sabe sola) */}
          {faltan != null && faltan > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="text-xs text-amber-800 flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <IconInbox className="w-3.5 h-3.5" />
                  Faltan {faltan} {faltan === 1 ? 'causa' : 'causas'} que el portal te asignó
                </span>
                <Link
                  href="/asignaciones"
                  className="text-[11px] font-medium underline decoration-dotted hover:text-amber-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded"
                >
                  Pegar correos de asignación →
                </Link>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
