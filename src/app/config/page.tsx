'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ConfigItem {
  clave: string
  valor: string | null
  encriptado: boolean
  descripcion: string | null
  tiene_valor: boolean
}

export default function ConfigPage() {
  const [configs, setConfigs] = useState<ConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    setLoading(true)
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      if (data.configs) {
        setConfigs(data.configs)
        // Inicializar form con valores existentes (no encriptados)
        const values: Record<string, string> = {}
        for (const c of data.configs) {
          values[c.clave] = c.encriptado ? '' : (c.valor || '')
        }
        setFormValues(values)
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Error cargando configuración' })
    }
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    
    try {
      // Solo enviar valores que cambiaron
      const toSave: Record<string, string> = {}
      for (const [key, val] of Object.entries(formValues)) {
        if (val && val !== '••••••••') {
          toSave[key] = val
        }
      }
      
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs: toSave }),
      })
      
      const data = await res.json()
      
      if (data.ok) {
        setMessage({ type: 'success', text: '✅ Configuración guardada correctamente' })
        loadConfig() // Recargar
      } else {
        setMessage({ type: 'error', text: `Error: ${data.error}` })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    }
    
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin text-3xl">⚙️</div>
      </div>
    )
  }

  // Agrupar configs por sección
  const pjudConfigs = configs.filter(c => c.clave.startsWith('pjud_'))
  const imapConfigs = configs.filter(c => c.clave.startsWith('imap_'))
  const botConfigs = configs.filter(c => c.clave.startsWith('bot_') || c.clave === 'nombre_curador')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600">← Volver</Link>
            <h1 className="font-bold text-lg">⚙️ Configuración</h1>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : '💾 Guardar todo'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Mensaje */}
        {message && (
          <div className={`p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {message.text}
          </div>
        )}

        {/* Sección PJUD */}
        <section className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🏛️</span>
            <div>
              <h2 className="font-bold text-gray-800">Portal Poder Judicial (OJV)</h2>
              <p className="text-sm text-gray-500">Credenciales para el bot de consulta automática</p>
            </div>
          </div>
          
          <div className="space-y-4">
            {pjudConfigs.map(config => (
              <ConfigField
                key={config.clave}
                config={config}
                value={formValues[config.clave] || ''}
                onChange={(val) => setFormValues(prev => ({ ...prev, [config.clave]: val }))}
              />
            ))}
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
            <strong>ℹ️ Nota:</strong> Las contraseñas se guardan encriptadas. El bot usa estos datos para consultar tus causas en oficinajudicialvirtual.pjud.cl
          </div>
        </section>

        {/* Sección Email */}
        <section className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">📧</span>
            <div>
              <h2 className="font-bold text-gray-800">Correo electrónico (IMAP)</h2>
              <p className="text-sm text-gray-500">Para interceptar emails de asignación de causas</p>
            </div>
          </div>
          
          <div className="space-y-4">
            {imapConfigs.map(config => (
              <ConfigField
                key={config.clave}
                config={config}
                value={formValues[config.clave] || ''}
                onChange={(val) => setFormValues(prev => ({ ...prev, [config.clave]: val }))}
              />
            ))}
          </div>
          
          <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-700">
            <strong>💡 Tip:</strong> Si no sabes el servidor IMAP, prueba con <code>mail.tudominio.cl</code> o pregunta al área de TI de tu institución.
          </div>
        </section>

        {/* Sección Bot */}
        <section className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="font-bold text-gray-800">Configuración del Bot</h2>
              <p className="text-sm text-gray-500">Horarios y parámetros de ejecución</p>
            </div>
          </div>
          
          <div className="space-y-4">
            {botConfigs.map(config => (
              <ConfigField
                key={config.clave}
                config={config}
                value={formValues[config.clave] || ''}
                onChange={(val) => setFormValues(prev => ({ ...prev, [config.clave]: val }))}
              />
            ))}
          </div>
        </section>

        {/* Estado del sistema */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="font-bold text-gray-800 mb-4">📊 Estado del Sistema</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-600">Bot PJUD</div>
              <div className="text-xs text-gray-400">Ejecuta: 1:30 PM + 2:00 AM (Lun-Vie)</div>
              <div className={`mt-1 text-xs font-medium ${pjudConfigs.some(c => c.tiene_valor) ? 'text-green-600' : 'text-red-500'}`}>
                {pjudConfigs.some(c => c.tiene_valor) ? '✅ Credenciales configuradas' : '❌ Sin credenciales'}
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-600">Email Interceptor</div>
              <div className="text-xs text-gray-400">Revisa: cada 30 min (Lun-Vie)</div>
              <div className={`mt-1 text-xs font-medium ${imapConfigs.some(c => c.tiene_valor) ? 'text-green-600' : 'text-red-500'}`}>
                {imapConfigs.some(c => c.tiene_valor) ? '✅ Email configurado' : '❌ Sin configurar'}
              </div>
            </div>
          </div>
        </section>

        {/* Botón guardar (bottom) */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 shadow-lg"
          >
            {saving ? '⏳ Guardando...' : '💾 Guardar configuración'}
          </button>
        </div>
      </main>
    </div>
  )
}

function ConfigField({ config, value, onChange }: { 
  config: ConfigItem
  value: string
  onChange: (val: string) => void 
}) {
  const label = formatLabel(config.clave)
  const isPassword = config.encriptado
  const placeholder = config.tiene_valor && isPassword ? '••••••••' : (config.descripcion || '')
  
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {config.tiene_valor && (
          <span className="ml-2 text-xs text-green-500">✓ configurado</span>
        )}
      </label>
      <input
        type={isPassword ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white"
      />
      {config.descripcion && (
        <p className="mt-1 text-xs text-gray-400">{config.descripcion}</p>
      )}
    </div>
  )
}

function formatLabel(clave: string): string {
  const labels: Record<string, string> = {
    pjud_rut: '🪪 RUT (Portal PJUD)',
    pjud_password: '🔑 Contraseña (Portal PJUD)',
    imap_host: '🖥️ Servidor IMAP',
    imap_user: '📧 Email',
    imap_password: '🔑 Contraseña del correo',
    imap_port: '🔌 Puerto IMAP',
    bot_max_causas: '📊 Causas por sesión',
    bot_horario_1: '⏰ Horario ejecución 1',
    bot_horario_2: '⏰ Horario ejecución 2',
    nombre_curador: '👤 Tu nombre completo',
  }
  return labels[clave] || clave
}
