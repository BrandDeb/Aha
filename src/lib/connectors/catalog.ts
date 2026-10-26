/**
 * The connector catalog: well-known MCP servers, ready to add in one step. Each entry says who makes it, what it
 * gives the agent, how it runs and what it needs, and is turned into a connector by filling in its inputs:
 *
 *   remote, no setup   a public MCP endpoint (Hugging Face, Context7, DeepWiki…): added as MCP over HTTP
 *   remote, key        an endpoint that takes a token in a header (GitHub, Apify…)
 *   sign-in (OAuth)    vendor endpoints that log you in in the browser (Linear, Notion, Sentry, Atlassian…): run
 *                      through mcp-remote on your machine, which opens the sign-in page and keeps the token there
 *   local              a program on your machine (npx / uvx), with its API key in its environment
 *
 * Every package and URL here was checked to exist. Pure data and one function, so it is tested directly.
 */

import type { McpHttpConnector, McpStdioConnector } from './types.ts';

export type CatalogCategory = 'Code and dev' | 'Browsers and web' | 'Search and research' | 'Docs and knowledge' | 'Databases' | 'Cloud and deploy' | 'Work and projects' | 'Design' | 'Payments and commerce' | 'Observability' | 'AI and data' | 'Web3';

export const CATALOG_CATEGORIES: CatalogCategory[] = ['Code and dev', 'Browsers and web', 'Search and research', 'Docs and knowledge', 'Databases', 'Cloud and deploy', 'Work and projects', 'Design', 'Payments and commerce', 'Observability', 'AI and data', 'Web3'];

export interface CatalogInput {
  /** Referenced as {key} in the transport */
  key: string;
  label: string;
  /** Where to get it */
  help?: string;
  secret?: boolean;
  placeholder?: string;
  optional?: boolean;
}

type Transport =
  | { kind: 'mcp-http'; url: string; headers?: Record<string, string> }
  | { kind: 'mcp-stdio'; command: string; args: string[]; env?: Record<string, string> };

export interface CatalogEntry {
  id: string;
  name: string;
  publisher: string;
  /** Made by the company whose service it connects to (or the MCP project itself) */
  official: boolean;
  category: CatalogCategory;
  description: string;
  homepage: string;
  auth: 'none' | 'key' | 'oauth';
  /** remote: talks to a URL; local: runs a program on your machine */
  runs: 'remote' | 'local';
  /** What the machine needs for a local one */
  needs?: 'node' | 'uv' | 'app';
  inputs: CatalogInput[];
  transport: Transport;
  /** Its tools only read: worth trusting reads by default */
  readOnly?: boolean;
  /** Shown before adding: what to know */
  note?: string;
}

const npx = (pkg: string, ...rest: string[]) => ({ command: 'npx', args: ['-y', pkg, ...rest] });
const uvx = (pkg: string, ...rest: string[]) => ({ command: 'uvx', args: [pkg, ...rest] });
/** A sign-in (OAuth) endpoint, through mcp-remote on this machine */
const oauth = (url: string): Transport => ({ kind: 'mcp-stdio', ...npx('mcp-remote', url) });

