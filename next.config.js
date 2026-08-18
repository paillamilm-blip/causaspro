/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Aumentar límite de body para upload de archivos grandes
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
}
module.exports = nextConfig
