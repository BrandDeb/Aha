/** Small pure helpers for the connector forms: arguments, KEY=value lists, and the starting points offered when adding one. */

import type { Connector } from '@/lib/connectors/types';

/** Split a command line into arguments, honouring single and double quotes */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
    }
  }
  if (started || current) args.push(current);
  return args;
}

/** The inverse of splitArgs, so an edited list round-trips */
export function joinArgs(args: string[]): string {
  return args.map((a) => (a === '' || /[\s"']/.test(a) ? (a.includes('"') ? `'${a}'` : `"${a}"`) : a)).join(' ');
}

/** "KEY=value" lines to a record; blank lines and # comments are ignored */
export function parsePairs(text: string, separator: '=' | ':' = '='): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export function formatPairs(record: Record<string, string>, separator: '=' | ':' = '='): string {
  return Object.entries(record).map(([k, v]) => `${k}${separator === ':' ? ': ' : '='}${v}`).join('\n');
}

export type Preset = {
  id: string;
  label: string;
  group: 'Built in' | 'MCP servers' | 'Your own';
  note: string;
  make: () => Omit<Connector, 'id'>;
};

const base = { enabled: true, trustReads: false };

export const PRESETS: Preset[] = [
  { id: 'github', label: 'GitHub', group: 'Built in', note: 'Search code, read files, issues and pull requests. Uses your GitHub sign-in, or a token you paste.', make: () => ({ ...base, name: 'GitHub', kind: 'github', token: '' }) },
  { id: 'web-fetch', label: 'Web pages', group: 'Built in', note: 'Read any public web page as text. Never reaches your local network.', make: () => ({ ...base, name: 'Web', kind: 'web-fetch' }) },
  { id: 'brave', label: 'Web search · Brave', group: 'Built in', note: 'Needs a Brave Search API key (free tier available).', make: () => ({ ...base, name: 'Search', kind: 'web-search', provider: 'brave', apiKey: '', baseUrl: '' }) },
  { id: 'tavily', label: 'Web search · Tavily', group: 'Built in', note: 'Needs a Tavily API key (free tier available).', make: () => ({ ...base, name: 'Search', kind: 'web-search', provider: 'tavily', apiKey: '', baseUrl: '' }) },
  { id: 'searxng', label: 'Web search · SearXNG', group: 'Built in', note: 'Your own SearXNG instance; no key needed. JSON output must be enabled.', make: () => ({ ...base, name: 'Search', kind: 'web-search', provider: 'searxng', apiKey: '', baseUrl: 'http://localhost:8080' }) },
  { id: 'sqlite', label: 'SQLite database', group: 'Built in', note: 'Read-only access to a database file on this machine.', make: () => ({ ...base, name: 'SQLite', kind: 'sqlite', path: '' }) },
  { id: 'postgres', label: 'PostgreSQL database', group: 'Built in', note: 'Read-only queries. Use a database role that can only read.', make: () => ({ ...base, name: 'Postgres', kind: 'postgres', url: 'postgresql://user:password@localhost:5432/dbname' }) },
  { id: 'mcp-filesystem', label: 'Filesystem', group: 'MCP servers', note: 'Lets the agent read and write files in a folder you choose (replace the path). Writes happen immediately, not as a proposal.', make: () => ({ ...base, name: 'Files', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/folder'], env: {} }) },
  { id: 'mcp-git', label: 'Git', group: 'MCP servers', note: 'Inspect a local git repository: log, diff, status. Needs uv.', make: () => ({ ...base, name: 'Git', kind: 'mcp-stdio', command: 'uvx', args: ['mcp-server-git', '--repository', '/path/to/repo'], env: {} }) },
  { id: 'mcp-memory', label: 'Memory', group: 'MCP servers', note: 'A knowledge graph the agent can write notes into and recall later.', make: () => ({ ...base, name: 'Memory', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} }) },
  { id: 'mcp-context7', label: 'Library docs · Context7', group: 'MCP servers', note: 'Up-to-date documentation for popular libraries.', make: () => ({ ...base, name: 'Docs', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: {} }) },
  { id: 'mcp-playwright', label: 'Browser · Playwright', group: 'MCP servers', note: 'Lets the agent drive a real browser to try a web app.', make: () => ({ ...base, name: 'Browser', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {} }) },
  { id: 'mcp-stdio', label: 'MCP server · command', group: 'Your own', note: 'Any MCP server that runs as a local program. This includes the Python MCP template in the project list.', make: () => ({ ...base, name: 'MCP server', kind: 'mcp-stdio', command: '', args: [], env: {} }) },
  { id: 'mcp-http', label: 'MCP server · URL', group: 'Your own', note: 'A remote or local MCP server over HTTP (Streamable HTTP).', make: () => ({ ...base, name: 'MCP server', kind: 'mcp-http', url: 'http://localhost:8000/mcp', headers: {} }) },
  { id: 'command', label: 'Custom command', group: 'Your own', note: 'Turn any command into a tool: name it, describe it, and give it parameters. The agent always asks before running it.', make: () => ({ ...base, name: 'My tool', kind: 'command', tool: { name: 'my_tool', description: '', command: '', args: [], params: [] } }) },
];
