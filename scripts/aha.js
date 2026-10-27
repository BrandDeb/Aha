#!/usr/bin/env node
/**
 * `aha`: open the studio. If it is already running, opens its window with the launch key (from ~/.aha/launch.json,
 * see launch-key.js); if not, starts it under its supervisor first and waits until it is ready.
 *
 *   aha            open the studio in your browser
 *   aha --print    print the link instead of opening it
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const launch = require('./launch-key.js');

const READY_MS = 120_000;

function openInBrowser(url) {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Open this link in your browser: ${url}`));
  child.unref();
}

/** Start the studio in the background, with its output in ~/.aha/logs/studio.log */
function startStudio() {
  const root = path.join(__dirname, '..');
  const logs = path.join(path.dirname(launch.launchFile()), 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, 'studio.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'supervise.js')], { cwd: root, stdio: ['ignore', out, out], detached: true, env: process.env });
  child.unref();
  return path.join(logs, 'studio.log');
}

async function waitForStudio() {
  const started = Date.now();
  while (Date.now() - started < READY_MS) {
    const info = launch.readLaunchFile();
    if (info) return info;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

async function main(argv) {
  const print = argv.includes('--print');
  const unknown = argv.filter((a) => a !== '--print');
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}\nUsage: aha [--print]`);
    return 2;
  }
  let info = launch.readLaunchFile();
  if (!info) {
    const log = startStudio();
    console.log('Starting the studio…');
    info = await waitForStudio();
    if (!info) {
      console.error(`The studio didn't start within ${READY_MS / 1000}s. See ${log}`);
      return 1;
    }
  }
  const url = launch.launchUrl(info.url, info.key);
  if (print) console.log(url);
  else openInBrowser(url);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));

module.exports = { main };
