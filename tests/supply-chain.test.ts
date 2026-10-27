import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessDependency, ecosystemOf, editDistance, newDependencies, sortFindings, typosquatOf } from '../src/lib/supply-chain.ts';
import { autoAcceptable, riskOf } from '../src/lib/agent/risk.ts';

const NOW = Date.UTC(2026, 9, 27);
const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'app', dependencies: deps }, null, 2);

test('ecosystems come from the manifest', () => {
  assert.equal(ecosystemOf('package.json'), 'npm');
  assert.equal(ecosystemOf('web/package.json'), 'npm');
  assert.equal(ecosystemOf('requirements-dev.txt'), 'PyPI');
  assert.equal(ecosystemOf('pyproject.toml'), 'PyPI');
  assert.equal(ecosystemOf('Cargo.toml'), 'crates.io');
  assert.equal(ecosystemOf('src/main.ts'), null);
});

test('newDependencies lists only what the change adds, skipping local paths and PHP itself', () => {
  const deps = newDependencies([
    { path: 'package.json', kind: 'modified', before: pkg({ react: '^19.0.0' }), after: pkg({ react: '^19.1.0', expresss: '^1.0.0', local: 'file:../lib' }) },
    { path: 'requirements.txt', kind: 'added', before: '', after: 'requests>=2.31\n# a comment\nreqeusts\n' },
    { path: 'composer.json', kind: 'added', before: '', after: JSON.stringify({ require: { php: '>=8.2', 'ext-json': '*', 'monolog/monolog': '^3.0' } }) },
  ]);
  assert.deepEqual(deps.map((d) => `${d.ecosystem}:${d.name}@${d.spec}`), ['npm:expresss@^1.0.0', 'PyPI:requests@2.31', 'PyPI:reqeusts@', 'Packagist:monolog/monolog@^3.0']);
});

test('editDistance counts a swap of neighbours as one edit', () => {
  assert.equal(editDistance('lodash', 'lodahs'), 1);
  assert.equal(editDistance('express', 'expresss'), 1);
  assert.equal(editDistance('react', 'react'), 0);
  assert.equal(editDistance('numpy', 'numba'), 2);
});

test('typosquats: a letter off, swapped, a separator or a look-alike character', () => {
  assert.equal(typosquatOf('npm', 'expresss'), 'express');
  assert.equal(typosquatOf('npm', 'lodahs'), 'lodash');
  assert.equal(typosquatOf('npm', 'crossenv'), 'cross-env');
  assert.equal(typosquatOf('npm', 'l0dash'), 'lodash');
  assert.equal(typosquatOf('PyPI', 'reqeusts'), 'requests');
  assert.equal(typosquatOf('PyPI', 'python_dateutil'), null, 'PyPI treats _ and - as the same name');
  assert.equal(typosquatOf('PyPI', 'dateutil-python'), null);
  assert.equal(typosquatOf('PyPI', 'beautifulsoup'), 'beautifulsoup4');
  assert.equal(typosquatOf('crates.io', 'serde_jsno'), 'serde_json');
});

test('popular and unrelated names are not typosquats', () => {
  for (const name of ['react', 'preact', 'express', 'mysql2', 'vitest', 'next-auth', 'react-icons', 'axios-retry', '@acme/lodash', 'zod', 'pinia']) assert.equal(typosquatOf('npm', name), null, name);
  for (const name of ['numpy', 'numba', 'pandas', 'scapy', 'cattrs', 'tomli', 'httpx']) assert.equal(typosquatOf('PyPI', name), null, name);
  assert.equal(typosquatOf('Go', 'github.com/gin-gonic/gin'), null, 'no list for Go: nothing to compare with');
});

test('registry facts become findings', () => {
  const dep = { ecosystem: 'npm' as const, name: 'left-padd' };
  assert.deepEqual(assessDependency(dep, { ecosystem: 'npm', name: 'left-padd', exists: false }, NOW).map((f) => f.kind), ['missing']);
  const risky = assessDependency(dep, { ecosystem: 'npm', name: 'left-padd', exists: true, version: '1.0.0', created: NOW - 3 * 86_400_000, weeklyDownloads: 12, installScripts: ['postinstall: node setup.js'], license: 'UNLICENSED', advisories: [{ id: 'GHSA-xxxx', summary: 'Embedded malware', severity: 'critical' }] }, NOW);
  assert.deepEqual(risky.map((f) => f.kind).sort(), ['advisory', 'install-script', 'licence', 'new', 'unpopular']);
  assert.match(risky.find((f) => f.kind === 'new')!.detail, /3 days ago/);
  assert.match(risky.find((f) => f.kind === 'advisory')!.detail, /GHSA-xxxx \(critical\): Embedded malware/);
  assert.deepEqual(assessDependency({ ecosystem: 'npm', name: 'express' }, { ecosystem: 'npm', name: 'express', exists: true, created: 0, weeklyDownloads: 1e8, installScripts: [], license: 'MIT', advisories: [] }, NOW), []);
  assert.equal(assessDependency({ ecosystem: 'npm', name: 'x' }, { ecosystem: 'npm', name: 'x', exists: true, license: 'AGPL-3.0' }, NOW)[0].kind, 'licence');
  assert.deepEqual(assessDependency({ ecosystem: 'npm', name: 'x' }, { ecosystem: 'npm', name: 'x', exists: true, license: 'LGPL-3.0' }, NOW), []);
  // The lookup failed: only the name check
  assert.deepEqual(assessDependency({ ecosystem: 'npm', name: 'expresss' }, null, NOW).map((f) => f.kind), ['typosquat']);
});

test('findings sort with made-up and imitating names first', () => {
  const f = (kind: 'licence' | 'typosquat' | 'missing') => ({ ecosystem: 'npm' as const, name: kind, kind, detail: kind });
  assert.deepEqual(sortFindings([f('licence'), f('typosquat'), f('missing')]).map((x) => x.kind), ['missing', 'typosquat', 'licence']);
});

test('a supply-chain finding holds auto-accept, with its reason', () => {
  const files = [{ path: 'package.json', kind: 'modified' as const, before: pkg({}), after: pkg({ expresss: '^1.0.0' }), added: 1, removed: 0 }];
  const evidence = { reason: 'finished', build: true } as never;
  const clean = riskOf({ files, evidence });
  assert.equal(autoAcceptable(clean, 25, true).ok, true, 'without the guard a one-line dependency is low risk');
  const findings = assessDependency({ ecosystem: 'npm', name: 'expresss' }, null);
  const held = riskOf({ files, evidence, supplyChain: findings });
  const factor = held.factors.find((f) => f.label.startsWith('supply chain'))!;
  assert.equal(factor.label, 'supply chain: looks like a typosquat');
  assert.match(factor.detail, /expresss looks like express/);
  assert.equal(autoAcceptable(held, 25, true).why, 'Held for you: supply chain: looks like a typosquat');
});
