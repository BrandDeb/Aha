/**
 * Browser-side client for the scriptc compile API.
 * Safe to import from client components (no Node.js modules).
 */

import type { CompilePlatform, CompileTarget } from '@/types';

interface CompileOptions {
  code?: string;
  filename?: string;
  /** Multi-file project (path -> source) with the file to build */
  files?: Record<string, string>;
  entry?: string;
  target?: CompileTarget;
  platform?: CompilePlatform;
  arch?: 'x64' | 'arm64';
  optimization?: 'release' | 'dev';
}

/** A scriptc diagnostic, located in the submitted source */
interface Diagnostic {
  file?: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  hint?: string;
}

interface CompileResult {
  success: boolean;
  output?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
  filename?: string;
  downloadUrl?: string;
  size?: number;
  durationMs?: number;
  diagnostics?: Diagnostic[];
  phases?: { name: 'queue' | 'write' | 'compile' | 'package'; ms: number }[];
}

interface CoverageResult {
  success: boolean;
  error?: string;
  statements?: number;
  static?: number;
  percent?: number;
  blockers?: { count: number; message: string; code: string }[];
}

async function postJson<T extends { success: boolean; error?: string }>(url: string, body: unknown): Promise<T> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.success === undefined) {
      return { success: false, error: data.error || `Request failed (${response.status})` } as T;
    }
    return data as T;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    } as T;
  }
}

/**
 * Compile TypeScript with scriptc on the server
 */
export function compileTypeScriptBrowser(options: CompileOptions): Promise<CompileResult> {
  return postJson<CompileResult>('/api/compile', options);
}

/**
 * Ask scriptc how much of the program compiles statically
 */
export function analyzeCoverageBrowser(code: string, filename?: string): Promise<CoverageResult>;
export function analyzeCoverageBrowser(project: { files: Record<string, string>; entry: string }): Promise<CoverageResult>;
export function analyzeCoverageBrowser(
  input: string | { files: Record<string, string>; entry: string },
  filename?: string
): Promise<CoverageResult> {
  return postJson<CoverageResult>('/api/coverage', typeof input === 'string' ? { code: input, filename } : input);
}

/**
 * Human-readable byte size
 */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

export type { CompileOptions, CompileResult, CoverageResult, Diagnostic };
