'use client';

import { useMemo, useState } from 'react';
import { agentBrief, applyFixes, audit, AREAS, type Area, type Finding } from '@/lib/optimize';
import { useActions } from '../actions';
import { useProposals } from '../proposals';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

const SITE_KEY = 'aha:site-url';
const readSite = () => {
  try {
    return localStorage.getItem(SITE_KEY) || 'https://example.com';
  } catch {
    return 'https://example.com';
  }
};

const tone = (score: number | null) => (score === null ? 'text-gray-500' : score >= 90 ? 'text-accent' : score >= 60 ? 'text-warn' : 'text-danger');

/** The Optimize tab: SEO, AEO, GEO, social, accessibility, mobile, speed and i18n, checked from the project's files, with fixes */
export function OptimizePanel({ onOpen }: { onOpen: (path: string) => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const proposals = useProposals();
  const actions = useActions();
  const { notify } = useToast();
  const [site, setSite] = useState(readSite);
  const [area, setArea] = useState<Area | 'all'>('all');
  const result = useMemo(() => audit(project.files, site.replace(/\/+$/, '')), [project.files, site]);
  const open = result.findings.filter((f) => f.status !== 'pass');
  const fixable = open.filter((f) => f.fix);
  const brief = agentBrief(result);
  const shown = result.findings.filter((f) => area === 'all' || f.area === area).sort((a, b) => ({ fail: 0, warn: 1, pass: 2 })[a.status] - ({ fail: 0, warn: 1, pass: 2 })[b.status]);

  const fix = (findings: Finding[]) => {
    const files = applyFixes(project.files, findings, site.replace(/\/+$/, ''));
    if (!Object.keys(files).length) return;
    saveSnapshot('Before Optimize fixes');
    dispatch({ type: 'put', files });
    notify({ kind: 'success', title: `Fixed ${findings.length === 1 ? findings[0].title : `${findings.length} checks`}`, detail: `Changed ${Object.keys(files).join(', ')}. The previous version is in History.` });
  };
  const ask = (goal: string, label: string) => {
    if (proposals.ask(goal, { label }) === null) actions.openPanel('agent');
  };

  if (result.kind === 'other' && !result.page)
    return (
      <div className="space-y-2 p-4">
        <h3 className="eyebrow">Optimize</h3>
        <p className="text-sm text-gray-400">This checks websites and web apps for search, answer and AI engines, social sharing, accessibility and speed. This project has no web pages yet: start one from Create → Gallery or Stack builder.</p>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Optimize</h3>
          <span className={`font-mono text-lg font-semibold ${tone(result.overall)}`} aria-label={`Overall score ${result.overall} of 100`}>
            {result.overall}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">How well search engines, answer engines and AI assistants can find, understand and quote this site, plus social cards, accessibility, mobile and speed. Checked from your files as you edit.</p>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Areas">
          {AREAS.map((a) => (
            <button key={a.id} aria-pressed={area === a.id} onClick={() => setArea(area === a.id ? 'all' : a.id)} title={`${a.name}: ${a.about}`} className={`rounded-md border px-1.5 py-1 text-center transition-colors ${area === a.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong'}`}>
              <span className="block text-[10px] text-gray-400">{a.short}</span>
              <span className={`block font-mono text-sm ${tone(result.scores[a.id])}`}>{result.scores[a.id] ?? '–'}</span>
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-[11px] text-gray-500">The site’s address (for canonical links, the sitemap and llms.txt)</span>
          <input
            value={site}
            onChange={(e) => {
              setSite(e.target.value);
              try {
                localStorage.setItem(SITE_KEY, e.target.value);
              } catch {}
            }}
            className="input mt-1 h-7 w-full font-mono text-xs"
            aria-label="Site address"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {fixable.length > 0 && (
            <button onClick={() => fix(fixable)} className="btn btn-primary btn-sm h-7">
              Fix {fixable.length} automatically
            </button>
          )}
          {brief && (
            <button onClick={() => ask(brief, 'Optimize for search, answers and AI')} className="btn btn-secondary btn-sm h-7">
              Ask the agent for the rest
            </button>
          )}
        </div>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Checks">
        {shown.map((f) => (
          <li key={f.id} className="space-y-1 px-4 py-2.5">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 text-xs ${f.status === 'pass' ? 'text-accent' : f.status === 'warn' ? 'text-warn' : 'text-danger'}`} aria-hidden="true">
                {f.status === 'pass' ? '✓' : f.status === 'warn' ? '!' : '✕'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-100">{f.title}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{AREAS.find((a) => a.id === f.area)!.short}</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  <span className="sr-only">{f.status}: </span>
                  {f.detail}
                </p>
                {f.status !== 'pass' && <p className="text-[11px] leading-snug text-gray-500">{f.why}</p>}
                {f.status !== 'pass' && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {f.fix && (
                      <button onClick={() => fix([f])} className="btn btn-secondary btn-sm h-6 text-[11px]">
                        Fix
                      </button>
                    )}
                    {f.brief && (
                      <button onClick={() => ask(f.brief!, `Optimize: ${f.title}`)} className="btn btn-ghost btn-sm h-6 text-[11px]">
                        Ask the agent
                      </button>
                    )}
                    {f.file && (
                      <button onClick={() => onOpen(f.file!)} className="btn btn-ghost btn-sm h-6 text-[11px]">
                        Open {f.file.split('/').pop()}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {open.length === 0 && <p className="border-t border-border p-4 text-xs text-accent">Every check passes.</p>}
    </div>
  );
}
