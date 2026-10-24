import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gatherSources, importsOf, pickVersion, pragmaRange, readOutput, remappingsOf, resolveImport, satisfies, solidityEntries, standardInput } from '../src/lib/web3/solc.ts';
import { analyzeSolidity } from '../src/lib/web3/analyze.ts';
import { ACCOUNTS, formatEther, LocalChain, parseArg, START_BALANCE } from '../src/lib/web3/chain.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/counter.json', import.meta.url), 'utf8'));
const RELEASES = ['0.8.38', '0.8.30', '0.8.24', '0.8.20', '0.8.19', '0.7.6', '0.6.12', '0.4.26'];

test('the compiler version comes from the pragmas', () => {
  assert.equal(pragmaRange('// x\npragma solidity ^0.8.20;\ncontract A {}'), '^0.8.20');
  assert.ok(satisfies('0.8.38', '^0.8.20') && !satisfies('0.9.0', '^0.8.20') && !satisfies('0.8.19', '^0.8.20'));
  assert.ok(satisfies('0.7.6', '>=0.6.0 <0.8.0') && !satisfies('0.8.0', '>=0.6.0 <0.8.0'));
  assert.ok(satisfies('0.8.24', '0.8.24') && satisfies('0.6.12', '0.8.24 || ^0.6.0'));
  assert.equal(pickVersion(['pragma solidity ^0.8.20;', 'pragma solidity >=0.8.0 <0.8.25;'], RELEASES), '0.8.24');
  assert.equal(pickVersion(['pragma solidity ^0.7.0;'], RELEASES), '0.7.6');
  assert.equal(pickVersion(['contract A {}'], RELEASES), '0.8.38');
  assert.equal(pickVersion(['pragma solidity ^0.5.0;'], RELEASES), null);
});

test('imports resolve to project files, remappings or npm via jsDelivr', async () => {
  const files: Record<string, string> = {
    'src/Token.sol': 'import "@openzeppelin/contracts/token/ERC20/ERC20.sol";\nimport {Lib} from "./lib/Lib.sol"; // import "nope.sol";\ncontract T {}',
    'src/lib/Lib.sol': 'library Lib {}',
    'remappings.txt': 'solmate/=lib/solmate/src/\n',
    'lib/solmate/src/tokens/ERC20.sol': 'abstract contract ERC20 {}',
    'test/Token.t.sol': '',
    'package.json': '{"dependencies":{"@openzeppelin/contracts":"^5.1.0"}}',
  };
  assert.deepEqual(importsOf(files['src/Token.sol']), ['@openzeppelin/contracts/token/ERC20/ERC20.sol', './lib/Lib.sol']);
  assert.deepEqual(remappingsOf(files), [['solmate/', 'lib/solmate/src/']]);
  assert.deepEqual(resolveImport('src/A.sol', 'solmate/tokens/ERC20.sol', files), { kind: 'project', path: 'lib/solmate/src/tokens/ERC20.sol' });
  assert.deepEqual(resolveImport('src/A.sol', '@openzeppelin/contracts/access/Ownable.sol', files, { '@openzeppelin/contracts': '^5.1.0' }), { kind: 'npm', path: '@openzeppelin/contracts/access/Ownable.sol', url: 'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.1.0/access/Ownable.sol' });
  assert.equal(resolveImport('a.sol', 'forge-std/Test.sol', {})?.kind === 'npm' && (resolveImport('a.sol', 'forge-std/Test.sol', {}) as { url: string }).url, 'https://cdn.jsdelivr.net/npm/forge-std@1/src/Test.sol');
  assert.deepEqual(solidityEntries(files), ['src/Token.sol', 'src/lib/Lib.sol']);
  const fetched: string[] = [];
  const npm: Record<string, string> = {
    'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.1.0/token/ERC20/ERC20.sol': 'import {Context} from "../../utils/Context.sol";\nabstract contract ERC20 {}',
    'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.1.0/utils/Context.sol': 'abstract contract Context {}',
  };
  const { sources, missing } = await gatherSources(files, ['src/Token.sol'], async (url) => (fetched.push(url), npm[url] ?? null), { '@openzeppelin/contracts': '^5.1.0' });
  assert.deepEqual(Object.keys(sources).sort(), ['@openzeppelin/contracts/token/ERC20/ERC20.sol', '@openzeppelin/contracts/utils/Context.sol', 'src/Token.sol', 'src/lib/Lib.sol']);
  assert.deepEqual(missing, []);
  const input = JSON.parse(standardInput(sources, { optimize: true, runs: 200, evmVersion: 'cancun', viaIR: false }));
  assert.deepEqual(input.settings.optimizer, { enabled: true, runs: 200 });
  assert.equal(input.settings.evmVersion, 'cancun');
});

