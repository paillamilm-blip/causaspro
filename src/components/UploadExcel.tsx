'use client'
import { useState, useCallback } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'

interface Stats {
  causas: number
  causas_actualizadas?: number
  causas_fallidas?: number
  nna: number
  adultos: number
  audiencias: number
  hijos_omitidos?: number
  columnasDetectadas?: string[]
  hoja?: string
  totalFilas?: number
}

/** Diff que devuelve /api/upload: cuántas filas calzaron y cuáles NO. */
interface Diff {
  filas_totales: number
  causas_en_archivo: number
  nuevas: number
  existentes: number
  enlazadas_por_rol: number
  ambiguos: string[]
  filas_sin_rit: number
  muestras_filas_sin_rit: string[]
  hijos_en_archivo: number
}

interface Respuesta {
  ok: boolean
  modo: 'revision' | 'guardado'
  diff: Diff
  stats: Stats
  enlazadas?: { rit: string; rit_en_base: string }[]
  causasFallidas?: { rit: string; motivo: string }[]
  despues?: string[]
  registro_lote?: string
}

/**
 * Carga de Excel = MIGRACIÓN ÚNICA.
 *
 * Desde que las causas entran pegando el correo en /asignaciones, subir el Excel
 * es un evento excepcional (traer el histórico). Por eso la pantalla cambió de
 * forma: primero REVISA el archivo y muestra el diff (cuántas causas son nuevas,
 * cuántas ya estaban, cuántas filas NO se entendieron) y recién después escribe,
 * con un botón explícito. Antes el solo acto de soltar el archivo borraba y
 * re-insertaba los hijos de las causas.
 */
