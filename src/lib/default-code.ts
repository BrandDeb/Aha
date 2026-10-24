/** The program a new project starts with. Kept apart from the template catalogue so the editor doesn't load every template just to start. */
export const DEFAULT_CODE = `// NanoCLI Studio — write TypeScript, get a native binary.
// Press Run to try it (arguments go in the field next to Run), or Build for a native binary.

const args = process.argv.slice(2);
const name = args[0] ?? 'World';

console.log(\`Hello, \${name}!\`);

function add(a: number, b: number): number {
  return a + b;
}

console.log(\`3 + 5 = \${add(3, 5)}\`);
`;
