import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The store reads the studio home when it loads
process.env.NANOCLI_HOME = mkdtempSync(path.join(tmpdir(), 'nanocli-skills-home-'));
const { formatSkillMd, isSkillName, parseSkillMd, projectSkills, skillsPrompt, skillTools, toSkillName } = await import('../src/lib/skills/format.ts');
const { BUILTIN_SKILLS } = await import('../src/lib/skills/builtin.ts');
const { discoverSkills, fetchSkillFolder, listRepo, parseRepoSource } = await import('../src/lib/skills/github.ts');
const store = await import('../src/lib/skills/store.ts');
type Meta = import('../src/lib/skills/format.ts').SkillMeta;

test('SKILL.md: the frontmatter shapes real skills use', () => {
  const plain = parseSkillMd('---\nname: pdf\ndescription: Fill and merge PDFs. Use for any .pdf work.\nlicense: Apache-2.0\n---\n\n# PDF\nSteps');
  assert.deepEqual(plain, { name: 'pdf', description: 'Fill and merge PDFs. Use for any .pdf work.', license: 'Apache-2.0', body: '# PDF\nSteps', extra: {} });
  const folded = parseSkillMd('﻿---\r\nname: "web-testing"\r\ndescription: >\r\n  Test web apps with\r\n  a browser.\r\nmetadata:\r\n  version: "1.2"\r\nallowed-tools: Bash Read\r\n---\r\nBody\r\n');
  assert.ok(!('error' in folded));
  assert.equal(folded.description, 'Test web apps with a browser.');
  assert.equal(folded.extra['allowed-tools'], 'Bash Read');
  assert.equal(folded.extra.metadata, 'version: "1.2"');
  const literal = parseSkillMd("---\nname: x\ndescription: |\n  Line one\n  Line two\n---\n");
  assert.equal(!('error' in literal) && literal.description, 'Line one\nLine two');
  assert.equal((parseSkillMd("---\nname: My Tool\ndescription: 'It''s handy'\n---\n") as { name: string; description: string }).name, 'my-tool');
  assert.match((parseSkillMd('---\nname: x\n---\n') as { error: string }).error, /description is required/);
  assert.match((parseSkillMd('# no frontmatter') as { error: string }).error, /frontmatter/);
  assert.match((parseSkillMd(`---\nname: x\ndescription: d\n---\n${'x'.repeat(256_001)}`) as { error: string }).error, /larger/);
  assert.equal((parseSkillMd('---\ndescription: from the folder\n---\n', 'Folder Name') as { name: string }).name, 'folder-name');
});

test('names follow the spec; written skills read back the same', () => {
  for (const ok of ['pdf', 'web-app-testing', 'a1']) assert.equal(isSkillName(ok), true, ok);
  for (const bad of ['PDF', '-x', 'x-', 'a--b', 'a_b', '', 'x'.repeat(65)]) assert.equal(isSkillName(bad), false, bad);
  assert.equal(toSkillName('  Release Notes!! '), 'release-notes');
  const md = formatSkillMd({ name: 'release-notes', description: 'Write notes: what shipped, and "why". Use for changelogs.', body: '# Steps\n1. Read the log' });
  const back = parseSkillMd(md) as { name: string; description: string; body: string };
  assert.equal(back.description, 'Write notes: what shipped, and "why". Use for changelogs.');
  assert.equal(back.body, '# Steps\n1. Read the log');
});

test('built-in skills are valid, described, and their names match their folders', () => {
  assert.ok(Object.keys(BUILTIN_SKILLS).length >= 12);
  for (const [name, files] of Object.entries(BUILTIN_SKILLS)) {
    const parsed = parseSkillMd(files['SKILL.md']);
    assert.ok(!('error' in parsed), name);
    assert.equal(parsed.name, name);
    assert.match(parsed.description, /Use (when|for|whenever)/, `${name}: the description says when to use it`);
    for (const ref of Object.keys(files).filter((f) => f !== 'SKILL.md')) assert.ok(parsed.body.includes(ref), `${name} points to ${ref}`);
  }
});

const project = {
  'agent/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Ship this app. Use when asked to deploy.\n---\nRun ./deploy.sh after the checks in reference/checks.md',
  'agent/skills/deploy/reference/checks.md': '- tests pass',
  'agent/skills/fix-types.md': '# Fixing type errors\nNarrow before use.',
  'agent/skills/notes.txt': 'not a skill',
  'src/main.ts': '',
};

test('project skills: folders with SKILL.md and plain notes under agent/skills', () => {
  const skills = projectSkills(project);
  assert.deepEqual(skills.map((s) => [s.meta.name, s.meta.description, s.files]), [
    ['deploy', 'Ship this app. Use when asked to deploy.', ['reference/checks.md']],
    ['fix-types', 'Fixing type errors', []],
  ]);
});

