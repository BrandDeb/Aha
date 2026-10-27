import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost, listensOnLoopbackOnly } from '@/lib/host';
import { browse, closeFolder, makeDir, movePath, openFolder, reloadFolder, removePath, watchFolder, writeFile, type FolderChange } from '@/lib/folder';
import { readJsonOrNull } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Folders on this machine: only when the studio is the user's own (and server.js has checked the launch key) */
const enabled = () => listensOnLoopbackOnly() || process.env.AHA_RUN === '1';

/** `aha` sends the launch key as a header and no Origin; a page on another site can't set that header */
function fromKeyHolder(request: NextRequest): boolean {
  const given = request.headers.get('x-aha-key') ?? '';
  const key = process.env.AHA_LAUNCH_KEY ?? '';
  return !!key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

function refuse(request: NextRequest, write: boolean): NextResponse | null {
  if (!enabled()) return NextResponse.json({ error: 'Opening folders only works when the studio runs on your own machine.' }, { status: 503 });
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) return NextResponse.json({ error: 'Not available for this host name.' }, { status: 403 });
  if (write && !isSameOrigin(request) && !fromKeyHolder(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  return null;
}

function failure(error: unknown): NextResponse {
  const status = (error as { status?: number }).status ?? 500;
  if (status === 500) console.error('Folder request failed:', error);
  return NextResponse.json({ error: error instanceof Error ? error.message : 'The folder request failed' }, { status });
}

/**
 * GET ?watch=<id>   → a stream (Server-Sent Events) of changes other programs make: { changed, removed }
 * GET               → whether folders can be opened here
 */
export async function GET(request: NextRequest) {
  const refused = refuse(request, false);
  if (refused) return request.nextUrl.searchParams.has('watch') ? refused : NextResponse.json({ enabled: false });
  const id = request.nextUrl.searchParams.get('watch');
  if (id === null) return NextResponse.json({ enabled: true });

  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      const send = (event: string, data: unknown) => {
        try {
          stream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      let unwatch: () => void;
      try {
        unwatch = watchFolder(id, (change: FolderChange) => send('change', change), () => {
          send('closed', {});
          stop();
        });
      } catch (error) {
        send('closed', { error: error instanceof Error ? error.message : 'closed' });
        stream.close();
        return;
      }
      // Proxies and browsers drop silent streams; a comment every 25 s keeps it open
      const ping = setInterval(() => {
        try {
          stream.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stop();
        }
      }, 25_000);
      stop = () => {
        clearInterval(ping);
        unwatch();
        try {
          stream.close();
        } catch {
          // already closed
        }
      };
      send('ready', {});
      request.signal.addEventListener('abort', () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

/**
 * { action: 'open', path }                → { id, root, name, files, skipped, git }
 * { action: 'reload', id }                → the same, for a folder already open
 * { action: 'write', id, path, content }  → saved in place
 * { action: 'delete', id, path }          → a file or a folder
 * { action: 'move', id, from, to }       → a file or a folder, with everything in it
 * { action: 'mkdir', id, path }
 * { action: 'close', id }
 * { action: 'browse', path? }             → { path, parent, dirs, project }, for the folder picker
 */
export async function POST(request: NextRequest) {
  const refused = refuse(request, true);
  if (refused) return refused;
  const body = (await readJsonOrNull(request, 8 * 1024 * 1024)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  try {
    switch (body.action) {
      case 'open':
        return NextResponse.json(await openFolder(body.path));
      case 'reload':
        return NextResponse.json(await reloadFolder(body.id));
      case 'write':
        await writeFile(body.id, body.path, body.content);
        return NextResponse.json({ ok: true });
      case 'delete':
        await removePath(body.id, body.path);
        return NextResponse.json({ ok: true });
      case 'move':
        await movePath(body.id, body.from, body.to);
        return NextResponse.json({ ok: true });
      case 'mkdir':
        await makeDir(body.id, body.path);
        return NextResponse.json({ ok: true });
      case 'close':
        return NextResponse.json({ closed: typeof body.id === 'string' && closeFolder(body.id) });
      case 'browse':
        return NextResponse.json(await browse(body.path));
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return failure(error);
  }
}
