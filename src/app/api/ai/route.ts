import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { AI_MODEL, SYSTEM_PROMPT, buildMessages, parseAiRequest } from '@/lib/ai';
import { isSameOrigin } from '@/lib/github-session';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

/** Each request spends the operator's API credits; cap it per client */
const limiter = createRateLimiter(Number(process.env.AI_REQUESTS_PER_10_MIN) || 30, 10 * 60 * 1000);

/**
 * Whether this server has its own model configured. Users without it bring
 * their own key, which the browser sends straight to the provider.
 */
export function GET() {
  return NextResponse.json({ configured: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
}

/**
 * Hosted assistant (the operator's Anthropic key). Streams the answer back as plain text.
 * POST { action, prompt, history, files, activeFile, selection?, diagnostics }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json(
      { error: 'This studio has no hosted model. Choose a free provider or add your own key in the assistant settings.' },
      { status: 503 }
    );
  }

  const wait = limiter.check(clientKey(request.headers));
  if (wait) {
    return NextResponse.json(
      { error: `Too many assistant requests. Try again in ${Math.ceil(wait / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(wait) } }
    );
  }

  const parsed = parseAiRequest(await request.json().catch(() => null));
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.beta.messages.stream({
          model: AI_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: buildMessages(parsed),
        });
        request.signal.addEventListener('abort', () => stream.abort());

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal') {
          controller.enqueue(encoder.encode('\n\nThe assistant declined this request. Rephrase it or ask about a different part of the code.'));
        } else if (message.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n(The answer was cut off — ask the assistant to continue.)'));
        }
      } catch (error) {
        let message = 'The assistant is unavailable right now. Try again in a moment.';
        if (error instanceof Anthropic.AuthenticationError) {
          message = 'The AI assistant credentials on this server are invalid.';
        } else if (error instanceof Anthropic.RateLimitError) {
          message = 'The assistant is rate limited. Try again in a minute.';
        } else if (error instanceof Anthropic.APIUserAbortError) {
          message = '';
        } else {
          console.error('AI assistant error:', error);
        }
        if (message) controller.enqueue(encoder.encode(`\n\n${message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
