'use client';

/**
 * Deploy & run, like Remix IDE: compile Solidity in the browser at the pragma's version, deploy to a chain that
 * lives in the page (ten funded accounts, no node, no wallet), and call every function from a form generated from
 * the ABI: reads show their result, writes show gas, events and decoded revert reasons. A quick static analysis
 * lists the usual pitfalls. Anything that fails can go to the agent with the details.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeProject, type Finding } from '@/lib/web3/analyze';
import type { AbiItem, AbiParam, CompiledContract, CompilerSettings } from '@/lib/web3/solc';
import { deployable, solidityEntries } from '@/lib/web3/solc';
import type { Instance, LocalChain, TxRecord, WalletChain } from '@/lib/web3/chain';
import { useActions } from '../actions';
import { useProposals } from '../proposals';
import { useWorkspace } from '../store';
import { compileProject, solcReleases, type CompileResult } from '../web3-client';

type ChainModule = typeof import('@/lib/web3/chain');

const EVM_VERSIONS = ['', 'prague', 'cancun', 'shanghai', 'paris', 'london'];
const SEVERITY: Record<Finding['severity'], string> = { high: 'text-danger', medium: 'text-warn', low: 'text-gray-300', info: 'text-gray-500' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const sig = (f: AbiItem) => `${f.name ?? ''}(${(f.inputs ?? []).map((i) => i.type).join(',')})`;

function Section({ title, right, children, open = true }: { title: string; right?: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5">
        <span className="text-gray-500 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        <h3 className="eyebrow flex-1">{title}</h3>
        {right}
      </summary>
      <div className="space-y-2 px-4 pb-4">{children}</div>
    </details>
  );
}

/** Inputs for a function's parameters, one per parameter, named and typed */
function Params({ params, values, onChange }: { params: AbiParam[]; values: string[]; onChange: (values: string[]) => void }) {
  return (
    <div className="space-y-1">
      {params.map((p, i) => (
        <input
          key={i}
          value={values[i] ?? ''}
          onChange={(e) => onChange(params.map((_, j) => (j === i ? e.target.value : (values[j] ?? ''))))}
          placeholder={`${p.name || `arg${i}`}: ${p.type}${/^u?int/.test(p.type) ? ' (or "1 ether")' : p.type.endsWith(']') ? ' (JSON array)' : ''}`}
          aria-label={`${p.name || `arg${i}`} (${p.type})`}
          spellCheck={false}
          className="input h-7 w-full font-mono text-[11px]"
        />
      ))}
    </div>
  );
}