test('compiler output becomes messages with lines and deployable contracts', () => {
  const sources = { 'A.sol': { content: 'pragma solidity ^0.8.0;\ncontract A {\n  uint x = "no";\n}' } };
  const out = readOutput({ errors: [{ severity: 'error', type: 'TypeError', message: 'Type literal_string is not convertible', formattedMessage: 'TypeError: …', sourceLocation: { file: 'A.sol', start: 48, end: 52 } }], contracts: { 'A.sol': { A: { abi: [], evm: { bytecode: { object: '6080' }, deployedBytecode: { object: '60806040' } } } } } }, sources);
  assert.deepEqual(out.messages[0], { severity: 'error', type: 'TypeError', message: 'Type literal_string is not convertible', file: 'A.sol', line: 3, column: 12, formatted: 'TypeError: …' });
  assert.equal(out.contracts[0].size, 4);
});

test('static analysis finds the classic pitfalls, with lines, and skips comments', () => {
  const src = `pragma solidity ^0.8.0;
contract Bank {
  mapping(address => uint) balances;
  function withdraw() public {
    uint amount = balances[msg.sender];
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] = 0;
  }
  function kill() public { require(tx.origin == owner); selfdestruct(payable(msg.sender)); }
  function mint(address to, uint n) public { balances[to] += n; }
  function lucky() public view returns (uint) { return uint(keccak256(abi.encode(block.timestamp))) % 10; }
  // function old() public { selfdestruct(payable(msg.sender)); }
}`;
  const ids = analyzeSolidity('Bank.sol', src).map((f) => `${f.id}:${f.line}`);
  for (const want of ['reentrancy:6', 'tx-origin:10', 'selfdestruct:10', 'unprotected-mint:11', 'weak-randomness:12', 'floating-pragma:1']) assert.ok(ids.includes(want), `${want} in ${ids}`);
  assert.ok(!ids.includes('selfdestruct:13'), 'commented-out code is ignored');
  assert.equal(analyzeSolidity('Bank.sol', src)[0].severity, 'high');
  const guarded = analyzeSolidity('S.sol', 'pragma solidity 0.8.24;\ncontract S {\n  function withdraw() public nonReentrant {\n    (bool ok, ) = msg.sender.call{value: 1}("");\n    require(ok);\n    x = 0;\n  }\n  function mint(address to) external onlyOwner {}\n}');
  assert.deepEqual(guarded.map((f) => f.id), []);
});

test('form text becomes ABI values', () => {
  assert.equal(parseArg('uint256', '42'), 42n);
  assert.equal(parseArg('uint256', '1.5 ether'), 1_500_000_000_000_000_000n);
  assert.equal(parseArg('uint256', '2 gwei'), 2_000_000_000n);
  assert.deepEqual(parseArg('uint8[]', '[1, 2]'), [1n, 2n]);
  assert.equal(parseArg('bool', 'true'), true);
  assert.throws(() => parseArg('address', '0x12'), /not an address/);
  assert.equal(formatEther(1_234_500_000_000_000_000n), '1.2345');
});

