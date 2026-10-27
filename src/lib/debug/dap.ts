/**
 * A Debug Adapter Protocol client: messages framed as `Content-Length: N\r\n\r\n{json}` over a socket, requests
 * matched to responses by sequence number, events passed on.
 */

import net from 'node:net';

export interface DapMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
}

/** Splits a byte stream into DAP messages; feed it chunks, it returns the complete messages so far */
export function createDapReader(): (chunk: Buffer) => DapMessage[] {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const out: DapMessage[] = [];
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
      if (!Number.isFinite(length)) {
        // Not a header: drop it and look for the next one
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      if (buffer.length < headerEnd + 4 + length) break;
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
      buffer = buffer.subarray(headerEnd + 4 + length);
      try {
        out.push(JSON.parse(body) as DapMessage);
      } catch {
        // a malformed message is skipped
      }
    }
    return out;
  };
}

export const encodeDap = (message: Omit<DapMessage, 'seq'> & { seq: number }) => {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
};

export class DapClient {
  private seq = 1;
  private readonly pending = new Map<number, { resolve: (m: DapMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<(m: DapMessage) => void>();

  private readonly socket: net.Socket;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    const read = createDapReader();
    socket.on('data', (chunk) => {
      for (const message of read(chunk)) {
        if (message.type === 'response' && message.request_seq !== undefined) {
          const waiting = this.pending.get(message.request_seq);
          if (!waiting) continue;
          this.pending.delete(message.request_seq);
          clearTimeout(waiting.timer);
          if (message.success === false) waiting.reject(new Error(message.message || `${message.command} failed`));
          else waiting.resolve(message);
        } else if (message.type === 'event') {
          for (const listener of this.listeners) listener(message);
        }
      }
    });
    const fail = () => {
      for (const [, waiting] of this.pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('The debugger disconnected'));
      }
      this.pending.clear();
    };
    socket.on('close', fail);
    socket.on('error', fail);
  }

  /** Connect, retrying while the debugger starts listening */
  static async connect(port: number, { host = '127.0.0.1', timeoutMs = 30_000 } = {}): Promise<DapClient> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect({ host, port }, () => resolve(s));
          s.once('error', reject);
        });
        return new DapClient(socket);
      } catch (error) {
        if (Date.now() > until) throw new Error(`Could not reach the debugger (${(error as Error).message})`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  onEvent(listener: (m: DapMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The next event of this kind */
  waitFor(event: string, timeoutMs = 30_000): Promise<DapMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (off(), reject(new Error(`The debugger did not send "${event}"`))), timeoutMs);
      const off = this.onEvent((m) => {
        if (m.event !== event) return;
        clearTimeout(timer);
        off();
        resolve(m);
      });
    });
  }

  request(command: string, args: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<DapMessage> {
    const seq = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`The debugger did not answer "${command}"`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.socket.write(encodeDap({ seq, type: 'request', command, arguments: args }));
    });
  }

  close(): void {
    this.socket.destroy();
  }
}
