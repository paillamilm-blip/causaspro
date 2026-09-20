// ============================================================
// CAUSASPRO EMAIL - IMAP Client Module
// Conecta al servidor de correo y busca emails de ASIGNACIONES
// ============================================================

import { ImapFlow } from 'imapflow'
import type { ImapConfig, ParsedEmail } from '../types'

/**
 * Obtiene configuración IMAP desde variables de entorno
 */
export function getImapConfig(): ImapConfig {
  // Microsoft 365 por defecto (outlook.office365.com). Se puede sobrescribir
  // con IMAP_HOST si el servidor de correo es otro.
  const host = process.env.IMAP_HOST || process.env.EMAIL_HOST || 'outlook.office365.com'
  const port = parseInt(process.env.IMAP_PORT || '993')
  const user = process.env.IMAP_USER || process.env.EMAIL_USER
  const password = process.env.IMAP_PASSWORD || process.env.EMAIL_PASSWORD
  
  if (!user || !password) {
    throw new Error(
      'Configuración IMAP incompleta. Variables requeridas:\n' +
      '  IMAP_HOST (opcional, por defecto outlook.office365.com para Microsoft 365)\n' +
      '  IMAP_USER (ej: pvargas@cajmetro.cl)\n' +
      '  IMAP_PASSWORD (contraseña del correo)'
    )
  }
  
  return {
    host,
    port,
    secure: port === 993,
    user,
    password,
  }
}

/**
 * Conecta al servidor IMAP y busca emails de ASIGNACIONES no leídos
 * del remitente curaduriasnnarnorte@cajmetro.cl
 */
