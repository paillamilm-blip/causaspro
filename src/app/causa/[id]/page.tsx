'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Causa {
  id: string; rit: string; caratulado: string; tipo: string; estado: string;
  programa_vigente: string; sintesis: string; notas: string; saj: string;
  fecha_apertura: string; updated_at: string;
}
interface Nna {
  id: string; nombre: string; apellido: string; rut: string;
  fecha_nacimiento: string; edad: number; nacionalidad: string;
  direccion: string; colegio: string; curso: string; cesfam: string;
}
interface Adulto {
  id: string; nombre: string; relacion: string; telefono: string; direccion: string;
}
interface Audiencia {
  id: string; fecha: string; tipo: string; notas: string;
}

export default function CausaDetalle() {
  const params = useParams()
  const id = params.id as string
  const [causa, setCausa] = useState<Causa | null>(null)
  const [nnas, setNnas] = useState<Nna[]>([])
  const [adultos, setAdultos] = useState<Adulto[]>([])
  const [audiencias, setAudiencias] = useState<Audiencia[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    const [c, n, a, au] = await Promise.all([
      supabase.from('causas').select('*').eq('id', id).single(),
      supabase.from('nna').select('*').eq('causa_id', id),
      supabase.from('adultos').select('*').eq('causa_id', id),
      supabase.from('audiencias').select('*').eq('causa_id', id).order('fecha', { ascending: true }),
    ])
    if (c.data) setCausa(c.data)
    if (n.data) setNnas(n.data)
    if (a.data) setAdultos(a.data)
    if (au.data) setAudiencias(au.data)
    setLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin text-3xl">⚙️</div>
    </div>
  )

  if (!causa) return (
    <div className="min-h-screen flex items-center justify-center">
      <p>Causa no encontrada</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-600">← Volver</Link>
          <span className="font-mono font-bold">{causa.rit}</span>
          <span className="font-semibold text-gray-700">{causa.caratulado}</span>
          {causa.programa_vigente && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{causa.programa_vigente}</span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Resumen Ejecutivo */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📌 Resumen Ejecutivo</h2>
          <p className="text-gray-600 leading-relaxed">{causa.sintesis || 'Sin síntesis registrada'}</p>
          {causa.estado && (
            <div className="mt-3 text-sm text-gray-500">
              <strong>Estado:</strong> {causa.estado}
            </div>
          )}
        </section>

        {/* NNA */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">👶 NNA en esta causa ({nnas.length})</h2>
          {nnas.length === 0 ? (
            <p className="text-gray-400 text-sm">Sin NNA registrados</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs uppercase border-b">
                    <th className="pb-2 pr-4">Nombre</th>
                    <th className="pb-2 pr-4">Edad</th>
                    <th className="pb-2 pr-4">RUT</th>
                    <th className="pb-2 pr-4">Colegio</th>
                    <th className="pb-2">CESFAM</th>
                  </tr>
                </thead>
                <tbody>
                  {nnas.map(n => (
                    <tr key={n.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{n.nombre} {n.apellido}</td>
                      <td className="py-2 pr-4">{n.edad || '-'}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{n.rut || '-'}</td>
                      <td className="py-2 pr-4 text-xs">{n.colegio || '-'}</td>
                      <td className="py-2 text-xs">{n.cesfam || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Adultos */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">👤 Adultos Responsables</h2>
          {adultos.length === 0 ? (
            <p className="text-gray-400 text-sm">Sin adultos registrados</p>
          ) : (
            <div className="space-y-3">
              {adultos.map(a => (
                <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div>
                    <div className="font-medium text-sm">{a.nombre}</div>
                    {a.relacion && <div className="text-xs text-gray-400">{a.relacion}</div>}
                    {a.direccion && <div className="text-xs text-gray-400 mt-0.5">{a.direccion}</div>}
                  </div>
                  {a.telefono && (
                    <a href={`tel:${a.telefono}`} className="text-blue-600 text-sm font-mono hover:underline">
                      📞 {a.telefono}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Audiencias / Línea de tiempo */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📅 Audiencias</h2>
          {audiencias.length === 0 ? (
            <p className="text-gray-400 text-sm">Sin audiencias registradas</p>
          ) : (
            <div className="space-y-2">
              {audiencias.map(au => {
                const fecha = new Date(au.fecha)
                const esHoy = fecha.toDateString() === new Date().toDateString()
                const esFuturo = fecha > new Date()
                return (
                  <div key={au.id} className={`flex items-center gap-3 p-2 rounded ${esHoy ? 'bg-red-50' : esFuturo ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <span className="text-sm">{esHoy ? '🔴' : esFuturo ? '🔵' : '⚪'}</span>
                    <span className="font-mono text-sm">{fecha.toLocaleDateString('es-CL')}</span>
                    <span className="text-sm text-gray-600">{au.tipo || 'Audiencia'}</span>
                    {au.notas && <span className="text-xs text-gray-400">{au.notas}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Notas/Entrevista */}
        {causa.notas && (
          <section className="bg-white rounded-xl border p-6">
            <h2 className="font-bold text-gray-700 mb-3">📝 Notas / Entrevista</h2>
            <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{causa.notas}</p>
          </section>
        )}
      </main>
    </div>
  )
}