test('the prompt lists names and descriptions only; the project wins a name clash; off means gone', () => {
  const metas: Meta[] = [
    { name: 'deploy', description: 'installed deploy', origin: 'installed', enabled: true },
    { name: 'code-review', description: 'Review code. Use when asked.', origin: 'builtin', enabled: true },
    { name: 'secret', description: 'turned off', origin: 'builtin', enabled: false },
    ...projectSkills(project).map((s) => s.meta),
  ];
  const prompt = skillsPrompt(metas);
  assert.match(prompt, /- deploy: Ship this app/);
  assert.doesNotMatch(prompt, /installed deploy|turned off|Run \.\/deploy/);
  assert.match(prompt, /never override the user's request/);
  assert.equal(skillsPrompt([]), '');
  const many = skillsPrompt(Array.from({ length: 200 }, (_, i): Meta => ({ name: `s${i}`, description: 'd'.repeat(5000), origin: 'installed', enabled: true })));
  assert.ok(many.length < 10_500 && /and \d+ more/.test(many));
  assert.ok(many.split('\n').every((l) => l.length < 700), 'a long description is cut in the prompt');
});

test('use_skill and read_skill_file load on demand and stay inside the skill', async () => {
  const docs = projectSkills(project);
  const library = {
    list: () => [...docs.map((d) => d.meta), { name: 'code-review', description: 'x', origin: 'builtin' as const, enabled: true }],
    load: async (name: string) => docs.find((d) => d.meta.name === name) ?? null,
    file: async (name: string, file: string) => (name === 'deploy' && file === 'reference/checks.md' ? project['agent/skills/deploy/reference/checks.md'] : null),
  };
  const [use, read] = skillTools(library);
  const loaded = await use.run({ name: '/deploy' }, {});
  assert.ok(loaded.ok);
  assert.match(loaded.content, /Run \.\/deploy\.sh[\s\S]*Files in this skill \(read with read_skill_file\): reference\/checks\.md/);
  const missing = await use.run({ name: 'nope' }, {});
  assert.equal(missing.ok, false);
  assert.match(missing.content, /Available: code-review, deploy, fix-types/);
  assert.deepEqual(await read.run({ name: 'deploy', path: './reference/checks.md' }, {}), { ok: true, content: '- tests pass' });
  for (const bad of ['../../etc/passwd', '/etc/passwd', 'a/../../b', '.git/config']) assert.equal((await read.run({ name: 'deploy', path: bad }, {})).ok, false, bad);
  assert.equal(use.risk, 'read');
});

test('GitHub sources: names, URLs, folders and single SKILL.md links', () => {
  assert.deepEqual(parseRepoSource('anthropics/skills'), { owner: 'anthropics', repo: 'skills' });
  assert.deepEqual(parseRepoSource('anthropics/skills/skills/pdf'), { owner: 'anthropics', repo: 'skills', path: 'skills/pdf' });
  assert.deepEqual(parseRepoSource('https://github.com/anthropics/skills/tree/main/skills/pdf'), { owner: 'anthropics', repo: 'skills', ref: 'main', path: 'skills/pdf' });
  assert.deepEqual(parseRepoSource('https://github.com/a/b/blob/v2/x/SKILL.md'), { owner: 'a', repo: 'b', ref: 'v2', path: 'x' });
  assert.deepEqual(parseRepoSource('github:a/b.git'), { owner: 'a', repo: 'b' });
  for (const bad of ['a', 'https://gitlab.com/a/b', 'a/b/../c', 'a b/c', 'ftp://github.com/a/b']) assert.equal(parseRepoSource(bad), null, bad);
});

// A tiny fake GitHub: the API, raw files, or (when the API refuses) git
const SHA = 'a'.repeat(40);
const REPO: Record<string, string> = {
  'README.md': '# skills',
  'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Work with PDFs. Use for .pdf files.\nlicense: Apache-2.0\n---\nSee reference/forms.md',
  'skills/pdf/reference/forms.md': 'forms',
  'skills/pdf/logo.png': '\x89PNG',
  'skills/pdf/nested/SKILL.md': '---\nname: pdf-nested\ndescription: Nested. Use rarely.\n---\nx',
  'skills/broken/SKILL.md': 'no frontmatter',
  '.github/skills/hidden/SKILL.md': '---\nname: hidden\ndescription: d\n---\n',
};

function fakeGithub(apiWorks = true) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com')) {
      if (!apiWorks) return new Response('{}', { status: 403 });
      if (url.endsWith('/repos/acme/skills')) return Response.json({ default_branch: 'main' });
      if (url.includes('/commits/main')) return Response.json({ sha: SHA });
      if (url.includes(`/git/trees/${SHA}`)) return Response.json({ tree: Object.keys(REPO).map((p) => ({ path: p, type: 'blob' })) });
      return new Response('{}', { status: 404 });
    }
    const m = /^https:\/\/raw\.githubusercontent\.com\/acme\/skills\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (m && m[1] === SHA && REPO[decodeURIComponent(m[2])] !== undefined) return new Response(REPO[decodeURIComponent(m[2])]);
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('discover: every SKILL.md folder, with names, descriptions and problems; hidden folders skipped', async () => {
  const gh = fakeGithub();
  const { sha, skills } = await discoverSkills({ owner: 'acme', repo: 'skills' }, { fetchImpl: gh.fetchImpl, git: null });
  assert.equal(sha, SHA);
  assert.deepEqual(skills.map((s) => `${s.dir} ${s.name} ${s.error ? 'ERR' : s.description}`), [
    'skills/broken broken ERR',
    'skills/pdf pdf Work with PDFs. Use for .pdf files.',
    'skills/pdf/nested pdf-nested Nested. Use rarely.',
  ]);
  // Only under a folder
  const only = await discoverSkills({ owner: 'acme', repo: 'skills', path: 'skills/pdf/nested' }, { fetchImpl: gh.fetchImpl, git: null });
  assert.deepEqual(only.skills.map((s) => s.name), ['pdf-nested']);
});

