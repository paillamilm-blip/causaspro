// ============================================================
// CAUSASPRO EMAIL INTERCEPTOR - Types
// ============================================================

/** Configuración de conexión IMAP */
export interface ImapConfig {
  host: string          // Servidor IMAP (ej: mail.cajmetro.cl)
  port: number          // Puerto (993 para SSL, 143 para STARTTLS)
  secure: boolean       // true para SSL/TLS
  user: string          // Email completo (pvargas@cajmetro.cl)
  password: string      // Contraseña del correo
}

/** Email parseado */
export interface ParsedEmail {
  id: string            // Message-ID o UID
  from: string          // Remitente
  subject: string       // Asunto
  date: string          // Fecha ISO
  html: string          // Contenido HTML
  text?: string         // Contenido texto plano
}

/** Asignación extraída de la tabla HTML del correo */
export interface AsignacionEmail {
  rit: string           // RIT de la causa (ej: P-8141-2026)
  fecha_audiencia: string | null   // Fecha audiencia (dd/mm/yyyy → ISO)
  fecha_ingreso: string | null     // Fecha ingreso (dd/mm/yyyy → ISO)
  curador: string       // Nombre del curador asignado
}

/** Resultado de procesar un email de asignaciones */
export interface EmailProcessResult {
  email_id: string
  fecha_email: string
  remitente: string
  asignaciones: AsignacionEmail[]
  causas_nuevas: number
  causas_existentes: number
  audiencias_creadas: number
  errores: string[]
}

/** Estado de una ejecución del interceptor */
export interface EmailRunStatus {
  run_id: string
  started_at: string
  finished_at?: string
  emails_revisados: number
  emails_procesados: number
  asignaciones_total: number
  causas_creadas: number
  errores: string[]
}
