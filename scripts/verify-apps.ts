/**
 * Runs every full-app template for real, the way the studio does: starts it with the dev-server host,
 * loads the page, adds a todo through the API and reads it back, then edits the page and waits for the
 * edit to be served (a self-reloading server, or a restart). Needs each language's toolchain; a missing
 * one is reported as skipped. `npm run verify:apps [-- app-go,app-rust]`
 */

export {};

const { startServer, stopServer, syncServer, stateOf } = await import('../src/lib/devserver.ts');
const { APP_STARTERS } = await import('../src/lib/app-templates.ts');

const only = process.argv[2]?.split(',');
let failed = 0;
for (const s of APP_STARTERS.filter((x) => !only || only.includes(x.id))) {
  const files = { ...s.files, [s.filename]: s.code };
  const id = `verify-${s.id}`.slice(0, 40);
  const started = Date.now();
  const state = await startServer(id, files);
  if (state.status !== 'ready') {
    const missing = /is not installed on this machine/.test(state.error ?? '');
    if (!missing) failed++;
    console.log(`${missing ? '–' : '✕'} ${s.name}: ${state.error}`);
    if (!missing) console.log(state.log.slice(-20).map((l) => l.d).join('').slice(-2000));
    stopServer(id);
    continue;
  }
  const url = state.url!;
  const page = await (await fetch(url)).text();
  const post = await fetch(new URL('/api/todos', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Ship it' }) });
  const list = (await (await fetch(new URL('/api/todos', url))).json()) as { title: string }[];
  await syncServer(id, { 'index.html': files['index.html'].replace('<h1>Todos</h1>', '<h1>Todos, edited</h1>') }, []);
  let edited = false;
  for (let i = 0; i < 180 && !edited; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    edited = await fetch(stateOf(id).url ?? url).then((r) => r.text()).then((t) => t.includes('Todos, edited')).catch(() => false);
  }
  const ok = page.includes('<h1>Todos</h1>') && post.status === 201 && list.some((t) => t.title === 'Ship it') && edited;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✕'} ${s.name}: ready in ${((Date.now() - started) / 1000).toFixed(1)} s · page ${page.includes('<h1>Todos</h1>') ? 'ok' : 'missing'} · POST ${post.status} · ${list.length} todos · edit ${edited ? 'served' : 'NOT served'}`);
  stopServer(id);
}
process.exit(failed ? 1 : 0);
