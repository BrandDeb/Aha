/**
 * Keeps the studio running: starts `node server.js`, restarts it when it
 * crashes (with a growing pause, so a broken build doesn't spin the CPU),
 * restarts it straight away when it asks to (exit code 75, used after an
 * update), and stops when it exits cleanly or crashes too often too quickly.
 *
 *   node scripts/supervise.js            run the studio under supervision
 *
 * It does nothing clever beyond that: no daemonising, no files, and Ctrl+C
 * stops both processes.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

/** The exit code server.js uses to say "start me again" */
const RESTART_CODE = 75;

/**
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.maxCrashes]     crashes allowed within `windowMs` before giving up
 * @param {number} [options.windowMs]
 * @param {number} [options.baseDelayMs]    first pause after a crash; doubles each time up to `maxDelayMs`
 * @param {number} [options.maxDelayMs]
 * @param {(message: string) => void} [options.log]
 * @param {() => boolean} [options.onRepeatedCrash] called after a second crash in the window; returning true
 *   (it repaired something, e.g. rolled back an update) starts the studio again straight away
 * @param {() => number} [options.now]
 * @returns {{ done: Promise<number>, stop: () => void }}
 */
function supervise(options) {
  const { command, args, env = process.env, maxCrashes = 6, windowMs = 120_000, baseDelayMs = 1000, maxDelayMs = 30_000, log = console.log, now = Date.now, onRepeatedCrash } = options;
  let child = null;
  let stopping = false;
  let crashes = [];
  let delay = baseDelayMs;
  let timer = null;
  let resolveDone = () => {};
  const done = new Promise((resolve) => (resolveDone = resolve));

  const start = () => {
    const started = now();
    child = spawn(command, args, { env: { ...env, NANOCLI_SUPERVISED: '1' }, stdio: 'inherit' });
    child.on('error', (error) => {
      log(`[supervisor] could not start: ${error.message}`);
      child = null;
      resolveDone(1);
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return resolveDone(code ?? 0);
      if (code === 0) return resolveDone(0);
      if (code === RESTART_CODE) {
        log('[supervisor] restarting as requested');
        delay = baseDelayMs;
        return start();
      }
      const t = now();
      crashes = crashes.filter((c) => t - c < windowMs);
      crashes.push(t);
      if (t - started > windowMs) delay = baseDelayMs; // it ran for a good while: not a crash loop
      if (crashes.length >= 2 && onRepeatedCrash && onRepeatedCrash()) {
        crashes = [];
        delay = baseDelayMs;
        return start();
      }
      if (crashes.length > maxCrashes) {
        log(`[supervisor] the studio crashed ${crashes.length} times in ${Math.round(windowMs / 1000)}s; giving up. Check the messages above, then start it again.`);
        return resolveDone(code ?? 1);
      }
      log(`[supervisor] the studio stopped (${signal ? `signal ${signal}` : `code ${code}`}); restarting in ${(delay / 1000).toFixed(delay % 1000 ? 1 : 0)}s`);
      timer = setTimeout(start, delay);
      delay = Math.min(delay * 2, maxDelayMs);
    });
  };

  start();
  return {
    done,
    stop: () => {
      stopping = true;
      clearTimeout(timer);
      if (child) child.kill('SIGTERM');
      else resolveDone(0);
    },
  };
}

module.exports = { supervise, RESTART_CODE };

/**
 * The autopilot updated the studio and restarted it, but the new version keeps crashing before it could
 * confirm it's healthy: put the previous version back (only if the checkout is exactly the update it made).
 */
function rollbackUnverifiedUpdate(root, log = console.log, run = defaultRun) {
  const fs = require('node:fs');
  const os = require('node:os');
  const file = path.join(process.env.NANOCLI_HOME || path.join(os.homedir(), '.nanocli'), 'autopilot.json');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const pending = state.pendingVerify;
  if (!pending || !/^[0-9a-f]{7,40}$/.test(pending.from) || !/^[0-9a-f]{7,40}$/.test(pending.to)) return false;
  const save = (message, kind) => {
    const next = { ...state, pendingVerify: undefined, journal: [{ at: Date.now(), kind, message }, ...(state.journal || [])].slice(0, 50) };
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  };
  if (run('git', ['rev-parse', 'HEAD'], root).output.trim() !== pending.to) {
    save('The checkout changed after the update; left it as it is.', 'error');
    return false;
  }
  log(`[supervisor] version ${pending.to.slice(0, 7)} keeps crashing; putting ${pending.from.slice(0, 7)} back…`);
  const depsChanged = run('git', ['diff', '--name-only', pending.from, pending.to, '--', 'package.json', 'package-lock.json'], root).output.trim() !== '';
  const ok =
    run('git', ['reset', '--hard', pending.from], root).ok &&
    (!depsChanged || run('npm', ['ci', '--no-audit', '--no-fund'], root).ok) &&
    (process.env.NODE_ENV !== 'production' || run('npm', ['run', 'build'], root).ok);
  save(ok ? `Version ${pending.to.slice(0, 7)} kept crashing, so ${pending.from.slice(0, 7)} was put back.` : `Rolling back to ${pending.from.slice(0, 7)} failed; see the server log.`, ok ? 'rollback' : 'error');
  return ok;
}

function defaultRun(command, args, cwd) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: 15 * 60_000 });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}` };
}

module.exports.rollbackUnverifiedUpdate = rollbackUnverifiedUpdate;

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const run = supervise({ command: process.execPath, args: [path.join(root, 'server.js')], env: process.env, onRepeatedCrash: () => rollbackUnverifiedUpdate(root) });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, run.stop);
  // Started by the desktop app: if the app goes away without stopping us (a crash, a force quit), stop too
  const parent = Number(process.env.NANOCLI_PARENT_PID);
  if (parent > 0) {
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        run.stop();
      }
    }, 2000).unref();
  }
  run.done.then((code) => process.exit(code));
}
