import { docsFromReadme, type DocPage } from '@/lib/docs';
import { README } from '@/lib/docs-readme';

let cached: DocPage[] | null = null;

/** The docs pages, from README.md baked in at build time (every page is static) */
export function loadDocs(): DocPage[] {
  cached ??= docsFromReadme(README);
  return cached;
}
