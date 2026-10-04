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
