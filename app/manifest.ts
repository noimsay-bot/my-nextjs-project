import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JTBC 영상취재HUB',
    short_name: '영상취재HUB',
    description: 'JTBC 영상취재팀 포털',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b3ea8',
    theme_color: '#0b3ea8',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}