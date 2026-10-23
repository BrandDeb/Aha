'use client';

import { useMemo, useState } from 'react';
import { CONTRACT_EXAMPLES, CONTRACTS_FILE, contractsOf, describeContracts, serializeContracts, type Contract, type ContractKind } from '@/lib/contracts';
import { findFunctions, parseSpec, specFiles, specPrompt, specSuggestions } from '@/lib/specs';
import { useActions } from '../actions';
import { useContracts, type ContractView } from '../contracts-client';
import { useProposals } from '../proposals';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

const KIND_LABEL: Record<ContractKind, string> = { forbid: 'never', require: 'always', command: 'passes' };

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** The Contracts tab: rules that stay true, how each one stands, and the agent to fix what breaks */
export function ContractsPanel({ onOpen }: { onOpen: (path: string, line?: number) => void }) {
  const { project, dispatch } = useWorkspace();
  const actions = useActions();
  const proposals = useProposals();
  const { notify } = useToast();
  const { contracts, error, views, counts, running, checkAll } = useContracts(project.name, project.files);
  const [adding, setAdding] = useState(false);
  const [describe, setDescribe] = useState('');

  const save = (next: Contract[]) => {
    dispatch({ type: 'put', files: { [CONTRACTS_FILE]: serializeContracts(next) } });
  };
  const add = (contract: Omit<Contract, 'id'>) => {
    const parsed = contractsOf({ [CONTRACTS_FILE]: serializeContracts([...contracts, { ...contract, id: '' }]) });
    if (parsed.error) return notify({ kind: 'error', title: 'That contract has a problem', detail: parsed.error });
    save(parsed.contracts);
    setAdding(false);
  };
  const remove = (id: string) => save(contracts.filter((c) => c.id !== id));

  const ask = (goal: string, label: string) => {
    if (proposals.ask(goal, { label }) === null) actions.openPanel('agent');
  };
  const fix = (v: ContractView) =>
    ask(
      `A contract of this project is broken. Make it hold again by fixing the code, not by changing the contract.\n\n${describeContracts([v])}\n\nKeep the change small, then run check_contracts to prove every contract holds.`,
      `Contract · ${v.rule}`
    );
  const write = () => {
    const text = describe.trim();
    if (!text) return;
    ask(
      `Add a contract to ${CONTRACTS_FILE} (create it if needed) that enforces: "${text}".\n\nThe file is { "contracts": [ ... ] }; each contract has a "rule" (the sentence above, tidied), a "kind" and its check:\n- "forbid": "pattern" (a regular expression that must not match), optional "files" glob\n- "require": "pattern" that must match in every file the "files" glob selects\n- "command": "command" that must exit 0 (run in the project folder), optional "expect" regex its output must match\nPrefer a pattern when one can express the rule exactly; use a command (a test, a type check, a script you add) when it needs running code. Keep the existing contracts unchanged. Then run check_contracts and report whether the project already keeps the new rule.`,
      `New contract · ${text.slice(0, 40)}`
    );
    setDescribe('');
  };
  const runChecks = async () => {
    const results = await checkAll();
    const failed = results.filter((r) => r.status === 'fail').length;
    notify(failed ? { kind: 'error', title: `${failed} contract${failed > 1 ? 's' : ''} broken`, detail: 'Each one can go to the agent to fix.' } : { kind: 'success', title: 'Every contract holds' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Contracts</h3>
          {contracts.length > 0 && (
            <button onClick={() => void runChecks()} disabled={running} className="btn btn-primary btn-sm h-6">
              {running ? 'Checking…' : 'Check all'}
            </button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          Rules that stay true. The agent is told every one, checks them before it finishes, and a proposal that breaks one is never marked verified.
        </p>
        {contracts.length > 0 && (
          <p role="status" className={`text-xs ${counts.fail ? 'text-danger' : 'text-accent'}`}>
            {counts.fail ? `${counts.fail} of ${views.length} broken` : `${counts.pass} of ${views.length} hold`}
            {counts.skip ? <span className="text-gray-500"> · {counts.skip} not checked</span> : null}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="space-y-2 border-b border-border p-4">
            <p className="text-sm text-danger">{error}</p>
            <button onClick={() => dispatch({ type: 'open', path: CONTRACTS_FILE })} className="btn btn-secondary btn-sm">Open {CONTRACTS_FILE}</button>
          </div>
        )}

        {views.length > 0 && !error && (
          <ul className="divide-y divide-border" aria-label="Contracts">
            {views.map((v) => {
              const c = contracts.find((x) => x.id === v.id);
              const tone = v.stale ? 'text-gray-500' : v.status === 'pass' ? 'text-accent' : v.status === 'fail' ? 'text-danger' : 'text-gray-500';
              return (
                <li key={v.id} className="group space-y-1.5 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 text-xs ${tone}`} aria-hidden="true">{v.status === 'pass' ? '✓' : v.status === 'fail' ? '✕' : '○'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-100">{v.rule}</div>
                      <div className="truncate font-mono text-[11px] text-gray-500" title={c?.command ?? c?.pattern}>
                        {KIND_LABEL[v.kind]} · {c?.kind === 'command' ? c.command : `/${c?.pattern}/`}{c?.files ? ` in ${c.files}` : ''}
                      </div>
                      <div className={`text-[11px] ${v.status === 'fail' && !v.stale ? 'text-danger' : 'text-gray-500'}`}>
                        <span className="sr-only">{v.status}: </span>
                        {v.detail.split('\n')[0]}
                        {v.at ? ` · ${ago(v.at)}` : ''}
                        {v.stale ? ' · before your latest changes' : ''}
                      </div>
                    </div>
                    <button onClick={() => remove(v.id)} className="text-xs text-gray-600 opacity-0 hover:text-gray-100 focus:opacity-100 group-hover:opacity-100" aria-label={`Remove contract: ${v.rule}`}>✕</button>
                  </div>
                  {v.status === 'fail' && !v.stale && (
                    <>
                      {v.where?.length ? (
                        <ul className="space-y-0.5 pl-5">
                          {v.where.slice(0, 6).map((w, i) => (
                            <li key={i}>
                              <button onClick={() => onOpen(w.path, w.line)} className="max-w-full truncate text-left font-mono text-[11px] text-gray-400 hover:text-gray-100">
                                {w.path}{w.line ? `:${w.line}` : ''}{w.text ? `  ${w.text}` : ''}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : v.detail.includes('\n') ? (
                        <pre className="ml-5 max-h-28 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] text-gray-400">{v.detail.split('\n').slice(1).join('\n')}</pre>
                      ) : null}
                      <button onClick={() => fix(v)} className="btn btn-secondary btn-sm ml-5 h-6">✦ Fix with the agent</button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <SpecSection
          files={project.files}
          onAdd={(files, rule, test) => {
            dispatch({ type: 'put', files });
            notify({ kind: 'success', title: `Property test added: ${rule}`, detail: `${test} tries hundreds of random inputs; its contract runs it. Press Check all to run it now.` });
          }}
          onAsk={ask}
        />

        <section className="space-y-2 border-b border-border p-4" aria-label="Add a contract">
          <h3 className="eyebrow">{contracts.length ? 'Add a rule' : 'Your first rule'}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              write();
            }}
            className="space-y-2"
          >
            <input
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              placeholder="Describe it: “every API route checks the session”"
              aria-label="Describe a rule for the agent to write"
              className="input h-8 text-xs"
            />
            <button type="submit" disabled={!describe.trim()} className="btn btn-secondary btn-sm w-full">✦ Have the agent write it</button>
          </form>
          {!contracts.length && (
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500">Or start from one of these:</p>
              {CONTRACT_EXAMPLES.map((example) => (
                <button key={example.rule} onClick={() => add(example)} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-gray-300 hover:bg-white/5">
                  + {example.rule}
                </button>
              ))}
            </div>
          )}
          {adding ? <ContractForm onAdd={add} onCancel={() => setAdding(false)} /> : (
            <button onClick={() => setAdding(true)} className="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-100 hover:underline">Write one by hand</button>
          )}
        </section>
      </div>
    </div>
  );
}

function ContractForm({ onAdd, onCancel }: { onAdd: (c: Omit<Contract, 'id'>) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<ContractKind>('forbid');
  const [rule, setRule] = useState('');
  const [check, setCheck] = useState('');
  const [files, setFiles] = useState('');
  const [expect, setExpect] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ rule, kind, ...(kind === 'command' ? { command: check } : { pattern: check }), ...(files.trim() && kind !== 'command' ? { files: files.trim() } : {}), ...(expect.trim() && kind === 'command' ? { expect: expect.trim() } : {}) });
      }}
      className="space-y-2 rounded border border-border p-2"
      aria-label="New contract"
    >
      <input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="The rule, in words" aria-label="Rule" required className="input h-8 text-xs" />
      <div role="radiogroup" aria-label="Kind" className="flex gap-1">
        {(['forbid', 'require', 'command'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`btn btn-sm h-6 flex-1 ${kind === k ? 'btn-secondary' : 'btn-ghost'}`}>
            {k === 'forbid' ? 'Never appears' : k === 'require' ? 'Always appears' : 'Command passes'}
          </button>
        ))}
      </div>
      <input
        value={check}
        onChange={(e) => setCheck(e.target.value)}
        placeholder={kind === 'command' ? 'npm test' : 'A regular expression, e.g. console\\.log\\('}
        aria-label={kind === 'command' ? 'Command' : 'Pattern'}
        required
        spellCheck={false}
        className="input h-8 font-mono text-xs"
      />
      {kind === 'command' ? (
        <input value={expect} onChange={(e) => setExpect(e.target.value)} placeholder="Output must match (optional regex)" aria-label="Expected output" spellCheck={false} className="input h-8 font-mono text-xs" />
      ) : (
        <input value={files} onChange={(e) => setFiles(e.target.value)} placeholder="In files (glob, default: all code), e.g. src/**/*.ts" aria-label="Files" spellCheck={false} className="input h-8 font-mono text-xs" />
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm flex-1">Add contract</button>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </form>
  );
}

const KIND_TEXT: Record<string, string> = {
  'never-throws': 'never throws',
  deterministic: 'same input, same answer',
  idempotent: 'twice is the same as once',
  'length-preserved': 'keeps the number of items',
  sorted: 'ascending order',
  'non-negative': 'never negative',
  commutative: 'argument order doesn’t matter',
  'round-trip': 'round trip',
  'in-range': 'stays in range',
};

/** Specs: a sentence about a function becomes a property-based test and the contract that runs it */
function SpecSection({ files, onAdd, onAsk }: { files: Record<string, string>; onAdd: (files: Record<string, string>, rule: string, test: string) => void; onAsk: (goal: string, label: string) => void }) {
  const [text, setText] = useState('');
  const fns = useMemo(() => findFunctions(files), [files]);
  const suggestions = useMemo(() => specSuggestions(fns, 6), [fns]);
  const spec = text.trim() ? parseSpec(text, fns) : null;
  const tool = spec?.fn.lang === 'py' ? 'Hypothesis' : 'fast-check';
  const submit = () => {
    if (!text.trim()) return;
    if (spec) {
      const out = specFiles(spec, files);
      onAdd(out.files, spec.rule, out.test);
    } else onAsk(specPrompt(text, fns), `Spec · ${text.trim().slice(0, 40)}`);
    setText('');
  };
  return (
    <section className="space-y-2 border-b border-border p-4" aria-label="Specs">
      <h3 className="eyebrow">Specs</h3>
      <p className="text-xs leading-relaxed text-gray-400">Say what must always be true about a function. It becomes a property test that throws hundreds of random inputs at it, and a contract that runs it on every change.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={suggestions[0] ? `“${suggestions[0]}”` : '“sortPrices keeps the number of items”'} aria-label="A spec, in your words" className="input h-8 text-xs" />
        {text.trim() && (
          <p className="text-[11px] text-gray-500" role="status">
            {spec ? (
              <>
                <span className="text-accent">✓ {KIND_TEXT[spec.kind]}</span> · <span className="font-mono">{spec.fn.name}</span>
                {spec.partner ? <> ↔ <span className="font-mono">{spec.partner.name}</span></> : null} in {spec.fn.file} · {tool}, 200 random cases
              </>
            ) : (
              'Not one of the common properties (or no function named): the agent will write the test.'
            )}
          </p>
        )}
        <button type="submit" disabled={!text.trim()} className="btn btn-secondary btn-sm w-full">{spec || !text.trim() ? 'Add the property test' : '✦ Have the agent write it'}</button>
      </form>
      {!text && suggestions.length > 0 && (
        <div className="space-y-0.5" aria-label="Suggested specs">
          <p className="text-[11px] text-gray-500">From your functions:</p>
          {suggestions.map((s) => (
            <button key={s} onClick={() => setText(s)} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-gray-300 hover:bg-white/5">
              + {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
