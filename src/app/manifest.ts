import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/** Installable as an app (Add to Home Screen / Install), opening straight into the studio */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['developer', 'productivity', 'utilities'],
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
