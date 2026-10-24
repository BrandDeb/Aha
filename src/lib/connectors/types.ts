/**
 * Connectors give the agent tools beyond the project: MCP servers, GitHub,
 * databases, the web, and the developer's own commands. This file is the
 * shared vocabulary (browser and server): what a connector's configuration
 * looks like, how untrusted input is validated into one, and what a tool is.
 */

export type ConnectorKind = 'mcp-stdio' | 'mcp-http' | 'github' | 'web-fetch' | 'web-search' | 'sqlite' | 'postgres' | 'command';

interface Base {
  id: string;
  name: string;
  enabled: boolean;
  /** Skip the approval prompt for tools that only read */
  trustReads: boolean;
}

export interface McpStdioConnector extends Base {
  kind: 'mcp-stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface McpHttpConnector extends Base {
  kind: 'mcp-http';
  url: string;
  headers: Record<string, string>;
}
export interface GithubConnector extends Base {
  kind: 'github';
  /** Optional token; without one the studio's GitHub sign-in is used */
  token: string;
}
export interface WebFetchConnector extends Base {
  kind: 'web-fetch';
}
export interface WebSearchConnector extends Base {
  kind: 'web-search';
  provider: 'brave' | 'tavily' | 'searxng';
  apiKey: string;
  /** SearXNG instance URL */
  baseUrl: string;
}
export interface SqliteConnector extends Base {
  kind: 'sqlite';
  path: string;
}
export interface PostgresConnector extends Base {
  kind: 'postgres';
  url: string;
}
export interface CommandConnector extends Base {
  kind: 'command';
  tool: { name: string; description: string; command: string; args: string[]; params: { name: string; description: string }[] };
}

export type Connector = McpStdioConnector | McpHttpConnector | GithubConnector | WebFetchConnector | WebSearchConnector | SqliteConnector | PostgresConnector | CommandConnector;

/** Kinds that run programs or read files on the machine running the studio */
export const LOCAL_KINDS: ConnectorKind[] = ['mcp-stdio', 'sqlite', 'command'];

export interface ToolSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}

export interface ConnectorTool {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  /** Only reads. Taken from the connector's own declaration, so it is a hint, not a guarantee. */
  readOnly: boolean;
}

export interface ConnectorCallResult {
  text: string;
  isError: boolean;
}

export const KIND_LABEL: Record<ConnectorKind, string> = {
  'mcp-stdio': 'MCP server (local process)',
  'mcp-http': 'MCP server (HTTP)',
  github: 'GitHub',
  'web-fetch': 'Web pages',
  'web-search': 'Web search',
  sqlite: 'SQLite database',
  postgres: 'PostgreSQL database',
  command: 'Custom command',
};

// ---------------------------------------------------------------------------
// Validation (the server never trusts what the browser sends)
// ---------------------------------------------------------------------------

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Things that would let a connector redirect where code is loaded from or what it runs as */
const BLOCKED_ENV = /^(?:PATH|HOME|USERPROFILE|SHELL|NODE_.*|LD_.*|DYLD_.*|SYSTEM.*|COMSPEC|PATHEXT|PYTHONPATH|PYTHONHOME)$/i;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'connector';

const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0');

function strings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) return null;
  return value.every((v) => isString(v, maxLength)) ? (value as string[]) : null;
}

function record(value: unknown, keyOk: (k: string) => boolean, maxItems = 30): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxItems) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!keyOk(k) || !isString(v, 4000)) return null;
    out[k] = v;
  }
  return out;
}

