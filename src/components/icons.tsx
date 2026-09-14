// Iconos SVG de UNA sola familia (Lucide, MIT). Inline, sin dependencias nuevas.
// Reemplazan los emoji como iconos (regla de diseño: emoji ≠ icono). Heredan color
// vía currentColor y tamaño vía la prop `className` (ej. "w-4 h-4").
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconRefresh({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

export function IconSearch({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function IconX({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function IconUsers({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

export function IconCalendar({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  )
}

export function IconAlert({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

export function IconDownload({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

export function IconChevron({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function IconClock({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}

export function IconInbox({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

export function IconCheck({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// Escudo con check: representa el traslado al curador (rol de protección/tutela del NNA).
export function IconShield({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

// Chispa/estrella: acción de IA (Asesor estratégico).
export function IconSparkles({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <path d="M9.94 14.06 8 20l-1.94-5.94L0 12l6.06-2.06L8 4l1.94 5.94L16 12z" />
      <path d="M18 5.5 17 2l-1 3.5L12.5 6l3.5 1L17 10.5 18 7l3.5-.5z" />
    </svg>
  )
}

// Pausa: causa estancada / en revisión (sin movimiento).
export function IconPause({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p} aria-hidden="true">
      <line x1="10" y1="15" x2="10" y2="9" />
      <line x1="14" y1="15" x2="14" y2="9" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}
