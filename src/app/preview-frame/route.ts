import { NextRequest } from 'next/server';
import { jsxStampModule, PICKER_PRELUDE } from '@/lib/visual-edit';
import { browserPreviewSupport, cssModule, cssRuntimes, cssUrl, htmlWithBundle, npmUrl, previewBuilderMain, previewEntry, resolveProjectPath, rewriteCssImports, tailwindSource } from '@/lib/browser-preview';

export const dynamic = 'force-dynamic';

/**
 * The in-browser preview runs here: a page the studio embeds in a frame
 * sandboxed WITHOUT allow-same-origin, so it gets an opaque origin and the
 * project's code can't read the studio's storage, keys or pages. Its own
 * policy lets it load esm.sh modules and run esbuild's WebAssembly; only the
 * studio can frame it, and it only takes files from the page that embeds it.
 */
export function GET(request: NextRequest) {
  // The origin the browser used (nextUrl reports the server's own name, e.g. localhost for 127.0.0.1)
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const self = host && /^[\w.:[\]-]+$/.test(host) && /^https?$/.test(proto) ? `${proto}://${host}` : request.nextUrl.origin;
  const version = process.env.NEXT_PUBLIC_ESBUILD_VERSION;
  const cfg = { esbuildUrl: `${self}/esbuild/${version}/browser.js`, wasmUrl: `${self}/esbuild/${version}/esbuild.wasm`, picker: PICKER_PRELUDE };
  const helpers = { browserPreviewSupport, previewEntry, resolveProjectPath, npmUrl, htmlWithBundle, cssUrl, cssRuntimes, tailwindSource, rewriteCssImports, cssModule, jsxStampModule };
  // The program goes inside a <script> element: a literal "</script" in its strings would end the element
  // early, so it is written as "<\/script", which means the same in JavaScript strings, templates and regexes
  const inScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const helperSource = Object.entries(helpers)
    .map(([name, fn]) => `${name}: (${inScript(fn.toString())})`)
    .join(',\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview</title>
<style>html,body{margin:0;height:100%;background:#fff}#app{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<iframe id="app" title="App"></iframe>
<script type="module">
const helpers = {
${helperSource}
};
(${inScript(previewBuilderMain.toString())})(helpers, ${inScript(JSON.stringify(cfg))});
</script>
</body>
</html>`;
  const csp = [
    "default-src 'none'",
    // esm.sh: packages and compilers; jsDelivr and cdn.tailwindcss.com: the CSS frameworks that run in the page (Tailwind, UnoCSS).
    // 'unsafe-eval': compilers built from other languages (dart-sass) and runtime template compilers evaluate code. The frame
    // already runs the project's own code on an opaque origin, so eval reaches nothing the code couldn't already.
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${self} https://esm.sh https://cdn.jsdelivr.net https://cdn.tailwindcss.com blob:`,
    `connect-src ${self} https: wss:`,
    'worker-src blob:',
    "style-src 'unsafe-inline' https:",
    'img-src * data: blob:',
    'font-src https: data:',
    'media-src * data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${self}`,
  ].join('; ');
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
  });
}
