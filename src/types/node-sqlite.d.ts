// The project's @types/node predates node:sqlite (Node 22.5+); only what the SQLite connector uses.
declare module 'node:sqlite' {
  export class StatementSync {
    columns(): { name: string }[];
    iterate(...params: unknown[]): Iterable<Record<string, unknown>>;
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
