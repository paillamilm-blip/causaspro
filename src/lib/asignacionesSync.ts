// ============================================================
// CAUSASPRO - Guardado de asignaciones en Supabase
// Crea las causas nuevas y agenda las audiencias de la tabla del correo
// ------------------------------------------------------------
// Vive en src/lib/ por el mismo motivo que asignacionesParser.ts: cuando vivió junto al
// interceptor de correo (un CLI que arrastraba imapflow) importarlo desde una ruta de Next
// rompía el build en Vercel. El interceptor quedó dado de baja; la ubicación se mantiene.
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Asignacion } from './asignacionesParser'
// Lista blanca de letras de RIT del lado WEB. Ojo: NO se importa `inferirTipoRIT` de
// `src/bot/utils` a propósito — el bot y la web están deliberadamente separados (ver la
// nota de "espejado" en materiasFamilia.ts) y ningún archivo de la web importa de src/bot/.
import { LETRAS_VALIDAS } from './materiasFamilia'

/** Resultado de procesar una tanda de asignaciones. */
export interface ResultadoSync {
  email_id: string
  fecha_email: string
  remitente: string
  asignaciones: Asignacion[]
  causas_nuevas: number
  causas_existentes: number
  audiencias_creadas: number
  errores: string[]
  /** Tokens que el parser reconoció como "parece RIT" pero rechazó (se muestran a la usuaria). */
  descartes?: string[]
}

/** Deriva (rol, anio) desde un RIT ya limpio: "P-8141-2026" | "8141-2026" → {8141, 2026}. */
function partirRit(rit: string): { rol: number | null; anio: number | null } {
  const m = rit.match(/^(?:[A-Z]{1,3}-)?(\d{1,6})-(\d{4})$/)
  if (!m) return { rol: null, anio: null }
  return { rol: parseInt(m[1]), anio: parseInt(m[2]) }
}

/**
 * Deriva el `tipo` (letra) desde el RIT, validando contra la lista blanca del CHECK de la
 * tabla `causas`. Devuelve null si la letra no es válida, para no romper el insert.
 */
function inferirTipoDesdeRit(rit: string): string | null {
  const m = rit.trim().match(/^([A-Z]{1,3})-\d+-\d{4}$/i)
  if (!m) return null
  const letra = m[1].toUpperCase()
  return LETRAS_VALIDAS.includes(letra) ? letra : null
}

let supabase: SupabaseClient | null = null

/** Marca de las notas que deja este módulo, para poder reconocer su rastro después. */
const MARCA_ASIGNACION = '[ASIGNACIÓN]'

/**
 * Agrega una línea a `notas` SIN DESTRUIR lo que ya había.
 *
 * CRÍTICO: el campo `notas` es un canal compartido. El bot guarda ahí marcas de las que
 * depende su funcionamiento: `[NO EN PORTAL]` y `[REVISAR: no scrapeada]` (que
 * getCausasToScrape usa para NO reintentar causas que no existen en el portal),
 * `[INTENTOS FALLIDOS: n]` (el contador de reintentos), y `[VÍNCULO]` / `[REVISAR LETRA]`
 * (el enlace entre causas hermanas P↔X). El Dashboard también lee `[NO EN PORTAL]` para
 * la barra de progreso.
 *
 * Antes este módulo hacía `update({ notas: 'Reasignada por email...' })`, lo que BORRABA
 * todas esas marcas: las 128 causas confirmadas como "no en portal" volvían a la cola del
 * bot, se perdían los vínculos entre hermanas y se reseteaba el contador de intentos.
 *
 * Devuelve `null` si la línea ya estaba (así el llamador no escribe de más y pegar el
 * mismo correo dos veces no duplica notas).
 */
function agregarNota(notasActuales: string | null, linea: string): string | null {
  const actual = (notasActuales || '').trim()
  if (actual.includes(linea)) return null // idempotente: ya está, no tocar
  return actual ? `${actual}\n${linea}` : linea
}

function getSupabase(): SupabaseClient {
  if (supabase) return supabase
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridas')
  }
  
  supabase = createClient(url, key)
  return supabase
}

/**
 * Procesa las asignaciones extraídas de un email:
 * - Si la causa (RIT) ya existe → agrega audiencia
 * - Si la causa NO existe → crea causa + audiencia
 */
