'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatSize } from '@/lib/compiler-browser';
import { useActions } from '../actions';
import { allFolders, basename, buildTree, diffStatus, isFolder, isPython, isRunnable, resolvePath, type TreeNode } from '../project';
import { detectLanguage } from '@/lib/languages';
import { streamPython, type PythonCommand, type PythonOutcome, type PythonStream } from '../python-client';
import { fetchLanguages } from '../run-client';
import { useWorkspace } from '../store';

type LineKind = 'in' | 'out' | 'err' | 'sys';
interface Line {
  id: number;
  kind: LineKind;
  text: string;
}

const HELP = `Commands
  ls [dir]              list files            tree             show the project tree
  cd <dir>              change directory      pwd              print working directory
  cat <file>            print a file          touch <file>     create an empty file
  mkdir <dir>           create a folder       rm [-r] <path>   delete a file or folder
  mv <from> <to>        move or rename        cp <from> <to>   copy a file
  echo <text> [> file]  print or write text   open <file>      open in the editor
  build [file]          compile a native executable with scriptc
  run [file] [args…]    TypeScript: compile to WASM and run it here · Python: run with uv ·
                        Go, Rust, Java, C, Ruby, PHP… run with their own toolchain (Ctrl+C stops)
  languages             which languages this machine can run, and how to install the rest
  uv add <pkg…> [--dev] uv remove <pkg…>  uv sync  uv lock [--upgrade]  uv tree
  uv init [name]        uv python pin 3.12      uv run <file.py> [args…]
  python <file.py> [args…]   run a Python file with uv
  install-uv            download uv here if it isn't installed
  entry [file]          show or set the entry file
  format [file]         format with Prettier  git status       changes since last pull
  history  clear  date  whoami  help
Redirect output with > or >>, e.g.  run src/main.ts --help > help.txt`;

/** Split a command line into words, honouring single and double quotes */
export function tokenize(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || current) words.push(current);
      current = '';
      has = false;
    } else {
      current += ch;
    }
  }
  if (has || current) words.push(current);
  return words;
}

function renderTree(nodes: TreeNode[], prefix = ''): string[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1;
    const line = `${prefix}${last ? '└── ' : '├── '}${node.name}${node.type === 'folder' ? '/' : ''}`;
    return [line, ...(node.type === 'folder' ? renderTree(node.children, prefix + (last ? '    ' : '│   ')) : [])];
  });
}

