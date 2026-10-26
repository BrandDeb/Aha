import type { CompileTarget } from '@/types';

export interface TargetInfo {
  value: CompileTarget;
  /** Full name in the menu */
  label: string;
  /** Compact name for the toolbar */
  short: string;
  hint: string;
  /** Language used to show the output */
  language: 'llvm' | 'asm' | 'json' | 'wat' | 'hex';
  /** Open the output in the viewer right after a successful build */
  inspect: boolean;
}

export const TARGET_GROUPS: { label: string; items: TargetInfo[] }[] = [
  {
    label: 'Run it',
    items: [
      { value: 'exe', label: 'Native executable', short: 'Native', hint: 'One file for the machine the studio runs on', language: 'hex', inspect: false },
      { value: 'wasm', label: 'WebAssembly module', short: 'WASM', hint: 'Portable .wasm for any WASI runtime; what the terminal runs', language: 'hex', inspect: false },
    ],
  },
  {
    label: 'Inspect',
    items: [
      { value: 'llvm', label: 'LLVM IR', short: 'LLVM', hint: 'Textual LLVM IR', language: 'llvm', inspect: true },
      { value: 'ir', label: 'scriptc IR (JSON)', short: 'IR', hint: 'scriptc’s typed intermediate representation', language: 'json', inspect: true },
      { value: 'asm', label: 'Assembly', short: 'ASM', hint: 'Target assembly', language: 'asm', inspect: true },
      { value: 'wat', label: 'WebAssembly text (WAT)', short: 'WAT', hint: 'A readable view of the compiled WASM', language: 'wat', inspect: true },
      { value: 'obj', label: 'Object file', short: 'OBJ', hint: 'Linkable .o, shown as bytes', language: 'hex', inspect: true },
    ],
  },
  {
    label: 'Libraries',
    items: [
      { value: 'lib', label: 'Static library (.a)', short: 'LIB', hint: 'Linkable archive from a scriptc.profile.json', language: 'hex', inspect: false },
      { value: 'reactor', label: 'WASM reactor', short: 'Reactor', hint: 'Callable WebAssembly library from a scriptc.profile.json', language: 'hex', inspect: false },
    ],
  },
];

const ALL = TARGET_GROUPS.flatMap((g) => g.items);

export function targetInfo(value: CompileTarget): TargetInfo {
  return ALL.find((t) => t.value === value) ?? ALL[0];
}

export interface BuildOptions {
  optimization: 'release' | 'dev';
  strip: boolean;
  sanitize: boolean;
  dynamic: boolean;
  windowsSubsystem: 'console' | 'gui';
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  optimization: 'release',
  strip: true,
  sanitize: false,
  dynamic: false,
  windowsSubsystem: 'console',
};
