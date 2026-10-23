import type { MetadataRoute } from 'next';
import { publicPages, siteUrl } from '@/lib/site';
import { loadDocs } from './docs/load';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return publicPages(loadDocs()).map((p) => ({ url: `${base}${p.path}`, changeFrequency: p.changeFrequency, priority: p.priority }));
}
