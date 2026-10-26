import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAcceptable, dependencyChanges, riskOf } from '../src/lib/agent/risk.ts';
import type { Evidence } from '../src/lib/agent/evidence.ts';

const ev = (patch: Partial<Evidence> = {}): Evidence => ({ reason: 'finished', build: true, run: null, failedChecks: 0, steps: 4, toolCalls: 6, files: 1, linesAdded: 3, linesRemoved: 1, ms: 9000, tokens: 1000, ...patch });
const mod = (path: string, before: string, after: string) => ({ path, kind: 'modified' as const, before, after, added: after.split('\n').length, removed: before.split('\n').length });

test('a small checked change is low risk and may be auto-accepted', () => {
  const r = riskOf({ files: [mod('src/format.ts', 'export const f = (n) => n;\n', 'export const f = (n: number) => n.toFixed(2);\n')], evidence: ev(), review: { verdict: 'approve' } });
  assert.equal(r.level, 'low');
  assert.ok(r.score <= 15, String(r.score));
  assert.deepEqual(autoAcceptable(r, 15, true), { ok: true, why: `Risk ${r.score}, verified` });
  assert.equal(autoAcceptable(r, 0, true).ok, false);
  assert.equal(autoAcceptable(r, 15, false).ok, false);
});

test('new dependencies, CI and auth code raise the risk, and CI and auth hold it for you', () => {
  const r = riskOf({
    files: [
      mod('package.json', '{"dependencies":{"react":"^19"}}', '{"dependencies":{"react":"^19","left-pad":"^1","lodash":"^4"}}'),
      mod('.github/workflows/ci.yml', 'on: push', 'on: [push, pull_request]'),
      mod('src/auth/session.ts', 'a', 'b'),
    ],
    evidence: ev(),
  });
  const labels = r.factors.map((f) => f.label);
  assert.ok(labels.includes('adds 2 dependencies'));
  assert.ok(labels.includes('CI / deploy'));
  assert.ok(labels.includes('security-sensitive code'));
  assert.ok(r.score >= 25);
  assert.match(autoAcceptable(r, 100, true).why, /Held for you/);
});

test('a secret, eval or destructive SQL in the added lines is caught; the same text already there is not', () => {
  const secret = riskOf({ files: [mod('src/api.ts', 'const x = 1;', 'const x = 1;\nconst apiKey = "sk-abcdefghijklmnopqrstuvwxyz123";')], evidence: ev() });
  assert.ok(secret.factors.some((f) => f.label === 'a secret in the code' && f.hold));
  const sql = riskOf({ files: [mod('db/clean.py', '', 'cur.execute("DELETE FROM users;")\neval(code)')], evidence: ev() });
  assert.ok(sql.factors.some((f) => /destructive SQL/.test(f.label) && /eval/.test(f.label)));
  const untouched = riskOf({ files: [mod('src/x.ts', 'eval(a)\n', 'eval(a)\nconst b = 2;\n')], evidence: ev() });
  assert.ok(!untouched.factors.some((f) => /eval/.test(f.label)));
});

test('removing tests holds the change; adding tests lowers the risk', () => {
  const removed = riskOf({ files: [mod('tests/a.test.ts', "test('a', () => {});\ntest('b', () => {});", "test('a', () => {});")], evidence: ev() });
  assert.ok(removed.factors.some((f) => f.label === 'removes 1 test' && f.hold));
  const added = riskOf({ files: [mod('tests/a.test.ts', "test('a', () => {});", "test('a', () => {});\ntest('b', () => {});")], evidence: ev() });
  assert.ok(added.factors.some((f) => f.label === 'adds 1 test' && f.points < 0));
});

test('evidence and the reviewer move the score', () => {
  const files = [mod('src/x.ts', 'a', 'b')];
  const failed = riskOf({ files, evidence: ev({ build: false }) });
  const blocked = riskOf({ files, evidence: ev(), review: { verdict: 'block' } });
  const fine = riskOf({ files, evidence: ev(), review: { verdict: 'approve' } });
  assert.ok(failed.score > fine.score && blocked.score > fine.score);
  assert.equal(blocked.level !== 'low', true);
  assert.equal(riskOf({ files: [mod('README.md', 'a', 'b')] }).level, 'low');
  assert.equal(riskOf({ files: [] }).score, 0);
});

test('dependency changes in line-based manifests', () => {
  assert.deepEqual(dependencyChanges('requirements.txt', 'flask==3.0\nrequests>=2', 'flask==3.1\nrequests>=2\nhttpx'), { added: ['httpx'], removed: [], changed: ['flask'] });
  assert.deepEqual(dependencyChanges('pyproject.toml', '[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.1",\n]', '[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.1",\n  "sqlmodel>=0.0.2",\n]').added, ['sqlmodel']);
});
