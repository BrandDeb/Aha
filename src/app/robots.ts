import type { MetadataRoute } from 'next';
import { AI_ANSWER_BOTS, AI_TRAINING_BOTS, PRIVATE_PATHS, siteUrl } from '@/lib/site';

/** Search engines and AI assistants may read every public page; AI training crawlers too unless SITE_AI_TRAINING=off */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const training = process.env.SITE_AI_TRAINING !== 'off';
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: AI_ANSWER_BOTS, allow: '/', disallow: PRIVATE_PATHS },
      training ? { userAgent: AI_TRAINING_BOTS, allow: '/', disallow: PRIVATE_PATHS } : { userAgent: AI_TRAINING_BOTS, disallow: '/' },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
