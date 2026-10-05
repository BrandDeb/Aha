/**
 * GitHub OAuth and API utilities
 */

import { randomBytes } from 'crypto';

interface GitHubTokenResponse {
  access_token: string;
  scope: string;
  token_type: string;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  default_branch?: string;
}

interface GitHubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
  html_url: string;
}

interface GitHubFileContent extends GitHubContentItem {
  content?: string;
  encoding?: string;
}

interface GitHubCommitResult {
  content: GitHubContentItem | null;
  commit: { sha: string; html_url: string; message: string };
}

const GITHUB_API_BASE = 'https://api.github.com';

/** GitHub owner/repo names: letters, digits, '-', '_' and '.' */
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Generate a secure random state for OAuth CSRF protection
 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export function isValidRepoName(name: string): boolean {
  return NAME_PATTERN.test(name) && name !== '.' && name !== '..';
}

/**
 * Encode a repository file path for the contents API, keeping '/' separators
 * and rejecting traversal segments.
 */
export function encodeRepoPath(filePath: string): string {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid path');
  }
  return segments.map(encodeURIComponent).join('/');
}

function contentsEndpoint(owner: string, repo: string, filePath: string): string {
  if (!isValidRepoName(owner) || !isValidRepoName(repo)) {
    throw new Error('Invalid repository');
  }
  return `/repos/${owner}/${repo}/contents/${encodeRepoPath(filePath)}`;
}

/**
 * Error raised for non-2xx GitHub API responses
 */
export class GitHubApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GitHubApiError';
  }
}

/**
 * Exchange OAuth code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_REDIRECT_URI || 
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/github/callback`,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to exchange code: ${response.status}`);
  }
  
  // GitHub returns 200 with an error payload for bad/expired codes
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'No access token returned');
  }
  return data as GitHubTokenResponse;
}

/**
 * Get authenticated GitHub client
 */
export function getGitHubClient(token: string) {
  return {
    request: async <T = unknown>(method: string, endpoint: string, data?: unknown): Promise<T> => {
      const url = `${GITHUB_API_BASE}${endpoint}`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (data !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      
      const response = await fetch(url, {
        method,
        headers,
        body: data !== undefined ? JSON.stringify(data) : undefined,
        cache: 'no-store',
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new GitHubApiError(response.status, `GitHub API error: ${response.status} - ${error}`);
      }
      
      return response.json() as Promise<T>;
    },
  };
}

/**
 * Get GitHub user information
 */
export async function getGitHubUser(token: string): Promise<GitHubUser> {
  const client = getGitHubClient(token);
  return client.request<GitHubUser>('GET', '/user');
}

/**
 * List repositories the authenticated user can access
 */
export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const client = getGitHubClient(token);
  const repos = await client.request<GitHubRepo[]>('GET', '/user/repos?per_page=100&sort=updated');
  return repos.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    private: repo.private,
    description: repo.description,
    html_url: repo.html_url,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
    updated_at: repo.updated_at,
    default_branch: repo.default_branch,
  }));
}

/**
 * Get repository contents
 */
export async function getRepoContents(
  token: string,
  owner: string,
  repo: string,
  filePath: string = ''
): Promise<GitHubContentItem[]> {
  const client = getGitHubClient(token);
  const response = await client.request<GitHubContentItem | GitHubContentItem[]>(
    'GET',
    contentsEndpoint(owner, repo, filePath)
  );
  const items = Array.isArray(response) ? response : [response];
  return items.map(({ name, path, sha, size, type, download_url, html_url }) => ({
    name, path, sha, size, type, download_url, html_url,
  }));
}

/**
 * Get repository file content and its blob sha (needed to update it)
 */
export async function getRepoFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string
): Promise<{ content: string; sha: string }> {
  const client = getGitHubClient(token);
  const file = await client.request<GitHubFileContent>('GET', contentsEndpoint(owner, repo, filePath));
  
  if (file.type === 'file') {
    const content = file.encoding === 'base64' && file.content
      ? Buffer.from(file.content, 'base64').toString('utf8')
      : file.content || '';
    return { content, sha: file.sha };
  }
  
  throw new Error('Path is not a file');
}

/**
 * Create or update a repository file
 */
export async function updateRepoFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
  sha?: string
): Promise<GitHubCommitResult> {
  const client = getGitHubClient(token);
  
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64'),
  };
  // sha is required when updating and must be omitted when creating
  if (sha) {
    body.sha = sha;
  }
  
  return client.request<GitHubCommitResult>('PUT', contentsEndpoint(owner, repo, filePath), body);
}

export type { GitHubTokenResponse, GitHubUser, GitHubRepo, GitHubContentItem, GitHubCommitResult };

// ---------------------------------------------------------------------------
// Git Data API: branches, whole-tree pulls and multi-file commits
// ---------------------------------------------------------------------------

interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

/** Text files pulled from a repository, keyed by path */
interface PulledTree {
  ref: string;
  /** Commit sha the files were read at (used to detect conflicting pushes) */
  sha: string;
  files: Record<string, string>;
  /** Paths left out because they were binary, too large or over the file limit */
  skipped: string[];
}

interface MultiFileCommitResult {
  sha: string;
  html_url: string;
}

export const MAX_PULL_FILES = 150;
const MAX_PULL_FILE_SIZE = 256 * 1024;

