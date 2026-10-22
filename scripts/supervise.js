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
 * @param {() => number} [options.now]
 * @returns {{ done: Promise<number>, stop: () => void }}
 */
function supervise(options) {
  const { command, args, env = process.env, maxCrashes = 6, windowMs = 120_000, baseDelayMs = 1000, maxDelayMs = 30_000, log = console.log, now = Date.now } = options;
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

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const run = supervise({ command: process.execPath, args: [path.join(root, 'server.js')], env: process.env });
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
