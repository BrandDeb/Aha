import { docsFromGuide, type DocPage } from '@/lib/docs';
import { GUIDE } from '@/lib/docs-guide';

let cached: DocPage[] | null = null;

/** The docs pages, from docs/guide.md baked in at build time (every page is static) */
export function loadDocs(): DocPage[] {
  cached ??= docsFromGuide(GUIDE);
  return cached;
}
