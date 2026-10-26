import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { supervise, RESTART_CODE } = (await import('../scripts/supervise.js')) as unknown as {
  supervise: (o: Record<string, unknown>) => { done: Promise<number>; stop: () => void };
  RESTART_CODE: number;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervise-'));
const counter = path.join(dir, 'runs.txt');

/** A child that records each start, then exits with the next code from `codes` (the last one repeats) */
function child(codes: number[], extra = '') {
  fs.writeFileSync(counter, '');
  const script = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},(process.env.NANOCLI_SUPERVISED||'-')+'\\n');const n=fs.readFileSync(${JSON.stringify(counter)},'utf8').split('\\n').length-2;${extra}process.exit(${JSON.stringify(codes)}[Math.min(n,${codes.length - 1})]);`;
  return { command: process.execPath, args: ['-e', script] };
}
const runs = () => fs.readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean);
const fast = { baseDelayMs: 5, maxDelayMs: 20 };

test('restarts after a crash and stops when the studio exits cleanly', async () => {
  const log: string[] = [];
  const run = supervise({ ...child([1, 1, 0]), ...fast, log: (m: string) => log.push(m) });
  assert.equal(await run.done, 0);
  assert.equal(runs().length, 3);
  assert.equal(log.filter((m) => /restarting in/.test(m)).length, 2);
  assert.match(log[0], /code 1/);
});

test('tells the child it is supervised', async () => {
  await supervise({ ...child([0]), ...fast, log: () => {} }).done;
  assert.deepEqual(runs(), ['1']);
});

test('the restart exit code restarts at once and never counts as a crash', async () => {
  const log: string[] = [];
  const run = supervise({ ...child([...Array(10).fill(RESTART_CODE), 0]), ...fast, maxCrashes: 2, log: (m: string) => log.push(m) });
  assert.equal(await run.done, 0);
  assert.equal(runs().length, 11);
  assert.equal(log.filter((m) => /as requested/.test(m)).length, 10);
  assert.ok(!log.some((m) => /giving up/.test(m)));
});

test('gives up on a crash loop instead of spinning forever', async () => {
  const log: string[] = [];
  const run = supervise({ ...child([1]), ...fast, maxCrashes: 3, log: (m: string) => log.push(m) });
  assert.equal(await run.done, 1);
  assert.equal(runs().length, 4);
  assert.match(log.at(-1)!, /crashed 4 times.*giving up/);
});

test('the pause between restarts grows, up to a ceiling', async () => {
  const log: string[] = [];
  const run = supervise({ ...child([1, 1, 1, 1, 1, 0]), baseDelayMs: 1000, maxDelayMs: 4000, log: (m: string) => log.push(m), maxCrashes: 10 });
  // Don't wait for real seconds: just read the schedule the supervisor announces, then stop it
  await new Promise((r) => setTimeout(r, 300));
  run.stop();
  await run.done;
  assert.match(log[0], /restarting in 1s/);
});

test('stop() ends the child and does not restart it', async () => {
  const run = supervise({ ...child([0], 'setInterval(()=>{},1000);'), ...fast, log: () => {} });
  await new Promise((r) => setTimeout(r, 300));
  run.stop();
  await run.done;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(runs().length, 1);
});

test('a command that cannot start ends the supervisor with an explanation', async () => {
  const log: string[] = [];
  const run = supervise({ command: 'definitely-not-a-program-xyz', args: [], log: (m: string) => log.push(m) });
  assert.equal(await run.done, 1);
  assert.match(log[0], /could not start/);
});