export const CATALOG: CatalogEntry[] = [
  // ─── Code and dev ──────────────────────────────────────────────────────────
  { id: 'github', name: 'GitHub', publisher: 'GitHub', official: true, category: 'Code and dev', description: 'Repositories, issues, pull requests, Actions runs and code search: the agent can read, comment and open PRs.', homepage: 'https://github.com/github/github-mcp-server', auth: 'key', runs: 'remote', inputs: [{ key: 'token', label: 'Personal access token', help: 'https://github.com/settings/personal-access-tokens', secret: true, placeholder: 'github_pat_…' }], transport: { kind: 'mcp-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer {token}' } } },
  { id: 'git', name: 'Git', publisher: 'MCP project', official: true, category: 'Code and dev', description: 'Log, diff, status, branches and commits of a local repository.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git', auth: 'none', runs: 'local', needs: 'uv', inputs: [{ key: 'repo', label: 'Repository folder', placeholder: '/path/to/repo' }], transport: { kind: 'mcp-stdio', ...uvx('mcp-server-git', '--repository', '{repo}') } },
  { id: 'filesystem', name: 'Filesystem', publisher: 'MCP project', official: true, category: 'Code and dev', description: 'Read, write and search files in folders you allow.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', auth: 'none', runs: 'local', needs: 'node', inputs: [{ key: 'folder', label: 'Folder', placeholder: '/path/to/folder' }], transport: { kind: 'mcp-stdio', ...npx('@modelcontextprotocol/server-filesystem', '{folder}') }, note: 'Writes happen directly on disk, not as a proposal.' },
  { id: 'deepwiki', name: 'DeepWiki', publisher: 'Cognition', official: true, category: 'Code and dev', description: 'Ask questions about any public GitHub repository: architecture, how things work, where code lives.', homepage: 'https://deepwiki.com', auth: 'none', runs: 'remote', inputs: [], transport: { kind: 'mcp-http', url: 'https://mcp.deepwiki.com/mcp' }, readOnly: true },
  { id: 'semgrep', name: 'Semgrep', publisher: 'Semgrep', official: true, category: 'Code and dev', description: 'Scan code for security bugs with thousands of Semgrep rules, or write your own.', homepage: 'https://github.com/semgrep/mcp', auth: 'none', runs: 'local', needs: 'uv', inputs: [], transport: { kind: 'mcp-stdio', ...uvx('semgrep-mcp') }, readOnly: true },
  { id: 'sequential-thinking', name: 'Sequential thinking', publisher: 'MCP project', official: true, category: 'Code and dev', description: 'A scratchpad tool for step-by-step reasoning on hard problems.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('@modelcontextprotocol/server-sequential-thinking') }, readOnly: true },
  { id: 'memory', name: 'Memory', publisher: 'MCP project', official: true, category: 'Code and dev', description: 'A knowledge graph the agent writes facts into and recalls across sessions.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('@modelcontextprotocol/server-memory') } },
  { id: 'time', name: 'Time', publisher: 'MCP project', official: true, category: 'Code and dev', description: 'Current time and time-zone conversion.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time', auth: 'none', runs: 'local', needs: 'uv', inputs: [], transport: { kind: 'mcp-stdio', ...uvx('mcp-server-time') }, readOnly: true },

  // ─── Browsers and web ──────────────────────────────────────────────────────
  { id: 'playwright', name: 'Playwright', publisher: 'Microsoft', official: true, category: 'Browsers and web', description: 'Drive a real browser: open pages, click, type, read the page and take screenshots, to try a web app end to end.', homepage: 'https://github.com/microsoft/playwright-mcp', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('@playwright/mcp@latest') } },
  { id: 'chrome-devtools', name: 'Chrome DevTools', publisher: 'Google Chrome', official: true, category: 'Browsers and web', description: 'Debug a page in Chrome: console, network, performance traces and Core Web Vitals.', homepage: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('chrome-devtools-mcp@latest') } },
  { id: 'fetch', name: 'Fetch', publisher: 'MCP project', official: true, category: 'Browsers and web', description: 'Fetch a URL and convert it to markdown for the agent.', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch', auth: 'none', runs: 'local', needs: 'uv', inputs: [], transport: { kind: 'mcp-stdio', ...uvx('mcp-server-fetch') }, readOnly: true, note: 'The built-in Web pages connector does the same without installing anything, and never reaches your local network.' },
  { id: 'firecrawl', name: 'Firecrawl', publisher: 'Firecrawl', official: true, category: 'Browsers and web', description: 'Scrape, crawl and extract structured data from websites, JavaScript-heavy ones included.', homepage: 'https://github.com/firecrawl/firecrawl-mcp-server', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Firecrawl API key', help: 'https://www.firecrawl.dev/app/api-keys', secret: true, placeholder: 'fc-…' }], transport: { kind: 'mcp-stdio', ...npx('firecrawl-mcp'), env: { FIRECRAWL_API_KEY: '{key}' } } },
  { id: 'browserbase', name: 'Browserbase', publisher: 'Browserbase', official: true, category: 'Browsers and web', description: 'Cloud browsers the agent can control, with sessions, stealth and screenshots.', homepage: 'https://github.com/browserbase/mcp-server-browserbase', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'API key', help: 'https://www.browserbase.com/settings', secret: true }, { key: 'project', label: 'Project ID' }], transport: { kind: 'mcp-stdio', ...npx('@browserbasehq/mcp-server-browserbase'), env: { BROWSERBASE_API_KEY: '{key}', BROWSERBASE_PROJECT_ID: '{project}' } } },
  { id: 'apify', name: 'Apify', publisher: 'Apify', official: true, category: 'Browsers and web', description: 'Thousands of ready-made scrapers and automations (Actors): Google Maps, Instagram, Amazon, any website.', homepage: 'https://mcp.apify.com', auth: 'key', runs: 'remote', inputs: [{ key: 'token', label: 'Apify API token', help: 'https://console.apify.com/settings/integrations', secret: true }], transport: { kind: 'mcp-http', url: 'https://mcp.apify.com', headers: { Authorization: 'Bearer {token}' } } },

  // ─── Search and research ───────────────────────────────────────────────────
  { id: 'exa', name: 'Exa', publisher: 'Exa', official: true, category: 'Search and research', description: 'Web search built for AI: fresh results, code search and page contents.', homepage: 'https://exa.ai', auth: 'none', runs: 'remote', inputs: [], transport: { kind: 'mcp-http', url: 'https://mcp.exa.ai/mcp' }, readOnly: true },
  { id: 'brave-search', name: 'Brave Search', publisher: 'Brave', official: true, category: 'Search and research', description: 'Web, news, image and local search from an independent index.', homepage: 'https://github.com/brave/brave-search-mcp-server', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Brave Search API key', help: 'https://brave.com/search/api/', secret: true }], transport: { kind: 'mcp-stdio', ...npx('@brave/brave-search-mcp-server'), env: { BRAVE_API_KEY: '{key}' } }, readOnly: true },
  { id: 'tavily', name: 'Tavily', publisher: 'Tavily', official: true, category: 'Search and research', description: 'Search, extract and crawl, tuned for agents.', homepage: 'https://github.com/tavily-ai/tavily-mcp', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Tavily API key', help: 'https://app.tavily.com', secret: true, placeholder: 'tvly-…' }], transport: { kind: 'mcp-stdio', ...npx('tavily-mcp@latest'), env: { TAVILY_API_KEY: '{key}' } }, readOnly: true },
  { id: 'perplexity', name: 'Perplexity', publisher: 'Perplexity', official: true, category: 'Search and research', description: 'Answers with sources, and deep research, from Perplexity’s Sonar models.', homepage: 'https://github.com/perplexityai/modelcontextprotocol', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Perplexity API key', help: 'https://www.perplexity.ai/settings/api', secret: true, placeholder: 'pplx-…' }], transport: { kind: 'mcp-stdio', ...npx('@perplexity-ai/mcp-server'), env: { PERPLEXITY_API_KEY: '{key}' } }, readOnly: true },

  // ─── Docs and knowledge ────────────────────────────────────────────────────
  { id: 'context7', name: 'Context7', publisher: 'Upstash', official: true, category: 'Docs and knowledge', description: 'Up-to-date, version-specific documentation and examples for thousands of libraries, so the agent doesn’t code against stale APIs.', homepage: 'https://context7.com', auth: 'none', runs: 'remote', inputs: [], transport: { kind: 'mcp-http', url: 'https://mcp.context7.com/mcp' }, readOnly: true },
  { id: 'cloudflare-docs', name: 'Cloudflare docs', publisher: 'Cloudflare', official: true, category: 'Docs and knowledge', description: 'Search Cloudflare’s documentation: Workers, Pages, R2, D1, KV and the rest.', homepage: 'https://github.com/cloudflare/mcp-server-cloudflare', auth: 'none', runs: 'remote', inputs: [], transport: { kind: 'mcp-http', url: 'https://docs.mcp.cloudflare.com/mcp' }, readOnly: true },
  { id: 'gitmcp', name: 'GitMCP', publisher: 'GitMCP', official: false, category: 'Docs and knowledge', description: 'Documentation of any GitHub project as a tool: it reads the repo’s llms.txt, README and docs.', homepage: 'https://gitmcp.io', auth: 'none', runs: 'remote', inputs: [], transport: { kind: 'mcp-http', url: 'https://gitmcp.io/docs' }, readOnly: true },
  { id: 'notion', name: 'Notion', publisher: 'Notion', official: true, category: 'Docs and knowledge', description: 'Search, read and write pages and databases in your Notion workspace.', homepage: 'https://developers.notion.com/docs/mcp', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.notion.com/mcp') },

  // ─── Databases ─────────────────────────────────────────────────────────────
  { id: 'supabase', name: 'Supabase', publisher: 'Supabase', official: true, category: 'Databases', description: 'Tables, SQL, migrations, edge functions, logs and advisors of your Supabase projects.', homepage: 'https://supabase.com/docs/guides/getting-started/mcp', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'token', label: 'Personal access token', help: 'https://supabase.com/dashboard/account/tokens', secret: true, placeholder: 'sbp_…' }, { key: 'project', label: 'Project ref (limits it to one project)', optional: true }], transport: { kind: 'mcp-stdio', ...npx('@supabase/mcp-server-supabase@latest', '--read-only', '--project-ref={project}'), env: { SUPABASE_ACCESS_TOKEN: '{token}' } }, note: 'Starts read-only. Remove --read-only from its arguments to let it change data.' },
  { id: 'neon', name: 'Neon', publisher: 'Neon', official: true, category: 'Databases', description: 'Serverless Postgres: projects, branches, SQL and schema migrations on a branch.', homepage: 'https://neon.com/docs/ai/neon-mcp-server', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.neon.tech/mcp') },
  { id: 'mongodb', name: 'MongoDB', publisher: 'MongoDB', official: true, category: 'Databases', description: 'Query and inspect MongoDB and Atlas: collections, indexes, aggregations.', homepage: 'https://github.com/mongodb-js/mongodb-mcp-server', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'conn', label: 'Connection string', secret: true, placeholder: 'mongodb+srv://…' }], transport: { kind: 'mcp-stdio', ...npx('mongodb-mcp-server', '--readOnly'), env: { MDB_MCP_CONNECTION_STRING: '{conn}' } }, readOnly: true },
  { id: 'redis', name: 'Redis', publisher: 'Redis', official: true, category: 'Databases', description: 'Read and write Redis data structures, search and JSON.', homepage: 'https://github.com/redis/mcp-redis', auth: 'key', runs: 'local', needs: 'uv', inputs: [{ key: 'url', label: 'Redis URL', secret: true, placeholder: 'redis://localhost:6379/0' }], transport: { kind: 'mcp-stdio', ...uvx('redis-mcp-server', '--url', '{url}') } },
  { id: 'clickhouse', name: 'ClickHouse', publisher: 'ClickHouse', official: true, category: 'Databases', description: 'Run read-only SQL on ClickHouse for analytics.', homepage: 'https://github.com/ClickHouse/mcp-clickhouse', auth: 'key', runs: 'local', needs: 'uv', inputs: [{ key: 'host', label: 'Host' }, { key: 'user', label: 'User' }, { key: 'password', label: 'Password', secret: true }], transport: { kind: 'mcp-stdio', ...uvx('mcp-clickhouse'), env: { CLICKHOUSE_HOST: '{host}', CLICKHOUSE_USER: '{user}', CLICKHOUSE_PASSWORD: '{password}' } }, readOnly: true },
  { id: 'motherduck', name: 'DuckDB / MotherDuck', publisher: 'MotherDuck', official: true, category: 'Databases', description: 'Query local DuckDB files, Parquet and CSV, or MotherDuck in the cloud.', homepage: 'https://github.com/motherduckdb/mcp-server-motherduck', auth: 'none', runs: 'local', needs: 'uv', inputs: [{ key: 'db', label: 'Database (":memory:", a .duckdb file, or md: for MotherDuck)', placeholder: ':memory:' }], transport: { kind: 'mcp-stdio', ...uvx('mcp-server-motherduck', '--db-path', '{db}') } },
  { id: 'elasticsearch', name: 'Elasticsearch', publisher: 'Elastic', official: true, category: 'Databases', description: 'Search indices, mappings and documents.', homepage: 'https://github.com/elastic/mcp-server-elasticsearch', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'url', label: 'Elasticsearch URL' }, { key: 'key', label: 'API key', secret: true }], transport: { kind: 'mcp-stdio', ...npx('@elastic/mcp-server-elasticsearch'), env: { ES_URL: '{url}', ES_API_KEY: '{key}' } }, readOnly: true },

  // ─── Cloud and deploy ──────────────────────────────────────────────────────
  { id: 'vercel', name: 'Vercel', publisher: 'Vercel', official: true, category: 'Cloud and deploy', description: 'Projects, deployments, build and runtime logs, domains and docs.', homepage: 'https://vercel.com/docs/mcp/vercel-mcp', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.vercel.com') },
  { id: 'cloudflare', name: 'Cloudflare', publisher: 'Cloudflare', official: true, category: 'Cloud and deploy', description: 'Workers, KV, R2, D1 and Hyperdrive in your account.', homepage: 'https://github.com/cloudflare/mcp-server-cloudflare', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://bindings.mcp.cloudflare.com/mcp') },
  { id: 'netlify', name: 'Netlify', publisher: 'Netlify', official: true, category: 'Cloud and deploy', description: 'Create, deploy and manage Netlify sites, functions and environment variables.', homepage: 'https://github.com/netlify/netlify-mcp', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'token', label: 'Personal access token', help: 'https://app.netlify.com/user/applications#personal-access-tokens', secret: true }], transport: { kind: 'mcp-stdio', ...npx('@netlify/mcp'), env: { NETLIFY_PERSONAL_ACCESS_TOKEN: '{token}' } } },
  { id: 'heroku', name: 'Heroku', publisher: 'Heroku', official: true, category: 'Cloud and deploy', description: 'Apps, dynos, add-ons, logs and Postgres on Heroku.', homepage: 'https://github.com/heroku/heroku-mcp-server', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Heroku API key', help: 'https://dashboard.heroku.com/account', secret: true }], transport: { kind: 'mcp-stdio', ...npx('@heroku/mcp-server'), env: { HEROKU_API_KEY: '{key}' } } },
  { id: 'kubernetes', name: 'Kubernetes', publisher: 'Flux159', official: false, category: 'Cloud and deploy', description: 'kubectl and Helm for the cluster in your kubeconfig: pods, logs, deployments.', homepage: 'https://github.com/Flux159/mcp-server-kubernetes', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('mcp-server-kubernetes') } },
  { id: 'aws-docs', name: 'AWS documentation', publisher: 'AWS Labs', official: true, category: 'Cloud and deploy', description: 'Search and read AWS documentation and recommendations.', homepage: 'https://github.com/awslabs/mcp', auth: 'none', runs: 'local', needs: 'uv', inputs: [], transport: { kind: 'mcp-stdio', ...uvx('awslabs.aws-documentation-mcp-server@latest') }, readOnly: true },

  // ─── Work and projects ─────────────────────────────────────────────────────
  { id: 'linear', name: 'Linear', publisher: 'Linear', official: true, category: 'Work and projects', description: 'Find, create and update issues, projects and comments.', homepage: 'https://linear.app/docs/mcp', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.linear.app/mcp') },
  { id: 'atlassian', name: 'Jira and Confluence', publisher: 'Atlassian', official: true, category: 'Work and projects', description: 'Jira issues and Confluence pages: search, read, create and update.', homepage: 'https://www.atlassian.com/platform/remote-mcp-server', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.atlassian.com/v1/mcp') },
  { id: 'asana', name: 'Asana', publisher: 'Asana', official: true, category: 'Work and projects', description: 'Tasks, projects and goals in your Asana workspace.', homepage: 'https://developers.asana.com/docs/using-asanas-mcp-server', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.asana.com/sse') },
  { id: 'monday', name: 'monday.com', publisher: 'monday.com', official: true, category: 'Work and projects', description: 'Boards, items and updates in monday.com.', homepage: 'https://developer.monday.com/apps/docs/mondaycom-mcp-integration', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.monday.com/mcp') },
  { id: 'zapier', name: 'Zapier', publisher: 'Zapier', official: true, category: 'Work and projects', description: 'Thousands of apps through Zapier actions you choose: Gmail, Slack, Sheets, CRMs and more.', homepage: 'https://zapier.com/mcp', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.zapier.com/api/mcp/mcp') },
  { id: 'resend', name: 'Resend', publisher: 'Resend', official: true, category: 'Work and projects', description: 'Send and schedule email, manage audiences and contacts.', homepage: 'https://github.com/resend/mcp-send-email', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Resend API key', help: 'https://resend.com/api-keys', secret: true, placeholder: 're_…' }], transport: { kind: 'mcp-stdio', ...npx('resend-mcp'), env: { RESEND_API_KEY: '{key}' } } },

  // ─── Design ────────────────────────────────────────────────────────────────
  { id: 'figma-dev-mode', name: 'Figma (Dev Mode)', publisher: 'Figma', official: true, category: 'Design', description: 'The selected Figma frame as code context: layout, variables, components and assets.', homepage: 'https://help.figma.com/hc/en-us/articles/32132100833559', auth: 'none', runs: 'local', needs: 'app', inputs: [], transport: { kind: 'mcp-http', url: 'http://127.0.0.1:3845/mcp' }, readOnly: true, note: 'Turn on the MCP server in the Figma desktop app (Preferences → Enable Dev Mode MCP Server).' },
  { id: 'figma-context', name: 'Figma files', publisher: 'GLips', official: false, category: 'Design', description: 'Read any Figma file or frame by link, simplified for the agent.', homepage: 'https://github.com/GLips/Figma-Context-MCP', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Figma personal access token', help: 'https://www.figma.com/developers/api#access-tokens', secret: true }], transport: { kind: 'mcp-stdio', ...npx('figma-developer-mcp', '--figma-api-key={key}', '--stdio') }, readOnly: true },
  { id: 'canva', name: 'Canva', publisher: 'Canva', official: true, category: 'Design', description: 'Search, create and export Canva designs.', homepage: 'https://www.canva.dev/docs/connect/canva-mcp-server-setup/', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.canva.com/mcp') },

  // ─── Payments and commerce ─────────────────────────────────────────────────
  { id: 'stripe', name: 'Stripe', publisher: 'Stripe', official: true, category: 'Payments and commerce', description: 'Customers, products, prices, payment links, invoices and refunds, plus Stripe’s docs.', homepage: 'https://docs.stripe.com/mcp', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Secret key (use a test-mode or restricted key)', help: 'https://dashboard.stripe.com/apikeys', secret: true, placeholder: 'sk_test_… or rk_test_…' }], transport: { kind: 'mcp-stdio', ...npx('@stripe/mcp', '--api-key={key}') }, note: 'Use a test-mode or restricted key: this can move money.' },
  { id: 'paypal', name: 'PayPal', publisher: 'PayPal', official: true, category: 'Payments and commerce', description: 'Invoices, orders, products, subscriptions and disputes.', homepage: 'https://developer.paypal.com/tools/mcp-server/', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.paypal.com/mcp') },
  { id: 'square', name: 'Square', publisher: 'Square', official: true, category: 'Payments and commerce', description: 'Payments, catalog, orders and customers on Square.', homepage: 'https://developer.squareup.com/docs/mcp', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.squareup.com/sse') },
  { id: 'shopify-dev', name: 'Shopify dev', publisher: 'Shopify', official: true, category: 'Payments and commerce', description: 'Shopify’s APIs and docs for building apps and themes: GraphQL schema, Liquid, Polaris.', homepage: 'https://shopify.dev/docs/apps/build/devmcp', auth: 'none', runs: 'local', needs: 'node', inputs: [], transport: { kind: 'mcp-stdio', ...npx('@shopify/dev-mcp@latest') }, readOnly: true },

  // ─── Observability ─────────────────────────────────────────────────────────
  { id: 'sentry', name: 'Sentry', publisher: 'Sentry', official: true, category: 'Observability', description: 'Errors and issues with stack traces, releases and Seer’s root-cause analysis: the agent can go from an alert to a fix.', homepage: 'https://docs.sentry.io/product/sentry-mcp/', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.sentry.dev/mcp') },
  { id: 'posthog', name: 'PostHog', publisher: 'PostHog', official: true, category: 'Observability', description: 'Product analytics, feature flags, experiments and error tracking.', homepage: 'https://posthog.com/docs/model-context-protocol', auth: 'oauth', runs: 'local', needs: 'node', inputs: [], transport: oauth('https://mcp.posthog.com/mcp') },

  // ─── AI and data ───────────────────────────────────────────────────────────
  { id: 'huggingface', name: 'Hugging Face', publisher: 'Hugging Face', official: true, category: 'AI and data', description: 'Search models, datasets, Spaces and papers on the Hub; add a token for your own and gated ones.', homepage: 'https://huggingface.co/settings/mcp', auth: 'none', runs: 'remote', inputs: [{ key: 'token', label: 'Access token (optional)', help: 'https://huggingface.co/settings/tokens', secret: true, optional: true, placeholder: 'hf_…' }], transport: { kind: 'mcp-http', url: 'https://huggingface.co/mcp', headers: { Authorization: 'Bearer {token}' } }, readOnly: true },

  // ─── Web3 ──────────────────────────────────────────────────────────────────
  { id: 'alchemy', name: 'Alchemy', publisher: 'Alchemy', official: true, category: 'Web3', description: 'Blockchain data across chains: balances, token prices, NFTs, transactions and history.', homepage: 'https://github.com/alchemyplatform/alchemy-mcp-server', auth: 'key', runs: 'local', needs: 'node', inputs: [{ key: 'key', label: 'Alchemy API key', help: 'https://dashboard.alchemy.com', secret: true }], transport: { kind: 'mcp-stdio', ...npx('@alchemy/mcp-server'), env: { ALCHEMY_API_KEY: '{key}' } }, readOnly: true },
];

/** Fill an entry's inputs into a connector. Missing required inputs come back as an error; empty optional ones drop the argument or header that uses them. */
export function connectorFrom(entry: CatalogEntry, values: Record<string, string>): Omit<McpHttpConnector, 'id'> | Omit<McpStdioConnector, 'id'> | { error: string } {
  for (const input of entry.inputs) if (!input.optional && !values[input.key]?.trim()) return { error: `${input.label} is needed` };
  const blank = (s: string) => /\{(\w+)\}/.test(s) && [...s.matchAll(/\{(\w+)\}/g)].some((m) => !values[m[1]]?.trim());
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => values[k]?.trim() ?? '');
  const base = { name: entry.name, enabled: true, trustReads: !!entry.readOnly };
  const t = entry.transport;
  if (t.kind === 'mcp-http') {
    const headers = Object.fromEntries(Object.entries(t.headers ?? {}).filter(([, v]) => !blank(v)).map(([k, v]) => [k, fill(v)]));
    return { ...base, kind: 'mcp-http', url: fill(t.url), headers };
  }
  const env = Object.fromEntries(Object.entries(t.env ?? {}).filter(([, v]) => !blank(v)).map(([k, v]) => [k, fill(v)]));
  return { ...base, kind: 'mcp-stdio', command: t.command, args: t.args.filter((a) => !blank(a)).map(fill), env };
}

/** Entries matching a search (name, publisher, description) and a category */
export function searchCatalog(query: string, category: CatalogCategory | 'All' = 'All'): CatalogEntry[] {
  // Forgiving of plurals: "library" finds "libraries", "databases" finds "database"
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length > 4 ? w.replace(/(ies|es|s|y)$/, '') : w));
  return CATALOG.filter((e) => (category === 'All' || e.category === category) && words.every((w) => `${e.name} ${e.publisher} ${e.description} ${e.category}`.toLowerCase().includes(w)));
}

/** How an entry runs, in a few words, for its card */
export function setupLabel(e: CatalogEntry): string {
  if (e.runs === 'remote') return e.auth === 'none' ? 'Remote · no setup' : 'Remote · token';
  if (e.auth === 'oauth') return 'Sign in · runs locally';
  if (e.needs === 'app') return 'Desktop app';
  return `Local · ${e.needs === 'uv' ? 'uv' : 'Node'}${e.auth === 'key' ? ' · key' : ''}`;
}
