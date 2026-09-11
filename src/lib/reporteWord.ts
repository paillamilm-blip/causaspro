// ============================================================
// CAUSASPRO - Generador de reporte Word (.docx) por causa
// ------------------------------------------------------------
// Arma un documento Word editable con el estado de UNA causa: cabecera,
// alertas (traslado curador / próxima audiencia), NNA, adultos responsables,
// audiencias, resoluciones y el historial de movimientos.
//
// Es una función PURA de datos → Buffer: no toca la BD ni el navegador. La
// ruta API (/api/reporte/[id]) lee de Supabase y le pasa los datos ya listos.
// Así se puede testear y reutilizar sin dependencias de red.
// ============================================================

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'
import { materiaDeTipo, materiaDeRit, GRUPO_LABEL } from './materiasFamilia'

// --- Tipos de entrada (subconjunto de las tablas de la BD) ---
export interface ReporteCausa {
  rit: string
  caratulado?: string | null
  tipo?: string | null
  estado?: string | null
  tribunal?: string | null
  programa_vigente?: string | null
  sintesis?: string | null
  fecha_apertura?: string | null
  updated_at?: string | null
}
export interface ReporteMovimiento {
  fecha?: string | null
  etapa?: string | null
  tramite: string
  descripcion?: string | null
  es_traslado_curador?: boolean | null
}
export interface ReporteNna {
  nombre?: string | null; apellido?: string | null; edad?: number | null; rut?: string | null
}
export interface ReporteAdulto {
  nombre?: string | null; relacion?: string | null; telefono?: string | null
}
export interface ReporteAudiencia {
  fecha?: string | null; tipo?: string | null
}

export interface ReporteData {
  causa: ReporteCausa
  movimientos: ReporteMovimiento[]
  nna: ReporteNna[]
  adultos: ReporteAdulto[]
  audiencias: ReporteAudiencia[]
  /** Nombre del estudio/curaduría para el membrete (opcional). */
  membrete?: string
}

// --- Helpers de formato ---
const AZUL = '1F3864'
const GRIS = '595959'
const ROJO = 'C00000'

function fmtFecha(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Título de sección con línea inferior. */
function seccion(titulo: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { bottom: { color: AZUL, size: 6, style: BorderStyle.SINGLE, space: 2 } },
    children: [new TextRun({ text: titulo, bold: true, size: 24, color: AZUL })],
  })
}

/** Fila "Etiqueta: valor" para bloques de datos. */
function campo(label: string, value?: string | null): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20, color: GRIS }),
      new TextRun({ text: value && value.trim() ? value : '—', size: 20 }),
    ],
  })
}

/** Celda de tabla con texto. */
function celda(texto: string, opts: { header?: boolean; width?: number; color?: string } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { fill: AZUL } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      children: [new TextRun({
        text: texto || '—',
        bold: opts.header || false,
        color: opts.header ? 'FFFFFF' : (opts.color || '000000'),
        size: 18,
      })],
    })],
  })
}

/**
 * Construye el documento Word y lo devuelve como Buffer (.docx).
 */
