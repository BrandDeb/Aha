/**
 * A blockchain in the page, like Remix's "Remix VM": an Ethereum Virtual Machine (ethereumjs) with ten funded
 * accounts, so contracts deploy and run instantly, with no node, no wallet and no faucet. Reads run on a
 * snapshot and change nothing; writes are transactions with gas used, events and revert reasons decoded from the
 * ABI. Loaded only when the Deploy & run panel is used.
 */

import { createEVM, type EVM } from '@ethereumjs/evm';
import { Account, bytesToHex, createAddressFromString, hexToBytes, type Address } from '@ethereumjs/util';
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, keccak256, toHex, type Abi } from 'viem';
import type { AbiItem } from './solc';

export interface Instance {
  id: string;
  name: string;
  address: string;
  abi: AbiItem[];
}

export interface TxRecord {
  id: number;
  kind: 'deploy' | 'transact' | 'call';
  from: string;
  to?: string;
  contract: string;
  fn: string;
  args: unknown[];
  value: bigint;
  ok: boolean;
  /** Transaction cost: the 21,000 base (53,000 to deploy), calldata, and execution, as Remix reports it */
  gasUsed: bigint;
  /** Execution alone */
  execGas?: bigint;
  result?: unknown;
  error?: string;
  events: { name: string; args: Record<string, unknown> }[];
  block: number;
}

const ONE_ETHER = 10n ** 18n;
export const START_BALANCE = 100n * ONE_ETHER;

/** Ten stable test addresses (derived, so they're the same every session) */
export const ACCOUNTS: string[] = Array.from({ length: 10 }, (_, i) => `0x${keccak256(toHex(`nanocli-test-account-${i}`)).slice(-40)}`);

const abiOf = (abi: AbiItem[]) => abi as unknown as Abi;

/** Gas every transaction pays before running: the base, and 16 per non-zero / 4 per zero byte of data */
export function intrinsicGas(data: Uint8Array, create: boolean): bigint {
  let gas = create ? 53_000n : 21_000n;
  for (const byte of data) gas += byte === 0 ? 4n : 16n;
  // EIP-3860: init code pays 2 per 32-byte word
  if (create) gas += 2n * BigInt(Math.ceil(data.length / 32));
  return gas;
}

/** The reason a call reverted: a custom error, Error(string), Panic(uint), or a plain message */
export function revertReason(abi: AbiItem[], data: `0x${string}`, fallback: string): string {
  if (!data || data === '0x') return fallback;
  try {
    const decoded = decodeErrorResult({ abi: abiOf(abi), data });
    const args = decoded.args?.length ? `(${decoded.args.map((a) => String(a)).join(', ')})` : '';
    if (decoded.errorName === 'Error') return String(decoded.args?.[0]);
    if (decoded.errorName === 'Panic') return `Panic ${String(decoded.args?.[0])}: ${PANICS[Number(decoded.args?.[0])] ?? 'assertion'}`;
    return `${decoded.errorName}${args}`;
  } catch {
    return `${fallback} (${data.slice(0, 10)})`;
  }
}

const PANICS: Record<number, string> = { 1: 'assert failed', 17: 'arithmetic overflow or underflow', 18: 'division by zero', 33: 'invalid enum value', 34: 'bad storage encoding', 49: 'pop on empty array', 50: 'array index out of bounds', 65: 'out of memory', 81: 'call to an uninitialised function' };

export class LocalChain {
  private evm!: EVM;
  private nextTx = 0;
  block = 1;
  instances: Instance[] = [];
  txs: TxRecord[] = [];

  static async create(): Promise<LocalChain> {
    const chain = new LocalChain();
    chain.evm = await createEVM();
    for (const a of ACCOUNTS) await chain.evm.stateManager.putAccount(createAddressFromString(a), new Account(0n, START_BALANCE));
    return chain;
  }

  async balance(address: string): Promise<bigint> {
    return (await this.evm.stateManager.getAccount(createAddressFromString(address)))?.balance ?? 0n;
  }

