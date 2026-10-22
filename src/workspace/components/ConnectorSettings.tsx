'use client';

import { useState, type ReactNode } from 'react';
import { KIND_LABEL, parseConnector, type Connector, type ConnectorKind } from '@/lib/connectors/types';
import { newConnectorId, removeConnector, saveConnectors, upsertConnector, useConnectors } from '../connectors-config';
import { listConnectorTools, useConnectorStatus } from '../connectors-client';
import { formatPairs, joinArgs, parsePairs, PRESETS, splitArgs } from '../connector-forms';

type Fields = Record<string, string>;

/** A connector as the text fields of its form */
function toFields(c: Connector): Fields {
  const f: Fields = { name: c.name };
  if (c.kind === 'github') f.token = c.token;
  if (c.kind === 'web-search') Object.assign(f, { provider: c.provider, apiKey: c.apiKey, baseUrl: c.baseUrl });
  if (c.kind === 'sqlite') f.path = c.path;
  if (c.kind === 'postgres') f.url = c.url;
  if (c.kind === 'mcp-stdio') Object.assign(f, { command: c.command, args: joinArgs(c.args), env: formatPairs(c.env) });
  if (c.kind === 'mcp-http') Object.assign(f, { url: c.url, headers: formatPairs(c.headers, ':') });
  if (c.kind === 'command') {
    Object.assign(f, { toolName: c.tool.name, toolDescription: c.tool.description, command: c.tool.command, toolArgs: joinArgs(c.tool.args), params: c.tool.params.map((p) => `${p.name}: ${p.description}`).join('\n') });
  }
  return f;
}

