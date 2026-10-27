/**
 * Skills from GitHub. Any public repository (or a private one you can read,
 * with your GitHub sign-in) can hold skills: every folder with a SKILL.md is
 * one. The studio lists them with their descriptions, you pick, and it
 * installs those folders pinned to the commit it read, so a skill never
 * changes under you; "update" moves it to the latest commit.
 *
 * Files are listed through the GitHub API, or with git when the API refuses
 * (rate limits, networks that block it), and read from raw.githubusercontent.com
 * at that exact commit. Nothing in a skill is executed by installing it.
 * Server only.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isSkillFilePath, LIMITS, parseSkillMd } from './format.ts';

const run = promisify(execFile);

export interface RepoSource {
  owner: string;
  repo: string;
  ref?: string;
  /** A folder (or a SKILL.md) inside the repository */
  path?: string;
}

const PART = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * "owner/repo", "owner/repo/some/folder", "github:owner/repo",
 * "https://github.com/owner/repo[/tree/<ref>/<path>]" or ".../blob/<ref>/<path>/SKILL.md"
 */
export function parseRepoSource(input: string): RepoSource | null {
  let text = input.trim().replace(/^github:/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const url = /^https?:\/\/(?:www\.)?github\.com\/(.+)$/i.exec(text);
  if (url) text = url[1];
  else if (/^[a-z]+:\/\//i.test(text)) return null;
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2 || !PART.test(parts[0]) || !PART.test(parts[1]) || parts[1] === '.' || parts[1] === '..') return null;
  const [owner, repo, kind, ...rest] = parts;
  let ref: string | undefined;
  let sub: string[] = [];
  if ((kind === 'tree' || kind === 'blob') && rest.length) {
    ref = rest[0];
    sub = rest.slice(1);
  } else if (kind) sub = [kind, ...rest];
  if (sub.length && /^SKILL\.md$/i.test(sub[sub.length - 1])) sub = sub.slice(0, -1);
  const subPath = sub.join('/');
  if (subPath && !isSkillFilePath(subPath)) return null;
  // Never starting with "-", so git can't read a ref as one of its options
  if (ref && !/^(?!-)[\w./-]{1,200}$/.test(ref)) return null;
  return { owner, repo, ...(ref ? { ref } : {}), ...(subPath ? { path: subPath } : {}) };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Git = (args: string[], cwd?: string) => Promise<string>;

export interface GithubOptions {
  token?: string;
  fetchImpl?: Fetch;
  git?: Git | null;
}

const defaultGit: Git = async (args, cwd) => (await run('git', args, { cwd, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;

const api = (o: GithubOptions) => async (url: string) => {
  const response = await (o.fetchImpl ?? fetch)(`https://api.github.com${url}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}`), { status: response.status });
  return response.json();
};

/** The commit a source points at, and every file in the repository at that commit */
export async function listRepo(src: RepoSource, o: GithubOptions = {}): Promise<{ sha: string; files: string[] }> {
  try {
    const get = api(o);
    const ref = src.ref ?? ((await get(`/repos/${src.owner}/${src.repo}`)) as { default_branch: string }).default_branch;
    const commit = (await get(`/repos/${src.owner}/${src.repo}/commits/${encodeURIComponent(ref)}`)) as { sha: string };
    const tree = (await get(`/repos/${src.owner}/${src.repo}/git/trees/${commit.sha}?recursive=1`)) as { tree: { path: string; type: string }[]; truncated?: boolean };
    if (tree.truncated && !src.path) throw new Error('This repository is too large to list; give the folder that holds the skills (owner/repo/path).');
    return { sha: commit.sha, files: tree.tree.filter((t) => t.type === 'blob').map((t) => t.path) };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) throw new Error(`${src.owner}/${src.repo}${src.ref ? `@${src.ref}` : ''} was not found (or is private: sign in with GitHub).`);
    const git = o.git === undefined ? defaultGit : o.git;
    if (!git) throw error;
    return listWithGit(src, git, o.token);
  }
}

/** The same through git: only trees are downloaded, never file contents */
async function listWithGit(src: RepoSource, git: Git, token?: string): Promise<{ sha: string; files: string[] }> {
  const url = `https://github.com/${src.owner}/${src.repo}.git`;
  // The token goes in a header, never the URL (which would show in the process list)
  const auth = token ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
  const dir = await mkdtemp(path.join(tmpdir(), 'aha-skills-'));
  try {
    await git(['init', '-q'], dir);
    const ref = src.ref ?? 'HEAD';
    await git([...auth, 'fetch', '-q', '--depth', '1', '--filter=blob:none', '--', url, ref], dir);
    const sha = (await git(['rev-parse', 'FETCH_HEAD'], dir)).trim();
    const files = (await git(['ls-tree', '-r', '--name-only', sha], dir)).split('\n').filter(Boolean);
    return { sha, files };
  } catch {
    throw new Error(`Could not read ${src.owner}/${src.repo}${src.ref ? `@${src.ref}` : ''} from GitHub. Check the name, or sign in with GitHub for private repositories.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const rawUrl = (src: RepoSource, sha: string, file: string) => `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${sha}/${file.split('/').map(encodeURIComponent).join('/')}`;

async function readRaw(src: RepoSource, sha: string, file: string, o: GithubOptions): Promise<string> {
  const response = await (o.fetchImpl ?? fetch)(rawUrl(src, sha, file), { headers: o.token ? { Authorization: `Bearer ${o.token}` } : {}, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${file}: GitHub answered ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > LIMITS.file) throw new Error(`${file} is larger than ${LIMITS.file / 1000} KB`);
  const text = await response.text();
  if (text.length > LIMITS.file) throw new Error(`${file} is larger than ${LIMITS.file / 1000} KB`);
  return text;
}

export interface FoundSkill {
  /** The folder in the repository ("" for a skill at the root) */
  dir: string;
  name: string;
  description: string;
  license?: string;
  files: number;
  error?: string;
}

/** Files we copy: text a skill uses. Binaries (images, archives, fonts) are left out */
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|wav|ogg|flac|psd|sketch|fig|docx?|xlsx?|pptx?|db|sqlite)$/i;

const skillFolders = (files: string[], under?: string) =>
  files
    .filter((f) => /(^|\/)SKILL\.md$/i.test(f))
    .map((f) => f.replace(/\/?SKILL\.md$/i, ''))
    .filter((dir) => !under || dir === under || dir.startsWith(`${under}/`))
    .filter((dir) => !dir.split('/').some((p) => p.startsWith('.') && p !== '.claude'))
    .sort();

const filesOf = (files: string[], dir: string) => files.filter((f) => (dir ? f.startsWith(`${dir}/`) : true) && !BINARY.test(f)).map((f) => (dir ? f.slice(dir.length + 1) : f));

/** The skills in a repository (or under a folder of it), with their names and descriptions */
export async function discoverSkills(src: RepoSource, o: GithubOptions = {}): Promise<{ sha: string; skills: FoundSkill[] }> {
  const { sha, files } = await listRepo(src, o);
  const dirs = skillFolders(files, src.path).slice(0, 150);
  if (!dirs.length) throw new Error(`No SKILL.md found in ${src.owner}/${src.repo}${src.path ? `/${src.path}` : ''}. A skill is a folder with a SKILL.md.`);
  const skills: FoundSkill[] = [];
  for (let i = 0; i < dirs.length; i += 8) {
    skills.push(
      ...(await Promise.all(
        dirs.slice(i, i + 8).map(async (dir): Promise<FoundSkill> => {
          const count = dir ? filesOf(files, dir).length : 1;
          const file = files.find((f) => f.toLowerCase() === `${dir ? `${dir}/` : ''}skill.md`)!;
          try {
            const parsed = parseSkillMd(await readRaw(src, sha, file, o), dir.split('/').pop() || src.repo);
            if ('error' in parsed) return { dir, name: dir.split('/').pop() || src.repo, description: '', files: count, error: parsed.error };
            return { dir, name: parsed.name, description: parsed.description, ...(parsed.license ? { license: parsed.license } : {}), files: count };
          } catch (error) {
            return { dir, name: dir.split('/').pop() || src.repo, description: '', files: count, error: (error as Error).message };
          }
        })
      ))
    );
  }
  return { sha, skills };
}

/** A skill folder's files at a commit, ready for the store */
export async function fetchSkillFolder(src: RepoSource, sha: string, dir: string, allFiles: string[], o: GithubOptions = {}): Promise<Record<string, string>> {
  // A skill at the repository root takes only its own top-level files and folders that aren't other skills
  const others = skillFolders(allFiles).filter((d) => d !== dir && (dir ? d.startsWith(`${dir}/`) : true));
  const wanted = filesOf(allFiles, dir).filter((f) => !others.some((d) => `${dir ? `${dir}/` : ''}${f}`.startsWith(`${d}/`)) && isSkillFilePath(f));
  if (wanted.length > LIMITS.files) throw new Error(`${dir || src.repo} has more than ${LIMITS.files} files`);
  const out: Record<string, string> = {};
  let total = 0;
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.all(wanted.slice(i, i + 8).map(async (f) => [f, await readRaw(src, sha, dir ? `${dir}/${f}` : f, o)] as const));
    for (const [f, text] of batch) {
      if (text.includes('\0')) continue;
      total += text.length;
      if (total > LIMITS.total) throw new Error(`${dir || src.repo} is larger than ${LIMITS.total / 1_000_000} MB`);
      out[/^skill\.md$/i.test(f) ? 'SKILL.md' : f] = text;
    }
  }
  return out;
}
