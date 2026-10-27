/**
 * The text files of a .vsix (a zip) that the studio reads: the manifest and the JSON files (themes, snippets).
 * Limits are checked from the zip's directory before anything is decompressed, so a package that would inflate to
 * gigabytes (many small entries of zeros, each under the per-file limit) is refused instead of filling memory.
 */

import { strFromU8, unzipSync } from 'fflate';

export const VSIX_LIMITS = { file: 4 * 1024 * 1024, total: 12 * 1024 * 1024, entries: 2000 };

export function vsixTextFiles(zip: Uint8Array, limits = VSIX_LIMITS): Record<string, string> {
  let total = 0;
  let entries = 0;
  const unzipped = unzipSync(zip, {
    filter: (file) => {
      if (!file.name.startsWith('extension/') || file.name.includes('/node_modules/')) return false;
      if (file.name !== 'extension/package.json' && !/\.(json|code-snippets)$/i.test(file.name)) return false;
      if (file.originalSize > limits.file) return false;
      total += file.originalSize;
      if (++entries > limits.entries || total > limits.total) throw new Error('The extension is too large to read');
      return true;
    },
  });
  const files: Record<string, string> = {};
  let read = 0;
  for (const [name, data] of Object.entries(unzipped)) {
    // fflate inflates into a buffer of the size the directory declares, so this is a second line, not the first
    read += data.byteLength;
    if (data.byteLength > limits.file || read > limits.total) throw new Error('The extension is too large to read');
    files[name] = strFromU8(data);
  }
  return files;
}
