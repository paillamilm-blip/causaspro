'use client'
import { useState } from 'react'
import Link from 'next/link'
import PanelFinanciero from '@/components/PanelFinanciero'
import Clientes from '@/components/Clientes'

type Tab = 'panel' | 'clientes'

/**
 * Pagina de la capa de negocio: salud financiera del estudio + clientes.
 * El diferenciador del producto (cobro conectado a las causas).
 */
export default function FinanzasPage() {
  const [tab, setTab] = useState<Tab>('panel')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💰</span>
            <h1 className="text-xl font-bold text-gray-800">Finanzas del Estudio</h1>
          </div>
          <Link
            href="/"
            className="text-sm bg-gray-100 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-200 transition"
          >
            ← Volver a causas
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex gap-2 mb-6">
          <TabButton active={tab === 'panel'} onClick={() => setTab('panel')}>
            📊 Panel financiero
          </TabButton>
          <TabButton active={tab === 'clientes'} onClick={() => setTab('clientes')}>
            👥 Clientes
          </TabButton>
        </div>

        {tab === 'panel' ? <PanelFinanciero /> : <Clientes />}
      </main>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`text-sm px-4 py-2 rounded-lg transition ${
        active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}
