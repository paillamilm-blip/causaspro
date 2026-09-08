// ============================================================
// CAUSASPRO - Tipos compartidos de la capa de negocio
// (Clientes + Honorarios + Cuotas)
// ============================================================

export type ModalidadHonorario = 'fijo' | 'exito' | 'mixto'
export type EstadoHonorario = 'activo' | 'cerrado' | 'anulado'
export type EstadoCuota = 'pendiente' | 'pagada' | 'vencida'

/** Cliente del estudio. Puede tener varias causas. */
export interface Cliente {
  id: string
  nombre: string
  rut: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  portal_token: string | null
  created_at: string
  updated_at: string
}

/** Datos para crear/editar un cliente (sin campos generados). */
export interface ClienteInput {
  nombre: string
  rut?: string | null
  email?: string | null
  telefono?: string | null
  direccion?: string | null
  notas?: string | null
}

/** Honorario pactado por una causa. */
export interface Honorario {
  id: string
  causa_id: string
  cliente_id: string | null
  modalidad: ModalidadHonorario
  monto_total: number
  porcentaje_exito: number
  monto_ganado: number
  moneda: string
  descripcion: string | null
  estado: EstadoHonorario
  created_at: string
  updated_at: string
}

export interface HonorarioInput {
  causa_id: string
  cliente_id?: string | null
  modalidad: ModalidadHonorario
  monto_total?: number
  porcentaje_exito?: number
  monto_ganado?: number
  descripcion?: string | null
}

/** Cuota individual de un honorario. Se rastrea por separado. */
export interface Cuota {
  id: string
  honorario_id: string
  numero: number
  monto: number
  fecha_vencimiento: string | null
  pagada: boolean
  fecha_pago: string | null
  monto_pagado: number
  metodo_pago: string | null
  notas: string | null
  ultimo_recordatorio: string | null
  created_at: string
  updated_at: string
}

export interface CuotaInput {
  numero: number
  monto: number
  fecha_vencimiento?: string | null
}

/** Fila de la vista v_honorarios_resumen. */
export interface HonorarioResumen {
  id: string
  causa_id: string
  cliente_id: string | null
  modalidad: ModalidadHonorario
  estado: EstadoHonorario
  moneda: string
  monto_pactado: number
  total_pagado: number
  total_en_cuotas: number
  num_cuotas: number
  cuotas_pagadas: number
  cuotas_vencidas: number
  monto_vencido: number
}

/** Fila de la vista v_salud_financiera (una sola fila). */
export interface SaludFinanciera {
  por_cobrar_total: number
  monto_vencido_total: number
  honorarios_con_mora: number
  ingresos_mes: number
  ingresos_mes_anterior: number
  total_clientes: number
  honorarios_activos: number
}

/** Fila de la vista v_cuotas_por_cobrar. */
export interface CuotaPorCobrar {
  id: string
  honorario_id: string
  numero: number
  monto: number
  monto_pagado: number
  saldo: number
  fecha_vencimiento: string | null
  pagada: boolean
  estado_cuota: EstadoCuota
  dias_vencida: number | null
  causa_id: string | null
  rit: string | null
  caratulado: string | null
  cliente_id: string | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  cliente_email: string | null
}


// ============================================================
// Multi-abogado (Fase 4 - Paso 1)
// ============================================================

export type RolAbogado = 'socio' | 'abogado'

/** Estudio jurídico. Agrupa a varios abogados. */
export interface Estudio {
  id: string
  nombre: string
  rut: string | null
  created_at: string
  updated_at: string
}

/** Abogado miembro de un estudio. */
export interface Abogado {
  id: string
  estudio_id: string | null
  nombre: string
  rut: string | null
  email: string | null
  rol: RolAbogado
  activo: boolean
  auth_user_id: string | null
  created_at: string
  updated_at: string
}

export interface AbogadoInput {
  nombre: string
  estudio_id?: string | null
  rut?: string | null
  email?: string | null
  rol?: RolAbogado
}

/** Reparto de un honorario entre abogados (debe sumar 100%). */
export interface RepartoHonorario {
  id: string
  honorario_id: string
  abogado_id: string
  porcentaje: number
  created_at: string
}

/** Item de reparto para enviar a la API. */
export interface RepartoItemInput {
  abogado_id: string
  porcentaje: number
}

/** Fila de la vista v_cartera_abogado. */
export interface CarteraAbogado {
  abogado_id: string
  nombre: string
  rol: RolAbogado
  estudio_id: string | null
  total_causas: number
  total_clientes: number
  por_cobrar: number
  vencido: number
}

/** Fila de la vista v_cartera_estudio. */
export interface CarteraEstudio {
  estudio_id: string
  nombre: string
  total_abogados: number
  total_causas: number
  total_clientes: number
  por_cobrar: number
  vencido: number
}
