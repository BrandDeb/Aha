import type { NextConfig } from "next";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// The editor is served from this server (see src/app/monaco), under its own version in the URL
const monacoVersion = JSON.parse(readFileSync("node_modules/monaco-editor/package.json", "utf8")).version as string;
// The in-browser preview's bundler (esbuild-wasm), served the same way under its version
const esbuildVersion = JSON.parse(readFileSync("node_modules/esbuild-wasm/package.json", "utf8")).version as string;
const dev = process.env.NODE_ENV !== "production";

// Renamed from NanoCLI Studio: old NANOCLI_* settings still work, as AHA_* (also done by server.js)
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("NANOCLI_") && process.env[`AHA_${key.slice(8)}`] === undefined) process.env[`AHA_${key.slice(8)}`] = value;
}

/**
 * Content-Security-Policy. Scripts only from this server (inline ones are Next's bootstrap and the
 * pre-paint theme script); WebAssembly for the in-browser runner. Model calls go straight from the
 * browser to whichever provider you configured (any https host, or a local http one such as
 * Ollama), so connections stay open. The preview frame shows dev servers on this machine. Nothing
 * may frame the studio itself.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http: ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/**
 * The editor's largest files, preloaded with the studio page (an HTTP Link header) so they download while
 * the page hydrates instead of after. Found by following the AMD define() dependencies of Monaco's entry,
 * so the hashed chunk names always match the installed version.
 */
function monacoPreloadLinks(): string {
  const root = path.join("node_modules", "monaco-editor", "min", "vs");
  if (!existsSync(path.join(root, "loader.js"))) return "";
  const seen = new Set<string>();
  const queue = ["editor/editor.main.js"];
  while (queue.length && seen.size < 60) {
    const rel = queue.shift()!;
    if (seen.has(rel) || !existsSync(path.join(root, rel))) continue;
    seen.add(rel);
    const deps = /define\(\s*(?:"[^"]*"\s*,\s*)?\[([^\]]*)\]/.exec(readFileSync(path.join(root, rel), "utf8").slice(0, 4000))?.[1] ?? "";
    for (const [, dep] of deps.matchAll(/"(\.\.?\/[^"]+)"/g)) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), dep)) + ".js";
      if (!next.startsWith("..")) queue.push(next);
    }
  }
  const size = (rel: string) => statSync(path.join(root, rel)).size;
  const big = [...seen].filter((rel) => rel !== "editor/editor.main.js" && size(rel) >= 20_000).sort((a, b) => size(b) - size(a));
  const url = (rel: string) => `/monaco/${monacoVersion}/vs/${rel}`;
  const scripts = ["loader.js", "editor/editor.main.js", ...big].map((rel) => `<${url(rel)}>; rel=preload; as=script`);
  return [...scripts, `<${url("editor/editor.main.css")}>; rel=preload; as=style`].join(", ");
}

const monacoLinks = monacoPreloadLinks();

const nextConfig: NextConfig = {
  // The dev-mode route badge sits over the editor chrome; compile and runtime errors still show
  devIndicators: false,
  env: { NEXT_PUBLIC_MONACO_VERSION: monacoVersion, NEXT_PUBLIC_ESBUILD_VERSION: esbuildVersion },
  // No next/image is used: keep the image optimizer (and its attack surface) switched off
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    // The preview frame sends its own, looser policy (it runs the project's code, on an opaque origin)
    return [
      { source: "/:path((?!preview-frame$).*)", headers: securityHeaders },
      // Only when the studio page itself loads: not on prefetches from other pages (they send an RSC header)
      ...(monacoLinks ? [{ source: "/", missing: [{ type: "header" as const, key: "rsc" }], headers: [{ key: "Link", value: monacoLinks }] }] : []),
    ];
  },
};

export default nextConfig;
