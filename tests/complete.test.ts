import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCompletion, CompletionCache, completionPrompt, relatedFiles, shouldComplete } from '../src/lib/complete.ts';

test('complete: the prompt marks the cursor and includes imported files', () => {
  const files = { 'src/main.ts': "import { add } from './math';\nconst x = ", 'src/math.ts': 'export const add = (a: number, b: number) => a + b;\n' };
  const related = relatedFiles('src/main.ts', files);
  assert.deepEqual(related.map((r) => r.path), ['src/math.ts']);
  const prompt = completionPrompt({ path: 'src/main.ts', language: 'typescript', prefix: files['src/main.ts'], suffix: ';\n', related });
  assert.match(prompt, /--- src\/math\.ts \(for reference\) ---\nexport const add/);
  assert.match(prompt, /const x = <CURSOR\/>;\n$/);
});

test('complete: cleans fences, echoes and what is already after the cursor', () => {
  const prefix = 'function total(items: number[]) {\n  return items.re';
  assert.equal(cleanCompletion('```ts\nduce((a, b) => a + b, 0);\n```', prefix, '\n}\n'), 'duce((a, b) => a + b, 0);');
  // The model restated the current line
  assert.equal(cleanCompletion('  return items.reduce((a, b) => a + b, 0);', prefix, '\n}'), 'duce((a, b) => a + b, 0);');
  // It also wrote the closing brace that is already there
  assert.equal(cleanCompletion('duce((a, b) => a + b, 0);\n}', prefix, '\n}\n'), 'duce((a, b) => a + b, 0);');
  // The rest of the line is already typed
  assert.equal(cleanCompletion('a, b);', 'add(', 'b);'), 'a, ');
  assert.equal(cleanCompletion('   \n ', prefix, ''), '');
  // Restated and re-indented after other code on the line
  assert.equal(cleanCompletion('  return items.reduce((s, n) => s + n, 0);', 'x\n} return items.re', ''), 'duce((s, n) => s + n, 0);');
  // A word that merely appears in the answer is not an echo
  assert.equal(cleanCompletion('ntity = 1;', 'const qua', ''), 'ntity = 1;');
  assert.equal(cleanCompletion(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 'x\n', '').split('\n').length, 12);
});

test('complete: when to ask, and the cache', () => {
  assert.equal(shouldComplete('', ''), false);
  assert.equal(shouldComplete('const x = ', ''), true);
  assert.equal(shouldComplete('const na', 'me = 1'), false);
  assert.equal(shouldComplete('x = 1 // ', '\n'), false);
  const cache = new CompletionCache(2);
  cache.set('a', '1');
  cache.set('b', '2');
  cache.get('a');
  cache.set('c', '3');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), '1');
});
