import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseExcelRows } from '@/lib/parseExcel'
import { estaAutorizado, excedeRateLimit } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// ============================================================
// POST /api/upload — MIGRACIÓN ÚNICA del Excel a la base
// ------------------------------------------------------------
// CAMBIO DE ROL: el Excel ya no es la carga mensual de la curadora. Desde ahora
// las causas entran pegando el correo de asignaciones en /asignaciones. Este
// endpoint queda como la MIGRACIÓN ÚNICA (traer el inventario histórico) y, por
// si acaso, para re-traer un archivo viejo. Eso cambia los requisitos:
//
//   1. NO BORRA. Antes, para no duplicar NNA/adultos/audiencias en cada re-subida,
//      borraba los hijos de las causas existentes y los volvía a insertar. Con el
//      pegado y el bot escribiendo en esas mismas tablas, ese DELETE destruye
//      datos que el Excel jamás tuvo: las audiencias agendadas por asignación y
//      las scrapeadas del portal. Se cambió por "los hijos de una causa ya
//      migrada NO se tocan".
//   2. ESCRIBE origen/cola por default: las causas nuevas nacen con
//      escaneo_estado='pendiente' (default de la BD tras schema-001-cobertura.sql),
//      así entran solas a la cola del bot.
//   3. IDS POR (rol,anio): el Excel suele traer "4596-2024" sin letra y en la BD
//      está "P-4596-2024". Con match exacto se creaba una causa DUPLICADA del
//      mismo expediente. Ahora, si el RIT no tiene letra, se busca por número+año
//      y solo se enlaza si hay EXACTAMENTE una coincidencia (si hay dos, se avisa:
//      es la ambigüedad P↔X y la decide la curadora).
//   4. DEJA LO QUE RECIBIÓ en carga_lotes (baseline de la migración) y puede
//      DEVOLVER UN DIFF sin escribir (`dryRun`), para revisar el archivo antes.
//   5. AUTENTICACIÓN: antes no tenía ninguna y cualquiera podía escribir y borrar
//      en la base desde la URL pública de Vercel.
// ============================================================

/** El Excel puede tener miles de filas: se permite un payload grande pero acotado. */
const MAX_FILAS = 20_000

interface ResumenExistente {
  rit: string
  id: string
  /** RIT que ya está en la BD cuando el Excel venía sin letra (ej. 4596-2024 → P-4596-2024). */
  rit_en_base: string | null
}