  /** A transaction starts cold: forget which accounts and slots the last one touched (EIP-2929) */
  private async fresh() {
    await (this.evm as unknown as { journal: { cleanup: () => Promise<void> } }).journal.cleanup();
  }

  private record(r: Omit<TxRecord, 'id' | 'block'>): TxRecord {
    const tx = { ...r, id: ++this.nextTx, block: r.kind === 'call' ? this.block : ++this.block };
    this.txs = [tx, ...this.txs].slice(0, 200);
    return tx;
  }

  private decodeLogs(logs: [Uint8Array, Uint8Array[], Uint8Array][] | undefined): TxRecord['events'] {
    const out: TxRecord['events'] = [];
    for (const [address, topics, data] of logs ?? []) {
      const at = bytesToHex(address).toLowerCase();
      const owner = this.instances.find((i) => i.address.toLowerCase() === at) ?? this.instances[0];
      const abis = [owner, ...this.instances.filter((i) => i !== owner)].filter(Boolean).map((i) => i.abi);
      let decoded: TxRecord['events'][number] | null = null;
      for (const abi of abis) {
        try {
          const ev = decodeEventLog({ abi: abiOf(abi), topics: topics.map((t) => bytesToHex(t)) as [`0x${string}`, ...`0x${string}`[]], data: bytesToHex(data) });
          decoded = { name: ev.eventName ?? 'event', args: (ev.args ?? {}) as Record<string, unknown> };
          break;
        } catch {
          // not this contract's event
        }
      }
      out.push(decoded ?? { name: `log ${bytesToHex(topics[0] ?? new Uint8Array()).slice(0, 10)}`, args: { data: bytesToHex(data) } });
    }
    return out;
  }

  /** Deploy a compiled contract */
  async deploy(contract: { name: string; abi: AbiItem[]; bytecode: string }, args: unknown[], options: { from: string; value?: bigint; gasLimit?: bigint }): Promise<{ tx: TxRecord; instance?: Instance }> {
    const data = encodeDeployData({ abi: abiOf(contract.abi), bytecode: `0x${contract.bytecode.replace(/^0x/, '')}`, args });
    await this.fresh();
    const result = await this.evm.runCall({ caller: createAddressFromString(options.from), data: hexToBytes(data), value: options.value ?? 0n, gasLimit: options.gasLimit ?? 30_000_000n, block: this.blockInfo() as never });
    const failed = result.execResult.exceptionError;
    const address = result.createdAddress?.toString();
    const instance = !failed && address ? { id: `${contract.name}@${address}`, name: contract.name, address, abi: contract.abi } : undefined;
    if (instance) this.instances = [...this.instances, instance];
    const tx = this.record({
      kind: 'deploy',
      from: options.from,
      to: address,
      contract: contract.name,
      fn: 'constructor',
      args,
      value: options.value ?? 0n,
      ok: !failed,
      gasUsed: intrinsicGas(hexToBytes(data), true) + result.execResult.executionGasUsed,
      execGas: result.execResult.executionGasUsed,
      ...(failed ? { error: revertReason(contract.abi, bytesToHex(result.execResult.returnValue), String(failed.error ?? failed)) } : {}),
      events: failed ? [] : this.decodeLogs(result.execResult.logs as never),
    });
    return { tx, instance };
  }

  /** Call a function: views and pure functions read a snapshot; everything else is a transaction */
  async call(instance: Instance, fn: AbiItem, args: unknown[], options: { from: string; value?: bigint; gasLimit?: bigint }): Promise<TxRecord> {
    const read = fn.stateMutability === 'view' || fn.stateMutability === 'pure';
    const data = encodeFunctionData({ abi: abiOf([fn]), functionName: fn.name!, args });
    const state = this.evm.stateManager;
    if (read) await state.checkpoint();
    await this.fresh();
    try {
      const result = await this.evm.runCall({ caller: createAddressFromString(options.from), to: createAddressFromString(instance.address) as Address, data: hexToBytes(data), value: options.value ?? 0n, gasLimit: options.gasLimit ?? 30_000_000n, block: this.blockInfo() as never });
      const failed = result.execResult.exceptionError;
      const ret = bytesToHex(result.execResult.returnValue);
      let decoded: unknown;
      if (!failed && fn.outputs?.length) {
        try {
          decoded = decodeFunctionResult({ abi: abiOf([fn]), functionName: fn.name!, data: ret });
        } catch {
          decoded = ret;
        }
      }
      return this.record({
        kind: read ? 'call' : 'transact',
        from: options.from,
        to: instance.address,
        contract: instance.name,
        fn: fn.name!,
        args,
        value: options.value ?? 0n,
        ok: !failed,
        gasUsed: intrinsicGas(hexToBytes(data), false) + result.execResult.executionGasUsed,
        execGas: result.execResult.executionGasUsed,
        ...(failed ? { error: revertReason(instance.abi, ret, String(failed.error ?? failed)) } : { result: decoded }),
        events: failed || read ? [] : this.decodeLogs(result.execResult.logs as never),
      });
    } finally {
      if (read) await state.revert();
    }
  }

