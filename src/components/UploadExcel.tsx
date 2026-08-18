'use client'
import { useState, useCallback } from 'react'
import * as XLSX from 'xlsx'

interface Stats {
  causas: number
  causas_actualizadas?: number
  nna: number
  adultos: number
  audiencias: number
  columnasDetectadas?: string[]
  hoja?: string
}

export default function UploadExcel({ onSuccess }: { onSuccess: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setStatus('Leyendo archivo...')

    try {
      // PASO 1: Parsear Excel EN EL NAVEGADOR (evita límite 4.5MB de Vercel)
      setStatus('Detectando columnas...')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      
      // Usar primera hoja
      const sheetName = wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
      
      if (rows.length < 2) {
        setError('El archivo está vacío o no tiene suficientes filas')
        setLoading(false)
        return
      }

      // PASO 2: Enviar datos parseados al servidor (JSON, mucho más pequeño)
      setStatus(`Procesando ${rows.length} filas...`)
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          rows: rows,
          sheetName: sheetName,
          fileName: file.name,
        }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        const errorText = data.error || `Error ${res.status}: ${res.statusText}`
        setError(errorText)
        return
      }

      if (data.stats?.causas === 0 && (data.stats?.causas_actualizadas || 0) === 0) {
        setError('El archivo se procesó pero no se encontraron causas. ¿El archivo tiene una columna con RIT (ej: P-1234-2024)?')
        return
      }

      setResult(data.stats)
      setTimeout(() => onSuccess(), 2500)
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }, [onSuccess])

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
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
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
          <div className="space-y-3">
            <div className="text-4xl">✅</div>
            <p className="text-green-700 font-bold text-lg">¡Carga exitosa!</p>
            <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto text-sm">
              <div className="bg-green-50 rounded p-2">📁 {result.causas} nuevas</div>
              <div className="bg-blue-50 rounded p-2">🔄 {result.causas_actualizadas || 0} actualizadas</div>
              <div className="bg-green-50 rounded p-2">👶 {result.nna} NNA</div>
              <div className="bg-green-50 rounded p-2">📅 {result.audiencias} audiencias</div>
            </div>
            {result.columnasDetectadas && result.columnasDetectadas.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {result.columnasDetectadas.length} columnas cargadas
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-5xl">📤</div>
            <div>
              <p className="text-gray-700 font-semibold text-lg">Arrastra tu documento aquí</p>
              <p className="text-gray-400 text-sm mt-1">o haz click para seleccionar archivo</p>
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
      
      {!loading && !result && (
        <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-2">
          <p className="font-medium text-gray-600">📋 Formatos aceptados:</p>
          <ul className="space-y-1 ml-4">
            <li>• <strong>Excel</strong> (.xlsx, .xls) — cualquier formato con columna RIT</li>
            <li>• <strong>CSV</strong> (.csv) — separado por comas o punto y coma</li>
            <li>• <strong>LibreOffice</strong> (.ods)</li>
          </ul>
          <p className="mt-2 text-gray-400">
            Se cargan TODAS las columnas de tu archivo. Solo necesita al menos una columna con RIT (ej: P-1234-2024).
          </p>
        </div>
      )}
    </div>
  )
}
