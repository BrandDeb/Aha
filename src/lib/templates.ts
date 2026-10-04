/**
 * Starter programs shown in the studio.
 *
 * Every template is plain TypeScript that scriptc compiles to a native
 * executable (tests/templates.test.ts builds each one), so stick to the
 * supported surface: narrow `catch` bindings before reading them, avoid
 * `eval`/`Function`, and use ES module syntax instead of `module.exports`.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Entry file */
  filename: string;
  /** Entry file content */
  code: string;
  /** Additional project files (path -> content) for multi-file templates */
  files?: Record<string, string>;
}

/** All files of a template as a project, entry under src/ */
export function templateFiles(template: Template): { files: Record<string, string>; entry: string } {
  const entry = template.filename.includes('/') ? template.filename : `src/${template.filename}`;
  return { files: { [entry]: template.code, ...template.files }, entry };
}

export const DEFAULT_CODE = `// NanoCLI Studio — write TypeScript, get a native binary.
// Click "Compile" to build it with scriptc.

const args = process.argv.slice(2);
const name = args[0] ?? 'World';

console.log(\`Hello, \${name}!\`);

function add(a: number, b: number): number {
  return a + b;
}

console.log(\`3 + 5 = \${add(3, 5)}\`);
`;

export const TEMPLATES: Template[] = [
  {
    id: 'modular-cli',
    name: 'Modular CLI',
    description: 'A multi-file tool: argument parsing, formatting and a help screen',
    filename: 'src/main.ts',
    code: `import { parseArgs, HELP } from './args';
import { banner, table } from './lib/format';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const greeting = \`Hello, \${options.name}!\`;
console.log(banner(options.shout ? greeting.toUpperCase() : greeting));
console.log(table([
  ['name', options.name],
  ['shout', String(options.shout)],
  ['repeat', String(options.repeat)],
]));

for (let i = 1; i < options.repeat; i++) {
  console.log(greeting);
}
`,
    files: {
      'src/args.ts': `export interface Options {
  name: string;
  shout: boolean;
  repeat: number;
  help: boolean;
}

export const HELP = \`Usage: greet [name] [--shout] [--repeat N]

Options:
  --shout       Print the greeting in capitals
  --repeat N    Print the greeting N times (default 1)
  --help        Show this help\`;

export function parseArgs(argv: string[]): Options {
  const options: Options = { name: 'World', shout: false, repeat: 1, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--shout') options.shout = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--repeat') options.repeat = Math.max(1, Number(argv[++i] ?? '1') || 1);
    else if (!arg.startsWith('-')) options.name = arg;
  }
  return options;
}
`,
      'src/lib/format.ts': `export function banner(text: string): string {
  const line = '─'.repeat(text.length + 2);
  return \`┌\${line}┐\\n│ \${text} │\\n└\${line}┘\`;
}

export function table(rows: string[][]): string {
  const width = Math.max(...rows.map((row) => row[0].length));
  return rows.map(([key, value]) => \`\${key.padEnd(width)}  \${value}\`).join('\\n');
}
`,
      'package.json': `{
  "name": "greet",
  "version": "0.1.0",
  "description": "A multi-file scriptc CLI",
  "bin": { "greet": "src/main.ts" },
  "scripts": { "build": "scriptc build src/main.ts -o greet --strip" }
}
`,
    },
  },
  {
    id: 'hello',
    name: 'Hello World',
    description: 'Greets the name passed on the command line',
    filename: 'hello.ts',
    code: `const name = process.argv[2] ?? 'World';
console.log(\`Hello, \${name}!\`);
`,
  },
  {
    id: 'calculator',
    name: 'CLI Calculator',
    description: 'Recursive-descent parser for + - * / and parentheses',
    filename: 'calc.ts',
    code: `// Usage: calc "2 * (3 + 4)"
class Parser {
  private pos = 0;
  constructor(private readonly input: string) {}

  parse(): number {
    const value = this.expression();
    this.skipSpaces();
    if (this.pos < this.input.length) {
      throw new Error(\`Unexpected '\${this.input[this.pos]}' at \${this.pos + 1}\`);
    }
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      this.skipSpaces();
      const op = this.input[this.pos];
      if (op !== '+' && op !== '-') return value;
      this.pos++;
      const rhs = this.term();
      value = op === '+' ? value + rhs : value - rhs;
    }
  }

  private term(): number {
    let value = this.factor();
    for (;;) {
      this.skipSpaces();
      const op = this.input[this.pos];
      if (op !== '*' && op !== '/') return value;
      this.pos++;
      const rhs = this.factor();
      if (op === '/' && rhs === 0) throw new Error('Division by zero');
      value = op === '*' ? value * rhs : value / rhs;
    }
  }

  private factor(): number {
    this.skipSpaces();
    const ch = this.input[this.pos];
    if (ch === '-') {
      this.pos++;
      return -this.factor();
    }
    if (ch === '(') {
      this.pos++;
      const value = this.expression();
      this.skipSpaces();
      if (this.input[this.pos] !== ')') throw new Error('Missing closing parenthesis');
      this.pos++;
      return value;
    }
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) this.pos++;
    if (start === this.pos) throw new Error(\`Expected a number at \${start + 1}\`);
    return Number(this.input.slice(start, this.pos));
  }

  private skipSpaces(): void {
    while (this.input[this.pos] === ' ') this.pos++;
  }
}

const expression = process.argv.slice(2).join(' ');
if (!expression) {
  console.error('Usage: calc "1 + 2 * 3"');
  process.exit(1);
}

try {
  console.log(\`\${expression} = \${new Parser(expression).parse()}\`);
} catch (err) {
  console.error(\`Error: \${err instanceof Error ? err.message : String(err)}\`);
  process.exit(1);
}
`,
  },
  {
    id: 'word-count',
    name: 'Word Count',
    description: 'A tiny wc: lines, words and bytes of a file',
    filename: 'wc.ts',
    code: `import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: wc <file>');
  process.exit(1);
}

try {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\\n').length - (text.endsWith('\\n') ? 1 : 0);
  const words = text.split(/\\s+/).filter((word) => word.length > 0).length;
  const bytes = Buffer.byteLength(text, 'utf8');
  console.log(\`\${lines} lines  \${words} words  \${bytes} bytes  \${file}\`);
} catch (err) {
  console.error(\`Error: \${err instanceof Error ? err.message : String(err)}\`);
  process.exit(1);
}
`,
  },
  {
    id: 'json-format',
    name: 'JSON Formatter',
    description: 'Validates and pretty-prints a JSON file',
    filename: 'json-format.ts',
    code: `import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Usage: json-format <input.json> [output.json]');
  process.exit(1);
}

try {
  const pretty = JSON.stringify(JSON.parse(readFileSync(input, 'utf8')), null, 2);
  if (output) {
    writeFileSync(output, pretty + '\\n');
    console.log(\`Formatted JSON saved to \${output}\`);
  } else {
    console.log(pretty);
  }
} catch (err) {
  console.error(\`Error: \${err instanceof Error ? err.message : String(err)}\`);
  process.exit(1);
}
`,
  },
  {
    id: 'math',
    name: 'Math Utilities',
    description: 'Typed arithmetic with a dispatch table',
    filename: 'math.ts',
    code: `type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

const operations: Record<Operation, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
};

function isOperation(value: string): value is Operation {
  return value === 'add' || value === 'subtract' || value === 'multiply' || value === 'divide';
}

const [left, right, op = 'add'] = process.argv.slice(2);
if (left === undefined || right === undefined || !isOperation(op)) {
  console.log('Usage: math <a> <b> [add|subtract|multiply|divide]');
  process.exit(1);
}

try {
  const a = Number(left);
  const b = Number(right);
  console.log(\`\${a} \${op} \${b} = \${operations[op](a, b)}\`);
} catch (err) {
  console.error(\`Error: \${err instanceof Error ? err.message : String(err)}\`);
  process.exit(1);
}
`,
  },
  {
    id: 'fibonacci',
    name: 'Fibonacci Benchmark',
    description: 'CPU-bound recursion to compare native speed with Node',
    filename: 'fib.ts',
    code: `function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

const n = Number(process.argv[2] ?? '32');
const start = performance.now();
const result = fib(n);
const elapsed = performance.now() - start;

console.log(\`fib(\${n}) = \${result} in \${elapsed.toFixed(1)}ms\`);
`,
  },
  {
    id: 'http-server',
    name: 'HTTP Server',
    description: 'A native web server with no runtime attached',
    filename: 'server.ts',
    code: `import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? '3000');

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Hello from a scriptc binary', path: req.url }));
});

server.listen(port, () => {
  console.log(\`Listening on http://localhost:\${port}\`);
});
`,
  },
  {
    id: 'api-client',
    name: 'API Client',
    description: 'Fetches a URL and prints the JSON response',
    filename: 'fetch.ts',
    code: `async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: fetch <url>');
    process.exit(1);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}\`);
    }
    const body = await response.text();
    console.log(body);
  } catch (err) {
    console.error(\`Error: \${err instanceof Error ? err.message : String(err)}\`);
    process.exit(1);
  }
}

main();
`,
  },
  {
    id: 'countdown',
    name: 'Countdown Timer',
    description: 'Async/await with timers',
    filename: 'countdown.ts',
    code: `function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countdown(seconds: number): Promise<void> {
  for (let remaining = seconds; remaining > 0; remaining--) {
    console.log(\`\${remaining}...\`);
    await sleep(1000);
  }
  console.log('Liftoff!');
}

countdown(Number(process.argv[2] ?? '3'));
`,
  },
];
