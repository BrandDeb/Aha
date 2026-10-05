import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitFiles,
  isValidBranchName,
  pullTree,
  encodeRepoPath,
  getGitHubUser,
  getRepoFile,
  isValidRepoName,
  updateRepoFile,
  GitHubApiError,
} from '../src/lib/github.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init?: RequestInit };

function mockFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

test('encodeRepoPath keeps separators and encodes segments', () => {
  assert.equal(encodeRepoPath('src/my file.ts'), 'src/my%20file.ts');
  assert.equal(encodeRepoPath(''), '');
  assert.throws(() => encodeRepoPath('src/../../secrets'), /Invalid path/);
});

test('isValidRepoName rejects path injection', () => {
  assert.ok(isValidRepoName('Aha'));
  assert.ok(isValidRepoName('my.repo-name_1'));
  for (const bad of ['..', '.', 'a/b', 'a?x=1', '', 'a b']) {
    assert.equal(isValidRepoName(bad), false, bad);
  }
});

test('getGitHubUser returns the API response body', async () => {
  const calls = mockFetch({ id: 1, login: 'octocat', avatar_url: 'https://x' });
  const user = await getGitHubUser('token');
  assert.equal(user.login, 'octocat');
  assert.equal(calls[0].url, 'https://api.github.com/user');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token');
});

test('getRepoFile decodes base64 content and returns sha', async () => {
  mockFetch({ type: 'file', encoding: 'base64', content: Buffer.from('hello').toString('base64'), sha: 'abc' });
  assert.deepEqual(await getRepoFile('t', 'o', 'r', 'src/a.ts'), { content: 'hello', sha: 'abc' });
});

test('updateRepoFile omits sha when creating and sends it when updating', async () => {
  let calls = mockFetch({ content: { sha: 'new' }, commit: { sha: 'c1', html_url: '', message: 'm' } });
  await updateRepoFile('t', 'owner', 'repo', 'dir/new.ts', 'code', 'msg');
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/contents/dir/new.ts');
  const created = JSON.parse(String(calls[0].init?.body));
  assert.equal('sha' in created, false);
  assert.equal(Buffer.from(created.content, 'base64').toString(), 'code');

  calls = mockFetch({ content: { sha: 'new' }, commit: { sha: 'c2', html_url: '', message: 'm' } });
  await updateRepoFile('t', 'owner', 'repo', 'a.ts', 'code', 'msg', 'oldsha');
  assert.equal(JSON.parse(String(calls[0].init?.body)).sha, 'oldsha');
});

test('API errors surface as GitHubApiError with status', async () => {
  mockFetch({ message: 'Not Found' }, 404);
  await assert.rejects(getGitHubUser('t'), (err: unknown) => err instanceof GitHubApiError && err.status === 404);
});

test('invalid owner/repo never reaches the network', async () => {
  const calls = mockFetch({});
  await assert.rejects(getRepoFile('t', '..', 'r', 'a.ts'), /Invalid repository/);
  assert.equal(calls.length, 0);
});

function mockRoutes(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('https://api.github.com', '')}`;
    calls.push({ url: key, init });
    const match = Object.keys(routes).find((route) => key.startsWith(route));
    if (!match) return new Response('not mocked: ' + key, { status: 500 });
    return new Response(JSON.stringify(routes[match]), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test('isValidBranchName follows git ref rules', () => {
  for (const ok of ['main', 'feature/login', 'release-1.2', 'fix_bug']) assert.ok(isValidBranchName(ok), ok);
  for (const bad of ['', '../x', '/main', '-x', 'a..b', 'a//b', 'x.lock', 'trailing/', 'sp ace', 'a~b']) {
    assert.equal(isValidBranchName(bad), false, bad);
  }
});

test('commitFiles creates a tree, a commit and moves the branch', async () => {
  const calls = mockRoutes({
    'GET /repos/o/r/git/ref/heads/main': { object: { sha: 'head1' } },
    'GET /repos/o/r/git/commits/head1': { tree: { sha: 'tree1' } },
    'POST /repos/o/r/git/trees': { sha: 'tree2' },
    'POST /repos/o/r/git/commits': { sha: 'commit2', html_url: 'https://github.com/o/r/commit/commit2' },
    'PATCH /repos/o/r/git/refs/heads/main': { object: { sha: 'commit2' } },
  });
  const result = await commitFiles('t', 'o', 'r', 'main', 'msg', { 'src/a.ts': 'new', 'old.ts': null }, 'head1');
  assert.equal(result.sha, 'commit2');
  const tree = JSON.parse(String(calls.find((c) => c.url === 'POST /repos/o/r/git/trees')?.init?.body));
  assert.equal(tree.base_tree, 'tree1');
  assert.deepEqual(tree.tree, [
    { path: 'src/a.ts', mode: '100644', type: 'blob', content: 'new' },
    { path: 'old.ts', mode: '100644', type: 'blob', sha: null },
  ]);
  const commit = JSON.parse(String(calls.find((c) => c.url === 'POST /repos/o/r/git/commits')?.init?.body));
  assert.deepEqual(commit.parents, ['head1']);
});

test('commitFiles refuses to overwrite a branch that moved', async () => {
  mockRoutes({ 'GET /repos/o/r/git/ref/heads/main': { object: { sha: 'someone-else' } } });
  await assert.rejects(
    commitFiles('t', 'o', 'r', 'main', 'msg', { 'a.ts': 'x' }, 'head1'),
    (err: unknown) => err instanceof GitHubApiError && err.status === 409
  );
});

test('pullTree reads text blobs and skips binary and oversized files', async () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  mockRoutes({
    'GET /repos/o/r/git/ref/heads/main': { object: { sha: 'c1' } },
    'GET /repos/o/r/git/commits/c1': { tree: { sha: 't1' } },
    'GET /repos/o/r/git/trees/t1': {
      truncated: false,
      tree: [
        { path: 'src', type: 'tree', sha: 'd' },
        { path: 'src/main.ts', type: 'blob', sha: 'b1', size: 10 },
        { path: 'logo.png', type: 'blob', sha: 'b2', size: 10 },
        { path: 'huge.json', type: 'blob', sha: 'b3', size: 10_000_000 },
      ],
    },
    'GET /repos/o/r/git/blobs/b1': { content: b64('console.log(1)'), encoding: 'base64' },
    'GET /repos/o/r/git/blobs/b2': { content: Buffer.from([0x89, 0x50, 0x00, 0x01]).toString('base64'), encoding: 'base64' },
  });
  const pulled = await pullTree('t', 'o', 'r', 'main');
  assert.equal(pulled.sha, 'c1');
  assert.deepEqual(pulled.files, { 'src/main.ts': 'console.log(1)' });
  assert.deepEqual(pulled.skipped, ['huge.json', 'logo.png']);
});
