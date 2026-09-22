import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/email - Estado del interceptor de correo.
 *
 * IMPORTANTE (verificado el 22-sep-2026): el interceptor IMAP de `src/email/` NO puede
 * funcionar contra el buzón de la curadora. El correo de cajmetro.cl está en Microsoft 365
 * (MX → cajmetro-cl.mail.protection.outlook.com, autodiscover → autodiscover.outlook.com) y
 * Microsoft ELIMINÓ la autenticación básica (usuario + contraseña) para IMAP/POP en Exchange
 * Online. `imapClient.ts` se conecta justamente con usuario + contraseña, así que Exchange
 * rechaza la conexión pase lo que pase con IMAP_HOST o IMAP_PASSWORD.
 *
 * Por eso la carga de asignaciones se hace pegando el correo en /asignaciones, que reutiliza
 * el MISMO parser y el MISMO sync que este módulo (lo único distinto es de dónde sale el
 * texto). El código IMAP se conserva porque sigue sirviendo para buzones que sí permiten
 * contraseña, y porque el día que TI de cajmetro habilite Microsoft Graph con OAuth se
 * reemplaza sólo la parte de conexión.
 */
export async function GET() {
  return NextResponse.json({
    interceptor: 'CausasPro Email Interceptor',
    version: '2.0.0',
    estado: '⚠️ El interceptor automático por IMAP no está disponible',
    por_que: [
      'El correo de cajmetro.cl está alojado en Microsoft 365 (Exchange Online).',
      'Microsoft eliminó la autenticación básica (usuario + contraseña) para IMAP y POP.',
      'El módulo src/email/ se conecta con usuario + contraseña, así que Exchange lo rechaza.',
      'No es un problema de configuración: ninguna combinación de IMAP_HOST/IMAP_PASSWORD lo resuelve.',
    ],
    que_hacer_ahora: {
      opcion_recomendada: 'Pegar el correo en la app',
      donde: '/asignaciones',
      pasos: [
        'Abrir el correo ASIGNACIONES del Centro Regional',
        'Ctrl + A para seleccionar todo y Ctrl + C para copiar',
        'Ir a /asignaciones, pegar con Ctrl + V y apretar "Revisar"',
        'Confirmar con "Guardar" (antes muestra qué detectó, sin escribir nada)',
      ],
      nota: 'Sirve también para correos viejos: las causas ya cargadas no se duplican.',
    },
    para_automatizarlo_de_verdad: {
      requiere: 'Microsoft Graph API con OAuth 2.0',
      quien: 'El departamento de TI de cajmetro debe registrar una aplicación en Azure y aprobar el permiso de lectura de correo (Mail.Read).',
      por_que_no_lo_puede_hacer_la_usuaria: 'Requiere permisos de administrador del tenant de Microsoft 365.',
      ventaja: 'El parser y el sync ya están hechos y probados: solo habría que cambiar la forma de obtener los correos.',
    },
    que_hace_el_parser: [
      'Lee la tabla del correo (RIT, FECHA AUD, FECHA ING, CURADOR)',
      'Normaliza los RIT (acepta guion largo y variantes de formato)',
      'Convierte las fechas chilenas dd/mm/yyyy a formato de base de datos',
      'Crea las causas nuevas y agenda las audiencias',
      'No duplica: si el RIT ya existe, solo agrega la nota de asignación y la audiencia',
    ],
  })
}
