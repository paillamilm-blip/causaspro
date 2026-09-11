// ============================================================
// CAUSASPRO - Carga de variables de entorno desde .env (sin dependencias)
// ------------------------------------------------------------
// PROBLEMA: el bot y las utilidades se ejecutan con `tsx src/...`, que —a
// diferencia de `next`— NO carga automáticamente el archivo .env. Por eso, al
// abrir una ventana nueva de terminal, faltaban SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / PJUD_* y todo fallaba con "... son requeridas".
//
// SOLUCIÓN: este módulo lee el .env de la RAÍZ del proyecto y puebla
// process.env con las claves que AÚN no estén definidas. Importarlo primero
// (import './loadEnv') en los entrypoints CLI resuelve el problema para siempre.
//
// DISEÑO (deliberado):
//   - CERO dependencias (no requiere instalar dotenv): parser propio mínimo.
//   - NO pisa variables ya presentes en el entorno → en CI/produccion, donde
//     las vars vienen del entorno real (GitHub Actions secrets), el .env
//     inexistente no molesta y las vars reales mandan.
//   - Silencioso y defensivo: si no hay .env, no pasa nada.
// ============================================================

import * as fs from 'fs'
import * as path from 'path'

/**
 * Carga el .env de la raíz del proyecto en process.env (solo claves ausentes).
 * @param archivo nombre del archivo (por defecto ".env" en process.cwd()).
 * @returns número de variables efectivamente cargadas.
 */
export function loadEnv(archivo = '.env'): number {
  const ruta = path.isAbsolute(archivo) ? archivo : path.join(process.cwd(), archivo)
  let contenido: string
  try {
    if (!fs.existsSync(ruta)) return 0
    contenido = fs.readFileSync(ruta, 'utf8')
  } catch {
    return 0
  }

  let cargadas = 0
  for (const lineaRaw of contenido.split(/\r?\n/)) {
    const linea = lineaRaw.trim()
    // Ignorar vacías y comentarios (#). Soportar el prefijo "export ".
    if (!linea || linea.startsWith('#')) continue
    const sinExport = linea.startsWith('export ') ? linea.slice(7).trim() : linea

    const idx = sinExport.indexOf('=')
    if (idx <= 0) continue // sin "=" o clave vacía → línea inválida, se ignora

    const clave = sinExport.slice(0, idx).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clave)) continue // nombre de var inválido

    let valor = sinExport.slice(idx + 1).trim()
    const entrecomillado =
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    if (entrecomillado) {
      // Valor entre comillas: se toma literal (permite espacios y '#' internos).
      valor = valor.slice(1, -1)
    } else {
      // Valor SIN comillas: quitar un comentario inline al final (" #...").
      // (dotenv hace lo mismo; nuestro .env es plano, esto solo lo hace robusto.)
      const hash = valor.indexOf(' #')
      if (hash !== -1) valor = valor.slice(0, hash).trim()
    }

    // NO pisar lo que ya venga del entorno real (CI/producción manda). Se usa
    // "=== undefined" (no "!valor") a propósito: una var exportada vacía (KEY=)
    // TAMBIÉN debe ganar sobre el .env. No cambiar a !process.env[clave].
    if (process.env[clave] === undefined) {
      process.env[clave] = valor
      cargadas++
    }
  }
  return cargadas
}

// Efecto de importación: cargar el .env apenas se importe este módulo.
loadEnv()
