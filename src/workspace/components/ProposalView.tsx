'use client';

/**
 * A proposal, opened in the editor area like a file: what was asked, what the
 * agent did and the evidence for it, and the changes as a diff, with one
 * clear decision at the top. When the agent tried several approaches, each is
 * a lane you can switch between before accepting one.
 */

import { useEffect, useRef, useState } from 'react';
import { DiffView } from '@/components/CodeEditor';
import { chipsFor, type Tone } from '@/lib/agent/evidence';
import { riskOf, type RiskScore } from '@/lib/agent/risk';
import { supplyChainOf, useSupplyChainVersion } from '../supply-chain-client';
import { ChangeProof } from './ChangeProof';
import { ForkCompare } from './ForkCompare';
import { REVIEW_LABEL, reviewFollowUp, type Review } from '@/lib/agent/review';
import { problemOf } from '@/lib/agent/problems';
import type { ToolCall } from '@/lib/agent/types';
import { useActions } from '../actions';
import { languageFor } from '../project';
import { ago, laneOf, useProposals, verdict, type LogEntry, type Proposal } from '../proposals';
import { useWorkspace } from '../store';

const TONE: Record<Tone, string> = {
  good: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent',
  bad: 'border-danger/40 bg-danger/10 text-danger',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  neutral: 'border-border text-gray-400',
};

const RISK_TONE: Record<RiskScore['level'], string> = { low: TONE.good, medium: TONE.warn, high: TONE.bad };

