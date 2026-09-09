'use client'
import Link from 'next/link'
import CopilotoDecisiones from '@/components/CopilotoDecisiones'

/**
 * Pagina del Copiloto de Decisiones (Fase 2).
 * El corazon del producto: no muestra datos, muestra decisiones.
 */
export default function CopilotoPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <h1 className="text-xl font-bold text-gray-800">Copiloto de Decisiones</h1>
          </div>
          <Link
            href="/"
            className="text-sm bg-gray-100 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-200 transition"
          >
            ← Volver a causas
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <CopilotoDecisiones />
        <p className="text-xs text-gray-400 text-center border-t pt-4">
          ⚖️ Los plazos son referenciales y no consideran feriados móviles ni la fecha exacta de
          notificación. Son una ayuda para priorizar, no reemplazan tu criterio profesional:
          verifica siempre en el expediente.
        </p>
      </main>
    </div>
  )
}
