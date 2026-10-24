/**
 * Quick static analysis for Solidity, like Remix's analysis plugin: the well-known pitfalls, found in the source
 * with their lines, each with why it matters and what to do instead. It is a first pass, not an audit: it can't
 * prove a contract safe, and heavier tools (Slither, Aderyn, Mythril) and the smart-contract-security skill go
 * further. Pure.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  file: string;
  line: number;
  text: string;
}

interface Rule {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  /** Per line; the whole source and line index for context */
  test: (line: string, i: number, lines: string[]) => boolean;
}

/** The function a line belongs to: its header line, found by walking back to the nearest "function" */
function functionHeader(lines: string[], i: number): string {
  for (let j = i; j >= 0 && i - j < 80; j--) {
    if (/^\s*(function|constructor|fallback|receive|modifier)\b/.test(lines[j])) {
      let header = '';
      for (let k = j; k < Math.min(lines.length, j + 6); k++) {
        header += ` ${lines[k]}`;
        if (lines[k].includes('{')) break;
      }
      return header;
    }
    if (/^\s*(contract|library|interface)\b/.test(lines[j])) return '';
  }
  return '';
}

/** Lines of the function body from line i to its end (by brace balance) */
function restOfFunction(lines: string[], i: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let j = i; j < lines.length && j - i < 120; j++) {
    out.push(lines[j]);
    depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
    if (depth < 0) break;
  }
  return out;
}

