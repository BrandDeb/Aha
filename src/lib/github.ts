/**
 * GitHub OAuth and API utilities
 */

import { randomUUID } from 'crypto';

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
}

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Generate a secure random state for OAuth CSRF protection
 */
export function generateState(): string {
  return randomUUID();
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
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${response.status} - ${error}`);
  }
  
  return response.json();
}

/**
 * Get authenticated GitHub client
 */
export function getGitHubClient(token: string) {
  return {
    request: async (method: string, endpoint: string, data?: any) => {
      const url = `${GITHUB_API_BASE}${endpoint}`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} - ${error}`);
      }
      
      return response.json();
    },
  };
}

/**
 * Get GitHub user information
 */
export async function getGitHubUser(token: string): Promise<GitHubUser> {
  const client = getGitHubClient(token);
  const response = await client.request('GET /user');
  return response.data;
}

/**
 * Get repository contents
 */
export async function getRepoContents(
  token: string,
  owner: string,
  repo: string,
  path: string = ''
): Promise<any[]> {
  const client = getGitHubClient(token);
  const response = await client.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
  });
  return response.data;
}

/**
 * Get repository file content
 */
export async function getRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const client = getGitHubClient(token);
  const response = await client.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
  });
  
  if (response.data.type === 'file') {
    if (response.data.encoding === 'base64') {
      return Buffer.from(response.data.content, 'base64').toString('utf8');
    }
    return response.data.content || '';
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
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<any> {
  const client = getGitHubClient(token);
  
  const base64Content = Buffer.from(content).toString('base64');
  
  const response = await client.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
    message,
    content: base64Content,
    ...(sha && { sha }),
  });
  
  return response.data;
}

export type { GitHubTokenResponse, GitHubUser, GitHubRepo };
