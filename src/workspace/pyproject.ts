/**
 * Just enough TOML to show a Python project's dependencies. uv owns the real
 * file; this only reads it so the panel can list what is declared and which
 * version the lock file resolved.
 */

export interface PyProject {
  name?: string;
  version?: string;
  requiresPython?: string;
  dependencies: string[];
  /** `[dependency-groups] dev = [...]` (what `uv add --dev` writes) */
  devDependencies: string[];
}

const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, '');

/** The string items of `key = [ ... ]` inside a section (multi-line arrays, comments allowed) */
function arrayIn(section: string, key: string): string[] {
  const match = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*$`, 'm').exec(section);
  if (!match) return [];
  return [...match[1].replace(/#[^\n]*/g, '').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

function sectionOf(text: string, name: string): string {
  const start = new RegExp(`^\\[${name.replace(/[.[\]]/g, '\\$&')}\\]\\s*$`, 'm').exec(text);
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const next = /^\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

export function parsePyproject(text: string): PyProject {
  const project = sectionOf(text, 'project');
  const value = (key: string) => {
    const match = new RegExp(`^${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')`, 'm').exec(project);
    return match ? unquote(match[1]) : undefined;
  };
  return {
    name: value('name'),
    version: value('version'),
    requiresPython: value('requires-python'),
    dependencies: arrayIn(project, 'dependencies'),
    devDependencies: arrayIn(sectionOf(text, 'dependency-groups'), 'dev'),
  };
}

/** The distribution name in a requirement like `httpx[http2]>=0.27` */
export function requirementName(requirement: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(requirement.trim())?.[0] ?? requirement;
}

/** PEP 503 normalisation, which is how uv.lock spells names */
export const normalizeName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** name -> resolved version, from uv.lock */
export function parseLockVersions(lock: string): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const block of lock.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) versions[normalizeName(name)] = version;
  }
  return versions;
}
