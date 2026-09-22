'use client'

// ============================================================
// CAUSASPRO - Pantalla: cargar asignaciones pegando el correo
// ------------------------------------------------------------
// Paula abre el correo de ASIGNACIONES, hace Ctrl+A / Ctrl+C y lo pega acá.
//
// Detalle técnico importante: al pegar en un <textarea> el navegador se queda
// SOLO con el texto plano y se pierde la tabla HTML. Por eso el onPaste lee
// además `text/html` del portapapeles y lo guarda aparte: así el servidor puede
// parsear la tabla (mucho más fiable) y usar el texto solo como respaldo.
//
// Siempre muestra una VISTA PREVIA antes de guardar: la curadora confirma qué
// se detectó y qué causas son nuevas. Nada se escribe sin que ella apriete
// "Guardar".
// ============================================================

import { useState } from 'react'
import Link from 'next/link'

interface AsignacionPrevia {
  rit: string
  fecha_audiencia: string | null
  fecha_ingreso: string | null
  curador: string
  yaExiste: boolean
}

interface Previa {
  origen: string
  asignaciones: AsignacionPrevia[]
  total: number
  nuevas: number
  existentes: number
  sin_fecha_audiencia: number
}

interface Guardado {
  causas_nuevas: number
  causas_existentes: number
  audiencias_creadas: number
  errores: string[]
}