/** The change's risk: a score with its reasons, biggest first */
function RiskChip({ risk }: { risk: RiskScore }) {
  return (
    <details className="relative">
      <summary className={`cursor-pointer list-none rounded-md border px-2 py-0.5 font-mono text-[11px] ${RISK_TONE[risk.level]}`} title="How risky this change is, and why">
        risk {risk.score} · {risk.level}
      </summary>
      <ul className="absolute left-0 top-7 z-20 w-80 space-y-1 rounded-lg border border-border-strong bg-[var(--panel)] p-2.5 text-xs shadow-2xl" aria-label="Why this risk">
        {risk.factors.map((f) => (
          <li key={f.label} className="flex gap-2">
            <span className={`w-8 shrink-0 text-right font-mono ${f.points > 0 ? 'text-warn' : f.points < 0 ? 'text-accent' : 'text-gray-500'}`}>{f.points > 0 ? `+${f.points}` : f.points}</span>
            <span className="min-w-0 text-gray-300">
              {f.label}
              {f.hold ? <span className="ml-1 text-[10px] uppercase tracking-wide text-warn">needs you</span> : null}
              <span className="block text-gray-500">{f.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const STATUS: Record<Proposal['status'], string> = {
  working: 'Working',
  review: 'Ready for review',
  accepted: 'Accepted',
  discarded: 'Discarded',
};

/** The one thing worth showing about a call: the path, query or first argument */
export function summarize(call: ToolCall): string {
  const args = call.args;
  const main = args.path ?? args.query ?? args.entry ?? args.action ?? args.steps ?? Object.values(args).find((v) => typeof v === 'string');
  const text = typeof main === 'string' ? main.replace(/\s+/g, ' ').trim() : '';
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function Plan({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  return (
    <section>
      <h3 className="eyebrow mb-1.5">Plan</h3>
      <ul className="space-y-1 text-sm text-gray-300">
        {lines.map((line, i) => {
          const done = /^\s*[-*]\s*\[[xX]\]/.test(line);
          return (
            <li key={i} className={done ? 'text-gray-500 line-through' : undefined}>
              <span aria-hidden="true" className="mr-1.5 font-mono text-xs">{done ? '✓' : '○'}</span>
              {line.replace(/^\s*[-*]\s*(\[[ xX]\])?\s*/, '')}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Activity({ log, lane, summary }: { log: LogEntry[]; lane?: string; summary?: string }) {
  const end = useRef<HTMLLIElement>(null);
  // A block body: newer browsers return a Promise from scrollIntoView, and an effect may only return its cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);
  return (
    <ol className="space-y-2" aria-label="What the agent did">
      {log.filter((e) => !(e.kind === 'agent' && summary && e.text === summary)).map((entry) =>
        entry.kind === 'you' ? (
          <li key={entry.id} className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-gray-100">
            {(entry.text ?? '').length > 240 ? (
              // A long task (a debugging brief, a worker task) folds to its first lines
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="line-clamp-2">{entry.text}</span>
                  <span className="mt-1 block text-xs text-gray-500">Show the whole task</span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-300">{entry.text}</p>
              </details>
            ) : (
              entry.text
            )}
          </li>
        ) : entry.kind === 'agent' ? (
          <li key={entry.id} className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.text?.replace(/\*\*/g, '')}</li>
        ) : entry.kind === 'notice' ? (
          <li key={entry.id} className="text-xs text-gray-500">{entry.text}</li>
        ) : (
          <li key={entry.id} className={entry.lane && lane && entry.lane !== lane ? 'opacity-50' : undefined}>
            <details className="rounded-lg border border-border bg-white/[0.02] text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 marker:hidden">
                <span
                  aria-label={entry.result ? (entry.result.ok ? 'succeeded' : 'failed') : 'running'}
                  className={`h-2 w-2 shrink-0 rounded-full ${entry.result ? (entry.result.ok ? 'bg-accent' : 'bg-danger') : 'animate-pulse bg-gray-500'}`}
                />
                <span className="font-mono text-xs text-gray-100">{entry.call?.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500">{entry.call && summarize(entry.call)}</span>
                {entry.lane && <span className="font-mono text-[10px] text-gray-500">{entry.lane}</span>}
                {entry.approved === false && <span className="badge px-1.5 py-0 text-[10px]">declined</span>}
              </summary>
              {entry.result && <pre className="max-h-48 overflow-auto border-t border-border px-2.5 py-2 font-mono text-[11px] leading-relaxed text-gray-400">{entry.result.content}</pre>}
            </details>
          </li>
        )
      )}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function ReviewChip({ review }: { review: NonNullable<Proposal['lanes'][number]['review']> }) {
  if (review.status === 'running') {
    return <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-gray-400"><span className="dot mr-1 animate-pulse text-accent" aria-hidden="true" />reviewing…</span>;
  }
  if (review.status === 'error') return <span title={review.error} className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${TONE.neutral}`}>no review</span>;
  const tone = review.verdict === 'approve' ? TONE.good : review.verdict === 'block' ? TONE.bad : TONE.warn;
  const count = review.findings.filter((f) => f.severity !== 'minor').length;
  return (
    <span title={review.summary} className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${tone}`}>
      {review.verdict === 'approve' ? 'reviewer ✓' : `reviewer: ${count || review.findings.length} ${review.verdict === 'block' ? 'blocking' : 'to fix'}`}
    </span>
  );
}

const SEVERITY_TONE: Record<string, string> = { blocker: 'text-danger', major: 'text-warn', minor: 'text-gray-400' };

/** The second reviewer's findings, each one a click from its file, all of them a click from the agent */
function SecondOpinion({ review, settled, onPick, onSend }: { review: Review; settled: boolean; onPick: (path: string) => void; onSend: (text: string) => void }) {
  return (
    <section aria-label="Second opinion">
      <h3 className="eyebrow mb-1">Second opinion</h3>
      <p className={`text-xs ${review.verdict === 'approve' ? 'text-accent' : review.verdict === 'block' ? 'text-danger' : 'text-warn'}`}>
        {REVIEW_LABEL[review.verdict]}{review.summary ? `: ${review.summary}` : ''}
      </p>
      {review.findings.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {review.findings.map((f, i) => (
            <li key={i} className="text-xs">
              <div className="flex items-start gap-1.5">
                <span className={`shrink-0 font-mono text-[10px] uppercase ${SEVERITY_TONE[f.severity]}`}>{f.severity}</span>
                <div className="min-w-0">
                  {f.file && (
                    <button onClick={() => onPick(f.file!)} className="font-mono text-[11px] text-gray-400 hover:text-gray-100">
                      {f.file}{f.line ? `:${f.line}` : ''}
                    </button>
                  )}
                  <p className="text-gray-200">{f.issue}</p>
                  {f.fix && <p className="text-gray-500">Fix: {f.fix}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!settled && review.findings.length > 0 && (
        <button onClick={() => onSend(reviewFollowUp(review))} className="btn btn-secondary btn-sm mt-2 h-6">✦ Send to the agent</button>
      )}
    </section>
  );
}

export function ProposalView({ proposal }: { proposal: Proposal }) {
  const { stop, answer, accept, discard, selectLane, followUp, close } = useProposals();
  const workspace = useWorkspace();
  const { settings } = workspace;
  const actions = useActions();
  const lane = laneOf(proposal);
  const files = lane?.files ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // Forked proposals open on the side-by-side comparison
  const [comparing, setComparing] = useState(!!proposal.fork);
  const selected = files.find((f) => f.path === picked) ?? files[0];
  const working = proposal.status === 'working';
  const settled = proposal.status === 'accepted' || proposal.status === 'discarded';
  const evidence = lane?.evidence;
  const judged = evidence ? verdict(evidence) : null;
  useSupplyChainVersion();
  const supply = working || !files.length ? null : supplyChainOf(files);
  const risk = working || !files.length ? null : riskOf({ files, evidence, review: lane?.review?.status === 'done' ? lane.review : null, supplyChain: supply?.findings });
  const project = files.filter((f) => !f.path.startsWith('agent/') && f.path !== 'AGENTS.md');
  const problem = working ? null : problemOf(proposal.outcome?.reason === 'finished' ? undefined : proposal.outcome?.summary);

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={`Proposal: ${proposal.goal}`}>
      {/* Decision bar */}
      <header className="shrink-0 space-y-2.5 border-b border-border px-5 py-3.5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className={working ? 'text-gray-300' : settled ? 'text-gray-500' : 'text-accent'}>
                {working && <span className="mr-1.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-gray-600 border-t-gray-100 align-[-1px]" aria-hidden="true" />}
                {proposal.pending ? 'Waiting for you' : problem ? 'Couldn’t start' : STATUS[proposal.status]}
                {working && proposal.step ? ` · step ${proposal.step}` : ''}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate font-mono">{proposal.model}</span>
              <span aria-hidden="true">·</span>
              <span>{ago(proposal.createdAt)}</span>
              {proposal.auto && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className={proposal.auto.accepted ? 'text-accent' : 'text-warn'} title="Auto-accept">
                    {proposal.auto.accepted ? `auto-accepted (risk ${proposal.auto.score})` : `waits for you: ${proposal.auto.why.replace(/^Held for you: /, '')}`}
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-0.5 text-[17px] font-medium leading-snug text-gray-100">{proposal.goal}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {working ? (
              <button className="btn btn-secondary btn-sm" onClick={() => stop(proposal.id)}>Stop</button>
            ) : !settled && files.length > 0 ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => discard(proposal.id)}>Discard</button>
                {judged?.verified && !(lane?.review?.status === 'done' && lane.review.verdict === 'block') && !supply?.findings.length ? (
                  <button className="btn btn-primary btn-sm" onClick={() => accept(proposal.id)} title="Apply every change to your files. The current version is saved to History first.">
                    Ship {files.length} change{files.length > 1 ? 's' : ''}
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => accept(proposal.id)} title="Apply every change to your files. The current version is saved to History first.">
                    Accept anyway
                  </button>
                )}
              </>
            ) : null}
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => close(proposal.id)} aria-label="Close proposal" title="Close (it stays in the Agent tab)">✕</button>
          </div>
        </div>

        {(evidence || judged) && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Evidence">
            {judged && (
              <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${judged.verified ? TONE.good : TONE.warn}`}>
                {judged.verified ? '✓ ' : ''}{judged.headline}
              </span>
            )}
            {risk && <RiskChip risk={risk} />}
            {lane?.review && <ReviewChip review={lane.review} />}
            {evidence &&
              chipsFor(evidence).map((chip) => (
                <span key={chip.label} title={chip.detail} className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${TONE[chip.tone]}`}>
                  {chip.label}
                </span>
              ))}
          </div>
        )}
        {supply && (supply.findings.length > 0 || supply.pending) && (
          <div role="note" aria-label="Supply chain" className={`rounded-xl border px-4 py-2.5 text-sm ${supply.findings.length ? 'border-amber-400/30 bg-amber-400/[0.06]' : 'border-border'}`}>
            {supply.findings.length ? (
              <>
                <p className="font-medium text-gray-100">Check the new dependencies before you accept</p>
                <ul className="mt-1 space-y-0.5 text-gray-400">
                  {supply.findings.map((f) => (
                    <li key={`${f.kind}:${f.name}`}>
                      <span className="text-warn">●</span> {f.detail}
                    </li>
                  ))}
                </ul>
                {supply.pending && <p className="mt-1 text-xs text-gray-500">Still asking the registry about the rest…</p>}
              </>
            ) : (
              <p className="text-xs text-gray-500">Checking {supply.checked} new dependenc{supply.checked > 1 ? 'ies' : 'y'} with the registry…</p>
            )}
          </div>
        )}
        {problem ? (
          <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-100">{problem.title}</p>
              <p className="mt-0.5 text-sm text-gray-400">{problem.detail}</p>
              <details className="mt-1.5 text-xs text-gray-500">
                <summary className="cursor-pointer">What the provider said</summary>
                <p className="mt-1 whitespace-pre-wrap">{proposal.outcome?.summary}</p>
              </details>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {problem.kind !== 'network' && (
                <button className="btn btn-primary btn-sm" onClick={() => actions.openSettings('ai')}>
                  {problem.kind === 'key' ? 'Fix key' : 'Choose a model'}
                </button>
              )}
              <button className={`btn btn-sm ${problem.kind === 'network' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => followUp(proposal.id, 'Try again.')}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          proposal.outcome && !working && <p className="max-w-4xl whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{proposal.outcome.summary}</p>
        )}
      </header>

      {/* Approaches */}
      {proposal.lanes.length > 1 && (
        <div role="tablist" aria-label="Approaches" className="flex shrink-0 gap-2 overflow-x-auto border-b border-border px-5 py-2.5">
          {proposal.fork && (
            <button onClick={() => setComparing((v) => !v)} aria-pressed={comparing} className={`shrink-0 self-center rounded-lg border px-3 py-2 text-sm ${comparing ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-border text-gray-300 hover:border-border-strong'}`} title="See every version side by side">
              ⑂ Side by side
            </button>
          )}
          {proposal.lanes.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={l.id === lane?.id}
              onClick={() => {
                selectLane(proposal.id, l.id);
                setComparing(false);
              }}
              className={`min-w-[10rem] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${l.id === lane?.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong'}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-gray-100">{l.label}</span>
                {l.recommended && <span className="rounded bg-[var(--color-accent)] px-1 text-[10px] font-medium text-[var(--color-accent-fg)]">best</span>}
                <span className="ml-auto font-mono text-xs text-gray-400">{l.status === 'running' ? `step ${l.steps}…` : l.score !== undefined ? `${l.score}/100` : ''}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-gray-500">{l.scoreNotes?.join(' · ') || (l.status === 'running' ? 'working' : `${l.files.length} file${l.files.length === 1 ? '' : 's'}`)}</div>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Changes */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {comparing && proposal.fork ? (
            <ForkCompare
              proposal={proposal}
              files={workspace.project.files}
              onPick={(laneId) => {
                selectLane(proposal.id, laneId);
                setComparing(false);
              }}
            />
          ) : files.length > 0 ? (
            <>
              <ul className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-1.5" aria-label="Changed files">
                {files.map((f) => (
                  <li key={f.path} className={`group flex shrink-0 items-center rounded-md ${f.path === selected?.path ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                    <button onClick={() => setPicked(f.path)} aria-current={f.path === selected?.path} className="flex items-center gap-1.5 px-2 py-1 font-mono text-xs text-gray-200">
                      <span className={f.kind === 'deleted' ? 'text-danger' : f.kind === 'added' ? 'text-accent' : 'text-gray-500'} aria-label={f.kind}>{f.kind === 'deleted' ? '−' : f.kind === 'added' ? '+' : '~'}</span>
                      {f.path}
                      <span className="text-gray-500">+{f.added} −{f.removed}</span>
                    </button>
                    {!working && !settled && (
                      <span className="flex pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <button onClick={() => accept(proposal.id, [f.path])} className="rounded px-1 text-[11px] text-gray-400 hover:text-accent" aria-label={`Accept ${f.path}`} title="Accept this file">✓</button>
                        <button onClick={() => discard(proposal.id, [f.path])} className="rounded px-1 text-[11px] text-gray-400 hover:text-danger" aria-label={`Reject ${f.path}`} title="Reject this file">✕</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="min-h-[16rem] flex-1">
                {selected && <DiffView key={`${lane?.id}:${selected.path}`} original={selected.before} modified={selected.after} language={languageFor(selected.path)} theme={settings.theme} fontSize={settings.fontSize} />}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500">
              {working
                ? 'Changes appear here as the agent makes them. Nothing touches your files until you accept.'
                : settled
                  ? `This proposal was ${proposal.status}.`
                  : problem
                    ? 'No changes: the agent stopped before it could start on your project.'
                    : proposal.outcome?.reason === 'finished'
                      ? 'No changes needed: the agent answered without editing files (its answer is above).'
                      : `No changes: the run ended early (${proposal.outcome?.reason ?? 'stopped'}).`}
            </div>
          )}
          {project.length < files.length && (
            <p className="shrink-0 border-t border-border px-4 py-1.5 text-[11px] text-gray-500">Includes changes to the agent&apos;s own instructions (AGENTS.md, agent/): what made this approach work, kept for next time.</p>
          )}
        </div>

        {/* Story */}
        <aside className={`min-h-0 w-full shrink-0 flex-col border-t border-border lg:w-[22rem] lg:border-l lg:border-t-0 ${comparing && proposal.fork ? 'hidden' : 'flex'}`} aria-label="Plan and activity">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {proposal.pending && (
              <div role="alertdialog" aria-label="Allow this action?" className="space-y-2 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-3">
                <div className="text-sm font-medium text-gray-100">{proposal.pending.risk === 'exec' ? 'Run a command on this machine?' : 'Use a connector?'}</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-xs text-gray-200">{proposal.pending.call.name} {JSON.stringify(proposal.pending.call.args, null, 1)}</pre>
                <div className="flex flex-wrap gap-1.5">
                  <button className="btn btn-primary btn-sm" onClick={() => answer(proposal.id, true)}>Allow once</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => answer(proposal.id, true, true)}>Allow for this task</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => answer(proposal.id, false)}>Decline</button>
                </div>
              </div>
            )}
            {lane?.review?.status === 'done' && !working && (
              <SecondOpinion review={lane.review} settled={settled} onPick={setPicked} onSend={(text) => followUp(proposal.id, text)} />
            )}
            {!working && !settled && project.length > 0 && lane && <ChangeProof id={`${proposal.id}:${lane.id}`} changes={project} onPick={setPicked} />}
            <Plan text={proposal.plan} />
            {proposal.lessons.length > 0 && (
              <section>
                <h3 className="eyebrow mb-1">Lessons for next time</h3>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-300">{proposal.lessons.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </section>
            )}
            <section>
              <h3 className="eyebrow mb-1.5">Activity</h3>
              <Activity log={proposal.log} lane={proposal.lanes.length > 1 ? lane?.id : undefined} summary={working ? undefined : proposal.outcome?.summary} />
            </section>
          </div>
          {!settled && (
            <form
              className="shrink-0 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!message.trim()) return;
                followUp(proposal.id, message);
                setMessage('');
              }}
            >
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={working}
                placeholder={working ? 'The agent is working…' : 'Ask for changes to this proposal'}
                aria-label="Follow-up for the agent"
                className="input h-9 text-sm"
              />
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
