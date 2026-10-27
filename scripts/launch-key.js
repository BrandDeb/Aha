/**
 * The launch key: a random secret made each time the studio starts. The routes that run programs or touch files
 * on this machine answer only to a browser window opened with it, so other programs on the machine (and other
 * users of it) can't use the studio to run code, even though they can reach its port.
 *
 * The key reaches the window in the link the studio prints (and the desktop app and `aha` open): the server swaps
 * it for a cookie on first load and drops it from the address bar. It is also written to ~/.aha/launch.json,
 * readable by this user only, so `aha` can open the running studio again. Used by server.js and supervise.js.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PARAM = 'aha_key';

/**
 * Routes that need the key: everything that runs programs, installs things, reads or writes files on this machine,
 * or changes the studio itself. Compiling, the AI proxy, GitHub, registry lookups and health stay open, as they
 * are on a hosted studio.
 */
const GUARDED = /^\/api\/(?:autopilot|connectors|debug|devserver|doctor|extensions|folder|live|lsp|pipelines|python|remix|run|shell|skills|toolchains|update)(?:\/|$)/;

const newKey = () => crypto.randomBytes(24).toString('base64url');

/** A cookie per port: two studios on one machine (each with its own key) don't overwrite each other's */
const cookieName = (port) => `aha_key_${String(port).replace(/\D/g, '') || 'default'}`;

function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Whether a request carries the key: the cookie, or (for scripts) an `X-Aha-Key` header */
function hasKey(headers, key, port) {
  return sameKey(cookieValue(headers.cookie, cookieName(port)), key) || sameKey(headers['x-aha-key'], key);
}

/**
 * What to do with a request:
 *   { action: 'pass' }                         nothing to check, or it has the key
 *   { action: 'deny' }                         a guarded route without the key (server.js: "off" for GET, 403 otherwise)
 *   { action: 'unlock', location, cookie? }    a page opened with the key in its link: set the cookie, drop the key
 *   { action: 'unlock-failed', location }      a link with a wrong key (an old one from an earlier launch)
 */
function decide({ method, url, headers }, key, port) {
  const parsed = new URL(url || '/', 'http://studio');
  if (GUARDED.test(parsed.pathname)) return hasKey(headers, key, port) ? { action: 'pass' } : { action: 'deny' };
  const given = parsed.searchParams.get(PARAM);
  if (given === null || (method !== 'GET' && method !== 'HEAD')) return { action: 'pass' };
  parsed.searchParams.delete(PARAM);
  const location = parsed.pathname + parsed.search;
  // A window that already has the key keeps working when an old link is opened in it
  if (!sameKey(given, key)) return hasKey(headers, key, port) ? { action: 'unlock', location } : { action: 'unlock-failed', location };
  return { action: 'unlock', location, cookie: `${cookieName(port)}=${key}; HttpOnly; SameSite=Strict; Path=/` };
}

const homeDir = (env = process.env) => env.AHA_HOME || path.join(os.homedir(), '.aha');
const launchFile = (env = process.env) => path.join(homeDir(env), 'launch.json');

/** The link that opens the studio with its key */
const launchUrl = (base, key) => `${String(base).replace(/\/+$/, '')}/?${PARAM}=${encodeURIComponent(key)}`;

/** Record the running studio for `aha` (this user only). Failure is not fatal: the printed link still works */
function writeLaunchFile(info, env = process.env) {
  try {
    fs.mkdirSync(homeDir(env), { recursive: true, mode: 0o700 });
    const file = launchFile(env);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(info, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

/** The running studio, if the file names a live process; a stale file (a crash, a force quit) reads as none */
function readLaunchFile(env = process.env, alive = isAlive) {
  try {
    const info = JSON.parse(fs.readFileSync(launchFile(env), 'utf8'));
    if (!info || typeof info.url !== 'string' || typeof info.key !== 'string' || !alive(Number(info.pid))) return null;
    return info;
  } catch {
    return null;
  }
}

/** Remove the file if it is still ours (another studio may have started since) */
function removeLaunchFile(pid = process.pid, env = process.env) {
  try {
    const info = JSON.parse(fs.readFileSync(launchFile(env), 'utf8'));
    if (info && info.pid === pid) fs.unlinkSync(launchFile(env));
  } catch {
    // already gone
  }
}

function isAlive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

module.exports = { PARAM, GUARDED, newKey, cookieName, cookieValue, sameKey, hasKey, decide, launchFile, launchUrl, writeLaunchFile, readLaunchFile, removeLaunchFile };
