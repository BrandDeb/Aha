import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
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