  /** Send plain ether between accounts or to a contract (its receive/fallback) */
  async send(from: string, to: string, value: bigint): Promise<TxRecord> {
    await this.fresh();
    const result = await this.evm.runCall({ caller: createAddressFromString(from), to: createAddressFromString(to), value, gasLimit: 100_000n, block: this.blockInfo() as never });
    const failed = result.execResult.exceptionError;
    const target = this.instances.find((i) => i.address.toLowerCase() === to.toLowerCase());
    return this.record({ kind: 'transact', from, to, contract: target?.name ?? 'account', fn: 'receive', args: [], value, ok: !failed, gasUsed: 21_000n + result.execResult.executionGasUsed, execGas: result.execResult.executionGasUsed, ...(failed ? { error: String(failed.error ?? failed) } : {}), events: [] });
  }

  /** Forget a deployed instance in the list (its code stays on chain) */
  forget(id: string) {
    this.instances = this.instances.filter((i) => i.id !== id);
  }

  private blockInfo() {
    // A block per transaction, 12 seconds apart, like a real chain
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    return { header: { number: BigInt(this.block), timestamp, coinbase: createAddressFromString('0x0000000000000000000000000000000000000000'), gasLimit: 30_000_000n, baseFeePerGas: 7n, prevRandao: new Uint8Array(32), getBlobGasPrice: () => 1n } };
  }
}

/** Text from a form field to the value the ABI expects: numbers to bigint, booleans, arrays and tuples as JSON */
export function parseArg(type: string, text: string): unknown {
  const t = text.trim();
  if (type.endsWith(']') || type.startsWith('tuple')) {
    const parsed = JSON.parse(t || '[]');
    const inner = type.replace(/\[\d*\]$/, '');
    return Array.isArray(parsed) && type.endsWith(']') ? parsed.map((v) => parseArg(inner, typeof v === 'string' ? v : JSON.stringify(v))) : parsed;
  }
  if (/^u?int\d*$/.test(type)) {
    // "1 ether", "2.5 gwei" or a plain integer
    const unit = t.match(/^([\d.]+)\s*(ether|gwei|wei)$/i);
    if (unit) {
      const [whole, frac = ''] = unit[1].split('.');
      const decimals = unit[2].toLowerCase() === 'ether' ? 18 : unit[2].toLowerCase() === 'gwei' ? 9 : 0;
      return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
    }
    return BigInt(t || '0');
  }
  if (type === 'bool') return t === 'true' || t === '1';
  if (type === 'address' && !/^0x[0-9a-fA-F]{40}$/.test(t)) throw new Error(`"${t}" is not an address`);
  if (type.startsWith('bytes') && !/^0x[0-9a-fA-F]*$/.test(t)) throw new Error(`"${t}" is not hex bytes (0x…)`);
  return t;
}

/** A value for display: bigints as numbers (with an ether reading when it looks like wei), arrays and structs as JSON */
export function showValue(v: unknown): string {
  if (typeof v === 'bigint') return v >= 10n ** 15n ? `${v} (${formatEther(v)} ETH)` : String(v);
  if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return String(v);
}

export function formatEther(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / ONE_ETHER;
  const frac = (abs % ONE_ETHER).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6);
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
