'use client';

/**
 * Talking to /api/connectors from the browser, and turning a connector's tools
 * into agent tools. The model sees each tool as `<connector>__<tool>`.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Risk, Tool, ToolResult } from '@/lib/agent/types';
import { slugify, type Connector, type ConnectorTool } from '../lib/connectors/types.ts';

export interface ConnectorStatus {
  mode: 'off' | 'local' | 'hosted';
  node: string;
  sqlite: boolean;
}

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error('Could not reach the studio server.');
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || `The server answered ${response.status}`);
  return data;
}

export async function listConnectorTools(connector: Connector, signal?: AbortSignal): Promise<ConnectorTool[]> {
  return (await post<{ tools: ConnectorTool[] }>({ action: 'tools', connector }, signal)).tools;
}

export async function callConnectorTool(connector: Connector, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  try {
    const data = await post<{ text: string; isError: boolean }>({ action: 'call', connector, tool, args }, signal);
    return { ok: !data.isError, content: data.text };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return { ok: false, content: (error as Error).message };
  }
}

export function useConnectorStatus(): { status: ConnectorStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/api/connectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => live && setStatus(data))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [tick]);
  return { status, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

/** The model-facing name: letters, digits, underscore and dash, at most 64 characters, unique within the run */
export function toolName(connectorName: string, tool: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = slugify(connectorName);
  let name = `${prefix}__${clean(tool)}`.slice(0, 64);
  for (let n = 2; taken.has(name); n++) name = `${`${prefix}__${clean(tool)}`.slice(0, 60)}_${n}`;
  taken.add(name);
  return name;
}

/** How a connector's tool is treated by the approval policy */
export function riskFor(connector: Connector, tool: ConnectorTool): Risk {
  if (connector.kind === 'command') return 'exec';
  return tool.readOnly && connector.trustReads ? 'read' : 'external';
}

export interface ConnectorTools {
  tools: Tool[];
  /** Connectors that are connected, with how many tools each added */
  connected: { name: string; tools: number }[];
  failed: { name: string; error: string }[];
}

/** Connect to every enabled connector (in parallel) and wrap their tools for the agent */
export async function buildConnectorTools(connectors: Connector[], signal?: AbortSignal): Promise<ConnectorTools> {
  const result: ConnectorTools = { tools: [], connected: [], failed: [] };
  const taken = new Set<string>();
  const listed = await Promise.all(
    connectors
      .filter((c) => c.enabled)
      .map(async (connector) => {
        try {
          const timeout = AbortSignal.timeout(30_000);
          const tools = await listConnectorTools(connector, signal ? AbortSignal.any([signal, timeout]) : timeout);
          return { connector, tools };
        } catch (error) {
          if (signal?.aborted) throw error;
          const message = (error as Error).name === 'TimeoutError' ? 'It did not answer within 30 seconds.' : (error as Error).message;
          return { connector, tools: null, error: message };
        }
      })
  );
  for (const item of listed) {
    if (!item.tools) {
      result.failed.push({ name: item.connector.name, error: item.error ?? 'Failed' });
      continue;
    }
    const { connector } = item;
    result.connected.push({ name: connector.name, tools: item.tools.length });
    for (const tool of item.tools) {
      result.tools.push({
        name: toolName(connector.name, tool.name, taken),
        description: `[${connector.name}] ${tool.description || tool.name}`,
        parameters: tool.inputSchema as Tool['parameters'],
        risk: riskFor(connector, tool),
        run: (args, { signal: callSignal }) => callConnectorTool(connector, tool.name, args, callSignal),
      });
    }
  }
  return result;
}
