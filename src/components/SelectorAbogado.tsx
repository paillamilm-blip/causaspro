'use client'
import { useEffect, useState } from 'react'
import { getAbogadoActivo, setAbogadoActivo } from '@/lib/sesionAbogado'
import type { Abogado } from '@/lib/types'

/**
 * Selector de "quien eres" (temporal, sin login).
 * Permite elegir el abogado activo y crear abogados nuevos.
 * En el Paso 2 (auth) esto se reemplaza por la sesion real.
 */
export default function SelectorAbogado({ onChange }: { onChange?: (abogadoId: string | null) => void }) {
  const [abogados, setAbogados] = useState<Abogado[]>([])
  const [activo, setActivo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', rol: 'socio', estudio_nombre: '' })
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setActivo(getAbogadoActivo())
    cargar()
  }, [])

  async function cargar() {
    setLoading(true)
    try {
      const res = await fetch('/api/abogados')
      const data = await res.json()
      if (data.ok) setAbogados(data.abogados)
    } catch {
      /* capa multi-abogado puede no estar migrada */
    } finally {
      setLoading(false)
    }
  }

  function elegir(id: string | null) {
    setActivo(id)
    setAbogadoActivo(id)
    onChange?.(id)
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setGuardando(true)
    try {
      const res = await fetch('/api/abogados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre,
          rol: form.rol,
          estudio_nombre: form.estudio_nombre || undefined,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al crear abogado')
      setForm({ nombre: '', rol: 'socio', estudio_nombre: '' })
      setShowForm(false)
      await cargar()
      elegir(data.abogado.id) // dejar activo al recien creado
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 uppercase">Estás viendo como</span>
        <select
          value={activo || ''}
          onChange={(e) => elegir(e.target.value || null)}
          disabled={loading}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        >
          <option value="">👥 Todo el estudio</option>
          {abogados.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre} {a.rol === 'socio' ? '(socio)' : ''}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
        >
          {showForm ? 'Cancelar' : '+ Abogado'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={crear} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Nombre del abogado"
            required
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <select
            value={form.rol}
            onChange={(e) => setForm({ ...form, rol: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="socio">Socio</option>
            <option value="abogado">Abogado</option>
          </select>
          <input
            value={form.estudio_nombre}
            onChange={(e) => setForm({ ...form, estudio_nombre: e.target.value })}
            placeholder="Estudio (opcional)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            type="submit"
            disabled={guardando || !form.nombre.trim()}
            className="sm:col-span-3 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Crear abogado'}
          </button>
        </form>
      )}
    </div>
  )
}