export async function syncAsignaciones(
  asignaciones: Asignacion[],
  emailMeta: { email_id: string; fecha: string; remitente: string },
  opts?: { descartes?: string[] }
): Promise<ResultadoSync> {
  const sb = getSupabase()
  
  const result: ResultadoSync = {
    email_id: emailMeta.email_id,
    fecha_email: emailMeta.fecha,
    remitente: emailMeta.remitente,
    asignaciones,
    causas_nuevas: 0,
    causas_existentes: 0,
    audiencias_creadas: 0,
    errores: [],
    descartes: opts?.descartes ?? [],
  }
  
  for (const asig of asignaciones) {
    try {
      // 1. Verificar si la causa ya existe. Primero por RIT exacto; si no, por (rol, anio),
      //    que atrapa el caso "8141-2026" pegado sin letra cuando la BD tiene "P-8141-2026"
      //    (y viceversa). Sin esto, cada pegado sin letra creaba una causa huérfana duplicada.
      const { rol, anio } = partirRit(asig.rit)
      const { data: byRit } = await sb
        .from('causas')
        .select('id, notas, rit, escaneo_estado')
        .eq('rit', asig.rit)
        .limit(1)

      let existente = byRit && byRit.length > 0 ? byRit[0] : null
      if (!existente && rol != null && anio != null) {
        const { data: byRolAnio } = await sb
          .from('causas')
          .select('id, notas, rit, escaneo_estado')
          .eq('rol', rol)
          .eq('anio', anio)
          .limit(2)
        // Solo se vincula si hay EXACTAMENTE una causa con ese (rol, anio); con 2+
        // (hermanas P↔X) no se puede saber cuál es sin letra y se trata como nueva.
        if (byRolAnio && byRolAnio.length === 1) existente = byRolAnio[0]
      }
      
      let causaId: string
      
      if (existente) {
        // Causa ya existe → solo agregar audiencia
        causaId = existente.id
        result.causas_existentes++
        console.log(`  📌 ${asig.rit} ya existe (${existente.rit}) → actualizar`)
        
        // Actualizar updated_at y AGREGAR la nota de reasignación conservando lo anterior.
        // Si la nota ya estaba (mismo correo pegado dos veces), no se reescribe `notas`.
        const linea = `${MARCA_ASIGNACION} reasignada por email del ${emailMeta.fecha}${asig.curador ? `. Curador: ${asig.curador}` : ''}`
        const nuevasNotas = agregarNota((existente as any).notas ?? null, linea)
        await sb
          .from('causas')
          .update({
            updated_at: new Date().toISOString(),
            ...(nuevasNotas !== null ? { notas: nuevasNotas } : {}),
            // Una causa dada de baja ([NO EN PORTAL]/descatalogada) que vuelve a ser
            // asignada debe re-entrar a la cola del bot.
            ...(((existente as any).escaneo_estado === 'descatalogada')
              ? { escaneo_estado: 'pendiente' }
              : {}),
          })
          .eq('id', causaId)
        
      } else {
        // Causa nueva → crear. escaneo_estado queda 'pendiente' por DEFAULT de la BD
        // (post schema-001-cobertura): entra sola a la cola del bot, sin pasos manuales.
        const { data: newCausa, error: createErr } = await sb
          .from('causas')
          .insert({
            rit: asig.rit,
            rol,
            anio,
            tipo: inferirTipoDesdeRit(asig.rit),
            estado: 'Asignada por email',
            origen: 'asignada',
            fecha_notificacion: asig.fecha_ingreso || new Date().toISOString().split('T')[0],
            // Causa nueva: no hay notas previas que conservar, así que se escribe directo.
            notas: `${MARCA_ASIGNACION} asignada por ${emailMeta.remitente} el ${emailMeta.fecha}${asig.curador ? `. Curador: ${asig.curador}` : ''}`,
          })
          .select('id')
          .single()
        
        if (createErr) {
          result.errores.push(`Error creando ${asig.rit}: ${createErr.message}`)
          console.error(`  ❌ Error creando ${asig.rit}: ${createErr.message}`)
          continue
        }
        
        causaId = newCausa.id
        result.causas_nuevas++
        console.log(`  ✅ ${asig.rit} NUEVA causa creada`)
      }
      
      // 2. Crear audiencia si hay fecha. Idempotente vía upsert sobre el índice único
      //    (causa_id, uniq_clave) agregado por schema-001-cobertura.sql: pegar el mismo
      //    correo dos veces no duplica la audiencia aunque cambie el formato de la fecha.
      if (asig.fecha_audiencia) {
        const { error: audErr } = await sb
          .from('audiencias')
          .upsert(
            {
              causa_id: causaId,
              fecha: asig.fecha_audiencia,
              tipo: 'Audiencia (asignada por email)',
              notas: `Curador: ${asig.curador}. Fuente: email ${emailMeta.fecha}`,
            },
            { onConflict: 'causa_id,uniq_clave' }
          )
          .select('id')

        if (audErr) {
          result.errores.push(`Error creando audiencia para ${asig.rit}: ${audErr.message}`)
        } else {
          result.audiencias_creadas++
          console.log(`  📅 Audiencia ${asig.fecha_audiencia} asegurada para ${asig.rit}`)
        }
      }
      
    } catch (error: any) {
      result.errores.push(`${asig.rit}: ${error.message}`)
      console.error(`  ❌ Error procesando ${asig.rit}: ${error.message}`)
    }
  }
  
  // 3. Guardar log del procesamiento (email_logs) + baseline cuantitativo (carga_lotes).
  await saveEmailLog(sb, result)
  await saveCargaLote(sb, result)
  
  return result
}

/**
 * Baseline de cada pegado: cuántas filas venían, cuántas eran nuevas/existentes y qué
 * tokens NO se reconocieron. Es el registro que permite responder "¿está todo cargado?"
 * sin depender de la memoria de nadie. No rompe si la tabla aún no existe (migración pendiente).
 */
async function saveCargaLote(sb: SupabaseClient, result: ResultadoSync): Promise<void> {
  try {
    await sb.from('carga_lotes').insert({
      origen: 'pegado',
      descripcion: result.remitente,
      filas_totales: result.asignaciones.length + (result.descartes?.length ?? 0),
      nuevos: result.causas_nuevas,
      existentes: result.causas_existentes,
      no_reconocidos: result.descartes && result.descartes.length > 0 ? result.descartes : null,
    })
  } catch {
    // silencioso a propósito: el registro no puede bloquear la carga real
  }
}

/**
 * Guarda log del procesamiento de email
 */
async function saveEmailLog(sb: SupabaseClient, result: ResultadoSync): Promise<void> {
  try {
    await sb.from('email_logs').insert({
      email_id: result.email_id,
      fecha_email: result.fecha_email,
      remitente: result.remitente,
      asignaciones_total: result.asignaciones.length,
      causas_nuevas: result.causas_nuevas,
      causas_existentes: result.causas_existentes,
      audiencias_creadas: result.audiencias_creadas,
      errores: result.errores.length > 0 ? result.errores : null,
      rits: result.asignaciones.map(a => a.rit),
    })
  } catch {
    // No fallar si la tabla no existe aún
  }
}
