// ============================================================
// CAUSASPRO - Generador de MINUTA DE AUDIENCIA DE REVISIÓN (.docx)
// ------------------------------------------------------------
// Arma la minuta que la curadora lleva a la audiencia de revisión, siguiendo
// ESTRICTAMENTE el formato entregado por la usuaria:
//
//   MINUTA AUDIENCIA DE REVISIÓN
//   RIT DE LA CAUSA:   [precargado]
//   NOMBRE DE NNA:     [precargado — nombre + edad de cada NNA]
//   HORA INICIO:       [en blanco, se llena en la audiencia]
//   HORA TERMINO:      [en blanco]
//   ANTECEDENTES DE LA CAUSA:   (tabla para completar a mano)
//   MEDIDAS CAUTELARES:         (tabla para completar a mano)
//   ENTREVISTA CON NNA:         (líneas en blanco)
//   SOLICITUDES POR PARTE DE LA CURADURÍA: (líneas en blanco)
//
// CRITERIO (Opción A): solo se PRECARGAN datos objetivos que no requieren
// interpretación (RIT + nombre/edad de NNA). Todo lo que es criterio profesional
// (antecedentes narrados, medidas a discutir, entrevista, solicitudes) queda EN
// BLANCO para que la curadora lo redacte. La app NO inventa contenido.
//
// Es una función PURA de datos → Buffer: no toca la BD ni el navegador. La ruta
// API (/api/minuta/[id]) lee de Supabase y le pasa los datos ya listos.
// Es una salida NUEVA E INDEPENDIENTE del "Reporte de curaduría" (reporteWord.ts).
// ============================================================

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'

// --- Tipos de entrada (subconjunto de las tablas de la BD) ---
export interface MinutaNna {
  nombre?: string | null
  apellido?: string | null
  edad?: number | null
}

export interface MinutaCausa {
  rit: string
}

export interface MinutaData {
  causa: MinutaCausa
  nna: MinutaNna[]
}

// --- Formato ---
const NEGRO = '000000'
const GRIS = '595959'
const LINEA = 'BFBFBF'

// Etiqueta en negrita (para los campos de cabecera "RIT DE LA CAUSA:", etc.).
function etiquetaValor(label: string, value?: string | null): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22, color: NEGRO }),
      new TextRun({ text: value && value.trim() ? value : '', size: 22, color: NEGRO }),
    ],
  })
}

// Título de sección en mayúsculas, negrita, con borde inferior (como el formato).
function seccion(titulo: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { bottom: { color: NEGRO, size: 6, style: BorderStyle.SINGLE, space: 2 } },
    children: [new TextRun({ text: titulo, bold: true, size: 22, color: NEGRO })],
  })
}

// Línea en blanco para escribir a mano (borde inferior gris, sin texto).
function lineaEnBlanco(): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { color: LINEA, size: 4, style: BorderStyle.SINGLE, space: 6 } },
    children: [new TextRun({ text: '', size: 22 })],
  })
}

// Celda de tabla con texto (o vacía si no se pasa nada).
function celda(texto: string, opts: { header?: boolean; width?: number; bold?: boolean } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { fill: 'D9D9D9' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [new Paragraph({
      children: [new TextRun({
        text: texto || '',
        bold: opts.header || opts.bold || false,
        size: 18,
        color: NEGRO,
      })],
    })],
  })
}

// Fila con una etiqueta fija a la izquierda y una celda ancha vacía a la derecha,
// tal como el formato de ANTECEDENTES (INICIO DE CAUSA | ... , MEDIDA DE PROTECCION | ...).
function filaAntecedente(etiqueta: string): TableRow {
  return new TableRow({
    children: [
      celda(etiqueta, { width: 32, bold: true }),
      celda('', { width: 68 }),
    ],
  })
}

// Fila totalmente vacía (para agregar cronología de hitos a mano).
function filaVacia2Col(): TableRow {
  return new TableRow({
    children: [celda('', { width: 32 }), celda('', { width: 68 })],
  })
}

/**
 * Nombre(s) de NNA para la cabecera: "NOMBRE APELLIDO, N años" por cada NNA.
 * Si hay varios, se separan por " / ". Solo usa datos objetivos (nombre + edad).
 * Devuelve '' si no hay ninguno (la línea queda en blanco para completar a mano).
 */
