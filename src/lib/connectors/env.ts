import os from 'node:os';
import path from 'node:path';

export const AHA_DIR = process.env.AHA_HOME || path.join(os.homedir(), '.aha');
export const CONNECTOR_DIR = path.join(AHA_DIR, 'connectors');
export const CONNECTOR_HOME = path.join(CONNECTOR_DIR, 'home');
export const CONNECTOR_WORK = path.join(CONNECTOR_DIR, 'work');

/** Host variables a tool legitimately needs; the studio's own secrets are never inherited */
const INHERITED = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
];

/** What a connector's process sees: a short allow-list, a private HOME, then the variables the user configured */
export function connectorEnv(host: NodeJS.ProcessEnv, user: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED) if (host[key] !== undefined) env[key] = host[key] as string;
  return {
    ...env,
    HOME: CONNECTOR_HOME,
    USERPROFILE: CONNECTOR_HOME,
    XDG_CACHE_HOME: path.join(CONNECTOR_DIR, 'cache'),
    UV_CACHE_DIR: path.join(AHA_DIR, 'cache', 'uv'), // the same cache the Python runner uses
    NO_COLOR: '1',
    ...user,
  };
}
