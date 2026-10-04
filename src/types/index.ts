/**
 * Nano CLI Studio - Type Definitions
 * 
 * Central type definitions for the scriptc-powered edge app
 */

// AI Gateway Types
export interface AIRequest {
  provider?: 'openrouter' | 'groq' | 'firebase' | 'anthropic' | 'mistral';
  prompt: string;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface AIResponse {
  provider: string;
  prompt: string;
  completion: string;
  stream: boolean;
  timestamp: number;
  latency: string;
  model?: string;
  tokensUsed?: number;
}

// Auth Types
export interface AuthRequest {
  token: string;
  type?: 'jwt' | 'api_key' | 'oauth';
}

export interface AuthResponse {
  valid: boolean;
  latency: string;
  userId?: string;
  expiresAt?: number;
  scopes?: string[];
}

// URL Shortener Types
export interface ShortenRequest {
  url: string;
  customId?: string;
  expiresAt?: number;
}

export interface ShortenResponse {
  shortId: string;
  shortUrl: string;
  originalUrl: string;
  latency: string;
  expiresAt?: number;
  clicks?: number;
}

// Edge Environment Types
export interface EdgeEnv {
  KV: KVNamespace;
  R2: R2Bucket;
  AI_GATEWAY_URL: string;
  AUTH_SECRET: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
}

// KV and R2 type definitions
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { limit?: number; prefix?: string }): Promise<{ keys: string[]; list_complete: boolean }>;
}

export interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream | string): Promise<{ key: string; version: string }>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2Object[]; delimitedPrefixes: string[] }>;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploadDate: Date;
}

// Provider Types
export interface AIProviderConfig {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: string[];
  latencySLA: number; // in ms
  costPerToken: number;
}

export interface ProviderLatency {
  provider: string;
  latency: number;
  timestamp: number;
}

// Analytics Types
export interface AnalyticsEvent {
  type: 'ai_request' | 'auth_check' | 'url_click' | 'error';
  timestamp: number;
  metadata: Record<string, unknown>;
  userId?: string;
}

export interface AnalyticsSummary {
  totalRequests: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  requestsByProvider: Record<string, number>;
  errorRate: number;
}

// Studio Types
export type CompileTarget = 'exe' | 'c' | 'llvm' | 'wasm';
export type CompilePlatform = 'linux' | 'macos' | 'windows';

export interface GitHubUserInfo {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
}

export interface GitHubRepoInfo {
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

export interface GitHubRepoItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
  html_url: string;
}

export interface CollaboratorInfo {
  id: string | undefined;
  name: string;
  color: string;
}
