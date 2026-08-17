'use client'
import { useState, useCallback } from 'react'

interface Stats {
  causas: number
  nna: number
  adultos: number
  audiencias: number
}

export default function UploadExcel({ onSuccess }: { onSuccess: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      
      if (!res.ok) {
        setError(data.error || 'Error al procesar')
        return
      }

      setResult(data.stats)
      setTimeout(() => onSuccess(), 2000)
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
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
          <p className="text-gray-600 font-medium">Procesando tu Excel...</p>
          <p className="text-sm text-gray-400">Limpiando datos, normalizando RUT, cargando causas...</p>
        </div>
      ) : result ? (
        <div className="space-y-3">
          <div className="text-4xl">✅</div>
          <p className="text-green-700 font-bold text-lg">¡Carga exitosa!</p>
          <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto text-sm">
            <div className="bg-green-50 rounded p-2">📁 {result.causas} causas</div>
            <div className="bg-green-50 rounded p-2">👶 {result.nna} NNA</div>
            <div className="bg-green-50 rounded p-2">👤 {result.adultos} adultos</div>
            <div className="bg-green-50 rounded p-2">📅 {result.audiencias} audiencias</div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-5xl">📤</div>
          <div>
            <p className="text-gray-700 font-semibold text-lg">Arrastra tu Excel aquí</p>
            <p className="text-gray-400 text-sm mt-1">o haz click para seleccionar archivo</p>
          </div>
          <label className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg cursor-pointer hover:bg-blue-700 transition">
            Seleccionar archivo
            <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
          </label>
          {error && <p className="text-red-500 text-sm mt-2">❌ {error}</p>}
        </div>
      )}
    </div>
  )
}