test('the in-page chain deploys, reads, writes, decodes events and revert reasons', async () => {
  const chain = await LocalChain.create();
  const [alice, bob] = ACCOUNTS;
  assert.equal(await chain.balance(alice), START_BALANCE);
  const { tx, instance } = await chain.deploy({ name: 'Counter', abi: fixture.abi, bytecode: fixture.bytecode }, [5n], { from: alice, value: 10n ** 18n });
  assert.ok(tx.ok && instance, tx.error);
  assert.equal(await chain.balance(instance!.address), 10n ** 18n);
  const fn = (name: string) => fixture.abi.find((x: { name?: string }) => x.name === name);
  const read = await chain.call(instance!, fn('count'), [], { from: alice });
  assert.deepEqual([read.kind, read.result], ['call', 5n]);
  const write = await chain.call(instance!, fn('add'), [10n], { from: bob });
  assert.ok(write.ok && write.gasUsed > 21_000n + write.execGas! - 1n);
  // A cold write to a fresh slot costs over 20,000 gas, every time (each call starts cold)
  const again = await chain.call(instance!, fn('add'), [1n], { from: bob });
  assert.ok(again.execGas! > 2_000n, String(again.execGas));
  assert.deepEqual(write.events, [{ name: 'Changed', args: { by: bob.toLowerCase() === write.events[0]?.args.by?.toString().toLowerCase() ? write.events[0].args.by : bob, value: 15n } }]);
  assert.equal((await chain.call(instance!, fn('count'), [], { from: alice })).result, 16n);
  const tooBig = await chain.call(instance!, fn('add'), [90n], { from: alice });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.error, 'TooBig(106, 100)');
  const notOwner = await chain.call(instance!, fn('onlyOwnerReset'), [], { from: bob });
  assert.equal(notOwner.error, 'not the owner');
  const panic = await chain.call(instance!, fn('divide'), [0n], { from: alice });
  assert.match(panic.error!, /division by zero/);
  const tuple = await chain.call(instance!, fn('info'), [], { from: alice });
  assert.deepEqual((tuple.result as unknown[])[0], 16n);
  // Reads change nothing: the count is still 16 and no block was used
  const blocks = chain.block;
  await chain.call(instance!, fn('count'), [], { from: alice });
  assert.equal(chain.block, blocks);
  const paid = await chain.call(instance!, fn('deposit'), [], { from: bob, value: 5n });
  assert.ok(paid.ok);
  assert.equal(await chain.balance(instance!.address), 10n ** 18n + 5n);
});

test('a browser wallet: connect, deploy and transact through EIP-1193, reads by eth_call, rejections explained', async () => {
  const { WalletChain, walletError } = await import('../src/lib/web3/chain.ts');
  const { encodeFunctionResult } = await import('viem');
  const me = '0x1111111111111111111111111111111111111111';
  const sent: unknown[] = [];
  let reject = false;
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_requestAccounts': return [me];
        case 'eth_chainId': return '0xaa36a7';
        case 'eth_getBalance': return '0xde0b6b3a7640000';
        case 'eth_sendTransaction':
          if (reject) throw Object.assign(new Error('User denied'), { code: 4001 });
          sent.push(params?.[0]);
          return `0x${String(sent.length).padStart(64, '0')}`;
        case 'eth_getTransactionReceipt':
          return { status: '0x1', gasUsed: '0x5208', blockNumber: '0x10', contractAddress: sent.length === 1 ? '0x2222222222222222222222222222222222222222' : undefined, logs: [] };
        case 'eth_call':
          return encodeFunctionResult({ abi: fixture.abi, functionName: 'count', result: 7n });
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const w = await WalletChain.connect(provider);
  assert.equal(w.network, 'Sepolia');
  assert.equal(await w.balance(me), 10n ** 18n);
  const { instance, tx } = await w.deploy({ name: 'Counter', abi: fixture.abi, bytecode: fixture.bytecode }, [1n], { from: me });
  assert.ok(tx.ok && instance?.address === '0x2222222222222222222222222222222222222222');
  assert.equal(w.explorerTx(tx.hash!), `https://sepolia.etherscan.io/tx/${tx.hash}`);
  const fn = (name: string) => fixture.abi.find((x: { name?: string }) => x.name === name);
  assert.equal((await w.call(instance!, fn('count'), [], { from: me })).result, 7n);
  const write = await w.call(instance!, fn('add'), [2n], { from: me });
  assert.ok(write.ok && write.gasUsed === 21000n);
  assert.match((sent[1] as { data: string }).data, /^0x1003e2d2/);
  reject = true;
  assert.equal((await w.call(instance!, fn('add'), [2n], { from: me })).error, 'You rejected it in the wallet.');
  await assert.rejects(WalletChain.connect(undefined), /No browser wallet/);
  assert.equal(walletError(new Error('insufficient funds for gas * price + value')), 'Not enough ETH in this account for the value plus gas.');
});