const RULES: Rule[] = [
  {
    id: 'tx-origin',
    severity: 'high',
    title: 'tx.origin used for authorisation',
    why: 'Any contract the owner calls can act as them: tx.origin is the wallet that started the transaction, not the caller.',
    fix: 'Use msg.sender (with Ownable or AccessControl).',
    test: (l) => /\btx\.origin\b/.test(l) && /(require|if|==|!=)/.test(l),
  },
  {
    id: 'reentrancy',
    severity: 'high',
    title: 'Value sent before state is updated',
    why: 'The receiver can call back in before the balance changes and withdraw again (the DAO hack).',
    fix: 'Update state first, then call (checks-effects-interactions), and add nonReentrant.',
    test: (l, i, lines) => {
      if (!/\.call\{\s*value\s*:|\.call\.value\(/.test(l)) return false;
      if (/nonReentrant/.test(functionHeader(lines, i))) return false;
      const after = restOfFunction(lines, i + 1);
      return after.some((x) => /^\s*[\w.\[\]]+\s*(\[[^\]]*\])*\s*(-=|\+=|=)(?!=)/.test(x) && !/\b(bool|uint|int|bytes|address|string)\b/.test(x));
    },
  },
  {
    id: 'unchecked-call',
    severity: 'medium',
    title: 'Low-level call whose result is ignored',
    why: 'call, delegatecall and send return false instead of reverting; ignoring it hides failed transfers.',
    fix: 'Check the result: (bool ok, ) = to.call{value: v}(""); require(ok, "transfer failed"); or use OpenZeppelin Address.sendValue.',
    test: (l) => /^\s*[\w.\[\]()]+\.(call|delegatecall|send)\s*(\{[^}]*\})?\s*\(/.test(l) && !/=\s*[\w.\[\]()]+\.(call|delegatecall|send)/.test(l) && !/require|if|return|bool/.test(l),
  },
  {
    id: 'delegatecall',
    severity: 'high',
    title: 'delegatecall',
    why: 'The called code runs with this contract’s storage and balance; a wrong or user-chosen target can take everything.',
    fix: 'Only delegatecall fixed, trusted addresses (a proxy pattern from OpenZeppelin), never one passed in.',
    test: (l) => /\.delegatecall\s*\(/.test(l),
  },
  {
    id: 'selfdestruct',
    severity: 'medium',
    title: 'selfdestruct',
    why: 'Deprecated (EIP-6780): since Cancun it no longer deletes code except in the creating transaction, and it can force-send ether.',
    fix: 'Remove it; pause the contract or move funds out explicitly instead.',
    test: (l) => /\bselfdestruct\s*\(|\bsuicide\s*\(/.test(l),
  },
  {
    id: 'weak-randomness',
    severity: 'medium',
    title: 'Randomness from block data',
    why: 'block.timestamp, blockhash and prevrandao are known to or influenced by validators; anyone can predict the "random" result.',
    fix: 'Use a verifiable randomness source such as Chainlink VRF, or commit-reveal.',
    test: (l) => /keccak256\s*\(.*\b(block\.timestamp|block\.prevrandao|block\.difficulty|blockhash)\b/.test(l) || /\b(block\.timestamp|block\.prevrandao)\s*%/.test(l),
  },
  {
    id: 'floating-pragma',
    severity: 'low',
    title: 'Floating pragma',
    why: 'The contract may be deployed with a different compiler than the one it was tested with.',
    fix: 'Pin the version for deployable contracts: pragma solidity 0.8.x;',
    test: (l) => /^\s*pragma\s+solidity\s+(\^|>=|>|~)/.test(l),
  },
  {
    id: 'transfer-send',
    severity: 'low',
    title: 'transfer / send forward only 2300 gas',
    why: 'Receivers that are contracts (multisigs, smart wallets) can fail to receive ether after gas repricings.',
    fix: 'Use call{value: amount}("") with a checked result and a reentrancy guard.',
    test: (l) => /\.(transfer|send)\s*\(\s*[\w.\[\]()]+\s*\)/.test(l) && /payable|address|msg\.sender|owner|to|recipient/.test(l) && !/IERC20|token|\.safeTransfer/.test(l),
  },
  {
    id: 'unbounded-loop',
    severity: 'low',
    title: 'Loop over a growing array',
    why: 'Once the array is large enough the function runs out of gas and can never succeed again.',
    fix: 'Paginate, cap the length, or let users pull instead of looping over everyone.',
    test: (l) => /for\s*\([^;]*;\s*\w+\s*<\s*[\w.]+\.length\s*;/.test(l) && !/memory|calldata/.test(l),
  },
  {
    id: 'unprotected-mint',
    severity: 'high',
    title: 'Mint, withdraw or ownership change without access control',
    why: 'Anyone can call it: mint unlimited tokens, drain funds or take over the contract.',
    fix: 'Restrict it: onlyOwner / onlyRole, or check msg.sender.',
    test: (l, i, lines) => {
      const m = l.match(/^\s*function\s+(mint|_?withdraw\w*|setOwner|transferOwnership|upgradeTo\w*|setAdmin|pause|unpause|burnFrom)\s*\(/);
      if (!m || !/\b(public|external)\b/.test(functionHeader(lines, i))) return false;
      const header = functionHeader(lines, i);
      if (/\bonly\w+|whenNotPaused|auth|requiresAuth/.test(header)) return false;
      return !restOfFunction(lines, i).slice(0, 8).some((x) => /msg\.sender|_checkOwner|_checkRole|hasRole|onlyOwner/.test(x));
    },
  },
  {
    id: 'ecrecover',
    severity: 'medium',
    title: 'Raw ecrecover',
    why: 'It returns address(0) for bad signatures and accepts malleable ones; signatures can be replayed without a nonce and domain.',
    fix: 'Use OpenZeppelin ECDSA.recover with EIP-712 typed data and a nonce.',
    test: (l) => /\becrecover\s*\(/.test(l),
  },
  {
    id: 'timestamp-equality',
    severity: 'info',
    title: 'Strict comparison with block.timestamp',
    why: 'A block is unlikely to land on an exact second.',
    fix: 'Compare with >= or <=.',
    test: (l) => /block\.timestamp\s*==|==\s*block\.timestamp/.test(l),
  },
  {
    id: 'assembly',
    severity: 'info',
    title: 'Inline assembly',
    why: 'Skips Solidity’s safety checks; mistakes corrupt memory or storage silently.',
    fix: 'Keep it minimal, commented, and covered by tests.',
    test: (l) => /\bassembly\s*(\("memory-safe"\)\s*)?\{/.test(l),
  },
];

/** Comments are blanked (keeping line numbers) so commented-out code isn't reported */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

export function analyzeSolidity(file: string, source: string): Finding[] {
  const lines = stripComments(source).split('\n');
  const raw = source.split('\n');
  const out: Finding[] = [];
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.test(line, i, lines)) out.push({ id: rule.id, severity: rule.severity, title: rule.title, why: rule.why, fix: rule.fix, file, line: i + 1, text: raw[i].trim().slice(0, 160) });
    }
  });
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
}

/** Every project contract */
export function analyzeProject(files: Record<string, string>): Finding[] {
  return Object.entries(files)
    .filter(([p]) => p.endsWith('.sol') && !/^lib\/|(^|\/)node_modules\//.test(p) && !/\.t\.sol$/.test(p))
    .flatMap(([p, s]) => analyzeSolidity(p, s));
}
