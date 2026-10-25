import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseExcelRows } from '@/lib/parseExcel'
import { marcarTerminada } from '@/lib/monitoreo'
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
//   1. REESCRIBE NNA y adultos, y NO toca audiencias. La subida anterior atribuyó mal los
//      niños (las celdas con varios RIT heredaban el RIT del renglón de arriba), así que
//      ahora se borran y reinsertan los de las causas que están en el archivo. Es seguro:
//      esas dos tablas tienen un solo escritor (este endpoint). Las audiencias NO se
//      importan: las escriben también el bot y el pegado de asignaciones, y ahí la fuente
//      de verdad es el portal — las del Excel son fechas viejas.
//   2. AZUL = CERRADA. La curadora marca las causas terminadas pintando la fila de azul, y
//      el color manda sobre el texto de la columna de estado. Se traduce a la marca
//      [TERMINADA] en `notas` (append-only, mismo canal que usa el botón de monitoreo),
//      que es lo que la saca de la cola del bot y de la métrica de pendientes.
//   3. ESCRIBE origen/cola por default: las causas nuevas nacen con
//      escaneo_estado='pendiente' (default de la BD tras schema-001-cobertura.sql),
//      así entran solas a la cola del bot.
//   4. IDS POR (rol,anio): el Excel suele traer "4596-2024" sin letra y en la BD
//      está "P-4596-2024". Con match exacto se creaba una causa DUPLICADA del
//      mismo expediente. Ahora, si el RIT no tiene letra, se busca por número+año
//      y solo se enlaza si hay EXACTAMENTE una coincidencia (si hay dos, se avisa:
//      es la ambigüedad P↔X y la decide la curadora).
//   5. DEJA LO QUE RECIBIÓ en carga_lotes (baseline de la migración) y puede
//      DEVOLVER UN DIFF sin escribir (`dryRun`), para revisar el archivo antes.
//   6. AUTENTICACIÓN: antes no tenía ninguna y cualquiera podía escribir y borrar
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

      // El COLOR de la fila no viaja en el JSON: el navegador lee el archivo con cellStyles
      // y manda un booleano por fila (las azules = causas cerradas). Se valida el largo para
      // que un body recortado no corra los índices y cierre la causa equivocada.
      const filasCerradas = Array.isArray(body?.filasCerradas) && body.filasCerradas.length === rows.length
        ? body.filasCerradas.map((x: any) => x === true)
        : undefined

      try {
        parseResult = parseExcelRows(rows, sheetName || 'Hoja1', filasCerradas)
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

    // Las `audiencias` del Excel NO se destructuran ni se escriben: el PORTAL es la fuente
    // de verdad para las audiencias y el bot ya las trae. Las del archivo están vencidas
    // (1124 fechas en el pasado) y cargarlas ensucia la agenda con audiencias que ya fueron.
    const { causas, nna, adultos } = parseResult

    if (causas.length === 0) {
      return NextResponse.json({
        error: 'No se encontraron causas. ¿El archivo tiene una columna con RIT (ej: P-1234-2024)?',
        columnasEncontradas: parseResult.columnasDetectadas,
        filasLeidas: parseResult.totalFilas,
        filasSinRit: parseResult.filasSinRit || [],
      }, { status: 400 })
    }

    const supabase = createAdminClient()

    // La marca de terminada lleva fecha y motivo legibles: dentro de un mes la curadora tiene
    // que poder distinguir "la cerré yo a mano" de "venía azul en el Excel de la migración".
    const HOY = new Date().toISOString().split('T')[0]
    const MOTIVO_CIERRE = 'cerrada por la migración del Excel (fila azul)'

    // ------------------------------------------------------------
    // 1. ¿Cuáles ya están en la base?
    //    a) match exacto de RIT, y
    //    b) para los RIT SIN LETRA del Excel, match por (rol, anio) — el expediente
    //       real suele estar en la BD con su letra.
    // ------------------------------------------------------------
    const rits = causas.map(c => c.rit)
    const idPorRit: Record<string, string> = {}
    // `notas` se trae acá porque es un canal COMPARTIDO con el bot: para marcar una causa
    // como terminada hay que leer lo que ya tiene y AGREGAR una línea, nunca reemplazar.
    const notasPorId: Record<string, string | null> = {}

    // Con el Excel real de la curadora esto son ~1900 RIT = 20 consultas. En serie no
    // entran en el maxDuration de la función, así que van en paralelo.
    const lotesRit: string[][] = []
    for (let i = 0; i < rits.length; i += 100) lotesRit.push(rits.slice(i, i + 100))
    const respuestasRit = await Promise.all(
      lotesRit.map(lote => supabase.from('causas').select('id, rit, notas').in('rit', lote))
    )
    for (const { data } of respuestasRit) {
      for (const c of data || []) {
        idPorRit[c.rit] = c.id
        notasPorId[c.id] = c.notas ?? null
      }
    }

    /** RIT del Excel sin letra → RIT con letra ya cargado en la BD. */
    const enlacePorRol: Record<string, string> = {}
    /** RIT del Excel sin letra que NO se pudo enlazar sin ambigüedad (se avisa). */
    const ambiguos: string[] = []
    const sinLetra = causas.filter(c => !idPorRit[c.rit] && c.rol != null && c.anio != null)
    for (let i = 0; i < sinLetra.length; i += 50) {
      const lote = sinLetra.slice(i, i + 50)
      const respuestas = await Promise.all(lote.map(c =>
        supabase.from('causas').select('id, rit, notas').eq('rol', c.rol!).eq('anio', c.anio!).limit(3)
      ))
      lote.forEach((c, k) => {
        const filas = respuestas[k].data || []
        if (filas.length === 1) {
          idPorRit[c.rit] = filas[0].id
          enlacePorRol[c.rit] = filas[0].rit
          // También hay que traer sus notas: si no, marcarla terminada partiría de un campo
          // vacío y pisaría las marcas del bot ([VÍNCULO], [NO EN PORTAL]) de esa causa.
          notasPorId[filas[0].id] = filas[0].notas ?? null
        } else if (filas.length > 1) {
          // Dos expedientes con el mismo número y año (hermanas P↔X): no se elige
          // desde el código. Se trata como causa nueva?? NO — crearía un tercer
          // expediente. Se deja FUERA y se avisa para decisión humana.
          ambiguos.push(`${c.rit}: la base tiene ${filas.map(f => f.rit).join(', ')}`)
        }
      })
    }

    const causasNuevas = causas.filter(c => !idPorRit[c.rit])
    const causasExistentes = causas.filter(c => !!idPorRit[c.rit])
    const resumenExistentes: ResumenExistente[] = causasExistentes.map(c => ({
      rit: c.rit,
      id: idPorRit[c.rit],
      rit_en_base: enlacePorRol[c.rit] ?? c.rit,
    }))

    // Causas cuya fila estaba pintada de AZUL en el Excel: la curadora las da por cerradas.
    // El parser ya resolvió la duda (un RIT que también aparece en una fila sin pintar NO
    // entra acá), así que esto es solo contarlas.
    const causasCerradas = causas.filter(c => c.cerrada_en_excel === true)

    const diff = {
      filas_totales: parseResult.totalFilas,
      causas_en_archivo: causas.length,
      nuevas: causasNuevas.length,
      existentes: causasExistentes.length,
      enlazadas_por_rol: Object.keys(enlacePorRol).length,
      ambiguos,
      filas_sin_rit: (parseResult.filasSinRit || []).length,
      muestras_filas_sin_rit: (parseResult.filasSinRit || []).slice(0, 20),
      // Las audiencias del Excel NO se importan (el portal es la fuente de verdad y el bot
      // ya las escribe), así que acá solo se cuenta lo que de verdad se va a escribir.
      hijos_en_archivo: nna.length + adultos.length,
      cerradas_por_color: causasCerradas.length,
      muestras_color_dudoso: (parseResult.colorDudoso || []).slice(0, 40),
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
        // `notas` es el canal de control del bot ([NO EN PORTAL], [REVISAR…], [VÍNCULO]).
        // Una causa recién creada no tiene nada ahí, así que lo único que se escribe es la
        // marca de terminada cuando el Excel la traía en azul: es lo que la saca de la cola
        // del bot y de la métrica de pendientes.
        notas: c.cerrada_en_excel ? marcarTerminada(null, HOY, MOTIVO_CIERRE) : (c.notas || null),
        datos_extra: sanitizeJson(c.datos_extra) || {},
        columnas_origen: c.columnas_origen || [],
        // `origen` y `escaneo_estado` se dejan a los DEFAULT de la BD
        // ('excel' y 'pendiente' tras schema-001-cobertura.sql): así la columna
        // extra no es un punto de fallo si la migración aún no se corrió, y las
        // causas nuevas entran solas a la cola del bot.
      }))

      // EN OLAS DE 6 LOTES A LA VEZ. Secuencial eran ~26 esperas encadenadas y la función
      // se pasaba de los 60 s de maxDuration: la migración moría a mitad, con las causas
      // cargadas y los NNA sin cargar (justo el estado que hace dudar de los números).
      // Se acota a 6 para no abrir cientos de conexiones contra PostgREST.
      const lotesNuevos: typeof insertData[] = []
      for (let i = 0; i < insertData.length; i += 50) lotesNuevos.push(insertData.slice(i, i + 50))

      for (let v = 0; v < lotesNuevos.length; v += 6) {
        const ola = lotesNuevos.slice(v, v + 6)
        const resultados = await Promise.all(ola.map(async (batch) => {
          const { data, error } = await supabase.from('causas').insert(batch).select('id, rit')
          if (!error) {
            return { ok: data || [], fallidas: [] as { rit: string; motivo: string }[] }
          }
          // El lote entero fue rechazado. Se prueba fila por fila para poder decir CUÁL y
          // POR QUÉ (el motivo exacto de la base), que es lo único que permite arreglarlo.
          // Va secuencial a propósito: es el camino raro y no vale la pena abrir 50 conexiones.
          const ok: { id: string; rit: string }[] = []
          const fallidas: { rit: string; motivo: string }[] = []
          for (const single of batch) {
            const { data: sd, error: singleErr } = await supabase.from('causas').insert(single).select('id, rit')
            if (sd && sd.length) ok.push(...sd)
            else fallidas.push({ rit: single.rit, motivo: singleErr?.message || 'La base de datos rechazó la fila' })
          }
          return { ok, fallidas }
        }))
        for (const r of resultados) {
          for (const c of r.ok) ritToId[c.rit] = c.id
          causasInsertadas += r.ok.length
          causasFallidas.push(...r.fallidas)
        }
      }
    }

    // ------------------------------------------------------------
    // 3. Actualizar las existentes: SOLO campos del Excel.
    //    NO toca `escaneo_estado` (una causa ya escaneada no vuelve a pendiente por subir el
    //    archivo). En `notas` únicamente AGREGA la marca de terminada cuando la fila venía
    //    azul: las marcas del bot ([NO EN PORTAL], [VÍNCULO], [REVISAR LETRA]) se conservan.
    //    Van en paralelo por lotes — con el Excel real son ~600 existentes y una por una no
    //    entran en el maxDuration de la función.
    // ------------------------------------------------------------
    let causasActualizadas = 0
    for (let i = 0; i < causasExistentes.length; i += 40) {
      const lote = causasExistentes.slice(i, i + 40)
      const resultados = await Promise.all(lote.map(c => {
        const id = idPorRit[c.rit]
        const update: Record<string, any> = { updated_at: new Date().toISOString() }
        if (c.estado) update.estado = c.estado
        if (c.programa_vigente) update.programa_vigente = c.programa_vigente
        if (c.datos_extra) update.datos_extra = sanitizeJson(c.datos_extra)
        if (c.columnas_origen) update.columnas_origen = c.columnas_origen

        // null = ya estaba marcada, entonces no se escribe notas (append-only de verdad).
        if (c.cerrada_en_excel) {
          const nuevas = marcarTerminada(notasPorId[id], HOY, MOTIVO_CIERRE)
          if (nuevas !== null) update.notas = nuevas
        }

        return supabase.from('causas').update(update).eq('id', id).then(r => !r.error)
      }))
      causasActualizadas += resultados.filter(Boolean).length
    }

    // ------------------------------------------------------------
    // 4. Hijos (NNA y adultos): REPARACIÓN COMPLETA, no solo las causas nuevas.
    //    Por qué se borra: en la subida anterior las celdas con varios RIT ("X-5305-2023
    //    P-5935-2023", que en este Excel son más que las de uno solo) no calzaban con el
    //    parser, y cada una de esas filas heredaba el RIT del renglón anterior. Los niños
    //    quedaron colgados de la causa equivocada — y de ahí salen el reporte y la minuta
    //    que se presentan al tribunal.
    //    Por qué es seguro: `nna` y `adultos` tienen UN SOLO escritor, este endpoint. El bot
    //    no las toca y no hay pantalla para editarlas, así que borrar por causa_id y volver
    //    a insertar es una reparación, no una pérdida. El borrado se limita a las causas que
    //    ESTÁN en el archivo.
    //    Las AUDIENCIAS quedan fuera del todo: las escriben también el bot y el pegado de
    //    asignaciones, y ahí la fuente de verdad es el portal.
    // ------------------------------------------------------------
    const idsArchivo = causas
      .map(c => ritToId[c.rit])
      .filter((x): x is string => typeof x === 'string' && !!x)

    // En lotes: un IN con ~1900 uuid arma una URL que PostgREST rechaza. Los lotes van todos
    // a la vez (son ~10, o sea ~20 pedidos): uno atrás del otro sumaban varios segundos.
    const lotesIds: string[][] = []
    for (let i = 0; i < idsArchivo.length; i += 200) lotesIds.push(idsArchivo.slice(i, i + 200))
    await Promise.all(lotesIds.flatMap(lote => [
      supabase.from('nna').delete().in('causa_id', lote),
      supabase.from('adultos').delete().in('causa_id', lote),
    ]))

    const nnaRecords = nna
      .filter(n => ritToId[n._rit])
      .map(n => ({
        ...n,
        causa_id: ritToId[n._rit],
        _rit: undefined,
        fecha_nacimiento: isValidDate(n.fecha_nacimiento) ? n.fecha_nacimiento : null,
      }))
      .map(({ _rit, ...rest }) => rest)

    const adultosRecords = adultos
      .filter(a => ritToId[a._rit])
      .map(({ _rit, ...rest }) => ({ ...rest, causa_id: ritToId[_rit] }))

    /** Inserta por lotes en paralelo y devuelve cuántas filas aceptó la base. */
    async function insertarLotes(tabla: 'nna' | 'adultos', registros: any[]): Promise<number> {
      const lotes: any[][] = []
      for (let i = 0; i < registros.length; i += 100) lotes.push(registros.slice(i, i + 100))
      const respuestas = await Promise.all(
        lotes.map(lote => supabase.from(tabla).insert(lote).select('id'))
      )
      return respuestas.reduce((acc, r) => acc + (r.data?.length || 0), 0)
    }

    const nnaCount = await insertarLotes('nna', nnaRecords)
    const adultosCount = await insertarLotes('adultos', adultosRecords)

    // Filas de NNA/adultos que el archivo traía pero no se escribieron: su RIT no se pudo
    // resolver a un id (causa rechazada por la base o RIT ambiguo). Se informa, no se pierde.
    const hijosOmitidos = (nna.length - nnaRecords.length) + (adultos.length - adultosRecords.length)

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
        ...(parseResult.colorDudoso || []).map(r => `${r}: fila azul y fila sin marcar (no se cerró sola)`),
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
        cerradas: causasCerradas.length,
        hijos_omitidos: hijosOmitidos,
        columnasDetectadas: parseResult.columnasDetectadas || [],
        hoja: parseResult.hoja || '',
        totalFilas: parseResult.totalFilas,
      },
      // Detalle de las causas que la BD rechazó (vacío si todo entró bien). Si aquí
      // aparecen RIT con letra nueva (p. ej. 'A'), falta correr db/migraciones/schema-tipo-fix.sql.
      causasFallidas,
      // El Excel se jubiló: esto es lo que hay que decirle a la usuaria después de la
      // migración, en la propia respuesta, para que no vuelva a subir el archivo.
      despues: [
        `${causasCerradas.length} causas venían en fila azul: quedaron marcadas como TERMINADAS y ya no entran a la cola del bot. Si alguna sigue viva, abrila desde su ficha.`,
        'Las causas que quedaron vivas están PENDIENTES de escaneo: corré bot-mantenimiento.bat y el bot les trae los movimientos del portal.',
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
    cerradas: 0,
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