function FunctionRow({ fn, run, last }: { fn: AbiItem; run: (fn: AbiItem, args: string[]) => void; last?: TxRecord }) {
  const [args, setArgs] = useState<string[]>([]);
  const read = fn.stateMutability === 'view' || fn.stateMutability === 'pure';
  const tone = read ? 'border-[var(--accent-line)] text-accent' : fn.stateMutability === 'payable' ? 'border-danger/50 text-danger' : 'border-warn/50 text-warn';
  return (
    <li className="space-y-1">
      <div className="flex items-start gap-2">
        <button onClick={() => run(fn, args)} className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] hover:bg-white/5 ${tone}`} title={`${sig(fn)} · ${fn.stateMutability}${read ? ' · read, free' : ' · transaction'}`}>
          {fn.name}
        </button>
        <div className="min-w-0 flex-1">{fn.inputs?.length ? <Params params={fn.inputs} values={args} onChange={setArgs} /> : null}</div>
      </div>
      {last && (
        <div className={`ml-1 break-all rounded bg-black/30 px-2 py-1 font-mono text-[10px] ${last.ok ? 'text-gray-300' : 'text-danger'}`} role="status">
          {last.ok ? (read ? `→ ${display(last.result)}` : `✓ gas ${last.gasUsed}${last.events.length ? ` · ${last.events.map((e) => e.name).join(', ')}` : ''}`) : `✕ ${last.error}`}
        </div>
      )}
    </li>
  );
}

let chainModule: ChainModule | null = null;
const display = (v: unknown) => (chainModule ? chainModule.showValue(Array.isArray(v) && v.length === 1 ? v[0] : v) : String(v));

export function Web3Panel({ onOpen }: { onOpen: (file: string, line?: number) => void }) {
  const { project } = useWorkspace();
  const actions = useActions();
  const proposals = useProposals();
  const files = project.files;
  const entries = useMemo(() => solidityEntries(files), [files]);

  const [releases, setReleases] = useState<string[]>([]);
  const [settings, setSettings] = useState<Partial<CompilerSettings>>({ optimize: true, runs: 200, evmVersion: '' });
  const [result, setResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [autoCompile, setAutoCompile] = useState(true);

  // Where contracts go: the chain in the page, or a real network through the browser wallet
  const [env, setEnv] = useState<'local' | 'wallet'>('local');
  const local = useRef<LocalChain | null>(null);
  const wallet = useRef<WalletChain | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const chain = env === 'wallet' ? wallet : local;
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [account, setAccount] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [value, setValue] = useState('0');
  const [unit, setUnit] = useState<'wei' | 'gwei' | 'ether'>('wei');
  const [picked, setPicked] = useState('');
  const [ctorArgs, setCtorArgs] = useState<string[]>([]);
  const [lastByFn, setLastByFn] = useState<Record<string, TxRecord>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    solcReleases().then(setReleases, () => setReleases([]));
  }, []);

  const compile = async () => {
    if (!entries.length) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const r = await compileProject(files, settings);
      setResult(r);
      const first = deployable(r.contracts, files)[0];
      setPicked((p) => (p && r.contracts.some((c) => `${c.file}:${c.name}` === p) ? p : first ? `${first.file}:${first.name}` : ''));
    } catch (error) {
      setCompileError((error as Error).message);
    } finally {
      setCompiling(false);
    }
  };
  const compileRef = useRef(compile);
  useEffect(() => {
    compileRef.current = compile;
  });
  // Compile as you type (after a pause), like Remix's auto-compile
  const solKey = entries.map((p) => files[p]).join('\u0000');
  useEffect(() => {
    if (!autoCompile || !solKey) return;
    const timer = setTimeout(() => void compileRef.current(), 700);
    return () => clearTimeout(timer);
  }, [solKey, autoCompile, settings]);

  const ensureChain = async (): Promise<LocalChain | WalletChain> => {
    chainModule ??= await import('@/lib/web3/chain');
    if (env === 'wallet') {
      if (!wallet.current) throw new Error('Connect a wallet first.');
      return wallet.current;
    }
    if (!local.current) {
      local.current = await chainModule.LocalChain.create();
      setAccount(chainModule.ACCOUNTS[0]);
      await updateBalances(local.current, chainModule.ACCOUNTS);
    }
    return local.current;
  };
  const updateBalances = async (c: LocalChain | WalletChain | null = chain.current, accounts: string[] = env === 'wallet' ? (wallet.current?.accounts ?? []) : (chainModule?.ACCOUNTS ?? [])) => {
    if (!c) return;
    const out: Record<string, bigint> = {};
    for (const a of accounts) out[a] = await c.balance(a).catch(() => 0n);
    setBalances(out);
  };
  const connectWallet = async () => {
    setWalletError(null);
    try {
      chainModule ??= await import('@/lib/web3/chain');
      const w = await chainModule.WalletChain.connect((window as unknown as { ethereum?: Parameters<typeof chainModule.WalletChain.connect>[0] }).ethereum);
      wallet.current = w;
      setAccount(w.accounts[0] ?? '');
      await updateBalances(w, w.accounts);
      refresh();
    } catch (error) {
      setWalletError((error as Error).message);
    }
  };
  const switchEnv = (next: 'local' | 'wallet') => {
    setEnv(next);
    setLastByFn({});
    if (next === 'local' && chainModule) {
      setAccount(chainModule.ACCOUNTS[0]);
      void updateBalances(local.current, chainModule.ACCOUNTS);
    } else if (next === 'wallet') {
      setAccount(wallet.current?.accounts[0] ?? '');
      if (wallet.current) void updateBalances(wallet.current, wallet.current.accounts);
      else setBalances({});
    }
  };
  useEffect(() => {
    void ensureChain();
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deployables = result ? deployable(result.contracts, files) : [];
  const contract: CompiledContract | undefined = deployables.find((c) => `${c.file}:${c.name}` === picked);
  const ctor = contract?.abi.find((x) => x.type === 'constructor');
  const wei = () => {
    const m = chainModule!;
    return m.parseArg('uint256', `${value || '0'} ${unit}`) as bigint;
  };

  const deploy = async () => {
    if (!contract) return;
    setBusy('deploy');
    try {
      const c = await ensureChain();
      const m = chainModule!;
      const args = (ctor?.inputs ?? []).map((p, i) => m.parseArg(p.type, ctorArgs[i] ?? ''));
      const { tx } = await c.deploy(contract, args, { from: account, value: wei() });
      setLastByFn((prev) => ({ ...prev, [`deploy:${contract.name}`]: tx }));
      await updateBalances();
    } catch (error) {
      setLastByFn((prev) => ({ ...prev, [`deploy:${contract.name}`]: { id: 0, kind: 'deploy', from: account, contract: contract.name, fn: 'constructor', args: [], value: 0n, ok: false, gasUsed: 0n, error: (error as Error).message, events: [], block: 0 } }));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const run = async (instance: Instance, fn: AbiItem, raw: string[]) => {
    const key = `${instance.id}:${sig(fn)}`;
    setBusy(key);
    try {
      const c = await ensureChain();
      const m = chainModule!;
      const args = (fn.inputs ?? []).map((p, i) => m.parseArg(p.type, raw[i] ?? ''));
      const tx = await c.call(instance, fn, args, { from: account, value: fn.stateMutability === 'payable' ? wei() : 0n });
      setLastByFn((prev) => ({ ...prev, [key]: tx }));
      await updateBalances();
    } catch (error) {
      setLastByFn((prev) => ({ ...prev, [key]: { id: 0, kind: 'call', from: account, contract: instance.name, fn: fn.name ?? '', args: [], value: 0n, ok: false, gasUsed: 0n, error: (error as Error).message, events: [], block: 0 } }));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const ask = (goal: string, label: string) => {
    if (proposals.ask(goal, { label }) === null) actions.openPanel('agent');
  };
  const findings = useMemo(() => analyzeProject(files), [files]);
  const errors = result?.messages.filter((m) => m.severity === 'error') ?? [];
  const warnings = result?.messages.filter((m) => m.severity !== 'error') ?? [];
  const instances = chain.current?.instances ?? [];
  const txs = chain.current?.txs ?? [];

  if (!entries.length) {
    return (
      <div className="space-y-2 p-4 text-sm text-gray-400">
        <p>No Solidity files in this project.</p>
        <p className="text-xs text-gray-500">Create → Templates → Solidity starts one, or add a .sol file. Contracts compile in your browser and deploy to a chain in the page.</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto" aria-label="Deploy and run">
      <Section
        title="Compiler"
        right={
          <button onClick={(e) => { e.preventDefault(); void compile(); }} disabled={compiling} className="btn btn-primary btn-sm h-6">
            {compiling ? 'Compiling…' : 'Compile'}
          </button>
        }
      >
        <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
          Version
          <select value={settings.version ?? ''} onChange={(e) => setSettings({ ...settings, version: e.target.value || undefined })} className="input h-7 w-auto font-mono text-xs" aria-label="Compiler version">
            <option value="">Auto (pragma){result && !settings.version ? ` · ${result.version}` : ''}</option>
            {releases.slice(0, 60).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!settings.optimize} onChange={(e) => setSettings({ ...settings, optimize: e.target.checked })} /> Optimize</label>
          <input type="number" min={1} value={settings.runs ?? 200} onChange={(e) => setSettings({ ...settings, runs: Number(e.target.value) || 200 })} aria-label="Optimizer runs" className="input h-6 w-20 text-xs" disabled={!settings.optimize} />
          <select value={settings.evmVersion ?? ''} onChange={(e) => setSettings({ ...settings, evmVersion: e.target.value })} className="input h-6 w-auto text-xs" aria-label="EVM version">
            {EVM_VERSIONS.map((v) => <option key={v} value={v}>{v || 'EVM: default'}</option>)}
          </select>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!settings.viaIR} onChange={(e) => setSettings({ ...settings, viaIR: e.target.checked })} /> via IR</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={autoCompile} onChange={(e) => setAutoCompile(e.target.checked)} /> Auto-compile</label>
        </div>
        {compileError && <p className="text-xs text-danger" role="alert">{compileError}</p>}
        {result && (
          <p className={`text-xs ${errors.length ? 'text-danger' : 'text-accent'}`} role="status">
            {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : `✓ solc ${result.version} · ${deployables.length} contract${deployables.length === 1 ? '' : 's'} · ${result.ms} ms`}
            {warnings.length ? <span className="text-gray-500"> · {warnings.length} warning{warnings.length > 1 ? 's' : ''}</span> : null}
          </p>
        )}
        {result?.missing.length ? <p className="text-xs text-warn">Couldn&apos;t find: {result.missing.map((m) => m.spec).join(', ')}</p> : null}
        {result && result.messages.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-auto" aria-label="Compiler messages">
            {result.messages.map((m, i) => (
              <li key={i}>
                <button onClick={() => m.file && m.file in files && onOpen(m.file, m.line)} className={`w-full text-left font-mono text-[11px] ${m.severity === 'error' ? 'text-danger' : 'text-warn'} hover:underline`} title={m.formatted}>
                  {m.file ? `${m.file.split('/').pop()}:${m.line ?? ''} ` : ''}{m.type}: {m.message}
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <button onClick={() => ask(`The Solidity contracts don't compile (solc ${result?.version}). Fix the code so they compile, keeping the intent; then compile again to prove it.\n\n${errors.map((e) => e.formatted).join('\n\n')}`, 'Fix the Solidity build')} className="btn btn-secondary btn-sm h-6">✦ Fix with the agent</button>
        )}
        {deployables.some((c) => c.size > 24576) && <p className="text-xs text-warn">A contract is over 24,576 bytes and can&apos;t go on mainnet (EIP-170): turn on the optimizer or split it.</p>}
      </Section>

      <Section title={`Deploy & run · ${env === 'wallet' ? (wallet.current ? wallet.current.network : 'browser wallet') : 'in-page chain'}`}>
        <div role="radiogroup" aria-label="Environment" className="flex rounded-md border border-border p-0.5 text-[11px]">
          <button role="radio" aria-checked={env === 'local'} onClick={() => switchEnv('local')} className={`flex-1 rounded px-2 py-0.5 ${env === 'local' ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`} title="An EVM in this page: instant, free, nothing leaves your browser">In-page chain</button>
          <button role="radio" aria-checked={env === 'wallet'} onClick={() => switchEnv('wallet')} className={`flex-1 rounded px-2 py-0.5 ${env === 'wallet' ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`} title="MetaMask or another browser wallet: a testnet, a local Anvil node, or mainnet">Browser wallet</button>
        </div>
        {env === 'wallet' && !wallet.current && (
          <div className="space-y-1.5">
            <button onClick={() => void connectWallet()} className="btn btn-secondary btn-sm w-full">Connect wallet</button>
            <p className="text-[11px] text-gray-500">Deploys go through your wallet to whatever network it is on (Sepolia and other testnets, or a local Anvil node at chain 31337). The studio never sees your keys.</p>
            {walletError && <p className="text-[11px] text-danger" role="alert">{walletError}</p>}
          </div>
        )}
        {env === 'wallet' && wallet.current && chainModule && !chainModule.CHAINS[wallet.current.chainId]?.testnet && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger" role="alert">{wallet.current.network} is a real network: deploys and transactions cost real money. Switch your wallet to a testnet to experiment.</p>
        )}
        <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
          Account
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="input h-7 w-auto font-mono text-[11px]" aria-label="Account">
            {Object.entries(balances).map(([a, b]) => <option key={a} value={a}>{short(a)} · {chainModule?.formatEther(b)} ETH</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="flex-1">Value</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value to send" className="input h-7 w-24 font-mono text-xs" />
          <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="input h-7 w-auto text-xs" aria-label="Unit">
            <option value="wei">wei</option><option value="gwei">gwei</option><option value="ether">ether</option>
          </select>
        </div>
        <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
          Contract
          <select value={picked} onChange={(e) => { setPicked(e.target.value); setCtorArgs([]); }} className="input h-7 w-auto max-w-[14rem] text-xs" aria-label="Contract to deploy">
            {deployables.map((c) => <option key={`${c.file}:${c.name}`} value={`${c.file}:${c.name}`}>{c.name} · {c.file.split('/').pop()}</option>)}
          </select>
        </label>
        {ctor?.inputs?.length ? <Params params={ctor.inputs} values={ctorArgs} onChange={setCtorArgs} /> : null}
        <button onClick={() => void deploy()} disabled={!contract || busy === 'deploy' || errors.length > 0} className="btn btn-primary btn-sm w-full">
          {busy === 'deploy' ? 'Deploying…' : contract ? `Deploy ${contract.name}` : 'Compile to deploy'}
        </button>
        {contract && lastByFn[`deploy:${contract.name}`] && !lastByFn[`deploy:${contract.name}`].ok && (
          <p className="break-all font-mono text-[11px] text-danger" role="alert">✕ {lastByFn[`deploy:${contract.name}`].error}</p>
        )}

        {instances.length > 0 && (
          <ul className="space-y-2" aria-label="Deployed contracts">
            {[...instances].reverse().map((inst) => (
              <li key={inst.id} className="rounded-lg border border-border">
                <details open>
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
                    <span className="text-sm text-gray-100">{inst.name}</span>
                    <button onClick={(e) => { e.preventDefault(); void navigator.clipboard?.writeText(inst.address); }} className="font-mono text-[11px] text-gray-500 hover:text-gray-100" title="Copy the address">{short(inst.address)}</button>
                    <span className="flex-1" />
                    <button onClick={(e) => { e.preventDefault(); chain.current?.forget(inst.id); refresh(); }} className="text-[11px] text-gray-600 hover:text-gray-100" aria-label={`Remove ${inst.name} from the list`}>✕</button>
                  </summary>
                  <ul className="space-y-2 border-t border-border px-2.5 py-2">
                    {inst.abi.filter((x) => x.type === 'function').sort((a, b) => Number(a.stateMutability === 'view' || a.stateMutability === 'pure') - Number(b.stateMutability === 'view' || b.stateMutability === 'pure')).map((fn) => (
                      <FunctionRow key={sig(fn)} fn={fn} run={(f, a) => void run(inst, f, a)} last={lastByFn[`${inst.id}:${sig(fn)}`]} />
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Transactions${txs.length ? ` · ${txs.length}` : ''}`} open={txs.length > 0}>
        {txs.length === 0 ? (
          <p className="text-xs text-gray-500">Deploys, transactions and reads appear here with gas, events and revert reasons.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Transactions">
            {txs.slice(0, 40).map((t) => (
              <li key={t.id} className="text-[11px]">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className={t.ok ? 'text-accent' : 'text-danger'}>{t.ok ? '✓' : '✕'}</span>
                  <span className="text-gray-200">{t.contract}.{t.fn}</span>
                  <span className="text-gray-500">{t.kind === 'call' ? 'read' : `#${t.block} · gas ${t.gasUsed}`}</span>
                </div>
                {t.events.map((e, i) => <div key={i} className="ml-4 break-all font-mono text-gray-400">{e.name} {display(e.args)}</div>)}
                {t.hash && chain.current && 'explorerTx' in chain.current && chain.current.explorerTx(t.hash) && (
                  <a href={chain.current.explorerTx(t.hash)!} target="_blank" rel="noreferrer" className="ml-4 font-mono text-accent hover:underline">{t.hash.slice(0, 18)}… ↗</a>
                )}
                {!t.ok && (
                  <div className="ml-4 flex flex-wrap items-center gap-2">
                    <span className="break-all text-danger">{t.error}</span>
                    <button onClick={() => ask(`Calling ${t.contract}.${t.fn}(${t.args.map((a) => display(a)).join(', ')}) from ${t.from}${t.value ? ` with ${t.value} wei` : ''} reverted: ${t.error}\n\nFind out why from the contract source. If it's a bug, fix it and show the call succeeding; if the revert is correct (a guard doing its job), explain which input or state is needed.`, `Why did ${t.fn} revert?`)} className="text-accent hover:underline">✦ Why?</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Analysis${findings.length ? ` · ${findings.length}` : ''}`} open={findings.some((f) => f.severity === 'high')}>
        {findings.length === 0 ? (
          <p className="text-xs text-gray-500">No common pitfalls found. This is a first pass, not an audit.</p>
        ) : (
          <ul className="space-y-2" aria-label="Findings">
            {findings.map((f, i) => (
              <li key={i} className="space-y-0.5 text-xs">
                <button onClick={() => onOpen(f.file, f.line)} className="flex w-full items-start gap-2 text-left hover:underline">
                  <span className={`shrink-0 font-mono uppercase ${SEVERITY[f.severity]}`}>{f.severity}</span>
                  <span className="text-gray-200">{f.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-gray-500">{f.file.split('/').pop()}:{f.line}</span>
                </button>
                <p className="text-gray-500">{f.why} {f.fix}</p>
              </li>
            ))}
          </ul>
        )}
        {findings.length > 0 && (
          <button onClick={() => ask(`Review these static-analysis findings in the Solidity contracts and fix the real problems (load the smart-contract-security skill). Explain any you judge to be false positives. Add or update tests that prove the fixes.\n\n${findings.map((f) => `- [${f.severity}] ${f.title} at ${f.file}:${f.line}: ${f.text}`).join('\n')}`, 'Fix contract findings')} className="btn btn-secondary btn-sm h-6">✦ Fix with the agent</button>
        )}
      </Section>
    </div>
  );
}