export default function UploadExcel({ onSuccess }: { onSuccess: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<Respuesta | null>(null)
  const [result, setResult] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Las filas ya están leídas en el navegador: se guardan para no volver a parsear
  // el archivo al confirmar (y para que lo que se confirma sea EXACTAMENTE lo revisado).
  const [filas, setFilas] = useState<{ rows: any[][]; sheetName: string; fileName: string } | null>(null)

  const llamar = useCallback(async (confirmar: boolean) => {
    if (!filas) return
    setLoading(true)
    setError(null)
    setStatus(confirmar ? 'Guardando en la base...' : 'Revisando el archivo...')
    try {
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      const res = await fetch(`/api/upload${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filas, dryRun: !confirmar }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        if (!confirmar) setPreview(null)
        return
      }
      if (confirmar) {
        setResult(data)
        setPreview(null)
        setTimeout(() => onSuccess(), 4000)
      } else {
        setPreview(data)
        setResult(null)
      }
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }, [filas, onSuccess])

  const handleFile = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    setPreview(null)
    setResult(null)
    setStatus('Leyendo archivo...')

    try {
      // PASO 1: parsear en el navegador (evita el límite de 4.5 MB de Vercel).
      setStatus('Detectando columnas...')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheetName = wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

      if (rows.length < 2) {
        setError('El archivo está vacío o no tiene suficientes filas')
        return
      }

      const datos = { rows, sheetName, fileName: file.name }
      setFilas(datos)

      // PASO 2: REVISIÓN (dryRun). Todavía no se escribió nada.
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      setStatus('Comparando con la base...')
      const res = await fetch(`/api/upload${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datos, dryRun: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        setFilas(null)
        return
      }
      setPreview(data)
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }, [])

  const limpiar = () => {
    setFilas(null)
    setPreview(null)
    setResult(null)
    setError(null)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-4">
      {/* Recordatorio de que el Excel se jubiló: si no, la tentación es seguir subiéndolo. */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <p className="font-semibold">El Excel ya no es la forma de cargar causas.</p>
        <p className="mt-1">
          Se usa <strong>una sola vez</strong>, para traer el histórico. Las causas que te asignan
          de ahora en más se cargan pegando el correo.
        </p>
        <Link href="/asignaciones" className="inline-block mt-2 text-blue-700 font-medium underline">
          Ir a Cargar asignaciones →
        </Link>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all
          ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-white'}
          ${loading ? 'opacity-60 pointer-events-none' : ''}
        `}
      >
        {loading ? (
          <div className="space-y-3">
            <div className="animate-spin text-4xl">⚙️</div>
            <p className="text-gray-600 font-medium">Procesando documento...</p>
            <p className="text-sm text-gray-400">{status}</p>
          </div>
        ) : result ? (
          <div className="space-y-3 text-left max-w-xl mx-auto">
            <div className="text-center text-4xl">✅</div>
            <p className="text-green-700 font-bold text-lg text-center">Migración guardada</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-green-50 rounded p-2">📁 {result.stats.causas} causas nuevas</div>
              <div className="bg-blue-50 rounded p-2">🔄 {result.stats.causas_actualizadas || 0} ya estaban</div>
              <div className="bg-green-50 rounded p-2">👶 {result.stats.nna} NNA</div>
              <div className="bg-green-50 rounded p-2">📅 {result.stats.audiencias} audiencias</div>
            </div>
            {result.stats.hijos_omitidos ? (
              <p className="text-xs text-gray-500">
                {result.stats.hijos_omitidos} filas de NNA/adultos/audiencias del archivo{' '}
                <strong>no se escribieron</strong>: pertenecen a causas que ya estaban cargadas,
                y sus datos actuales (del bot y de las asignaciones) valen más que el Excel.
              </p>
            ) : null}
            {result.causasFallidas && result.causasFallidas.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800">
                  {result.causasFallidas.length} causa(s) la base las rechazó:
                </p>
                <ul className="text-xs text-amber-700 list-disc list-inside mt-1 max-h-32 overflow-auto">
                  {result.causasFallidas.slice(0, 20).map((f, i) => (
                    <li key={i}><strong>{f.rit}</strong>: {f.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.despues && (
              <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 mt-2">
                {result.despues.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
            <div className="text-center">
              <button onClick={limpiar} className="text-sm text-blue-700 underline">
                Revisar otro archivo
              </button>
            </div>
          </div>
        ) : preview ? (
          <div className="space-y-3 text-left max-w-xl mx-auto">
            <p className="text-center font-bold text-gray-800">
              Revisión previa — todavía NO se guardó nada
            </p>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Filas del archivo: <strong>{preview.diff.filas_totales}</strong></li>
              <li>• Causas reconocidas: <strong>{preview.diff.causas_en_archivo}</strong></li>
              <li>• <strong className="text-green-700">{preview.diff.nuevas}</strong> serían nuevas ·{' '}
                <strong className="text-blue-700">{preview.diff.existentes}</strong> ya estaban cargadas</li>
              {preview.diff.enlazadas_por_rol > 0 && (
                <li>• {preview.diff.enlazadas_por_rol} sin letra en el Excel se enlazaron con la causa
                  que ya tiene letra en la base (ej. 4596-2024 → P-4596-2024)</li>
              )}
              <li>• Hijos (NNA/adultos/audiencias) en el archivo: {preview.diff.hijos_en_archivo}</li>
            </ul>

            {preview.diff.filas_sin_rit > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800">
                  {preview.diff.filas_sin_rit} fila(s) sin RIT reconocible (no se van a cargar):
                </p>
                <ul className="text-xs text-amber-700 list-disc list-inside mt-1 max-h-32 overflow-auto">
                  {preview.diff.muestras_filas_sin_rit.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            {preview.diff.ambiguos.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-medium text-red-800">
                  {preview.diff.ambiguos.length} fila(s) ambigua(s): la base tiene más de un expediente
                  con ese número y año. No se elige automáticamente; revisá cuál es el RIT correcto:
                </p>
                <ul className="text-xs text-red-700 list-disc list-inside mt-1 max-h-32 overflow-auto">
                  {preview.diff.ambiguos.slice(0, 20).map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => llamar(true)}
                disabled={loading}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-40"
              >
                💾 Confirmar y cargar {preview.diff.nuevas} nuevas
              </button>
              <button
                onClick={limpiar}
                className="bg-gray-100 text-gray-600 px-5 py-2 rounded-lg text-sm hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-5xl">📤</div>
            <div>
              <p className="text-gray-700 font-semibold text-lg">Traer el histórico desde Excel</p>
              <p className="text-gray-400 text-sm mt-1">
                Arrastrá el archivo y te muestro qué haría, sin guardar nada todavía
              </p>
            </div>
            <label className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg cursor-pointer hover:bg-blue-700 transition">
              Seleccionar archivo
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.ods"
                onChange={onFileInput}
                className="hidden"
              />
            </label>
            {error && <p className="text-red-500 text-sm mt-2">❌ {error}</p>}
          </div>
        )}
      </div>

      {!loading && !preview && !result && (
        <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-2">
          <p className="font-medium text-gray-600">📋 Formatos aceptados:</p>
          <ul className="space-y-1 ml-4">
            <li>• <strong>Excel</strong> (.xlsx, .xls) — cualquier formato con columna RIT</li>
            <li>• <strong>CSV</strong> (.csv) — separado por comas o punto y coma</li>
            <li>• <strong>LibreOffice</strong> (.ods)</li>
          </ul>
          <p className="mt-2 text-gray-400">
            Se cargan TODAS las columnas del archivo. Solo hace falta una columna con RIT (ej: P-1234-2024).
            Subir el archivo <strong>no borra</strong> nada: las causas que ya estaban se actualizan con sus
            campos, y sus NNA, adultos y audiencias quedan intactos.
          </p>
        </div>
      )}
    </div>
  )
}
