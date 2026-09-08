'use client'
import { useEffect, useState } from 'react'
import type { Cliente } from '@/lib/types'

interface ClienteConCausas extends Cliente {
  total_causas: number
}

/**
 * Gestion de clientes del estudio: lista, crear y ver cuantas causas tiene cada uno.
 */
export default function Clientes() {
  const [clientes, setClientes] = useState<ClienteConCausas[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [form, setForm] = useState({ nombre: '', rut: '', email: '', telefono: '', direccion: '', notas: '' })

  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/clientes')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al cargar clientes')
      setClientes(data.clientes)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setGuardando(true)
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al crear cliente')
      setForm({ nombre: '', rut: '', email: '', telefono: '', direccion: '', notas: '' })
      setShowForm(false)
      await cargar()
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800">👥 Clientes ({clientes.length})</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancelar' : '+ Nuevo cliente'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={crear} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Nombre *" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required />
            <Input label="RUT" value={form.rut} onChange={(v) => setForm({ ...form, rut: v })} placeholder="12.345.678-9" />
            <Input label="Teléfono" value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} placeholder="+56 9 ..." />
            <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
            <Input label="Dirección" value={form.direccion} onChange={(v) => setForm({ ...form, direccion: v })} />
            <Input label="Notas" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} />
          </div>
          <button
            type="submit"
            disabled={guardando || !form.nombre.trim()}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar cliente'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin text-2xl">👥</div>
        </div>
      ) : error ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-amber-800 font-medium">No se pudieron cargar los clientes</p>
          <p className="text-amber-600 text-sm mt-1">{error}</p>
          <p className="text-amber-600 text-xs mt-3">
            ¿Ejecutaste <code className="bg-amber-100 px-1 rounded">schema-negocio.sql</code> en Supabase?
          </p>
        </div>
      ) : clientes.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-3xl mb-2">👥</p>
          <p className="text-gray-700 font-medium">Aún no tienes clientes</p>
          <p className="text-gray-500 text-sm mt-1">Crea tu primer cliente para asociarle causas y honorarios.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {clientes.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-800">{c.nombre}</p>
                  {c.rut && <p className="text-xs text-gray-400">{c.rut}</p>}
                </div>
                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                  {c.total_causas} {c.total_causas === 1 ? 'causa' : 'causas'}
                </span>
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-gray-500">
                {c.telefono && <p>📞 {c.telefono}</p>}
                {c.email && <p>✉️ {c.email}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    </label>
  )
}
