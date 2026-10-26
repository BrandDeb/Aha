import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectPlatform, downloadUrl, formatSize, PLATFORMS, releaseInfo } from '../src/lib/downloads.ts';

test('downloads: stable names in the release, one per platform', () => {
  assert.equal(downloadUrl('Aha-macOS-arm64.dmg', 'o/r'), 'https://github.com/o/r/releases/download/desktop-latest/Aha-macOS-arm64.dmg');
  // The workflow publishes exactly the names the page links to
  const workflow = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  for (const p of PLATFORMS) if (p.file) assert.ok(workflow.includes(`out/${p.file}`), `${p.file} is published by desktop.yml`);
});

test('downloads: the visitor’s system', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), null, 'phones get no installer highlighted');
  assert.equal(detectPlatform('', 'macOS'), 'mac', 'User-Agent Client Hints');
});

test('downloads: release details for the page', () => {
  const info = releaseInfo({
    published_at: '2026-10-01T00:00:00Z',
    body: 'Built from 2e907c51e0eec0057d829910ba4c29d365a63070 (main) by …',
    assets: [
      { name: 'Aha-macOS-arm64.dmg', size: 210 * 1024 ** 2, browser_download_url: 'https://x/mac.dmg', updated_at: '2026-10-23T05:10:00Z' },
      { name: 'SHA256SUMS.txt', size: 200, browser_download_url: 'https://x/sums', updated_at: '2026-10-23T05:11:00Z' },
    ],
  });
  assert.equal(info.commit, '2e907c5');
  assert.equal(info.updatedAt, '2026-10-23T05:11:00Z');
  assert.equal(info.assets['Aha-macOS-arm64.dmg'].url, 'https://x/mac.dmg');
  assert.equal(formatSize(210 * 1024 ** 2), '210 MB');
  assert.deepEqual(releaseInfo({}), { updatedAt: null, commit: null, assets: {} });
});
