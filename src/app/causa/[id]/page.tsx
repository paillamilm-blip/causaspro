'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Causa {
  id: string; rit: string; caratulado: string; tipo: string; estado: string;
  programa_vigente: string; sintesis: string; notas: string; saj: string;
  fecha_apertura: string; updated_at: string;
  datos_extra: Record<string, any> | null;
  columnas_origen: string[] | null;
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
      <p className="text-gray-500">Causa no encontrada</p>
    </div>
  )

  // Campos importantes primero, luego el resto
  const camposImportantes = ['rit', 'caratulado', 'estado', 'programa_vigente', 'sintesis', 'fecha_apertura', 'saj', 'notas']
  const datosExtra = causa.datos_extra || {}
  const columnasExtra = Object.keys(datosExtra).filter(k => {
    // Excluir las que ya se muestran como campos importantes
    const lower = k.toLowerCase()
    return !lower.includes('rit') && !lower.includes('nombre') && !lower.includes('apellido')
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-600">← Volver</Link>
          <span className="font-mono font-bold">{causa.rit}</span>
          <span className="font-semibold text-gray-700">{causa.caratulado || ''}</span>
          {causa.programa_vigente && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{causa.programa_vigente}</span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Datos principales */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📌 Información Principal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {causa.rit && <InfoRow label="RIT" value={causa.rit} />}
            {causa.caratulado && <InfoRow label="Caratulado" value={causa.caratulado} />}
            {causa.estado && <InfoRow label="Estado" value={causa.estado} />}
            {causa.programa_vigente && <InfoRow label="Programa" value={causa.programa_vigente} />}
            {causa.tipo && <InfoRow label="Tipo" value={causa.tipo} />}
            {causa.fecha_apertura && <InfoRow label="Fecha Apertura" value={formatFecha(causa.fecha_apertura)} />}
            {causa.saj && <InfoRow label="SAJ" value={causa.saj} />}
          </div>
          {causa.sintesis && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <span className="text-xs font-medium text-gray-500 uppercase">Síntesis</span>
              <p className="text-sm text-gray-700 mt-1">{causa.sintesis}</p>
            </div>
          )}
        </section>

        {/* TODOS los datos extras del Excel */}
        {columnasExtra.length > 0 && (
          <section className="bg-white rounded-xl border p-6">
            <h2 className="font-bold text-gray-700 mb-3">📋 Todos los Datos del Documento</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {columnasExtra.map(col => (
                <InfoRow key={col} label={col} value={String(datosExtra[col])} />
              ))}
            </div>
          </section>
        )}

        {/* NNA */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">👶 NNA ({nnas.length})</h2>
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

        {/* Audiencias */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📅 Audiencias</h2>
          {audiencias.length === 0 ? (
            <p className="text-gray-400 text-sm">Sin audiencias registradas</p>
          ) : (
            <div className="space-y-2">
              {audiencias.map(au => {
                const fecha = new Date(au.fecha)
                const esFuturo = fecha > new Date()
                return (
                  <div key={au.id} className={`flex items-center gap-3 p-2 rounded ${esFuturo ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <span className={`inline-block w-3 h-3 rounded-full ${esFuturo ? 'bg-blue-500' : 'bg-gray-300'}`}></span>
                    <span className="font-mono text-sm">{formatFecha(au.fecha)}</span>
                    <span className="text-sm text-gray-600">{au.tipo || 'Audiencia'}</span>
                    {esFuturo && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Próxima</span>}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Notas */}
        {causa.notas && (
          <section className="bg-white rounded-xl border p-6">
            <h2 className="font-bold text-gray-700 mb-3">📝 Notas</h2>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{causa.notas}</p>
          </section>
        )}

        {/* Meta info */}
        <div className="text-xs text-gray-400 text-center">
          Última actualización: {formatFecha(causa.updated_at)}
        </div>
      </main>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-50">
      <span className="text-gray-400 font-medium min-w-[120px] text-xs uppercase">{label}</span>
      <span className="text-gray-700 text-sm">{value}</span>
    </div>
  )
}

function formatFecha(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