function nombresNna(nna: MinutaNna[]): string {
  return nna
    .map(n => {
      const nom = `${n.nombre || ''} ${n.apellido || ''}`.trim()
      if (!nom) return ''
      return n.edad != null ? `${nom}, ${n.edad} años` : nom
    })
    .filter(Boolean)
    .join('  /  ')
}

/**
 * Construye la minuta de audiencia de revisión y la devuelve como Buffer (.docx).
 */
export async function generarMinutaAudiencia(data: MinutaData): Promise<Buffer> {
  const { causa, nna } = data

  // --- ANTECEDENTES: tabla con las filas fijas del formato + filas en blanco ---
  const filasAntecedentes: TableRow[] = [
    filaAntecedente('INICIO DE CAUSA'),
    filaAntecedente('MEDIDA DE PROTECCIÓN'),
    filaAntecedente('Cumplimiento de la Medida'),
    // Filas en blanco para la cronología de hitos (fecha: hecho) que la curadora agrega.
    filaVacia2Col(),
    filaVacia2Col(),
    filaVacia2Col(),
  ]
  const tablaAntecedentes = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: filasAntecedentes,
  })

  // --- MEDIDAS CAUTELARES: tabla con los encabezados EXACTOS del formato ---
  const filasMC: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        celda('Fecha', { header: true, width: 20 }),
        celda('Medidas decretadas', { header: true, width: 40 }),
        celda('Duración de las MC (vigencia / a discutir en audiencia)', { header: true, width: 40 }),
      ],
    }),
    // Filas en blanco para completar a mano.
    new TableRow({ children: [celda('', { width: 20 }), celda('', { width: 40 }), celda('', { width: 40 })] }),
    new TableRow({ children: [celda('', { width: 20 }), celda('', { width: 40 }), celda('', { width: 40 })] }),
    new TableRow({ children: [celda('', { width: 20 }), celda('', { width: 40 }), celda('', { width: 40 })] }),
  ]
  const tablaMC = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: filasMC,
  })

  // --- DOCUMENTO (orden ESTRICTO del formato) ---
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Título
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: 'MINUTA AUDIENCIA DE REVISIÓN', bold: true, size: 30, color: NEGRO })],
        }),

        // Cabecera: RIT / NNA (precargados) + horas (en blanco)
        etiquetaValor('RIT DE LA CAUSA', causa.rit),
        etiquetaValor('NOMBRE DE NNA', nombresNna(nna)),
        etiquetaValor('HORA INICIO', ''),
        etiquetaValor('HORA TERMINO', ''),

        // Antecedentes (tabla para completar)
        seccion('ANTECEDENTES DE LA CAUSA'),
        tablaAntecedentes,

        // Medidas cautelares (tabla para completar)
        seccion('MEDIDAS CAUTELARES'),
        new Paragraph({
          spacing: { before: 80, after: 120 },
          children: [new TextRun({
            text: 'En caso de existir medidas cautelares decretadas (indicar si se encuentran vigentes y, especialmente, si deben discutirse en la audiencia).',
            italics: true, size: 18, color: GRIS,
          })],
        }),
        tablaMC,

        // Entrevista con NNA (líneas en blanco)
        seccion('ENTREVISTA CON NNA'),
        lineaEnBlanco(),
        lineaEnBlanco(),
        lineaEnBlanco(),
        lineaEnBlanco(),

        // Solicitudes de la curaduría (líneas en blanco)
        seccion('SOLICITUDES POR PARTE DE LA CURADURÍA'),
        lineaEnBlanco(),
        lineaEnBlanco(),
        lineaEnBlanco(),
        lineaEnBlanco(),
        lineaEnBlanco(),
      ],
    }],
  })

  return Packer.toBuffer(doc)
}

/** Nombre de archivo seguro para la minuta. */
export function nombreArchivoMinuta(rit: string): string {
  const seguro = (rit || 'causa').replace(/[^a-zA-Z0-9._-]/g, '_')
  const fecha = new Date().toISOString().slice(0, 10)
  return `minuta_audiencia_${seguro}_${fecha}.docx`
}