/** Git branch names we accept from clients */
export function isValidBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]{1,100}$/.test(name) &&
    !name.includes('..') && !name.startsWith('/') && !name.startsWith('-') &&
    !name.endsWith('/') && !name.endsWith('.lock') && !name.includes('//');
}

function repoBase(owner: string, repo: string): string {
  if (!isValidRepoName(owner) || !isValidRepoName(repo)) {
    throw new Error('Invalid repository');
  }
  return `/repos/${owner}/${repo}`;
}

function encodeRef(ref: string): string {
  if (!isValidBranchName(ref)) throw new Error('Invalid branch');
  return ref.split('/').map(encodeURIComponent).join('/');
}

export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const info = await getGitHubClient(token).request<{ default_branch: string }>('GET', repoBase(owner, repo));
  return info.default_branch;
}

export async function listBranches(token: string, owner: string, repo: string): Promise<GitHubBranch[]> {
  const branches = await getGitHubClient(token).request<{ name: string; commit: { sha: string }; protected: boolean }[]>(
    'GET',
    `${repoBase(owner, repo)}/branches?per_page=100`
  );
  return branches.map(b => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
}

async function getBranchHead(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const ref = await getGitHubClient(token).request<{ object: { sha: string } }>(
    'GET',
    `${repoBase(owner, repo)}/git/ref/heads/${encodeRef(branch)}`
  );
  return ref.object.sha;
}

export async function createBranch(token: string, owner: string, repo: string, name: string, from: string): Promise<GitHubBranch> {
  if (!isValidBranchName(name)) throw new Error('Invalid branch');
  const sha = await getBranchHead(token, owner, repo, from);
  await getGitHubClient(token).request('POST', `${repoBase(owner, repo)}/git/refs`, {
    ref: `refs/heads/${name}`,
    sha,
  });
  return { name, sha, protected: false };
}

/**
 * Read every text file of a branch (up to MAX_PULL_FILES files of 256 KB).
 */
export async function pullTree(token: string, owner: string, repo: string, branch: string): Promise<PulledTree> {
  const client = getGitHubClient(token);
  const base = repoBase(owner, repo);
  const sha = await getBranchHead(token, owner, repo, branch);
  const commit = await client.request<{ tree: { sha: string } }>('GET', `${base}/git/commits/${sha}`);
  const tree = await client.request<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(
    'GET',
    `${base}/git/trees/${commit.tree.sha}?recursive=1`
  );

  const skipped: string[] = [];
  const blobs = tree.tree.filter(entry => {
    if (entry.type !== 'blob') return false;
    if ((entry.size ?? 0) > MAX_PULL_FILE_SIZE) {
      skipped.push(entry.path);
      return false;
    }
    return true;
  });
  for (const extra of blobs.splice(MAX_PULL_FILES)) skipped.push(extra.path);

  const files: Record<string, string> = {};
  const queue = [...blobs];
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const blob = await client.request<{ content: string; encoding: string }>('GET', `${base}/git/blobs/${entry.sha}`);
      const bytes = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8');
      if (bytes.includes(0)) {
        skipped.push(entry.path);
        continue;
      }
      files[entry.path] = bytes.toString('utf8');
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  return { ref: branch, sha, files, skipped: skipped.sort() };
}

/**
 * Commit several file changes at once. `changes` maps path -> new content,
 * or null to delete. When `expectedHead` is given and the branch has moved
 * since, the commit is refused with a 409 so nobody's push is overwritten.
 */
export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  changes: Record<string, string | null>,
  expectedHead?: string
): Promise<MultiFileCommitResult> {
  const client = getGitHubClient(token);
  const base = repoBase(owner, repo);
  const head = await getBranchHead(token, owner, repo, branch);
  if (expectedHead && expectedHead !== head) {
    throw new GitHubApiError(409, 'Branch has new commits since your last pull');
  }
  const parent = await client.request<{ tree: { sha: string } }>('GET', `${base}/git/commits/${head}`);

  const tree = await client.request<{ sha: string }>('POST', `${base}/git/trees`, {
    base_tree: parent.tree.sha,
    tree: Object.entries(changes).map(([filePath, content]) => {
      encodeRepoPath(filePath); // rejects traversal segments
      return content === null
        ? { path: filePath, mode: '100644', type: 'blob', sha: null }
        : { path: filePath, mode: '100644', type: 'blob', content };
    }),
  });
  const commit = await client.request<{ sha: string; html_url: string }>('POST', `${base}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [head],
  });
  await client.request('PATCH', `${base}/git/refs/heads/${encodeRef(branch)}`, { sha: commit.sha });
  return { sha: commit.sha, html_url: commit.html_url };
}

/**
 * Create a secret gist from project files. Gist file names cannot contain
 * '/', so nested paths are flattened with '__'.
 */
export async function createGist(
  token: string,
  description: string,
  files: Record<string, string>
): Promise<{ id: string; html_url: string }> {
  const gistFiles: Record<string, { content: string }> = {};
  for (const [filePath, content] of Object.entries(files)) {
    if (content.trim()) gistFiles[filePath.replace(/\//g, '__')] = { content };
  }
  return getGitHubClient(token).request<{ id: string; html_url: string }>('POST', '/gists', {
    description,
    public: false,
    files: gistFiles,
  });
}

export type { GitHubBranch, PulledTree, MultiFileCommitResult };
