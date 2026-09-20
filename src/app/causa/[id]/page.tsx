'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { materiaDeTipo, materiaDeRit, GRUPO_LABEL } from '@/lib/materiasFamilia'
import { estadoSeguimientoNna, textoSeguimientoNna, DIAS_UMBRAL_SEGUIMIENTO } from '@/lib/seguimientoNna'

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
interface Gestion {
  id: string; fecha: string; tipo: string; contenido: string; created_at: string;
}
// Movimiento del expediente (lo captura el bot desde el portal). Permite a Paula leer
// qué pasó en cada trámite/resolución SIN entrar a la OJV. `descripcion` es el detalle
// que trae el portal (una línea), no el documento/PDF completo de la resolución.
interface Movimiento {
  id: string; fecha: string | null; etapa: string | null; tramite: string;
  descripcion: string | null; es_traslado_curador: boolean | null;
}

// Tipos de gestión de curaduría (los que Paula registra). El primero es el más frecuente.
const TIPOS_GESTION = [
  'Entrevista al NNA',
  'Coordinación con programa',
  'Contacto con adulto responsable',
  'Presentación de escrito',
  'Otra gestión',
] as const

export default function CausaDetalle() {
  const params = useParams()
  const id = params.id as string
  const [causa, setCausa] = useState<Causa | null>(null)
  const [nnas, setNnas] = useState<Nna[]>([])
  const [adultos, setAdultos] = useState<Adulto[]>([])
  const [audiencias, setAudiencias] = useState<Audiencia[]>([])
  const [gestiones, setGestiones] = useState<Gestion[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(true)
  // Formulario de nueva gestión de curaduría.
  const [gestionTipo, setGestionTipo] = useState<string>(TIPOS_GESTION[0])
  const [gestionFecha, setGestionFecha] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [gestionNota, setGestionNota] = useState('')
  const [guardandoGestion, setGuardandoGestion] = useState(false)
  const [gestionError, setGestionError] = useState<string | null>(null)
  // Análisis estratégico IA (bajo demanda, no se carga solo).
  const [analisis, setAnalisis] = useState<{ resumen: string; proximoPaso: string; riesgo: string; acciones?: string[]; preguntasPrograma?: string[]; resumenCausa?: string; resumenProgramas?: string } | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [analisisError, setAnalisisError] = useState<string | null>(null)

  async function pedirAnalisisIA() {
    setAnalizando(true)
    setAnalisisError(null)
    setAnalisis(null)
    try {
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const res = await fetch(`/api/analisis/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
      const data = await res.json()
      if (!res.ok) {
        setAnalisisError(data?.error || 'No se pudo generar el análisis.')
      } else {
        setAnalisis({ resumen: data.resumen, proximoPaso: data.proximoPaso, riesgo: data.riesgo, acciones: data.acciones, preguntasPrograma: data.preguntasPrograma, resumenCausa: data.resumenCausa, resumenProgramas: data.resumenProgramas })
      }
    } catch {
      setAnalisisError('Error de conexión al generar el análisis.')
    } finally {
      setAnalizando(false)
    }
  }

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    const [c, n, a, au, g, m] = await Promise.all([
      supabase.from('causas').select('*').eq('id', id).single(),
      supabase.from('nna').select('*').eq('causa_id', id),
      supabase.from('adultos').select('*').eq('causa_id', id),
      supabase.from('audiencias').select('*').eq('causa_id', id).order('fecha', { ascending: true }),
      supabase.from('gestiones').select('*').eq('causa_id', id).order('fecha', { ascending: false }),
      // Movimientos del expediente (los captura el bot): fecha/etapa/trámite/descripción.
      // Más reciente primero. Si la tabla no existe o falla, se ignora (m.error) y la
      // sección muestra "sin movimientos" — no rompe el resto del detalle.
      supabase.from('movimientos').select('id, fecha, etapa, tramite, descripcion, es_traslado_curador').eq('causa_id', id).order('fecha', { ascending: false }),
    ])
    if (c.data) setCausa(c.data)
    if (n.data) setNnas(n.data)
    if (a.data) setAdultos(a.data)
    if (au.data) setAudiencias(au.data)
    if (g.data) setGestiones(g.data as Gestion[])
    if (m.data) setMovimientos(m.data as Movimiento[])
    setLoading(false)
  }

  // Registra una gestión de curaduría (entrevista, coordinación, etc.) en la tabla `gestiones`.
  async function guardarGestion(e: React.FormEvent) {
    e.preventDefault()
    if (!gestionNota.trim()) { setGestionError('Escribí una nota para la gestión.'); return }
    setGuardandoGestion(true)
    setGestionError(null)
    const { data, error } = await supabase
      .from('gestiones')
      .insert({ causa_id: id, tipo: gestionTipo, fecha: gestionFecha, contenido: gestionNota.trim() })
      .select()
      .single()
    if (error) {
      setGestionError('No se pudo guardar la gestión. Intentá de nuevo.')
      console.warn('guardarGestion:', error.message)
    } else if (data) {
      setGestiones(prev => [data as Gestion, ...prev]) // insertar arriba (más reciente)
      setGestionNota('')
      setGestionFecha(new Date().toISOString().slice(0, 10))
    }
    setGuardandoGestion(false)
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

  // Materia de la causa: se deriva del `tipo` (letra) y, si no lo hubiera, del RIT.
  // Nunca se inventa — si la letra no está en el catálogo, queda undefined.
  const materiaCausa = materiaDeTipo(causa.tipo) || materiaDeRit(causa.rit)

  // Estado del seguimiento del NNA: vencido si pasaron >180 días desde la última
  // "Entrevista al NNA" o si nunca se registró una. Se calcula sobre las gestiones ya
  // cargadas (bitácora de curaduría). Alimenta el aviso destacado de más abajo.
  const segNna = estadoSeguimientoNna(gestiones)

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
          {/* Análisis estratégico IA (bajo demanda): llama /api/analisis/[id], que arma un
              contexto SOLO procesal (sin nombres/RUT ni cuerpo de resoluciones) y lo manda
              a la IA. Devuelve resumen + próximo paso sugerido + riesgo. */}
          <button
            onClick={pedirAnalisisIA}
            disabled={analizando}
            className="ml-auto text-sm bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-60"
          >
            {analizando ? '🧠 Analizando…' : '🧠 Asesor de Curaduría IA'}
          </button>
          {/* Minuta de audiencia de revisión: descarga un .docx con el formato estricto
              de la curaduría (RIT + NNA precargados, el resto en blanco para completar a
              mano). Salida nueva e independiente del reporte. Mismo token de descarga. */}
          <a
            href={`/api/minuta/${id}${process.env.NEXT_PUBLIC_REPORTE_TOKEN ? `?token=${encodeURIComponent(process.env.NEXT_PUBLIC_REPORTE_TOKEN)}` : ''}`}
            className="text-sm bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            📝 Minuta de audiencia (Word)
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* AVISO: seguimiento del NNA vencido (Feature 1/5). Se muestra arriba de todo
            cuando pasaron más de 180 días desde la última "Entrevista al NNA" o cuando
            nunca se registró una. Es el recordatorio central de la curaduría: ver al NNA. */}
        {segNna.vencido && (
          <section className="bg-rose-50 border border-rose-300 rounded-xl p-5" role="alert">
            <div className="flex items-start gap-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-700 shrink-0 text-lg" aria-hidden="true">👁️</span>
              <div className="min-w-0">
                <h2 className="font-bold text-rose-900">Seguimiento del NNA vencido</h2>
                <p className="text-sm text-rose-800 mt-0.5">
                  {segNna.nunca
                    ? 'Todavía no registraste ninguna "Entrevista al NNA" en esta causa.'
                    : `La última "Entrevista al NNA" fue el ${formatFecha(segNna.ultimaFecha)} (hace ${segNna.diasDesdeUltima} días).`}
                  {' '}Como curadora conviene ver/entrevistar al NNA al menos cada {DIAS_UMBRAL_SEGUIMIENTO} días.
                </p>
                <p className="text-xs text-rose-700/80 mt-2">
                  Registrá la entrevista en <strong>Gestiones de curaduría</strong> (más abajo) para poner al día el seguimiento.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Análisis estratégico IA (bajo demanda) */}
        {(analizando || analisis || analisisError) && (
          <section className="bg-purple-50 rounded-xl border border-purple-200 p-6">
            <h2 className="font-bold text-purple-800 mb-3">🧠 Asesor de Curaduría IA</h2>
            {analizando && (
              <p className="text-sm text-purple-600">Analizando la protección del NNA y el cumplimiento de la medida…</p>
            )}
            {analisisError && (
              <p className="text-sm text-red-600">{analisisError}</p>
            )}
            {analisis && (
              <div className="space-y-3 text-sm">
                {analisis.resumenCausa && (
                  <div>
                    <span className="text-xs font-semibold text-purple-500 uppercase">Resumen actual de la causa</span>
                    <p className="text-gray-700 mt-0.5">{analisis.resumenCausa}</p>
                  </div>
                )}
                {analisis.resumenProgramas && (
                  <div>
                    <span className="text-xs font-semibold text-purple-500 uppercase">Qué dicen / piden los programas</span>
                    <p className="text-gray-700 mt-0.5">{analisis.resumenProgramas}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs font-semibold text-purple-500 uppercase">Estado de la protección</span>
                  <p className="text-gray-700 mt-0.5">{analisis.resumen}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-purple-500 uppercase">Gestiones de curaduría sugeridas</span>
                  {analisis.acciones && analisis.acciones.length > 0 ? (
                    <ol className="mt-1 space-y-1 list-decimal list-inside text-gray-700">
                      {analisis.acciones.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-gray-700 mt-0.5">✅ {analisis.proximoPaso}</p>
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold text-purple-500 uppercase">Alerta de cumplimiento / riesgo del NNA</span>
                  <p className="text-gray-700 mt-0.5">⚠️ {analisis.riesgo}</p>
                </div>
                {analisis.preguntasPrograma && analisis.preguntasPrograma.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-purple-500 uppercase">Preguntas para el programa</span>
                    <ul className="mt-1 space-y-1 list-disc list-inside text-gray-700">
                      {analisis.preguntasPrograma.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                  ⚠️ <strong>Sugerencia generada por IA con enfoque de curaduría</strong> a partir de los
                  movimientos del portal. Es una lectura preliminar orientativa centrada en el interés
                  superior del NNA: <strong>revísala con tu criterio profesional</strong>. NO reemplaza tu
                  decisión ni verifica plazos.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Datos principales */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📌 Información Principal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {causa.rit && <InfoRow label="RIT" value={causa.rit} />}
            {causa.caratulado && <InfoRow label="Caratulado" value={causa.caratulado} />}
            {causa.estado && <InfoRow label="Estado" value={causa.estado} />}
            {causa.programa_vigente && <InfoRow label="Programa" value={causa.programa_vigente} />}
            {causa.tipo && <InfoRow label="Tipo" value={causa.tipo} />}
            {materiaCausa && <InfoRow label="Materia" value={`${materiaCausa.materia} · ${GRUPO_LABEL[materiaCausa.grupo]}`} />}
            {causa.fecha_apertura && <InfoRow label="Fecha Apertura" value={formatFecha(causa.fecha_apertura)} />}
            {causa.saj && <InfoRow label="SAJ" value={causa.saj} />}
          </div>
          {materiaCausa && (
            <div className="mt-3 text-xs text-gray-500">{materiaCausa.descripcion}</div>
          )}
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

        {/* Movimientos del expediente (los captura el bot desde el portal). Permite leer
            qué pasó en cada trámite/resolución SIN entrar a la OJV. Muestra la descripción
            que trae el portal (no el documento/PDF completo). Más reciente primero. */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">📜 Movimientos del expediente ({movimientos.length})</h2>
          {movimientos.length === 0 ? (
            <p className="text-gray-400 text-sm">
              Sin movimientos cargados todavía. El bot los completa al revisar la causa en el portal.
            </p>
          ) : (
            <ol className="relative border-l border-gray-200 ml-2 space-y-4">
              {movimientos.map(m => (
                <li key={m.id} className="ml-4">
                  <span className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-white ${m.es_traslado_curador ? 'bg-red-500' : 'bg-gray-400'}`}></span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-gray-500">{formatFecha(m.fecha)}</span>
                    {m.etapa && <span className="text-xs text-gray-400">{m.etapa}</span>}
                    <span className="text-sm font-semibold text-gray-700">{m.tramite}</span>
                    {m.es_traslado_curador && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Traslado al curador</span>
                    )}
                  </div>
                  {m.descripcion && (
                    <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{m.descripcion}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-gray-400 mt-4 border-t border-gray-100 pt-3">
            Se muestra el detalle que registra el portal en cada movimiento. Para el documento
            completo de una resolución, todavía hay que abrirla en la Oficina Judicial Virtual.
          </p>
        </section>

        {/* Gestiones de curaduría (bitácora propia de Paula) */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-700 mb-3">🗂️ Gestiones de curaduría</h2>

          {/* Formulario para registrar una gestión */}
          <form onSubmit={guardarGestion} className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de gestión</label>
                <select
                  value={gestionTipo}
                  onChange={e => setGestionTipo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-300 outline-none"
                >
                  {TIPOS_GESTION.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
                <input
                  type="date"
                  value={gestionFecha}
                  onChange={e => setGestionFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-300 outline-none"
                />
              </div>
            </div>
            <textarea
              value={gestionNota}
              onChange={e => setGestionNota(e.target.value)}
              placeholder="¿Qué hiciste? Ej: Entrevisté al NNA en el colegio; se observa adaptado. Coordiné con el PPF para informe actualizado."
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-300 outline-none resize-y"
            />
            {gestionError && <p className="text-xs text-red-600 mt-1">{gestionError}</p>}
            <div className="flex justify-end mt-3">
              <button
                type="submit"
                disabled={guardandoGestion}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                {guardandoGestion ? 'Guardando…' : 'Registrar gestión'}
              </button>
            </div>
          </form>

          {/* Bitácora de gestiones registradas */}
          {gestiones.length === 0 ? (
            <p className="text-slate-400 text-sm">Aún no registraste gestiones en esta causa.</p>
          ) : (
            <ol className="relative border-l border-slate-200 ml-2 space-y-4">
              {gestiones.map(g => (
                <li key={g.id} className="ml-4">
                  <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-slate-400 border-2 border-white"></span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-700">{g.tipo || 'Gestión'}</span>
                    <span className="text-xs text-slate-400 font-mono">{formatFecha(g.fecha)}</span>
                  </div>
                  {g.contenido && <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{g.contenido}</p>}
                </li>
              ))}
            </ol>
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
  // Un DATE puro ("2026-09-15") se parsea como medianoche UTC y en huso de Chile
  // retrocedería un día. Si el valor es solo fecha (sin hora), lo construimos como
  // fecha LOCAL para mostrar el día correcto. Si trae hora (timestamptz), va normal.
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = soloFecha
    ? (() => { const [y, m, dd] = iso.split('-').map(Number); return new Date(y, m - 1, dd) })()
    : new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
