import { readFileSync } from 'node:fs';
import path from 'node:path';
import { docsFromReadme, type DocPage } from '@/lib/docs';

let cached: DocPage[] | null = null;

/** The docs pages, read from README.md at build time (every page is static) */
export function loadDocs(): DocPage[] {
  cached ??= docsFromReadme(readFileSync(path.join(process.cwd(), 'README.md'), 'utf8'));
  return cached;
}