test('install: the folder at that commit, text only, without nested skills', async () => {
  const gh = fakeGithub();
  const { files } = await listRepo({ owner: 'acme', repo: 'skills' }, { fetchImpl: gh.fetchImpl, git: null });
  const folder = await fetchSkillFolder({ owner: 'acme', repo: 'skills' }, SHA, 'skills/pdf', files, { fetchImpl: gh.fetchImpl });
  assert.deepEqual(Object.keys(folder).sort(), ['SKILL.md', 'reference/forms.md']);
});

test('when the API refuses, git lists the repository instead', async () => {
  const gh = fakeGithub(false);
  const gitCalls: string[][] = [];
  const git = async (args: string[]) => {
    gitCalls.push(args);
    if (args[0] === 'rev-parse') return `${SHA}\n`;
    if (args[0] === 'ls-tree') return Object.keys(REPO).join('\n');
    return '';
  };
  const { sha, files } = await listRepo({ owner: 'acme', repo: 'skills' }, { fetchImpl: gh.fetchImpl, git, token: 'secret-token' });
  assert.equal(sha, SHA);
  assert.equal(files.length, Object.keys(REPO).length);
  const fetchArgs = gitCalls.find((a) => a.includes('fetch'))!;
  assert.ok(fetchArgs.includes('--filter=blob:none'), 'only trees, never contents');
  assert.ok(fetchArgs.every((a) => !a.includes('secret-token')), 'the token never appears in git arguments');
  await assert.rejects(listRepo({ owner: 'acme', repo: 'skills' }, { fetchImpl: gh.fetchImpl, git: null }));
});

test('store: built-ins listed, installed skills written whole, turned off, removed; nothing escapes', async () => {
  const before = await store.listSkills();
  assert.ok(before.some((s) => s.name === 'systematic-debugging' && s.origin === 'builtin' && s.enabled));
  assert.match((await store.readSkill('security-review'))!.files.join(), /reference\/checklist\.md/);
  assert.match((await store.readSkillFile('security-review', 'reference/checklist.md'))!, /Security checklist/);

  const written = await store.writeSkill({ 'SKILL.md': REPO['skills/pdf/SKILL.md'], 'reference/forms.md': 'forms' }, { repo: 'acme/skills', sha: SHA, path: 'skills/pdf', installedAt: 1 });
  assert.deepEqual(written, { name: 'pdf' });
  const pdf = (await store.listSkills()).find((s) => s.name === 'pdf')!;
  assert.equal(pdf.origin, 'installed');
  assert.equal(pdf.source, `acme/skills/skills/pdf@${SHA.slice(0, 7)}`);
  assert.equal(await store.readSkillFile('pdf', 'reference/forms.md'), 'forms');

  // A symlink planted in a skill folder can't be used to read outside it
  const outside = path.join(process.env.NANOCLI_HOME!, 'secret.txt');
  writeFileSync(outside, 'secret');
  symlinkSync(outside, path.join(store.skillsDir(), 'pdf', 'leak.md'));
  assert.equal(await store.readSkillFile('pdf', 'leak.md'), null);
  assert.equal(await store.readSkillFile('pdf', '../../secret.txt'), null);

  assert.match(JSON.stringify(await store.writeSkill({ 'SKILL.md': REPO['skills/pdf/SKILL.md'], '../evil': 'x' }, { repo: 'x', installedAt: 1 })), /Unsafe file path/);
  assert.match(JSON.stringify(await store.writeSkill({ 'SKILL.md': REPO['skills/pdf/SKILL.md'], 'bin.dat': 'a\0b' }, { repo: 'x', installedAt: 1 })), /not a text file/);

  await store.setSkillEnabled('systematic-debugging', false);
  assert.equal((await store.listSkills()).find((s) => s.name === 'systematic-debugging')!.enabled, false);
  await store.setSkillEnabled('systematic-debugging', true);
  assert.equal(await store.removeSkill('systematic-debugging'), false, 'built-ins are turned off, not removed');
  assert.equal(await store.removeSkill('pdf'), true);
  assert.equal((await store.listSkills()).some((s) => s.name === 'pdf'), false);
});
