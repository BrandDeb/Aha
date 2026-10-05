/**
 * Main-thread wrapper around wasi.worker.ts.
 */
import type { RunMessage, RunRequest } from './wasi.worker';

export interface RunHandle {
  /** Resolves when the program exits (or fails to start) */
  done: Promise<Extract<RunMessage, { type: 'exit' | 'error' }>>;
  /** Kill the program (Ctrl+C) */
  stop: () => void;
}

export function runWasm(request: RunRequest, onOutput: (stream: 'stdout' | 'stderr', line: string) => void): RunHandle {
  const worker = new Worker(new URL('./wasi.worker.ts', import.meta.url), { type: 'module' });
  let settle: (message: Extract<RunMessage, { type: 'exit' | 'error' }>) => void = () => {};
  const done = new Promise<Extract<RunMessage, { type: 'exit' | 'error' }>>((resolve) => {
    settle = resolve;
  });

  worker.onmessage = (event: MessageEvent<RunMessage>) => {
    const message = event.data;
    if (message.type === 'stdout' || message.type === 'stderr') {
      onOutput(message.type, message.line);
    } else {
      worker.terminate();
      settle(message);
    }
  };
  worker.onerror = (event) => {
    worker.terminate();
    settle({ type: 'error', message: event.message || 'The program crashed' });
  };
  worker.postMessage(request, [request.wasm]);

  return {
    done,
    stop: () => {
      worker.terminate();
      settle({ type: 'error', message: 'Stopped' });
    },
  };
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
