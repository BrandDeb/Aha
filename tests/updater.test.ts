import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyUpdate, defaultExec, getUpdateStatus, type Exec } from '../src/lib/updater.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A remote, the studio's checkout, and a second clone to play the developer publishing updates */
function scenario(name: string) {
  const dir = path.join(root, name);
  const remote = path.join(dir, 'remote.git');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  const clone = (to: string) => {
    execFileSync('git', ['clone', '--quiet', remote, to], { stdio: 'ignore' });
    sh(to, 'config', 'user.name', 'Test');
    sh(to, 'config', 'user.email', 'test@example.com');
    return to;
  };
  const dev = clone(path.join(dir, 'dev'));
  fs.writeFileSync(path.join(dev, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(dev, 'app.txt'), 'v1\n');
  sh(dev, 'add', '.');
  sh(dev, 'commit', '-m', 'first');
  sh(dev, 'push', '--quiet', '-u', 'origin', 'main');
  const studio = clone(path.join(dir, 'studio'));
  const publish = (file: string, content: string, message: string) => {
    fs.mkdirSync(path.dirname(path.join(dev, file)), { recursive: true });
    fs.writeFileSync(path.join(dev, file), content);
    sh(dev, 'add', '.');
    sh(dev, 'commit', '-m', message);
    sh(dev, 'push', '--quiet');
  };
  return { dir, remote, dev, studio, publish };
}

/** git runs for real; npm calls are recorded and answered by `npm` */
function recording(npm: (args: string[]) => { code: number; output: string } = () => ({ code: 0, output: '' })) {
  const npmCalls: string[] = [];
  const exec: Exec = async (file, args, options) => {
    if (file === 'npm') {
      npmCalls.push(args.join(' '));
      return npm(args);
    }
    return defaultExec(file, args, options);
  };
  return { exec, npmCalls };
}

test('a folder that is not a git checkout explains why it cannot update', async () => {
  const status = await getUpdateStatus({ cwd: path.join(root, 'nothing-here') });
  assert.equal(status.supported, false);
  assert.match(status.note!, /isn’t a git checkout/);
  fs.mkdirSync(path.join(root, 'plain'));
  assert.equal((await getUpdateStatus({ cwd: path.join(root, 'plain') })).supported, false);
});

test('status: up to date, then behind with the new commits listed once fetched', async () => {
  const s = scenario('status');
  const fresh = await getUpdateStatus({ cwd: s.studio, fetch: true });
  assert.deepEqual([fresh.supported, fresh.behind, fresh.ahead, fresh.dirty, fresh.canApply, fresh.branch, fresh.upstream], [true, 0, 0, false, false, 'main', 'origin/main']);

  s.publish('app.txt', 'v2\n', 'Add the second thing');
  s.publish('app.txt', 'v3\n', 'Fix the third thing');
  const stale = await getUpdateStatus({ cwd: s.studio });
  assert.equal(stale.behind, 0, 'without fetching, the remote’s news is not known yet');

  const behind = await getUpdateStatus({ cwd: s.studio, fetch: true });
  assert.equal(behind.behind, 2);
  assert.equal(behind.canApply, true);
  assert.deepEqual(behind.commits.map((c) => c.subject), ['Fix the third thing', 'Add the second thing']);
  assert.equal(behind.commits[0].author, 'Test');
  assert.match(behind.commits[0].date, /^\d{4}-\d\d-\d\dT/);
  assert.equal(behind.latest, sh(s.dev, 'rev-parse', 'HEAD'));
});

test('status: uncommitted changes and local commits block the update, with a reason', async () => {
  const s = scenario('blocked');
  s.publish('app.txt', 'v2\n', 'upstream change');
  fs.writeFileSync(path.join(s.studio, 'app.txt'), 'my edit\n');
  const dirty = await getUpdateStatus({ cwd: s.studio, fetch: true });
  assert.deepEqual([dirty.dirty, dirty.canApply], [true, false]);
  assert.match(dirty.note!, /uncommitted changes/);

  // Untracked files don't block it
  sh(s.studio, 'checkout', '--', 'app.txt');
  fs.writeFileSync(path.join(s.studio, 'scratch.txt'), 'notes\n');
  assert.equal((await getUpdateStatus({ cwd: s.studio })).canApply, true);

  fs.writeFileSync(path.join(s.studio, 'mine.txt'), 'local\n');
  sh(s.studio, 'add', 'mine.txt');
  sh(s.studio, 'commit', '-m', 'local work');
  const diverged = await getUpdateStatus({ cwd: s.studio });
  assert.deepEqual([diverged.ahead, diverged.behind, diverged.canApply], [1, 1, false]);
  assert.match(diverged.note!, /aren’t on the remote/);
});

test('status: a branch without an upstream, and a detached head, are explained', async () => {
  const s = scenario('upstream');
  sh(s.studio, 'checkout', '-b', 'local-only');
  assert.match((await getUpdateStatus({ cwd: s.studio })).note!, /doesn’t track a remote branch/);
  sh(s.studio, 'checkout', '--detach');
  assert.match((await getUpdateStatus({ cwd: s.studio })).note!, /detached/);
});

test('status: an unreachable remote is reported but the last known state is kept', async () => {
  const s = scenario('offline');
  fs.rmSync(s.remote, { recursive: true });
  const status = await getUpdateStatus({ cwd: s.studio, fetch: true });
  assert.equal(status.supported, true);
  assert.ok(status.fetchError);
  const result = await applyUpdate({ cwd: s.studio });
  assert.equal(result.ok, false);
  assert.match(result.error!, /Could not reach the remote/);
});

test('apply: fast-forwards the checkout and leaves dependencies alone when they did not change', async () => {
  const s = scenario('apply');
  s.publish('app.txt', 'v2\n', 'change');
  s.publish('docs/readme.md', '# hi\n', 'docs');
  const { exec, npmCalls } = recording();
  const progress: string[] = [];
  const result = await applyUpdate({ cwd: s.studio, exec, production: false, onProgress: (t) => progress.push(t) });
  assert.equal(result.ok, true, result.error);
  assert.equal(sh(s.studio, 'rev-parse', 'HEAD'), sh(s.dev, 'rev-parse', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(s.studio, 'app.txt'), 'utf8'), 'v2\n');
  assert.deepEqual(npmCalls, []);
  assert.equal(result.restartRequired, false, 'a dev server picks plain changes up itself');
  assert.match(progress.join(''), /Updating main: 2 new commits/);
  assert.notEqual(result.from, result.to);

  const again = await applyUpdate({ cwd: s.studio, exec, production: false });
  assert.deepEqual([again.ok, again.steps.at(-1)], [true, 'Already up to date.']);
});

test('apply: a change to the server asks for a restart; production builds first', async () => {
  const s = scenario('restart');
  s.publish('server.js', '// new\n', 'server change');
  const dev = recording();
  assert.equal((await applyUpdate({ cwd: s.studio, exec: dev.exec, production: false })).restartRequired, true);

  const s2 = scenario('production');
  s2.publish('app.txt', 'v2\n', 'change');
  const prod = recording();
  const result = await applyUpdate({ cwd: s2.studio, exec: prod.exec, production: true });
  assert.deepEqual([result.ok, result.restartRequired, prod.npmCalls], [true, true, ['run build']]);
});

test('apply: reinstalls dependencies when the manifest changed (npm ci with a lock file, install without)', async () => {
  const s = scenario('deps');
  s.publish('package.json', '{"name":"x","version":"1.1.0"}\n', 'bump');
  const without = recording();
  assert.equal((await applyUpdate({ cwd: s.studio, exec: without.exec, production: false })).ok, true);
  assert.deepEqual(without.npmCalls, ['install --no-audit --no-fund']);

  const s2 = scenario('deps-lock');
  s2.publish('package-lock.json', '{}\n', 'lock');
  sh(s2.studio, 'pull', '--quiet');
  s2.publish('package.json', '{"name":"x","version":"2.0.0"}\n', 'bump again');
  const withLock = recording();
  const result = await applyUpdate({ cwd: s2.studio, exec: withLock.exec, production: false });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(withLock.npmCalls, ['ci --no-audit --no-fund']);
  assert.equal(result.restartRequired, true);
});

test('apply: a failed install puts the previous version back, exactly', async () => {
  const s = scenario('rollback-install');
  const before = sh(s.studio, 'rev-parse', 'HEAD');
  s.publish('package.json', '{"name":"x","version":"9.9.9"}\n', 'bad bump');
  s.publish('app.txt', 'v2\n', 'other');
  const calls = recording((args) => (args[0] === 'ci' || args[0] === 'install' ? (calls.npmCalls.length === 1 ? { code: 1, output: 'npm ERR! network down\nnpm ERR! code ECONNRESET' } : { code: 0, output: '' }) : { code: 0, output: '' }));
  const result = await applyUpdate({ cwd: s.studio, exec: calls.exec, production: false });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.error!, /Installing dependencies failed:[\s\S]*ECONNRESET/);
  assert.equal(sh(s.studio, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(path.join(s.studio, 'app.txt'), 'utf8'), 'v1\n');
  assert.equal(sh(s.studio, 'status', '--porcelain', '--untracked-files=no'), '');
  assert.equal(calls.npmCalls.length, 2, 'it reinstalled the old dependencies after rolling back');
});

test('apply: a failed production build rolls back too', async () => {
  const s = scenario('rollback-build');
  const before = sh(s.studio, 'rev-parse', 'HEAD');
  s.publish('app.txt', 'v2\n', 'breaks the build');
  const { exec } = recording((args) => (args[0] === 'run' ? { code: 1, output: 'Type error: nope' } : { code: 0, output: '' }));
  const result = await applyUpdate({ cwd: s.studio, exec, production: true });
  assert.deepEqual([result.ok, result.rolledBack], [false, true]);
  assert.match(result.error!, /The build failed:\nType error: nope/);
  assert.equal(sh(s.studio, 'rev-parse', 'HEAD'), before);
});

test('apply: refuses when it is not a clean fast-forward, and only one update runs at a time', async () => {
  const s = scenario('refuse');
  s.publish('app.txt', 'v2\n', 'upstream');
  fs.writeFileSync(path.join(s.studio, 'app.txt'), 'local edit\n');
  const before = sh(s.studio, 'rev-parse', 'HEAD');
  const refused = await applyUpdate({ cwd: s.studio, exec: recording().exec, production: false });
  assert.deepEqual([refused.ok, refused.rolledBack], [false, undefined]);
  assert.match(refused.error!, /uncommitted changes/);
  assert.equal(fs.readFileSync(path.join(s.studio, 'app.txt'), 'utf8'), 'local edit\n', 'local work is untouched');
  assert.equal(sh(s.studio, 'rev-parse', 'HEAD'), before);

  sh(s.studio, 'checkout', '--', 'app.txt');
  const slow: Exec = async (file, args, options) => {
    await new Promise((r) => setTimeout(r, 150));
    return defaultExec(file, args, options);
  };
  const first = applyUpdate({ cwd: s.studio, exec: slow, production: false });
  const second = await applyUpdate({ cwd: s.studio, exec: slow, production: false });
  assert.match(second.error!, /already running/);
  assert.equal((await first).ok, true);
});