export function Terminal({ user, registerRunner }: { user?: string; registerRunner?: (run: (command: string) => void) => void }) {
  const { project, git, dispatch } = useWorkspace();
  const actions = useActions();
  const [lines, setLines] = useState<Line[]>([
    { id: 0, kind: 'sys', text: 'NanoCLI shell — type help. `run` compiles your project to WASM and executes it in this tab.' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(1);
  const projectRef = useRef(project);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const print = useCallback((text: string, kind: LineKind = 'out') => {
    setLines((prev) => [...prev.slice(-1500), ...text.split('\n').map((t) => ({ id: idRef.current++, kind, text: t }))]);
  }, []);

  const prompt = `${user ?? 'you'}@nanocli:~${cwd ? `/${cwd}` : ''}$`;

  const execute = useCallback(async (raw: string) => {
    const p = projectRef.current;
    let words = tokenize(raw.trim());
    if (!words.length) return;

    // Output redirection: cmd args > file | >> file
    let redirect: { path: string; append: boolean } | null = null;
    const r = words.findIndex((w) => w === '>' || w === '>>');
    if (r !== -1) {
      const target = words[r + 1] ? resolvePath(cwd, words[r + 1]) : null;
      if (!target) {
        print('redirect: missing or invalid file name', 'err');
        return;
      }
      redirect = { path: target, append: words[r] === '>>' };
      words = words.slice(0, r);
    }
    const captured: string[] = [];
    const out = (text: string) => (redirect ? captured.push(text) : print(text));
    const err = (text: string) => print(text, 'err');
    const resolve = (target: string | undefined, fallback = cwd) => (target === undefined ? fallback : resolvePath(cwd, target));

    const [command, ...args] = words;

    /** Run a command on the server, printing its output as it arrives and reporting how it ended */
    const runStreamed = async (shown: string, start: (onOutput: (stream: PythonStream, text: string) => void, signal: AbortSignal) => Promise<PythonOutcome>) => {
      print(shown, 'sys');
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      // Output arrives in arbitrary chunks: hold back partial lines until they are complete
      const partial: Record<PythonStream, string> = { stdout: '', stderr: '', info: '' };
      const emit = (stream: PythonStream, line: string) => {
        if (stream === 'stdout') out(line);
        else print(line, stream === 'info' ? 'sys' : 'out');
      };
      const onOutput = (stream: PythonStream, text: string) => {
        const pieces = (partial[stream] + text).split('\n');
        partial[stream] = pieces.pop() ?? '';
        for (const line of pieces) emit(stream, line.replace(/\r$/, ''));
      };
      const outcome = await start(onOutput, controller.signal);
      for (const stream of ['stdout', 'stderr', 'info'] as const) if (partial[stream]) emit(stream, partial[stream]);
      abortRef.current = null;
      setBusy(false);
      if (outcome.error === 'stopped') return;
      if (outcome.error) {
        err(outcome.error);
        if (/uv isn’t installed/.test(outcome.error)) print('Type install-uv to download it into the studio.', 'sys');
        return;
      }
      const seconds = outcome.ms >= 1000 ? `${(outcome.ms / 1000).toFixed(1)} s` : `${outcome.ms} ms`;
      if (outcome.timedOut) err(`Timed out after ${seconds}`);
      else if (outcome.code === 0) print(`exit 0 · ${seconds}`, 'sys');
      else err(`exit ${outcome.code ?? '?'} · ${seconds}`);
      const written = Object.keys(outcome.changed).filter((f) => !['pyproject.toml', 'uv.lock', '.python-version'].includes(f));
      if (written.length) print(`→ wrote ${written.join(', ')}`, 'sys');
      if (outcome.skipped.length) print(`not copied back (binary or large): ${outcome.skipped.slice(0, 6).join(', ')}${outcome.skipped.length > 6 ? '…' : ''}`, 'sys');
    };

    const runPythonCommand = (cmd: PythonCommand, shown: string) => runStreamed(shown, (onOutput, signal) => actions.python(cmd, onOutput, signal));

    /** `run` on an entry in one of the other languages */
    const runLanguageFile = (file: string, programArgs: string[], name: string) =>
      runStreamed(`${name}: ${file}${programArgs.length ? ` ${programArgs.join(' ')}` : ''}`, (onOutput, signal) => actions.runLanguage({ entry: file, args: programArgs }, onOutput, signal));

    /** `python <file>` / `uv run <file>` / `run` on a .py entry */
    const runPythonFile = async (fileArg: string | undefined, programArgs: string[]) => {
      const file = fileArg ? resolve(fileArg) : p.entry && isPython(p.entry) ? p.entry : null;
      if (!file || !(file in p.files) || !isPython(file)) {
        err(fileArg ? `${fileArg}: not a Python file in this project` : 'usage: python <file.py> [args…]');
        return;
      }
      await runPythonCommand({ action: 'run', entry: file, args: programArgs }, `uv run ${file}${programArgs.length ? ` ${programArgs.join(' ')}` : ''}`);
    };

    switch (command) {
      case 'help':
        out(HELP);
        break;
      case 'clear':
        setLines([]);
        return;
      case 'pwd':
        out(`/${cwd}`);
        break;
      case 'date':
        out(new Date().toString());
        break;
      case 'whoami':
        out(user ?? 'you (sign in with GitHub to use your username)');
        break;
      case 'history':
        out(history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n') || '(empty)');
        break;
      case 'echo':
        out(args.join(' '));
        break;
      case 'ls': {
        const dir = resolve(args.find((a) => !a.startsWith('-')));
        if (dir === null || !isFolder(p, dir)) {
          err(`ls: ${args[0]}: no such directory`);
          break;
        }
        const prefix = dir ? `${dir}/` : '';
        const entries = new Set<string>();
        for (const folder of allFolders(p)) if (folder.startsWith(prefix) && !folder.slice(prefix.length).includes('/') && folder !== dir) entries.add(`${basename(folder)}/`);
        for (const file of Object.keys(p.files)) if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) entries.add(basename(file));
        const list = [...entries].sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1));
        if (args.includes('-l') || args.includes('-la')) {
          out(list.map((name) => {
            const full = prefix + name.replace(/\/$/, '');
            const size = name.endsWith('/') ? '-' : String(new TextEncoder().encode(p.files[full] ?? '').length);
            return `${name.endsWith('/') ? 'd' : '-'}  ${size.padStart(7)}  ${name}${full === p.entry ? '  (entry)' : ''}`;
          }).join('\n') || '(empty)');
        } else {
          out(list.join('  ') || '(empty)');
        }
        break;
      }
      case 'tree':
        out(['.', ...renderTree(buildTree(p))].join('\n'));
        break;
      case 'cd': {
        const dir = resolve(args[0], '');
        if (dir === null || !isFolder(p, dir)) err(`cd: ${args[0]}: no such directory`);
        else setCwd(dir);
        break;
      }
      case 'cat': {
        if (!args.length) { err('usage: cat <file>'); break; }
        for (const a of args) {
          const file = resolve(a);
          if (file !== null && file in p.files) out(p.files[file].replace(/\n$/, ''));
          else err(`cat: ${a}: no such file`);
        }
        break;
      }
      case 'touch':
        for (const a of args) {
          const file = resolve(a);
          if (file && !(file in p.files)) dispatch({ type: 'create', path: file, content: '' });
          else if (!file) err(`touch: ${a}: invalid path`);
        }
        break;
      case 'mkdir':
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          const dir = resolve(a);
          if (dir) dispatch({ type: 'mkdir', path: dir });
          else err(`mkdir: ${a}: invalid path`);
        }
        break;
      case 'rm': {
        const recursive = args.some((a) => /^-\w*r/.test(a));
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          const target = resolve(a);
          if (target && target in p.files) dispatch({ type: 'delete', path: target });
          else if (target && isFolder(p, target)) {
            if (recursive) dispatch({ type: 'delete', path: target });
            else err(`rm: ${a}: is a directory (use rm -r)`);
          } else err(`rm: ${a}: no such file or directory`);
        }
        break;
      }
      case 'mv':
      case 'cp': {
        const [from, to] = args.map((a) => resolve(a));
        if (!from || !to) { err(`usage: ${command} <from> <to>`); break; }
        const destination = isFolder(p, to) && !(to in p.files) ? [to, basename(from)].filter(Boolean).join('/') : to;
        if (command === 'mv') dispatch({ type: 'move', from, to: destination });
        else if (from in p.files) dispatch({ type: 'create', path: destination, content: p.files[from] });
        else err(`cp: ${args[0]}: no such file`);
        break;
      }
      case 'open': {
        const file = resolve(args[0]);
        if (file && file in p.files) dispatch({ type: 'open', path: file });
        else err(`open: ${args[0] ?? ''}: no such file`);
        break;
      }
      case 'entry': {
        if (!args[0]) { out(p.entry || '(none)'); break; }
        const file = resolve(args[0]);
        if (file && file in p.files && isRunnable(file)) { dispatch({ type: 'setEntry', path: file }); out(`entry is now ${file}`); }
        else err(`entry: ${args[0]}: not a TypeScript or JavaScript file in the project`);
        break;
      }
      case 'format': {
        const file = args[0] ? resolve(args[0]) : undefined;
        if (file === null) { err('format: invalid path'); break; }
        out((await actions.format(file)) ? `formatted ${file ?? 'active file'}` : 'format: nothing to format');
        break;
      }
      case 'git': {
        if (args[0] !== 'status') { err('git: only `git status` runs here — use the Git panel to pull, diff and commit'); break; }
        if (!git) { out('not linked to a repository — open the Git panel to pull one'); break; }
        const changes = diffStatus(git.base, p.files);
        const entries = Object.entries(changes);
        out([`On branch ${git.branch} (${git.owner}/${git.repo})`, entries.length ? '' : 'nothing to commit, working tree clean', ...entries.map(([f, k]) => `  ${k.padEnd(9)} ${f}`)].join('\n'));
        break;
      }
      case 'build': {
        const entry = args[0] ? resolve(args[0]) : undefined;
        if (entry === null || (entry && !(entry in p.files))) { err(`build: ${args[0]}: no such file`); break; }
        if (isPython(entry ?? p.entry)) { err('build: Python has no compile step. Use run (or python <file>).'); break; }
        print(`scriptc build ${entry ?? p.entry}`, 'sys');
        setBusy(true);
        const result = await actions.compile({ target: 'exe', entry: entry ?? undefined, quiet: true });
        setBusy(false);
        if (!result) break;
        if (result.success) out(`✓ ${result.filename?.replace(/^[0-9a-f]{32}-/, '')}  ${formatSize(result.size)}  ${result.durationMs}ms — download it from the Build panel`);
        else err(result.diagnostics?.length
          ? result.diagnostics.map((d) => `${d.file ?? entry ?? p.entry}:${d.line}:${d.column} ${d.code} ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ''}`).join('\n')
          : `✕ ${result.error}`);
        break;
      }
      case 'uv': {
        const [sub, ...rest] = args;
        const flags = rest.filter((a) => a.startsWith('-'));
        const words2 = rest.filter((a) => !a.startsWith('-'));
        const dev = flags.includes('--dev') || flags.includes('-d');
        const shown = `uv ${args.join(' ')}`;
        switch (sub) {
          case 'add':
            if (!words2.length) err('usage: uv add <package…> [--dev]   e.g. uv add httpx "rich>=13"');
            else await runPythonCommand({ action: 'add', packages: words2, dev }, shown);
            break;
          case 'remove':
            if (!words2.length) err('usage: uv remove <package…> [--dev]');
            else await runPythonCommand({ action: 'remove', packages: words2, dev }, shown);
            break;
          case 'sync':
          case 'tree':
            await runPythonCommand({ action: sub }, shown);
            break;
          case 'lock':
            await runPythonCommand({ action: 'lock', upgrade: flags.includes('--upgrade') || flags.includes('-U') }, shown);
            break;
          case 'init':
            await runPythonCommand({ action: 'init', name: words2[0] }, shown);
            break;
          case 'python':
            if (words2[0] === 'pin' && words2[1]) await runPythonCommand({ action: 'pin', version: words2[1] }, shown);
            else err('usage: uv python pin <version>   e.g. uv python pin 3.12');
            break;
          case 'pip':
            if (words2[0] === 'install' && words2.length > 1) {
              print('The studio manages packages in pyproject.toml: running uv add instead.', 'sys');
              await runPythonCommand({ action: 'add', packages: words2.slice(1), dev }, `uv add ${words2.slice(1).join(' ')}`);
            } else err('usage: uv add <package…>');
            break;
          case 'run':
            await runPythonFile(words2[0], rest.slice(rest.indexOf(words2[0]) + 1));
            break;
          default:
            err(sub ? `uv ${sub}: not supported here. Try: uv add, remove, sync, lock, tree, init, python pin, run` : 'usage: uv <add|remove|sync|lock|tree|init|python pin|run> …');
        }
        break;
      }
      case 'python':
      case 'python3':
        await runPythonFile(args[0], args.slice(1));
        break;
      case 'pip':
      case 'pip3':
        err('pip isn’t used here — packages live in pyproject.toml. Use: uv add <package>');
        break;
      case 'languages': {
        const info = await fetchLanguages();
        if (!info) err('Could not reach the studio server.');
        else if (!info.enabled) out('Running other languages is off on this server (it only runs programs when it listens on your own machine).');
        else out(info.languages.map((l) => `${l.available ? '✓' : '·'} ${l.name.padEnd(30)} ${l.available ? (l.version ?? l.tool ?? '') : `not installed — ${l.install[navigator.platform.startsWith('Win') ? 'windows' : /Mac/.test(navigator.platform) ? 'mac' : 'linux']}`}`).join('\n'));
        break;
      }
      case 'install-uv': {
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        const done = await streamPython({ action: 'install-uv' }, (_stream, text) => text.split('\n').filter(Boolean).forEach((l) => print(l, 'sys')), controller.signal);
        abortRef.current = null;
        setBusy(false);
        if (done.error && done.error !== 'stopped') err(done.error);
        else if (!done.error) out(`✓ uv ${done.uv ?? ''} is ready. Try: uv add <package>`);
        break;
      }
      case 'run': {
        // `run [file] [args…]`: the first word is a file only if it doesn't look like a flag
        const explicit = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
        const explicitPath = explicit ? resolve(explicit) : null;
        const isPythonRun = explicit ? !!explicitPath && isPython(explicitPath) : !!p.entry && isPython(p.entry);
        if (isPythonRun) {
          await runPythonFile(explicit, explicit ? args.slice(1) : args);
          break;
        }
        const languageFile = explicit ? explicitPath : p.entry;
        const language = languageFile && languageFile in p.files ? detectLanguage(languageFile, Object.keys(p.files)) : null;
        if (language && languageFile) {
          await runLanguageFile(languageFile, explicit ? args.slice(1) : args, language.name);
          break;
        }
        let entry: string | undefined;
        let programArgs = args;
        if (args[0] && !args[0].startsWith('-')) {
          const candidate = resolve(args[0]);
          if (candidate && candidate in p.files) {
            entry = candidate;
            programArgs = args.slice(1);
          }
        }
        const target = entry ?? p.entry;
        if (!target) { err('run: no entry file — create one or pass a file'); break; }
        print(`scriptc build ${target} --target wasm32-wasi && ./${basename(target).replace(/\.\w+$/, '')}${programArgs.length ? ` ${programArgs.join(' ')}` : ''}`, 'sys');
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        let sawUsage = false;
        const outcome = await actions.run(
          [basename(target).replace(/\.\w+$/, ''), ...programArgs],
          (stream, line) => {
            if (/^usage:/i.test(line.trim())) sawUsage = true;
            if (stream === 'stdout') out(line);
            else err(line);
          },
          { entry: target, signal: controller.signal }
        );
        abortRef.current = null;
        setBusy(false);
        if (outcome.ok) {
          print(`exit ${outcome.code} · ${outcome.ms?.toFixed(1)} ms · ${formatSize(outcome.memoryBytes)} linear memory`, 'sys');
          if (outcome.code && sawUsage && !programArgs.length) print('This program expects arguments — pass them after run, e.g. run <args>', 'sys');
        } else if (outcome.message) {
          err(outcome.message);
        }
        break;
      }
      default:
        err(`${command}: command not found — try help`);
    }

    if (redirect) {
      const text = captured.join('\n') + (captured.length ? '\n' : '');
      const existing = projectRef.current.files[redirect.path];
      if (existing === undefined) dispatch({ type: 'create', path: redirect.path, content: text });
      else dispatch({ type: 'write', path: redirect.path, content: redirect.append ? existing + text : text });
      print(`wrote ${redirect.path}`, 'sys');
    }
  }, [cwd, history, print, dispatch, actions, git, user]);

  // Let the toolbar/shortcuts type a command into this terminal
  useEffect(() => {
    registerRunner?.((command: string) => {
      if (busy) return;
      print(`${prompt} ${command}`, 'in');
      void execute(command);
      inputRef.current?.focus();
    });
  }, [registerRunner, busy, print, prompt, execute]);

  const submit = async () => {
    const raw = input;
    setInput('');
    setHistoryIndex(null);
    print(`${prompt} ${raw}`, 'in');
    if (raw.trim()) setHistory((prev) => [...prev.filter((h) => h !== raw), raw].slice(-200));
    await execute(raw);
  };

  const complete = () => {
    const words = tokenize(input);
    const partial = input.endsWith(' ') ? '' : words[words.length - 1] ?? '';
    const base = partial.includes('/') ? partial.slice(0, partial.lastIndexOf('/') + 1) : '';
    const dir = resolvePath(cwd, base || '.') ?? '';
    const prefix = dir ? `${dir}/` : '';
    const candidates = [
      ...allFolders(project).filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/')).map((f) => `${basename(f)}/`),
      ...Object.keys(project.files).filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/')).map(basename),
    ].filter((name) => name.startsWith(partial.slice(base.length)));
    if (candidates.length === 1) {
      setInput(input.slice(0, input.length - partial.length) + base + candidates[0]);
    } else if (candidates.length > 1) {
      print(candidates.join('  '), 'sys');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !busy) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'c' && e.ctrlKey) {
      if (abortRef.current) {
        e.preventDefault();
        abortRef.current.abort();
        print('^C', 'sys');
      } else if (!window.getSelection()?.toString()) {
        e.preventDefault();
        print(`${prompt} ${input}^C`, 'in');
        setInput('');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  return (
    <div className="flex h-full flex-col font-mono text-[12.5px] leading-[1.6]" onMouseUp={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus(); }}>
      <div ref={scrollRef} role="log" aria-label="Terminal output" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap break-words ${
              line.kind === 'in' ? 'text-gray-100' : line.kind === 'err' ? 'text-danger' : line.kind === 'sys' ? 'text-gray-500' : 'text-gray-300'
            }`}
          >
            {line.text || ' '}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 pt-1 pb-3">
        <label htmlFor="terminal-input" className="shrink-0 text-accent">{busy ? '…' : prompt}</label>
        <input
          id="terminal-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal command"
          className="min-w-0 flex-1 bg-transparent text-gray-100 caret-accent outline-none"
          placeholder={busy ? 'running — Ctrl+C to stop' : ''}
        />
      </div>
    </div>
  );
}