/** Turn an untrusted object into a Connector, or say what is wrong with it */
export function parseConnector(raw: unknown): Connector | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The connector must be an object.' };
  const input = raw as Record<string, unknown>;
  if (!isString(input.id, 64) || !/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return { error: 'The connector id is invalid.' };
  if (!isString(input.name, 60) || !input.name.trim()) return { error: 'Give the connector a name (up to 60 characters).' };
  const base = { id: input.id, name: input.name.trim(), enabled: input.enabled !== false, trustReads: input.trustReads === true };

  switch (input.kind) {
    case 'mcp-stdio': {
      if (!isString(input.command, 300) || !input.command.trim()) return { error: 'Enter the command that starts the server.' };
      const args = strings(input.args, 40, 1000);
      if (!args) return { error: 'The arguments must be a list of short strings.' };
      const env = record(input.env, (k) => ENV_NAME.test(k));
      if (!env) return { error: 'Environment variable names must look like API_KEY.' };
      const blocked = Object.keys(env).find((k) => BLOCKED_ENV.test(k));
      if (blocked) return { error: `${blocked} can’t be set for a connector.` };
      return { ...base, kind: 'mcp-stdio', command: input.command.trim(), args, env };
    }
    case 'mcp-http': {
      if (!isString(input.url, 500) || !/^https?:\/\/[^\s]+$/i.test(input.url)) return { error: 'The URL must start with http:// or https://' };
      const headers = record(input.headers, (k) => HEADER_NAME.test(k));
      if (!headers) return { error: 'Header names may only contain letters, digits and dashes.' };
      return { ...base, kind: 'mcp-http', url: input.url, headers };
    }
    case 'github':
      if (input.token !== undefined && !isString(input.token, 300)) return { error: 'The token is invalid.' };
      return { ...base, kind: 'github', token: (input.token as string | undefined)?.trim() ?? '' };
    case 'web-fetch':
      return { ...base, kind: 'web-fetch' };
    case 'web-search': {
      if (input.provider !== 'brave' && input.provider !== 'tavily' && input.provider !== 'searxng') return { error: 'Choose Brave, Tavily or SearXNG.' };
      const apiKey = (input.apiKey as string | undefined)?.trim() ?? '';
      const baseUrl = ((input.baseUrl as string | undefined) ?? '').trim().replace(/\/+$/, '');
      if (!isString(apiKey, 300) || !isString(baseUrl, 300)) return { error: 'The key or URL is invalid.' };
      if (input.provider === 'searxng' ? !/^https?:\/\/\S+$/i.test(baseUrl) : !apiKey) {
        return { error: input.provider === 'searxng' ? 'Enter your SearXNG instance URL.' : 'Enter the API key.' };
      }
      return { ...base, kind: 'web-search', provider: input.provider, apiKey, baseUrl };
    }
    case 'sqlite':
      if (!isString(input.path, 500) || !input.path.trim()) return { error: 'Enter the path to the SQLite file.' };
      return { ...base, kind: 'sqlite', path: input.path.trim() };
    case 'postgres':
      if (!isString(input.url, 1000) || !/^postgres(?:ql)?:\/\/\S+$/i.test(input.url)) return { error: 'The connection string must start with postgres:// or postgresql://' };
      return { ...base, kind: 'postgres', url: input.url };
    case 'command': {
      const tool = input.tool as Record<string, unknown> | undefined;
      if (!tool || typeof tool !== 'object') return { error: 'Describe the command.' };
      if (!isString(tool.name, 40) || !/^[a-z][a-z0-9_]{0,39}$/.test(tool.name)) return { error: 'The tool name must be lowercase letters, digits and underscores.' };
      if (!isString(tool.description, 500) || !tool.description.trim()) return { error: 'Describe what the command does so the agent knows when to use it.' };
      if (!isString(tool.command, 300) || !tool.command.trim()) return { error: 'Enter the command to run.' };
      const args = strings(tool.args, 40, 1000);
      if (!args) return { error: 'The arguments must be a list of short strings.' };
      const params = Array.isArray(tool.params) ? tool.params : [];
      if (params.length > 10) return { error: 'A command can take up to 10 parameters.' };
      const parsedParams: { name: string; description: string }[] = [];
      for (const p of params as Record<string, unknown>[]) {
        if (!p || !isString(p.name, 30) || !/^[a-z][a-z0-9_]{0,29}$/.test(p.name) || !isString(p.description ?? '', 200)) return { error: 'Parameter names must be lowercase letters, digits and underscores.' };
        parsedParams.push({ name: p.name, description: (p.description as string | undefined) ?? '' });
      }
      return { ...base, kind: 'command', tool: { name: tool.name, description: tool.description.trim(), command: tool.command.trim(), args, params: parsedParams } };
    }
    default:
      return { error: 'Unknown connector type.' };
  }
}

/** A tool's input schema trimmed to what every provider accepts */
export function cleanSchema(schema: unknown): ToolSchema {
  const clean = (node: unknown, depth: number): Record<string, unknown> => {
    if (!node || typeof node !== 'object' || depth > 4) return { type: 'string' };
    const n = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const type = Array.isArray(n.type) ? n.type.find((t) => t !== 'null') : n.type;
    out.type = typeof type === 'string' && ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(type) ? type : n.properties ? 'object' : n.items ? 'array' : 'string';
    if (typeof n.description === 'string') out.description = n.description.slice(0, 500);
    if (Array.isArray(n.enum) && n.enum.every((e) => typeof e === 'string')) out.enum = n.enum;
    if (out.type === 'array') out.items = n.items && typeof n.items === 'object' ? clean(n.items, depth + 1) : { type: 'string' };
    if (out.type === 'object') {
      const props = n.properties && typeof n.properties === 'object' ? (n.properties as Record<string, unknown>) : {};
      out.properties = Object.fromEntries(Object.entries(props).slice(0, 40).map(([k, v]) => [k, clean(v, depth + 1)]));
      if (Array.isArray(n.required)) out.required = n.required.filter((r) => typeof r === 'string' && r in (out.properties as object));
    }
    return out;
  };
  const top = clean({ ...(schema as object), type: 'object' }, 0);
  return { type: 'object', properties: (top.properties as ToolSchema['properties']) ?? {}, ...(Array.isArray(top.required) && top.required.length ? { required: top.required as string[] } : {}) };
}