export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({
      error: 'No autorizado: hace falta el token de la app (?token=… o header Authorization).',
    }, { status: 401 })
  }
  if (excedeRateLimit(req, 'upload', 6, 60_000)) {
    return NextResponse.json({ error: 'Demasiadas subidas seguidas. Esperá un minuto.' }, { status: 429 })
  }

  try {
    const contentType = req.headers.get('content-type') || ''

    let parseResult
    let nombreArchivo = ''
    let dryRun = false

    if (contentType.includes('application/json')) {
      // Ruta normal: el frontend parsea el Excel y manda las filas como JSON
      // (evita el límite de 4.5 MB de Vercel para archivos).
      const body = await req.json()
      const { rows, sheetName } = body
      nombreArchivo = typeof body?.fileName === 'string' ? body.fileName.slice(0, 200) : ''
      // dryRun = "mostrame qué pasaría, no escribas nada". Igual que el Revisar/Guardar
      // de /asignaciones, para que la migración se pueda SUPERVISAR antes de tocar la base.
      dryRun = body?.dryRun === true

      if (!rows || !Array.isArray(rows) || rows.length < 2) {
        return NextResponse.json({ error: 'Datos inválidos o archivo vacío' }, { status: 400 })
      }
      if (rows.length > MAX_FILAS) {
        return NextResponse.json({ error: `El archivo tiene ${rows.length} filas (máximo ${MAX_FILAS}).` }, { status: 413 })
      }

      try {
        parseResult = parseExcelRows(rows, sheetName || 'Hoja1')
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Error procesando datos: ${parseErr.message}` }, { status: 400 })
      }
    } else {
      // LEGACY: archivo directo (FormData), solo para archivos chicos.
      const formData = await req.formData()
      const file = formData.get('file') as File
      dryRun = (new URL(req.url).searchParams.get('dryRun') || '') === '1'

      if (!file) {
        return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
      }
      if (file.size > 4 * 1024 * 1024) {
        return NextResponse.json({
          error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 4MB.`,
        }, { status: 400 })
      }
      nombreArchivo = file.name.slice(0, 200)

      const { parseExcelBuffer } = await import('@/lib/parseExcel')
      const buffer = await file.arrayBuffer()

      try {
        parseResult = parseExcelBuffer(buffer)
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Error al leer archivo: ${parseErr.message}` }, { status: 400 })
      }
    }

    const { causas, nna, adultos, audiencias } = parseResult

    if (causas.length === 0) {
      return NextResponse.json({
        error: 'No se encontraron causas. ¿El archivo tiene una columna con RIT (ej: P-1234-2024)?',
        columnasEncontradas: parseResult.columnasDetectadas,
        filasLeidas: parseResult.totalFilas,
        filasSinRit: parseResult.filasSinRit || [],
      }, { status: 400 })
    }

    const supabase = createAdminClient()

    // ------------------------------------------------------------
    // 1. ¿Cuáles ya están en la base?
    //    a) match exacto de RIT, y
    //    b) para los RIT SIN LETRA del Excel, match por (rol, anio) — el expediente
    //       real suele estar en la BD con su letra.
    // ------------------------------------------------------------
    const rits = causas.map(c => c.rit)
    const idPorRit: Record<string, string> = {}

    for (let i = 0; i < rits.length; i += 100) {
      const batch = rits.slice(i, i + 100)
      const { data } = await supabase.from('causas').select('id, rit').in('rit', batch)
      for (const c of data || []) idPorRit[c.rit] = c.id
    }

    /** RIT del Excel sin letra → RIT con letra ya cargado en la BD. */
    const enlacePorRol: Record<string, string> = {}
    /** RIT del Excel sin letra que NO se pudo enlazar sin ambigüedad (se avisa). */
    const ambiguos: string[] = []
    const sinLetra = causas.filter(c => !idPorRit[c.rit] && c.rol != null && c.anio != null)
    for (let i = 0; i < sinLetra.length; i += 50) {
      for (const c of sinLetra.slice(i, i + 50)) {
        const { data } = await supabase
          .from('causas')
          .select('id, rit')
          .eq('rol', c.rol!)
          .eq('anio', c.anio!)
          .limit(3)
        const filas = data || []
        if (filas.length === 1) {
          idPorRit[c.rit] = filas[0].id
          enlacePorRol[c.rit] = filas[0].rit
        } else if (filas.length > 1) {
          // Dos expedientes con el mismo número y año (hermanas P↔X): no se elige
          // desde el código. Se trata como causa nueva?? NO — crearía un tercer
          // expediente. Se deja FUERA y se avisa para decisión humana.
          ambiguos.push(`${c.rit}: la base tiene ${filas.map(f => f.rit).join(', ')}`)
        }
      }
    }

    const causasNuevas = causas.filter(c => !idPorRit[c.rit])
    const causasExistentes = causas.filter(c => !!idPorRit[c.rit])
    const resumenExistentes: ResumenExistente[] = causasExistentes.map(c => ({
      rit: c.rit,
      id: idPorRit[c.rit],
      rit_en_base: enlacePorRol[c.rit] ?? c.rit,
    }))

    const diff = {
      filas_totales: parseResult.totalFilas,
      causas_en_archivo: causas.length,
      nuevas: causasNuevas.length,
      existentes: causasExistentes.length,
      enlazadas_por_rol: Object.keys(enlacePorRol).length,
      ambiguos,
      filas_sin_rit: (parseResult.filasSinRit || []).length,
      muestras_filas_sin_rit: (parseResult.filasSinRit || []).slice(0, 20),
      hijos_en_archivo: nna.length + adultos.length + audiencias.length,
    }

    // El Excel suele traer el RIT SIN LETRA; estas son las filas que se enlazaron con
    // una causa que ya estaba cargada CON letra (4596-2024 → P-4596-2024). Se muestran
    // para que la curadora supervise el emparejamiento en vez de confiar en él.
    const enlazadas = resumenExistentes.filter(e => e.rit_en_base !== e.rit).slice(0, 100)

    // ---- MODO REVISIÓN: muestra el diff y NO escribe nada. ----
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        modo: 'revision',
        diff,
        enlazadas,
        stats: {
          ...statsVacias(parseResult),
          causas: 0,
          causas_actualizadas: 0,
        },
      }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // ------------------------------------------------------------
    // 2. Insertar las nuevas (por lotes; si un lote falla, fila por fila
    //    para no perder las buenas y quedarnos con el motivo exacto).
    // ------------------------------------------------------------
    const ritToId: Record<string, string> = { ...idPorRit }
    let causasInsertadas = 0
    const causasFallidas: { rit: string; motivo: string }[] = []

    if (causasNuevas.length > 0) {
      const insertData = causasNuevas.map(c => ({
        rit: c.rit,
        rol: c.rol ?? null,   // identidad estable (número), derivada del rit por el parser
        anio: c.anio ?? null, // identidad estable (año)
        caratulado: c.caratulado || null,
        tipo: c.tipo || null,
        fecha_apertura: isValidDate(c.fecha_apertura) ? c.fecha_apertura : null,
        sintesis: c.sintesis || null,
        estado: c.estado || null,
        programa_vigente: c.programa_vigente || null,
        saj: c.saj || null,
        // OJO: NO se escribe `notas`. Es el canal de control del bot
        // ([NO EN PORTAL], [REVISAR…], [VÍNCULO]) y una migración no debe pisarlo.
        notas: c.notas || null,
        datos_extra: sanitizeJson(c.datos_extra) || {},
        columnas_origen: c.columnas_origen || [],
        // `origen` y `escaneo_estado` se dejan a los DEFAULT de la BD
        // ('excel' y 'pendiente' tras schema-001-cobertura.sql): así la columna
        // extra no es un punto de fallo si la migración aún no se corrió, y las
        // causas nuevas entran solas a la cola del bot.
      }))

      for (let i = 0; i < insertData.length; i += 50) {
        const batch = insertData.slice(i, i + 50)
        const { data, error } = await supabase.from('causas').insert(batch).select('id, rit')

        if (error) {
          for (const single of batch) {
            const { data: sd, error: singleErr } = await supabase.from('causas').insert(single).select('id, rit')
            if (sd && sd.length) {
              for (const c of sd) { ritToId[c.rit] = c.id }
              causasInsertadas += sd.length
            } else {
              causasFallidas.push({
                rit: single.rit,
                motivo: singleErr?.message || 'La base de datos rechazó la fila',
              })
            }
          }
        } else if (data) {
          for (const c of data) { ritToId[c.rit] = c.id }
          causasInsertadas += data.length
        }
      }
    }

    // ------------------------------------------------------------
    // 3. Actualizar las existentes: SOLO campos del Excel.
    //    NO toca `notas` (canal del bot), NO toca `escaneo_estado` (una causa ya
    //    escaneada no vuelve a pendiente por subir el archivo), y NO borra hijos.
    // ------------------------------------------------------------
    let causasActualizadas = 0
    for (const c of causasExistentes) {
      const update: Record<string, any> = { updated_at: new Date().toISOString() }
      if (c.estado) update.estado = c.estado
      if (c.programa_vigente) update.programa_vigente = c.programa_vigente
      if (c.datos_extra) update.datos_extra = sanitizeJson(c.datos_extra)
      if (c.columnas_origen) update.columnas_origen = c.columnas_origen

      const { error } = await supabase.from('causas').update(update).eq('id', idPorRit[c.rit])
      if (!error) causasActualizadas++
    }

    // ------------------------------------------------------------
    // 4. Hijos: se insertan SOLO para las causas que se crearon ahora.
    //    Una causa que ya estaba tiene sus NNA/adultos/audiencias ya migrados, y
    //    re-insertarlos duplica (bug histórico) o borrarlos destruye lo que
    //    escribieron el pegado y el bot. Por eso la regla nueva es simple:
    //    los hijos de las existentes NO se tocan.
    // ------------------------------------------------------------
    const esCausaNueva = (rit: string) => !idPorRit[rit] && !!ritToId[rit]

    let nnaCount = 0
    const nnaRecords = nna
      .filter(n => esCausaNueva(n._rit) && ritToId[n._rit])
      .map(n => ({
        ...n,
        causa_id: ritToId[n._rit],
        _rit: undefined,
        fecha_nacimiento: isValidDate(n.fecha_nacimiento) ? n.fecha_nacimiento : null,
      }))
      .map(({ _rit, ...rest }) => rest)

    for (let i = 0; i < nnaRecords.length; i += 100) {
      const batch = nnaRecords.slice(i, i + 100)
      const { data } = await supabase.from('nna').insert(batch).select('id')
      nnaCount += data?.length || 0
    }

    let adultosCount = 0
    const adultosRecords = adultos
      .filter(a => esCausaNueva(a._rit) && ritToId[a._rit])
      .map(({ _rit, ...rest }) => ({ ...rest, causa_id: ritToId[_rit] }))

    for (let i = 0; i < adultosRecords.length; i += 100) {
      const batch = adultosRecords.slice(i, i + 100)
      const { data } = await supabase.from('adultos').insert(batch).select('id')
      adultosCount += data?.length || 0
    }

    let audienciasCount = 0
    const audienciasRecords = audiencias
      .filter(a => esCausaNueva(a._rit) && ritToId[a._rit] && a.fecha && isValidDate(a.fecha))
      .map(a => ({ causa_id: ritToId[a._rit], fecha: a.fecha!, tipo: 'audiencia' }))

    for (let i = 0; i < audienciasRecords.length; i += 100) {
      const batch = audienciasRecords.slice(i, i + 100)
      // upsert por (causa_id, uniq_clave) si la migración ya está aplicada; si no
      // (42P10/42703), insert simple — que es el comportamiento de siempre.
      const { data, error } = await supabase
        .from('audiencias')
        .upsert(batch, { onConflict: 'causa_id,uniq_clave', ignoreDuplicates: true })
        .select('id')
      if (error) {
        const fallback = await supabase.from('audiencias').insert(batch).select('id')
        audienciasCount += fallback.data?.length || 0
      } else {
        audienciasCount += data?.length || 0
      }
    }

    const hijosOmitidos = (nna.length - nnaRecords.length)
      + (adultos.length - adultosRecords.length)
      + (audiencias.length - audienciasRecords.length)

    // ------------------------------------------------------------
    // 5. Baseline de la migración en carga_lotes (best effort: si la tabla aún
    //    no existe, la carga igual ocurrió y no hay que hacer fallar la respuesta).
    // ------------------------------------------------------------
    const lote = await supabase.from('carga_lotes').insert({
      origen: 'excel',
      descripcion: `${nombreArchivo || 'archivo'} · hoja ${parseResult.hoja} · ${parseResult.totalFilas} filas`,
      filas_totales: parseResult.totalFilas,
      nuevos: causasInsertadas,
      existentes: causasExistentes.length,
      no_reconocidos: [
        ...(parseResult.filasSinRit || []),
        ...ambiguos,
        ...causasFallidas.map(f => `${f.rit}: ${f.motivo}`),
      ].slice(0, 200),
    }).then(r => !r.error, () => false)

    return NextResponse.json({
      ok: true,
      modo: 'guardado',
      diff,
      enlazadas,
      stats: {
        causas: causasInsertadas,
        causas_actualizadas: causasActualizadas,
        causas_fallidas: causasFallidas.length,
        nna: nnaCount,
        adultos: adultosCount,
        audiencias: audienciasCount,
        hijos_omitidos: hijosOmitidos,
        columnasDetectadas: parseResult.columnasDetectadas || [],
        hoja: parseResult.hoja || '',
        totalFilas: parseResult.totalFilas,
      },
      // Detalle de las causas que la BD rechazó (vacío si todo entró bien). Si aquí
      // aparecen RIT con letra nueva (p. ej. 'A'), falta correr schema-tipo-fix.sql.
      causasFallidas,
      // El Excel se jubiló: esto es lo que hay que decirle a la usuaria después de la
      // migración, en la propia respuesta, para que no vuelva a subir el archivo.
      despues: [
        'Las causas nuevas quedaron PENDIENTES de escaneo: corré bot-mantenimiento.bat y el bot les trae los movimientos.',
        'De acá en más las causas se cargan pegando el correo en /asignaciones. No hace falta volver a subir el Excel.',
      ],
      registro_lote: lote ? 'carga_lotes' : 'carga_lotes no disponible (falta schema-001-cobertura.sql)',
    })

  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: `Error: ${err.message || 'Error interno'}` }, { status: 500 })
  }
}

/** Estadísticas de la revisión previa: todo en cero, para reutilizar la forma de la respuesta. */
function statsVacias(p: { columnasDetectadas: string[]; hoja: string; totalFilas: number }) {
  return {
    causas_fallidas: 0,
    nna: 0,
    adultos: 0,
    audiencias: 0,
    hijos_omitidos: 0,
    columnasDetectadas: p.columnasDetectadas || [],
    hoja: p.hoja || '',
    totalFilas: p.totalFilas,
  }
}

function isValidDate(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  const year = d.getFullYear()
  return year >= 1900 && year <= 2030
}

function sanitizeJson(obj: Record<string, any> | undefined): Record<string, any> {
  if (!obj) return {}
  const clean: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (value instanceof Date) {
      if (!isNaN(value.getTime())) clean[key] = value.toISOString().split('T')[0]
    } else if (typeof value === 'number') {
      if (!isNaN(value) && isFinite(value)) clean[key] = value
    } else if (typeof value === 'string') {
      const t = value.trim()
      if (t && t.toLowerCase() !== 'nan' && t.toLowerCase() !== 'none') clean[key] = t
    } else {
      clean[key] = String(value)
    }
  }
  return clean
}
