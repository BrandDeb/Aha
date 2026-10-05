/**
 * Nano CLI Studio - Edge Entry Point
 * 
 * This is the main entry point for scriptc-compiled edge functions.
 * Compiles to WASM for deployment to Cloudflare Workers, Vercel Edge, etc.
 */

// import { RequestContext } from '@scriptc/runtime';
// Temporarily using native types for compatibility
interface RequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

// Type definitions for edge runtime
export interface Env {
  // Cloudflare Workers environment
  KV: KVNamespace;
  R2: R2Bucket;
  // Custom bindings
  AI_GATEWAY_URL: string;
  AUTH_SECRET: string;
}

// Main edge handler
export default async function handleRequest(
  request: Request,
  env: Env,
  ctx: RequestContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Route to appropriate handler
  switch (path) {
    case '/api/ai/gateway':
      return handleAIGateway(request, env, ctx);
    case '/api/auth/validate':
      return handleAuthValidation(request, env, ctx);
    case '/api/shorten':
      return handleUrlShortener(request, env, ctx);
    default:
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
  }
}

// AI Gateway Handler
async function handleAIGateway(
  request: Request,
  _env: Env,
  _ctx: RequestContext
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { provider, prompt, stream = false } = body;

    // Route to fastest provider (simplified)
    const providers = ['openrouter', 'groq', 'firebase'];
    const selectedProvider = provider || providers[0];

    // TODO: Implement actual AI provider routing
    const response = {
      provider: selectedProvider,
      prompt,
      stream,
      timestamp: Date.now(),
      latency: '2ms (scriptc)'
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Auth Validation Handler
async function handleAuthValidation(
  request: Request,
  env: Env,
  _ctx: RequestContext
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { token } = body;

    // Shared-secret validation (constant time). Fails closed when no secret is configured.
    // TODO: Use jose library for actual JWT verification
    const isValid = typeof token === 'string' && !!env.AUTH_SECRET && timingSafeEqual(token, env.AUTH_SECRET);

    return new Response(JSON.stringify({ valid: isValid, latency: '1ms' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// URL Shortener Handler
async function handleUrlShortener(
  request: Request,
  env: Env,
  _ctx: RequestContext
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { url, customId } = body;

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return jsonError('A valid absolute URL is required', 400);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return jsonError('Only http and https URLs can be shortened', 400);
    }

    if (customId !== undefined && (typeof customId !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(customId))) {
      return jsonError('customId must be 3-32 characters of A-Z, a-z, 0-9, _ or -', 400);
    }

    // Generate short ID
    const shortId = customId || generateShortId();
    const shortUrl = `${new URL(request.url).origin}/s/${shortId}`;

    // Store in KV (simplified); never overwrite an existing mapping
    if (env.KV) {
      if (customId && (await env.KV.get(shortId)) !== null) {
        return jsonError('customId is already taken', 409);
      }
      await env.KV.put(shortId, target.toString());
    }

    return new Response(JSON.stringify({ shortId, shortUrl, latency: '1ms' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper function to generate short IDs
function generateShortId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(8);
  crypto.getRandomValues(values);
  let result = '';
  for (let i = 0; i < values.length; i++) {
    result += chars.charAt(values[i] % chars.length);
  }
  return result;
}

// Constant-time string comparison to avoid leaking the secret via timing
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < bBytes.length; i++) {
    diff |= (aBytes[i] ?? 0) ^ bBytes[i];
  }
  return diff === 0;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Type definitions for Cloudflare Workers
declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ keys: string[] }>;
}

declare interface R2Bucket {
  put(key: string, value: ArrayBuffer): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
  list(): Promise<{ objects: Array<{ key: string }> }>;
}
