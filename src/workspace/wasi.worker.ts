/// <reference lib="webworker" />
/**
 * Runs a scriptc-compiled WASI module off the main thread.
 *
 * The project's files are mounted as the program's working directory, stdout
 * and stderr stream back line by line, and files the program creates or
 * changes are sent back when it exits so the editor can pick them up.
 */
import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, type Inode } from '@bjorn3/browser_wasi_shim';

export interface RunRequest {
  wasm: ArrayBuffer;
  args: string[];
  env: string[];
  files: Record<string, string>;
}

export type RunMessage =
  | { type: 'stdout'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number; ms: number; memoryBytes: number; changed: Record<string, string> }
  | { type: 'error'; message: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Line-buffered output that can flush a final unterminated line */
function lineWriter(emit: (line: string) => void) {
  const textDecoder = new TextDecoder();
  let pending = '';
  return {
    fd: new ConsoleStdout((chunk) => {
      pending += textDecoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(emit);
    }),
    flush() {
      if (pending) emit(pending);
      pending = '';
    },
  };
}

function mount(files: Record<string, string>): Map<string, Inode> {
  const root = new Map<string, Inode>();
  for (const [filePath, content] of Object.entries(files)) {
    const parts = filePath.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.get(part);
      if (!(next instanceof Directory)) {
        next = new Directory(new Map());
        dir.set(part, next);
      }
      dir = (next as Directory).contents;
    }
    dir.set(parts[parts.length - 1], new File(encoder.encode(content)));
  }
  return root;
}

function collect(dir: Map<string, Inode>, prefix: string, out: Record<string, string>) {
  for (const [name, node] of dir) {
    const filePath = prefix ? `${prefix}/${name}` : name;
    if (node instanceof Directory) collect(node.contents, filePath, out);
    else if (node instanceof File) out[filePath] = decoder.decode(node.data);
  }
}

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  const post = (message: RunMessage) => (self as unknown as Worker).postMessage(message);
  const { wasm, args, env, files } = event.data;
  try {
    const contents = mount(files);
    const stdout = lineWriter((line) => post({ type: 'stdout', line }));
    const stderr = lineWriter((line) => post({ type: 'stderr', line }));
    const fds = [
      new OpenFile(new File([])),
      stdout.fd,
      stderr.fd,
      new PreopenDirectory('.', contents),
    ];
    const wasi = new WASI(args, env, fds, { debug: false });
    const started = performance.now();
    const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.wasiImport });
    const code = wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
    const ms = performance.now() - started;
    const memory = instance.exports.memory as WebAssembly.Memory | undefined;

    stdout.flush();
    stderr.flush();

    const after: Record<string, string> = {};
    collect(contents, '', after);
    const changed: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(after)) {
      if (files[filePath] !== content) changed[filePath] = content;
    }
    post({ type: 'exit', code, ms, memoryBytes: memory?.buffer.byteLength ?? 0, changed });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
