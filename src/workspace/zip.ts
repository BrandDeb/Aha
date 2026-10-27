/**
 * ZIP import/export of a project (fflate, in the browser).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isValidPath } from './project';

const MAX_IMPORT_FILES = 300;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
/** Everything in the ZIP, skipped files included */
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

export function exportZip(name: string, files: Record<string, string>): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const [filePath, content] of Object.entries(files)) {
    entries[`${name}/${filePath}`] = strToU8(content);
  }
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped.slice().buffer], { type: 'application/zip' });
}

export interface ImportResult {
  files: Record<string, string>;
  skipped: string[];
}

/**
 * Read a ZIP into project files. A single top-level folder is stripped,
 * binary files and unsafe paths are skipped.
 */
export function importZip(data: ArrayBuffer): ImportResult {
  // Sizes come from the zip's directory, before anything is inflated: a small file that would expand to gigabytes
  // is refused instead of freezing the tab (fflate never inflates an entry past its declared size)
  let declared = 0;
  const entries = unzipSync(new Uint8Array(data), {
    filter: (file) => {
      declared += file.originalSize;
      if (declared > MAX_ZIP_BYTES) throw new Error(`The ZIP expands to more than ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
      return true;
    },
  });
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/') && !p.startsWith('__MACOSX/'));
  const roots = new Set(paths.map((p) => p.split('/')[0]));
  const strip = roots.size === 1 && paths.every((p) => p.includes('/')) ? `${[...roots][0]}/` : '';

  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  for (const raw of paths) {
    const filePath = raw.slice(strip.length);
    const bytes = entries[raw];
    if (!isValidPath(filePath) || bytes.includes(0) || Object.keys(files).length >= MAX_IMPORT_FILES) {
      skipped.push(raw);
      continue;
    }
    total += bytes.length;
    if (total > MAX_IMPORT_BYTES) {
      skipped.push(raw);
      continue;
    }
    files[filePath] = strFromU8(bytes);
  }
  return { files, skipped };
}