/** Muestra una fecha ISO (yyyy-mm-dd) como dd/mm/yyyy, o un guion si no hay. */
function fmt(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

export default function AsignacionesPage() {
  const [texto, setTexto] = useState('')
  // HTML del portapapeles (conserva la <table> del correo). Puede quedar vacío si
  // se copió desde un cliente que solo entrega texto.
  const [html, setHtml] = useState('')
  const [cargando, setCargando] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [guardado, setGuardado] = useState<Guardado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pista, setPista] = useState<string | null>(null)

  function limpiar() {
    setTexto('')
    setHtml('')
    setPrevia(null)
    setGuardado(null)
    setError(null)
    setPista(null)
  }

  async function llamar(confirmar: boolean) {
    setCargando(true)
    setError(null)
    setPista(null)
    try {
      const token = process.env.NEXT_PUBLIC_REPORTE_TOKEN
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      const res = await fetch(`/api/asignaciones${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido: html || texto, contenidoTexto: texto, confirmar }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`)
        if (data?.pista) setPista(data.pista)
        if (!confirmar) setPrevia(null)
        return
      }
      if (confirmar) {
        setGuardado(data)
        setPrevia(null)
      } else {
        setPrevia(data)
        setGuardado(null)
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo conectar con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📥</span>
            <h1 className="text-xl font-bold text-gray-800">Cargar asignaciones</h1>
          </div>
          <Link href="/" className="text-sm bg-gray-100 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-200 transition">
            ← Volver
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Instrucciones: la usuaria no es programadora, así que van numeradas y concretas. */}
        <section className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h2 className="font-bold text-blue-900 mb-2">Cómo cargar las causas que te asignaron</h2>
          <ol className="text-sm text-blue-900 space-y-1 list-decimal list-inside">
            <li>Abrí el correo <strong>ASIGNACIONES</strong> que te manda el Centro Regional.</li>
            <li>Apretá <strong>Ctrl + A</strong> (selecciona todo) y después <strong>Ctrl + C</strong> (copia).</li>
            <li>Volvé acá, hacé clic en el cuadro de abajo y apretá <strong>Ctrl + V</strong> (pega).</li>
            <li>Apretá <strong>Revisar</strong>. Te voy a mostrar qué causas detecté, sin guardar nada todavía.</li>
            <li>Si está todo bien, apretá <strong>Guardar</strong>.</li>
          </ol>
          <p className="text-xs text-blue-700 mt-3">
            Podés hacerlo con correos viejos también: si una causa ya estaba cargada, no se duplica.
          </p>
        </section>

        {/* Cuadro para pegar */}
        <section className="bg-white rounded-xl border p-5">
          <label htmlFor="pegado" className="block font-semibold text-gray-700 mb-2">
            Pegá el correo acá
          </label>
          <textarea
            id="pegado"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              // Si la usuaria EDITA el texto a mano, el HTML guardado ya no corresponde
              // a lo que se ve en pantalla, así que se descarta para no parsear algo viejo.
              setHtml('')
              setPrevia(null)
              setGuardado(null)
            }}
            onPaste={(e) => {
              // Rescatar la tabla HTML del portapapeles antes de que el textarea la tire.
              // No se hace preventDefault: el textarea igual muestra el texto plano.
              const h = e.clipboardData?.getData('text/html') || ''
              if (h) setHtml(h)
              setPrevia(null)
              setGuardado(null)
            }}
            rows={10}
            placeholder="Acá aparece el correo cuando lo pegues con Ctrl + V…"
            className="w-full border rounded-lg p-3 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              onClick={() => llamar(false)}
              disabled={cargando || (!texto.trim() && !html.trim())}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {cargando && !previa ? 'Revisando…' : '🔍 Revisar'}
            </button>
            {(texto || html) && (
              <button
                onClick={limpiar}
                className="bg-gray-100 text-gray-600 px-4 py-2.5 rounded-lg text-sm hover:bg-gray-200 transition"
              >
                Limpiar
              </button>
            )}
            {html && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">
                ✓ Se copió la tabla del correo
              </span>
            )}
          </div>
        </section>

        {/* Error */}
        {error && (
          <section className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm text-red-800 font-medium">{error}</p>
            {pista && <p className="text-sm text-red-700 mt-2">{pista}</p>}
          </section>
        )}

        {/* Vista previa: nada guardado todavía */}
        {previa && (
          <section className="bg-white rounded-xl border p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="font-bold text-gray-800">
                  Detecté {previa.total} {previa.total === 1 ? 'asignación' : 'asignaciones'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  <strong className="text-green-700">{previa.nuevas} nuevas</strong>
                  {previa.existentes > 0 && <> · {previa.existentes} ya estaban cargadas</>}
                  {previa.sin_fecha_audiencia > 0 && <> · {previa.sin_fecha_audiencia} sin fecha de audiencia</>}
                </p>
                <p className="text-xs text-gray-400 mt-1">Todavía no se guardó nada.</p>
              </div>
              <button
                onClick={() => llamar(true)}
                disabled={cargando}
                className="bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-40"
              >
                {cargando ? 'Guardando…' : '💾 Guardar'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4 font-medium">RIT</th>
                    <th className="py-2 pr-4 font-medium">Audiencia</th>
                    <th className="py-2 pr-4 font-medium">Ingreso</th>
                    <th className="py-2 pr-4 font-medium">Curador</th>
                    <th className="py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.asignaciones.map((a) => (
                    <tr key={a.rit} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-gray-800">{a.rit}</td>
                      <td className="py-2 pr-4 text-gray-600">{fmt(a.fecha_audiencia)}</td>
                      <td className="py-2 pr-4 text-gray-600">{fmt(a.fecha_ingreso)}</td>
                      <td className="py-2 pr-4 text-gray-600">{a.curador || '—'}</td>
                      <td className="py-2">
                        {a.yaExiste ? (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">ya estaba</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">nueva</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Resultado del guardado */}
        {guardado && (
          <section className="bg-green-50 border border-green-200 rounded-xl p-5">
            <h2 className="font-bold text-green-900 mb-2">✅ Listo, quedó guardado</h2>
            <ul className="text-sm text-green-900 space-y-1">
              <li><strong>{guardado.causas_nuevas}</strong> causas nuevas creadas</li>
              <li><strong>{guardado.causas_existentes}</strong> causas que ya estaban (se les agregó la nota de asignación)</li>
              <li><strong>{guardado.audiencias_creadas}</strong> audiencias agendadas</li>
            </ul>
            {guardado.errores?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-sm font-medium text-amber-800">Algunas filas dieron problema:</p>
                <ul className="text-xs text-amber-700 list-disc list-inside mt-1">
                  {guardado.errores.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <Link href="/" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition">
                Ver el dashboard
              </Link>
              <button onClick={limpiar} className="bg-white text-green-700 border border-green-300 px-4 py-2 rounded-lg text-sm hover:bg-green-50 transition">
                Cargar otro correo
              </button>
            </div>
            <p className="text-xs text-green-700 mt-3">
              Las causas nuevas quedan sin datos del portal. Corré <strong>bot-mantenimiento.bat</strong> para que el bot les traiga los movimientos.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