export async function fetchAsignacionEmails(
  config: ImapConfig,
  options: {
    onlyUnread?: boolean      // Solo no leídos (default: true)
    sinceFecha?: Date         // Desde qué fecha buscar
    markAsRead?: boolean      // Marcar como leído después de procesar
    maxEmails?: number        // Máximo emails a procesar
  } = {}
): Promise<ParsedEmail[]> {
  const {
    onlyUnread = true,
    sinceFecha = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Últimos 7 días
    markAsRead = true,
    maxEmails = 20,
  } = options
  
  const emails: ParsedEmail[] = []
  
  console.log(`📧 Conectando a ${config.host}:${config.port}...`)
  
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false, // Silenciar logs de IMAP
  })
  
  try {
    await client.connect()
    console.log('✅ Conectado al servidor IMAP')
    
    // Abrir bandeja de entrada
    const mailbox = await client.mailboxOpen('INBOX')
    console.log(`📬 INBOX: ${mailbox.exists} mensajes totales`)
    
    // Construir query de búsqueda
    const searchCriteria: any = {
      // Buscar emails del remitente de asignaciones
      from: 'cajmetro.cl',
      // Asunto contiene ASIGNACIONES
      subject: 'ASIGNACIONES',
      // Desde fecha
      since: sinceFecha,
    }
    
    if (onlyUnread) {
      searchCriteria.seen = false
    }
    
    // Buscar mensajes
    const messageUids: number[] = []
    
    for await (const msg of client.fetch(
      { from: searchCriteria.from, subject: searchCriteria.subject, since: searchCriteria.since, ...(onlyUnread ? { seen: false } : {}) },
      { uid: true, envelope: true, source: true }
    )) {
      if (messageUids.length >= maxEmails) break
      
      try {
        const envelope = msg.envelope
        const source = msg.source
        
        // Verificar que es del remitente correcto
        const fromAddress = envelope?.from?.[0]?.address || ''
        if (!fromAddress.includes('cajmetro.cl')) continue
        
        // Verificar asunto
        const subject = envelope?.subject || ''
        if (!subject.toUpperCase().includes('ASIGNACION')) continue
        
        // Extraer HTML del email
        const emailContent = source?.toString() || ''
        const html = extractHtmlFromRaw(emailContent)
        
        if (html) {
          emails.push({
            id: msg.uid?.toString() || `msg_${Date.now()}`,
            from: fromAddress,
            subject: subject,
            date: envelope?.date?.toISOString() || new Date().toISOString(),
            html: html,
            text: extractTextFromRaw(emailContent),
          })
          
          messageUids.push(msg.uid!)
          console.log(`  📩 Email encontrado: "${subject}" (${envelope?.date?.toLocaleDateString('es-CL')})`)
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Error procesando mensaje: ${err.message}`)
      }
    }
    
    // Marcar como leídos si se indica
    if (markAsRead && messageUids.length > 0) {
      try {
        for (const uid of messageUids) {
          await client.messageFlagsAdd({ uid: uid.toString() }, ['\\Seen'], { uid: true })
        }
        console.log(`  ✓ ${messageUids.length} emails marcados como leídos`)
      } catch (err: any) {
        console.warn(`  ⚠️ No se pudieron marcar como leídos: ${err.message}`)
      }
    }
    
    console.log(`📧 ${emails.length} emails de ASIGNACIONES encontrados`)
    
  } catch (error: any) {
    console.error(`❌ Error IMAP: ${error.message}`)
    throw error
  } finally {
    try {
      await client.logout()
    } catch {}
  }
  
  return emails
}

/**
 * Versión simplificada: busca emails usando búsqueda básica
 * Compatible con más servidores IMAP
 *
 * Opciones:
 *  - historico: si es true, lee TODO el buzón desde el inicio (leídos y no
 *    leídos) y NO marca como leído. Ideal para la carga inicial de todas las
 *    asignaciones que ya te enviaron. Si es false (default), solo lee los
 *    correos NO leídos de los últimos 7 días y los marca como leídos.
 */
export async function fetchAsignacionEmailsSimple(
  config: ImapConfig,
  options: { historico?: boolean } = {}
): Promise<ParsedEmail[]> {
  const { historico = false } = options
  const emails: ParsedEmail[] = []
  
  console.log(`📧 Conectando a ${config.host}:${config.port}...`)
  if (historico) {
    console.log('🕰️  MODO HISTÓRICO: leyendo TODO el buzón desde el inicio (leídos y no leídos)')
  }
  
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  })
  
  try {
    await client.connect()
    console.log('✅ Conectado')
    
    await client.mailboxOpen('INBOX')
    
    // Criterio de búsqueda:
    //  - Modo normal: últimos 7 días + solo NO leídos
    //  - Modo histórico: TODO el buzón (sin filtro de fecha ni de leído)
    let searchCriteria: Record<string, unknown>
    if (historico) {
      searchCriteria = { all: true }
    } else {
      const since = new Date()
      since.setDate(since.getDate() - 7)
      searchCriteria = { since, seen: false }
    }
    
    for await (const msg of client.fetch(
      searchCriteria,
      { uid: true, envelope: true, source: true }
    )) {
      try {
        const envelope = msg.envelope
        const from = envelope?.from?.[0]?.address || ''
        const subject = envelope?.subject || ''
        
        // Filtrar: solo de cajmetro.cl con subject ASIGNACIONES
        if (!from.toLowerCase().includes('cajmetro.cl')) continue
        if (!subject.toUpperCase().includes('ASIGNACION')) continue
        
        const source = msg.source?.toString() || ''
        const html = extractHtmlFromRaw(source)
        
        if (html) {
          emails.push({
            id: msg.uid?.toString() || `msg_${Date.now()}`,
            from,
            subject,
            date: envelope?.date?.toISOString() || new Date().toISOString(),
            html,
          })
          
          // En modo histórico NO tocamos el estado leído/no leído.
          // En modo normal, marcar como leído para no reprocesar.
          if (!historico) {
            await client.messageFlagsAdd(msg.uid!.toString(), ['\\Seen'], { uid: true })
          }
        }
      } catch {}
    }
    
    await client.logout()
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    try { await client.logout() } catch {}
    throw error
  }
  
  console.log(`📧 ${emails.length} emails de ASIGNACIONES encontrados`)
  return emails
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Extrae el contenido HTML de un email raw (MIME)
 */
function extractHtmlFromRaw(raw: string): string {
  // Buscar la parte HTML en el MIME
  const htmlMatch = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i)
  if (htmlMatch) {
    let html = htmlMatch[1]
    
    // Decodificar si está en base64
    if (raw.includes('Content-Transfer-Encoding: base64')) {
      try {
        html = Buffer.from(html.replace(/\s/g, ''), 'base64').toString('utf-8')
      } catch {}
    }
    
    // Decodificar quoted-printable
    if (raw.includes('Content-Transfer-Encoding: quoted-printable')) {
      html = decodeQuotedPrintable(html)
    }
    
    return html
  }
  
  // Si no hay parte HTML, buscar tablas en el contenido completo
  if (raw.includes('<table') || raw.includes('<TABLE')) {
    const tableMatch = raw.match(/<table[\s\S]*?<\/table>/i)
    if (tableMatch) return tableMatch[0]
  }
  
  return ''
}

/**
 * Extrae texto plano del email
 */
function extractTextFromRaw(raw: string): string {
  const textMatch = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i)
  if (textMatch) return textMatch[1].trim()
  return ''
}

/**
 * Decodifica quoted-printable
 */
function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '') // Líneas continuadas
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}
