import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { vsixTextFiles } from '../src/lib/vsix.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const small = { file: 1000, total: 3000, entries: 5 };

test('reads only the manifest and JSON files, never node_modules or code', () => {
  const zip = zipSync({
    'extension/package.json': enc('{"name":"x"}'),
    'extension/themes/a.json': enc('{"colors":{}}'),
    'extension/snippets/s.code-snippets': enc('{}'),
    'extension/out/main.js': enc('process.exit(1)'),
    'extension/node_modules/dep/package.json': enc('{}'),
    '[Content_Types].xml': enc('<x/>'),
  });
  assert.deepEqual(Object.keys(vsixTextFiles(zip)).sort(), ['extension/package.json', 'extension/snippets/s.code-snippets', 'extension/themes/a.json']);
});

test('a zip bomb is refused from its directory, before it is inflated', () => {
  // Each entry is under the per-file limit; together they are far over the total
  const files: Record<string, Uint8Array> = { 'extension/package.json': enc('{}') };
  for (let i = 0; i < 4; i++) files[`extension/t/${i}.json`] = new Uint8Array(900);
  assert.throws(() => vsixTextFiles(zipSync(files, { level: 9 }), small), /too large/);
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i < 6; i++) many[`extension/t/${i}.json`] = enc('{}');
  assert.throws(() => vsixTextFiles(zipSync(many), small), /too large/, 'too many entries');
});

test('a directory that understates a size gets no more than it declared', () => {
  const zip = zipSync({ 'extension/package.json': new Uint8Array(2000).fill(32) }, { level: 9 });
  // Rewrite the uncompressed size in the central directory (offset 24 of the PK\1\2 record) to claim 10 bytes
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 10, true);
      break;
    }
  }
  // fflate inflates into a buffer of the declared size, so the limits above still bound memory
  assert.equal(vsixTextFiles(zip, small)['extension/package.json'].length, 10);
});
