/**
 * Minimal Node.js declarations for the editor's TypeScript service, covering
 * the runtime surface scriptc programs typically use. The editor runs without
 * DOM types, so globals like `name` don't collide with `window.name`.
 */
export const NODE_TYPES = `
declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  exitCode: number | undefined;
  cwd(): string;
  platform: string;
  arch: string;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  stdin: { on(event: 'data', listener: (chunk: string) => void): void; on(event: 'end', listener: () => void): void };
};
declare var console: {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  info(...data: unknown[]): void;
  table(data: unknown): void;
  time(label?: string): void;
  timeEnd(label?: string): void;
};
declare var performance: { now(): number };
declare function setTimeout(handler: (...args: unknown[]) => void, timeout?: number): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: unknown[]) => void, timeout?: number): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}
declare function fetch(input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
declare class TextEncoder { encode(input?: string): Uint8Array }
declare class TextDecoder { decode(input?: Uint8Array): string }
declare class URL {
  constructor(url: string, base?: string);
  href: string; protocol: string; host: string; hostname: string; port: string;
  pathname: string; search: string; hash: string; origin: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}
declare class URLSearchParams {
  constructor(init?: string | Record<string, string>);
  get(name: string): string | null; set(name: string, value: string): void;
  has(name: string): boolean; toString(): string;
}
declare class Buffer extends Uint8Array {
  static from(data: string | ArrayLike<number>, encoding?: string): Buffer;
  static byteLength(data: string, encoding?: string): number;
  toString(encoding?: string): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string;
  export function readFileSync(path: string): Buffer;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function appendFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean; mtimeMs: number };
  export function unlinkSync(path: string): void;
}
declare module 'fs' { export * from 'node:fs'; }
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export const sep: string;
}
declare module 'path' { export * from 'node:path'; }
declare module 'node:http' {
  interface IncomingMessage { url?: string; method?: string; headers: Record<string, string | string[] | undefined> }
  interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    writeHead(status: number, headers?: Record<string, string>): void;
    write(chunk: string): void;
    end(chunk?: string): void;
  }
  interface Server { listen(port: number, callback?: () => void): Server; close(): void }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
declare module 'http' { export * from 'node:http'; }
declare module 'node:os' {
  export function platform(): string;
  export function arch(): string;
  export function cpus(): { model: string }[];
  export function totalmem(): number;
  export function hostname(): string;
  export const EOL: string;
}
declare module 'os' { export * from 'node:os'; }
`;
