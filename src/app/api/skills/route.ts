import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, getToken, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost, listensOnLoopbackOnly } from '@/lib/host';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonLimited } from '@/lib/request-guard';
import { formatSkillMd, isSkillFilePath, isSkillName, LIMITS, toSkillName } from '@/lib/skills/format';
import { discoverSkills, fetchSkillFolder, listRepo, parseRepoSource, type RepoSource } from '@/lib/skills/github';
import { listSkills, readSkill, readSkillFile, removeSkill, setSkillEnabled, skillSource, writeSkill } from '@/lib/skills/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reading GitHub repositories: generous for browsing, but not a proxy */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

const trusted = (request: NextRequest) => isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS);

/** Installing and writing skills changes this machine: only when the studio runs on it (or AHA_SKILLS=1) */
export function skillsWritable(env: Record<string, string | undefined> = process.env): boolean {
  if (env.AHA_SKILLS === '0') return false;
  if (env.AHA_SKILLS === '1') return true;
  return listensOnLoopbackOnly(env);
}

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET                      → { writable, skills } (names, descriptions, where from, on/off)
 * GET ?name=x              → the skill: instructions and file list
 * GET ?name=x&file=a/b.md  → one of its files
 */
export async function GET(request: NextRequest) {
  if (!trusted(request)) return json({ error: 'Not available for this host name.' }, 403);
  const name = request.nextUrl.searchParams.get('name');
  const file = request.nextUrl.searchParams.get('file');
  if (!name) return json({ writable: skillsWritable(), skills: await listSkills() });
  if (!isSkillName(name)) return json({ error: 'Invalid skill name' }, 400);
  if (file !== null) {
    if (!isSkillFilePath(file)) return json({ error: 'Invalid file path' }, 400);
    const text = await readSkillFile(name, file);
    return text === null ? json({ error: 'Not found' }, 404) : json({ text });
  }
  const doc = await readSkill(name);
  return doc ? json(doc) : json({ error: 'Not found' }, 404);
}

/**
 * { action: 'discover', source }                 → the skills in a GitHub repository or folder
 * { action: 'install', source, sha, dirs }       → install those folders, pinned to sha
 * { action: 'update', name }                     → move an installed skill to the latest commit
 * { action: 'create', name, description, body }  → write your own (also edits one you wrote)
 * { action: 'enable', name, enabled }
 * { action: 'remove', name }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  if (!trusted(request)) return json({ error: 'Skills are only managed for localhost or the site in NEXT_PUBLIC_BASE_URL.' }, 403);
  if (!skillsWritable()) return json({ error: 'Installing skills is off: the studio only does it when it runs on your own machine.' }, 503);
  const body = await readJsonLimited(request, 200_000);
  if (!body.ok) return json({ error: body.error }, body.status);
  const input = (body.value ?? {}) as Record<string, unknown>;
  const github = { token: getToken(request) };

  try {
    switch (input.action) {
      case 'discover':
      case 'install': {
        const wait = limiter.check(clientKey(request.headers));
        if (wait) return json({ error: `Too many requests. Try again in ${Math.ceil(wait / 60)} min.` }, 429);
        const src = typeof input.source === 'string' ? parseRepoSource(input.source) : null;
        if (!src) return json({ error: 'Give a GitHub repository: owner/repo, a folder in it, or its URL.' }, 400);
        if (input.action === 'discover') return json({ source: src, ...(await discoverSkills(src, github)) });
        const sha = typeof input.sha === 'string' && /^[0-9a-f]{40}$/.test(input.sha) ? input.sha : null;
        const dirs = Array.isArray(input.dirs) ? input.dirs.filter((d): d is string => typeof d === 'string' && (d === '' || isSkillFilePath(d))).slice(0, 50) : [];
        if (!dirs.length) return json({ error: 'Choose at least one skill.' }, 400);
        const pinned: RepoSource = { ...src, ref: sha ?? src.ref };
        const { sha: commit, files } = await listRepo(pinned, github);
        const results = [];
        for (const dir of dirs) {
          try {
            const folder = await fetchSkillFolder(pinned, commit, dir, files, github);
            const written = await writeSkill(folder, { repo: `${src.owner}/${src.repo}`, ref: src.ref, sha: commit, path: dir, installedAt: Date.now() });
            results.push({ dir, ...written });
          } catch (error) {
            results.push({ dir, error: (error as Error).message });
          }
        }
        return json({ sha: commit, results, skills: await listSkills() });
      }

      case 'update': {
        const name = String(input.name ?? '');
        const source = isSkillName(name) ? await skillSource(name) : null;
        if (!source || source.repo === 'you') return json({ error: 'Only skills installed from GitHub can be updated.' }, 400);
        const [owner, repo] = source.repo.split('/');
        const src: RepoSource = { owner, repo, ...(source.ref ? { ref: source.ref } : {}) };
        const { sha, files } = await listRepo(src, github);
        if (sha === source.sha) return json({ updated: false, sha, skills: await listSkills() });
        const folder = await fetchSkillFolder(src, sha, source.path ?? '', files, github);
        const written = await writeSkill(folder, { ...source, sha, installedAt: Date.now() });
        if ('error' in written) return json(written, 400);
        return json({ updated: true, sha, skills: await listSkills() });
      }

      case 'create': {
        const name = toSkillName(String(input.name ?? ''));
        const description = String(input.description ?? '').trim();
        const text = String(input.body ?? '');
        if (!isSkillName(name)) return json({ error: 'Give the skill a name (letters, digits and hyphens).' }, 400);
        if (!description) return json({ error: 'Describe what the skill does and when to use it: the agent decides from this.' }, 400);
        if (description.length > LIMITS.specDescription) return json({ error: `Keep the description under ${LIMITS.specDescription} characters.` }, 400);
        if (!text.trim()) return json({ error: 'Write the instructions.' }, 400);
        const existing = await skillSource(name);
        if (existing && existing.repo !== 'you') return json({ error: `${name} was installed from ${existing.repo}; choose another name.` }, 409);
        const written = await writeSkill({ 'SKILL.md': formatSkillMd({ name, description, body: text }) }, { repo: 'you', installedAt: Date.now() });
        return 'error' in written ? json(written, 400) : json({ name, skills: await listSkills() });
      }

      case 'enable': {
        const name = String(input.name ?? '');
        if (!isSkillName(name)) return json({ error: 'Invalid skill name' }, 400);
        await setSkillEnabled(name, input.enabled !== false);
        return json({ skills: await listSkills() });
      }

      case 'remove': {
        const name = String(input.name ?? '');
        if (!isSkillName(name)) return json({ error: 'Invalid skill name' }, 400);
        if (!(await removeSkill(name))) return json({ error: 'Built-in skills can be turned off, not removed.' }, 400);
        return json({ skills: await listSkills() });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}
