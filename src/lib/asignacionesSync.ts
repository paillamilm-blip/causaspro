// ============================================================
// CAUSASPRO - Guardado de asignaciones en Supabase
// Crea las causas nuevas y agenda las audiencias de la tabla del correo
// ------------------------------------------------------------
// Vive en src/lib/ por el mismo motivo que asignacionesParser.ts: importar `src/email/`
// desde una ruta de Next rompe el build en Vercel (ese módulo es un CLI que arrastra
// imapflow). El CLI de correo lo sigue usando importándolo desde acá.
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
  emailMeta: { email_id: string; fecha: string; remitente: string }
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
  }
  
  for (const asig of asignaciones) {
    try {
      // 1. Verificar si la causa ya existe (por RIT)
      // Traemos `notas` para poder AGREGAR sin borrar las marcas del bot (ver agregarNota).
      const { data: existing } = await sb
        .from('causas')
        .select('id, notas')
        .eq('rit', asig.rit)
        .limit(1)
      
      let causaId: string
      
      if (existing && existing.length > 0) {
        // Causa ya existe → solo agregar audiencia
        causaId = existing[0].id
        result.causas_existentes++
        console.log(`  📌 ${asig.rit} ya existe → actualizar`)
        
        // Actualizar updated_at y AGREGAR la nota de reasignación conservando lo anterior.
        // Si la nota ya estaba (mismo correo pegado dos veces), no se reescribe `notas`.
        const linea = `${MARCA_ASIGNACION} reasignada por email del ${emailMeta.fecha}${asig.curador ? `. Curador: ${asig.curador}` : ''}`
        const nuevasNotas = agregarNota((existing[0] as any).notas ?? null, linea)
        await sb
          .from('causas')
          .update({
            updated_at: new Date().toISOString(),
            ...(nuevasNotas !== null ? { notas: nuevasNotas } : {}),
          })
          .eq('id', causaId)
        
      } else {
        // Causa nueva → crear
        const { data: newCausa, error: createErr } = await sb
          .from('causas')
          .insert({
            rit: asig.rit,
            tipo: inferirTipoDesdeRit(asig.rit),
            estado: 'Asignada por email',
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
      
      // 2. Crear audiencia si hay fecha
      if (asig.fecha_audiencia) {
        // Verificar que no exista ya una audiencia con esa fecha
        const { data: existingAud } = await sb
          .from('audiencias')
          .select('id')
          .eq('causa_id', causaId)
          .eq('fecha', asig.fecha_audiencia)
          .limit(1)
        
        if (!existingAud || existingAud.length === 0) {
          const { error: audErr } = await sb
            .from('audiencias')
            .insert({
              causa_id: causaId,
              fecha: asig.fecha_audiencia,
              tipo: 'Audiencia (asignada por email)',
              notas: `Curador: ${asig.curador}. Fuente: email ${emailMeta.fecha}`,
            })
          
          if (audErr) {
            result.errores.push(`Error creando audiencia para ${asig.rit}: ${audErr.message}`)
          } else {
            result.audiencias_creadas++
            console.log(`  📅 Audiencia ${asig.fecha_audiencia} creada para ${asig.rit}`)
          }
        } else {
          console.log(`  ℹ️ Audiencia ${asig.fecha_audiencia} ya existía para ${asig.rit}`)
        }
      }
      
    } catch (error: any) {
      result.errores.push(`${asig.rit}: ${error.message}`)
      console.error(`  ❌ Error procesando ${asig.rit}: ${error.message}`)
    }
  }
  
  // 3. Guardar log del procesamiento
  await saveEmailLog(sb, result)
  
  return result
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