export async function generarReporteWord(data: ReporteData): Promise<Buffer> {
  const { causa, movimientos, nna, adultos, audiencias, membrete } = data
  const hoy = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
  // Materia de la causa (del tipo/letra o del RIT). Nunca se inventa.
  const materiaCausa = materiaDeTipo(causa.tipo) || materiaDeRit(causa.rit)

  // --- ALERTAS ---
  const tieneTraslado = movimientos.some(m => m.es_traslado_curador)
  // Comparación por DÍA (no por instante) para no desfasar el cálculo por zona horaria:
  // una fecha ISO sin offset ("2026-09-15") se ancla en UTC y en hora de Chile (UTC-3/-4)
  // podría contar un día de más/menos. Truncamos ambos lados a medianoche local.
  const diaLocal = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const hoyDia = diaLocal(new Date())
  const proximaAud = audiencias
    .map(a => ({ ...a, d: a.fecha ? new Date(a.fecha) : null }))
    // >= hoy: una audiencia AGENDADA PARA HOY sí debe alertar (es la más urgente).
    .filter(a => a.d && !isNaN(a.d.getTime()) && diaLocal(a.d) >= hoyDia)
    .sort((a, b) => (a.d!.getTime() - b.d!.getTime()))[0]

  const alertas: Paragraph[] = []
  if (tieneTraslado) {
    alertas.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: '🔴 TRASLADO AL CURADOR detectado — requiere acción.', bold: true, color: ROJO, size: 20 })],
    }))
  }
  if (proximaAud) {
    const dias = Math.round((diaLocal(proximaAud.d!) - hoyDia) / 86400000)
    const cuando = dias === 0 ? 'HOY' : `en ${dias} día(s)`
    alertas.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `📅 Próxima audiencia: ${fmtFecha(proximaAud.fecha)} (${proximaAud.tipo || 'Audiencia'}) — ${cuando}.`, bold: true, color: dias === 0 ? ROJO : AZUL, size: 20 })],
    }))
  }
  if (alertas.length === 0) {
    alertas.push(new Paragraph({ children: [new TextRun({ text: 'Sin alertas activas.', italics: true, size: 20, color: GRIS })] }))
  }

  // --- TABLA DE MOVIMIENTOS ---
  const movsOrdenados = [...movimientos].sort((a, b) => {
    const da = a.fecha ? new Date(a.fecha).getTime() : 0
    const db = b.fecha ? new Date(b.fecha).getTime() : 0
    return db - da // más reciente primero
  })
  const filasMov: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        celda('Fecha', { header: true, width: 15 }),
        celda('Etapa', { header: true, width: 18 }),
        celda('Trámite', { header: true, width: 22 }),
        celda('Descripción', { header: true, width: 45 }),
      ],
    }),
  ]
  for (const m of movsOrdenados) {
    filasMov.push(new TableRow({
      children: [
        celda(fmtFecha(m.fecha), { width: 15 }),
        celda(m.etapa || '—', { width: 18 }),
        celda(m.tramite || '—', { width: 22, color: m.es_traslado_curador ? ROJO : undefined }),
        celda(m.descripcion || '—', { width: 45 }),
      ],
    }))
  }

  const tablaMovimientos = movsOrdenados.length > 0
    ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filasMov })
    : new Paragraph({ children: [new TextRun({ text: 'Sin movimientos registrados.', italics: true, size: 20, color: GRIS })] })

  // --- Bloques NNA / adultos / audiencias / resoluciones ---
  const bloquesNna = nna.length > 0
    ? nna.map(n => campo(`${n.nombre || ''} ${n.apellido || ''}`.trim() || 'NNA', [n.edad ? `${n.edad} años` : null, n.rut].filter(Boolean).join(' · ')))
    : [new Paragraph({ children: [new TextRun({ text: 'Sin NNA registrados.', italics: true, size: 20, color: GRIS })] })]

  const bloquesAdultos = adultos.length > 0
    ? adultos.map(a => campo(a.nombre || 'Adulto', [a.relacion, a.telefono].filter(Boolean).join(' · ')))
    : [new Paragraph({ children: [new TextRun({ text: 'Sin adultos registrados.', italics: true, size: 20, color: GRIS })] })]

  const resoluciones = movsOrdenados.filter(m => /resoluc|sentencia/i.test(m.tramite || ''))
  const bloquesResol = resoluciones.length > 0
    ? resoluciones.map(r => campo(fmtFecha(r.fecha), [r.tramite, r.descripcion].filter(Boolean).join(' — ')))
    : [new Paragraph({ children: [new TextRun({ text: 'Sin resoluciones registradas.', italics: true, size: 20, color: GRIS })] })]

  // --- DOCUMENTO ---
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Membrete + título
        ...(membrete ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: membrete, bold: true, size: 22, color: GRIS })] })] : []),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: 'Reporte de Causa', bold: true, size: 36, color: AZUL })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: `${causa.rit}${causa.caratulado ? ' — ' + causa.caratulado : ''}`, size: 24 })],
        }),

        // Info principal
        seccion('Información de la Causa'),
        campo('RIT', causa.rit),
        campo('Caratulado', causa.caratulado),
        campo('Tribunal', causa.tribunal),
        campo('Estado', causa.estado),
        campo('Tipo', causa.tipo),
        ...(materiaCausa ? [campo('Materia', `${materiaCausa.materia} (${GRUPO_LABEL[materiaCausa.grupo]}) — ${materiaCausa.descripcion}`)] : []),
        campo('Programa vigente', causa.programa_vigente),
        campo('Fecha de apertura', fmtFecha(causa.fecha_apertura)),
        ...(causa.sintesis ? [campo('Síntesis', causa.sintesis)] : []),

        // Alertas
        seccion('Alertas'),
        ...alertas,

        // NNA
        seccion(`NNA (${nna.length})`),
        ...bloquesNna,

        // Adultos
        seccion('Adultos responsables'),
        ...bloquesAdultos,

        // Resoluciones
        seccion(`Resoluciones (${resoluciones.length})`),
        ...bloquesResol,

        // Movimientos
        seccion(`Historial de movimientos (${movsOrdenados.length})`),
        tablaMovimientos,

        // Pie
        new Paragraph({
          spacing: { before: 300 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Generado por CausasPro el ${hoy}`, italics: true, size: 16, color: GRIS })],
        }),
      ],
    }],
  })

  return Packer.toBuffer(doc)
}

/** Nombre de archivo seguro para el reporte. */
export function nombreArchivoReporte(rit: string): string {
  const seguro = (rit || 'causa').replace(/[^a-zA-Z0-9._-]/g, '_')
  const fecha = new Date().toISOString().slice(0, 10)
  return `reporte_${seguro}_${fecha}.docx`
}
