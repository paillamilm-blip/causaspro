'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import UploadExcel from '@/components/UploadExcel'
import Dashboard from '@/components/Dashboard'
import Link from 'next/link'

export default function Home() {
  const [hasCausas, setHasCausas] = useState<boolean | null>(null)
  const [causasCount, setCausasCount] = useState(0)

  useEffect(() => {
    checkCausas()
  }, [])

  async function checkCausas() {
    try {
      const { count, error } = await supabase.from('causas').select('*', { count: 'exact', head: true })
      if (error) {
        console.error('Error checking causas:', error.message)
        // Si hay error de conexión, intentar con fetch directo
        try {
          const res = await fetch('/api/admin/reset')
          const data = await res.json()
          if (data.datos_actuales?.causas > 0) {
            setCausasCount(data.datos_actuales.causas)
            setHasCausas(true)
            return
          }
        } catch {}
        setHasCausas(false)
        setCausasCount(0)
        return
      }
      const total = count || 0
      setCausasCount(total)
      setHasCausas(total > 0)
    } catch (e) {
      console.error('Error:', e)
      setHasCausas(false)
      setCausasCount(0)
    }
  }

  async function handleReset() {
    if (!confirm('⚠️ ¿Estás segura? Esto borra TODAS las causas y datos. Es irreversible.')) return
    if (!confirm('🚨 ÚLTIMA CONFIRMACIÓN: ¿Borrar todo?')) return
    
    const res = await fetch('/api/admin/reset', { method: 'DELETE' })
    const data = await res.json()
    if (data.ok) {
      alert('✅ Todo borrado. Puedes subir un nuevo archivo.')
      setHasCausas(false)
      setCausasCount(0)
    } else {
      alert('Error: ' + data.error)
    }
  }

  if (hasCausas === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin text-3xl">⚙️</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏛️</span>
            <h1 className="text-xl font-bold text-gray-800">CausasPro</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Curaduría Ad Litem</span>
          </div>
          <div className="flex items-center gap-2">
            {hasCausas && (
              <>
                <span className="text-xs text-gray-400">{causasCount} causas</span>
                <button
                  onClick={() => setHasCausas(false)}
                  className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  📤 Subir documento
                </button>
                <button
                  onClick={handleReset}
                  className="text-sm bg-red-50 text-red-600 px-3 py-2 rounded-lg hover:bg-red-100 transition"
                  title="Borrar todos los datos"
                >
                  🗑️
                </button>
              </>
            )}
            <Link
              href="/config"
              className="text-sm bg-gray-100 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-200 transition"
              title="Configuración"
            >
              ⚙️
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {!hasCausas ? (
          <div className="max-w-xl mx-auto space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-800">Sube tu documento de causas</h2>
              <p className="text-gray-500 mt-1">Excel, CSV o cualquier archivo con una columna RIT</p>
              <p className="text-xs text-gray-400 mt-1">El sistema detecta automáticamente las columnas de tu archivo</p>
            </div>
            <UploadExcel onSuccess={() => { setHasCausas(true) }} />
            {/* Botón para ir directo al dashboard si ya hay datos */}
            <div className="text-center pt-4 border-t">
              <p className="text-sm text-gray-400 mb-2">¿Ya cargaste datos antes?</p>
              <button
                onClick={() => setHasCausas(true)}
                className="text-sm bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition"
              >
                📊 Ir al Panel de Control
              </button>
            </div>
          </div>
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  )
}
