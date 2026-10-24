// Bakes README.md into src/lib/docs-readme.ts, so the /docs pages need no file access at build or run
// time (reading files from process.cwd() makes the bundler trace the whole project). Runs before
// every build; tests/docs.test.ts fails when the committed copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs';

// Line endings normalised, so the generated file is the same on Windows (CRLF checkouts) and everywhere else
const readme = readFileSync('README.md', 'utf8').replace(/\r\n?/g, '\n');
const out = `// Generated from README.md by scripts/build-docs.mjs (npm run docs:sync). Do not edit.\nexport const README = ${JSON.stringify(readme)};\n`;
const target = 'src/lib/docs-readme.ts';
let current = '';
try {
  current = readFileSync(target, 'utf8');
} catch {}
if (current !== out) {
  writeFileSync(target, out);
  console.log(`Updated ${target}`);
}
