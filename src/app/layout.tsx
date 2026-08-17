import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CausasPro - Gestión de Causas Proteccionales',
  description: 'Monitor inteligente de causas para Curadores Ad Litem',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
