/**
 * Installed skills on this machine: ~/.aha/skills/<name>/ (one folder per
 * skill, as in the Agent Skills format), plus skills.json for which are turned
 * off and where installed ones came from. Built-in skills are read from code
 * and can be turned off but not removed. Server only.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { AHA_DIR } from '../connectors/env.ts';
import { BUILTIN_SKILLS } from './builtin.ts';
import { isSkillFilePath, isSkillName, LIMITS, parseSkillMd, type SkillDoc, type SkillMeta } from './format.ts';

export interface SkillSource {
  /** owner/repo on GitHub, or "you" for skills written here */
  repo: string;
  /** What was asked for (branch, tag or commit) and the commit it resolved to */
  ref?: string;
  sha?: string;
  /** The skill folder within the repository */
  path?: string;
  installedAt: number;
}

interface State {
  disabled: string[];
  sources: Record<string, SkillSource>;
}

export const skillsDir = () => path.join(AHA_DIR, 'skills');
const statePath = () => path.join(AHA_DIR, 'skills.json');

async function readState(): Promise<State> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    return { disabled: Array.isArray(raw.disabled) ? raw.disabled.filter((n: unknown) => typeof n === 'string') : [], sources: raw.sources && typeof raw.sources === 'object' ? raw.sources : {} };
  } catch {
    return { disabled: [], sources: {} };
  }
}

async function writeState(state: State): Promise<void> {
  await fs.mkdir(AHA_DIR, { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2));
}

const describeSource = (s?: SkillSource) => (!s ? undefined : s.repo === 'you' ? 'you' : `${s.repo}${s.path ? `/${s.path}` : ''}${s.sha ? `@${s.sha.slice(0, 7)}` : ''}`);

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Installed skills' SKILL.md, parsed */
async function installed(): Promise<{ name: string; description: string; license?: string; body: string }[]> {
  const out = [];
  for (const entry of await fs.readdir(skillsDir(), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !isSkillName(entry.name)) continue;
    const text = await fs.readFile(path.join(skillsDir(), entry.name, 'SKILL.md'), 'utf8').catch(() => null);
    if (text === null) continue;
    const parsed = parseSkillMd(text, entry.name);
    if (!('error' in parsed)) out.push({ ...parsed, name: entry.name });
  }
  return out;
}

/** Every skill on this machine: built in and installed (installed ones win on a name clash) */
export async function listSkills(): Promise<SkillMeta[]> {
  const state = await readState();
  const mine = await installed();
  const names = new Set(mine.map((s) => s.name));
  const builtin = Object.entries(BUILTIN_SKILLS)
    .filter(([name]) => !names.has(name))
    .flatMap(([name, files]): SkillMeta[] => {
      const parsed = parseSkillMd(files['SKILL.md'], name);
      return 'error' in parsed ? [] : [{ name, description: parsed.description, origin: 'builtin', license: parsed.license, enabled: !state.disabled.includes(name) }];
    });
  const own = mine.map((s): SkillMeta => ({ name: s.name, description: s.description, origin: 'installed', source: describeSource(state.sources[s.name]), ...(s.license ? { license: s.license } : {}), enabled: !state.disabled.includes(s.name) }));
  return [...own, ...builtin].sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(name: string): Promise<SkillDoc | null> {
  if (!isSkillName(name)) return null;
  const meta = (await listSkills()).find((s) => s.name === name);
  if (!meta) return null;
  if (meta.origin === 'builtin') {
    const files = BUILTIN_SKILLS[name];
    const parsed = parseSkillMd(files['SKILL.md'], name);
    return 'error' in parsed ? null : { meta, body: parsed.body, files: Object.keys(files).filter((f) => f !== 'SKILL.md') };
  }
  const dir = path.join(skillsDir(), name);
  const parsed = parseSkillMd(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'), name);
  if ('error' in parsed) return null;
  return { meta, body: parsed.body, files: (await listFiles(dir)).filter((f) => f !== 'SKILL.md') };
}

export async function readSkillFile(name: string, file: string): Promise<string | null> {
  if (!isSkillName(name) || !isSkillFilePath(file)) return null;
  const meta = (await listSkills()).find((s) => s.name === name);
  if (!meta) return null;
  if (meta.origin === 'builtin') return BUILTIN_SKILLS[name][file] ?? null;
  const root = path.join(skillsDir(), name);
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) return null;
  // Symlinks could point anywhere: only plain files inside the folder
  const stat = await fs.lstat(full).catch(() => null);
  if (!stat?.isFile() || stat.size > LIMITS.file) return null;
  return fs.readFile(full, 'utf8');
}

/** Check a skill's files before writing them */
export function checkSkillFiles(files: Record<string, string>): { name: string } | { error: string } {
  const md = files['SKILL.md'];
  if (typeof md !== 'string') return { error: 'A skill needs a SKILL.md' };
  const parsed = parseSkillMd(md);
  if ('error' in parsed) return parsed;
  const entries = Object.entries(files);
  if (entries.length > LIMITS.files) return { error: `A skill may have at most ${LIMITS.files} files` };
  let total = 0;
  for (const [file, content] of entries) {
    if (!isSkillFilePath(file)) return { error: `Unsafe file path: ${file.slice(0, 80)}` };
    if (typeof content !== 'string' || content.includes('\0')) return { error: `${file} is not a text file` };
    if (content.length > LIMITS.file) return { error: `${file} is larger than ${LIMITS.file / 1000} KB` };
    total += content.length;
  }
  if (total > LIMITS.total) return { error: `The skill is larger than ${LIMITS.total / 1_000_000} MB` };
  return { name: parsed.name };
}

/** Install or replace a skill (the folder is swapped in whole, never half-written) */
export async function writeSkill(files: Record<string, string>, source: SkillSource): Promise<{ name: string } | { error: string }> {
  const checked = checkSkillFiles(files);
  if ('error' in checked) return checked;
  const { name } = checked;
  const dest = path.join(skillsDir(), name);
  const staging = `${dest}.partial-${process.pid}-${Date.now()}`;
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(staging, ...file.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  await fs.rm(dest, { recursive: true, force: true });
  await fs.rename(staging, dest);
  const state = await readState();
  state.sources[name] = source;
  await writeState(state);
  return { name };
}

export async function removeSkill(name: string): Promise<boolean> {
  if (!isSkillName(name)) return false;
  const dir = path.join(skillsDir(), name);
  if (!existsSync(dir)) return false;
  await fs.rm(dir, { recursive: true, force: true });
  const state = await readState();
  delete state.sources[name];
  state.disabled = state.disabled.filter((n) => n !== name);
  await writeState(state);
  return true;
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const state = await readState();
  state.disabled = enabled ? state.disabled.filter((n) => n !== name) : [...new Set([...state.disabled, name])];
  await writeState(state);
}

export async function skillSource(name: string): Promise<SkillSource | null> {
  return (await readState()).sources[name] ?? null;
}
