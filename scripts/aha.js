#!/usr/bin/env node
/**
 * `aha`: open the studio. If it is already running, opens its window with the launch key (from ~/.aha/launch.json,
 * see launch-key.js); if not, starts it under its supervisor first and waits until it is ready.
 *
 *   aha            open the studio in your browser
 *   aha <folder>   open a folder on this machine in it (aha . for the current one); edits save in place
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

/** Ask the running studio to open a folder; its id goes in the link (the path never does) */
async function openFolder(info, folder) {
  const response = await fetch(new URL('/api/folder', info.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Aha-Key': info.key },
    body: JSON.stringify({ action: 'open', path: folder }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `The studio answered ${response.status}`);
  return data;
}

async function main(argv) {
  const print = argv.includes('--print');
  const rest = argv.filter((a) => a !== '--print');
  const unknown = rest.filter((a) => a.startsWith('-'));
  if (unknown.length || rest.length > 1) {
    console.error(`${unknown.length ? `Unknown option: ${unknown[0]}` : 'Give one folder'}\nUsage: aha [folder] [--print]`);
    return 2;
  }
  // `npm run open -- .` runs from the studio's folder; npm says where it was typed
  const here = process.env.npm_lifecycle_event === 'open' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const folder = rest[0] ? path.resolve(here, rest[0]) : null;
  if (folder && !fs.existsSync(folder)) {
    console.error(`There is no folder at ${folder}`);
    return 1;
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
  let url = launch.launchUrl(info.url, info.key);
  if (folder) {
    try {
      const opened = await openFolder(info, folder);
      url += `&folder=${encodeURIComponent(opened.id)}`;
      console.log(`Opening ${opened.root} (${Object.keys(opened.files).length} files)`);
    } catch (error) {
      console.error(`Couldn't open ${folder}: ${error.message}`);
      return 1;
    }
  }
  if (print) console.log(url);
  else openInBrowser(url);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));

module.exports = { main };