function fromFields(kind: ConnectorKind, id: string, f: Fields, enabled: boolean, trustReads: boolean): unknown {
  const base = { id, kind, name: f.name, enabled, trustReads };
  switch (kind) {
    case 'github': return { ...base, token: f.token };
    case 'web-search': return { ...base, provider: f.provider, apiKey: f.apiKey, baseUrl: f.baseUrl };
    case 'sqlite': return { ...base, path: f.path };
    case 'postgres': return { ...base, url: f.url };
    case 'mcp-stdio': return { ...base, command: f.command, args: splitArgs(f.args ?? ''), env: parsePairs(f.env ?? '') };
    case 'mcp-http': return { ...base, url: f.url, headers: parsePairs(f.headers ?? '', ':') };
    case 'command':
      return {
        ...base,
        tool: {
          name: f.toolName,
          description: f.toolDescription,
          command: f.command,
          args: splitArgs(f.toolArgs ?? ''),
          params: Object.entries(parsePairs(f.params ?? '', ':')).map(([name, description]) => ({ name, description })),
        },
      };
    default: return base;
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-gray-300">{label}</span>
        {children}
      </label>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

interface Draft {
  id: string;
  kind: ConnectorKind;
  enabled: boolean;
  trustReads: boolean;
  fields: Fields;
  isNew: boolean;
}

export function ConnectorSettings() {
  const connectors = useConnectors();
  const { status } = useConnectorStatus();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [presetId, setPresetId] = useState('');
  const [tests, setTests] = useState<Record<string, { state: 'testing' | 'ok' | 'error'; text: string }>>({});

  const set = (key: string, value: string) => setDraft((d) => d && { ...d, fields: { ...d.fields, [key]: value } });

  const startNew = () => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const made = { ...preset.make(), id: newConnectorId() } as Connector;
    setDraft({ id: made.id, kind: made.kind, enabled: true, trustReads: false, fields: toFields(made), isNew: true });
    setError('');
  };

  const save = () => {
    if (!draft) return;
    const parsed = parseConnector(fromFields(draft.kind, draft.id, draft.fields, draft.enabled, draft.trustReads));
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    upsertConnector(parsed);
    setDraft(null);
    setError('');
    setPresetId('');
  };

  const test = async (connector: Connector) => {
    if (tests[connector.id]?.state === 'testing') return;
    setTests((t) => ({ ...t, [connector.id]: { state: 'testing', text: 'Connecting…' } }));
    try {
      const tools = await listConnectorTools(connector, AbortSignal.timeout(30_000));
      setTests((t) => ({ ...t, [connector.id]: { state: 'ok', text: tools.length ? `${tools.length} tool${tools.length > 1 ? 's' : ''}: ${tools.map((x) => x.name).join(', ')}` : 'Connected, but it offers no tools.' } }));
    } catch (e) {
      setTests((t) => ({ ...t, [connector.id]: { state: 'error', text: (e as Error).name === 'TimeoutError' ? 'No answer within 30 seconds.' : (e as Error).message } }));
    }
  };

  const edit = (c: Connector) => {
    setDraft({ id: c.id, kind: c.kind, enabled: c.enabled, trustReads: c.trustReads, fields: toFields(c), isNew: false });
    setError('');
  };

  const f = draft?.fields ?? {};
  const preset = PRESETS.find((p) => p.id === presetId);
  const groups = ['Built in', 'MCP servers', 'Your own'] as const;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-gray-300">
        Connectors give the agent tools beyond your project: code hosts, databases, the web, MCP servers and your own commands.
        The agent asks before using one, unless you mark its read-only tools as trusted.
      </p>

      {status?.mode === 'off' && <p className="rounded-lg border border-border bg-white/[0.03] p-3 text-xs text-gray-400">Connectors are turned off on this server (NANOCLI_CONNECTORS=0).</p>}
      {status?.mode === 'hosted' && (
        <p className="rounded-lg border border-border bg-white/[0.03] p-3 text-xs text-gray-400">
          This studio is shared, so connectors that run programs or read files on the server (MCP over a local process, SQLite, custom commands) are off.
          Run the studio on your own machine to use them. Web, search, GitHub, PostgreSQL and MCP over HTTP still work.
        </p>
      )}

      {connectors.length > 0 && (
        <ul className="space-y-2">
          {connectors.map((c) => {
            const t = tests[c.id];
            return (
              <li key={c.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={c.enabled} onChange={(e) => upsertConnector({ ...c, enabled: e.target.checked })} aria-label={`Use ${c.name}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-100">{c.name}</div>
                    <div className="text-[11px] text-gray-500">{KIND_LABEL[c.kind]}</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => void test(c)} aria-disabled={t?.state === 'testing'}>Test</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => edit(c)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeConnector(c.id)} aria-label={`Remove ${c.name}`}>Remove</button>
                </div>
                {c.kind !== 'command' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                    <input type="checkbox" checked={c.trustReads} onChange={(e) => upsertConnector({ ...c, trustReads: e.target.checked })} />
                    Don’t ask before read-only tools
                  </label>
                )}
                {t && <p className={`mt-2 break-words font-mono text-[11px] ${t.state === 'error' ? 'text-danger' : t.state === 'ok' ? 'text-accent' : 'text-gray-500'}`} role="status">{t.text}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {!draft && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="text-sm text-gray-100">Add a connector</div>
          <div className="flex gap-2">
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="input h-9 min-w-0 flex-1 text-sm" aria-label="Connector type">
              <option value="">Choose…</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!presetId} onClick={startNew}>Add</button>
          </div>
          {preset && <p className="text-xs text-gray-400">{preset.note}</p>}
        </div>
      )}

      {draft && (
        <form className="space-y-3 rounded-xl border border-[var(--accent-line)] p-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="text-sm font-medium text-gray-100">{draft.isNew ? 'New' : 'Edit'} · {KIND_LABEL[draft.kind]}</div>
          <Field label="Name" hint="The agent sees this tool prefix, so keep it short."><input className="input h-9 text-sm" value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
          {draft.kind === 'github' && <Field label="Token (optional)" hint="Without one, your GitHub sign-in is used. A fine-grained token with read-only access is enough."><input type="password" autoComplete="off" className="input h-9 font-mono text-xs" value={f.token ?? ''} onChange={(e) => set('token', e.target.value)} /></Field>}
          {draft.kind === 'web-search' && f.provider !== 'searxng' && <Field label={`${f.provider === 'brave' ? 'Brave' : 'Tavily'} API key`}><input type="password" autoComplete="off" className="input h-9 font-mono text-xs" value={f.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} /></Field>}
          {draft.kind === 'web-search' && f.provider === 'searxng' && <Field label="SearXNG URL"><input className="input h-9 font-mono text-xs" value={f.baseUrl ?? ''} onChange={(e) => set('baseUrl', e.target.value)} /></Field>}
          {draft.kind === 'sqlite' && <Field label="Database file" hint="Opened read-only. ~ means your home folder."><input className="input h-9 font-mono text-xs" value={f.path ?? ''} onChange={(e) => set('path', e.target.value)} placeholder="/path/to/data.db" /></Field>}
          {draft.kind === 'postgres' && <Field label="Connection string" hint="Queries run in a read-only transaction, but prefer a role that can only read."><input type="password" autoComplete="off" className="input h-9 font-mono text-xs" value={f.url ?? ''} onChange={(e) => set('url', e.target.value)} /></Field>}
          {draft.kind === 'mcp-stdio' && (
            <>
              <Field label="Command"><input className="input h-9 font-mono text-xs" value={f.command ?? ''} onChange={(e) => set('command', e.target.value)} placeholder="npx" /></Field>
              <Field label="Arguments" hint="Quote anything with spaces."><input className="input h-9 font-mono text-xs" value={f.args ?? ''} onChange={(e) => set('args', e.target.value)} /></Field>
              <Field label="Environment" hint="One KEY=value per line, for API keys the server needs."><textarea rows={3} className="input resize-none font-mono text-xs" value={f.env ?? ''} onChange={(e) => set('env', e.target.value)} /></Field>
            </>
          )}
          {draft.kind === 'mcp-http' && (
            <>
              <Field label="URL"><input className="input h-9 font-mono text-xs" value={f.url ?? ''} onChange={(e) => set('url', e.target.value)} /></Field>
              <Field label="Headers" hint="One Name: value per line, for example Authorization: Bearer …"><textarea rows={2} className="input resize-none font-mono text-xs" value={f.headers ?? ''} onChange={(e) => set('headers', e.target.value)} /></Field>
            </>
          )}
          {draft.kind === 'command' && (
            <>
              <Field label="Tool name" hint="Lowercase letters, digits and underscores."><input className="input h-9 font-mono text-xs" value={f.toolName ?? ''} onChange={(e) => set('toolName', e.target.value)} /></Field>
              <Field label="What it does" hint="The agent reads this to decide when to use it."><input className="input h-9 text-sm" value={f.toolDescription ?? ''} onChange={(e) => set('toolDescription', e.target.value)} /></Field>
              <Field label="Command"><input className="input h-9 font-mono text-xs" value={f.command ?? ''} onChange={(e) => set('command', e.target.value)} placeholder="npm" /></Field>
              <Field label="Arguments" hint="Use {{name}} where a parameter goes. Values are passed as plain arguments, never through a shell."><input className="input h-9 font-mono text-xs" value={f.toolArgs ?? ''} onChange={(e) => set('toolArgs', e.target.value)} placeholder="test -- {{pattern}}" /></Field>
              <Field label="Parameters" hint="One name: description per line."><textarea rows={2} className="input resize-none font-mono text-xs" value={f.params ?? ''} onChange={(e) => set('params', e.target.value)} placeholder="pattern: which tests to run" /></Field>
            </>
          )}
          {draft.kind !== 'command' && (
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={draft.trustReads} onChange={(e) => setDraft({ ...draft, trustReads: e.target.checked })} />
              Don’t ask before tools that only read
            </label>
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">{draft.isNew ? 'Add connector' : 'Save'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}

      {connectors.length > 0 && !draft && (
        <button className="btn btn-ghost btn-sm -ml-3" onClick={() => saveConnectors([])}>Remove all connectors</button>
      )}
    </div>
  );
}
