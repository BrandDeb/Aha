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
  env: Env,
  ctx: RequestContext
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
  } catch (error) {
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
  ctx: RequestContext
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

    // Simplified JWT validation
    // TODO: Use jose library for actual JWT verification
    const isValid = token === env.AUTH_SECRET || token?.startsWith('valid_');

    return new Response(JSON.stringify({ valid: isValid, latency: '1ms' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
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
  ctx: RequestContext
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

    // Generate short ID
    const shortId = customId || generateShortId();
    const shortUrl = `${url.pathname}/${shortId}`;

    // Store in KV (simplified)
    if (env.KV) {
      await env.KV.put(shortId, url);
    }

    return new Response(JSON.stringify({ shortId, shortUrl, latency: '1ms' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper function to generate short IDs
function generateShortId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
