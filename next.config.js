/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Límite de body para Server Actions. Hoy el repo NO usa Server Actions (el upload
    // es un route handler POST en src/app/api/upload). Se deja como configuración
    // preventiva por si se agregan Server Actions con payloads grandes.
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // NOTA: se eliminó la clave `api.bodyParser` porque es de Pages Router (config por-ruta
  // en pages/api) y NO aplica en App Router; Next.js 14 la reportaba como "Unrecognized
  // key" en el build (era configuración muerta). El upload de Excel no dependía de ella:
  // el frontend parsea el Excel y envía JSON ya procesado (ver src/app/api/upload/route.ts).
  // El límite real de body de un route handler lo impone la plataforma (Vercel ~4.5MB).
}
module.exports = nextConfig
