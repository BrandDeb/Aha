import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// The editor is served from this server (see src/app/monaco), under its own version in the URL
const monacoVersion = JSON.parse(readFileSync("node_modules/monaco-editor/package.json", "utf8")).version as string;
// The in-browser preview's bundler (esbuild-wasm), served the same way under its version
const esbuildVersion = JSON.parse(readFileSync("node_modules/esbuild-wasm/package.json", "utf8")).version as string;
const dev = process.env.NODE_ENV !== "production";

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

const nextConfig: NextConfig = {
  // The dev-mode route badge sits over the editor chrome; compile and runtime errors still show
  devIndicators: false,
  env: { NEXT_PUBLIC_MONACO_VERSION: monacoVersion, NEXT_PUBLIC_ESBUILD_VERSION: esbuildVersion },
  // No next/image is used: keep the image optimizer (and its attack surface) switched off
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    // The preview frame sends its own, looser policy (it runs the project's code, on an opaque origin)
    return [{ source: "/:path((?!preview-frame$).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
